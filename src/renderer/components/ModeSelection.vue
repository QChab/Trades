<template>
  <div class="mode-selection">
    <h3>Settings</h3>
    <p v-if="isProcessRunning && haveSettingsBeenModifiedSinceRunning">The modifications will only be applied to next run.</p>
    <!-- Delay settings -->
    <div class="form-group">
      <img class="icon-line" :src="timeImage" width="30"/>
      <label>
        Between 
        <input class="small-number" type="number" v-model.number="minuteDelayMin" placeholder="0" /> min
        <input class="small-number" type="number" v-model.number="delayMin" placeholder="Min" /> s
      </label>
      <label>
        and
        <input class="small-number" type="number" v-model.number="minuteDelayMax" placeholder="0" /> min
        <input class="small-number" type="number" v-model.number="delayMax" placeholder="Max" /> s
      </label>
    </div>

    <!-- Max Gas Input -->
    <div class="form-group">
      <img class="icon-line" :src="gasImage" width="30"/>
      <label>
        Max gas price:
        <input class="medium-number" type="number" v-model.number="maxGasPrice" placeholder="Max Gas" /> gwei
      </label>
      <GasPrice 
        @update:gas-price="setGasPrice"
      />
    </div>

    <!-- Amount by transfer selection -->
    <div class="form-group">
      <p @click="shouldDiplayAmountForm = !shouldDiplayAmountForm" class="text-center">
        Amount by transfer
        <span class="tips"> {{ amountChoices.filter((ac) => ac.enabled).length }} selected </span>
        <img :src="chevronDownImage" class="chevron-down" :class="{ rotated : shouldDiplayAmountForm }"></img>
      </p>
      <div v-if="shouldDiplayAmountForm" class="settings-section">
        <ul class="two-column-list">
          <!-- CHECKBOXES -->
          <li v-if="!isEditingAmountChoices" v-for="(choice, index) in amountChoices" :key="index">
            <!-- Wrap input and text in a label to make entire area clickable -->
            <label class="checkbox-label" :class="{ selected: choice.enabled }">
              <input type="checkbox" v-model="choice.enabled" @change="emitSettings"/>
              <span v-if="!choice.isRange">{{ choice.value }}</span>
              <span v-else>Between {{ choice.min ? choice.min : 0 }} and {{ choice.max }} ({{ choice.decimals }} decimals)</span>
            </label>
            <label v-if="isEditingAmountChoices && !choice.isRange" class="checkbox-label">
              <input v-if="!choice.isRange" v-model="choice.value"/>
            </label>
            <label v-if="isEditingAmountChoices && choice.isRange" class="checkbox-label">
                Min: <input v-model.number="choice.min"/>
            </label>
            <label v-if="isEditingAmountChoices && choice.isRange" class="checkbox-label">
                Max: <input v-model.number="choice.max"/>
            </label>
          </li>

          <!-- EDITING -->
          <li v-if="isEditingAmountChoices" v-for="(choice, index) in amountChoices.filter((ac) => !ac.isRange)" :key="index + 100">
            <label class="checkbox-label" :class="{ selected: choice.enabled }">
              <input v-model.number="choice.value"/>
            </label>
          </li>
          <li v-if="isEditingAmountChoices" v-for="(choice, index) in amountChoices.filter((ac) => ac.isRange)" :key="index + 200">
            <label class="checkbox-label" :class="{ selected: choice.enabled }">
              <input class="medium-number" v-model.number="choice.min"/>
              to
              <input class="medium-number" v-model.number="choice.max"/>
            </label>
            <label class="checkbox-label">
              <div class="decimals">
                Decimals:
                <input type="number" class="small-number" v-model.number="choice.decimals"/>
              </div>
            </label>
          </li>
        </ul>
        <button @click="isEditingAmountChoices = !isEditingAmountChoices" class="edit-button">
          {{ isEditingAmountChoices ? 'Stop editing' : 'Edit amounts' }}
        </button>
      </div>
    </div>

    <!-- Token selection list -->
    <div class="form-group">
      <p @click="shouldDiplayTokenForm = !shouldDiplayTokenForm" class="text-center">
        Tokens
        <span class="tips"> {{ tokens.filter((token) => token.enabled).length }} selected </span>
        <span class="tips"> {{ randomTokenSelection ? '+ random' : '' }} </span>
        <img :src="chevronDownImage" class="chevron-down" :class="{ rotated : shouldDiplayTokenForm }"></img>
      </p>
      <div v-if="shouldDiplayTokenForm">
        <div v-if="!isEditingTokens">
          <ul class="two-column-list">
            <li v-for="(token, index) in tokens.filter((token) => token.symbol !== '' && token.address !== '' )" :key="index">
              <!-- Wrap input and text in a label to make entire area clickable -->
              <label class="checkbox-label" :class="{ selected: token.enabled }">
                <input type="checkbox" v-model="token.enabled" :disabled="!isAddress(token.address)"/>
                <span>{{ token.symbol }} {{ token.address.substring(0, 8) }}... </span>
              </label>
            </li>
          </ul>
          <!-- Option for random token selection -->
          <div>
            <label class="checkbox-label token-random-choice" :class="{ bold: randomTokenSelection }">
              <input type="checkbox" v-model="randomTokenSelection" />
              <span>Random choice amongst the selected</span>
            </label>
          </div>
        </div>
        <!-- EDITING -->
        <div v-else>
          <ul class="two-column-list">
            <li v-for="(token, index) in tokens" :key="index">
              <label class="checkbox-label edit-label" :class="{ selected: token.enabled }">
                <!-- First line: Token address and delete icon -->
                <div class="line">
                  <input v-model="token.address" @input="findSymbol(index, token.address)" placeholder="Address" />
                  <img :src="deleteImage" class="delete" @click="deleteToken(index)"/>
                  <div class="compensate-delete"></div>
                </div>
              </label>
              <label>
                <!-- Second line: Token symbol -->
                <div class="line">
                  <span>Symbol:</span>
                  <input v-model="token.symbol" placeholder="Token Name" class="token-name" />
                </div>
              </label>
            </li>
          </ul>
        </div>
        <button @click="isEditingTokens = !isEditingTokens" class="edit-button">
          {{ isEditingTokens ? 'Stop editing' : 'Edit tokens' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, reactive, watch, onMounted } from 'vue';
import GasPrice from './GasPrice.vue';
import timeImage from '@/../assets/time.png';
import gasImage from '@/../assets/gas.png';
import chevronDownImage from '@/../assets/chevron-down.svg';
import deleteImage from '@/../assets/delete.svg';
import { isAddress, Contract } from 'ethers';
import provider from '@/ethersProvider';

export default {
  name: 'ModeSelection',
  components: {
    GasPrice,
  },
  props: {
    isProcessRunning: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:settings', 'update:gasPrice'],
  setup(props, { emit } ) {
    const haveSettingsBeenModifiedSinceRunning = ref(false);
    // Parameters
    const minuteDelayMin = ref(0);
    const minuteDelayMax = ref(0);
    const delayMin = ref(1);
    const delayMax = ref(2);

    const maxGasPrice = ref(2);

    const shouldDiplayAmountForm = ref(true);
    const isEditingAmountChoices = ref(false);
    // Token amount choices: 6 fixed and 1 range option.
    const amountChoices = reactive([
      { value: 100, enabled: true, isRange: false },
      { value: 1, enabled: false, isRange: false },
      { value: 1220, enabled: false, isRange: false },
      { value: 0.15, enabled: true, isRange: false },
      { value: 25, enabled: true, isRange: false },
      { value: 13, enabled: false, isRange: false },
      { min: 0.5, max: 5000, decimals: 3, enabled: true, isRange: true },
    ]);

    const shouldDiplayTokenForm = ref(true);
    const isEditingTokens = ref(false);
    // Token selection list with on/off toggles.
    const tokens = reactive([
      { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT', enabled: true },
      { address: '', symbol: '', enabled: false },
      { address: '', symbol: '', enabled: false },
      { address: '', symbol: '', enabled: false },
      { address: '', symbol: '', enabled: false },
      { address: '', symbol: '', enabled: false },
      { address: '', symbol: '', enabled: false },
      { address: '', symbol: '', enabled: false },
      { address: '', symbol: '', enabled: false },
      { address: '', symbol: '', enabled: false },
      { address: '', symbol: '', enabled: false },
      { address: '', symbol: '', enabled: false },
    ]);
    const randomTokenSelection = ref(false);

    const emitSettings = () => {
      if (props.isProcessRunning) {
        haveSettingsBeenModifiedSinceRunning.value = true;
      }
      const settings = {
        delayMin: delayMin.value + (minuteDelayMin.value ? minuteDelayMin.value * 60 : 0),
        delayMax: delayMax.value + (minuteDelayMax.value ? minuteDelayMax.value * 60 : 0),
        maxGasPrice: Number(maxGasPrice.value) * 1000000000,
        amounts: amountChoices.filter((ac) => ac.enabled && (ac.value || ac.isRange)).map((ac) => ({...ac})),
        tokens: tokens.filter((token) => token.enabled && token.symbol && token.address && isAddress(token.address)).map((token) => ({...token})),
        isRandomToken: randomTokenSelection.value,
      };

      emit('update:settings', settings);
      
      settings.minuteDelayMin = minuteDelayMin.value;
      settings.delayMin = delayMin.value;
      settings.minuteDelayMax = minuteDelayMax.value;
      settings.delayMax = delayMax.value;
      settings.amounts = [...amountChoices];
      settings.tokens = [...tokens];
      settings.maxGasPrice = maxGasPrice.value;
      window.electronAPI.saveSettings(JSON.parse(JSON.stringify(settings)));
    };

    onMounted(async () => {
      const settings = await window.electronAPI.loadSettings();
      if (settings) {
        if (settings.minuteDelayMin) minuteDelayMin.value = settings.minuteDelayMin;
        if (settings.delayMin) delayMin.value = settings.delayMin;
        if (settings.minuteDelayMax) minuteDelayMax.value = settings.minuteDelayMax;
        if (settings.delayMax) delayMax.value = settings.delayMax;
        if (settings.maxGasPrice) maxGasPrice.value = settings.maxGasPrice;
        if (settings.isRandomToken) randomTokenSelection.value = settings.isRandomToken;
        if (settings.amounts) {
          for (let i = 0 ; i < settings.amounts.length ; i++ ) {
            amountChoices[i] = settings.amounts[i];
          }
        }
        if (settings.tokens) {
          for (let i = 0 ; i < settings.tokens.length ; i++ ) {
            tokens[i] = settings.tokens[i];
          }
        }
      }
      emitSettings();
    });

    watch(amountChoices, () => emitSettings(), {deep: true});
    watch(tokens, () => emitSettings(), {deep: true});
    watch(minuteDelayMin, () => emitSettings());
    watch(delayMin, () => emitSettings());
    watch(minuteDelayMax, () => emitSettings());
    watch(delayMax, () => emitSettings());
    watch(maxGasPrice, () => emitSettings());
    watch(randomTokenSelection, () => emitSettings());

    watch(props.isProcessRunning, (value, oldValue) => {
      haveSettingsBeenModifiedSinceRunning.value = false;
    })

    const erc20Abi = [
      "function symbol() view returns (string)"
    ];

    const getTokenSymbol = async (contractAddress) => {
      // Create a Contract instance pointing to your ERC20
      const contract = new Contract(contractAddress, erc20Abi, provider);
      
      // Call the 'symbol()' method
      const symbol = await contract.symbol();
      console.log("ERC20 Symbol:", symbol);
      return symbol;
    };

    const findSymbol = async (index, contractAddress) => {
      if (isAddress(contractAddress))
        tokens[index].symbol = await getTokenSymbol(contractAddress);
      else
        tokens[index].enabled = false;
    };

    const deleteToken = (index) => {
      const token = tokens[index];
      token.address = '';
      token.symbol = '';
      token.enabled = false;
    };

    const setGasPrice = (gasPrice) => {
      window.electronAPI.setGasPrice(gasPrice);
      emit('update:gasPrice', gasPrice);
    };

    return {
      minuteDelayMin,
      minuteDelayMax,
      delayMin,
      delayMax,
      maxGasPrice,
      amountChoices,
      tokens,
      randomTokenSelection,
      timeImage,
      gasImage,
      chevronDownImage,
      deleteImage,
      shouldDiplayAmountForm,
      isEditingAmountChoices,
      shouldDiplayTokenForm,
      isEditingTokens,
      isAddress,
      findSymbol,
      deleteToken,
      setGasPrice,
      haveSettingsBeenModifiedSinceRunning,
    };
  }
};
</script>

<style scoped>
.mode-selection {
  border-radius: 4px;
  box-shadow: 0 6px 8px rgba(0, 0, 0, 0.2);
  border-radius: 5px;
  padding: 20px;
  background-color: #fff;
}

.form-group {
  margin-bottom: 15px;
}
input[type="number"] {
  width: 70px;
  margin-right: 10px;
}

p {
  font-weight: 600;
  cursor: pointer;
  user-select: none; /* Standard syntax */
  -webkit-user-select: none; /* Safari */
  -moz-user-select: none; /* Old Firefox */
  -ms-user-select: none; /* Internet Explorer/Edge */
}

h3 {
  text-align: center;
  margin-top: 0;
}

/* Two-column list using CSS Grid */
.two-column-list {
  list-style: none;
  padding: 0;
  margin: 10px 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 15px;
}

/* Label styling for clickable checkbox areas */
.checkbox-label {
  max-width: 150px;
  display: flex;
  align-items: center;
  padding: 2px;
  border: 2px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.3s ease, border-color 0.3s ease;
}

.checkbox-label input {
  text-align: center;
}

/* Highlight when selected */
.checkbox-label.selected {
  background-color: #e0f7fa; /* Light cyan */
  border: 2px solid #00796b !important;     /* Teal border */
}

.checkbox-label.selected input {
  background-color: #e0f7fa; /* Light cyan */
  border: 0px solid black;
}

/* Remove default margin from checkbox */
.checkbox-label input[type="checkbox"] {
  margin-right: 8px;
}

/* Smaller width for small-number inputs */
input.small-number {
  width: 40px;
  margin-right: 0;
  text-align: center;
  padding: 5px;
}

input.medium-number {
  width: 70px;
  margin: 0 5px;
  text-align: center;
  padding: 5px;
}

.icon-line {
  position: relative;
  top: 10px;
  margin-right: 10px;
}

.tips {
  color: #444;
  font-weight: 400;
}

.token-random-choice {
  margin: 0 auto 20px;
  width: 400px;
  max-width: 400px;
}

.setting-section {
  margin-bottom: 30px;
}

.edit-button {
  padding: 5px;
  border-radius: 5px;
  border: 1px solid #000;
  margin: 0 auto;
  display: block;
  user-select: none; /* Standard syntax */
  -webkit-user-select: none; /* Safari */
  -moz-user-select: none; /* Old Firefox */
  -ms-user-select: none; /* Internet Explorer/Edge */
}

.edit-button:hover {
  background-color: #ccc;
}

.decimals {
  display: block;
  margin: 0 auto;
}

.checkbox-label .delete {
  display: none;
  width: 20px;
}

.checkbox-label:hover .delete {
  width: 15px;
  height: 15px;
  display: inline-block;
  position: relative;
  top: 3px;
}

.checkbox-label.edit-label input {
  border: 0px solid;
}

.checkbox-label.edit-label {
  border: 1px solid black;
}
.checkbox-label .compensate-delete {
  display: block;
  width: 20px;
}
.checkbox-label:hover .compensate-delete {
  display: none;
}

.center {
  display: block;
  margin: 0 auto;
}
.edit-label .line {
  display: block;
  width: 100%;
  margin-bottom: 5px;
  margin: 0 auto;
}

.edit-label .line:last-child input {
  max-width: 125px;
}
.edit-label .line:last-child {
  margin-bottom: 0;
}

.edit-label input {
  margin-left: 5px;
}

.line span {
  margin-right: 5px;
}

.bold {
  font-weight: 600;
}

input.token-name {
  width: 100px;
}
</style>