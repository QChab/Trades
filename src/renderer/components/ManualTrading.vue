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
              <div :class="{active: tabOrder === 'limit'}" @click="tabOrder = 'limit'">Limit order</div>
            </div>
            <div v-if="tabOrder === 'limit'">
              <p>
                when 1 {{ !shouldSwitchTokensForLimit ? tokensByAddresses[fromTokenAddress]?.symbol : tokensByAddresses[toTokenAddress]?.symbol }} = 
                <input v-model.number="priceLimit" placeholder="0"/> 
                {{ shouldSwitchTokensForLimit ? tokensByAddresses[fromTokenAddress]?.symbol : tokensByAddresses[toTokenAddress]?.symbol }}
                <span v-if="priceLimit && tokensByAddresses[fromTokenAddress]?.price && tokensByAddresses[toTokenAddress]?.price" class="usd-price-quote">
                  (${{ formatUsdPrice(priceLimit) }})
                </span>
                <img :src="reverseImage" class="reverse-image" @click="shouldSwitchTokensForLimit = !shouldSwitchTokensForLimit"/>
              </p>
              <span class="set-market-price" @click="setMarketPriceAsLimit">
                Set market price
              </span>
              
            </div>
            <div v-else class="checkboxes">
              <label>
                <input type="checkbox" v-model="shouldUseUniswap"/> Uniswap
              </label>
              <label>
                <input type="checkbox" v-model="shouldUseBalancer"/> Balancer
              </label>
              <label>
                <input type="checkbox" v-model="shouldUseUniswapAndBalancer"/> Uniswap & Balancer
              </label>
            </div>
          </div>
          <div class="from-swap">
            <p>Sell</p>
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
                  v-for="(token, index) in filteredTokens" 
                  :key="'fromToken-' + index" 
                  :value="token.address"
                >
                  {{ token.symbol }} ({{ balanceString(senderDetails?.address, token.address) }})
                </option>
              </select>
              <span class="right-price">
                @ ${{ spaceThousands(tokensByAddresses[fromTokenAddress]?.price.toFixed(5)) }}
              </span>
            </div>
            <span v-if="fromAmount" class="usd-amount">
              ${{ spaceThousands((fromAmount * tokensByAddresses[fromTokenAddress]?.price).toFixed(1)) }}
            </span>
          </div>

          <div class="to-swap">
            <img :src="downArrowImage" class="down-arrow-image" @click="switchTokens"/>
            <p>Buy</p>
            <div class="amount-token">
              <span class="amount-out" :class="{'fetching-price': isFetchingPrice}">
                {{ spaceThousands(tradeSummary.toAmount) }}
              </span>
              <select id="to-token" v-model="toTokenAddress">
                <option 
                  v-for="(token, index) in filteredTokens" 
                  :key="'toToken-' + index" 
                  :value="token.address"
                >
                  {{ token.symbol }} ({{ balanceString(senderDetails?.address, token.address) }})
                </option>
              </select>
            </div>
            <span v-if="tradeSummary.toAmount && !isFetchingPrice" class="usd-amount">
              <span v-if="tokensByAddresses[toTokenAddress]?.price">
                ${{ spaceThousands((Number(tradeSummary.toAmount) * tokensByAddresses[toTokenAddress].price).toFixed(1)) }}
              </span>
              <span v-if="tokensByAddresses[fromTokenAddress]?.price && tokensByAddresses[toTokenAddress]?.price">
                ({{ -((fromAmount * tokensByAddresses[fromTokenAddress].price - Number(tradeSummary.toAmount) * tokensByAddresses[toTokenAddress].price) * 100 / (fromAmount * tokensByAddresses[fromTokenAddress].price)).toFixed(2) }}%)
              </span>
            </span>
            <p class="right-price">
              @ ${{ spaceThousands(tokensByAddresses[toTokenAddress]?.price.toFixed(5)) }}
            </p>
          </div>

          <p class="details-message">{{ priceFetchingMessage }}</p>
          <div class="address-form">
            <p><span v-if="tradeSummary.protocol">
              On {{ tradeSummary.protocol === 'Uniswap & Balancer' ?  (`Uniswap ${tradeSummary.fraction}% & Balancer ${100 - tradeSummary.fraction}%`) : tradeSummary.protocol}}
            </span> with</p>
            <select id="sender-address" v-model="senderDetails">
              <option 
                v-for="(address, index) in addresses" 
                :value="address" 
                :key="'sender-' + address.address"
              >
                {{ address.name }} - 0x{{ address.address.substring(2, 6) }}:
                {{ balanceString(address.address, fromTokenAddress) }} {{ tokensByAddresses[fromTokenAddress]?.symbol }}
              </option>
            </select>
          </div>

          <p class="details-message">{{ swapMessage }}</p>
          <div v-if="tabOrder === 'market' && !isEditingTokens" class="swap-buttons">
            <div v-if="!needsToApprove">
              <p class="details-message" v-if="tradeSummary?.gasLimit">Gas cost ~ ${{ (tradeSummary.gasLimit * ethPrice * Number(gasPrice) * 1.1 / 1e18).toFixed(2) }}</p>
              <button
                v-if="!needsToApprove"
                @click="isSwapButtonDisabled=true; triggerTrade()"
                :disabled="isSwapButtonDisabled || isFetchingPrice || maxGasPrice < gasPrice || trades.length === 0"
                class="swap-button"
              >
                {{ (isSwapButtonDisabled && trades.length > 0 && !isFetchingPrice) ? 'Swapping...' : 'Swap' }}
              </button>
            </div>
            <div v-else>
              <p class="details-message">Gas cost ~ ${{ ((tradeSummary.protocol === 'Uniswap' ? 100000 : 50000) * ethPrice * Number(gasPrice) * 1.1 / 1e18).toFixed(2) }}</p>
              <button
                @click="approveSpending()"
                :disabled="isSwapButtonDisabled || isFetchingPrice || maxGasPrice < gasPrice || trades.length === 0"
                class="swap-button"
              >
                {{ (isSwapButtonDisabled && trades.length > 0) ? ('Approving ' + tokensByAddresses[fromTokenAddress]?.symbol) : 'Approve' }}
              </button>
            </div>
          </div>
          <div v-else>
            <div v-if="!needsToApprove">
              <button
                v-if="!needsToApprove"
                @click="placeLimitOrder()"
                :disabled="!priceLimit || !fromAmount || senderDetails?.address === ''"
                class="swap-button"
              >
                {{ 'Place order' }}
              </button>
            </div>
            <div v-else>
              <p class="details-message">Gas cost ~ ${{ (150000 * ethPrice * Number(gasPrice) * 1.1 / 1e18).toFixed(2) }}</p>
              <button
                @click="approveSpending()"
                :disabled="maxGasPrice < gasPrice"
                class="swap-button"
              >
                {{ (isSwapButtonDisabled && trades.length > 0) ? ('Approving ' + tokensByAddresses[fromTokenAddress]?.symbol) : 'Approve' }}
              </button>
            </div>
          </div>
        </div>

        <!-- EDITING TOKENS -->
        <div v-else>
          <p class="text-center">Editing Tokens</p>
          <ul class="two-column-list">
            <li v-for="(token, index) in tokens" :key="index">
              <span v-if="token.symbol === 'ETH'">ETH</span>
              <label v-else class="checkbox-label edit-label">
                <!-- First line: Token address and delete icon -->
                <div class="line">
                  <input
                    v-model="token.address"
                    @input="findSymbol(index, token.address)"
                    placeholder="Address"
                  />
                  <img :src="deleteImage" class="delete" @click="deleteToken(index)" />
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

      <p v-if="tradeSummary.txId === 'pending' && !tradeSummary.isConfirmed && swapMessage === ''">
        Swapping
        {{ tradeSummary.fromAmount }} {{ tradeSummary.fromTokenSymbol }} →
        {{ tradeSummary.toAmount }} {{ tradeSummary.toTokenSymbol }}
        from {{ tradeSummary.fromAddressName }} on
        {{ (new Date(tradeSummary.sentDate)).toLocaleString() }} …
      </p>
      
      <div v-if="pendingLimitOrders.length">
        <h4>Pending Limit Orders</h4>
        <ul>
          <li 
            v-for="order in pendingLimitOrders"
            :key="order.id"
            class="pending-order"
            :class="{'is-waiting-balance': order.isWaitingBalance}"
          >
            <div class="order-info">
              <div class="order-details">
                <div class="trade-info">
                  <span class="left">
                    <span class="order-type" :class="order.orderType">
                      {{ order.orderType === 'take_profit' ? '📈 Take Profit' : '📉 Stop Loss' }}
                    </span>
                    {{ order.fromAmount }} {{ order.fromToken.symbol }} → 
                    <span v-if="order.toAmount">{{ order.toAmount }} {{ order.toToken.symbol }}</span>
                    <span v-else>{{ order.toToken.symbol }}</span>
                  </span>
                  <span class="right">
                    Trigger {{ order.priceLimit }}
                    <span v-if="!order.shouldSwitchTokensForLimit">
                      {{ order.toToken.symbol }} / {{ order.fromToken.symbol }}
                    </span>
                    <span v-else>
                      {{ order.fromToken.symbol }} / {{ order.toToken.symbol }}
                    </span>
                  </span>
                </div>
                <div class="order-meta">
                  <span>
                    {{ order.createdAt ? new Date(order.createdAt).toLocaleString() : 'Unknown' }}
                    <span v-if="order.currentMarketPrice">
                      at ${{ order.currentMarketPrice.toFixed(5) }}
                    </span>
                  </span>
                  <span class="right">
                    From {{ order.sender?.name }}
                  </span>
                </div>
              </div>
            </div>
            <span class="cancel-order" @click="cancelLimitOrder(order.id)">❌ Cancel</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, reactive, watch, onMounted, computed, toRaw, onUnmounted } from 'vue';
import { ethers, BigNumber } from 'ethers';
import chevronDownImage from '@/../assets/chevron-down.svg';
import reverseImage from '@/../assets/reverse.svg';
import downArrowImage from '@/../assets/down-arrow.svg';
import deleteImage from '@/../assets/delete.svg';
import { useUniswapV4 } from '../composables/useUniswap';
import { useBalancerV3 } from '../composables/useBalancer';
import spaceThousands from '../composables/spaceThousands';

export default {
  name: 'ManualTrading',
  props: {
    addresses: { type: Array, default: () => ([]) },
    gasPrice:   { type: Number, default: 2000000000 },
    maxGasPrice:{ type: Number, default: 2000000000 },
    ethPrice:   { type: Number },
    provider:   { type: Object },
    confirmedTrade: { type: Object },
  },
  emits: ['update:settings', 'update:trade', 'refreshBalance'],
  setup(props, { emit }) {
    // ─── Constants & Composables ───────────────────────────────────────────
    const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
    const UNIVERSAL_ROUTER_ADDRESS   = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af';
    const BALANCER_VAULT_ADDRESS   = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
    const ERC20_ABI = [
      "function symbol() view returns (string)",
      "function decimals() view returns (uint256)",
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address owner, address spender) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
    ];
    const SUBGRAPH_URL = `https://gateway.thegraph.com/api/85a93cb8cc32fa52390e51a09125a6fc/subgraphs/id/DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G`;

    const {
      findPossiblePools,
      selectBestPath,
      executeMixedSwaps,
    } = useUniswapV4();

    const {
      findTradeBalancer,
    } = useBalancerV3();

    // ─── Reactive State ─────────────────────────────────────────────────────
    const isEditingTokens = ref(false);
    const fromAmount       = ref(null);
    const fromTokenAddress = ref(null);
    const toTokenAddress   = ref(null);
    const senderDetails    = ref(null);
    const tabOrder         = ref('market');
    const isSwapButtonDisabled = ref(false);
    const needsToApprove   = ref(false);
    const slippage         = ref(70);
    const shouldUseUniswap = ref(true);
    const shouldUseBalancer = ref(true);
    const shouldUseUniswapAndBalancer = ref(true);
    const priceLimit = ref(null);

    const tokens = reactive([
      { price: 0, address: ethers.constants.AddressZero, symbol: 'ETH', decimals: 18 },
      { price: 0, address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT', decimals: 6 },
      { price: 0, address: '0x514910771af9ca656af840dff83e8264ecf986ca', symbol: 'LINK', decimals: 18 },
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

    // Map of tokenAddress → { price, symbol, decimals }
    const tokensByAddresses = ref({});

    // Array of raw SDK‐Trade instances returned from findAndSelectBestPath
    const trades = ref([]); // each entry has .inputAmount, .outputAmount, .route, etc.

    // A small “summary” object for UI binding
    const tradeSummary = reactive({
      fromAmount:    null,    // string
      toAmount:      null,    // string (aggregated across all legs)
      fromTokenSymbol: null,
      toTokenSymbol:   null,
      fromAddressName: null,  // e.g. “Alice - 0xABCD”
      txId:          null,
      sentDate:      null,
      isConfirmed:   false,
      protocol: null,
      gasLimit: null,
      toAmountU: null,
      toAmountB: null,
      fromAmountU: null,
      fromAmountB: null,
    });

    const isFetchingPrice    = ref(false);
    const priceFetchingMessage = ref('');
    const swapMessage        = ref('');

    // We keep a small “offset” map so that once a trade is sent, we subtract it from balance
    const balanceOffsetByTokenByAddress = reactive({});
    
    const pendingLimitOrders = ref([]);
    const shouldSwitchTokensForLimit = ref(false);

    // ─── Computed Helpers ────────────────────────────────────────────────────

    // Filter out tokens without valid symbol/address
    const filteredTokens = computed(() =>
      tokens.filter(t => t.symbol && t.address && t.decimals != null && t.symbol !== '' && t.address !== '')
    );

    // Build a nested map: { [userAddress]: { [tokenAddress]: availableBalance } }
    const computedBalancesByAddress = computed(() => {
      const result = {};
      for (const detail of props.addresses) {
        const addr = detail.address.toLowerCase();
        if (!result[addr]) result[addr] = {};

        if (!detail.balances) continue;
        for (const tokAddr in detail.balances) {
          let bal = detail.balances[tokAddr];
          if (balanceOffsetByTokenByAddress[tokAddr.toLowerCase()] &&
              balanceOffsetByTokenByAddress[tokAddr.toLowerCase()][addr]) {
            bal -= balanceOffsetByTokenByAddress[tokAddr.toLowerCase()][addr];
          }
          result[addr][tokAddr.toLowerCase()] = bal;
        }
      }
      return result;
    });

    // Helper: “5.12345” → formatted string with spaces every 3 digits
    const spaceThousandsFn = (str) => spaceThousands(str);

    // Helper: get a user’s token‐balance as a string with 5 decimals
    const balanceString = (ownerAddress, tokenAddr) => {
      if (!ownerAddress || !tokenAddr) return '0.00000';
      const b = computedBalancesByAddress.value[ownerAddress?.toLowerCase()]?.[tokenAddr.toLowerCase()] || 0;
      return b.toFixed(5);
    };

    // ─── Watchers ─────────────────────────────────────────────────────────────
    // Refresh balances
    watch(
      [() => senderDetails.value,
      () => fromTokenAddress.value,
      () => toTokenAddress.value],
      ([_newSender, _fromAddr, _toAddr]) => {
        if (!_newSender) return;

        // Ask the parent (or composable) to refresh this wallet’s balances for
        // both tokens currently shown in the UI.
        emit(
          'refreshBalance',
          _newSender,
          tokensByAddresses.value[_fromAddr],
        );
        emit(
          'refreshBalance',
          _newSender,
          tokensByAddresses.value[_toAddr]
        );
      },
      { immediate: true }
    );


    // Whenever props.confirmedTrade changes, adjust our offset map
    watch(() => props.confirmedTrade, (confirmed) => {
      if (!confirmed) return;
      const sender = confirmed.sender?.address?.toLowerCase();
      const tok    = confirmed.fromToken?.address.toLowerCase();
      const amt    = Number(confirmed.fromAmount);
      if (!sender || !tok || isNaN(amt)) return;

      if (
        balanceOffsetByTokenByAddress[tok] &&
        balanceOffsetByTokenByAddress[tok][sender] >= amt
      ) {
        balanceOffsetByTokenByAddress[tok][sender] -= amt;
      }
    });

    watch(
      () => fromTokenAddress.value,
      (newFrom, oldFrom) => {
        if (!newFrom) return;

        // If user just made From == To, push the "To" back to what the old From was
        if (newFrom === toTokenAddress.value) {
          toTokenAddress.value = oldFrom;
        }
      }
    );

    watch(
      () => toTokenAddress.value,
      (newTo, oldTo) => {
        if (!newTo) return;

        // If user just made To == From, push the "From" back to what the old To was
        if (newTo === fromTokenAddress.value) {
          fromTokenAddress.value = oldTo;
        }
      }
    );

    const getBestTrades = async (
      fromTokenAddr,
      toTokenAddr,
      amount,
      senderAddr,
      shouldUseUniswapValue,
      shouldUseBalancerValue,
      shouldUseUniswapAndBalancerValue
    ) => {
      if (!fromTokenAddr || !toTokenAddr || !amount || amount <= 0) {
        throw new Error('Invalid parameters for getBestTrades');
      }

      const fromToken = tokensByAddresses.value[fromTokenAddr];
      const toToken = tokensByAddresses.value[toTokenAddr];
      
      if (!fromToken || !toToken) {
        throw new Error('Token not found in tokensByAddresses');
      }

      console.log('Fetching quotes on exchanges for', fromToken.symbol, '->', toToken.symbol);
      
      const results = await Promise.allSettled([
        (shouldUseUniswapValue || shouldUseUniswapAndBalancerValue) ? 
          getTradesUniswap(fromTokenAddr, toTokenAddr, amount) : null,
        (shouldUseBalancerValue) ? 
          getTradesBalancer(fromTokenAddr, toTokenAddr, amount, senderAddr, true) : null,
        (shouldUseUniswapAndBalancerValue)
          ? getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .25, senderAddr, false) : null,
        (shouldUseUniswapAndBalancerValue)
          ? getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .50, senderAddr, false) : null,
        (shouldUseUniswapAndBalancerValue) 
          ? getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .75, senderAddr, false) : null,
        (shouldUseUniswapAndBalancerValue)
          ? getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .10, senderAddr, false) : null,
      ]);

      console.log(results);

      let isUsingUniswap = true;
      let validTrades, totalHuman, totalBig;
      if (results[0] && results[0].status === 'fulfilled' && results[0].value) {
        if (results[0].value === 'outdated') throw new Error('Quote is outdated');
        if (!results[0].value[100] || results[0].value[100] === 'outdated') throw new Error('Quote is outdated');

        validTrades = results[0].value[100].validTrades;
        totalHuman = results[0].value[100].totalHuman;
        totalBig = results[0].value[100].totalBig;
      } else if (!results[0] || results[0].status === 'rejected') {
        isUsingUniswap = false;
        if (results[0] && results[0].reason)
          console.error(results[0].reason);
      }

      let callData, outputAmount, value, gasLimit;
      if (results[1] && results[1].status === 'fulfilled' && results[1].value) {
        callData = results[1].value.callData;
        outputAmount = results[1].value.outputAmount;
        value = results[1].value.value;
        gasLimit = results[1].value.gasLimit;
      } else if (!shouldUseUniswapAndBalancerValue && !shouldUseUniswapValue && (!results[1] || results[1].status === 'rejected')) {
        if (results[1] && results[1].reason)
          throw results[1].reason;
      }

      let uniswapGasLimit = 0
      let offsetUniswap, outputUniswap;
      if (validTrades && validTrades.length && toToken.price && props.gasPrice && props.ethPrice) {
        uniswapGasLimit = 100000 + 50000 * validTrades.length;
        offsetUniswap = BigNumber.from(Math.ceil((uniswapGasLimit * Number(props.ethPrice) * Number(props.gasPrice) / 1e18) * Math.pow(10, toToken.decimals) / toToken.price).toPrecision(50).split('.')[0])
        outputUniswap = totalBig.sub(offsetUniswap)
      }
      let offsetBalancer, outputBalancer;
      if (gasLimit && props.gasPrice && props.ethPrice && toToken.price && outputAmount) { // Add outputAmount check
        offsetBalancer = BigNumber.from(Math.ceil((gasLimit * Number(props.ethPrice) * Number(props.gasPrice) / 1e18) * Math.pow(10, toToken.decimals) / toToken.price).toPrecision(50).split('.')[0])
        outputBalancer = BigNumber.from(outputAmount).sub(offsetBalancer)
      }
      let outputU = outputUniswap || totalBig || BigNumber.from('0'); // Changed default
      let outputB = outputBalancer || BigNumber.from('0'); // Changed default and removed undefined check

      let bestOutputLessGas = outputU;
      if (outputU && outputB && outputB.gt(0)) { // Add check for outputB > 0
        if (outputU.gt(outputB)) {
          isUsingUniswap = true;
          console.log('Using Uniswap')
        } else {
          bestOutputLessGas = outputB;
          isUsingUniswap = false;
          console.log('Using Balancer')
        }
      }
      if (shouldUseUniswapValue && !shouldUseBalancerValue)
        isUsingUniswap = true
      if (shouldUseBalancerValue && !shouldUseUniswapValue)
        isUsingUniswap = false

      // Handle mixed trades if enabled
      let bestMixed, fractionMixed;
      if (shouldUseUniswapAndBalancerValue && results[0]?.value) {
        // Only proceed with mixed if we have valid Balancer results
        let best25U, best50U, best75U, best90U;
        if (results[4].status === 'fulfilled') 
          best25U = findBestMixedTrades(results[0].value[25], results[4], toTokenAddr, results[4].value.gasLimit);
        if (results[3].status === 'fulfilled')
          best50U = findBestMixedTrades(results[0].value[50], results[3], toTokenAddr, results[3].value.gasLimit);
        if (results[2].status === 'fulfilled')
          best75U = findBestMixedTrades(results[0].value[75], results[2], toTokenAddr, results[2].value.gasLimit);
        if (results[5].status === 'fulfilled')
          best90U = findBestMixedTrades(results[0].value[90], results[5], toTokenAddr, results[5].value.gasLimit);

        console.log({
          best90U: best90U?.outputAmount?.toString(),
          best75U: best75U?.outputAmount?.toString(),
          best50U: best50U?.outputAmount?.toString(),
          best25U: best25U?.outputAmount?.toString(),
        })

        const onlyMixedEnabled = shouldUseUniswapAndBalancerValue && !shouldUseUniswapValue && !shouldUseBalancerValue;
        
        // Find the best mixed trade
        const mixedOptions = [];
        if (best25U)
          mixedOptions.push({ trade: best25U, fraction: 25 })
        if (best50U)
          mixedOptions.push({ trade: best50U, fraction: 50 })
        if (best75U)
          mixedOptions.push({ trade: best75U, fraction: 75 })
        if (best90U)
          mixedOptions.push({ trade: best90U, fraction: 90 })

        mixedOptions.sort((a, b) => {
          if (b.trade.outputAmount.gt(a.trade.outputAmount)) return 1;
          if (a.trade.outputAmount.gt(b.trade.outputAmount)) return -1;
          return 0;
        });

        let bestMixedOption = mixedOptions[0];

        if (mixedOptions.length === 0 || (bestMixedOption.fraction === 90)) {
          console.log('No mixed trades found');
          const resultsSmaller = await Promise.allSettled([
            getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .01, senderAddr, false),
            getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .02, senderAddr, false),
            getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .03, senderAddr, false),
            getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .05, senderAddr, false),
            getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .07, senderAddr, false)
          ]);
          for (let i = 0 ; i < resultsSmaller.length ; i++) {
            const res = resultsSmaller[i];
            const fraction = [99, 98, 97, 95, 93][i]
            if (res && res.status === 'fulfilled' && res.value) {
              const trade = findBestMixedTrades(results[0].value[fraction], res, toTokenAddr, res.value.gasLimit)
              console.log(trade)
              if (trade.outputAmount.gt(0)) {
                mixedOptions.push({ trade, fraction: fraction });
              }
            }
          }
        }

        if (bestMixedOption?.fraction === 50) {
          console.log('Best fraction is 50%, trying other fractions');
          const resultsOther = await Promise.allSettled([
            getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .4, senderAddr, false),
            getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .6, senderAddr, false),
            getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .45, senderAddr, false),
            getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .55, senderAddr, false),
          ]);
          for (let i = 0 ; i < resultsOther.length ; i++) {
            const res = resultsOther[i];
            const fraction = [60, 40, 55, 45][i]
            if (res && res.status === 'fulfilled' && res.value) {
              const trade = findBestMixedTrades(results[0].value[fraction], res, toTokenAddr, res.value.gasLimit)
              console.log(trade)
              if (trade.outputAmount.gt(0)) {
                mixedOptions.push({ trade, fraction: fraction });
              }
            }
          }
        }
       
        if (bestMixedOption?.fraction === 75) {
          console.log('Best fraction is 75%, trying other fractions');
          const resultsOther = await Promise.allSettled([
            getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .3, senderAddr, false),
            getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .2, senderAddr, false),
            getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .35, senderAddr, false),
            getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .15, senderAddr, false),
          ]);
          for (let i = 0 ; i < resultsOther.length ; i++) {
            const res = resultsOther[i];
            const fraction = [70, 80, 65, 85][i]
            if (res && res.status === 'fulfilled' && res.value) {
              const trade = findBestMixedTrades(results[0].value[fraction], res, toTokenAddr, res.value.gasLimit)
              console.log(trade)
              if (trade.outputAmount.gt(0)) {
                mixedOptions.push({ trade, fraction: fraction });
              }
            }
          }
        }
       
        if (bestMixedOption?.fraction === 25) {
          console.log('Best fraction is 25%, trying other fractions');
          const resultsOther = await Promise.allSettled([
            getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .8, senderAddr, false),
            getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .7, senderAddr, false),
            getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .85, senderAddr, false),
            getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .9, senderAddr, false),
            getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .65, senderAddr, false),
          ]);
          for (let i = 0 ; i < resultsOther.length ; i++) {
            const res = resultsOther[i];
            const fraction = [20, 30, 15, 10, 35][i]
            if (res && res.status === 'fulfilled' && res.value) {
              const trade = findBestMixedTrades(results[0].value[fraction], res, toTokenAddr, res.value.gasLimit)
              console.log(trade)
              if (trade.outputAmount.gt(0)) {
                mixedOptions.push({ trade, fraction: fraction });
              }
            }
          }
        }
        console.log('Mixed options:', mixedOptions);
        // Sort by output amount (highest first)
        mixedOptions.sort((a, b) => {
          if (b.trade.outputAmount.gt(a.trade.outputAmount)) return 1;
          if (a.trade.outputAmount.gt(b.trade.outputAmount)) return -1;
          return 0;
        });

        bestMixedOption = mixedOptions[0];

        if (onlyMixedEnabled) {
          // When only mixed trades are enabled, always select the best one
          bestMixed = bestMixedOption.trade;
          fractionMixed = bestMixedOption.fraction;
        } else {
          // When other protocols are also enabled, compare against bestOutputLessGas
          if (bestMixedOption?.trade && (!bestOutputLessGas || bestMixedOption?.trade?.outputAmount?.gte(bestOutputLessGas))) {
            bestMixed = bestMixedOption.trade;
            fractionMixed = bestMixedOption.fraction;
          }
        }
      }

      // Build final trade result
      let finalTrades, finalTotalHuman, protocol, finalGasLimit;
      
      console.log(bestMixed)
      if (bestMixed) {
        totalHuman = ethers.utils.formatUnits(bestMixed.tradesU.totalBig.add(bestMixed.tradesB.outputAmount), toToken.decimals);
        finalTrades = [
          ...bestMixed.tradesU.validTrades,
          bestMixed.tradesB,
        ];
        protocol = 'Uniswap & Balancer';
        finalGasLimit = Number(100000 + 50000 * bestMixed.tradesU.validTrades.length) + Number(gasLimit);
      } else if (isUsingUniswap) {
        finalTrades = validTrades;
        protocol = 'Uniswap';
        finalGasLimit = uniswapGasLimit;
      } else if (outputAmount) {
        finalTrades = [{callData, outputAmount, value, tradeSummary}];
        totalHuman = ethers.utils.formatUnits(outputAmount, toToken.decimals);
        protocol = 'Balancer';
        finalGasLimit = gasLimit;
      } else {
        throw new Error('No swap found');
      }

      if (!shouldUseUniswapValue && !shouldUseBalancerValue && !bestMixed) {
        throw new Error('No swap found');
      }

      finalTotalHuman = totalHuman.length > 9 && totalHuman[0] !== '0' ? Number(totalHuman).toFixed(4) : Number(totalHuman).toFixed(6);
      if (finalTotalHuman === '0.000000' || finalTotalHuman === '0.00') {
        finalTotalHuman = tokensByAddresses.value[toTokenAddr].decimals >= 9 ? Number(totalHuman).toFixed(9) : Number(totalHuman).toFixed(6);
      }

      return {
        trades: finalTrades,
        totalHuman: finalTotalHuman,
        protocol,
        gasLimit: finalGasLimit,
        bestMixed,
        fractionMixed,
        fromToken,
        toToken
      };
    };

    // Whenever fromToken, toToken, fromAmount, trades, or sender changes → re‐quote
    let debounceTimer = null;
    watch(
      [
        () => fromTokenAddress.value,
        () => toTokenAddress.value,
        () => fromAmount.value,
        () => senderDetails.value,
        () => shouldUseUniswap.value,
        () => shouldUseBalancer.value,
        () => shouldUseUniswapAndBalancer.value,
      ],
      async (
        [_newFrom, _newTo, _newAmt, _newSender, shouldUseUniswapValue, shouldUseBalancerValue, shouldUseUniswapAndBalancerValue],
        [_oldFrom, _oldTo]
      ) => {
        if (tabOrder.value === 'limit') {
          console.log('Skipping re-quoting for Limit Order tab');
          if (debounceTimer) clearTimeout(debounceTimer);
          return;
        }

        if (!_newSender?.address) {
          swapMessage.value = 'No wallet selected';
          return;
        }

        if (!shouldUseUniswapValue && !shouldUseBalancerValue && !shouldUseUniswapAndBalancerValue) {
          swapMessage.value = 'Select at least one DEX type'
          isSwapButtonDisabled.value = true;
          return
        }
        if (debounceTimer) clearTimeout(debounceTimer);
        priceFetchingMessage.value = '';
        swapMessage.value = '';
        trades.value = [];
        tradeSummary.toAmount = null;
        tradeSummary.protocol = null;
        isFetchingPrice.value = true;

        // If any of the essentials is missing or invalid, skip re‐quoting
        if (
          !_newFrom ||
          !_newTo ||
          !_newAmt ||
          _newAmt === '.' ||
          _newAmt <= 0
        ) {
          isFetchingPrice.value = false;
          return;
        }

        // If tokens changed, reset summary & approval state
        if (_oldFrom !== _newFrom || _oldTo !== _newTo) {
          tradeSummary.toAmount = null;
          needsToApprove.value = false;
        }

        debounceTimer = setTimeout(async () => {
          try {
            if (tabOrder.value === 'limit') {
              console.log('Skipping re-quoting for Limit Order tab');
              return;
            }
            
            // Use refactored getBestTrades function
            const bestTradeResult = await getBestTrades(
              _newFrom,
              _newTo,
              _newAmt,
              _newSender.address,
              shouldUseUniswapValue,
              shouldUseBalancerValue,
              shouldUseUniswapAndBalancerValue
            );

            // SECURITY CHECKS: ensure each leg’s input/output token matches our chosen tokens
            if (_newFrom !== fromTokenAddress.value || _newTo !== toTokenAddress.value) {
              console.log('Outdated token pair in first check');
              return 'outdated';
            }
            if (_newAmt !== fromAmount.value) {
              console.log('Outdated input amount in first check');
              return 'outdated';
            }

            // Update reactive state with results
            trades.value = bestTradeResult.trades;
            tradeSummary.protocol = bestTradeResult.protocol;
            tradeSummary.sender = _newSender;
            tradeSummary.fromAmount = _newAmt.toString();
            tradeSummary.toAmount = bestTradeResult.totalHuman;
            tradeSummary.expectedToAmount = tradeSummary.toAmount;
            tradeSummary.fromTokenSymbol = bestTradeResult.fromToken.symbol;
            tradeSummary.toTokenSymbol = bestTradeResult.toToken.symbol;
            tradeSummary.fromAddressName = `${senderDetails.value.name}`;
            tradeSummary.fromToken = bestTradeResult.fromToken;
            tradeSummary.fromTokenAddress = bestTradeResult.fromToken.address;
            tradeSummary.toToken = bestTradeResult.toToken;
            tradeSummary.toTokenAddress = bestTradeResult.toToken.address;
            tradeSummary.gasLimit = bestTradeResult.gasLimit;
            
            if (bestTradeResult.bestMixed) {
              tradeSummary.fromAmountU = (_newAmt * bestTradeResult.fractionMixed / 100).toFixed(7);
              tradeSummary.fromAmountB = (_newAmt - Number(tradeSummary.fromAmountU)).toFixed(7);
              tradeSummary.toAmountU = Number(ethers.utils.formatUnits(bestTradeResult.bestMixed.tradesU.totalBig, bestTradeResult.toToken.decimals)).toFixed(7);
              tradeSummary.toAmountB = Number(ethers.utils.formatUnits(bestTradeResult.bestMixed.tradesB.outputAmount, bestTradeResult.toToken.decimals)).toFixed(7);
              tradeSummary.fraction = bestTradeResult.fractionMixed;
            }

            // Check if approval is needed
            if (_newFrom !== ethers.constants.AddressZero) {
              if (tradeSummary.protocol === 'Uniswap & Balancer') {
                await checkAllowances(_newFrom, true);
                await checkAllowances(_newFrom, false);
              } else 
                await checkAllowances(_newFrom, tradeSummary.protocol === 'Uniswap');
            } else {
              needsToApprove.value = false;
            }

            isSwapButtonDisabled.value = false;
          } catch (err) {
            console.error(err);
            // If any check fails, or no trades found, disable the Swap button
            isSwapButtonDisabled.value = true;
            if (err.toString().includes('fractional component exceeds decimals')) {
              priceFetchingMessage.value = 'Error: Too many decimals in the input amount';
            } else {
              priceFetchingMessage.value = err.message || String(err);
            }
            trades.value = [];
            tradeSummary.toAmount = null;
            tradeSummary.protocol = null;
          }

          isFetchingPrice.value = false;
        }, 500);
      }
    );

    const checkAllowances = async (tokenAddress, isUsingUniswap) => {
      if (!senderDetails.value?.address) {
        needsToApprove.value = false;
        return;
      }
      const erc20 = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        toRaw(props.provider)
      );
      const rawAllowance = await erc20.allowance(
        senderDetails.value.address,
        isUsingUniswap ? PERMIT2_ADDRESS : BALANCER_VAULT_ADDRESS,
      );
      // If allowance < 1e27 (arbitrary “sufficient” threshold), require approval
      if (BigNumber.from(rawAllowance).lt(BigNumber.from('100000000000000000000000000'))) {
        return needsToApprove.value = true;
      }
      
      if (isUsingUniswap) {
        // double‐check Permit2 → Router allowance
        const permit2 = new ethers.Contract(
          PERMIT2_ADDRESS,
          ["function allowance(address owner,address token,address spender) view returns (uint160,uint48,uint48)"],
          toRaw(props.provider)
        );
        const [remaining] = await permit2.allowance(
          senderDetails.value.address,
          tokenAddress,
          UNIVERSAL_ROUTER_ADDRESS
        );
        if (BigNumber.from(remaining).lt(BigNumber.from('100000000000000000000000000'))) {
          needsToApprove.value = true;
        } else {
          needsToApprove.value = false;
        }
      }
    }

    const findBestMixedTrades = (resultsU, rawResultsB, toTokenAddress, gasLimitBalancer) => {
      let validTrades, totalHuman, totalBig;
      if (resultsU) {
        validTrades = resultsU.validTrades;
        totalHuman = resultsU.totalHuman;
        totalBig = resultsU.totalBig;
      }
      let callData, outputAmount, value;
      if (rawResultsB && rawResultsB.status === 'fulfilled' && rawResultsB.value) {
        callData = rawResultsB.value.callData;
        outputAmount = BigNumber.from(rawResultsB.value.outputAmount || '0'); // Add fallback
        value = rawResultsB.value.value || '0'; // Add fallback
      }

      let uniswapGasLimit = 0
      let offsetUniswap, outputUniswap;
      if (validTrades && validTrades.length && tokensByAddresses.value[toTokenAddress].price && props.gasPrice && props.ethPrice) {
        uniswapGasLimit = 100000 + 50000 * validTrades.length; // Fixed reference
        offsetUniswap = BigNumber.from(Math.ceil((uniswapGasLimit * Number(props.ethPrice) * Number(props.gasPrice) / 1e18) * Math.pow(10, tokensByAddresses.value[toTokenAddress].decimals) / tokensByAddresses.value[toTokenAddress].price).toPrecision(50).split('.')[0])
        outputUniswap = totalBig.sub(offsetUniswap)
      }
      let offsetBalancer, outputBalancer;
      if (gasLimitBalancer && props.gasPrice && props.ethPrice && tokensByAddresses.value[toTokenAddress].price && outputAmount) { // Add outputAmount check
        offsetBalancer = BigNumber.from(Math.ceil((gasLimitBalancer * Number(props.ethPrice) * Number(props.gasPrice) / 1e18) * Math.pow(10, tokensByAddresses.value[toTokenAddress].decimals) / tokensByAddresses.value[toTokenAddress].price).toPrecision(50).split('.')[0])
        outputBalancer = outputAmount.sub(offsetBalancer)
      }
      let outputU = outputUniswap || totalBig || BigNumber.from('0'); // Changed default to '0'
      let outputB = outputBalancer || outputAmount || BigNumber.from('0'); // Changed default to '0' and removed undefined outputAmount

      return {
        outputAmount: outputB.add(outputU),
        tradesU: {
          validTrades: validTrades || [],
          totalHuman: totalHuman || '0',
          totalBig: totalBig || BigNumber.from('0'),
        },
        tradesB: {
          callData: callData || null,
          outputAmount: outputAmount || BigNumber.from('0'),
          value: value || '0',
        }
      }
    }
    const getTradesBalancer = async (_newFrom, _newTo, _newAmt, _newSenderAddress, shouldFetchGasLimit) => {
      const result = await findTradeBalancer(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], _newAmt, _newSenderAddress);

      const txData = {
        from: _newSenderAddress,
        to: BALANCER_VAULT_ADDRESS,
        data: result.callData,
        value: result.value,
        maxFeePerGas: ethers.utils.parseUnits((Number(props.gasPrice) * 1.85 / 1000000000).toFixed(3), 9),
        maxPriorityFeePerGas: ethers.utils.parseUnits((0.01 + Math.random() * .05 + (Number(props.gasPrice) / (40 * 1000000000))).toFixed(3), 9)
      }

      let gasLimit = 400000;
      try {
        if (shouldFetchGasLimit) {
          console.log('before promise.race')
          gasLimit = await Promise.race([
            toRaw(props.provider).estimateGas(txData),
            new Promise(r => setTimeout(r, 5000)),
          ])
          console.log({gasLimit})
          if (!gasLimit)
            gasLimit = 400000;
        }
      } catch (err) {
        console.log('Error in estimateGas');
        console.error(err);
      }
      console.log(gasLimit);

      return {outputAmount: result.expectedAmountOut, callData: result.callData, value: result.value, gasLimit: gasLimit}
    }

    const getTradesUniswap = async (_newFrom, _newTo, _newAmt) => {
      const pools = await findPossiblePools(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo]);
      
      // FINDING TRADES
      const fromAmtRaw = ethers.utils.parseUnits(
        _newAmt.toString(),
        tokensByAddresses.value[_newFrom].decimals
      );
      const [bestTrades,
        bestTrades10,
        bestTrades15,
        bestTrades20,
        bestTrades25,
        bestTrades30,
        bestTrades35,
        bestTrades40] = await Promise.all([
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, fromAmtRaw),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .10).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .15).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .20).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .25).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .30).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .35).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .40).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
      ]);

      const [
        bestTrades45,
        bestTrades50,
        bestTrades55,
        bestTrades60,
        bestTrades65,
        bestTrades70,
        bestTrades75,
      ] = await Promise.all([
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .45).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .50).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .55).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .60).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .65).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .70).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .75).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
      ]);

      const [ 
        bestTrades80,
        bestTrades85,
        bestTrades90,
        bestTrades93,
        bestTrades95,
        bestTrades97,
        bestTrades98,
        bestTrades99] = await Promise.all([
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .80).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .85).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .90).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .93).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .95).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .97).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .98).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, ethers.utils.parseUnits(
          (_newAmt * .99).toFixed(tokensByAddresses.value[_newFrom].decimals),
          tokensByAddresses.value[_newFrom].decimals
        )),
      ])

      const tradesByPercent = {
        10: processBestTrades(bestTrades10, _newFrom, _newTo),
        15: processBestTrades(bestTrades15, _newFrom, _newTo),
        20: processBestTrades(bestTrades20, _newFrom, _newTo),
        25: processBestTrades(bestTrades25, _newFrom, _newTo),
        30: processBestTrades(bestTrades30, _newFrom, _newTo),
        35: processBestTrades(bestTrades35, _newFrom, _newTo),
        40: processBestTrades(bestTrades40, _newFrom, _newTo),
        45: processBestTrades(bestTrades45, _newFrom, _newTo),
        50: processBestTrades(bestTrades50, _newFrom, _newTo),
        55: processBestTrades(bestTrades55, _newFrom, _newTo),
        60: processBestTrades(bestTrades60, _newFrom, _newTo),
        65: processBestTrades(bestTrades65, _newFrom, _newTo),
        70: processBestTrades(bestTrades70, _newFrom, _newTo),
        75: processBestTrades(bestTrades75, _newFrom, _newTo),
        80: processBestTrades(bestTrades80, _newFrom, _newTo),
        85: processBestTrades(bestTrades85, _newFrom, _newTo),
        90: processBestTrades(bestTrades90, _newFrom, _newTo),
        93: processBestTrades(bestTrades93, _newFrom, _newTo),
        95: processBestTrades(bestTrades95, _newFrom, _newTo),
        97: processBestTrades(bestTrades97, _newFrom, _newTo),
        98: processBestTrades(bestTrades98, _newFrom, _newTo),
        99: processBestTrades(bestTrades99, _newFrom, _newTo),
        100: processBestTrades(bestTrades, _newFrom, _newTo),
      }

      const decimalsIn = tokensByAddresses.value[_newFrom].decimals; // e.g. 18 for WETH, 6 for USDT
      const expectedInRawBN = ethers.utils.parseUnits(_newAmt + '', decimalsIn);
      
      const totalInBN = tradesByPercent[100].validTrades.reduce(
        (acc, t) => {
          // Convert each JSBI quotient → string → BigNumber, then add
          const legInBN = BigNumber.from(t.inputAmount.quotient.toString());
          return acc.add(legInBN);
        },
        BigNumber.from(0)
      );

      if (!totalInBN.eq(expectedInRawBN)) {
        console.log('Outdated input amount, sum of input of trades: ' + totalInBN.toString());
        return 'outdated';
      }

      return tradesByPercent
    }

    const processBestTrades = (bestTrades, _newFrom, _newTo) => {
      // Filter out any null/undefined
      const validTrades = bestTrades.filter(t => t && t.outputAmount);
      if (validTrades.length === 0) {
       return {validTrades: [], totalHuman: '0', totalBig: BigNumber.from(0)}
      }

      const totalBig = validTrades.reduce(
        (acc, t) => {
          const legInBN = BigNumber.from(t.outputAmount.quotient.toString());
          return acc.add(legInBN);
        },
        BigNumber.from(0)
      );
      const totalHuman = ethers.utils.formatUnits(totalBig, tokensByAddresses.value[_newTo].decimals);

      // // SECURITY CHECKS: ensure each leg’s input/output token matches our chosen tokens
      // for (const t of validTrades) {
      //   const inAddr  = t.inputAmount.currency.address.toLowerCase();
      //   const outAddr = t.outputAmount.currency.address.toLowerCase();
      //   if (inAddr !== fromTokenAddress.value.toLowerCase() || outAddr !== toTokenAddress.value.toLowerCase()) {
      //     console.log('Outdated token pair');
      //     return 'outdated';
      //   }
      // }

      return {validTrades, totalHuman, totalBig};
    }

    async function tokenUsd(tokenAddr, ethUsd) {
      if (!tokenAddr) return 0;
      if (tokenAddr === ethers.constants.AddressZero) return ethUsd;
      const lc = tokenAddr.toLowerCase();
      if (lc === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48') return 1;
      if (lc === '0xdac17f958d2ee523a2206206994597c13d831ec7') return 1;

      const qry = `
        query ($id: String!) {
          token(id: $id) { derivedETH }
        }`;
      const resp = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: qry, variables: { id: lc } })
      });
      const data = await resp.json();
      const d = data?.data?.token?.derivedETH ? Number(data.data.token.derivedETH) : 0;
      return d * ethUsd;
    }

    async function tokensUsd(tokenArray, ethUsd) {
      const addressesToFetch = []
      const tokenPrices = {}
      for (const token of tokenArray) {
        if (!token.address) continue;
        const lc = token.address.toLowerCase();
        if (lc === ethers.constants.AddressZero)
          tokenPrices[lc] = ethUsd;
        else if (lc === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
          tokenPrices[lc] = 1;
        else if (lc === '0xdac17f958d2ee523a2206206994597c13d831ec7')
          tokenPrices[lc] = 1;
        else
          addressesToFetch.push(token.address)
      }

      const qry = `
        query ($ids: [String]!) {
          tokens(where: {id_in: $ids}) {
            id
            derivedETH
          }
        }`;
      const resp = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: qry, variables: { ids: addressesToFetch } })
      });
      const data = await resp.json();
      for (const token of (data?.data?.tokens || [])) {
        if (!token.id) continue;

        const d = token?.derivedETH ? Number(token.derivedETH) : 0;
        tokenPrices[token.id] = d * ethUsd;
      }

      return tokenPrices;
    }

    const setTokenPrices = async (tokenArray) => {
      const tokenPrices = await tokensUsd(tokenArray, props.ethPrice);
      for (const tokenAddress in tokenPrices) {
        let index = tokenArray.findIndex((t) => t.address.toLowerCase() === tokenAddress)
        tokenArray[index].price = tokenPrices[tokenAddress]
      }
    };
    watch(() => props.ethPrice, () => setTokenPrices(tokens), { immediate: true });
    const priceUpdateInterval = setInterval(() => {
      if (!pendingLimitOrders.value.length) setTokenPrices(tokens);
    }, 12_000);

    // Whenever the tokens list is edited (addresses, symbols, decimals), rebuild tokensByAddresses
    watch(
      () => tokens,
      (newTokens) => {
        const map = {};
        for (const t of newTokens) {
          if (t.address && t.symbol && t.decimals != null) {
            map[t.address] = t;
          }
        }
        tokensByAddresses.value = map;

        // Initialize default selection if not set
        if (!fromTokenAddress.value && filteredTokens.value.length > 0) {
          fromTokenAddress.value = filteredTokens.value[0].address;
        }
        if (!toTokenAddress.value && filteredTokens.value.length > 1) {
          toTokenAddress.value = filteredTokens.value[1].address;
        }
      },
      { immediate: true, deep: true }
    );

    // Persist tokens configuration on mount
    onMounted(async () => {
      const settings = await window.electronAPI.loadSettings();
      if (settings?.tokens) {
        for (let i = 0; i < settings.tokens.length; i++) {
          if (settings.tokens[i]?.address && settings.tokens[i]?.symbol) {
            tokens[i] = settings.tokens[i];
          }
        }
      }

      const dbOrders = await window.electronAPI.getPendingOrders();
      if (dbOrders && Array.isArray(dbOrders)) {
        pendingLimitOrders.value = dbOrders.map(o => ({
          id: o.id,
          fromAmount: o.fromAmount,
          toAmount: o.toAmount, // Make sure to map this field
          fromToken: { 
            address: o.fromTokenAddress, 
            symbol: o.fromTokenSymbol 
          },
          toToken: { 
            address: o.toTokenAddress, 
            symbol: o.toTokenSymbol 
          },
          priceLimit: parseFloat(o.priceLimit),
          currentMarketPrice: o.currentMarketPrice ? parseFloat(o.currentMarketPrice) : null,
          orderType: o.orderType || 'take_profit',
          shouldSwitchTokensForLimit: Boolean(o.shouldSwitchTokensForLimit),
          sender: { 
            address: o.senderAddress, 
            name: o.senderName 
          },
          status: o.status || 'pending',
          createdAt: o.createdAt || null,
          completedAt: o.completedAt || null,
          executionPrice: o.executionPrice ? parseFloat(o.executionPrice) : null
        })).sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
          const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
          return dateB.getTime() - dateA.getTime();
        });
      }
    });
    watch(() => tokens, () => emit('update:settings', { tokens: [...tokens] }), { deep: true });

    // Keep senderDetails in sync
    watch(
      () => props.addresses,
      (addrs) => {
        if (addrs && addrs[0]) {
          senderDetails.value = addrs[0];
        }
      },
      { immediate: true }
    );
    watch(
      () => senderDetails.value,
      (val) => {
        if (!val) {
          isSwapButtonDisabled.value = true;
        } else {
          needsToApprove.value = false;
        }
      },
      { immediate: true }
    );

    // ─── Methods ─────────────────────────────────────────────────────────────

    async function getTokenSymbol(contractAddress) {
      const c = new ethers.Contract(contractAddress, ERC20_ABI, toRaw(props.provider));
      return await c.symbol();
    }
    async function getTokenDecimals(contractAddress) {
      const c = new ethers.Contract(contractAddress, ERC20_ABI, toRaw(props.provider));
      const d = await c.decimals();
      return Number(d.toString());
    }
    async function findSymbol(index, contractAddress) {
      try {
        if (contractAddress === ethers.constants.AddressZero) {
          tokens[index].decimals = 18;
          tokens[index].symbol = 'ETH';
          tokens[index].price = props.ethPrice;
        } else if (ethers.utils.isAddress(contractAddress)) {
          tokens[index].decimals = await getTokenDecimals(contractAddress);
          tokens[index].symbol   = await getTokenSymbol(contractAddress);
          tokens[index].price    = await tokenUsd(contractAddress, props.ethPrice);
        } else {
          tokens[index].symbol = null;
        }
        tokens[index].address = tokens[index].address.toLowerCase();
      } catch {
        tokens[index].symbol = null;
      }
    }
    function deleteToken(index) {
      tokens[index].address = '';
      tokens[index].symbol = '';
      tokens[index].decimals = null;
      tokens[index].price = 0;
    }

    function switchTokens() {
      const tmp = toTokenAddress.value;
      toTokenAddress.value = fromTokenAddress.value;
      fromTokenAddress.value = tmp;
      shouldSwitchTokensForLimit.value = !shouldSwitchTokensForLimit.value;
      if (tradeSummary.toAmount) {
        [fromAmount.value, tradeSummary.toAmount] = [tradeSummary.toAmount, fromAmount.value];
      }
    }

    // ─── triggerTrade(): Execute *all* legs in one Universal Router call ────
    const triggerTrade = async (providedTrades = null, providedTradeSummary = null) => {
      let globalWarnings;
      try {
        swapMessage.value = '';

        // Use provided trades/summary or fall back to reactive values
        const currentTrades = providedTrades || trades.value;
        const currentTradeSummary = providedTradeSummary || tradeSummary;

        // Mark summary as "pending"
        currentTradeSummary.txId = 'pending';
        currentTradeSummary.sentDate = new Date();
        currentTradeSummary.isConfirmed = false;

        // Basic balance check for ETH → gas
        if (currentTradeSummary.fromToken.address === ethers.constants.AddressZero) {
          const addr = currentTradeSummary.sender.address.toLowerCase();
          const bal = computedBalancesByAddress.value[addr]?.[currentTradeSummary.fromToken.address.toLowerCase()] || 0;
          if (bal - Number(currentTradeSummary.fromAmount) < 0.003) {
            throw new Error('Insufficient ETH for gas on ' + addr);
          }
        }

        console.log(currentTrades);
        let globalTxs = [];
        if (currentTradeSummary.protocol === 'Uniswap') {
          // Call our adapted executeSwapExactIn, passing the *array* of trades
          const { success, warnings, tx, error } = await executeMixedSwaps(
            currentTrades,
            currentTradeSummary,
            slippage.value,
            props.gasPrice
          );

          if (!success && error) {
            if (warnings) globalWarnings = warnings;
            throw error;
          }
          globalTxs.push(tx);
        } else if (currentTradeSummary.protocol === 'Balancer') {
          const args = {
            callData: currentTrades[0].callData,
            outputAmount: currentTrades[0].outputAmount.toString(),
            value: currentTrades[0].value.toString(),
            from: currentTradeSummary.sender.address,
            tradeSummary: JSON.parse(JSON.stringify(currentTradeSummary)),
          }
          const response = await window.electronAPI.sendTransaction(args);
          if (!response?.success)
            throw new Error('Problem in sending transaction to Balancer: ' + response?.error?.toString());
          if (response.warnings && response.warnings.length) {
            globalWarnings = response.warnings;
          }

          globalTxs.push(response.tx);
        } else if (currentTradeSummary.protocol === 'Uniswap & Balancer') {
          const resultsU = await executeMixedSwaps(
            currentTrades.filter((t) => !t.callData),
            {
              ...currentTradeSummary,
              fromAmount: currentTradeSummary.fromAmountU,
              expectedToAmount: currentTradeSummary.toAmountU,
              toAmount: currentTradeSummary.toAmountU,
              protocol: 'Uniswap'
            },
            slippage.value,
            props.gasPrice
          )

          const resultsB = await window.electronAPI.sendTransaction({
            callData: currentTrades.filter(t => t.callData)[0].callData,
            outputAmount: currentTrades.filter(t => t.callData)[0].outputAmount.toString(),
            value: currentTrades.filter(t => t.callData)[0].value.toString(),
            from: currentTradeSummary.sender.address,
            tradeSummary: JSON.parse(JSON.stringify({
              ...currentTradeSummary,
              fromAmount: currentTradeSummary.fromAmountB,
              expectedToAmount: currentTradeSummary.toAmountB,
              toAmount: currentTradeSummary.toAmountB,
              protocol: 'Balancer'
            })),
          })
          if (!resultsU?.success)
            swapMessage.value = 'Problem in sending transaction to Uniswap in U + B: ' + resultsU?.error?.toString()
          if (resultsU.warnings && resultsU.warnings.length) {
            globalWarnings = resultsU.warnings;
          }
          if (!resultsB?.success)
            swapMessage.value += 'Problem in sending transaction to Balancer in U + B: ' + resultsB?.error?.toString()
          if (resultsB.warnings && resultsB.warnings.length) {
            globalWarnings = resultsB.warnings;
          }

          if (resultsU && resultsU.success)
            globalTxs.push(resultsU.tx);
          if (resultsB && resultsB.success)
            globalTxs.push(resultsB.tx);
        }
        
        // Subtract "from amount" from our local offset map
        if (!providedTradeSummary)
          increaseOffsetBalance(
            currentTradeSummary.fromToken?.address.toLowerCase(),
            currentTradeSummary.sender.address.toLowerCase(),
            tradeSummary.value
          )

        // Finalize summary & emit upwards
        currentTradeSummary.fromTokenSymbol = tokensByAddresses.value[currentTradeSummary.fromToken?.address].symbol;
        currentTradeSummary.toTokenSymbol   = tokensByAddresses.value[currentTradeSummary.toToken?.address].symbol;
        if (globalWarnings && globalWarnings.length) {
          swapMessage.value = 'Warnings: ' + globalWarnings.join(' ; ');
        }

        if (currentTradeSummary.protocol === 'Uniswap & Balancer') {
          currentTradeSummary.txId = globalTxs[0].hash;
          emit('update:trade', {
             ...currentTradeSummary,
            fromAmount: currentTradeSummary.fromAmountU,
            expectedToAmount: currentTradeSummary.toAmountU,
            toAmount: currentTradeSummary.toAmountU,
            protocol: 'Uniswap'
          });
          currentTradeSummary.txId = globalTxs[1].hash;
          emit('update:trade', {
            ...currentTradeSummary,
            fromAmount: currentTradeSummary.fromAmountB,
            expectedToAmount: currentTradeSummary.toAmountB,
            toAmount: currentTradeSummary.toAmountB,
            protocol: 'Balancer'
          });
        } else {
          currentTradeSummary.txId = globalTxs[0].hash;
          emit('update:trade', { ...currentTradeSummary });
        }
      } catch (error) {
        // If using provided trade summary, update it; otherwise update the reactive one
        const currentTradeSummary = providedTradeSummary || tradeSummary;
        currentTradeSummary.txId     = null;
        currentTradeSummary.sentDate = null;

        if (error.toString().includes('insufficient funds for intrinsic transaction cost')) {
          swapMessage.value = 'Error: Not enough ETH on the address';
        } else if (error.toString().includes('cannot estimate gas')) {
          swapMessage.value = 'Error: Preventing failed swap';
        } else {
          swapMessage.value = error.message || String(error);
        }
        if (globalWarnings && globalWarnings.length) {
          swapMessage.value += ' | Warnings: ' + globalWarnings.join(' ; ');
        }

        console.error(error);
      } finally {
        isSwapButtonDisabled.value = false;
      }
    };

    const increaseOffsetBalance = (tokLower, senderLc, currentTradeSummary) => {
      if (!balanceOffsetByTokenByAddress[tokLower]) {
        balanceOffsetByTokenByAddress[tokLower] = {};
      }
      if (!balanceOffsetByTokenByAddress[tokLower][senderLc]) {
        balanceOffsetByTokenByAddress[tokLower][senderLc] = 0;
      }
      balanceOffsetByTokenByAddress[tokLower][senderLc] += Number(currentTradeSummary.fromAmount);
    }

    // ─── approveSpending(): Approve ERC20 → Permit2 → Router ───────────────
    const approveSpending = async () => {
      try {
        isSwapButtonDisabled.value = true;
        const originalAddress = senderDetails.value.address;

        if (tabOrder.value === 'limit') {
          const { success, error } = await window.electronAPI.approveSpender(
            originalAddress,
            fromTokenAddress.value,
            PERMIT2_ADDRESS,
            props.gasPrice,
            'Uniswap & Balancer'
          );
          if (!success) throw error;
          const resBalancer = await window.electronAPI.approveSpender(
            originalAddress,
            fromTokenAddress.value,
            BALANCER_VAULT_ADDRESS,
            props.gasPrice,
            'Uniswap & Balancer'
          );
        } else {
          const { success, error } = await window.electronAPI.approveSpender(
            originalAddress,
            fromTokenAddress.value,
            tradeSummary.protocol === 'Uniswap' ? PERMIT2_ADDRESS : BALANCER_VAULT_ADDRESS,
            props.gasPrice,
            tradeSummary.protocol
          );
          if (!success) throw error;
        }

        // Pull until allowance has shown up on‐chain
        let allowance = BigNumber.from(0);
        const erc20 = new ethers.Contract(
          fromTokenAddress.value,
          ERC20_ABI,
          toRaw(props.provider)
        );
        while (allowance.isZero() && originalAddress === senderDetails.value.address) {
          allowance = await erc20.allowance(
            originalAddress,
            tradeSummary.protocol === 'Uniswap' || tradeSummary.protocol === 'Uniswap & Balancer' ? PERMIT2_ADDRESS : BALANCER_VAULT_ADDRESS
          );
          if (allowance.isZero()) {
            await new Promise(r => setTimeout(r, 2000));
          }
        }
        if (tradeSummary.protocol === 'Uniswap & Balancer' || tabOrder.value === 'limit') {
          allowance = BigNumber.from(0)
          while (allowance.isZero() && originalAddress === senderDetails.value.address) {
            allowance = await erc20.allowance(originalAddress, BALANCER_VAULT_ADDRESS);
            if (allowance.isZero()) {
              await new Promise(r => setTimeout(r, 2000));
            }
          }
        }

        if (tradeSummary.protocol === 'Uniswap' || tradeSummary.protocol === 'Uniswap & Balancer') {
          // Now check Permit2's allowance
          const permit2 = new ethers.Contract(
            PERMIT2_ADDRESS,
            ["function allowance(address owner,address token,address spender) view returns (uint160,uint48,uint48)"],
            toRaw(props.provider)
          );
          let p2allow = BigNumber.from(0);
          while (p2allow.isZero() && originalAddress === senderDetails.value.address) {
            const [remaining] = await permit2.allowance(
              originalAddress,
              fromTokenAddress.value,
              UNIVERSAL_ROUTER_ADDRESS
            );
            p2allow = BigNumber.from(remaining.toString());
            if (p2allow.isZero()) {
              await new Promise(r => setTimeout(r, 2000));
            }
          }
        }

        needsToApprove.value = false;
      } catch (err) {
        console.error(err);
        if (err.message.includes('insufficient funds for intrinsic transaction cost')) {
          swapMessage.value = 'Error: Not enough ETH on the address ' + senderDetails.value.address;
        } else {
          swapMessage.value = err.message || String(err);
        }
      } finally {
        isSwapButtonDisabled.value = false;
      }
    };

    // Emit when tokens scaffold changes
    const emitSettings = () => {
      const cleaned = tokens.filter(t =>
        t.symbol &&
        t.address &&
        (ethers.utils.isAddress(t.address) || t.address === ethers.constants.AddressZero)
      ).map(t => ({ ...t }));
      emit('update:settings', { tokens: cleaned });
    };

    watch(() => tokens, () => emitSettings(), { deep: true });

    watch(
      [() => priceLimit.value, () => fromAmount.value, () => fromTokenAddress.value, () => toTokenAddress.value],
      ([priceLimitValue, fromAmountValue]) => {
      if (!fromAmountValue || isNaN(fromAmountValue)) {
        tradeSummary.toAmount = null;
        return;
      }
      if (tabOrder.value !== 'limit') return;
      if (priceLimitValue && !isNaN(priceLimitValue)) {
        tradeSummary.priceLimit = Number(priceLimitValue);
        if (shouldSwitchTokensForLimit.value) {
          tradeSummary.toAmount = (fromAmountValue / tradeSummary.priceLimit).toFixed(tokensByAddresses.value[toTokenAddress.value].decimals >= 9 ? 9 : 6);
        } else
          tradeSummary.toAmount = (fromAmountValue * tradeSummary.priceLimit).toFixed(tokensByAddresses.value[toTokenAddress.value].decimals >= 9 ? 9 : 6);
      } else {
        tradeSummary.priceLimit = null;
        tradeSummary.toAmount = null;
      }
    });

    watch(() => shouldSwitchTokensForLimit.value, () => {
      if (!priceLimit.value || isNaN(priceLimit.value)) return priceLimit.value = 0;
      priceLimit.value = 1/priceLimit.value; // Invert the price limit
    });

    function cancelLimitOrder(id) {
      pendingLimitOrders.value = pendingLimitOrders.value.filter(o => o.id !== id);

      window.electronAPI.deletePendingOrder(id);
    }

    function setMarketPriceAsLimit() {
      // Use the current market price (fromToken to toToken)
      if (
        tokensByAddresses.value[fromTokenAddress.value]?.price &&
        tokensByAddresses.value[toTokenAddress.value]?.price
      ) {
        const fromPrice = tokensByAddresses.value[fromTokenAddress.value].price;
        const toPrice = tokensByAddresses.value[toTokenAddress.value].price;
        // Price of 1 fromToken in toToken units
        const marketPrice = !shouldSwitchTokensForLimit.value
          ? fromPrice / toPrice
          : toPrice / fromPrice;
        priceLimit.value = Number(marketPrice.toPrecision(8));
      }
    }

    function formatUsdPrice(price) {
      if (!price || isNaN(price)) return '0.00';
      
      const fromToken = tokensByAddresses.value[fromTokenAddress.value];
      const toToken = tokensByAddresses.value[toTokenAddress.value];
      
      if (!fromToken?.price || !toToken?.price) return '0.00';
      
      // Calculate USD value based on which token we're pricing
      let usdValue;
      if (!shouldSwitchTokensForLimit.value) {
        usdValue = price * toToken.price;
      } else {
        usdValue = price * fromToken.price;
      }
      
      let displayedUsdValue = usdValue >= 0.01 ? usdValue.toFixed(2) : usdValue.toFixed(6);
      if (displayedUsdValue === '0.000000') {
        displayedUsdValue = usdValue.toFixed(9);
      }
      return displayedUsdValue
    }

    watch(
      () => fromTokenAddress.value,
      async (fromTokenAddressValue) => {
        if (tabOrder.value !== 'limit') return;
        if (fromTokenAddressValue !== ethers.constants.AddressZero) {
          await checkAllowances(fromTokenAddressValue, true);
          await checkAllowances(fromTokenAddressValue, false);
        }
      }
    );

    watch(
      () => senderDetails.value,
      async () => {
        if (tabOrder.value !== 'limit') return;
        await checkAllowances(fromTokenAddress.value, true);
        await checkAllowances(fromTokenAddress.value, false);
      }
    );

    function placeLimitOrder() {
      if (!senderDetails.value.address) {
        swapMessage.value = 'Please select a sender address first';
        return;
      }
      if (!fromAmount.value || isNaN(fromAmount.value) || fromAmount.value <= 0) {
        swapMessage.value = 'Please enter a valid amount to trade';
        return;
      }
      if (!priceLimit.value || isNaN(priceLimit.value) || priceLimit.value <= 0) {
        swapMessage.value = 'Please enter a valid price limit';
        return;
      }

      // Calculate current market price to determine order type
      const fromPrice = tokensByAddresses.value[fromTokenAddress.value]?.price;
      const toPrice = tokensByAddresses.value[toTokenAddress.value]?.price;
      
      if (!fromPrice || !toPrice) {
        swapMessage.value = 'Unable to get current market prices';
        return;
      }

      if (!computedBalancesByAddress.value[senderDetails.value.address.toLowerCase()]?.[fromTokenAddress.value.toLowerCase()]) {
        swapMessage.value = 'No balances found for the selected address and from token';
        return;
      } else if (computedBalancesByAddress.value[senderDetails.value.address.toLowerCase()][fromTokenAddress.value.toLowerCase()] < fromAmount.value) {
        swapMessage.value = 'Insufficient balance for the selected from token';
        return;
      }

      // Current market price (fromToken to toToken)
      const currentMarketPrice = !shouldSwitchTokensForLimit.value
        ? fromPrice / toPrice
        : toPrice / fromPrice;

      // Calculate expected output amount based on limit price
      const expectedToAmount = !shouldSwitchTokensForLimit.value
        ? (fromAmount.value * priceLimit.value).toFixed(6)
        : (fromAmount.value / priceLimit.value).toFixed(6);

      // Determine order type based on price comparison
      // When shouldSwitchTokensForLimit is true, the comparison logic is inverted
      let orderType;
      if (!shouldSwitchTokensForLimit.value) {
        // Normal case: fromToken price in terms of toToken
        if (priceLimit.value > currentMarketPrice) {
          orderType = 'take_profit'; // Trigger when price goes above limit
        } else {
          orderType = 'stop_loss'; // Trigger when price goes below limit
        }
      } else {
        // Inverted case: toToken price in terms of fromToken
        // When the price is inverted, "higher limit" means "lower original price"
        if (priceLimit.value > currentMarketPrice) {
          orderType = 'stop_loss'; // This actually means the original price went DOWN
        } else {
          orderType = 'take_profit'; // This actually means the original price went UP
        }
      }

      const order = {
        id: Date.now(),
        fromAmount: fromAmount.value,
        toAmount: expectedToAmount, // Use calculated expected amount
        fromToken: JSON.parse(JSON.stringify(tokensByAddresses.value[fromTokenAddress.value])),
        toToken: JSON.parse(JSON.stringify(tokensByAddresses.value[toTokenAddress.value])),
        priceLimit: priceLimit.value,
        currentMarketPrice: currentMarketPrice,
        orderType: orderType, // 'take_profit' or 'stop_loss'
        shouldSwitchTokensForLimit: shouldSwitchTokensForLimit.value,
        sender: JSON.parse(JSON.stringify(senderDetails.value)),
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      pendingLimitOrders.value.unshift(order);

      // Save to database with order type information
      window.electronAPI.savePendingOrder(order);
      
      increaseOffsetBalance(
        order.fromToken.address.toLowerCase(),
        order.sender.address.toLowerCase(),
        order,
      );

      swapMessage.value = `Limit order placed`;
    }

    let isCheckingPendingOrders = false;
    async function checkPendingOrdersToTrigger() {
      if (isCheckingPendingOrders) return;
      isCheckingPendingOrders = true;

      if (!senderDetails.value?.address) return console.log('skipping pending orders check, no sender address');
      if (!pendingLimitOrders.value || !pendingLimitOrders.value.length) return;

      console.log('Checking pending limit orders...');
      try {
        await setTokenPrices(tokens);
      } catch (error) {
        console.error('Error updating token prices:', error);
      }
      console.log('after setTokenPrices');
      for (const order of pendingLimitOrders.value) {
        // Skip if order is not pending
        if (!order || !order.status || order.status !== 'pending') continue;
        
        try {
          // Get current token prices from our updated token list
          const fromToken = tokensByAddresses.value[order.fromToken.address];
          const senderD = props.addresses.find((a) => a.address.toLowerCase() === order.sender.address.toLowerCase());
          console.log(order.fromAmount)
          console.log(senderD.balances)
          if (senderD?.balances == null || !fromToken) {
            console.log(`Skipping order ${order.id} due to missing token or sender data`);
            continue;
          }
          console.log(senderD.balances[fromToken.address.toLowerCase()])
          if (Number(order.fromAmount) > senderD.balances[fromToken.address.toLowerCase()]) {
            order.isWaitingBalance = true;
            continue;
          } else if (order.isWaitingBalance) {
            order.isWaitingBalance = false;
          }

          const toToken = tokensByAddresses.value[order.toToken.address];
          
          if (!fromToken?.price || !toToken?.price) {
            console.log(`Missing price data for order ${order.id}: fromToken=${fromToken?.symbol} price=${fromToken?.price}, toToken=${toToken?.symbol} price=${toToken?.price}`);
            continue;
          }

          // Calculate current market price using token prices
          let currentMarketPrice;
          if (!order.shouldSwitchTokensForLimit) {
            // Normal case: fromToken price in terms of toToken
            currentMarketPrice = fromToken.price / toToken.price;
          } else {
            // Inverted case: toToken price in terms of fromToken
            currentMarketPrice = toToken.price / fromToken.price;
          }

          // Define price tolerance (e.g., within 1% of trigger price)
          const PRICE_TOLERANCE = 0.01; // 1%
          const priceDifference = Math.abs(currentMarketPrice - order.priceLimit) / order.priceLimit;
          
          // Only proceed with expensive getBestTrades call if we're close to trigger price
          let shouldCheckExactPrice = false;
          let shouldTrigger = false;

          console.log(order)
          if (order.orderType === 'take_profit') {
            // For take profit: trigger when current price >= limit price
            // Check exact price if we're within tolerance or already above
            shouldCheckExactPrice = currentMarketPrice >= order.priceLimit || priceDifference <= PRICE_TOLERANCE;
          } else if (order.orderType === 'stop_loss') {
            // For stop loss: trigger when current price <= limit price
            // Check exact price if we're within tolerance or already below
            shouldCheckExactPrice = currentMarketPrice <= order.priceLimit || priceDifference <= PRICE_TOLERANCE;
          } else {
            // Default behavior (legacy support)
            shouldCheckExactPrice = currentMarketPrice >= order.priceLimit || priceDifference <= PRICE_TOLERANCE;
          }

          if (!shouldCheckExactPrice) {
            // Price is not close enough to trigger, log and continue
            console.log(`Order ${order.id} (${order.orderType || 'limit'}): market price ${currentMarketPrice.toFixed(6)} not close to limit ${order.priceLimit} (diff: ${(priceDifference * 100).toFixed(2)}%) - skipping exact price check`);
            continue;
          }

          console.log(`Order ${order.id} (${order.orderType || 'limit'}): market price ${currentMarketPrice.toFixed(6)} is close to limit ${order.priceLimit} - checking exact execution price`);

          // Get exact trade execution price by fetching best trades
          const bestTradeResult = await getBestTrades(
            order.fromToken.address,
            order.toToken.address,
            order.fromAmount,
            order.sender.address,
            true,
            true,
            tokensByAddresses.value[order.fromToken.address].price * Number(order.fromAmount) >= 100,
          );

          // Calculate exact execution price (output amount per input amount)
          let exactExecutionPrice = Number(bestTradeResult.totalHuman) / Number(order.fromAmount);
          
          console.log({exactExecutionPrice})
          console.log(props.maxGasPrice && Number(props.maxGasPrice) * 1e9 < Number(props.gasPrice))
          if (props.maxGasPrice && Number(props.maxGasPrice) * 1e9 < Number(props.gasPrice)) {
            console.warn(`Gas price ${props.gasPrice} is higher than max gas price ${props.maxGasPrice * 1e9}, deducing from execution price`);
            exactExecutionPrice = (Number(bestTradeResult.totalHuman) - bestTradeResult.gasLimit * Number(props.gasPrice) * props.ethPrice/tokensByAddresses.value[order.toToken.address].price) 
              / Number(order.fromAmount);
            console.log(`Adjusted execution price after gas deduction: ${exactExecutionPrice.toFixed(9)}`);
          }
          console.log({exactExecutionPrice})

          // Determine if order should be triggered based on exact execution price
          if (order.orderType === 'take_profit') {
            shouldTrigger = exactExecutionPrice >= order.priceLimit;
          } else if (order.orderType === 'stop_loss') {
            shouldTrigger = exactExecutionPrice <= order.priceLimit;
          } else {
            shouldTrigger = exactExecutionPrice >= order.priceLimit;
          }

          if (shouldTrigger) {
            console.log(`Triggering ${order.orderType || 'limit'} order ${order.id}: exact execution price ${exactExecutionPrice.toFixed(10)} meets ${order.orderType === 'stop_loss' ? 'stop loss' : 'take profit'} limit ${order.priceLimit}`);
            
            // Create a trade summary object for this limit order
            const limitOrderTradeSummary = {
              protocol: bestTradeResult.protocol,
              sender: order.sender,
              fromAmount: order.fromAmount.toString(),
              toAmount: bestTradeResult.totalHuman,
              expectedToAmount: bestTradeResult.totalHuman,
              fromTokenSymbol: bestTradeResult.fromToken.symbol,
              toTokenSymbol: bestTradeResult.toToken.symbol,
              fromAddressName: order.sender.name,
              fromToken: bestTradeResult.fromToken,
              fromTokenAddress: bestTradeResult.fromToken.address,
              toToken: bestTradeResult.toToken,
              toTokenAddress: bestTradeResult.toToken.address,
              gasLimit: bestTradeResult.gasLimit,
            };

            if (bestTradeResult.bestMixed) {
              limitOrderTradeSummary.fromAmountU = (order.fromAmount * bestTradeResult.fractionMixed / 100).toFixed(7);
              limitOrderTradeSummary.fromAmountB = (order.fromAmount - Number(limitOrderTradeSummary.fromAmountU)).toFixed(7);
              limitOrderTradeSummary.toAmountU = Number(ethers.utils.formatUnits(bestTradeResult.bestMixed.tradesU.totalBig, bestTradeResult.toToken.decimals)).toFixed(7);
              limitOrderTradeSummary.toAmountB = Number(ethers.utils.formatUnits(bestTradeResult.bestMixed.tradesB.outputAmount, bestTradeResult.toToken.decimals)).toFixed(7);
              limitOrderTradeSummary.fraction = bestTradeResult.fractionMixed;
            }

            try {
              // Execute the trade with the specific trades and summary for this order
              await triggerTrade(bestTradeResult.trades, limitOrderTradeSummary);

              // Only mark as completed if trade was successful
              order.status = 'completed';
              order.completedAt = new Date().toISOString();
              order.executionPrice = exactExecutionPrice;
              
              // Remove from local array
              pendingLimitOrders.value = pendingLimitOrders.value.filter(o => o.id !== order.id);
              
              // Update in database
              await window.electronAPI.updatePendingOrder(JSON.parse(JSON.stringify(order)));
              
              console.log(`${order.orderType || 'Limit'} order ${order.id} completed successfully at price ${exactExecutionPrice}`);
            } catch (tradeError) {
              console.error(`Failed to execute trade for order ${order.id}:`, tradeError);
              order.status = 'failed';

              const failedTradeEntry = {
                ...limitOrderTradeSummary,
                sentDate: new Date(),
                isConfirmed: true,
                timestamp: new Date(),
              };

              // Emit the failed trade to be added to history
              emit('update:trade', failedTradeEntry);

              // Mark order as failed and update in database
              order.status = 'failed';
              order.failedAt = new Date().toISOString();
              order.errorMessage = tradeError.message || String(tradeError);
              await window.electronAPI.updatePendingOrder(order);

              // Remove from pending orders list
              pendingLimitOrders.value = pendingLimitOrders.value.filter(o => o.id !== order.id);              // Save to database
              await window.electronAPI.saveFailedTrade(failedTradeEntry);
            }
          } else {
            // Log exact price vs target for debugging
            console.log(`Order ${order.id} (${order.orderType || 'limit'}): exact execution price ${exactExecutionPrice.toFixed(9)} vs limit ${order.priceLimit} - not triggered`);
          }
        } catch (error) {
          console.error(`Error checking limit order ${order.id}:`, error);
        }
        isCheckingPendingOrders = false;
      }
    }

    watch (() => props.addresses, async () => {
      await new Promise(r => setTimeout(r, 2000));
      checkPendingOrdersToTrigger();
    })

    const checkOrdersInterval = setInterval(checkPendingOrdersToTrigger, 12000);

    // Clear interval on component unmount
    onUnmounted(() => {
      if (checkOrdersInterval) {
        clearInterval(checkOrdersInterval);
      }
      if (priceUpdateInterval) {
        clearInterval(priceUpdateInterval);
      }
    });

    return {
      // state
      isEditingTokens,
      tokens,
      fromAmount,
      fromTokenAddress,
      toTokenAddress,
      senderDetails,
      tabOrder,
      isSwapButtonDisabled,
      needsToApprove,
      trades,
      tradeSummary,
      isFetchingPrice,
      priceFetchingMessage,
      swapMessage,
      shouldUseUniswap,
      shouldUseBalancer,
      shouldUseUniswapAndBalancer,
      priceLimit,
      slippage,

      // refs & images
      chevronDownImage,
      reverseImage,
      downArrowImage,
      deleteImage,

      // computed
      filteredTokens,
      tokensByAddresses,
      computedBalancesByAddress,
      balanceString,
      spaceThousands: spaceThousandsFn,

      // methods
      switchTokens,
      triggerTrade,
      approveSpending,
      findSymbol,
      deleteToken,
      shouldSwitchTokensForLimit,
      setMarketPriceAsLimit,

      pendingLimitOrders,
      placeLimitOrder,
      cancelLimitOrder,
      formatUsdPrice
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
  max-width: 420px;
  margin-left: auto;
  margin-right: auto;
  border: 1px solid #ccc;
  margin-bottom: 2px;
  transition: border 0.3s ease;
  padding-bottom: 15px;
  padding-left: 10px;
  height: 90px;
  position: relative;
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
  width: 240px;
  border: none;
  text-align: left;
  padding: 10px;
  font-weight: 500;
  font-size: 23px;
  display: inline-block;
}
.to-swap span {
  background-color: #fff;
  width: 240px;
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
  width: 400px;
}
.right-price {
  position: absolute;
  right: 40px;
  bottom: 15px;
  color: #666;
  font-size: .9em;
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
  height: 20px;
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

.checkboxes {
  margin-left: auto;
  margin-right: auto;
  margin-top: 15px;
}
.checkboxes input {
  width: 30px;
}

.cancel-order {
  cursor: pointer;
  font-weight: 600;
  padding: 5px;
}
.cancel-order:hover {
  color: #ff3333;
}

.set-market-price {
  cursor: pointer;
  font-weight: 500;
  padding: 5px;
  margin-left: 10px;
  text-decoration: underline;
}
.set-market-price:hover {
  color: #007bff;
}
.pending-order {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 5px;
  margin-bottom: 10px;
  background-color: #f9f9f9;
}

.order-info {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}

.order-type {
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 5px;
}

.order-type.take_profit {
  color: #28a745; /* Green for take profit */
}

.order-type.stop_loss {
  color: #dc3545; /* Red for stop loss */
}

.order-details {
  font-size: 16px;
  font-weight: 500;
}

.order-meta {
  font-size: 12px;
  color: #666;
  margin-top: 5px;
  display: flex;
  justify-content: space-between;
}
.usd-price-quote {
  font-size: 14px !important;
  color: #666 !important;
  margin-left: 10px !important;
  font-weight: 500 !important;
}

.trade-info {
  display: flex;
  justify-content: space-between;
}

.right {
  padding-right: 20px;
}

.is-waiting-balance {
  background-color: #ff990090; /* Orange for waiting balance */
  font-weight: 600;
}

</style>