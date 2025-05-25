<template>
  <div class="manual-trading">
    <!-- Token selection list -->
    <div class="form-group">
      <h3>Manual trade</h3>
      <button @click="isEditingTokens = !isEditingTokens" class="edit-button">
        {{ isEditingTokens ? 'Stop editing' : 'Edit tokens' }}
      </button>
      <div>
        <div v-if="!isEditingTokens">
          <div class="price-form">
            <div class="tabs-price">
              <div :class="{active: tabPrice === 'market'}" @click="tabPrice = 'market'">Market price</div>
              <div :class="{active: tabPrice === 'limit'}" @click="tabPrice = 'limit'">Set limit</div>
            </div>
            <div v-if="tabPrice === 'limit'">
              <p>
                when 1 {{ !shouldSwitchTokensForLimit ? tokensByAddresses[fromTokenAddress]?.symbol : tokensByAddresses[toTokenAddress]?.symbol }} = 
                <input v-model.number="priceLimit" placeholder="0"/> 
                {{ shouldSwitchTokensForLimit ? tokensByAddresses[fromTokenAddress]?.symbol : tokensByAddresses[toTokenAddress]?.symbol }}
                <img :src="reverseImage" class="reverse-image" @click="shouldSwitchTokensForLimit = !shouldSwitchTokensForLimit"/>
              </p>
            </div>
          </div>
          <div class="from-swap">
            <p>
              Sell
            </p>
            <div class="amount-token">
              <input type="tel" placeholder="0" v-model.number="fromAmount"/>
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
            <img :src="downArrowImage" class="down-arrow-image" @click="switchTokens"/>
            <p>
              Buy 
            </p>
            <div class="amount-token">
              <span> {{ toAmount }} </span>
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
          <div class="address-form">
            <p>with</p>
            <select id="sender-address" v-model="senderAddress">
              <option v-for="(address, index) in addresses" :value="address" :key="'sender-' + address.address">
                {{ address.name || address.address }}
              </option>
            </select>
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
import reverseImage from '@/../assets/reverse.svg';
import downArrowImage from '@/../assets/down-arrow.svg';
import deleteImage from '@/../assets/delete.svg';
import { Contract, ethers } from 'ethers';
import provider from '@/ethersProvider';
import { useUniswapV4 } from '../composables/useUniswap';
// import fetchV4Quote from '../composables/useUniswapWithoutGraph';

export default {
  name: 'ManualTrading',
  components: {
  },
  props: {
    isProcessRunning: {
      type: Boolean,
      default: false,
    },
    addresses: {
      type: Array,
      default: () => ([]),
    },
  },
  emits: ['update:settings'],
  setup(props, { emit } ) {
    const {
      findAndSelectBestPath,
      swapTokenForTokenV4,
      priceHistory
    } = useUniswapV4();
    // const { findBestPoolSingleHop } = useUniswapWithoutGraph();

    const isEditingTokens = ref(false);
    const fromAmount = ref(null);
    const fromTokenAddress = ref(null);
    const toTokenAddress = ref(null);
    const toAmount = ref(null);
    const senderAddress = ref(null);
    const tabPrice = ref('market');

    // Token selection list with on/off toggles.
    const tokens = reactive([
      { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18},
      { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT', decimals: 6},
      { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', symbol: 'WETH', decimals: 18},
      { address: '', symbol: '', decimals: null},
      { address: '', symbol: '', decimals: null},
      { address: '', symbol: '', decimals: null},
      { address: '', symbol: '', decimals: null},
      { address: '', symbol: '', decimals: null},
      { address: '', symbol: '', decimals: null},
      { address: '', symbol: '', decimals: null},
      { address: '', symbol: '', decimals: null},
      { address: '', symbol: '', decimals: null},
      { address: '', symbol: '', decimals: null},
      { address: '', symbol: '', decimals: null},
      { address: '', symbol: '', decimals: null},
      { address: '', symbol: '', decimals: null},
      { address: '', symbol: '', decimals: null},
      { address: '', symbol: '', decimals: null},
      { address: '', symbol: '', decimals: null},
      { address: '', symbol: '', decimals: null},
    ]);

    const tokensByAddresses = ref({});

    watch(() => tokens, (tokensValue) => {
      if (!fromTokenAddress.value) fromTokenAddress.value = tokensValue[0].address;
      if (!toTokenAddress.value) toTokenAddress.value = tokensValue[1].address;

      setTimeout( async () => {
        const decimalsA = tokensByAddresses.value[fromTokenAddress.value].decimals;
        const amountIn = ethers.utils.parseUnits('1', decimalsA);
        // console.log(await fetchV4Quote(fromTokenAddress.value, toTokenAddress.value, amountIn));
        console.log(await findAndSelectBestPath(tokensByAddresses.value[fromTokenAddress.value], tokensByAddresses.value[toTokenAddress.value], amountIn));
        console.log(priceHistory.value);
        // const bestPoolId = path[0].poolKey.poolIdHex; // if you extended getPoolKey to return poolIdHex
        // await swapTokenForTokenV4(bestPoolId, amountIn, amountOut, yourAddress);
      }, 1000)

      tokensByAddresses.value = {};
      for (const token of tokensValue) {
        tokensByAddresses.value[token.address] = token;
      }
    }, {immediate: true});

    const emitSettings = () => {
      const settings = {
        tokens: tokens.filter((token) => token.symbol && token.address && ethers.utils.isAddress(token.address)).map((token) => ({...token})),
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

    watch(() => tokens, () => emitSettings(), {deep: true});
    watch(() => fromTokenAddress.value, (fromTokenAddressValue, oldFromTokenAddressValue) => {
      if (toTokenAddress.value === fromTokenAddressValue) {
        toTokenAddress.value = oldFromTokenAddressValue
      }
    })
    watch(() => toTokenAddress.value, (toTokenAddressValue, oldToTokenAddressValue) => {
      if (fromTokenAddress.value === toTokenAddressValue) {
        fromTokenAddress.value = oldToTokenAddressValue
      }
    })
    watch(() => props.addresses, (addressesValue) => {
      senderAddress.value = props.addresses[0];
    }, {immediate: true})

    const erc20Abi = [
      "function symbol() view returns (string)",
      "function decimals() view returns (uint256)",
    ];

    const getTokenSymbol = async (contractAddress) => {
      // Create a Contract instance pointing to your ERC20
      const contract = new Contract(contractAddress, erc20Abi, provider);
      
      // Call the 'symbol()' method
      const symbol = await contract.symbol();
      console.log("ERC20 Symbol:", symbol);
      return symbol;
    };

    const getTokenDecimals = async (contractAddress) => {
      // Create a Contract instance pointing to your ERC20
      const contract = new Contract(contractAddress, erc20Abi, provider);
      
      // Call the 'symbol()' method
      const decimals = await contract.decimals();
      console.log("ERC20 decimals:", decimals);
      return decimals;
    };

    const findSymbol = async (index, contractAddress) => {
      try {
        if (ethers.utils.isAddress(contractAddress)) {
          tokens[index].decimals = await getTokenDecimals(contractAddress);
          tokens[index].symbol = await getTokenSymbol(contractAddress);
        } else
          null;
          // TODO: throw error
        if (!tokens[index].symbol)
          tokens[index].symbol = null;

      } catch (err) {
        console.error(err);
        tokens[index].symbol = null;
      }
    };

    const deleteToken = (index) => {
      const token = tokens[index];
      token.address = null;
      token.symbol = null;
      token.decimals = null;
    };

    const switchTokens = () => {
      let buffer = toTokenAddress.value;
      toTokenAddress.value = fromTokenAddress.value;
      fromTokenAddress.value = buffer;
      shouldSwitchTokensForLimit.value = !shouldSwitchTokensForLimit.value;
    }

    const shouldSwitchTokensForLimit = ref(false);

    return {
      tokens,
      chevronDownImage,
      deleteImage,
      reverseImage,
      downArrowImage,
      isEditingTokens,
      isAddress: ethers.utils.isAddress,
      findSymbol,
      deleteToken,
      fromAmount,
      toAmount,
      fromTokenAddress,
      toTokenAddress,
      senderAddress,
      tabPrice,
      tokensByAddresses,
      switchTokens,
      shouldSwitchTokensForLimit,
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
  display: flex;
  flex-direction: row;
  position: relative;
  padding-top: 40px;
}

.form-group {
  margin-bottom: 15px;
  width: 100%;
}
.address-form {
  width: 100%;
  margin-right: 100px;
}
.address-form p {
  text-align: center;
}
.address-form select {
  padding: 15px;
  font-size: 18px;
  border: 1px solid #ccc;
  border-radius: 8px;
  cursor: pointer;
  width: 450px;
  display: block;
  margin-left: auto;
  margin-right: auto;
  -webkit-box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  -moz-box-shadow:    0 2px 5px rgba(0, 0, 0, 0.2);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  margin-bottom: 50px;
  text-align: center;
}

input[type="number"] {
  width: 70px;
  margin-right: 10px;
}

p {
  font-weight: 500;
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
  cursor: pointer;
  padding: 5px;
  border-radius: 5px;
  border: 1px solid #acacac;
  margin: 20px auto;
  display: block;
  user-select: none; /* Standard syntax */
  -webkit-user-select: none; /* Safari */
  -moz-user-select: none; /* Old Firefox */
  -ms-user-select: none; /* Internet Explorer/Edge */
  position: absolute;
  right: 20px;
  top: 0px;
}

.swap-button {
  cursor: pointer;
  background-color: #333388;
  color: white;
  padding: 15px;
  border-radius: 5px;
  border: 1px solid #000;
  margin: 5px auto;
  display: block;
  user-select: none; /* Standard syntax */
  -webkit-user-select: none; /* Safari */
  -moz-user-select: none; /* Old Firefox */
  -ms-user-select: none; /* Internet Explorer/Edge */
  font-weight: 700;

  -webkit-box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  -moz-box-shadow:    0 2px 5px rgba(0, 0, 0, 0.2);
  box-shadow:         0 2px 5px rgba(0, 0, 0, 0.2);
  transition: box-shadow 0.3s ease, background-color 0.3s ease;
}
.swap-button:hover {
  -webkit-box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4);  /* slightly larger, darker */
  -moz-box-shadow:    0 4px 10px rgba(0, 0, 0, 0.4);
  box-shadow:         0 4px 10px rgba(0, 0, 0, 0.4);
}

.edit-button:hover {
  background-color: #ccc;
}
.swap-button:hover {
  background-color: #009;
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
  border-radius: 15px;
  padding: 5px;
  max-width: 300px;
  margin-left: auto;
  margin-right: auto;
  border: 1px solid #ccc;
  margin-bottom: 2px;
  transition: border 0.3s ease;
  padding-bottom: 15px;
  padding-left: 10px;
}
.to-swap {
  position: relative;
}
.from-swap:hover, .to-swap:hover {
  border: 1px solid #999;
}
.from-swap p, .to-swap p {
  margin: 0;
  font-weight: 400;
}
.from-swap input, .to-swap span {
  background-color: #fff;
  width: 150px;
  border: none;
  text-align: left;
  padding: 5px;
  font-weight: 500;
  font-size: 22px;
  display: inline-block;
}
.from-swap input:selected, .to-swap input:selected {
  border: 0px solid white;
}
.from-swap select, .to-swap select {
  border: 1px solid #ccc;
  width: 80px;
  text-align: center;
  padding: 5px;
  border: none;
  margin-left: 5px;
  font-weight: 700;
  border-radius: 8px;
  cursor: pointer;
  -webkit-box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  -moz-box-shadow:    0 2px 5px rgba(0, 0, 0, 0.2);
  box-shadow:         0 2px 5px rgba(0, 0, 0, 0.2);
  transition: box-shadow 0.3s ease, background-color 0.3s ease;
}
.from-swap select:hover,
.to-swap select:hover {
  -webkit-box-shadow: 0 4px 10px rgba(0, 0, 0, 0.25);  /* slightly larger, darker */
  -moz-box-shadow:    0 4px 10px rgba(0, 0, 0, 0.25);
  box-shadow:         0 4px 10px rgba(0, 0, 0, 0.25);
  background-color: #eee;
}
.amount-token {
  display: block;
  margin-left: auto;
  margin-right: auto;
  width: 270px;
}
input:focus,
textarea:focus,
select:focus {
  outline: none;         /* kill the default focus ring (orange in Firefox/macOS) */
  box-shadow: none;      /* remove any built-in focus shadow */
}

/* ============================================================================
   Firefox-specific: suppress its “focus ring” pseudoclass outline
   ============================================================================
*/
input:-moz-focusring,
textarea:-moz-focusring,
select:-moz-focusring {
  outline: none;         /* override Firefox’s orange glow on focus */
}

/* ============================================================================
   WebKit-specific: remove the inner focus border on buttons/inputs
   ============================================================================
*/
input::-webkit-focus-inner,
button::-webkit-focus-inner {
  border: 0;             /* strip the inner border WebKit adds on focus */
  padding: 0;            /* reset padding if that inner border was taking space */
}

.price-form {
  text-align: center;
  margin: 10px;
}
.price-form p {
  position: relative;
}
.price-form input {
  padding: 5px;
  border: none;
  font-size: 16px;
  border-radius: 5px;
  text-align: center;
  width: 120px;
  font-weight: 600;
}

.tabs-price {
  margin-top: 15px;
  display: flex;
  justify-content: space-around;
  width: 300px;
  align-content: center;
  margin-left: auto;
  margin-right: auto;
}

.tabs-price div {
  background-color: #b4bddf;
  width: 100px;
  margin-left: auto;
  margin-right: auto;
  border-radius: 8px;
  padding: 15px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  -webkit-box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  -moz-box-shadow:    0 2px 5px rgba(0, 0, 0, 0.2);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  font-weight: 500;
  font-family: Titillium Web, serif;
}
.tabs-price div:hover {
  background-color: #a0a9d0;
}
.tabs-price .active {
  background-color: #a0a9d0;
  font-weight: 600;
}

.reverse-image {
  width: 30px;
  display: inline-block;
  margin-left: 20px;
  cursor: pointer;
  margin-top: 10px;
  position: absolute;
  top: -11px;
}

.down-arrow-image {
  width: 30px;
  background-color: #f2f2f2;
  border-radius: 5px;
  border: 1px solid #ccc;
  top: -15px;
  left: 45%;
  position: absolute;
}
</style>