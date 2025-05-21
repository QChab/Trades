<template>
  <div class="manual-trading">
    <h3>Manual trading</h3>

    <!-- Token selection list -->
    <div class="form-group">
      <button @click="isEditingTokens = !isEditingTokens" class="edit-button">
        {{ isEditingTokens ? 'Stop editing' : 'Edit tokens' }}
      </button>
      <div>
        <div v-if="!isEditingTokens">
          <div class="from-swap">
            <p>
              Sell
            </p>
            <div class="amount-token">
              <input type="tel"/>
              <select id="from-token" v-model="fromTokenAddress">
                <option 
                  v-for="(token, index) in tokens.filter((token) => token.symbol !== '' && token.address !== '' )"
                  :key="'fromToken-' + index" 
                  :value="token.address"
                >
                  {{ token.symbol }}
                </option>
              </select>
            </div>
          </div>
          <div class="to-swap">
            <p>
              Buy 
            </p>
            <div class="amount-token">
              <input type="tel"/>
              <select id="to-token" v-model="toTokenAddress">
                <option 
                  v-for="(token, index) in tokens.filter((token) => token.symbol !== '' && token.address !== '' )"
                  :key="'toToken-' + index" 
                  :value="token.address"
                >
                  {{ token.symbol }}
                </option>
              </select>
            </div>
          </div>
          <button @click="" class="swap-button">
            Swap
          </button>
        </div>
        <!-- EDITING -->
        <div v-else>
          <p class="text-center">Editing Tokens</p>
          <ul class="two-column-list">
            <li v-for="(token, index) in tokens" :key="index">
              <label class="checkbox-label edit-label">
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
      </div>
    </div>
  </div>
</template>

<script>
import { ref, reactive, watch, onMounted } from 'vue';
import chevronDownImage from '@/../assets/chevron-down.svg';
import deleteImage from '@/../assets/delete.svg';
import { isAddress, Contract } from 'ethers';
import provider from '@/ethersProvider';
import { useUniswapV4 } from '../composables/useUniswap';

export default {
  name: 'ManualTrading',
  components: {
  },
  props: {
    isProcessRunning: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:settings'],
  setup(props, { emit } ) {
    const { findAndSelectBestPath } = useUniswapV4();

    const isEditingTokens = ref(false);
    const fromTokenAddress = ref(null);
    const toTokenAddress = ref(null);

    // Token selection list with on/off toggles.
    const tokens = reactive([
      { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT'},
      { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', symbol: 'WETH'},
      { address: '', symbol: ''},
      { address: '', symbol: ''},
      { address: '', symbol: ''},
      { address: '', symbol: ''},
      { address: '', symbol: ''},
      { address: '', symbol: ''},
      { address: '', symbol: ''},
      { address: '', symbol: ''},
      { address: '', symbol: ''},
      { address: '', symbol: ''},
      { address: '', symbol: ''},
      { address: '', symbol: ''},
      { address: '', symbol: ''},
      { address: '', symbol: ''},
      { address: '', symbol: ''},
      { address: '', symbol: ''},
      { address: '', symbol: ''},
      { address: '', symbol: ''},
    ]);

    watch(() => tokens, (tokensValue) => {
      if (!fromTokenAddress.value) fromTokenAddress.value = tokensValue[0].address;
      if (!toTokenAddress.value) toTokenAddress.value = tokensValue[1].address;
      setTimeout( async () => {
        console.log(await findAndSelectBestPath(fromTokenAddress.value, toTokenAddress.value, 100));
      }, 5000)
    }, {immediate: true});

    const emitSettings = () => {
      const settings = {
        tokens: tokens.filter((token) => token.symbol && token.address && isAddress(token.address)).map((token) => ({...token})),
      };

      emit('update:settings', settings);
      
      settings.tokens = [...tokens];
      window.electronAPI.saveSettings(JSON.parse(JSON.stringify(settings)));
    };

    onMounted(async () => {
      const settings = await window.electronAPI.loadSettings();
      if (settings) {
        if (settings.tokens) {
          for (let i = 0 ; i < settings.tokens.length ; i++ ) {
            if (settings.tokens[i]?.address?.length && settings.tokens[i]?.symbol?.length)
              tokens[i] = settings.tokens[i];
          }
        }
      }
      emitSettings();
    });

    watch(tokens, () => emitSettings(), {deep: true});

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
      try {
        if (isAddress(contractAddress))
          tokens[index].symbol = await getTokenSymbol(contractAddress);
        else
          null;
          // TODO: throw error
        if (!tokens[index].symbol)
          tokens[index].symbol = '';

      } catch (err) {
        console.error(err);
        tokens[index].symbol = '';
      }
    };

    const deleteToken = (index) => {
      const token = tokens[index];
      token.address = '';
      token.symbol = '';
    };

    return {
      tokens,
      chevronDownImage,
      deleteImage,
      isEditingTokens,
      isAddress,
      findSymbol,
      deleteToken,
      fromTokenAddress,
      toTokenAddress,
    };
  }
};
</script>

<style scoped>
.manual-trading {
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
  margin: 20px auto;
  display: block;
  user-select: none; /* Standard syntax */
  -webkit-user-select: none; /* Safari */
  -moz-user-select: none; /* Old Firefox */
  -ms-user-select: none; /* Internet Explorer/Edge */
}

.swap-button {
  padding: 5px;
  border-radius: 5px;
  border: 1px solid #000;
  margin: 5px auto;
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

.from-swap, .to-swap {
  background-color: #999;
  border-radius: 5px;
  padding: 5px;
  max-width: 300px;
  margin-left: auto;
  margin-right: auto;
  border: 1px solid black;
  margin-bottom: 2px;
}

.from-swap p, .to-swap p {
  margin: 0;
  font-weight: 400;
}
.from-swap input, .to-swap input {
  background-color: #aaa;
  width: 150px;
  border: none;
  text-align: center;
  padding: 5px;
}
.from-swap select, .to-swap select {
  background-color: #aaa;
  width: 100px;
  text-align: center;
  padding: 5px;
  border: none;
  margin-left: 5px;
  font-weight: 700;
}
.amount-token {
  display: block;
  margin-left: auto;
  margin-right: auto;
  width: 270px;
}
</style>