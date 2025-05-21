  <template>
    <div class="app-container">
      <div class="main-content">
        <div class="left-column">
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

          <div class="files">
            <div class="private-keys" >
              <p class="title" @click="shouldShowPKForm = !shouldShowPKForm">
                Trading Addresses
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
                      Then submit a Excel or CSV file with the addresses and private keys of the trading addresses
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
                <p>Your addresses are loaded.</p>
                <span class="action" @click="hasUnlockedPrivateKeys = false, isFileDetected = false">Import another file</span>
              </div>

            </div>
          </div>
        </div>

        <!-- Middle Column: Modes (paramétrage avancé) -->
        <div class="middle-column">
          <ManualTrading
            @update:settings="setCurrentSettings"
            @update:gasPrice="setGasPrice"
            :isProcessRunning="isProcessRunning"
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
            :transfers="transfers"
          />
        </div>
      </div>
    </div>
  </template>

  <script>
  import TransferControl from './components/TransferControl.vue';
  import FileManager from './components/FileManager.vue';
  import ManualTrading from './components/ManualTrading.vue';
  import TransferHistory from './components/TransferHistory.vue';
  import { onMounted, reactive, ref } from 'vue';
  import * as XLSX from 'xlsx';
  import chevronDownImage from '@/../assets/chevron-down.svg';
  import { isAddress } from 'ethers';

  export default {
    name: 'App',
    components: {
      TransferControl,
      FileManager,
      ManualTrading,
      TransferHistory,
    },
    setup() {
      const currentSettings = ref({});
      const transfers = reactive([]);
      const password = ref('');
      const sourceAddresses = ref([]);
      const destinationAddresses = ref([]);

      const shouldShowPKForm = ref(true);
      const isFileDetected = ref(false);
      const hasUnlockedPrivateKeys = ref(false);

      const isTestMode = ref(false);

      const setCurrentSettings = (settings) => {
        currentSettings.value = {
          ...settings,
        };
      };

      const gasPrice = ref(1000000000);
      const setGasPrice = (currentGasPrice) => {
        gasPrice.value = currentGasPrice;
      }

      const addTransfer = (transfer) => {
        transfers.unshift({
          ...transfer,
          timestamp: new Date(),
        });
      }

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

      const errorMessageSourceAddresses = ref('');
      const readSourceAddresses = async (args) => {
        try {
          const data = await readDataFromString(args);
          let index;
          const firstLine = data.splice(0, 1)[0];

          for (index = 0 ; index < firstLine.length ; ++index) {
            if (!firstLine[index]) continue;
            if (firstLine[index].toLowerCase().startsWith('address') || firstLine[index].toLowerCase().startsWith('adress')) break;
          }

          sourceAddresses.value = data.filter((line) => line && line.length > 0).map((line) => line[index].trim()).filter((address) => isAddress(address));
          if (sourceAddresses.value.length === 0) throw new Error('No address found');

          errorMessageSourceAddresses.value = '';

          window.electronAPI.saveAddresses(JSON.parse(JSON.stringify(sourceAddresses.value)), true);
        } catch (err) {
          if (err.toString)
            errorMessageSourceAddresses.value = err.toString();
          else
            errorMessageSourceAddresses.value = err;
          console.error(err);
        }
      }

      const errorMessageDestinationAddresses = ref('');
      const readDestinationAddresses = async (args) => {
        try {
          const data = await readDataFromString(args);
          const evmAddressRegex = /\/[0-9]+[,]?(0x[a-fA-F0-9]{40})/g;
          const matches = data.matchAll(evmAddressRegex);
          const addresses = []
          for (const match of matches) {
            if (match[0] && match[1])
              addresses.push(match[1])
          }
          destinationAddresses.value = addresses.map((address) => address.trim()).filter((address) => isAddress(address));
          if (destinationAddresses.value.length === 0) throw new Error('No address found');

          errorMessageDestinationAddresses.value = '';

          window.electronAPI.saveAddresses(JSON.parse(JSON.stringify(destinationAddresses.value)), false);
        } catch (err) {
          if (err.toString)
            errorMessageDestinationAddresses.value = err.toString();
          else
            errorMessageDestinationAddresses.value = err;
          console.error(err);
        }
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

          const privateKeys = data.map((line) => ({
            pk: line[indexPK],
            address: line[indexAddress],
          }));
          const result = await window.electronAPI.savePrivateKeys({privateKeys, password: password.value});
          if (!result?.success) throw new Error('Private keys not saved, error: ' + result?.error);

          if (!(await window.electronAPI.isFileDetected()))
            throw new Error('The file hasnt been saved');

          password.value = '';
          errorMessagePK.value = '';
          isFileDetected.value = true;
          hasUnlockedPrivateKeys.value = true;
        } catch (err) {
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
          hasUnlockedPrivateKeys.value = true;
          password.value = '';
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

      onMounted(async () => {
        isFileDetected.value = await window.electronAPI.isFileDetected();
        
        transfers.push(...(await window.electronAPI.getTransfers()).data);

        sourceAddresses.value = await window.electronAPI.readAddresses(true);
        destinationAddresses.value = await window.electronAPI.readAddresses(false);

        infuraKeys.value = await window.electronAPI.getInfuraKeys();
      });

      const isProcessRunning = ref(false);
      const setIsProcessRunning = (bool) => {
        isProcessRunning.value = bool;
      }

      const emptyTransfers = () => {
        transfers.splice(0, transfers.length);
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
        addTransfer,
        transfers,
        password,
        readSourceAddresses,
        sourceAddresses,
        readDestinationAddresses,
        destinationAddresses,
        storePrivateKeyArgs,
        readPrivateKeyFile,
        chevronDownImage,
        shouldShowPKForm,
        isFileDetected,
        errorMessagePK,
        errorMessageSourceAddresses,
        errorMessageDestinationAddresses,
        loadPrivateKeys,
        hasUnlockedPrivateKeys,
        gasPrice,
        setGasPrice,
        isTestMode,
        isProcessRunning,
        setIsProcessRunning,
        emptyTransfers,
        infuraKeys,
        newInfuraKey,
        showInfuraKeys,
        deleteInfuraKey,
        toggleInfuraKeys,
        addInfuraKey,
        errorInfuraKey,
      }
    }
  };
  </script>

  <style scoped>
  /* Flex column layout for overall application */
  .app-container {
    display: flex;
    flex-direction: column;
    height: 150vh;
    background-color: #f7f7f7;
  }

  /* The controller section at the top takes minimal height */
  .main-content {
    display: flex;
    flex: 0 0 30%; /* Middle section: min 30% of the window height */
  }

  /* Columns in the main content area */
  .left-column, .middle-column, .right-column {
    flex: 1;
    padding: 10px;
  }

  .left-column {
    max-width: 400px;
  }

  .files {
    border-radius: 4px;
    box-shadow: 0 6px 8px rgba(0, 0, 0, 0.2);
    border-radius: 5px;
    padding: 20px;
    background-color: #fff;
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
    width: 300px;
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
</style>