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
              <div :class="{active: tabOrder === 'market'}" @click="tabOrder = 'market'">Market order</div>
              <!-- <div :class="{active: tabOrder === 'limit'}" @click="tabOrder = 'limit'">Limit order</div> -->
            </div>
            <div v-if="tabOrder === 'limit'">
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
              <input   
                v-model.number="fromAmount"
                type="number"
                inputmode="decimal"
                step="any"
                placeholder="0"
              />
              <select id="from-token" v-model="fromTokenAddress">
                <option 
                  v-for="(token, index) in tokens.filter((token) => token.symbol && token.address && token.decimals && token.symbol !== '' && token.address !== '' )"
                  :key="'fromToken-' + index" 
                  :value="token.address"
                >
                  {{ token.symbol }} ({{ computedBalancesByAddress[senderDetails?.address] && computedBalancesByAddress[senderDetails.address][token.address] ? computedBalancesByAddress[senderDetails.address][token.address].toFixed(5) : 0 }})
                </option>
              </select>
            </div>
            <span v-if="fromAmount" class="usd-amount">${{ spaceThousands((fromAmount * tokensByAddresses[fromTokenAddress].price).toFixed(1))  }}</span>
          </div>
          <div class="to-swap">
            <img :src="downArrowImage" class="down-arrow-image" @click="switchTokens"/>
            <p>
              Buy 
            </p>
            <div class="amount-token">
              <span class="amount-out" :class="{'fetching-price': isFetchingPrice}"> {{ spaceThousands(trade?.toAmount) }}</span>
              <select id="to-token" v-model="toTokenAddress">
                <option 
                  v-for="(token, index) in tokens.filter((token) => token.symbol && token.address && token.decimals && token.symbol !== '' && token.address !== '' )"
                  :key="'toToken-' + index" 
                  :value="token.address"
                >
                  {{ token.symbol }} ${{ token.price.toFixed(5) }}
                </option>
              </select>
            </div>
            <span v-if="trade?.toAmount && !isFetchingPrice" class="usd-amount">
              <span v-if="tokensByAddresses[toTokenAddress].price">
                ${{ spaceThousands((Number(trade.toAmount) * tokensByAddresses[toTokenAddress].price).toFixed(1)) }}
              </span>
              <span v-if="tokensByAddresses[fromTokenAddress].price && tokensByAddresses[toTokenAddress].price">
                ({{ -((fromAmount * tokensByAddresses[fromTokenAddress].price -Number(trade.toAmount) * tokensByAddresses[toTokenAddress].price) * 100 / (fromAmount * tokensByAddresses[fromTokenAddress].price)).toFixed(3) }}%)
              </span>
            </span>
          </div>
          <p class="details-message">{{ priceFetchingMessage }}</p>
          <div class="address-form">
            <p v-if="trade?.swap">{{ trade?.swap?.swaps?.length }} trade </p> 
            <p>with</p>
            <select id="sender-address" v-model="senderDetails">
              <option v-for="(address, index) in addresses" :value="address" :key="'sender-' + address.address">
                {{ address.name }} -  0x{{ address?.address.substring(2, 6) }}:
                {{ computedBalancesByAddress[address.address] && computedBalancesByAddress[address.address][fromTokenAddress] ? computedBalancesByAddress[address.address][fromTokenAddress].toFixed(5) : 0 }} {{ tokensByAddresses[fromTokenAddress].symbol }}
              </option>
            </select>
          </div>
          <p class="details-message">{{ swapMessage }}</p>
          <button v-if="!needsToApprove" @click="triggerTrade()" :disabled="isSwapButtonDisabled || isFetchingPrice || maxGasPrice < gasPrice || !trade?.swap" class="swap-button">
            {{ isSwapButtonDisabled && trade?.swap && isFetchingPrice ? 'Swapping...' : 'Swap' }}
          </button>
          <button v-else @click="approveSpending()" :disabled="isSwapButtonDisabled || isFetchingPrice || maxGasPrice < gasPrice || !trade?.swap" class="swap-button">
            {{ (isSwapButtonDisabled && trade.swap) ? ('Approving ' + tokensByAddresses[fromTokenAddress]?.symbol) : 'Approve' }}
          </button>
        </div>
        <!-- EDITING -->
        <div v-else>
          <p class="text-center">Editing Tokens</p>
          <ul class="two-column-list">
            <li v-for="(token, index) in tokens" :key="index">
              <span v-if="token.symbol === 'ETH'">ETH</span>
              <label v-else class="checkbox-label edit-label">
                <!-- First line: Token address and delete icon -->
                <div class="line">
                  <input v-model="token.address" @input="findSymbol(index, token.address)" placeholder="Address" />
                  <img :src="deleteImage" class="delete" @click="deleteToken(index)"/>
                  <div class="compensate-delete"></div>
                </div>
              </label>
              <div v-if="token.address">
                <label>
                  <!-- Second line: Token symbol -->
                  <div class="line">
                    <span>Symbol:</span>
                    <span v-if="token.symbol === 'ETH'">ETH</span>
                    <input v-else v-model="token.symbol" placeholder="Token Name" class="token-name" />
                  </div>
                </label>
                <label>
                  <div class="line">
                    <span>Decimals: {{ token.decimals }}</span>
                  </div>
                </label>
                <label>
                  <div class="line">
                    <span>Price: ${{ token.price.toFixed(5) }}</span>
                  </div>
                </label>
              </div>
            </li>
          </ul>
        </div>
      </div>
      <p v-if="trade && trade.txId === 'pending' && !trade.isConfirmed && swapMessage === ''">
        Swapping
        {{ trade.fromAmount }} {{ trade.fromTokenName || trade.fromToken?.symbol }} -> {{ trade.toAmount }} {{ trade.toTokenName || trade.toToken?.symbol }}
        from {{ trade.fromAddress || trade.sender?.name }} on {{ (new Date(trade.sentDate || trade.timestamp)).toLocaleString() }} ...
      </p>
      <!-- <div class="trades">
        Pending trades
        <ul>
          <li v-for="t in trades">
            {{ t.isConfirmed || !t.sender ? '✅' : '⏳' }}
            {{ t.fromAmount }} {{ t.fromTokenName || t.fromToken?.symbol }} -> {{ t.toAmount }} {{ t.toTokenName || t.toToken?.symbol }}
            from {{ t.fromAddress || t.sender?.name }} on {{ (new Date(t.sentDate || t.timestamp)).toLocaleString() }}
          </li>
        </ul>
      </div> -->
    </div>
  </div>
</template>

<script>
import { ref, reactive, watch, onMounted, toRaw, computed } from 'vue';
import chevronDownImage from '@/../assets/chevron-down.svg';
import reverseImage from '@/../assets/reverse.svg';
import downArrowImage from '@/../assets/down-arrow.svg';
import deleteImage from '@/../assets/delete.svg';
import { Contract, ethers, BigNumber } from 'ethers';
import { useUniswapV4 } from '../composables/useUniswap';
import { Percent } from '@uniswap/sdk-core';
import spaceThousands from '../composables/spaceThousands';

export default {
  name: 'ManualTrading',
  components: {
  },
  props: {
    addresses: {
      type: Array,
      default: () => ([]),
    },
    gasPrice: {
      type: Number,
      default: 2000000000,
    },
    maxGasPrice: {
      type: Number,
      default: 2000000000,
    },
    ethPrice: {
      type: Number,
    },
    provider: {
      type: Object,
    },
    confirmedTrade: {
      type: Object,
    }
  },
  emits: ['update:settings', 'update:trade', 'refreshBalance'],
  setup(props, { emit } ) {
    const PERMIT2_UNISWAPV4_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
    const PERMIT2_ABI = [
      "function allowance(address owner, address token, address spender) view returns (uint160, uint48, uint48)",
    ];

    const UNIVERSAL_ROUTER_ADDRESS = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af';

    const {
      findAndSelectBestPath,
      executeSwapExactIn,
    } = useUniswapV4();
    const trade = ref();
    const trades = ref([]);

    const isEditingTokens = ref(false);
    const fromAmount = ref(null);
    const fromTokenAddress = ref(null);
    const toTokenAddress = ref(null);
    const senderDetails = ref(null);
    const tabOrder = ref('market');
    const isSwapButtonDisabled = ref(false);
    const needsToApprove = ref(false);
    const slippage = ref(50);

    // Token selection list with on/off toggles.
    const tokens = reactive([
      { price: 0, address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18},
      { price: 0, address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT', decimals: 6},
      { price: 0, address: '0x514910771af9ca656af840dff83e8264ecf986ca', symbol: 'LINK', decimals: 18},
      { price: 0, address: '', symbol: '', decimals: null},
      { price: 0, address: '', symbol: '', decimals: null},
      { price: 0, address: '', symbol: '', decimals: null},
      { price: 0, address: '', symbol: '', decimals: null},
      { price: 0, address: '', symbol: '', decimals: null},
      { price: 0, address: '', symbol: '', decimals: null},
      { price: 0, address: '', symbol: '', decimals: null},
      { price: 0, address: '', symbol: '', decimals: null},
      { price: 0, address: '', symbol: '', decimals: null},
      { price: 0, address: '', symbol: '', decimals: null},
      { price: 0, address: '', symbol: '', decimals: null},
      { price: 0, address: '', symbol: '', decimals: null},
      { price: 0, address: '', symbol: '', decimals: null},
      { price: 0, address: '', symbol: '', decimals: null},
      { price: 0, address: '', symbol: '', decimals: null},
      { price: 0, address: '', symbol: '', decimals: null},
      { price: 0, address: '', symbol: '', decimals: null},
    ]);

    const balanceOffsetByTokenByAddress = reactive({});

    watch(() => props.confirmedTrade, (confirmedTradeValue) => {
      console.log('CONFIRMED TRADE VALUUUUUE')
      console.log(confirmedTradeValue)
      const sender = confirmedTradeValue?.sender?.address;
      const tokenAddress = confirmedTradeValue?.fromToken?.address;

      if (!sender || !tokenAddress) return
      if (!balanceOffsetByTokenByAddress[tokenAddress]) return
      if (!balanceOffsetByTokenByAddress[tokenAddress][sender]) return

      if (balanceOffsetByTokenByAddress[tokenAddress][sender] >= Number(confirmedTradeValue.fromAmount))
        balanceOffsetByTokenByAddress[tokenAddress][sender] -= Number(confirmedTradeValue.fromAmount);
    });

    const computedBalancesByAddress = computed(() => {
      let computedBalances = {};
      for (const detail of props.addresses) {
        if (!computedBalances[detail.address.toLowerCase()]) computedBalances[detail.address.toLowerCase()] = {}
        
        if (!detail.balances) continue;
        for (const tokenAddress in detail.balances) {
          computedBalances[detail.address.toLowerCase()][tokenAddress] = detail.balances[tokenAddress];
          if (balanceOffsetByTokenByAddress[tokenAddress] && balanceOffsetByTokenByAddress[tokenAddress][detail.address.toLowerCase()])
            computedBalances[detail.address.toLowerCase()][tokenAddress] -= balanceOffsetByTokenByAddress[tokenAddress][detail.address.toLowerCase()];
        }
      }
      return computedBalances;
    })

    const ERC20_ABI = [
      "function symbol() view returns (string)",
      "function decimals() view returns (uint256)",
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address owner, address spender) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
    ];

    const tokensByAddresses = ref({});
    const isFetchingPrice = ref(false);
    const priceFetchingMessage = ref('');

    let debounceTimer = null;
    watch(
      [() => fromTokenAddress.value, () => toTokenAddress.value, () => fromAmount.value, () => trades.value, () => senderDetails.value], 
      async ([fromTokenAddressValue, toTokenAddressValue, fromAmountValue], [oldFromTokenAddressValue, oldToTokenAddressValue]) => {
         if (debounceTimer) {
          clearTimeout(debounceTimer)
        }
        
        priceFetchingMessage.value = '';
        swapMessage.value = '';

        if (!fromAmountValue || !fromTokenAddressValue || !toTokenAddressValue || fromAmountValue === '.') {
          if (trade.value)
            trade.value.toAmount = 0;
          isFetchingPrice.value = false;
          return;
        }
        if (oldFromTokenAddressValue !== fromTokenAddressValue || oldToTokenAddressValue !== toTokenAddressValue) {
          trade.value = {
            toAmount: 0
          };
          needsToApprove.value = false;
        }
        isFetchingPrice.value = true;      
        debounceTimer = setTimeout(async () => {
          try {
            if (!senderDetails.value?.address) 
              throw new Error('No wallet selected');

            priceFetchingMessage.value = '';
            const fromAmount = ethers.utils.parseUnits(fromAmountValue + '', tokensByAddresses.value[fromTokenAddressValue].decimals);
            const bestTrade = await findAndSelectBestPath(
              tokensByAddresses.value[fromTokenAddressValue],
              tokensByAddresses.value[toTokenAddressValue],
              fromAmount
            );
            isSwapButtonDisabled.value = false;
            console.log(bestTrade)
            if (!bestTrade || !bestTrade.minimumAmountOut)
              throw new Error('No output amount found')

            // SECURITY TO AVOID SETTING TRADE OF CALCULATIONS FOR PREVIOUS TOKEN PAIR
            if (bestTrade?.swaps[0]?.outputAmount?.currency?.address.toLowerCase() !== toTokenAddress.value.toLowerCase()) {
              console.log('outdated to token')
              isSwapButtonDisabled.value = false;
              return;
            }
            if (bestTrade?.swaps[0]?.inputAmount?.currency?.address.toLowerCase() !== fromTokenAddress.value.toLowerCase()) {
              console.log('outdated from token')
              isSwapButtonDisabled.value = false;
              return;
            }
            // SECURITY TO AVOID SETTING TRADE OF CALCULATIONS FOR PREVIOUS FROM AMOUNT
            if (bestTrade?.swaps[0]?.inputAmount.toString() !== fromAmount.value.toLowerCase()) {
              console.log('outdated input amount')
              isSwapButtonDisabled.value = false;
              return;
            }

            trade.value = {
              swap: bestTrade,
              fromToken: tokensByAddresses.value[fromTokenAddressValue],
              toToken: tokensByAddresses.value[toTokenAddressValue],
              fromAmount: fromAmountValue + '',
              toAmount: bestTrade?.outputAmount?.toSignificant(5),
              // toAmount: bestTrade.minimumAmountOut(slippagePercent),
            }

            if (trade.value.fromToken.address !== '0x0000000000000000000000000000000000000000') {
              const erc20 = new ethers.Contract(
                fromTokenAddressValue,
                ERC20_ABI,
                toRaw(props.provider),
              );
              let rawAllowance = await erc20.allowance(senderDetails.value.address, PERMIT2_UNISWAPV4_ADDRESS);
              
              if (Number(rawAllowance) === 0 || Number(rawAllowance) < 1e27) {
                console.log(Number(rawAllowance));
                needsToApprove.value = true;
              } else {
                const PERMIT2_CONTRACT = new ethers.Contract(
                  PERMIT2_UNISWAPV4_ADDRESS,
                  PERMIT2_ABI,
                  toRaw(props.provider),
                )
                let results = await PERMIT2_CONTRACT.allowance(senderDetails.value.address, fromTokenAddressValue, UNIVERSAL_ROUTER_ADDRESS);
                if (!results || !results[0] || results[0]?.toString() === '0' || Number(results[0].toString()) < 1e27) {
                  console.log(Number[results[0].toString()])
                  needsToApprove.value = true;
                }
                console.log(results);
              }
            }

          } catch (err) {
            isSwapButtonDisabled.value = true;
            if (err.toString().includes('fractional component exceeds decimals')) {
              priceFetchingMessage.value = 'Error: Too much decimals in the input amount';
            } else
              priceFetchingMessage.value = err;
            needsToApprove.value = false;
            console.error(err);
          }
          isFetchingPrice.value = false;
        }, 500);
      }
    )

    const API_KEY                    = '85a93cb8cc32fa52390e51a09125a6fc';
    const SUBGRAPH_ID                = 'DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G';
    const SUBGRAPH_URL               = `https://gateway.thegraph.com/api/${API_KEY}/subgraphs/id/${SUBGRAPH_ID}`;

    async function tokenUsd (tokenAddr, ethUsd) {
      if (!tokenAddr) return 0;

      if (tokenAddr === '0x0000000000000000000000000000000000000000')
        return ethUsd;

      if (tokenAddr.toLowerCase() === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
        return 1;
      if (tokenAddr.toLowerCase() === '0xdac17f958d2ee523a2206206994597c13d831ec7')
        return 1;

      const qry = `
        query ($id: String!) {
          token(id: $id) { derivedETH }
        }`;
      const body = JSON.stringify({ query: qry, variables: { id: tokenAddr.toLowerCase() } });

      const { data } = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body
      }).then(r => r.json());

      console.log(tokenAddr, data?.token)
      // token not found ⇢ return 0
      const derivedEth = data?.token?.derivedETH
        ? Number(data.token.derivedETH)
        : 0;

      return derivedEth * ethUsd;          // USD price
    }

    const setTokenPrices = async (tokenArray) => {
      if (!tokens) return;
      for (const token of tokenArray) {
        console.log('fetching price of ' + token.symbol)
        token.price = await tokenUsd(token.address, props.ethPrice)
      }
    }

    // setAllTokenPrices();
    watch(() => props.ethPrice, setTokenPrices(tokens));
    setInterval(() => setTokenPrices(tokens), 180000);
  

    watch(() => tokens, async (tokensValue) => {
      if (!tokensValue) return;
      if (!fromTokenAddress.value) fromTokenAddress.value = tokensValue[0].address;
      if (!toTokenAddress.value) toTokenAddress.value = tokensValue[1].address;

      tokensByAddresses.value = {};
      for (const token of tokensValue) {
        tokensByAddresses.value[token.address] = token;
      }
    }, {immediate: true, deep: true});

    const emitSettings = () => {
      const settings = {
        tokens: tokens.filter((token) => token.symbol && token.address && (ethers.utils.isAddress(token.address) || token.address === '0x0000000000000000000000000000000000000000')).map((token) => ({...token})),
      };

      emit('update:settings', settings);
      
      settings.tokens = [...tokens];
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
    });

    watch(() => tokens, () => emitSettings(), {deep: true});
    watch(() => fromTokenAddress.value, (fromTokenAddressValue, oldFromTokenAddressValue) => {
      if (toTokenAddress.value === fromTokenAddressValue) {
        toTokenAddress.value = oldFromTokenAddressValue
      }
      emit('refreshBalance', senderDetails.value, tokensByAddresses.value[fromTokenAddressValue]);
    })
    watch(() => toTokenAddress.value, (toTokenAddressValue, oldToTokenAddressValue) => {
      if (fromTokenAddress.value === toTokenAddressValue) {
        fromTokenAddress.value = oldToTokenAddressValue
      }
      emit('refreshBalance', senderDetails.value, tokensByAddresses.value[toTokenAddressValue]);
    })
    watch(() => props.addresses, (addressesValue) => {
      if (addressesValue && addressesValue[0])
        senderDetails.value = addressesValue[0];
    }, {immediate: true})

    watch(() => senderDetails.value, (senderDetailsValue) => {
      if (!senderDetailsValue) isSwapButtonDisabled.value = true;
      else needsToApprove.value = false;
    }, {immediate: true})

    const getTokenSymbol = async (contractAddress) => {
      // Create a Contract instance pointing to your ERC20
      const contract = new Contract(contractAddress, ERC20_ABI, toRaw(props.provider));
      
      // Call the 'symbol()' method
      const symbol = await contract.symbol();
      console.log("ERC20 Symbol:", symbol);
      return symbol;
    };

    const getTokenDecimals = async (contractAddress) => {
      // Create a Contract instance pointing to your ERC20
      const contract = new Contract(contractAddress, ERC20_ABI, toRaw(props.provider));
      
      // Call the 'symbol()' method
      let decimals = await contract.decimals();
      if (!decimals) return 0;

      console.log("ERC20 decimals:", decimals);
      return Number(decimals.toString());
    };

    const findSymbol = async (index, contractAddress) => {
      try {
        if (contractAddress === '0x0000000000000000000000000000000000000000') {
          tokens[index].decimals = 18;
          tokens[index].symbol = 'ETH';
        } else if (ethers.utils.isAddress(contractAddress)) {
          tokens[index].decimals = await getTokenDecimals(contractAddress);
          tokens[index].symbol = await getTokenSymbol(contractAddress);
          tokens[index].price = await tokenUsd(contractAddress, props.ethPrice);
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
      if (trade.value?.toAmount) {
        [fromAmount.value, trade.value.toAmount] = [trade.value.toAmount, fromAmount.value];
      }
    }

    const shouldSwitchTokensForLimit = ref(false);

    const swapMessage = ref('');
    const triggerTrade = async () => {
      try {
        isSwapButtonDisabled.value = true;
        swapMessage.value = '';
        trade.value.sender = senderDetails.value;
        trade.value.sentDate = new Date();
        trade.value.txId = 'pending';

        if (fromTokenAddress.value === '0x0000000000000000000000000000000000000000') {
          if (!senderDetails.value.balances || !senderDetails.value.balances[fromTokenAddress.value])
            throw new Error('Insufficient ETH balance on ' + senderDetails.value.address)
          if ((computedBalancesByAddress.value[senderDetails.value.address][fromTokenAddress.value] - fromAmount.value) < .004)
            throw new Error('You must keep more ETH for gas cost on ' + senderDetails.value.address)
        }

        const {success, tx, warnings, error} = await executeSwapExactIn(trade.value, senderDetails.value, 50, props.gasPrice);
        if (!success || !tx) {
          if (error)
            console.error(error)

          trade.value.sender = null;
          trade.value.sentDate = null;
          trade.value.txId = null;
          if (error.toString().includes('insufficient funds for intrinsic transaction cost'))
            swapMessage.value = 'Error: Not enough ETH on the address';
          else if (error.toString().includes('cannot estimate gas; transaction may fail or may require manual gas limit'))
            swapMessage.value = 'Error: Preventing failed swap';
          else
            swapMessage.value = error;

          if (warnings && warnings.length)
            swapMessage.value += '    | Warnings: ' + warnings.join(' ; ')
          console.log({success, tx, warnings});
          return false;
        }

        if (!balanceOffsetByTokenByAddress[fromTokenAddress.value]) 
          balanceOffsetByTokenByAddress[fromTokenAddress.value] = {}
        if (!balanceOffsetByTokenByAddress[fromTokenAddress.value][senderDetails.value.address])
          balanceOffsetByTokenByAddress[fromTokenAddress.value][senderDetails.value.address] = 0
        
        balanceOffsetByTokenByAddress[fromTokenAddress.value][senderDetails.value.address] += fromAmount.value;

        trade.value.expectedToAmount = trade.value.toAmount;
        trade.value.txId = tx?.hash;
        emit('update:trade', trade.value);
      } catch (err) {
        swapMessage.value = err;
        console.error(err);
      }
      isSwapButtonDisabled.value = false;
    }

    const approveSpending = async () => {
      try {
        isSwapButtonDisabled.value = true;
        const originalAddress = senderDetails.value.address;
        const {success, error } = await window.electronAPI.approveSpender(
          originalAddress,
          fromTokenAddress.value,
          PERMIT2_UNISWAPV4_ADDRESS,
          props.gasPrice
        );

        if (!success) {
          throw error;
        }
        
        let allowance = 0;
        while (allowance = 0 && originalAddress === senderDetails.value.address) {
          const erc20 = new ethers.Contract(
            fromTokenAddress.value,
            ERC20_ABI,
            toRaw(props.provider),
          );
          allowance = Number(await erc20.allowance(originalAddress, PERMIT2_UNISWAPV4_ADDRESS));
          console.log(allowance)
          if (!allowance) await new Promise(r => setTimeout(r, 2000))
        }
        const PERMIT2_CONTRACT = new ethers.Contract(
          PERMIT2_UNISWAPV4_ADDRESS,
          PERMIT2_ABI,
          toRaw(props.provider),
        )
        while (allowance = 0 && originalAddress === senderDetails.value.address) {
          let results = await PERMIT2_CONTRACT.allowance(originalAddress, fromTokenAddress.value, UNIVERSAL_ROUTER_ADDRESS);
          if (!results || !results[0] || results[0]?.toString() === '0' || Number(results[0].toString()) < 1e27) {
            await new Promise(r => setTimeout(r, 2000))
          }
          allowance = results[0];
        }
        needsToApprove.value = false;
      } catch (err) {
        console.error(err);
        if (err?.toString().includes('insufficient funds for intrinsic transaction cost'))
          swapMessage.value = 'Error: Not enough ETH on the address ' + originalAddress;
        else
          swapMessage.value = err;
      }
      isSwapButtonDisabled.value = false;
    }

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
      fromTokenAddress,
      toTokenAddress,
      senderDetails,
      tabOrder,
      tokensByAddresses,
      switchTokens,
      shouldSwitchTokensForLimit,
      trade,
      trades,
      triggerTrade,
      isFetchingPrice,
      isSwapButtonDisabled,
      priceFetchingMessage,
      swapMessage,
      needsToApprove,
      approveSpending,
      balanceOffsetByTokenByAddress,
      computedBalancesByAddress,
      spaceThousands,
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

.swap-button:disabled, .swap-button:disabled:hover {
  background-color: #85858b;
  opacity: 0.9;
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
  max-width: 380px;
  margin-left: auto;
  margin-right: auto;
  border: 1px solid #ccc;
  margin-bottom: 2px;
  transition: border 0.3s ease;
  padding-bottom: 15px;
  padding-left: 10px;
  height: 90px;
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
.from-swap input {
  background-color: #fff;
  width: 200px;
  border: none;
  text-align: left;
  padding: 10px;
  font-weight: 500;
  font-size: 23px;
  display: inline-block;
}
.to-swap span {
  background-color: #fff;
  width: 200px;
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
  width: 130px;
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
  width: 360px;
}
input:focus,
textarea:focus {
  outline: none;         /* kill the default focus ring (orange in Firefox/macOS) */
  box-shadow: none;      /* remove any built-in focus shadow */
}

select:focus {
  outline: none;
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

.fetching-price {
  background-color: #ddd !important;
}

.amount-out {
  height: 30px;
  display: inline-block;
  border-radius: 6px;
}

.details-message {
  text-align: center;
  width: 500px;
  margin-left: auto;
  margin-right: auto;
  display: block;
  word-break: break-all;
}

.usd-amount, .usd-amount span {
  font-size: 12px !important;
  color: #666;
  margin-left: 15px;
  display: inline-block;
  width: auto;
}
.usd-amount span {
  margin-left: 0;
  padding: 0;
  margin-right: 5px;
}
.amount-token input[type="number"] {
  margin-right: 0px !important;
}
.amount-token input[type="number"]::-webkit-inner-spin-button,
  .amount-token input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none;  /* removes the arrow styling */
  margin: 0;                 /* prevents a ghost 2 px margin in some cases */
}
</style>