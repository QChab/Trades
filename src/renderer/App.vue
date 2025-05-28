  <template>
    <div class="header">
      <div class="settings">
        <label>Test mode: <input type="checkbox" v-model="isTestMode"/></label>
        <div class="infura-keys">
          <!-- The title that toggles the infura keys section -->
          <p class="title" @click="toggleInfuraKeys">
            RPCs ({{ infuraKeys.length }})
            <!-- Icon that rotates when the section is toggled open/closed -->
            <img :src="chevronDownImage" class="chevron-down" :class="{ rotated: showInfuraKeys }" />
          </p>
          <!-- The section that shows the list of Infura API keys and an input to add new keys -->
          <div v-if="showInfuraKeys" class="infura-keys-content">
            <!-- Loop over the infuraKeys array to display each key -->
            <div v-for="(key, index) in infuraKeys" :key="index" class="infura-key-entry">
              <span class="rpc-url">{{ key }}</span>
              <!-- Delete button to remove a specific key -->
              <button @click="deleteInfuraKey(index)">Delete</button>
            </div>
            <!-- Section to add a new Infura API key -->
            <div class="add-infura-key">
              <form @submit.prevent="addInfuraKey">
                <!-- Two-way binding with newInfuraKey -->
                <input v-model="newInfuraKey" placeholder="http..." @input="errorInfuraKey = ''"/>
                <!-- Clicking this button adds the new key to the list -->
                <button type="submit">+</button>
              </form>
            </div>
            <p class="error-message">{{ errorInfuraKey }}</p>
          </div>
        </div>
        <div class="private-keys" >
          <p class="title" @click="shouldShowPKForm = !shouldShowPKForm">
            Trading Addresses ({{ loadedAddresses.length }})
            <img :src="chevronDownImage" class="chevron-down" :class="{ rotated : shouldShowPKForm }"></img>
          </p>
          <div v-if="shouldShowPKForm && !hasUnlockedPrivateKeys">
            <p class="text-center" v-if="!isFileDetected">First set your password</p>
            <p class="text-center" v-if="isFileDetected">Enter your password to load the addresses</p>
            <form
              @submit.prevent="() => isFileDetected ? loadPrivateKeys() : readPrivateKeyFile()"
            >
              <input class="center" v-model="password" type="password" required/>
              <div v-if="!isFileDetected">
                <p class="text-center">
                  Then submit a Excel or CSV file with the addresses, private keys and names of the trading addresses
                </p>
                <FileManager 
                  @file:new="storePrivateKeyArgs"
                  :noPreview="true"
                  file-type="C"
                  :extensions="'xls xlsx csv'"
                  id="2"
                  :shouldHideNoFile="false"
                />
              </div>
              <p v-if="errorMessagePK" class="error-message"> {{ errorMessagePK }} </p>
              <button 
                type="submit"
                class="submit-button"
              >
                {{ isFileDetected ? 'Load' : 'Submit' }}
              </button>
            </form>
            <span class="action" v-if="isFileDetected" @click="hasUnlockedPrivateKeys = false, isFileDetected = false">Import another file</span>
          </div>
          <div v-if="shouldShowPKForm && hasUnlockedPrivateKeys">
            <span class="action" @click="hasUnlockedPrivateKeys = false, isFileDetected = false">Import another file</span>
          </div>
        </div>
        <!-- Max Gas Input -->
        <div class="form-group">
          <img class="icon-line" :src="gasImage" width="30"/>
          <label>
            Max
            <input class="medium-number" type="number" v-model.number="maxGasPrice" placeholder="Max Gas" /> gwei
          </label>
          <GasPrice 
            @update:gas-price="setGasPrice"
          />
        </div>
      </div>
    </div>
    <div class="app-container">
      <div class="main-content">

        <!-- Middle Column: Modes (paramétrage avancé) -->
        <div class="middle-column">
          <ManualTrading
            @update:settings="setCurrentSettings"
            @update:gasPrice="setGasPrice"
            @update:trade="addTrade"
            @refreshBalance="refreshBalance"
            :addresses="loadedAddresses"
            :gasPrice="gasPrice"
            :maxGasPrice="maxGasPrice * 1000000000"
            :ethPrice="ethPrice"
          />
        </div>

      </div>
      <!-- Bottom Section: History and Live Visualization -->
      <div class="bottom-section">
        <div class="history-section">
          <!-- <TransferControl
            :settings="currentSettings"
            :sourceAddresses="sourceAddresses"
            :destinationAddresses="destinationAddresses"
            :maxGasPrice="currentSettings?.maxGasPrice"
            :gasPrice="gasPrice"
            @sentTransfer="addTransfer"
            :isTestMode="isTestMode"
            @update:isProcessRunning="setIsProcessRunning"
            @deleteHistory="emptyTransfers"
            :infuraKeys="infuraKeys"
          /> -->
          <TransferHistory 
            :trades="trades"
            :ethPrice="ethPrice"
          />
        </div>
      </div>
    </div>
  </template>

  <script>
  // import TransferControl from './components/TransferControl.vue';
  import { watch } from 'vue';
  import FileManager from './components/FileManager.vue';
  import ManualTrading from './components/ManualTrading.vue';
  import TransferHistory from './components/TransferHistory.vue';
  import { onMounted, onBeforeMount, reactive, ref } from 'vue';
  import * as XLSX from 'xlsx';
  import chevronDownImage from '@/../assets/chevron-down.svg';
  import GasPrice from './components/GasPrice.vue';
  import gasImage from '@/../assets/gas.png';
  import provider from '@/ethersProvider.js';
  import {ethers} from 'ethers';

  export default {
    name: 'App',
    components: {
      // TransferControl,
      FileManager,
      ManualTrading,
      TransferHistory,
      GasPrice,
    },
    setup() {
      const currentSettings = ref({});
      const trades = reactive([]);
      const password = ref('');

      const shouldShowPKForm = ref(true);
      const isFileDetected = ref(false);
      const hasUnlockedPrivateKeys = ref(false);
      const loadedAddresses = ref([]);

      const isTestMode = ref(false);

      const maxGasPrice = ref(3);

      const setCurrentSettings = (settings) => {
        currentSettings.value = {
          ...settings,
          maxGasPrice: maxGasPrice.value,
        };
        window.electronAPI.saveSettings(JSON.parse(JSON.stringify(currentSettings.value)));
      };

      watch(() => maxGasPrice.value, (maxGasPriceValue) => {
        console.log({
          ...currentSettings.value,
          maxGasPrice: maxGasPriceValue,
        })
        window.electronAPI.saveSettings(JSON.parse(JSON.stringify({
          ...currentSettings.value,
          maxGasPrice: maxGasPriceValue,
        })));
      })

      const gasPrice = ref(1000000000);
      const setGasPrice = (currentGasPrice) => {
        gasPrice.value = currentGasPrice;
        window.electronAPI.setGasPrice(gasPrice.value);
      }

      const addTrade = (trade) => {
        trades.unshift({
          ...trade,
          timestamp: new Date(),
        });
      }

      watch(() => loadedAddresses.value, async (loadedAddressesValue) => {
        for (const addressDetail of loadedAddressesValue) {
          if (!currentSettings.value?.tokens) continue;
          for (const token of currentSettings.value.tokens) {
            if (!token.address || token.address === '') continue;

            let balance;
            try {
              balance = await getBalance(addressDetail.address, token);
              if (!balance && balance !== 0)
                balance = await getBalance(addressDetail.address, token);
              if (!balance && balance !== 0)
                balance = await getBalance(addressDetail.address, token);
            } catch (err) {
              console.error(err);
              balance = 0;
            }
            if (!addressDetail.balances) addressDetail.balances = {};
            addressDetail.balances[token.address] = balance;
            await new Promise((r) => setTimeout(r, 100))
          }
        }
      })

      const refreshBalance = async (addressDetail, token) => {
        console.log(addressDetail, token);
        let balance;
        try {
          balance = await getBalance(addressDetail.address, token);
          if (!balance && balance !== 0)
            balance = await getBalance(addressDetail.address, token);
          if (!balance && balance !== 0)
            balance = await getBalance(addressDetail.address, token);
        } catch (err) {
          console.error(err);
          balance = 0;
        }
        if (!addressDetail.balances) addressDetail.balances = {};
          addressDetail.balances[token.address] = balance;
      }

      const erc20Abi = [
        "function symbol() view returns (string)",
        "function decimals() view returns (uint256)",
        "function balanceOf(address) view returns (uint256)",
      ];
      
      const getBalance = async (address, token) => {
        if (isTestMode.value) {
          return Math.floor(Math.random() * 60);
        }

        const contract = new ethers.Contract(token.address, erc20Abi, provider);
        if (!token.decimals)
          token.decimals = await contract.decimals();

        let balance;
        if (token.address === '0x0000000000000000000000000000000000000000')
          balance = await provider.getBalance(address);
        else
          balance = await contract.balanceOf(address)
        if (balance.toString() === "0") return 0;
        
        // const balanceOffset = balanceOffsetByTokenByAddress[token.address] && balanceOffsetByTokenByAddress[token.address][address] ? balanceOffsetByTokenByAddress[token.address][address] : 0;
        const balanceOffset = 0;
        balance = Number(balance) * Math.pow(10, -Number(token.decimals)) - balanceOffset;
        console.log("ERC20 balance:", Number(balance));
        return Number(balance);
      };
      
      const ethPrice = ref(0);

      async function getEthUsd () {
        const url =
          'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';
        const { ethereum } = await fetch(url).then(r => r.json());
        return Number(ethereum.usd);
      }
      ( async () => ethPrice.value = await getEthUsd())();
      setTimeout(async () => ethPrice.value = await getEthUsd(), 120000)

      const readDataFromString = async (args) => { 
        let { fileContent, ext } = args;
        ext = ext.toLowerCase();
        
        if (!['csv', 'xls', 'xlsx', 'rtf'].includes(ext)) {
          throw new Error(`Unsupported file extension: ${ext}`);
        }
        
        let workbook;
        if (ext === 'csv') {
          workbook = XLSX.read(fileContent, { type: 'string', raw: false });
        } else if (ext === 'rtf') {
          const text = await window.electronAPI.decryptRtf(fileContent);
          return text;
        } else {
          workbook = fileContent;
        }
        
        // Get the first sheet name.
        const sheetName = workbook.SheetNames[0];
        // Get the worksheet.
        const worksheet = workbook.Sheets[sheetName];
        // Convert the worksheet to JSON.
        // Using option { header: 1 } returns an array of arrays (each sub-array is a row).
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
        // Map over the data to ensure each cell is a string
        const stringArray = data.map(row =>
          row.map(cell => (cell !== undefined && cell !== null) ? String(cell) : '')
        );
        if (ext === 'xls') stringArray.splice(0, 1);
        
        return stringArray;
      }

      const errorMessagePK = ref('');
      const privateKeyArgs = ref();

      const storePrivateKeyArgs = (args) => {
        privateKeyArgs.value = {...args};
      }

      const readPrivateKeyFile = async () => {
        try {
          if (!password.value) {
            throw new Error('Missing password');
          }

          if (!privateKeyArgs.value) {
            throw new Error('Missing file');
          }

          const data = await readDataFromString(privateKeyArgs.value);
          const firstLine = data.splice(0, 1)[0];
          let indexPK;
          for (indexPK = 0 ; indexPK < firstLine.length ; ++indexPK)
            if (firstLine[indexPK].toLowerCase().startsWith('private') || firstLine[indexPK].toLowerCase().startsWith('pk')) break;
          let indexAddress;
          for (indexAddress = 0 ; indexAddress < firstLine.length ; ++indexAddress)
            if (firstLine[indexAddress].toLowerCase().startsWith('address')) break;
          let indexName;
          for (indexName = 0 ; indexName < firstLine.length ; ++indexName)
            if (firstLine[indexName].toLowerCase().startsWith('name')) break;

          const privateKeys = data.map((line) => ({
            pk: line[indexPK],
            address: line[indexAddress],
            name: line[indexName],
          }));
          
          loadedAddresses.value = privateKeys.map((pk) => ({address: pk.address, name: pk.name})).filter((pk) => pk.address && pk.name);

          const result = await window.electronAPI.savePrivateKeys({privateKeys, password: password.value});
          if (!result?.success) throw new Error('Private keys not saved, error: ' + result?.error);

          if (!(await window.electronAPI.isFileDetected()))
            throw new Error('The file hasnt been saved');

          password.value = '';
          errorMessagePK.value = '';
          isFileDetected.value = true;
          hasUnlockedPrivateKeys.value = true;
        } catch (err) {
          loadedAddresses.value = [];
          if (err.toString)
            errorMessagePK.value = err.toString()
          else
            errorMessagePK.value = err
          console.error(err);
        }
      };

      const loadPrivateKeys = async () => {
        try {
          if (!password.value) throw new Error('No password');
          const result = await window.electronAPI.loadPrivateKeys(password.value);
          if (!result.success) throw new Error('Private keys not loaded, error: ' + result.error);
          loadedAddresses.value = result.addresses;

          shouldShowPKForm.value = false;
          hasUnlockedPrivateKeys.value = true;
          password.value = '';

          return 
        } catch (err) {
          if (err.toString)
            errorMessagePK.value = err.toString()
          else
            errorMessagePK.value = err
          console.error(err);
        }
      }

      const infuraKeys = ref([]);
      // This holds the value of the new key that the user types in
      const newInfuraKey = ref('');
      // Boolean to control whether the Infura API keys section is visible or not
      const showInfuraKeys = ref(false);

      onBeforeMount(async () => {
        const settings = await window.electronAPI.loadSettings();
        if (settings.maxGasPrice)
          maxGasPrice.value = settings.maxGasPrice;
      })

      onMounted(async () => {
        isFileDetected.value = await window.electronAPI.isFileDetected();
        
        trades.push(...(await window.electronAPI.getTrades()).data);

        infuraKeys.value = await window.electronAPI.getInfuraKeys();
      });

      const isProcessRunning = ref(false);
      const setIsProcessRunning = (bool) => {
        isProcessRunning.value = bool;
      }

      const emptyTrades = () => {
        trades.splice(0, trades.length);
      }

      // Toggles the display of the Infura API keys section when the title is clicked
      const toggleInfuraKeys = () => {
        showInfuraKeys.value = !showInfuraKeys.value;
      };

      const errorInfuraKey = ref('');

      // Adds a new Infura API key to the list if the input is not empty
      const addInfuraKey = async () => {
        const key = newInfuraKey.value.trim(); // Remove whitespace
        if (key && (key.startsWith('http'))) {
          if (infuraKeys.value.indexOf(key) > -1) {
            return errorInfuraKey.value = 'RPC already present';
          }
          infuraKeys.value = await window.electronAPI.saveInfuraKey(key);
          newInfuraKey.value = '';
          errorInfuraKey.value = '';
        } else {
          errorInfuraKey.value = 'Invalid new RPC';
        }
      };

      const deleteInfuraKey = async (index) => {
        infuraKeys.value = await window.electronAPI.deleteInfuraKey(index);
      };

      return {
        setCurrentSettings,
        currentSettings,
        addTrade,
        trades,
        password,
        storePrivateKeyArgs,
        readPrivateKeyFile,
        chevronDownImage,
        shouldShowPKForm,
        isFileDetected,
        errorMessagePK,
        loadPrivateKeys,
        hasUnlockedPrivateKeys,
        gasPrice,
        setGasPrice,
        isTestMode,
        isProcessRunning,
        setIsProcessRunning,
        emptyTrades,
        infuraKeys,
        newInfuraKey,
        showInfuraKeys,
        deleteInfuraKey,
        toggleInfuraKeys,
        addInfuraKey,
        errorInfuraKey,
        gasImage,
        maxGasPrice,
        loadedAddresses,
        ethPrice,
        refreshBalance,
      }
    }
  };
  </script>

  <style scoped>
  .header {
    background-color: #fff;
    margin: 0;
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  /* Flex column layout for overall application */
  .app-container {
    display: flex;
    flex-direction: column;
    height: 150vh;
    width: 100%;
    background-color: #f7f7f7;
  }

  /* The controller section at the top takes minimal height */
  .main-content {
    display: flex;
    width: 100%;
  }

  /* Columns in the main content area */
  .left-column, .middle-column, .right-column {
    flex: 1;
    padding: 10px;
  }

  .left-column {
    max-width: 400px;
  }

  .settings {
    border-radius: 4px;
    box-shadow: 0 6px 8px rgba(0, 0, 0, 0.2);
    border-radius: 5px;
    padding: 5px;
    background-color: #fff;
    display: flex;        /* horizontal layout of panels */
    align-items: center;  /* vertical centering */
    gap: 15px;            /* space between each panel */
    width: 100%;
    justify-content: space-around;
  }
  .header .settings .form-group {
    gap: 5px;                     /* small gap between icon, label, input */
  }
  
  /* Bottom section for history and live visualization */
  .bottom-section {
    display: flex;
    flex: 1 1 auto;
  }

  .history-section {
    flex: 1;
    overflow-y: auto;
    border-radius: 4px;
    box-shadow: 0 6px 8px rgba(0, 0, 0, 0.2);
    border-radius: 5px;
    background-color: #fff;
  }

  input.center {
  padding: 5px;
  }

  button.center {
    margin-top: 10px;
  }

  p.title {
    text-align: center;
    font-weight: 600;
    cursor: pointer;
  }

  .submit-button {
    display: block;
    margin: 15px auto;
  }
  </style>

  <style>
  h1, h2, h3, h4 {
    font-family: "Titillium Web", serif;
    font-weight: 700;
    font-style: normal;
  }

  h3 {
    font-size: 1.3em;
  }

  h4 {
    font-size: 1.2em;
  }

  label, button, a, p, span, li {
    font-family: "Poppins", serif;
    font-optical-sizing: auto;
    font-style: normal;
    font-size: 0.9em;
  }

  .text-center {
    text-align: center;
  }

  .private-keys {
    padding-bottom: 10px;
  }

  .center {
    margin: 0 auto;
    display: block;
  }

  .small-scrollable {
    overflow: auto;
    height: 50px;
    display: block;
    font-size: 0.8em;
  }

  .chevron-down {
    width: 30px;
    height: 30px;
    display: inline-block;
    transition: transform 0.1s ease;
    position: relative;
    top: 10px;
  }
  
  .rotated {
    transform: rotate(180deg);
  }

  .error-message {
    color: red;
  }

  .action {
    text-decoration: underline;
    cursor: pointer;
    margin: 15px;
    display: block;
  }

  .infura-keys {
    margin-bottom: 20px; /* Add space below the section */
  }
  
  /* Title for the Infura API keys section, styled as clickable */
  .infura-keys .title {
    font-weight: bold;
    cursor: pointer; /* Change cursor to indicate clickability */
    align-items: center;
    justify-content: space-between;
  }
  
  /* Content container for the Infura API keys when expanded */
  .infura-keys-content {
    margin-top: 10px; /* Space above the content */
    padding: 10px;
    border: 1px solid #ccc; /* Light border around the content */
    border-radius: 4px;
  }
  
  /* Each Infura key entry is displayed as a flex container */
  .infura-key-entry {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 0;
    border-bottom: 1px solid #eee; /* Divider between keys */
  }
  
  /* Remove bottom border for the last key entry */
  .infura-key-entry:last-child {
    border-bottom: none;
  }
  
  /* Style for the delete button next to each Infura key */
  .infura-key-entry button {
    background-color: #d89891; /* Red background to indicate deletion */
    color: #fff;
    border: none;
    padding: 5px 10px;
    cursor: pointer;
    border-radius: 4px;
  }
  
  /* Container for adding a new Infura key */
  .add-infura-key {
    margin-top: 10px; /* Space above the add section */
    display: flex;
    align-items: center;
  }
  
  /* Style for the input field where the new API key is entered */
  .add-infura-key input {
    flex: 1;
    padding: 5px;
    border: 1px solid #ccc;
    border-radius: 4px;
    width: 270px;
  }
  
  /* Style for the add button (plus button) */
  .add-infura-key button {
    margin-left: 10px;
    background-color: #88bb9d; /* Green background for the add action */
    color: #fff;
    border: none;
    padding: 5px 10px;
    cursor: pointer;
    border-radius: 4px;
  }

  .rpc-url {
    width: 250px;
    text-overflow: ellipsis;
    display: block;
    overflow: hidden;
  }

  input.medium-number {
    width: 70px;
    margin: 0 5px;
    text-align: center;
    padding: 5px;
    border: none;
    font-size: 17px;
  }

  .icon-line {
    position: relative;
    top: 10px;
    margin-right: 10px;
  }
</style>