<template>
  <div class="header">
    <div class="settings">
      <!-- Settings toggle button (always visible) -->
      <button 
        @click="toggleSettings" 
        class="settings-button"
      >
        {{ showSettings ? 'Close Settings' : 'Settings' }}
      </button>
      
      <!-- Settings content (only shown when expanded) -->
      <div v-if="showSettings" class="settings-content">
        <div class="test-mode-container">
          <label class="test-mode-label">
            <input 
              v-model="isTestMode" 
              type="checkbox" 
              class="test-mode-checkbox"
            >
            <span>Test limit&auto</span>
          </label>
          <div class="price-deviation-setting">
            <label>
              Warning price deviation:
              <input 
                v-model.number="priceDeviationPercentage" 
                type="number" 
                min="1" 
                max="100" 
                class="small-number"
              >%
            </label>
          </div>
          <div class="price-deviation-setting">
            <label>
              Near Tolerance:
              <input 
                v-model.number="priceThreshold" 
                type="number" 
                min="0.1" 
                max="100" 
                step="0.1"
                class="small-number"
              >%
            </label>
          </div>
          <div class="graph-api-key-setting">
            <label>
              Graph API Key:
              <input 
                v-model="graphApiKey" 
                type="text" 
                class="api-key-input"
                placeholder="Enter Graph API key"
                @change="saveGraphApiKey"
              >
            </label>
          </div>
          <div class="private-rpc-setting">
            <label>
              Private RPC:
              <input 
                v-model="privateRpc" 
                type="text" 
                class="api-key-input"
                placeholder="Private RPC for swaps"
                @change="savePrivateRpc"
              >
            </label>
          </div>
        </div>
      </div>
      
      <!-- Other settings (hidden when Settings is expanded) -->
      <div v-if="!showSettings" class="other-settings">
        <div class="infura-keys">
          <!-- The title that toggles the infura keys section -->
          <p
            class="title"
            @click="toggleInfuraKeys"
          >
            RPCs ({{ infuraKeys.length }})
            <!-- Icon that rotates when the section is toggled open/closed -->
            <img
              :src="chevronDownImage"
              class="chevron-down"
              :class="{ rotated: showInfuraKeys }"
            >
          </p>
        <!-- The section that shows the list of Infura API keys and an input to add new keys -->
        <div
          v-if="showInfuraKeys"
          class="infura-keys-content"
        >
          <!-- Loop over the infuraKeys array to display each key -->
          <div
            v-for="(key, index) in infuraKeys"
            :key="index"
            class="infura-key-entry"
          >
            <span class="rpc-url">{{ key }}</span>
            <!-- Delete button to remove a specific key -->
            <button @click="deleteInfuraKey(index)">
              Delete
            </button>
          </div>
          <!-- Section to add a new Infura API key -->
          <div class="add-infura-key">
            <form @submit.prevent="addInfuraKey">
              <!-- Two-way binding with newInfuraKey -->
              <input
                v-model="newInfuraKey"
                placeholder="http..."
                @input="errorInfuraKey = ''"
              >
              <!-- Clicking this button adds the new key to the list -->
              <button type="submit">
                +
              </button>
            </form>
          </div>
          <p class="error-message">
            {{ errorInfuraKey }}
          </p>
        </div>
      </div>
      <div class="private-keys">
        <p
          class="title"
          @click="shouldShowPKForm = !shouldShowPKForm"
        >
          Trading Addresses ({{ loadedAddresses.length }})
          <img
            :src="chevronDownImage"
            class="chevron-down"
            :class="{ rotated : shouldShowPKForm }"
          />
        </p>
        <div v-if="shouldShowPKForm && !hasUnlockedPrivateKeys">
          <p
            v-if="!isFileDetected"
            class="text-center"
          >
            First set your password
          </p>
          <p
            v-if="isFileDetected"
            class="text-center"
          >
            Enter your password to load the addresses
          </p>
          <form
            @submit.prevent="() => isFileDetected ? loadPrivateKeys() : readPrivateKeyFile()"
          >
            <input
              v-model="password"
              class="center"
              type="password"
              required
            >
            <div v-if="!isFileDetected">
              <p class="text-center">
                Then submit a Excel or CSV file with the addresses, private keys and names of the trading addresses
              </p>
              <FileManager 
                id="2"
                :no-preview="true"
                file-type="C"
                :extensions="'xls xlsx csv'"
                :should-hide-no-file="false"
                @file:new="storePrivateKeyArgs"
              ></FileManager>
            </div>
            <p
              v-if="errorMessagePK"
              class="error-message"
            >
              {{ errorMessagePK }}
            </p>
            <button 
              type="submit"
              class="submit-button"
            >
              {{ isFileDetected ? 'Load' : 'Submit' }}
            </button>
          </form>
          <span
            v-if="isFileDetected"
            class="action"
            @click="hasUnlockedPrivateKeys = false, isFileDetected = false"
          >Import another file</span>
        </div>
        <div v-if="shouldShowPKForm && hasUnlockedPrivateKeys">
          <span
            class="action"
            @click="hasUnlockedPrivateKeys = false, isFileDetected = false"
          >Import another file</span>
        </div>
      </div>
        <!-- Max Gas Input -->
        <div class="form-group">
          <img
            class="icon-line"
            :src="gasImage"
            width="30"
          >
          <label>
            Max
            <input
              v-model.number="maxGasPrice"
              class="medium-number"
              type="number"
              placeholder="Max Gas"
            > gwei
          </label>
          <GasPrice 
            :max-gas-price="maxGasPrice"
            :provider="provider"
            @update:gas-price="setGasPrice"
          ></GasPrice>
        </div>
      </div>
    </div>
  </div>
  <div class="app-container">
    <div class="main-content">
      <!-- Middle Column: Modes (paramétrage avancé) -->
      <div class="middle-column">
        <ManualTrading
          :addresses="loadedAddresses"
          :gas-price="gasPrice"
          :max-gas-price="maxGasPrice * 1000000000"
          :eth-price="ethPrice"
          :provider="provider"
          @update:settings="setCurrentSettings"
          :confirmed-trade="confirmedTrade"
          @update:gas-price="setGasPrice"
          :is-initial-balance-fetch-done="isInitialBalanceFetchDone"
          @update:trade="addTrade"
          @refresh-balance="refreshBalance"
          :is-test-mode="isTestMode"
          :price-deviation-percentage="priceDeviationPercentage"
          :price-threshold="priceThreshold"
        ></ManualTrading>
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
          :eth-price="ethPrice"
          :provider="provider"
          @confirmed-trade="setConfirmedTrade"
        ></TransferHistory>
      </div>
    </div>
  </div>
</template>

  <script>
  import { watch, shallowRef, onMounted, onBeforeMount, reactive, ref, markRaw, toRaw} from 'vue';
  import FileManager from './components/FileManager.vue';
  import ManualTrading from './components/ManualTrading.vue';
  import TransferHistory from './components/TransferHistory.vue';
  import * as XLSX from 'xlsx';
  import chevronDownImage from '@/../assets/chevron-down.svg';
  import GasPrice from './components/GasPrice.vue';
  import gasImage from '@/../assets/gas.png';
  import {ethers} from 'ethers';

  export default {
    name: 'App',
    components: {
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
      const confirmedTrade = ref({});
      const priceDeviationPercentage = ref(20);
      const priceThreshold = ref(1);
      const showSettings = ref(false);
      const graphApiKey = ref('d692082c59f956790647e889e75fa84d');
      const privateRpc = ref('https://rpc.mevblocker.io');

      const maxGasPrice = ref(3);

      const setCurrentSettings = (settings) => {
        currentSettings.value = {
          ...currentSettings.value,
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

      // Watch and save test mode setting
      watch(() => isTestMode.value, (testModeValue) => {
        currentSettings.value = ({
          ...currentSettings.value,
          isTestMode: testModeValue,
        })
        window.electronAPI.saveSettings(JSON.parse(JSON.stringify({
          ...currentSettings.value,
          isTestMode: testModeValue,
        })));
      })

      // Watch and save price deviation percentage setting
      watch(() => priceDeviationPercentage.value, (deviationValue) => {
        currentSettings.value = ({
          ...currentSettings.value,
          priceDeviationPercentage: deviationValue,
        })
        window.electronAPI.saveSettings(JSON.parse(JSON.stringify({
          ...currentSettings.value,
          priceDeviationPercentage: deviationValue,
        })));
      })

      // Watch and save price threshold setting
      watch(() => priceThreshold.value, (thresholdValue) => {
        currentSettings.value = ({
          ...currentSettings.value,
          priceThreshold: thresholdValue,
        })
        window.electronAPI.saveSettings(JSON.parse(JSON.stringify({
          ...currentSettings.value,
          priceThreshold: thresholdValue,
        })));
      })

      // Save Graph API key
      const saveGraphApiKey = () => {
        currentSettings.value = ({
          ...currentSettings.value,
          graphApiKey: graphApiKey.value,
        })
        window.electronAPI.saveSettings(JSON.parse(JSON.stringify({
          ...currentSettings.value,
          graphApiKey: graphApiKey.value,
        })));
      }
      
      // Save Private RPC
      const savePrivateRpc = () => {
        currentSettings.value = ({
          ...currentSettings.value,
          privateRpc: privateRpc.value,
        })
        window.electronAPI.saveSettings(JSON.parse(JSON.stringify({
          ...currentSettings.value,
          privateRpc: privateRpc.value,
        })));
      }

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


      const infuraKeys = ref([]);
      const provider = shallowRef({});
      watch(() => infuraKeys.value, (infuraKeysValue) => {
        let providersList = infuraKeysValue.map((url) => {
          return markRaw(new ethers.providers.JsonRpcProvider(
            url,
            {
              chainId: 1,
              name: 'homestead',
            }
          ))
        });

        if (providersList.length === 0) {
          providersList = [
            markRaw(new ethers.providers.JsonRpcProvider(
              'https://eth1.lava.build',
              {
                chainId: 1,
                name: 'homestead',
              }
            ))
          ]
        }
        provider.value = markRaw(new ethers.providers.FallbackProvider(
          providersList,
          1,
        ));
      }, {immediate: true});

      // This holds the value of the new key that the user types in
      const newInfuraKey = ref('');
      // Boolean to control whether the Infura API keys section is visible or not
      const showInfuraKeys = ref(false);

      const isInitialBalanceFetchDone = ref(false);
      watch(() => loadedAddresses.value, async (loadedAddressesValue) => {
        isInitialBalanceFetchDone.value = false;
        for (const addressDetail of loadedAddressesValue) {
          if (!currentSettings.value?.tokens) continue;
          for (const token of currentSettings.value.tokens) {
            if (!token.address || token.address === '') continue;

            await refreshBalance(addressDetail, token)
            await new Promise((r) => setTimeout(r, 100))
          }
        }
        isInitialBalanceFetchDone.value = true;
      })

      const refreshBalance = async (addressDetail, token) => {
        if (!addressDetail?.address)
          return false;

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
        
        addressDetail.balances[token.address.toLowerCase()] = balance;
      }

      const erc20Abi = [
        "function symbol() view returns (string)",
        "function decimals() view returns (uint256)",
        "function balanceOf(address) view returns (uint256)",
      ];
      
      const getBalance = async (address, token) => {
        const contract = new ethers.Contract(token.address, erc20Abi, toRaw(provider.value));
        if (!token.decimals)
          token.decimals = await contract.decimals();

        let balance;
        if (token.address === ethers.constants.AddressZero)
          balance = await toRaw(provider.value).getBalance(address);
        else
          balance = await contract.balanceOf(address)

        if (balance.toString() === "0") return 0;
        
        balance = Number(balance) * Math.pow(10, -Number(token.decimals));
        console.log(token.symbol + " balance:", Number(balance));
        return Number(balance);
      };
      
      const ethPrice = ref(0);

      async function getEthUsd () {
        try {
          const url =
            'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';
          const { ethereum } = await fetch(url).then(r => r.json());
          if (ethereum.usd !== '0' && ethereum.usd !== 0)
            return Number(ethereum.usd);
        } catch (err) {
          console.error(err)
        }
        try {
          const url =
            'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';
          const { ethereum } = await fetch(url).then(r => r.json());
          if (ethereum.usd !== '0' && ethereum.usd !== 0)
            return Number(ethereum.usd);
        } catch (err) {
          console.error(err)
        }
        return ethPrice.value;
      }
      ( async () => ethPrice.value = await getEthUsd())();
      setInterval(async () => { 
        ethPrice.value = await getEthUsd();
       }, 30000);

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
          
          loadedAddresses.value = privateKeys.map((pk) => ({address: pk.address.toLowerCase(), name: pk.name})).filter((pk) => pk.address && pk.name);

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

      onBeforeMount(async () => {
        const settings = await window.electronAPI.loadSettings();
        if (settings.maxGasPrice)
          maxGasPrice.value = settings.maxGasPrice;
        if (settings.hasOwnProperty('isTestMode'))
          isTestMode.value = settings.isTestMode;
        if (settings.hasOwnProperty('priceDeviationPercentage'))
          priceDeviationPercentage.value = settings.priceDeviationPercentage;
        if (settings.hasOwnProperty('priceThreshold'))
          priceThreshold.value = settings.priceThreshold;
        if (settings.graphApiKey)
          graphApiKey.value = settings.graphApiKey;
        if (settings.privateRpc)
          privateRpc.value = settings.privateRpc;
      
        isFileDetected.value = await window.electronAPI.isFileDetected();
        
        trades.push(...(await window.electronAPI.getTrades()).data);

        infuraKeys.value = await window.electronAPI.getInfuraKeys();
      })

      onMounted(async () => {
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
      
      // Toggles the settings section
      const toggleSettings = () => {
        showSettings.value = !showSettings.value;
        // Close other sections when opening settings
        if (showSettings.value) {
          showInfuraKeys.value = false;
          shouldShowPKForm.value = false;
        }
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

      const setConfirmedTrade = (trade) => {
        confirmedTrade.value = trade;
        refreshBalance(trade.sender, trade.fromToken || {address: trade.fromTokenAddress, symbol: trade.fromTokenSymbol})
        refreshBalance(trade.sender, trade.toToken || {address: trade.toTokenAddress, symbol: trade.toTokenSymbol})
      }

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
        priceDeviationPercentage,
        priceThreshold,
        showSettings,
        toggleSettings,
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
        provider,
        setConfirmedTrade,
        confirmedTrade,
        isInitialBalanceFetchDone,
        graphApiKey,
        saveGraphApiKey,
        privateRpc,
        savePrivateRpc,
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
  
  .test-mode-container {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: 1;
    gap: 15px;
  }
  
  .price-deviation-setting {
    margin-top: 0;
  }
  
  .price-deviation-setting label {
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 3px;
  }
  
  .price-deviation-setting input.small-number {
    width: 30px;
    padding: 2px 5px;
    border: 1px solid #ddd;
    border-radius: 3px;
    text-align: center;
  }
  
  .graph-api-key-setting,
  .private-rpc-setting {
    margin-top: 0;
  }
  
  .graph-api-key-setting label,
  .private-rpc-setting label {
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 3px;
  }
  
  .graph-api-key-setting input.api-key-input,
  .private-rpc-setting input.api-key-input {
    width: 250px;
    padding: 4px 8px;
    border: 1px solid #ddd;
    border-radius: 3px;
    font-size: 12px;
  }
  
  .settings-button {
    background: #007bff;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
    margin-right: 15px;
    font-size: 14px;
    font-weight: 500;
  }
  
  .settings-button:hover {
    background: #0056b3;
  }
  
  .settings-content {
    display: flex;
    align-items: center;
    justify-content: space-around;
    flex: 1;
    gap: 20px;
  }
  
  .other-settings {
    display: flex;
    align-items: center;
    gap: 15px;
    flex: 1;
    justify-content: space-around;
  }
  
  .settings {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 15px;
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
    max-width: 400px;
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
    text-align: center;
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

  /* Test Mode Checkbox Styles */
  .test-mode-container {
    background-color: #fff;
    padding: 10px;
    border-radius: 5px;
  }

  .test-mode-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 0.9em;
  }

  .test-mode-checkbox {
    margin: 0;
  }
</style>