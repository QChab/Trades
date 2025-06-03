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
            </div>
            <span v-if="fromAmount" class="usd-amount">
              ${{ spaceThousands((fromAmount * tokensByAddresses[fromTokenAddress].price).toFixed(1)) }}
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
                  {{ token.symbol }} ${{ token.price.toFixed(5) }}
                </option>
              </select>
            </div>
            <span v-if="tradeSummary.toAmount && !isFetchingPrice" class="usd-amount">
              <span v-if="tokensByAddresses[toTokenAddress].price">
                ${{ spaceThousands((Number(tradeSummary.toAmount) * tokensByAddresses[toTokenAddress].price).toFixed(1)) }}
              </span>
              <span v-if="tokensByAddresses[fromTokenAddress].price && tokensByAddresses[toTokenAddress].price">
                ({{ -((fromAmount * tokensByAddresses[fromTokenAddress].price - Number(tradeSummary.toAmount) * tokensByAddresses[toTokenAddress].price) * 100 / (fromAmount * tokensByAddresses[fromTokenAddress].price)).toFixed(3) }}%)
              </span>
            </span>
          </div>

          <p class="details-message">{{ priceFetchingMessage }}</p>
          <div class="address-form">
            <!-- <p v-if="trades.length">{{ trades.length }} leg<span v-if="trades.length > 1">s</span> </p> -->
            <p>with</p>
            <select id="sender-address" v-model="senderDetails">
              <option 
                v-for="(address, index) in addresses" 
                :value="address" 
                :key="'sender-' + address.address"
              >
                {{ address.name }} - 0x{{ address.address.substring(2, 6) }}:
                {{ balanceString(address.address, fromTokenAddress) }} {{ tokensByAddresses[fromTokenAddress].symbol }}
              </option>
            </select>
          </div>

          <p class="details-message">{{ swapMessage }}</p>
          <button
            v-if="!needsToApprove"
            @click="triggerTrade()"
            :disabled="isSwapButtonDisabled || isFetchingPrice || maxGasPrice < gasPrice || trades.length === 0"
            class="swap-button"
          >
            {{ (isSwapButtonDisabled && trades.length > 0 && !isFetchingPrice) ? 'Swapping...' : 'Swap' }}
          </button>
          <button
            v-else
            @click="approveSpending()"
            :disabled="isSwapButtonDisabled || isFetchingPrice || maxGasPrice < gasPrice || trades.length === 0"
            class="swap-button"
          >
            {{ (isSwapButtonDisabled && trades.length > 0) ? ('Approving ' + tokensByAddresses[fromTokenAddress]?.symbol) : 'Approve' }}
          </button>
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
      <!-- Pending trades list -->
    </div>
  </div>
</template>

<script>
import { ref, reactive, watch, onMounted, computed, toRaw } from 'vue';
import { ethers, BigNumber } from 'ethers';
import chevronDownImage from '@/../assets/chevron-down.svg';
import reverseImage from '@/../assets/reverse.svg';
import downArrowImage from '@/../assets/down-arrow.svg';
import deleteImage from '@/../assets/delete.svg';
import { useUniswapV4 } from '../composables/useUniswap';
import spaceThousands from '../composables/spaceThousands';
import JSBI from 'jsbi';

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
    const PERMIT2_UNISWAPV4_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
    const UNIVERSAL_ROUTER_ADDRESS   = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af';
    const ERC20_ABI = [
      "function symbol() view returns (string)",
      "function decimals() view returns (uint256)",
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address owner, address spender) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
    ];

    const {
      findPossiblePools,
      selectBestPath,
      executeSwapExactIn,
      executeMixedSwaps,
    } = useUniswapV4();

    // ─── Reactive State ─────────────────────────────────────────────────────
    const isEditingTokens = ref(false);
    const fromAmount       = ref(null);
    const fromTokenAddress = ref(null);
    const toTokenAddress   = ref(null);
    const senderDetails    = ref(null);
    const tabOrder         = ref('market');
    const isSwapButtonDisabled = ref(false);
    const needsToApprove   = ref(false);
    const slippage         = ref(50);

    const tokens = reactive([
      { price: 0, address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 },
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
    });

    const isFetchingPrice    = ref(false);
    const priceFetchingMessage = ref('');
    const swapMessage        = ref('');

    // We keep a small “offset” map so that once a trade is sent, we subtract it from balance
    const balanceOffsetByTokenByAddress = reactive({});

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
          if (balanceOffsetByTokenByAddress[tokAddr] &&
              balanceOffsetByTokenByAddress[tokAddr][addr]) {
            bal -= balanceOffsetByTokenByAddress[tokAddr][addr];
          }
          result[addr][tokAddr] = bal;
        }
      }
      return result;
    });

    // Helper: “5.12345” → formatted string with spaces every 3 digits
    const spaceThousandsFn = (str) => spaceThousands(str);

    // Helper: get a user’s token‐balance as a string with 5 decimals
    const balanceString = (ownerAddress, tokenAddr) => {
      if (!ownerAddress || !tokenAddr) return '0.00000';
      const b = computedBalancesByAddress.value[ownerAddress?.toLowerCase()]?.[tokenAddr] || 0;
      return b.toFixed(5);
    };

    // ─── Watchers ─────────────────────────────────────────────────────────────

    // Whenever props.confirmedTrade changes, adjust our offset map
    watch(() => props.confirmedTrade, (confirmed) => {
      if (!confirmed) return;
      const sender = confirmed.sender?.address?.toLowerCase();
      const tok    = confirmed.fromToken?.address;
      const amt    = Number(confirmed.fromAmount);
      if (!sender || !tok || isNaN(amt)) return;

      if (
        balanceOffsetByTokenByAddress[tok] &&
        balanceOffsetByTokenByAddress[tok][sender] >= amt
      ) {
        balanceOffsetByTokenByAddress[tok][sender] -= amt;
      }
    });

    // Whenever fromToken, toToken, fromAmount, trades, or sender changes → re‐quote
    let debounceTimer = null;
    watch(
      [
        () => fromTokenAddress.value,
        () => toTokenAddress.value,
        () => fromAmount.value,
        () => senderDetails.value
      ],
      async ([_newFrom, _newTo, _newAmt, _newSender], [_oldFrom, _oldTo]) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        priceFetchingMessage.value = '';
        swapMessage.value = '';
        trades.value = [];
        tradeSummary.toAmount = null;
        isFetchingPrice.value = true;

        // If any of the essentials is missing or invalid, skip re‐quoting
        if (
          !_newFrom ||
          !_newTo ||
          !_newSender?.address ||
          !_newAmt ||
          _newAmt === '.' ||
          _newAmt <= 0
        ) {
          isFetchingPrice.value = false;
          return;
        }

        // If tokens changed, reset summary & approval state
        if (_oldFrom !== _newFrom || _oldTo !== _newTo) {
          tradeSummary.toAmount = '0';
          needsToApprove.value = false;
        }

        debounceTimer = setTimeout(async () => {
          try {
            // FINDING POOLS
            const pools = await findPossiblePools(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo]);
            
            // SECURITY CHECKS: ensure each leg’s input/output token matches our chosen tokens
            if (_newFrom !== fromTokenAddress.value.toLowerCase() || _newTo !== toTokenAddress.value.toLowerCase()) {
              console.log('Outdated token pair in first check');
              isFetchingPrice.value = false;
              return;
            }
            if (_newAmt !== fromAmount.value) {
              console.log('Outdated input amount in first check');
              isFetchingPrice.value = false;
              return;
            }

            // FINDING TRADES
            const fromAmtRaw = ethers.utils.parseUnits(
              _newAmt.toString(),
              tokensByAddresses.value[_newFrom].decimals
            );
            const bestTrades = await selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, fromAmtRaw);

            console.log(bestTrades);

            // Filter out any null/undefined
            const validTrades = bestTrades.filter(t => t && t.outputAmount);
            if (validTrades.length === 0) {
              throw new Error('No output amount found');
            }

            const totalBig = validTrades.reduce(
              (acc, t) => {
                const legInBN = BigNumber.from(t.outputAmount.quotient.toString());
                return acc.add(legInBN);
              },
              BigNumber.from(0)
            );
            const totalHuman = ethers.utils.formatUnits(totalBig, tokensByAddresses.value[_newTo].decimals);

            // SECURITY CHECKS: ensure each leg’s input/output token matches our chosen tokens
            for (const t of validTrades) {
              const inAddr  = t.inputAmount.currency.address.toLowerCase();
              const outAddr = t.outputAmount.currency.address.toLowerCase();
              if (inAddr !== fromTokenAddress.value.toLowerCase() || outAddr !== toTokenAddress.value.toLowerCase()) {
                console.log('Outdated token pair');
                isFetchingPrice.value = false;
                return;
              }
            }

            const decimalsIn = tokensByAddresses.value[_newFrom].decimals; // e.g. 18 for WETH, 6 for USDT
            const expectedInRawBN = ethers.utils.parseUnits(fromAmount.value + '', decimalsIn);
            
            const totalInBN = validTrades.reduce(
              (acc, t) => {
                // Convert each JSBI quotient → string → BigNumber, then add
                const legInBN = BigNumber.from(t.inputAmount.quotient.toString());
                return acc.add(legInBN);
              },
              BigNumber.from(0)
            );

            if (!totalInBN.eq(expectedInRawBN)) {
              console.log('Outdated input amount, sum of input of trades: ' + totalInBN.toString());
              isFetchingPrice.value = false;
              return;
            }

            // 4) Populate our reactive state
            trades.value = validTrades;

            tradeSummary.sender    = _newSender;
            tradeSummary.fromAmount    = _newAmt.toString();
            tradeSummary.toAmount      = totalHuman.length > 9 && totalHuman[0] !== '0' ? Number(totalHuman).toFixed(2) : Number(totalHuman).toFixed(5);
            tradeSummary.expectedToAmount = totalHuman.length > 9 && totalHuman[0] !== '0' ? Number(totalHuman).toFixed(2) : Number(totalHuman).toFixed(5);
            tradeSummary.fromTokenSymbol = tokensByAddresses.value[_newFrom].symbol;
            tradeSummary.toTokenSymbol   = tokensByAddresses.value[_newTo].symbol;
            tradeSummary.fromAddressName = `${senderDetails.value.name}`;
            tradeSummary.fromToken = tokensByAddresses.value[_newFrom];
            tradeSummary.toToken = tokensByAddresses.value[_newTo];

            // 5) Check if approval is needed (only for the “from” token)
            if (_newFrom !== ethers.constants.AddressZero) {
              const erc20 = new ethers.Contract(
                _newFrom, ERC20_ABI, toRaw(props.provider)
              );
              const rawAllowance = await erc20.allowance(
                senderDetails.value.address,
                PERMIT2_UNISWAPV4_ADDRESS
              );
              // If allowance < 1e27 (arbitrary “sufficient” threshold), require approval
              if (BigNumber.from(rawAllowance).lt(BigNumber.from('1000000000000000000000000000'))) {
                needsToApprove.value = true;
              } else {
                // double‐check Permit2 → Router allowance
                const permit2 = new ethers.Contract(
                  PERMIT2_UNISWAPV4_ADDRESS, 
                  ["function allowance(address owner,address token,address spender) view returns (uint160,uint48,uint48)"],
                  toRaw(props.provider)
                );
                const [remaining] = await permit2.allowance(
                  senderDetails.value.address,
                  _newFrom,
                  UNIVERSAL_ROUTER_ADDRESS
                );
                if (BigNumber.from(remaining).lt(BigNumber.from('1000000000000000000000000000'))) {
                  needsToApprove.value = true;
                } else {
                  needsToApprove.value = false;
                }
              }
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
          }

          isFetchingPrice.value = false;
        }, 500);
      },
      { deep: true }
    );

    // Whenever props.ethPrice changes, re‐fetch token prices
    const SUBGRAPH_URL = `https://gateway.thegraph.com/api/85a93cb8cc32fa52390e51a09125a6fc/subgraphs/id/DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G`;
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

    const setTokenPrices = async (tokenArray) => {
      for (const token of tokenArray) {
        if (!token.address) continue;
        try {
          token.price = await tokenUsd(token.address, props.ethPrice);
        } catch {
          token.price = 0;
        }
      }
    };
    watch(() => props.ethPrice, () => setTokenPrices(tokens), { immediate: true });
    setInterval(() => setTokenPrices(tokens), 180_000);

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
          tokens[index].price = await tokenUsd(contractAddress, props.ethPrice);
        } else if (ethers.utils.isAddress(contractAddress)) {
          tokens[index].decimals = await getTokenDecimals(contractAddress);
          tokens[index].symbol   = await getTokenSymbol(contractAddress);
          tokens[index].price    = await tokenUsd(contractAddress, props.ethPrice);
        } else {
          tokens[index].symbol = null;
        }
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

    const shouldSwitchTokensForLimit = ref(false);


    // ─── triggerTrade(): Execute *all* legs in one Universal Router call ────
    const triggerTrade = async () => {
      try {
        isSwapButtonDisabled.value = true;
        swapMessage.value = '';

        // Mark summary as “pending”
        tradeSummary.txId = 'pending';
        tradeSummary.sentDate = new Date();
        tradeSummary.isConfirmed = false;

        // Basic balance check for ETH → gas
        if (fromTokenAddress.value === ethers.constants.AddressZero) {
          const addr = senderDetails.value.address.toLowerCase();
          const bal = computedBalancesByAddress.value[addr]?.[fromTokenAddress.value] || 0;
          if (bal - Number(fromAmount.value) < 0.004) {
            throw new Error('Insufficient ETH for gas on ' + addr);
          }
        }

        // Call our adapted executeSwapExactIn, passing the *array* of trades
        const { success, warnings, tx, error } = await executeMixedSwaps(
          trades.value,
          tradeSummary,
          slippage.value,
          props.gasPrice
        );

        if (!success) {
          // Roll back summary
          tradeSummary.txId     = null;
          tradeSummary.sentDate = null;
          console.error(error)
          if (error.toString().includes('insufficient funds for intrinsic transaction cost')) {
            swapMessage.value = 'Error: Not enough ETH on the address';
          } else if (error.toString().includes('cannot estimate gas')) {
            swapMessage.value = 'Error: Preventing failed swap';
          } else {
            swapMessage.value = error.message || String(error);
          }
          if (warnings && warnings.length) {
            swapMessage.value += ' | Warnings: ' + warnings.join(' ; ');
          }
          return;
        }

        // Subtract “from amount” from our local offset map
        const tokLower = fromTokenAddress.value.toLowerCase();
        const senderLc = senderDetails.value.address.toLowerCase();
        if (!balanceOffsetByTokenByAddress[tokLower]) {
          balanceOffsetByTokenByAddress[tokLower] = {};
        }
        if (!balanceOffsetByTokenByAddress[tokLower][senderLc]) {
          balanceOffsetByTokenByAddress[tokLower][senderLc] = 0;
        }
        balanceOffsetByTokenByAddress[tokLower][senderLc] += Number(fromAmount.value);

        // Finalize summary & emit upwards
        tradeSummary.txId = tx.hash;
        tradeSummary.fromTokenSymbol = tokensByAddresses.value[fromTokenAddress.value].symbol;
        tradeSummary.toTokenSymbol   = tokensByAddresses.value[toTokenAddress.value].symbol;

        if (warnings && warnings.length) {
          swapMessage.value = 'Warnings: ' + warnings.join(' ; ');
        }
        emit('update:trade', { ...tradeSummary });
      } catch (err) {
        swapMessage.value = err.message || String(err);
        console.error(err);
      } finally {
        isSwapButtonDisabled.value = false;
      }
    };

    // ─── approveSpending(): Approve ERC20 → Permit2 → Router ───────────────
    const approveSpending = async () => {
      try {
        isSwapButtonDisabled.value = true;
        const originalAddress = senderDetails.value.address;

        const { success, error } = await window.electronAPI.approveSpender(
          originalAddress,
          fromTokenAddress.value,
          PERMIT2_UNISWAPV4_ADDRESS,
          props.gasPrice
        );
        if (!success) throw error;

        // Poll until allowance has shown up on‐chain
        let allowance = BigNumber.from(0);
        while (allowance.isZero() && originalAddress === senderDetails.value.address) {
          const erc20 = new ethers.Contract(
            fromTokenAddress.value, ERC20_ABI, toRaw(props.provider)
          );
          allowance = await erc20.allowance(originalAddress, PERMIT2_UNISWAPV4_ADDRESS);
          if (allowance.isZero()) {
            await new Promise(r => setTimeout(r, 2000));
          }
        }

        // Now check Permit2's allowance → Router
        const permit2 = new ethers.Contract(
          PERMIT2_UNISWAPV4_ADDRESS,
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

    return {
      // state
      isEditingTokens,
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