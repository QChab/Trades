<template>
  <div class="manual-trading">
    <!-- Token selection list -->
    <div class="form-group">
      <div class="top-nav-bar">
        <div 
          :class="{'active-tab': currentMode === 'manual'}"
          @click="currentMode='manual'"
        > 
          <h3> Manual trade </h3>
        </div>
        <div 
          :class="{'active-tab': currentMode === 'automatic'}"
          @click="currentMode='automatic'"
        >
          <h3> Automatic trade</h3>
        </div>
      </div>
      <button
        class="edit-button"
        @click="toggleEditingTokens"
      >
        {{ isEditingTokens ? 'Stop editing' : 'Edit tokens' }}
      </button>
      <div>
        <div v-if="!isEditingTokens && currentMode === 'manual'">
          <div class="price-form">
            <div class="tabs-price">
              <div
                :class="{active: tabOrder === 'market'}"
                @click="tabOrder = 'market'"
              >
                Market order
              </div>
              <div
                :class="{active: tabOrder === 'limit'}"
                @click="tabOrder = 'limit'"
              >
                Limit order
              </div>
            </div>
            <div v-if="tabOrder === 'limit'">
              <p>
                when 1 {{ !shouldSwitchTokensForLimit ? tokensByAddresses[fromTokenAddress]?.symbol : tokensByAddresses[toTokenAddress]?.symbol }} = 
                <input
                  v-model.number="priceLimit"
                  type="number"
                  placeholder="0"
                > 
                {{ shouldSwitchTokensForLimit ? tokensByAddresses[fromTokenAddress]?.symbol : tokensByAddresses[toTokenAddress]?.symbol }}
                <span
                  v-if="priceLimit && tokensByAddresses[fromTokenAddress]?.price && tokensByAddresses[toTokenAddress]?.price"
                  class="usd-price-quote"
                >
                  (${{ formatUsdPrice(priceLimit) }})
                </span>
                <img
                  :src="reverseImage"
                  class="reverse-image"
                  @click="shouldSwitchTokensForLimit = !shouldSwitchTokensForLimit"
                >
              </p>
              <!-- <span class="set-market-price" @click="setMarketPriceAsLimit()">
                Set market price
              </span> -->
            </div>
            <div
              v-else
              class="checkboxes"
            >
              <label>
                <input
                  v-model="shouldUseUniswap"
                  type="checkbox"
                > Uniswap
              </label>
              <label>
                <input
                  v-model="shouldUseBalancer"
                  type="checkbox"
                > Balancer
              </label>
              <label>
                <input
                  v-model="shouldUseUniswapAndBalancer"
                  type="checkbox"
                > Uniswap & Balancer
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
              >
              <select
                id="from-token"
                v-model="fromTokenAddress"
              >
                <option 
                  v-for="(token, index) in filteredTokens" 
                  :key="'fromToken-' + index" 
                  :value="token.address"
                >
                  {{ token.symbol }} ({{ balanceString(senderDetails?.address, token.address) }})
                </option>
              </select>
              <span class="right-price">
                @ ${{ spaceThousands(removeTrailingZeros(tokensByAddresses[fromTokenAddress]?.price)) }}
              </span>
            </div>
            <span
              v-if="fromAmount"
              class="usd-amount"
            >
              ${{ spaceThousands((fromAmount * tokensByAddresses[fromTokenAddress]?.price).toFixed(1)) }}
            </span>
          </div>

          <div class="to-swap">
            <img
              :src="downArrowImage"
              class="down-arrow-image"
              @click="switchTokens"
            >
            <p>Buy</p>
            <div
              v-if="tabOrder === 'market'"
              class="amount-token"
            >
              <span
                class="amount-out"
                :class="{'fetching-price': isFetchingPrice}"
              >
                {{ spaceThousands(tradeSummary.toAmount) }}
              </span>
              <select
                id="to-token"
                v-model="toTokenAddress"
              >
                <option 
                  v-for="(token, index) in filteredTokens" 
                  :key="'toToken-' + index" 
                  :value="token.address"
                >
                  {{ token.symbol }} ({{ balanceString(senderDetails?.address, token.address) }})
                </option>
              </select>
            </div>
            <div
              v-else
              class="amount-token"
            >
              <input
                v-model="tradeSummary.toAmount"
                class="amount-out"
                :class="{'fetching-price': isFetchingPrice}"
              >
              <!-- {{ spaceThousands(tradeSummary.toAmount) }}
              </input> -->
              <select
                id="to-token"
                v-model="toTokenAddress"
              >
                <option 
                  v-for="(token, index) in filteredTokens" 
                  :key="'toToken-' + index" 
                  :value="token.address"
                >
                  {{ token.symbol }} ({{ balanceString(senderDetails?.address, token.address) }})
                </option>
              </select>
            </div>
            <span
              v-if="tradeSummary.toAmount && !isFetchingPrice"
              class="usd-amount"
            >
              <span v-if="tokensByAddresses[toTokenAddress]?.price">
                ${{ spaceThousands((Number(tradeSummary.toAmount) * tokensByAddresses[toTokenAddress].price).toFixed(1)) }}
              </span>
              <span v-if="tokensByAddresses[fromTokenAddress]?.price && tokensByAddresses[toTokenAddress]?.price">
                ({{ -((fromAmount * tokensByAddresses[fromTokenAddress].price - Number(tradeSummary.toAmount) * tokensByAddresses[toTokenAddress].price) * 100 / (fromAmount * tokensByAddresses[fromTokenAddress].price)).toFixed(2) }}%)
              </span>
            </span>
            <p class="right-price">
              @ ${{ spaceThousands(removeTrailingZeros(tokensByAddresses[toTokenAddress]?.price)) }}
            </p>
          </div>

          <p class="details-message">
            {{ priceFetchingMessage }}
          </p>
          
          <!-- Effective Price Display -->
          <div
            v-if="effectivePrice"
            class="effective-price"
            style="margin-bottom: 10px; padding: 8px; background: rgba(255, 255, 255, 0.05); border-radius: 6px; font-size: 14px; color: #111; text-align: center;"
          >
            <div>1 {{ effectivePrice.toSymbol }} = {{ effectivePrice.pricePerToken }} {{ effectivePrice.fromSymbol }} ≈ ${{ effectivePrice.usdValue }}</div>
            <div>1 {{ effectivePrice.fromSymbol }} = {{ effectivePrice.inversedPricePerToken }} {{ effectivePrice.toSymbol }} ≈ ${{ effectivePrice.usdValueInverse }}</div>
          </div>
          
          <div class="address-form">
            <p>
              <span v-if="tradeSummary.protocol && tabOrder === 'market'">
                On {{ tradeSummary.protocol === 'Uniswap & Balancer' ? (`Uniswap ${tradeSummary.fraction}% & Balancer ${100 - tradeSummary.fraction}%`) : tradeSummary.protocol }}
              </span> with
            </p>
            <select
              id="sender-address"
              v-model="senderDetails"
            >
              <option 
                v-for="(address) in addresses" 
                :key="'sender-' + address.address" 
                :value="address"
              >
                {{ address.name }} - 0x{{ address.address.substring(2, 6) }}:
                {{ balanceString(address.address, fromTokenAddress) }} {{ tokensByAddresses[fromTokenAddress]?.symbol }}
              </option>
            </select>
          </div>

          <p class="details-message">
            {{ swapMessage }}
          </p>
          <div
            v-if="tabOrder === 'market' && !isEditingTokens"
            class="swap-buttons"
          >
            <div v-if="!needsToApprove">
              <p
                v-if="tradeSummary?.gasLimit"
                class="details-message"
              >
                Gas cost ~ ${{ (tradeSummary.gasLimit * ethPrice * Number(gasPrice) * 1.1 / 1e18).toFixed(2) }}
              </p>
              <button
                v-if="!needsToApprove"
                :disabled="isSwapButtonDisabled || isFetchingPrice || maxGasPrice < gasPrice || trades.length === 0"
                class="swap-button"
                @click="isSwapButtonDisabled=true; triggerTrade()"
              >
                {{ (isSwapButtonDisabled && trades.length > 0 && !isFetchingPrice) ? 'Swapping...' : 'Swap' }}
              </button>
            </div>
            <div v-else>
              <p class="details-message">
                Gas cost ~ ${{ ((tradeSummary.protocol === 'Uniswap' ? 100000 : 100000) * ethPrice * Number(gasPrice) * 1.1 / 1e18).toFixed(2) }}
              </p>
              <button
                :disabled="isSwapButtonDisabled || isFetchingPrice || maxGasPrice < gasPrice || trades.length === 0"
                class="swap-button"
                @click="approveSpending()"
              >
                {{ (isSwapButtonDisabled && trades.length > 0) ? ('Approving ' + tokensByAddresses[fromTokenAddress]?.symbol) : 'Approve' }}
              </button>
            </div>
          </div>
          <div v-else>
            <div v-if="!needsToApprove">
              <button
                v-if="!needsToApprove"
                :disabled="!priceLimit || !fromAmount || senderDetails?.address === ''"
                class="swap-button"
                @click="placeLimitOrder()"
              >
                {{ 'Place order' }}
              </button>
            </div>
            <div v-else>
              <p class="details-message">
                Gas cost ~ ${{ (150000 * ethPrice * Number(gasPrice) * 1.1 / 1e18).toFixed(2) }}
              </p>
              <button
                :disabled="maxGasPrice < gasPrice"
                class="swap-button"
                @click="approveSpending()"
              >
                {{ (isSwapButtonDisabled && trades.length > 0) ? ('Approving ' + tokensByAddresses[fromTokenAddress]?.symbol) : 'Approve' }}
              </button>
            </div>
          </div>
        </div>

        <div
          v-else-if="currentMode === 'automatic' && !isEditingTokens"
          class="automatic-mode"
          :class="{'no-addresses-unlocked': !addresses.length}"
        >
          <div class="automatic-header">
            <button 
              class="global-pause-btn" 
              :class="{ 'paused': isGloballyPaused }"
              :title="isGloballyPaused ? 'Unpause' : 'Pause'"
              @click="toggleGlobalPause"
            >
              {{ isGloballyPaused ? '▶️ Unpause' : '⏸️ Pause' }}
            </button>
            <div class="automatic-info">
              <h3 v-if="isInitialBalanceFetchDone">
                {{ automaticOrders.length }} buy/sell levels
              </h3>
              <h3 v-else>
                Initializing balances...
              </h3>
              <p>{{ automaticMessage }}</p>
            </div>
          </div>
          <div class="matrix">
            <div
              v-for="(tokenInRow, i) in tokensInRow"
              class="token-row"
            >
              <div
                v-if="tokenInRow?.token?.symbol"
                class="token-details"
              >
                <p class="token-symbol">
                  {{ tokenInRow.token.symbol || 'Select Token' }}
                </p>
                <p class="token-price">
                  ${{ spaceThousands(removeTrailingZeros(tokenInRow.token.price)) }}
                </p>
                <img
                  :src="deleteImage"
                  class="delete-row"
                  @click="deleteRow(i)"
                >
              </div>
              <div 
                v-if="tokenInRow?.token?.symbol"
                class="horizontal-scroll"
              >
                <div
                  v-for="(token, j) in tokenInRow.columns"
                  :key="token?.address + j + '-' + cell"
                >
                  <OrderBookLevels
                    v-if="token?.address && token.decimals"
                    :token-a="tokenInRow.token"
                    :token-b="token"
                    :tokens-by-addresses="tokensByAddresses"
                    :balances="computedBalancesByAddress"
                    :price-threshold="0.01"
                    :details="token.details"
                    :price-deviation-percentage="priceDeviationPercentage"
                    :existing-orders="allExistingOrders"
                    @order-update="(details) => updateDetailsOrder(i, j, details)"
                    @delete="deleteColumn(i, j)"
                  ></OrderBookLevels>
                </div>
                <div 
                  v-if="tokenInRow?.token?.address && !shouldSelectTokenInCell"
                  class="token-details new-cell-details"
                  @click="shouldSelectTokenInCell = true"
                >
                  +
                </div>
                <div
                  v-if="tokenInRow?.token?.address && shouldSelectTokenInCell"
                  class="token-details new-cell-details"
                >
                  <select
                    id="new-token-cell"
                    v-model="newCellTokenAddress"
                    @change="addCellToRow(i)"
                  >
                    <option 
                      v-for="(token, index) in filteredTokens.filter(t => t.address !== tokenInRow.token.address)" 
                      :key="'new-token-cell-' + index + token?.address" 
                      :value="token.address"
                    >
                      {{ token.symbol }}
                    </option>
                  </select>
                </div>
              </div>
            </div>
            <div 
              v-if="tokensInRow.filter(t => t?.symbol?.address).length < 12"
              class="token-details new-token-details"
            >
              <div
                v-if="!shouldSelectTokenInRow"
                class="token-symbol"
                @click="shouldSelectTokenInRow = true"
              >
                +
              </div>
              <select
                v-if="shouldSelectTokenInRow"
                id="new-token"
                v-model="newTokenAddress"
                @change="addRowToMatrix"
              >
                <option 
                  v-for="(token, index) in filteredTokens" 
                  :key="'fromToken-' + index" 
                  :value="token.address"
                >
                  {{ token.symbol }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <!-- EDITING TOKENS -->
        <div
          v-else
          class="editing-tokens"
        >
          <p class="text-center">
            Editing Tokens
          </p>
          <ul class="two-column-list">
            <li
              v-for="(token, index) in tokens"
              :key="index"
            >
              <span v-if="token.symbol === 'ETH'">ETH</span>
              <label
                v-else
                class="checkbox-label edit-label"
              >
                <!-- First line: Token address and delete icon -->
                <div class="line">
                  <input
                    v-model.trim="token.address"
                    placeholder="Address"
                    @input="findSymbol(index, token.address)"
                  >
                  <img
                    :src="deleteImage"
                    class="delete"
                    @click="deleteToken(index)"
                  >
                  <div class="compensate-delete" />
                </div>
              </label>
              <div v-if="token.address">
                <label>
                  <!-- Second line: Token symbol -->
                  <div class="line">
                    <span>Symbol:</span>
                    <span v-if="token.symbol === 'ETH'">ETH</span>
                    <input
                      v-else
                      v-model="token.symbol"
                      placeholder="Token Name"
                      class="token-name"
                    >
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
      
      <div
        v-if="pendingLimitOrders.length"
        class="pending-orders"
      >
        <h4>Pending Limit Orders</h4>
        <ul>
          <li 
            v-for="order in pendingLimitOrders"
            :key="order.id"
            class="pending-order"
            :class="{'is-waiting-balance': order.isWaitingBalance, 'check-if-trigger': order.status === 'processing'}"
          >
            <div
              v-if="tokensByAddresses[order.fromToken?.address] && tokensByAddresses[order.toToken?.address]"
              class="order-info"
            >
              <div class="order-details">
                <div class="trade-info">
                  <span class="left">
                    <span v-if="!order.shouldSwitchTokensForLimit">
                      {{ order.fromToken.symbol }} ≥ {{ order.priceLimit }} {{ order.toToken.symbol }}
                    </span>
                    <span v-else>
                      {{ order.toToken.symbol }} ≤ {{ order.priceLimit }} {{ order.fromToken.symbol }}
                    </span>
                    <div>
                      <span style="font-size:16px;color:rgb(223,81,81);">
                        Sell <span style="font-size:16px;font-weight:800;text-decoration:underline;">{{ order.fromAmount }} {{ order.fromToken.symbol }} </span>
                        (${{ tokensByAddresses[order.fromToken?.address].price.toFixed(7) }})
                      </span> 
                      -> 
                      <span style="font-size:16px;color:rgb(69,201,99);">
                        Buy <span style="font-size:16px;font-weight:800;text-decoration:underline;">{{ order.toAmount || '' }} {{ order.toToken.symbol }} </span>
                        (${{ tokensByAddresses[order.toToken?.address].price.toFixed(7) }})
                      </span>
                    </div>
                  </span>
                </div>
                <div class="order-meta">
                  <span>
                    {{ order.createdAt ? new Date(order.createdAt).toLocaleString() : 'Unknown' }}
                    <span v-if="order.currentMarketPrice">
                      at {{ order.currentMarketPrice.toFixed(5) }}
                    </span>
                    <span
                      class="current-market-price"
                      style="color: #888; font-size: 1em;"
                    >
                      ( 
                      <span v-if="!order.shouldSwitchTokensForLimit">
                        {{ getCurrentMarketPrice(order.fromToken, order.toToken, false) }} {{ order.toToken.symbol }}/{{ order.fromToken.symbol }}
                      </span>
                      <span v-else>
                        {{ getCurrentMarketPrice(order.fromToken, order.toToken, true) }} {{ order.fromToken.symbol }}/{{ order.toToken.symbol }}
                      </span>
                      )
                    </span>
                    <span
                      class="current-market-price"
                      style="margin-left: 10px; color: #888; font-size: 1em;"
                    >
                      Sum: ${{ (Number(tokensByAddresses[order.fromToken.address]?.price) * Number(order.fromAmount)).toFixed(2) }}
                    </span>
                  </span>
                  <span class="right">
                    From {{ order.sender?.name }}
                  </span>
                </div>
              </div>
            </div>
            <span
              class="cancel-order"
              @click="cancelLimitOrder(order.id)"
            >❌ Cancel</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
  
  <!-- Price Deviation Confirmation Modal -->
  <ConfirmationModal
    :show="showPriceDeviationModal"
    :title="priceDeviationModalData.title"
    :message="priceDeviationModalData.message"
    :details="{
      marketPrice: priceDeviationModalData.marketPrice,
      userPrice: priceDeviationModalData.userPrice,
      deviation: priceDeviationModalData.deviation
    }"
    :show-confirm-button="!!priceDeviationModalData.action"
    :cancel-text="priceDeviationModalData.action ? 'Cancel' : 'OK'"
    @confirm="confirmPriceDeviationAction"
    @cancel="cancelPriceDeviationAction"
  ></ConfirmationModal>
</template>

<script>
import { ref, reactive, watch, onMounted, computed, toRaw, onUnmounted, nextTick } from 'vue';
import { ethers, BigNumber } from 'ethers';
import chevronDownImage from '@/../assets/chevron-down.svg';
import reverseImage from '@/../assets/reverse.svg';
import downArrowImage from '@/../assets/down-arrow.svg';
import deleteImage from '@/../assets/delete.svg';
import { useUniswapV4 } from '../composables/useUniswap';
import { useBalancerV3 } from '../composables/useBalancer';
import spaceThousands from '../composables/spaceThousands';
import OrderBookLevels from './OrderBookLevels.vue';
import ConfirmationModal from './ConfirmationModal.vue';

import list100CoinsEth from '../composables/list100CoinsEth';

export default {
  name: 'ManualTrading',
  components: {
    OrderBookLevels,
    ConfirmationModal,
  },
  props: {
    addresses: { type: Array, default: () => ([]) },
    gasPrice:   { type: Number, default: 2000000000 },
    maxGasPrice:{ type: Number, default: 2000000000 },
    ethPrice:   { type: Number },
    provider:   { type: Object },
    confirmedTrade: { type: Object },
    isInitialBalanceFetchDone: {type: Boolean, default: false},
    isTestMode: { type: Boolean, default: false },
    priceDeviationPercentage: { type: Number, default: 20 },
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

    const tokens = ref([
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

    const computedEthPrice = computed(() => {
      return props.ethPrice || 0;
    });

    const tokensInRow = reactive([
      {
        token: {symbol: 'ETH', address: ethers.constants.AddressZero, decimals: 18, price: props.ethPrice},
        columns: [
        ]
      },
      {
        token: {symbol: null, address: null, decimals: 18, price: 0},
        columns: []
      },
      {
        token: {symbol: null, address: null, decimals: 18, price: 0},
        columns: []
      },
      {
        token: {symbol: null, address: null, decimals: 18, price: 0},
        columns: []
      },
      {
        token: {symbol: null, address: null, decimals: 18, price: 0},
        columns: []
      },
      {
        token: {symbol: null, address: null, decimals: 18, price: 0},
        columns: []
      },
      {
        token: {symbol: null, address: null, decimals: 18, price: 0},
        columns: []
      },
      {
        token: {symbol: null, address: null, decimals: 18, price: 0},
        columns: []
      },
      {
        token: {symbol: null, address: null, decimals: 18, price: 0},
        columns: []
      },
      {
        token: {symbol: null, address: null, decimals: 18, price: 0},
        columns: []
      },
      {
        token: {symbol: null, address: null, decimals: 18, price: 0},
        columns: []
      },
      {
        token: {symbol: null, address: null, decimals: 18, price: 0},
        columns: []
      },
    ])

    const automaticOrders = ref([]);
    const automaticMessage= ref(null);
    const isGloballyPaused = ref(false);
    
    // Computed property to collect all existing order book levels and limit orders
    const allExistingOrders = computed(() => {
      const allOrders = [];
      
      // Add OrderBookLevels from automatic trading matrix
      tokensInRow.forEach((tokenInRow, rowIndex) => {
        if (tokenInRow.columns) {
          tokenInRow.columns.forEach((token, colIndex) => {
            if (token.details && token.address && tokenInRow.token?.address) {
              allOrders.push({
                tokenA: tokenInRow.token,
                tokenB: token,
                buyLevels: token.details.buyLevels || [],
                sellLevels: token.details.sellLevels || [],
                limitPriceInDollars: token.details.limitPriceInDollars || false,
                rowIndex,
                colIndex,
                source: 'orderbook'
              });
            }
          });
        }
      });
      
      // Add pending limit orders
      pendingLimitOrders.value.forEach(order => {
        // Convert limit order to a format that matches OrderBookLevels validation
        const level = {
          triggerPrice: order.priceLimit,
          balancePercentage: 100, // Assume full percentage for limit orders
          status: 'active'
        };
        
        const isBuyOrder = !order.shouldSwitchTokensForLimit;
        
        allOrders.push({
          tokenA: order.fromToken,
          tokenB: order.toToken,
          buyLevels: isBuyOrder ? [level] : [],
          sellLevels: isBuyOrder ? [] : [level],
          limitPriceInDollars: order.limitPriceInDollars || false,
          source: 'limitorder',
          orderId: order.id
        });
      });
      
      return allOrders;
    });

    const shouldSelectTokenInRow = ref(false);
    const newTokenAddress = ref(null);
    const shouldSelectTokenInCell = ref(false);
    const newCellTokenAddress = ref(null);

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
    
    // ETH balance monitoring for insufficient gas errors
    const isInsufficientEthError = ref(false);
    const ethBalanceCheckInterval = ref(null);
    
    // Price deviation modal state
    const showPriceDeviationModal = ref(false);
    const priceDeviationModalData = reactive({
      title: '',
      message: '',
      marketPrice: '',
      userPrice: '',
      deviation: '',
      action: null, // stores the function to execute if confirmed
      args: null    // stores the arguments for the action
    });

    const currentMode = ref('automatic'); // 'manual' or 'automatic'

    // ─── Computed Helpers ────────────────────────────────────────────────────

    // Filter out tokens without valid symbol/address
    const filteredTokens = computed(() =>
      tokens.value.filter(t => t.symbol && t.address && t.decimals != null && t.symbol !== '' && t.address !== '').sort((a, b) => a.symbol <= b.symbol ? -1 : 1)
    );

    // Build a nested map: { [userAddress]: { [tokenAddress]: availableBalance } }
    const computedBalancesByAddress = computed(() => {
      const result = {};
      for (const detail of props.addresses) {
        if (!detail || !detail.address) continue; // Skip if detail or address is undefined
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

    // Computed property for effective price display
    const effectivePrice = computed(() => {
      // For limit orders, we need to get token symbols from the token addresses
      const fromSymbol = tradeSummary.fromTokenSymbol || tokensByAddresses.value[fromTokenAddress.value]?.symbol;
      const toSymbol = tradeSummary.toTokenSymbol || tokensByAddresses.value[toTokenAddress.value]?.symbol;
      
      // Also get fromAmount from the input field for limit orders
      const fromAmountValue = tradeSummary.fromAmount || fromAmount.value;
      
      if (!fromAmountValue || !tradeSummary.toAmount || !fromSymbol || !toSymbol) {
        return null;
      }
      
      const fromAmountParsed = parseFloat(fromAmountValue);
      const toAmount = parseFloat(tradeSummary.toAmount);
      
      if (fromAmountParsed <= 0 || toAmount <= 0) {
        return null;
      }
      
      // Calculate price per unit of output token
      const pricePerOutputToken = fromAmountParsed / toAmount;
      const pricePerInputToken = toAmount / fromAmountParsed;
      
      // Get USD price of the output token
      const fromTokenPrice = tokensByAddresses.value[fromTokenAddress.value]?.price || 0;
      const toTokenPrice = tokensByAddresses.value[toTokenAddress.value]?.price || 0;
      
      let usdValue, usdValueInverse
      if (list100CoinsEth.includes(fromSymbol))
        usdValueInverse = fromTokenPrice
      else
        usdValueInverse = toTokenPrice > 0 ? (pricePerInputToken * toTokenPrice).toFixed(2) : '0.00';

      if (list100CoinsEth.includes(toSymbol))
        usdValue = toTokenPrice
      else
        usdValue = fromTokenPrice > 0 ? (pricePerOutputToken * fromTokenPrice).toFixed(2) : '0.00';
      
      return {
        pricePerToken: pricePerOutputToken.toFixed(6),
        inversedPricePerToken: (1 / pricePerOutputToken).toFixed(6),
        fromSymbol: fromSymbol,
        toSymbol: toSymbol,
        usdValue: usdValue,
        usdValueInverse,
      };
    });

    // Helper: get a user’s token‐balance as a string with 5 decimals
    // Helper: get current market price for display in pending orders
    const getCurrentMarketPrice = (fromToken, toToken, shouldInvert) => {
      if (!fromToken?.address || !toToken?.address) {
        return 'N/A';
      }
      const fToken = tokensByAddresses.value[fromToken.address.toLowerCase()];
      const tToken = tokensByAddresses.value[toToken.address.toLowerCase()];
      if (!fToken || !tToken || !fToken.price || !tToken.price) {
        return 'N/A';
      }
      // Calculate market price: how much of toToken per unit of fromToken
      const marketPrice = fToken.price / tToken.price;
      
      // If shouldInvert is true, show the inverse price
      const displayPrice = shouldInvert ? (1 / marketPrice) : marketPrice;
      
      return displayPrice.toFixed(6);
    };

    const balanceString = (ownerAddress, tokenAddr) => {
      if (!ownerAddress || !tokenAddr) return '0.00000';
      const b = computedBalancesByAddress.value[ownerAddress?.toLowerCase()]?.[tokenAddr.toLowerCase()] || 0;
      return b.toFixed(5);
    };

    // Helper: check if current wallet has sufficient ETH for gas
    const hasSufficientEthForGas = () => {
      if (!senderDetails.value?.address) return false;
      const ethBalance = computedBalancesByAddress.value[senderDetails.value.address.toLowerCase()]?.[ethers.constants.AddressZero.toLowerCase()] || 0;
      return ethBalance >= 0.001; // Minimum 0.001 ETH for gas
    };

    // Start ETH balance monitoring for insufficient gas errors
    const startEthBalanceMonitoring = () => {
      if (ethBalanceCheckInterval.value) return; // Already running
      
      ethBalanceCheckInterval.value = setInterval(() => {
        if (isInsufficientEthError.value && hasSufficientEthForGas()) {
          swapMessage.value = '';
          isSwapButtonDisabled.value = false;
          isInsufficientEthError.value = false;
          stopEthBalanceMonitoring();
        }
      }, 60000); // Check every minute
    };

    // Stop ETH balance monitoring
    const stopEthBalanceMonitoring = () => {
      if (ethBalanceCheckInterval.value) {
        clearInterval(ethBalanceCheckInterval.value);
        ethBalanceCheckInterval.value = null;
      }
    };

    // ─── Watchers ─────────────────────────────────────────────────────────────
    // Refresh balances
    watch([() => fromTokenAddress.value,
      () => toTokenAddress.value,
      () => tabOrder.value,
    ],
      ([_fromAddr, _toAddr, _tabOrder]) => {
        if (_tabOrder === 'limit') {
          setMarketPriceAsLimit(_fromAddr, _toAddr);
          isFetchingPrice.value = false;
        }
        tradeSummary.toAmount = null;
        tradeSummary.protocol = null;
        tradeSummary.fromAmount = null;
        tradeSummary.expectedToAmount = null;
        tradeSummary.fromTokenSymbol = null;
        tradeSummary.toTokenSymbol = null;
        tradeSummary.priceLimit = null;
        trades.value = [];
        swapMessage.value = '';
        priceFetchingMessage.value = '';
        needsToApprove.value = false;
    });

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

    // Clear error messages when switching wallets
    watch(
      () => senderDetails.value,
      (newSender, oldSender) => {
        if (newSender && oldSender && newSender.address !== oldSender.address) {
          swapMessage.value = '';
          isSwapButtonDisabled.value = false;
          isInsufficientEthError.value = false;
          stopEthBalanceMonitoring();
        }
      }
    );

    // Whenever props.confirmedTrade changes, adjust our offset map
    watch(() => props.confirmedTrade, async (confirmed) => {
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
      
      // Update level status when transaction is confirmed
      if (confirmed.orderId && confirmed.orderSourceLocation) {
        const { rowIndex, colIndex, levelIndex, levelType } = confirmed.orderSourceLocation;
        
        // Validate indices are still valid
        if (tokensInRow[rowIndex]?.columns[colIndex]?.details) {
          const levels = levelType === 'sell' 
            ? tokensInRow[rowIndex].columns[colIndex].details.sellLevels 
            : tokensInRow[rowIndex].columns[colIndex].details.buyLevels;
            
          if (levels[levelIndex]) {
            // Find the order by source location instead of ID (since orders get regenerated)
            let order = null;
            
            // First try to find by orderId (in case it still exists)
            order = automaticOrders.value.find(o => o.id === confirmed.orderId);
            
            // If not found by ID, try to find by matching source location
            if (!order && confirmed.orderSourceLocation) {
              const { rowIndex: confRowIndex, colIndex: confColIndex, levelIndex: confLevelIndex, levelType: confLevelType } = confirmed.orderSourceLocation;
              order = automaticOrders.value.find(o => 
                o.sourceLocation &&
                o.sourceLocation.rowIndex === confRowIndex &&
                o.sourceLocation.colIndex === confColIndex &&
                o.sourceLocation.levelIndex === confLevelIndex &&
                o.sourceLocation.levelType === confLevelType
              );
            }
            
            // If still not found, we can still update the level status based on the confirmed trade data
            if (order || confirmed.orderSourceLocation) {
              // Use order data if available, otherwise use confirmed trade data
              const originalAmount = order ? Number(order.fromAmount) : Number(confirmed.fromAmount);
              const executedAmount = Number(confirmed.fromAmount);
              
              // Check if transaction was successful
              if (confirmed.receiptStatus === true) {
                // Transaction succeeded
                const remainingAmount = order ? Number(order.remainingAmount || 0) : 0;
                const fillPercentage = (executedAmount / originalAmount) * 100;
                
                console.log(`Transaction confirmed SUCCESSFUL for order ${confirmed.orderId}, execution: ${fillPercentage.toFixed(1)}%`);
                
                // Check if order is 97.5% or more filled
                if (fillPercentage >= 97.5 || remainingAmount < originalAmount * 0.025) {
                  levels[levelIndex].status = 'processed';
                  console.log(`Level ${levelIndex} marked as processed (${fillPercentage.toFixed(1)}% filled)`);
                } else {
                  levels[levelIndex].status = 'partially_filled';
                  levels[levelIndex].partialExecutionDate = new Date().toISOString();
                  levels[levelIndex].executedAmount = executedAmount;
                  levels[levelIndex].originalPercentage = levels[levelIndex].balancePercentage;
                  
                  // Calculate new percentage based on remaining amount
                  const executedRatio = executedAmount / originalAmount;
                  const remainingRatio = 1 - executedRatio;
                  const newPercentage = levels[levelIndex].originalPercentage * remainingRatio;
                  levels[levelIndex].balancePercentage = Number(newPercentage.toFixed(2));
                  
                  console.log(`Level ${levelIndex} marked as partially_filled (${fillPercentage.toFixed(1)}% filled, new percentage: ${newPercentage.toFixed(2)}%)`);
                }
                
                levels[levelIndex].executionPrice = confirmed.executionPrice || null;
                levels[levelIndex].executionDate = new Date().toISOString();
                levels[levelIndex].confirmedTxId = confirmed.txId;
              } else {
                // Transaction failed - revert the order
                console.log(`Transaction FAILED for order ${confirmed.orderId}, reverting...`);
                
                // Reset level status to previous state (active or partially_filled)
                // Check if there were previous successful executions
                if (levels[levelIndex].executedAmount && levels[levelIndex].executedAmount > 0) {
                  // There were previous executions, go back to partially_filled
                  levels[levelIndex].status = 'partially_filled';
                  console.log(`Level ${levelIndex} reverted to partially_filled status (previous executions exist)`);
                } else {
                  // No previous executions, go back to active
                  levels[levelIndex].status = 'active';
                  console.log(`Level ${levelIndex} reverted to active status (no previous executions)`);
                }
                levels[levelIndex].failedTxId = confirmed.txId;
                levels[levelIndex].lastFailureDate = new Date().toISOString();
                
                // If we have the order object, update it
                if (order) {
                  // Restore the remaining amount
                  if (order.remainingAmount !== undefined) {
                    order.remainingAmount = Number(order.remainingAmount) + executedAmount;
                  } else {
                    order.remainingAmount = order.fromAmount;
                  }
                  
                  // Update order status back to pending
                  order.status = 'pending';
                  
                  // Update the order in the database
                  await window.electronAPI.updatePendingOrder({
                    ...JSON.parse(JSON.stringify(order)),
                    remainingAmount: order.remainingAmount.toString(),
                    status: 'pending'
                  });
                  
                  console.log(`Order ${order.id} reverted: remaining amount restored to ${order.remainingAmount}`);
                } else {
                  console.log(`Order not found in current automaticOrders, but level status was reverted`);
                }
              }
              
              // Force UI update
              updateDetailsOrder(rowIndex, colIndex, tokensInRow[rowIndex].columns[colIndex].details);
            } else {
              console.warn(`Could not find matching order for confirmed trade at location: row=${rowIndex}, col=${colIndex}, level=${levelIndex}, type=${levelType}`);
            }
          }
        }
      }
    });

    watch(
      () => fromTokenAddress.value,
      (newFrom, oldFrom) => {
        if (!newFrom) return;
        shouldSwitchTokensForLimit.value = false;
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
        shouldSwitchTokensForLimit.value = false;
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
          ? getTradesBalancer(fromTokenAddr, toTokenAddr, amount * .10, senderAddr, !shouldUseBalancerValue) : null,
      ]);

      console.log(results);

      let isUsingUniswap = true;
      let validTrades, totalHuman, totalBig;
      if (results[0] && results[0].status === 'fulfilled' && results[0].value) {
        if (results[0].value === 'outdated') throw new Error('Quote is outdated');
        if (results[0].value === 'no swap found') {
          isUsingUniswap = false;
        }
        else if (!results[0].value[100] || results[0].value[100] === 'outdated') throw new Error('Quote is outdated');
        else {
          validTrades = results[0].value[100].validTrades;
          totalHuman = results[0].value[100].totalHuman;
          totalBig = results[0].value[100].totalBig;
        }
      } else if (!results[0] || results[0].status === 'rejected') {
        isUsingUniswap = false;
        if (results[0] && results[0].reason)
          console.error(results[0].reason);
      }

      let callData, outputAmount, value, gasLimit, contractAddress;
      if (results[1] && results[1].status === 'fulfilled' && results[1].value) {
        callData = results[1].value.callData;
        outputAmount = results[1].value.outputAmount;
        value = results[1].value.value;
        gasLimit = results[1].value.gasLimit;
        contractAddress = results[1].value.contractAddress;
      } else if (!shouldUseUniswapAndBalancerValue && !shouldUseUniswapValue && (!results[1] || results[1].status === 'rejected')) {
        if (results[1] && results[1].reason)
          throw results[1].reason;
      }

      let uniswapGasLimit = 0
      let offsetUniswap, outputUniswap, negativeOutputUniswap;
      if (validTrades && validTrades.length && toToken.price && props.gasPrice && props.ethPrice) {
        uniswapGasLimit = 120000 + 60000 * validTrades.length;
        offsetUniswap = BigNumber.from(Math.ceil((uniswapGasLimit * Number(props.ethPrice) * Number(props.gasPrice) / 1e18) * Math.pow(10, toToken.decimals) / toToken.price).toPrecision(50).split('.')[0])
        if (totalBig.gte(offsetUniswap)) {
          outputUniswap = totalBig.sub(offsetUniswap)
        } else {
          // Store negative value as positive BigNumber for later comparison
          negativeOutputUniswap = offsetUniswap.sub(totalBig)
          outputUniswap = BigNumber.from('0')
        }
      }
      let offsetBalancer, outputBalancer, negativeOutputBalancer;
      if (gasLimit && props.gasPrice && props.ethPrice && toToken.price && outputAmount) { // Add outputAmount check
        offsetBalancer = BigNumber.from(Math.ceil((gasLimit * Number(props.ethPrice) * Number(props.gasPrice) / 1e18) * Math.pow(10, toToken.decimals) / toToken.price).toPrecision(50).split('.')[0])
        const outputAmountBN = BigNumber.from(outputAmount)
        if (outputAmountBN.gte(offsetBalancer)) {
          outputBalancer = outputAmountBN.sub(offsetBalancer)
        } else {
          // Store negative value as positive BigNumber for later comparison
          negativeOutputBalancer = offsetBalancer.sub(outputAmountBN)
          outputBalancer = BigNumber.from('0')
        }
      }
      let outputU = outputUniswap || totalBig || BigNumber.from('0'); // Changed default
      let outputB = outputBalancer || BigNumber.from('0'); // Changed default and removed undefined check

      let bestOutputLessGas = 0;
      let bestNegativeOutput = null; // Track best negative output for comparison with mixed trades
      if (outputU && outputB) { // Allow negative values for comparison
        // Check if both outputs are zero (unprofitable trades)
        if (outputU.eq(0) && outputB.eq(0) && negativeOutputUniswap && negativeOutputBalancer) {
          // Both trades are unprofitable - choose the less negative one
          if (negativeOutputUniswap.lte(negativeOutputBalancer) && shouldUseUniswapValue) {
            bestOutputLessGas = outputU; // Will be 0
            bestNegativeOutput = negativeOutputUniswap;
            isUsingUniswap = true;
            console.log('Both trades unprofitable - choosing Uniswap as less negative')
          } else if (shouldUseBalancerValue) {
            bestOutputLessGas = outputB; // Will be 0
            bestNegativeOutput = negativeOutputBalancer;
            isUsingUniswap = false;
            console.log('Both trades unprofitable - choosing Balancer')
          }
        } else {
          // Normal comparison when at least one is profitable
          if (outputU.gte(outputB) && shouldUseUniswapValue) {
            bestOutputLessGas = outputU;
            isUsingUniswap = true;
            // console.log('Using Uniswap')
          } else if (shouldUseBalancerValue) {
            bestOutputLessGas = outputB;
            isUsingUniswap = false;
            // console.log('Using Balancer')
          }
        }
      } if (!outputB) {
        isUsingUniswap = true;
      }

      if (shouldUseUniswapValue && !shouldUseBalancerValue)
        isUsingUniswap = true
      if (shouldUseBalancerValue && !shouldUseUniswapValue)
        isUsingUniswap = false

      // Handle mixed trades if enabled
      let bestMixed, fractionMixed;
      if (shouldUseUniswapAndBalancerValue && results[0]?.value && results[0].value[100]) {
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
          // Handle sorting when trades have negative outputs
          const aIsNegative = a.trade.outputAmount.eq(0) && a.trade.negativeOutput;
          const bIsNegative = b.trade.outputAmount.eq(0) && b.trade.negativeOutput;
          
          if (aIsNegative && bIsNegative) {
            // Both negative - sort by less negative (smaller absolute loss)
            if (a.trade.negativeOutput.lt(b.trade.negativeOutput)) return -1;
            if (b.trade.negativeOutput.lt(a.trade.negativeOutput)) return 1;
            return 0;
          } else if (aIsNegative) {
            // a is negative, b is positive - b is better
            return 1;
          } else if (bIsNegative) {
            // b is negative, a is positive - a is better
            return -1;
          } else {
            // Both positive - normal comparison (higher output is better)
            if (b.trade.outputAmount.gt(a.trade.outputAmount)) return 1;
            if (a.trade.outputAmount.gt(b.trade.outputAmount)) return -1;
            return 0;
          }
        });

        let bestMixedOption = mixedOptions[0];

        if (!bestMixedOption || (bestMixedOption?.fraction === 90)) {
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
              // Include all trades, even negative (to find least bad option)
              mixedOptions.push({ trade, fraction: fraction });
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
              // Include all trades, even negative (to find least bad option)
              mixedOptions.push({ trade, fraction: fraction });
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
              // Include all trades, even negative (to find least bad option)
              mixedOptions.push({ trade, fraction: fraction });
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
              // Include all trades, even negative (to find least bad option)
              mixedOptions.push({ trade, fraction: fraction });
            }
          }
        }
        console.log('Mixed options:', mixedOptions);
        // Sort by output amount (highest first)
        mixedOptions.sort((a, b) => {
          // Handle sorting when trades have negative outputs
          const aIsNegative = a.trade.outputAmount.eq(0) && a.trade.negativeOutput;
          const bIsNegative = b.trade.outputAmount.eq(0) && b.trade.negativeOutput;
          
          if (aIsNegative && bIsNegative) {
            // Both negative - sort by less negative (smaller absolute loss)
            if (a.trade.negativeOutput.lt(b.trade.negativeOutput)) return -1;
            if (b.trade.negativeOutput.lt(a.trade.negativeOutput)) return 1;
            return 0;
          } else if (aIsNegative) {
            // a is negative, b is positive - b is better
            return 1;
          } else if (bIsNegative) {
            // b is negative, a is positive - a is better
            return -1;
          } else {
            // Both positive - normal comparison (higher output is better)
            if (b.trade.outputAmount.gt(a.trade.outputAmount)) return 1;
            if (a.trade.outputAmount.gt(b.trade.outputAmount)) return -1;
            return 0;
          }
        });

        bestMixedOption = mixedOptions[0];

        if (onlyMixedEnabled) {
          // When only mixed trades are enabled, always select the best one
          bestMixed = bestMixedOption.trade;
          fractionMixed = bestMixedOption.fraction;
        } else {
          if (bestMixedOption && bestMixedOption.trade) {
            let hasBetterOutput = false;
            
            // If both single protocols and mixed trade are unprofitable, compare negative values
            if (bestOutputLessGas && bestOutputLessGas.eq && bestOutputLessGas.eq(0) && 
                bestMixedOption.trade.outputAmount.eq(0) && 
                bestNegativeOutput && bestMixedOption.trade.negativeOutput) {
              // Both are negative - choose the less negative (smaller absolute loss)
              hasBetterOutput = bestMixedOption.trade.negativeOutput.lt(bestNegativeOutput);
              console.log('Comparing negative outputs - mixed vs single protocol');
            } else {
              // Normal comparison when at least one is profitable
              hasBetterOutput = !bestOutputLessGas || 
                (bestMixedOption.trade.outputAmount && 
                  typeof bestMixedOption.trade.outputAmount.gte === 'function' && 
                  bestMixedOption.trade.outputAmount.gte(bestOutputLessGas));
            }
            
            if (hasBetterOutput) {
              bestMixed = bestMixedOption.trade;
              fractionMixed = bestMixedOption.fraction;
            }
          }
        }
      }

      // Build final trade result
      let finalTrades, finalTotalHuman, protocol, finalGasLimit;
      
      if (bestMixed) {
        console.log(bestMixed)
        totalHuman = ethers.utils.formatUnits(bestMixed.outputAmount, toToken.decimals);
        finalTrades = [
          ...bestMixed.tradesU.validTrades,
          bestMixed.tradesB,
        ];
        protocol = 'Uniswap & Balancer';
        finalGasLimit = Number(120000 + 60000 * bestMixed.tradesU.validTrades.length) + Number(bestMixed.tradesB.gasLimit);
      } else if (isUsingUniswap) {
        finalTrades = validTrades;
        protocol = 'Uniswap';
        finalGasLimit = uniswapGasLimit;
      } else if (outputAmount) {
        finalTrades = [{
          callData,
          outputAmount,
          value,
          tradeSummary,
          contractAddress,
        }];
        totalHuman = ethers.utils.formatUnits(outputAmount, toToken.decimals);
        protocol = 'Balancer';
        finalGasLimit = gasLimit;
      } else {
        throw new Error('No swap found');
      }

      if (!shouldUseUniswapValue && !shouldUseBalancerValue && !bestMixed) {
        throw new Error('No swap found');
      }

      if (!finalTrades || finalTrades.length === 0 || !totalHuman) {
        throw new Error('No valid trades found');
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
        () => tabOrder.value,
        () => currentMode.value,
      ],
      async (
        [_newFrom, _newTo, _newAmt, _newSender, shouldUseUniswapValue, shouldUseBalancerValue, shouldUseUniswapAndBalancerValue, tabOrderValue, currentModeValue],
        [_oldFrom, _oldTo]
      ) => {
        if (tabOrderValue === 'limit') {
          if (debounceTimer) clearTimeout(debounceTimer);
          return;
        }
        if (currentModeValue === 'automatic') {
          if (debounceTimer) clearTimeout(debounceTimer);
          return;
        }

        if (!_newSender?.address) {
          swapMessage.value = 'No wallet selected';
          return;
        } else {
          swapMessage.value = '';
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

            if (tabOrderValue === 'limit' || currentModeValue === 'automatic') {
              console.log('not in market order anymore')
              return;
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
                await checkAllowances(_newFrom, true, bestTradeResult.trades);
                await checkAllowances(_newFrom, false, bestTradeResult.trades);
              } else 
                await checkAllowances(_newFrom, tradeSummary.protocol === 'Uniswap', bestTradeResult.trades);
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

    const checkAllowances = async (tokenAddress, isUsingUniswap, localTrades) => {
      if (!senderDetails.value?.address) {
        needsToApprove.value = false;
        return;
      }
      
      // Skip allowance check for ETH (zero address) - native token doesn't need approval
      if (tokenAddress === ethers.constants.AddressZero) {
        console.log('Skipping allowance check for ETH (native token)');
        needsToApprove.value = false;
        return;
      }
      
      // Validate token address before creating contract
      if (!tokenAddress || !ethers.utils.isAddress(tokenAddress)) {
        console.error('Invalid token address in checkAllowances:', tokenAddress);
        needsToApprove.value = false;
        return;
      }
      
      const erc20 = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        toRaw(props.provider)
      );

      // Uniswap (and Uniswap & Balancer mixed)
      if (isUsingUniswap) {
        // 1. ERC20.approve(PERMIT2_ADDRESS)
        const permitAllowance = await erc20.allowance(
          senderDetails.value.address,
          PERMIT2_ADDRESS
        );
        if (BigNumber.from(permitAllowance).lt(BigNumber.from('100000000000000000000000000')))
          return needsToApprove.value = true;

        // 2. PERMIT2_CONTRACT.allowance(owner, ERC20, UNIVERSAL_ROUTER_ADDRESS)
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
          return;
        }
        needsToApprove.value = false;
        return;
      }

      // Balancer V2
      if (!localTrades || (localTrades && localTrades.length > 0)) {
        const balancerTradeV2 = localTrades.find(
          t => t.callData && t.contractAddress.toLowerCase() === BALANCER_VAULT_ADDRESS.toLowerCase()
        );
        if (balancerTradeV2) {
          // ERC20.approve(BALANCER_VAULT_ADDRESS)
          const balancerAllowance = await erc20.allowance(
            senderDetails.value.address,
            BALANCER_VAULT_ADDRESS
          );
          if (BigNumber.from(balancerAllowance).lt(BigNumber.from('100000000000000000000000000')))
            return needsToApprove.value = true;
          needsToApprove.value = false;
          return;
        }
      }

      // Balancer V3
      if (localTrades && localTrades.length > 0) {
        const balancerTradeV3 = localTrades.find(
          t => t.callData && t.contractAddress.toLowerCase() !== BALANCER_VAULT_ADDRESS.toLowerCase()
        );
        if (balancerTradeV3) {
          // 1. ERC20.approve(PERMIT2_ADDRESS)
          const permitAllowance = await erc20.allowance(
            senderDetails.value.address,
            PERMIT2_ADDRESS
          );
          if (BigNumber.from(permitAllowance).lt(BigNumber.from('100000000000000000000000000')))
            return needsToApprove.value = true;

          // 2. PERMIT2_CONTRACT.allowance(owner, ERC20, otherContractAddress)
          const permit2 = new ethers.Contract(
            PERMIT2_ADDRESS,
            ["function allowance(address owner,address token,address spender) view returns (uint160,uint48,uint48)"],
            toRaw(props.provider)
          );
          const [remaining] = await permit2.allowance(
            senderDetails.value.address,
            tokenAddress,
            balancerTradeV3.contractAddress
          );
          if (BigNumber.from(remaining).lt(BigNumber.from('100000000000000000000000000'))) {
            needsToApprove.value = true;
            return;
          }
          needsToApprove.value = false;
          return;
        }
      }

      // Default: no approval needed
      needsToApprove.value = false;
    };

    const findBestMixedTrades = (resultsU, rawResultsB, toTokenAddress, gasLimitBalancer) => {
      let validTrades, totalHuman, totalBig;
      if (resultsU) {
        validTrades = resultsU.validTrades;
        totalHuman = resultsU.totalHuman;
        totalBig = resultsU.totalBig;
      }
      let callData, outputAmount, value, contractAddress
      if (rawResultsB && rawResultsB.status === 'fulfilled' && rawResultsB.value) {
        callData = rawResultsB.value.callData;
        outputAmount = BigNumber.from(rawResultsB.value.outputAmount || '0'); // Add fallback
        value = rawResultsB.value.value || '0'; // Add fallback
        contractAddress = rawResultsB.value.contractAddress || BALANCER_VAULT_ADDRESS; // Add fallback
      }

      let uniswapGasLimit = 0
      let offsetUniswap, outputUniswap, negativeOutputUniswap;
      if (validTrades && validTrades.length && tokensByAddresses.value[toTokenAddress].price && props.gasPrice && props.ethPrice) {
        uniswapGasLimit = 120000 + 60000 * validTrades.length; // Fixed reference
        offsetUniswap = BigNumber.from(Math.ceil((uniswapGasLimit * Number(props.ethPrice) * Number(props.gasPrice) / 1e18) * Math.pow(10, tokensByAddresses.value[toTokenAddress].decimals) / tokensByAddresses.value[toTokenAddress].price).toPrecision(50).split('.')[0])
        if (totalBig.gte(offsetUniswap)) {
          outputUniswap = totalBig.sub(offsetUniswap)
        } else {
          // Store negative value as positive BigNumber for later comparison
          negativeOutputUniswap = offsetUniswap.sub(totalBig)
          outputUniswap = BigNumber.from('0')
        }
      }
      let offsetBalancer, outputBalancer, negativeOutputBalancer;
      if (gasLimitBalancer && props.gasPrice && props.ethPrice && tokensByAddresses.value[toTokenAddress].price && outputAmount) { // Add outputAmount check
        offsetBalancer = BigNumber.from(Math.ceil((gasLimitBalancer * Number(props.ethPrice) * Number(props.gasPrice) / 1e18) * Math.pow(10, tokensByAddresses.value[toTokenAddress].decimals) / tokensByAddresses.value[toTokenAddress].price).toPrecision(50).split('.')[0])
        if (outputAmount.gte(offsetBalancer)) {
          outputBalancer = outputAmount.sub(offsetBalancer)
        } else {
          // Store negative value as positive BigNumber for later comparison
          negativeOutputBalancer = offsetBalancer.sub(outputAmount)
          outputBalancer = BigNumber.from('0')
        }
      }
      let outputU = outputUniswap || totalBig || BigNumber.from('0'); // Changed default to '0'
      let outputB = outputBalancer || outputAmount || BigNumber.from('0'); // Changed default to '0' and removed undefined outputAmount

      // Calculate total output and check for various negative scenarios
      const totalOutput = outputB.add(outputU);
      let totalNegativeOutput = null;
      
      // Scenario 1: Both trades are unprofitable
      if (outputU.eq(0) && outputB.eq(0) && negativeOutputUniswap && negativeOutputBalancer) {
        totalNegativeOutput = negativeOutputUniswap.add(negativeOutputBalancer);
      }
      // Scenario 2: One trade is profitable, but the other's loss exceeds the profit
      else if (negativeOutputUniswap && outputB.gt(0) && negativeOutputUniswap.gt(outputB)) {
        totalNegativeOutput = negativeOutputUniswap.sub(outputB);
      }
      else if (negativeOutputBalancer && outputU.gt(0) && negativeOutputBalancer.gt(outputU)) {
        totalNegativeOutput = negativeOutputBalancer.sub(outputU);
      }

      return {
        outputAmount: totalOutput,
        negativeOutput: totalNegativeOutput, // For comparison when mixed trade is unprofitable
        tradesU: {
          validTrades: validTrades || [],
          totalHuman: totalHuman || '0',
          totalBig: totalBig || BigNumber.from('0'),
          outputAfterGas: outputU,
        },
        tradesB: {
          callData: callData || null,
          outputAmount: outputAmount || BigNumber.from('0'),
          outputAfterGas: outputB,
          value: value || '0',
          gasLimit: gasLimitBalancer || 400000, // Default gas limit
          contractAddress: contractAddress || BALANCER_VAULT_ADDRESS,
        }
      }
    }

    const getTradesBalancer = async (_newFrom, _newTo, _newAmt, _newSenderAddress, shouldFetchGasLimit) => {
      // Extract address string if _newSenderAddress is an object
      const senderAddressString = typeof _newSenderAddress === 'string' ? _newSenderAddress : _newSenderAddress.address;
      
      const result = await findTradeBalancer(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], _newAmt, senderAddressString);

      const txData = {
        from: senderAddressString,
        to: result.contractAddress,
        data: result.callData,
        value: result.value,
        maxFeePerGas: ethers.utils.parseUnits((Number(props.gasPrice) * 1.85 / 1000000000).toFixed(3), 9),
        maxPriorityFeePerGas: ethers.utils.parseUnits((0.01 + Math.random() * .05 + (Number(props.gasPrice) / (40 * 1000000000))).toFixed(3), 9)
      }

      let gasLimit = 400000;
      try {
        if (shouldFetchGasLimit) {
          // console.log('before promise.race')
          gasLimit = await Promise.race([
            toRaw(props.provider).estimateGas(txData),
            new Promise(r => setTimeout(r, 5000)),
          ])
          // console.log({gasLimit})
          if (!gasLimit)
            gasLimit = 400000;
        }
      } catch (err) {
        console.log('Error in estimateGas');
        console.error(err);
      }
      // console.log(gasLimit);

      return {
        outputAmount: result.expectedAmountOut,
        callData: result.callData,
        value: result.value,
        gasLimit: gasLimit,
        contractAddress: result.contractAddress
      };
    }

    const getTradesUniswap = async (_newFrom, _newTo, _newAmt) => {
      // Validate amount is not zero or invalid
      if (!_newAmt || Number(_newAmt) <= 0) {
        console.warn('getTradesUniswap: Invalid amount', _newAmt);
        return 'no swap found';
      }
      
      const pools = await findPossiblePools(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo]);
      
      // FINDING TRADES
      const tokenDecimals = tokensByAddresses.value[_newFrom].decimals;
      const formattedAmount = Number(_newAmt).toFixed(tokenDecimals);
      const fromAmtRaw = ethers.utils.parseUnits(
        formattedAmount,
        tokenDecimals
      );
      
      // Check if the parsed amount is zero
      if (fromAmtRaw.isZero()) {
        console.warn('getTradesUniswap: Parsed amount is zero', { _newAmt, formattedAmount, tokenDecimals });
        return 'no swap found';
      }

      // Helper to safely calculate percentage amounts
      const calculatePercentageAmount = (percentage) => {
        const percentAmount = (_newAmt * percentage) / 100;
        const formatted = percentAmount.toFixed(tokensByAddresses.value[_newFrom].decimals);
        const parsed = ethers.utils.parseUnits(formatted, tokensByAddresses.value[_newFrom].decimals);
        
        // If the percentage amount rounds to zero, return null to skip
        if (parsed.isZero()) {
          console.warn(`Percentage ${percentage}% of ${_newAmt} rounds to zero`);
          return null;
        }
        return parsed;
      };

      // Calculate all percentage amounts and filter out nulls
      const percentageAmounts = {
        10: calculatePercentageAmount(10),
        15: calculatePercentageAmount(15),
        20: calculatePercentageAmount(20),
        25: calculatePercentageAmount(25),
        30: calculatePercentageAmount(30),
        35: calculatePercentageAmount(35),
        40: calculatePercentageAmount(40),
        45: calculatePercentageAmount(45),
        50: calculatePercentageAmount(50),
        55: calculatePercentageAmount(55),
        60: calculatePercentageAmount(60),
        65: calculatePercentageAmount(65),
        70: calculatePercentageAmount(70),
        75: calculatePercentageAmount(75),
        80: calculatePercentageAmount(80),
        85: calculatePercentageAmount(85),
        90: calculatePercentageAmount(90),
        93: calculatePercentageAmount(93),
        95: calculatePercentageAmount(95),
        97: calculatePercentageAmount(97),
        98: calculatePercentageAmount(98),
        99: calculatePercentageAmount(99)
      };

      const [
        bestTrades,
        bestTrades10,
        bestTrades15,
        bestTrades20,
        bestTrades25,
        bestTrades30,
        bestTrades35,
        bestTrades40,
        bestTrades45,
        bestTrades50,
        bestTrades55,
        bestTrades60,
        bestTrades65,
        bestTrades70,
        bestTrades75,
        bestTrades80,
        bestTrades85,
        bestTrades90,
        bestTrades93,
        bestTrades95,
        bestTrades97,
        bestTrades98,
        bestTrades99
      ] = await Promise.all([
        selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, fromAmtRaw),
        percentageAmounts[10] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[10]) : Promise.resolve(null),
        percentageAmounts[15] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[15]) : Promise.resolve(null),
        percentageAmounts[20] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[20]) : Promise.resolve(null),
        percentageAmounts[25] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[25]) : Promise.resolve(null),
        percentageAmounts[30] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[30]) : Promise.resolve(null),
        percentageAmounts[35] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[35]) : Promise.resolve(null),
        percentageAmounts[40] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[40]) : Promise.resolve(null),
        percentageAmounts[45] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[45]) : Promise.resolve(null),
        percentageAmounts[50] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[50]) : Promise.resolve(null),
        percentageAmounts[55] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[55]) : Promise.resolve(null),
        percentageAmounts[60] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[60]) : Promise.resolve(null),
        percentageAmounts[65] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[65]) : Promise.resolve(null),
        percentageAmounts[70] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[70]) : Promise.resolve(null),
        percentageAmounts[75] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[75]) : Promise.resolve(null),
        percentageAmounts[80] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[80]) : Promise.resolve(null),
        percentageAmounts[85] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[85]) : Promise.resolve(null),
        percentageAmounts[90] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[90]) : Promise.resolve(null),
        percentageAmounts[93] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[93]) : Promise.resolve(null),
        percentageAmounts[95] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[95]) : Promise.resolve(null),
        percentageAmounts[97] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[97]) : Promise.resolve(null),
        percentageAmounts[98] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[98]) : Promise.resolve(null),
        percentageAmounts[99] ? selectBestPath(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo], pools, percentageAmounts[99]) : Promise.resolve(null),
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
      const formattedAmountIn = Number(_newAmt).toFixed(decimalsIn);
      const expectedInRawBN = ethers.utils.parseUnits(formattedAmountIn, decimalsIn);
      
      if (!tradesByPercent[100] || !tradesByPercent[100].validTrades || tradesByPercent[100].validTrades.length === 0) {
        console.log('No valid trades found');
        return 'no swap found';
      }

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
      // Early return if bestTrades is null or undefined
      if (!bestTrades) {
        return { validTrades: [], totalHuman: '0', totalBig: BigNumber.from(0) };
      }
      
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
      
      // Create a copy of the entire array
      const updatedTokens = [...tokenArray];
      
      // Update prices in the copy
      for (const tokenAddress in tokenPrices) {
        let index = updatedTokens.findIndex((t) => t.address?.toLowerCase() === tokenAddress);
        if (index >= 0) {
          // Create new token object with updated price
          updatedTokens[index] = { 
            ...updatedTokens[index], 
            price: tokenPrices[tokenAddress] 
          };
          
          // Also update tokensByAddresses
          if (tokensByAddresses.value[tokenAddress]) {
            tokensByAddresses.value[tokenAddress] = {
              ...tokensByAddresses.value[tokenAddress],
              price: tokenPrices[tokenAddress]
            };
          }
        }
      }
      
      // Replace the entire tokens array to trigger reactivity
      tokens.value = updatedTokens;
      
      // Also update tokensInRow with new references
      tokensInRow.forEach((row, i) => {
        if (row.token?.address) {
          const tokenAddress = row.token.address.toLowerCase();
          if (tokenPrices[tokenAddress]) {
            // Create a new object to trigger reactivity
            tokensInRow[i] = {
              ...tokensInRow[i],
              token: {
                ...row.token,
                price: tokenPrices[tokenAddress]
              }
            };
          }
        }
        
        // Update prices for columns
        row.columns.forEach((col, j) => {
          if (col.address) {
            const colAddress = col.address.toLowerCase();
            if (tokenPrices[colAddress]) {
              tokensInRow[i].columns[j] = {
                ...col,
                price: tokenPrices[colAddress]
              };
            }
          }
        });
      });
    }

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
          tokens.value[index].decimals = 18;
          tokens.value[index].symbol = 'ETH';
          tokens.value[index].price = props.ethPrice;
        } else if (ethers.utils.isAddress(contractAddress)) {
          tokens.value[index].decimals = await getTokenDecimals(contractAddress);
          tokens.value[index].symbol   = await getTokenSymbol(contractAddress);
          tokens.value[index].price    = await tokenUsd(contractAddress, props.ethPrice);
        } else {
          tokens.value[index].symbol = null;
        }
        tokens.value[index].address = tokens.value[index].address.toLowerCase();
      } catch {
        tokens.value[index].symbol = null;
      }
    }

    function toggleEditingTokens() {
      if (!isEditingTokens.value) {
        // Entering edit mode
        isEditingTokens.value = true;
      } else {
        // Leaving edit mode - remove invalid tokens
        for (let i = 0; i < tokens.value.length; i++) {
          const token = tokens.value[i];
          
          // Skip empty tokens or ETH
          if (!token.address || token.address === '') {
            continue;
          }
          
          // Check if address is valid (excluding the zero address for ETH)
          if (!ethers.utils.isAddress(token.address) && token.address !== ethers.constants.AddressZero) {
            // Clear invalid token
            tokens.value[i] = {address: '', symbol: '', decimals: null, price: 0};
            console.log(`Cleared invalid token at index ${i}`);
          }
        }
        
        isEditingTokens.value = false;
      }
    }

    function deleteToken(index) {
      const tokenToDelete = tokens.value[index];
      tokens.value[index] = {address: '', symbol: '', decimals: null, price: 0};
      
      // Clean up tokensInRow references to this deleted token
      tokensInRow.forEach((row, rowIndex) => {
        // Check main token
        if (row.token?.address === tokenToDelete.address) {
          tokensInRow[rowIndex] = {
            token: { symbol: null, address: null, decimals: 18, price: null },
            columns: []
          }
        }
        // Remove from columns
        row.columns = row.columns.filter(col => col.address !== tokenToDelete.address);
      });
    }

    function switchTokens() {
      const tmp = toTokenAddress.value;
      toTokenAddress.value = fromTokenAddress.value;
      fromTokenAddress.value = tmp;
      if (tradeSummary.toAmount) {
        [fromAmount.value, tradeSummary.toAmount] = [tradeSummary.toAmount, fromAmount.value];
      }
    }

    // ─── triggerTrade(): Execute *all* legs ────
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
        
        // Determine trade type based on order context
        if (providedTradeSummary) {
          if (providedTradeSummary.automatic) {
            // This is an automatic order execution
            currentTradeSummary.type = 'automatic';
          } else if (providedTradeSummary.priceLimit !== undefined) {
            // This is a manual limit order execution (has priceLimit)
            currentTradeSummary.type = 'limit';
          } else {
            // This is a manual swap
            currentTradeSummary.type = 'manual';
          }
        } else {
          // This is a manual trade
          currentTradeSummary.type = 'manual';
        }

        // Basic balance check for ETH → gas
        if (currentTradeSummary.fromToken.address === ethers.constants.AddressZero) {
          const addr = currentTradeSummary.sender.address.toLowerCase();
          const bal = computedBalancesByAddress.value[addr]?.[currentTradeSummary.fromToken.address.toLowerCase()] || 0;
          if (bal - Number(currentTradeSummary.fromAmount) < calculateGasReserve()) {
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
            contractAddress: currentTrades[0].contractAddress,
          }
          const response = await window.electronAPI.sendTransaction(args);
          if (!response?.success)
            throw new Error('Problem in sending transaction to Balancer: ' + response?.error?.toString());
          if (response.warnings && response.warnings.length) {
            globalWarnings = response.warnings;
          }

          globalTxs.push(response.tx);
        } else if (currentTradeSummary.protocol === 'Uniswap & Balancer') {
          const maxFeePerGas = ethers.utils.parseUnits(
            (Number(props.gasPrice) * 1.85 / 1e9).toFixed(3), 9
          )
          const maxPriorityFeePerGas =  ethers.utils.parseUnits(
            (0.02 + Math.random()*0.05 + Number(props.gasPrice)/(40e9)).toFixed(9), 9
          )
          // https://eth.meowrpc.com
          // https://rpc.mevblocker.io
          const privateProvider = new ethers.providers.JsonRpcProvider('https://rpc.mevblocker.io', { chainId: 1, name: 'homestead' });
          const nonce = await privateProvider.getTransactionCount(currentTradeSummary.sender.address, 'pending');

          const [resultsU, resultsB] = await Promise.all([
            executeMixedSwaps(
              currentTrades.filter((t) => !t.callData),
              {
                ...currentTradeSummary,
                fromAmount: currentTradeSummary.fromAmountU,
                expectedToAmount: currentTradeSummary.toAmountU,
                toAmount: currentTradeSummary.toAmountU,
                protocol: 'Uniswap'
              },
              slippage.value,
              props.gasPrice,
              maxFeePerGas,
              maxPriorityFeePerGas,
              nonce,
            ),
            window.electronAPI.sendTransaction({
              callData: currentTrades.filter(t => t.callData)[0].callData,
              outputAmount: currentTrades.filter(t => t.callData)[0].outputAmount.toString(),
              value: currentTrades.filter(t => t.callData)[0].value.toString(),
              nonce: nonce + 1,
              maxFeePerGas: maxFeePerGas,
              maxPriorityFeePerGas: maxPriorityFeePerGas,
              from: currentTradeSummary.sender.address,
              contractAddress: currentTrades.filter(t => t.contractAddress)[0].contractAddress,
              tradeSummary: JSON.parse(JSON.stringify({
                ...currentTradeSummary,
                fromAmount: currentTradeSummary.fromAmountB,
                expectedToAmount: currentTradeSummary.toAmountB,
                toAmount: currentTradeSummary.toAmountB,
                protocol: 'Balancer',
              })),
            })
          ]);
          
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
            tradeSummary
          )

        // Finalize summary & emit upwards
        currentTradeSummary.fromTokenSymbol = tokensByAddresses.value[currentTradeSummary.fromToken?.address].symbol;
        currentTradeSummary.toTokenSymbol   = tokensByAddresses.value[currentTradeSummary.toToken?.address].symbol;
        if (globalWarnings && globalWarnings.length) {
          swapMessage.value = 'Warnings: ' + globalWarnings.join(' ; ');
        }

        console.log(currentTradeSummary);
        
        if (currentTradeSummary.protocol === 'Uniswap & Balancer') {
          currentTradeSummary.txId = globalTxs[0]?.hash || null;
          emit('update:trade', {
             ...currentTradeSummary,
            fromAmount: currentTradeSummary.fromAmountU,
            expectedToAmount: currentTradeSummary.toAmountU,
            toAmount: currentTradeSummary.toAmountU,
            protocol: 'Uniswap'
          });
          currentTradeSummary.txId = globalTxs[1]?.hash || null;
          emit('update:trade', {
            ...currentTradeSummary,
            fromAmount: currentTradeSummary.fromAmountB,
            expectedToAmount: currentTradeSummary.toAmountB,
            toAmount: currentTradeSummary.toAmountB,
            protocol: 'Balancer'
          });
        } else {
          currentTradeSummary.txId = globalTxs[0]?.hash || null;
          emit('update:trade', { ...currentTradeSummary });
        }
      } catch (error) {
        // If using provided trade summary, update it; otherwise update the reactive one
        const currentTradeSummary = providedTradeSummary || tradeSummary;
        currentTradeSummary.txId     = null;
        currentTradeSummary.sentDate = null;

        if (error.toString().includes('insufficient funds for intrinsic transaction cost')) {
          swapMessage.value = 'Error: Not enough ETH on the address';
          isInsufficientEthError.value = true;
          startEthBalanceMonitoring();
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
      console.log(currentTradeSummary)
      if (!balanceOffsetByTokenByAddress[tokLower]) {
        balanceOffsetByTokenByAddress[tokLower] = {};
      }
      if (!balanceOffsetByTokenByAddress[tokLower][senderLc]) {
        balanceOffsetByTokenByAddress[tokLower][senderLc] = 0;
      }
      balanceOffsetByTokenByAddress[tokLower][senderLc] += Number(currentTradeSummary.fromAmount);
    }

    // ─── approveSpending(): Approve ERC20 → Permit2 → Router ───────────────
    const approveSpending = async (localTrades, localTradeSummary) => {
      try {
        isSwapButtonDisabled.value = true;
        
        // Use local trade summary if provided, otherwise fall back to global tradeSummary
        const activeTradeSummary = localTradeSummary || tradeSummary;
        
        // Get the correct sender address from the trade summary or fallback to senderDetails
        const senderAddress = activeTradeSummary.sender?.address || senderDetails.value.address;
        
        if (!senderAddress) {
          throw new Error('No sender address available for approval');
        }
        
        // Validate token address before approval
        const tokenAddr = activeTradeSummary.fromTokenAddress || fromTokenAddress.value;
        if (!tokenAddr || !ethers.utils.isAddress(tokenAddr)) {
          throw new Error('Invalid token address for approval: ' + tokenAddr);
        }

        console.log({senderAddress, tokenAddr})
        
        // Skip approval for ETH (zero address) - native token doesn't need approval
        if (tokenAddr === ethers.constants.AddressZero) {
          console.log('Skipping approval for ETH (native token)');
          needsToApprove.value = false;
          return;
        }
        
        // Uniswap
        if (activeTradeSummary.protocol === 'Uniswap' || activeTradeSummary.protocol === 'Uniswap & Balancer') {
          const { success, error } = await window.electronAPI.approveSpender(
            senderAddress,
            tokenAddr,
            PERMIT2_ADDRESS,
            UNIVERSAL_ROUTER_ADDRESS
          );
          if (!success) throw error;
        }
        // Balancer
        if (activeTradeSummary.protocol === 'Balancer' || activeTradeSummary.protocol === 'Uniswap & Balancer') {
          const myTrades = localTrades || trades.value;
          const balancerTradeV3 = myTrades.find(
            t => t.callData && t.contractAddress.toLowerCase() !== BALANCER_VAULT_ADDRESS.toLowerCase()
          );
          if (!balancerTradeV3) {
            const { success, error } = await window.electronAPI.approveSpender(
              senderAddress,
              tokenAddr,
              BALANCER_VAULT_ADDRESS
            );
            if (!success) throw error;
          } else {
            const { success, error } = await window.electronAPI.approveSpender(
              senderAddress,
              tokenAddr,
              PERMIT2_ADDRESS,
              balancerTradeV3.contractAddress
            );
            if (!success) throw error;
          }
        }

        needsToApprove.value = false;
      } catch (err) {
        console.error(err);
        const errorMessage = err?.message || err?.toString() || 'Unknown error during approval';
        if (errorMessage.includes('insufficient funds for intrinsic transaction cost')) {
          swapMessage.value = 'Error: Not enough ETH on the address ' + (activeTradeSummary?.sender?.address || senderDetails.value.address);
        } else {
          swapMessage.value = errorMessage;
        }
      } finally {
        isSwapButtonDisabled.value = false;
      }
    };

    // Emit when tokens scaffold changes
    const emitSettings = () => {
      const cleaned = tokens.value.filter(t =>
        t.symbol &&
        t.address &&
        (ethers.utils.isAddress(t.address) || t.address === ethers.constants.AddressZero)
      ).map(t => ({ ...t }));
      emit('update:settings', { tokens: cleaned });
    };

    watch(() => tokens.value, () => emitSettings(), { deep: true });

    // Track if we're updating from bidirectional calculation to prevent infinite loops
    let isUpdatingFromBidirectional = false;
    let lastFromAmountUpdate = 0;

    watch(
      [() => priceLimit.value, () => fromAmount.value, () => fromTokenAddress.value, () => toTokenAddress.value, () => tabOrder.value],
      ([priceLimitValue, fromAmountValue, fTA, tTA, tabOrderValue]) => {
      if (isUpdatingFromBidirectional) return;
      if (!fromAmountValue || isNaN(fromAmountValue)) {
        tradeSummary.toAmount = null;
        return;
      }
      if (tabOrderValue !== 'limit') return;
      if (priceLimitValue && !isNaN(priceLimitValue)) {
        tradeSummary.priceLimit = Number(priceLimitValue);
        // Mark that we're updating based on fromAmount change
        lastFromAmountUpdate = Date.now();
        if (shouldSwitchTokensForLimit.value) {
          tradeSummary.toAmount = (fromAmountValue / tradeSummary.priceLimit).toFixed(tokensByAddresses.value[toTokenAddress.value].decimals >= 9 ? 9 : 6);
        } else
          tradeSummary.toAmount = (fromAmountValue * tradeSummary.priceLimit).toFixed(tokensByAddresses.value[toTokenAddress.value].decimals >= 9 ? 9 : 6);
      } else {
        tradeSummary.priceLimit = null;
        tradeSummary.toAmount = null;
      }
    });

    // Watch for changes in toAmount to update fromAmount bidirectionally
    watch(
      () => tradeSummary.toAmount,
      (toAmountValue) => {
        if (isUpdatingFromBidirectional) return;
        if (tabOrder.value !== 'limit') return;
        if (!toAmountValue || isNaN(toAmountValue)) return;
        if (!priceLimit.value || isNaN(priceLimit.value)) return;
        
        // Don't update fromAmount if it was just updated (within 100ms)
        // This prevents interference when user is typing in fromAmount
        if (Date.now() - lastFromAmountUpdate < 100) return;
        
        isUpdatingFromBidirectional = true;
        
        if (shouldSwitchTokensForLimit.value) {
          fromAmount.value = (toAmountValue * priceLimit.value).toFixed(tokensByAddresses.value[fromTokenAddress.value].decimals >= 9 ? 9 : 6);
        } else {
          fromAmount.value = (toAmountValue / priceLimit.value).toFixed(tokensByAddresses.value[fromTokenAddress.value].decimals >= 9 ? 9 : 6);
        }
        
        // Reset the flag after a short delay to allow the DOM to update
        nextTick(() => {
          isUpdatingFromBidirectional = false;
        });
      }
    );

    watch(() => shouldSwitchTokensForLimit.value, () => {
      if (!priceLimit.value || isNaN(priceLimit.value)) return priceLimit.value = 0;
      priceLimit.value = 1/priceLimit.value; // Invert the price limit
    });

    function cancelLimitOrder(id) {
      pendingLimitOrders.value = pendingLimitOrders.value.filter(o => o.id !== id);

      window.electronAPI.deletePendingOrder(id);
    }

    function setMarketPriceAsLimit(fTokenAddress, tTokenAddress) {
      if (!fTokenAddress) fTokenAddress = fromTokenAddress.value
      if (!tTokenAddress) tTokenAddress = toTokenAddress.value
      // Use the current market price (fromToken to toToken)
      if (
        tokensByAddresses.value[fTokenAddress]?.price &&
        tokensByAddresses.value[tTokenAddress]?.price
      ) {
        const fromPrice = tokensByAddresses.value[fTokenAddress].price;
        const toPrice = tokensByAddresses.value[tTokenAddress].price;
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

    // Price deviation modal functions
    function checkPriceDeviation(userPrice, marketPrice, orderType) {
      if (!marketPrice || marketPrice === 0) return { needsConfirmation: false }; // Skip check if no market price
      
      const deviation = Math.abs((userPrice - marketPrice) / marketPrice * 100);
      
      console.log('checkPriceDeviation:', {
        userPrice,
        marketPrice,
        deviation,
        threshold: props.priceDeviationPercentage,
        orderType
      });
      
      if (deviation > props.priceDeviationPercentage) {
        const isBuyOrder = orderType === 'buy';
        const isUnfavorable = isBuyOrder ? userPrice > marketPrice : userPrice < marketPrice;
        
        console.log('Deviation check:', {
          isBuyOrder,
          isUnfavorable,
          condition: isBuyOrder ? 'userPrice > marketPrice' : 'userPrice < marketPrice'
        });
        
        if (isUnfavorable) {
          return {
            needsConfirmation: true,
            deviation: deviation.toFixed(2),
            isBuyOrder
          };
        }
      }
      
      return { needsConfirmation: false };
    }
    
    // Validate against existing pending orders bid-ask spread
    function validateAgainstPendingOrders(userPrice, orderType, fromTokenAddr, toTokenAddr, shouldInvert) {
      try {
        // Filter pending orders for the same token pair
        const relevantOrders = pendingLimitOrders.value.filter(order => {
          const orderFromAddr = order.fromToken.address.toLowerCase();
          const orderToAddr = order.toToken.address.toLowerCase();
          const currentFromAddr = fromTokenAddr.toLowerCase();
          const currentToAddr = toTokenAddr.toLowerCase();
          
          // Check if same token pair (either direction)
          return (orderFromAddr === currentFromAddr && orderToAddr === currentToAddr) ||
                 (orderFromAddr === currentToAddr && orderToAddr === currentFromAddr);
        });
        
        if (relevantOrders.length === 0) return { isValid: true };
        
        // Determine if current order is buy or sell based on shouldInvert
        const isBuyOrder = false;
        
        for (const order of relevantOrders) {
          // Determine if existing order is buy or sell
          const orderIsBuy = order.automatic ? (order.shouldSwitchTokensForLimit ? false : true) : false;
          
          // Get comparable prices (normalize to same direction)
          let orderPrice = order.priceLimit;
          let currentPrice = userPrice;
          
          // Handle dollar-based prices in existing orders
          if (order.limitPriceInDollars && order.toToken.price) {
            // Convert dollar price to token ratio
            orderPrice = orderPrice / order.toToken.price;
          }
          
          // If tokens are swapped, need to invert one of the prices for comparison
          const orderFromAddr = order.fromToken.address.toLowerCase();
          const currentFromAddr = fromTokenAddr.toLowerCase();
          const tokensSwapped = orderFromAddr !== currentFromAddr;
          
          if (tokensSwapped) {
            orderPrice = 1 / orderPrice;
          }
          
          // Check for bid-ask spread violations
          if (isBuyOrder && !orderIsBuy) {
            // Current: buy, Existing: sell - buy price cannot be >= sell price
            if (currentPrice >= orderPrice) {
              const orderDisplayPrice = order.limitPriceInDollars ? 
                `$${order.priceLimit.toFixed(6)}` : 
                `${(tokensSwapped ? (1/order.priceLimit) : order.priceLimit).toFixed(6)}`;
              return {
                isValid: false,
                reason: `Cannot buy at ${currentPrice.toFixed(6)} - price is at or above existing sell order at ${orderDisplayPrice}`
              };
            }
          } else if (!isBuyOrder && orderIsBuy) {
            // Current: sell, Existing: buy - sell price cannot be <= buy price  
            if (currentPrice <= orderPrice) {
              const orderDisplayPrice = order.limitPriceInDollars ? 
                `$${order.priceLimit.toFixed(6)}` : 
                `${(tokensSwapped ? (1/order.priceLimit) : order.priceLimit).toFixed(6)}`;
              return {
                isValid: false,
                reason: `Cannot sell at ${currentPrice.toFixed(6)} - price is at or below existing buy order at ${orderDisplayPrice}`
              };
            }
          }
        }
        
        return { isValid: true };
      } catch (error) {
        console.error('Error validating against pending orders:', error);
        return { isValid: true }; // Allow on error
      }
    }
    
    function showPriceDeviationConfirmation(data) {
      priceDeviationModalData.title = data.title;
      priceDeviationModalData.message = data.message;
      priceDeviationModalData.marketPrice = data.marketPrice;
      priceDeviationModalData.userPrice = data.userPrice;
      priceDeviationModalData.deviation = data.deviation;
      priceDeviationModalData.action = data.action;
      priceDeviationModalData.args = data.args;
      showPriceDeviationModal.value = true;
    }
    
    function confirmPriceDeviationAction() {
      showPriceDeviationModal.value = false;
      if (priceDeviationModalData.action && typeof priceDeviationModalData.action === 'function') {
        priceDeviationModalData.action(...(priceDeviationModalData.args || []));
      }
    }
    
    function cancelPriceDeviationAction() {
      showPriceDeviationModal.value = false;
      priceDeviationModalData.action = null;
      priceDeviationModalData.args = null;
    }

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
        swapMessage.value = 'No balances found for the selected address on ' + tokensByAddresses.value[fromTokenAddress.value].symbol;
        return;
      } else if (computedBalancesByAddress.value[senderDetails.value.address.toLowerCase()][fromTokenAddress.value.toLowerCase()] < fromAmount.value) {
        swapMessage.value = 'Insufficient balance of ' + tokensByAddresses.value[fromTokenAddress.value].symbol;
        return;
      }

      // Current market price (fromToken to toToken)
      const currentMarketPrice = !shouldSwitchTokensForLimit.value
        ? fromPrice / toPrice
        : toPrice / fromPrice;

      // Check against existing pending orders (bid-ask spread validation)
      const orderType = shouldSwitchTokensForLimit.value ? 'buy' : 'sell';
      const bidAskValidation = validateAgainstPendingOrders(
        priceLimit.value, 
        orderType, 
        fromTokenAddress.value, 
        toTokenAddress.value, 
        shouldSwitchTokensForLimit.value
      );
      
      if (!bidAskValidation.isValid) {
        // Show simple informational modal for order conflicts
        showPriceDeviationModal.value = true;
        priceDeviationModalData.title = 'Order Conflict';
        priceDeviationModalData.message = `Order aborted: ${bidAskValidation.reason}`;
        priceDeviationModalData.action = null; // No action, just close
        priceDeviationModalData.args = null;
        return;
      }
      
      // Check for price deviation
      console.log('Price deviation check:', {
        priceLimit: priceLimit.value,
        currentMarketPrice,
        orderType,
        shouldSwitchTokensForLimit: shouldSwitchTokensForLimit.value,
        fromPrice,
        toPrice
      });
      const deviationCheck = checkPriceDeviation(priceLimit.value, currentMarketPrice, orderType);
      
      if (deviationCheck.needsConfirmation) {
        // Show confirmation modal
        showPriceDeviationConfirmation({
          title: 'Price Deviation Warning',
          message: deviationCheck.isBuyOrder 
            ? `Your buy price is ${deviationCheck.deviation}% higher than the current market price. Are you sure you want to place this order?`
            : `Your sell price is ${deviationCheck.deviation}% lower than the current market price. Are you sure you want to place this order?`,
          marketPrice: currentMarketPrice.toFixed(6),
          userPrice: priceLimit.value.toFixed(6),
          deviation: deviationCheck.deviation,
          action: placeLimitOrderConfirmed,
          args: []
        });
        return;
      }
      
      placeLimitOrderConfirmed();
    }
    
    function placeLimitOrderConfirmed() {
      // Recalculate values since this might be called from modal confirmation
      const fromPrice = tokensByAddresses.value[fromTokenAddress.value]?.price;
      const toPrice = tokensByAddresses.value[toTokenAddress.value]?.price;
      
      const currentMarketPrice = !shouldSwitchTokensForLimit.value
        ? fromPrice / toPrice
        : toPrice / fromPrice;
        
      const expectedToAmount = !shouldSwitchTokensForLimit.value
        ? (fromAmount.value * priceLimit.value).toFixed(6)
        : (fromAmount.value / priceLimit.value).toFixed(6);

      // New limit order logic - no order type distinction
      // Order will trigger based on price comparison logic:
      // If not inverted: fromTokenPrice >= limitPrice * toTokenPrice
      // If inverted: toTokenPrice <= limitPrice * fromTokenPrice

      const order = {
        id: Date.now(),
        fromAmount: fromAmount.value,
        remainingAmount: fromAmount.value, // Track remaining amount for partial executions
        toAmount: expectedToAmount, // Use calculated expected amount
        fromToken: JSON.parse(JSON.stringify(tokensByAddresses.value[fromTokenAddress.value])),
        toToken: JSON.parse(JSON.stringify(tokensByAddresses.value[toTokenAddress.value])),
        priceLimit: priceLimit.value,
        currentMarketPrice: currentMarketPrice,
        // orderType removed - new logic doesn't use this distinction
        shouldSwitchTokensForLimit: shouldSwitchTokensForLimit.value,
        sender: JSON.parse(JSON.stringify(senderDetails.value)),
        status: 'pending',
        createdAt: new Date().toISOString()
      };

      pendingLimitOrders.value.unshift(order);

      // Save to database with order type information
      window.electronAPI.savePendingOrder(order);
      
      // Only apply balance offset in real mode (not test mode)
      if (!props.isTestMode) {
        increaseOffsetBalance(
          order.fromToken.address.toLowerCase(),
          order.sender.address.toLowerCase(),
          order,
        );
      }

      swapMessage.value = `Limit order placed`;
    }

    // Helper function to find addresses with highest balances for a token
    function getAddressesWithHighestBalances(tokenAddress, requiredAmount, order = null) {
      const tokenAddr = tokenAddress.toLowerCase();
      const isETH = tokenAddr === '0x0000000000000000000000000000000000000000' || tokenAddr === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
      
      // Calculate gas reserve for ETH trades (use gas price to estimate)
      const gasReserve = isETH ? calculateGasReserve() : 0;
      
      // Get minimum amount and random mode settings from order if available
      let minimumAmount = 0;
      let isRandomMode = false;
      
      if (order && order.automatic && order.sourceLocation) {
        const { rowIndex, colIndex } = order.sourceLocation;
        const tradingPairConfig = tokensInRow.value?.[rowIndex]?.columns?.[colIndex];
        minimumAmount = tradingPairConfig?.details?.minimumAmount || 0;
        isRandomMode = tradingPairConfig?.details?.isRandomMode || false;
      }
      
      const availableAddresses = props.addresses
        .map(address => ({
          ...address,
          balance: address.balances?.[tokenAddr] || 0
        }))
        .filter(address => {
          const balance = address.balance;
          const hasPositiveBalance = balance > 0 && (isETH ? balance > gasReserve : true);
          
          // Add minimum amount check
          if (hasPositiveBalance && minimumAmount > 0) {
            // For ETH, check if balance minus gas reserve meets minimum
            const effectiveBalance = isETH ? balance - gasReserve : balance;
            
            if (order && order.sourceLocation) {
              if (order.sourceLocation.levelType === 'buy') {
                // For buy orders: check if expected output meets minimum
                const expectedOutputAmount = effectiveBalance * order.priceLimit;
                return expectedOutputAmount >= minimumAmount;
              } else if (order.sourceLocation.levelType === 'sell') {
                // For sell orders: check if input amount meets minimum
                return effectiveBalance >= minimumAmount;
              }
            }
            
            // Default check for non-automatic orders
            return effectiveBalance >= minimumAmount;
          }
          
          return hasPositiveBalance;
        });
      
      // Apply sorting based on mode
      let sortedAddresses;
      if (isRandomMode) {
        // Random mode: shuffle the array
        sortedAddresses = [...availableAddresses].sort(() => Math.random() - 0.5);
      } else {
        // Highest balance mode: sort by balance descending
        sortedAddresses = availableAddresses.sort((a, b) => b.balance - a.balance);
      }
      
      const selectedAddresses = [];
      let totalAmount = 0;
      
      for (const address of sortedAddresses) {
        if (totalAmount >= requiredAmount) break;
        
        // For ETH, subtract gas reserve from available balance
        const maxAvailable = isETH ? address.balance - gasReserve : address.balance;
        let availableFromAddress = Math.min(maxAvailable, requiredAmount - totalAmount);
        
        // Additional minimum amount check per address
        if (minimumAmount > 0 && order && order.sourceLocation) {
          if (order.sourceLocation.levelType === 'buy') {
            // For buy orders: ensure this address's contribution results in minimum output
            const expectedOutputFromAddress = availableFromAddress * order.priceLimit;
            if (expectedOutputFromAddress < minimumAmount && selectedAddresses.length > 0) {
              // If we already have other addresses and this one doesn't meet minimum, skip it
              continue;
            }
          } else if (order.sourceLocation.levelType === 'sell') {
            // For sell orders: ensure this address's contribution meets minimum
            if (availableFromAddress < minimumAmount && selectedAddresses.length > 0) {
              // If we already have other addresses and this one doesn't meet minimum, skip it
              continue;
            }
          }
        }
        
        if (availableFromAddress > 0) {
          selectedAddresses.push({
            address: address.address,
            name: address.name,
            amount: availableFromAddress
          });
          totalAmount += availableFromAddress;
        }
      }
      
      return { addresses: selectedAddresses, totalAvailable: totalAmount };
    }

    // Calculate gas reserve based on current gas price
    function calculateGasReserve() {
      const gasLimit = 300000; // Estimated gas limit for swaps
      const gasPrice = props.gasPrice || '20000000000'; // 20 Gwei default
      const gasCostWei = BigInt(gasLimit) * BigInt(gasPrice);
      const gasCostEth = Number(gasCostWei) / 1e18;
      
      // Use minimum of 0.003 ETH or calculated gas cost + 50% safety margin
      const calculatedReserve = gasCostEth * 1.5;
      return Math.max(0.003, calculatedReserve);
    }

    // Helper function to calculate execution price with gas cost adjustments
    function calculateExecutionPrice(order, tradeResult, amount, toTokenPrice, deductGasCost = true) {
      let executionPrice;
      
      // Base calculation
      executionPrice = Number(tradeResult.totalHuman) / Number(amount);
      
      // Apply gas cost adjustment only if deductGasCost is true
      if (deductGasCost && props.maxGasPrice && Number(props.maxGasPrice) * 1e9 < Number(props.gasPrice)) {
        const gasCostInToToken = tradeResult.gasLimit * Number(props.gasPrice) * props.ethPrice / toTokenPrice;
        
        if (Number(tradeResult.totalHuman) <= gasCostInToToken) {
          return { executionPrice: null, comparableExecutionPrice: null, unprofitable: true };
        }
        
        if (order.shouldSwitchTokensForLimit) {
          executionPrice = Number(amount) / (Number(tradeResult.totalHuman) - gasCostInToToken);
        } else {
          executionPrice = (Number(tradeResult.totalHuman) - gasCostInToToken) / Number(amount);
        }
      } else if (order.shouldSwitchTokensForLimit) {
        // Invert price for shouldSwitchTokensForLimit orders
        executionPrice = 1 / executionPrice;
      }
      
      // Calculate comparable price for dollar-based orders
      let comparableExecutionPrice = executionPrice;
      if (order.limitPriceInDollars) {
        if (!order.shouldSwitchTokensForLimit) {
          // Sell levels: convert execution price to dollars (fromToken price)
          comparableExecutionPrice = executionPrice * toTokenPrice;
        } else {
          // Buy levels: For dollar-based buy orders, we want the dollar price of the toToken
          // executionPrice is toToken/fromToken ratio (after inversion)
          // So the dollar price is simply toTokenPrice
          comparableExecutionPrice = toTokenPrice;
        }
      }
      
      return { executionPrice, comparableExecutionPrice, unprofitable: false };
    }

    // Async function to handle multi-address execution without blocking main loop
    // Helper function to re-validate trigger conditions
    async function revalidateTriggerCondition(order, executionAmount) {
      try {
        // Get current token prices
        const fromToken = tokensByAddresses.value[order.fromToken.address];
        const toToken = tokensByAddresses.value[order.toToken.address];
        
        if (!fromToken?.price || !toToken?.price) {
          console.log(`Missing price data for re-validation: fromToken=${fromToken?.symbol}, toToken=${toToken?.symbol}`);
          return { valid: false, reason: 'Missing price data' };
        }

        // Calculate current market price
        let currentMarketPrice;
        if (!order.shouldSwitchTokensForLimit) {
          currentMarketPrice = fromToken.price / toToken.price;
        } else {
          currentMarketPrice = toToken.price / fromToken.price;
        }

        // Get exact execution price from DEX
        let bestTradeResult = await getBestTrades(
          order.fromToken.address,
          order.toToken.address,
          executionAmount.toString(),
          order?.sender?.address || senderDetails.value.address,
          true,
          true,
          fromToken.price * Number(executionAmount) >= 100,
        );

        if (!bestTradeResult || !bestTradeResult.totalHuman) {
          return { valid: false, reason: 'Unable to get execution quote' };
        }

        // Calculate execution price using the helper
        const { executionPrice: exactExecutionPrice, comparableExecutionPrice, unprofitable } = calculateExecutionPrice(
          order, 
          bestTradeResult, 
          executionAmount, 
          toToken.price
        );
        
        if (unprofitable) {
          return { valid: false, reason: 'Trade unprofitable due to gas costs' };
        }
        
        // Check if trigger condition is still valid based on new logic
        let shouldTrigger = false;
        if (!order.shouldSwitchTokensForLimit) {
          // Normal case: trigger when execution price >= limit price
          shouldTrigger = comparableExecutionPrice >= order.priceLimit;
        } else {
          // Inverted case: trigger when execution price <= limit price
          shouldTrigger = comparableExecutionPrice <= order.priceLimit;
        }

        // Calculate loss protection check using configurable percentage
        const inputValueUSD = Number(executionAmount) * fromToken.price;
        const outputValueUSD = Number(bestTradeResult.totalHuman) * toToken.price;
        const lossPercentage = ((inputValueUSD - outputValueUSD) / inputValueUSD) * 100;
        
        if (lossPercentage > props.priceDeviationPercentage) {
          return { 
            valid: false, 
            exactExecutionPrice,
            comparableExecutionPrice,
            currentMarketPrice,
            priceDifference: 0,
            bestTradeResult,
            reason: `Excessive loss: ${lossPercentage.toFixed(1)}% (max ${props.priceDeviationPercentage}% allowed)` 
          };
        }

        const priceDifference = Math.abs(comparableExecutionPrice - order.priceLimit) / order.priceLimit;
        
        return {
          valid: shouldTrigger,
          exactExecutionPrice,
          comparableExecutionPrice, // Add this to the return object
          currentMarketPrice,
          priceDifference: priceDifference * 100, // Convert to percentage
          bestTradeResult, // Return the updated bestTradeResult
          reason: shouldTrigger ? 'Trigger condition met' : `Price condition not met: ${order.limitPriceInDollars ? '$' : ''}${comparableExecutionPrice.toFixed(9)} vs limit ${order.limitPriceInDollars ? '$' : ''}${order.priceLimit.toFixed(9)}`
        };
      } catch (error) {
        console.error('Error during price re-validation:', error);
        return { valid: false, reason: `Re-validation error: ${error.message}` };
      }
    }

    async function executeMultiAddressTrade(order, addressSelection, exactExecutionPrice, targetAmount) {
      let totalExecuted = 0;
      let allExecutionSuccessful = true;
      let validationFailures = 0;
      const maxValidationFailures = 2; // Allow up to 2 validation failures before stopping
      
      try {
        console.log(`Starting multi-address execution for order ${order.id} with ${addressSelection.addresses.length} addresses, target amount: ${targetAmount}`);
        
        // Execute trades sequentially with each address
        for (let i = 0; i < addressSelection.addresses.length; i++) {
          const addressInfo = addressSelection.addresses[i];
          const { address, amount, name } = addressInfo;
          
          if (totalExecuted >= targetAmount) break;
          
          const executeAmount = Math.min(amount, targetAmount - totalExecuted);
          
          // Re-validate trigger conditions before each address execution (except first)
          if (i > 0) {
            console.log(`Re-validating trigger conditions before executing with address ${name} (${i + 1}/${addressSelection.addresses.length})`);
            
            const validation = await revalidateTriggerCondition(order, executeAmount);
            
            if (!validation.valid) {
              console.log(`⚠️ Trigger condition no longer valid for address ${name}: ${validation.reason}`);
              const unit = order.limitPriceInDollars ? '$' : '';
              console.log(`Market price: ${validation.currentMarketPrice?.toFixed(9) || 'N/A'}, Execution price: ${validation.exactExecutionPrice?.toFixed(9) || 'N/A'}, Limit: ${unit}${order.priceLimit}`);
              
              validationFailures++;
              
              // Stop execution if too many validation failures
              if (validationFailures >= maxValidationFailures) {
                console.log(`❌ Stopping multi-address execution due to ${validationFailures} consecutive validation failures`);
                allExecutionSuccessful = false;
                break;
              }
              
              // Skip this address but continue with others
              continue;
            } else {
              console.log(`✅ Trigger condition still valid: ${validation.reason} (difference: ${validation.priceDifference.toFixed(2)}%)`);
              validationFailures = 0; // Reset failure counter on successful validation
            }
          }
          
          console.log(`Executing ${executeAmount} ${order.fromToken.symbol} from address ${name} (${i + 1}/${addressSelection.addresses.length})`);
          
          const execution = await executeTradeWithAddress(order, addressInfo, executeAmount);
          
          if (execution.success) {
            totalExecuted += execution.executedAmount;
            console.log(`✅ Successfully executed ${execution.executedAmount} ${order.fromToken.symbol} from ${name}. Total executed: ${totalExecuted}/${order.remainingAmount}`);
            
            // Add delay before next address (except for last address)
            if (i < addressSelection.addresses.length - 1 && totalExecuted < order.remainingAmount) {
              console.log(`⏳ Waiting 25 seconds before next address execution...`);
              await new Promise(resolve => setTimeout(resolve, 25000)); 
            }
          } else {
            console.error(`❌ Failed to execute trade with address ${address.name}: ${execution.error}`);
            allExecutionSuccessful = false;
            
            // Check if failure is due to price conditions
            if (execution.error && execution.error.includes('Price condition no longer valid')) {
              validationFailures++;
              console.log(`Price-related failure count: ${validationFailures}/${maxValidationFailures}`);
              
              if (validationFailures >= maxValidationFailures) {
                console.log(`❌ Stopping execution due to repeated price validation failures`);
                break;
              }
            } else {
              // Non-price related failure, stop execution
              break;
            }
          }
        }
        
        // Update order status based on execution results
        if (allExecutionSuccessful && totalExecuted >= order.remainingAmount) {
          order.status = 'completed';
          order.remainingAmount = 0;
        } else {
          order.remainingAmount = Math.max(0, order.remainingAmount - totalExecuted);
          order.status = totalExecuted > 0 ? 'partially_filled' : 'failed';
          
          // If partial execution due to price conditions, update level percentage
          if (totalExecuted > 0 && !allExecutionSuccessful && order.automatic && order.sourceLocation) {
            const { rowIndex, colIndex, levelIndex, levelType } = order.sourceLocation;
            if (tokensInRow[rowIndex]?.columns[colIndex]?.details) {
              const levels = levelType === 'sell' 
                ? tokensInRow[rowIndex].columns[colIndex].details.sellLevels 
                : tokensInRow[rowIndex].columns[colIndex].details.buyLevels;
                
              if (levels[levelIndex]) {
                // Calculate new percentage based on remaining amount
                const originalPercentage = levels[levelIndex].balancePercentage;
                const executedRatio = totalExecuted / order.fromAmount;
                const remainingRatio = 1 - executedRatio;
                const newPercentage = originalPercentage * remainingRatio;
                
                console.log(`Updating level percentage from ${originalPercentage}% to ${newPercentage.toFixed(2)}% due to partial execution`);
                
                // Update the level with new percentage and set partially filled status
                levels[levelIndex].balancePercentage = Number(newPercentage.toFixed(2));
                levels[levelIndex].status = 'partially_filled'; // Mark as partially filled, not active
                levels[levelIndex].partialExecutionDate = new Date().toISOString();
                levels[levelIndex].executedAmount = totalExecuted;
                levels[levelIndex].originalPercentage = originalPercentage;
                
                updateDetailsOrder(rowIndex, colIndex, tokensInRow[rowIndex].columns[colIndex].details);
              }
            }
            
            // Exit the function early to leave remaining amount for future execution
            console.log(`Partial execution completed. Remaining: ${order.remainingAmount}, will retry later`);
            return;
          }
        }
        
        order.completedAt = new Date().toISOString();
        order.executionPrice = exactExecutionPrice;
        
        // Update UI for automatic orders
        if (order.automatic && order.sourceLocation) {
          const { rowIndex, colIndex, levelIndex, levelType } = order.sourceLocation;
          if (tokensInRow[rowIndex]?.columns[colIndex]?.details) {
            const levels = levelType === 'sell' 
              ? tokensInRow[rowIndex].columns[colIndex].details.sellLevels 
              : tokensInRow[rowIndex].columns[colIndex].details.buyLevels;
              
            if (levels[levelIndex]) {
              // Explicitly set status based on order completion
              if (order.status === 'completed') {
                // Keep status as 'processing' until transaction is confirmed
                levels[levelIndex].status = 'processing';
              } else if (order.status === 'partially_filled') {
                levels[levelIndex].status = 'partially_filled';
              } else {
                levels[levelIndex].status = 'failed';
              }
              levels[levelIndex].executionPrice = exactExecutionPrice;
              levels[levelIndex].executionDate = new Date().toISOString();
              updateDetailsOrder(rowIndex, colIndex, tokensInRow[rowIndex].columns[colIndex].details);
              console.log(`Level ${levelIndex} status updated to: ${levels[levelIndex].status} (order status: ${order.status})`);
            }
          }
        }
        
        console.log(`Multi-address execution completed. Order ${order.id}: ${order.status}, executed: ${totalExecuted}/${order.fromAmount}`);
        
        // Update database with final order status
        await window.electronAPI.updatePendingOrder({
          ...JSON.parse(JSON.stringify(order)),
          status: order.status,
          remainingAmount: order.remainingAmount?.toString() || '0',
          completedAt: order.completedAt,
          executionPrice: order.executionPrice
        });
        
        // Remove from pending orders if completed
        if (order.status === 'completed') {
          pendingLimitOrders.value = pendingLimitOrders.value.filter(o => o.id !== order.id);
        }
        
      } catch (error) {
        console.error('Multi-address execution failed:', error);
        order.status = 'failed';
        order.completedAt = new Date().toISOString();
        
        // Update database with failed status
        await window.electronAPI.updatePendingOrder({
          ...JSON.parse(JSON.stringify(order)),
          status: 'failed',
          completedAt: order.completedAt,
          errorMessage: error.message || String(error)
        });
      }
    }

    // Helper function to execute trade with specific address and amount
    async function executeTradeWithAddress(order, addressInfo, amount) {
      try {
        console.log('executeTradeWithAddress called with addressInfo:', addressInfo);
        const modifiedOrder = {
          ...order,
          fromAmount: amount,
          sender: addressInfo
        };
        
        // Use revalidateTriggerCondition to get trade result and validate
        const validation = await revalidateTriggerCondition(modifiedOrder, amount);
        
        if (!validation.valid) {
          throw new Error(`Trade condition not met: ${validation.reason}`);
        }
        
        let bestTradeResult = validation.bestTradeResult;

        // Log validation result
        const unit = order.limitPriceInDollars ? '$' : '';
        console.log(`Price validation passed. Execution price: ${unit}${validation.comparableExecutionPrice.toFixed(9)} vs limit: ${unit}${order.priceLimit.toFixed(9)} (inverted: ${order.shouldSwitchTokensForLimit})`);        
        
        const limitOrderTradeSummary = {
          protocol: bestTradeResult.protocol,
          sender: addressInfo,
          fromAmount: amount.toString(),
          toAmount: bestTradeResult.totalHuman,
          expectedToAmount: bestTradeResult.totalHuman,
          fromTokenSymbol: bestTradeResult.fromToken.symbol,
          toTokenSymbol: bestTradeResult.toToken.symbol,
          fromAddressName: addressInfo.name,
          fromToken: bestTradeResult.fromToken,
          fromTokenAddress: bestTradeResult.fromToken.address,
          toToken: bestTradeResult.toToken,
          toTokenAddress: bestTradeResult.toToken.address,
          gasLimit: bestTradeResult.gasLimit,
          automatic: order.automatic,
          priceLimit: order.priceLimit,
          type: order.automatic ? 'automatic' : 'limit',
        };

        
        // Handle mixed trades if applicable
        if (bestTradeResult.bestMixed) {
          limitOrderTradeSummary.fromAmountU = (Number(amount) * bestTradeResult.fractionMixed / 100).toFixed(7);
          limitOrderTradeSummary.fromAmountB = (Number(amount) - Number(limitOrderTradeSummary.fromAmountU)).toFixed(7);
          limitOrderTradeSummary.toAmountU = Number(ethers.utils.formatUnits(bestTradeResult.bestMixed.tradesU.totalBig, bestTradeResult.toToken.decimals)).toFixed(7);
          limitOrderTradeSummary.toAmountB = Number(ethers.utils.formatUnits(bestTradeResult.bestMixed.tradesB.totalBig, bestTradeResult.toToken.decimals)).toFixed(7);
        }


        // 🕐 Time the approval process and re-validate if it takes too long
        const approvalStartTime = Date.now();
        await approveSpending(limitOrderTradeSummary);
        const approvalDuration = (Date.now() - approvalStartTime) / 1000; // Convert to seconds
        
        console.log(`Approval completed in ${approvalDuration.toFixed(2)} seconds`);

        if (props.isTestMode) {
          // Test mode: simulate multi-address execution
          console.log(`TEST MODE: Simulating multi-address execution for order ${order.id}`);
          
          const testTrade = {
            ...limitOrderTradeSummary,
            txId: 'TEST_MULTI_' + Date.now(),
            sentDate: new Date(),
            isConfirmed: true,
            timestamp: new Date(),
            testMode: true,
            orderId: order.id,
            orderSourceLocation: order.sourceLocation
          };
          
          emit('update:trade', testTrade);
          
          return {success: true, executedAmount: amount};
        }
        
        // 🔍 Re-validate and refresh trade data if approval took longer than 5 seconds
        if (approvalDuration > 5) {
          console.log(`⚠️ Approval took ${approvalDuration.toFixed(2)}s (>5s), re-validating with fresh trade data...`);
          
          const postApprovalValidation = await revalidateTriggerCondition(order, amount);
          
          if (!postApprovalValidation.valid) {
            console.log(`❌ Price condition no longer valid after slow approval: ${postApprovalValidation.reason}`);
            return { 
              success: false, 
              error: `Price condition no longer valid after approval (${approvalDuration.toFixed(2)}s): ${postApprovalValidation.reason}` 
            };
          }
          
          console.log(`✅ Price condition still valid after slow approval. Updated execution price: ${postApprovalValidation.exactExecutionPrice.toFixed(9)} (difference: ${postApprovalValidation.priceDifference.toFixed(2)}%)`);
          
          // Use the refreshed bestTradeResult from revalidation
          bestTradeResult = postApprovalValidation.bestTradeResult;
          limitOrderTradeSummary.toAmount = bestTradeResult.totalHuman;
          limitOrderTradeSummary.expectedToAmount = bestTradeResult.totalHuman;
          limitOrderTradeSummary.gasLimit = bestTradeResult.gasLimit;
        }
        
        // Add order information to trade summary for transaction tracking
        limitOrderTradeSummary.orderId = order.id;
        limitOrderTradeSummary.orderSourceLocation = order.sourceLocation;
        
        await triggerTrade(bestTradeResult.trades, limitOrderTradeSummary);
        
        return { success: true, executedAmount: amount };
      } catch (error) {
        console.error('Trade execution failed:', error);
        return { success: false, error: error.message };
      }
    }

    let isCheckingPendingOrders = false;
    const orderExecutionLocks = new Map(); // Track orders currently being executed
    
    async function checkPendingOrdersToTrigger() {
      // Check global pause state first
      
      automaticMessage.value = null;
      try {
        await setTokenPrices(tokens.value);
      } catch (error) {
        console.error('Error updating token prices:', error);
      }

      if (!props.isInitialBalanceFetchDone) return;

      if (isCheckingPendingOrders) return console.log('isCheckingPendingOrders === true');
      isCheckingPendingOrders = true;

      try {

        let allOrders = pendingLimitOrders.value;
        
        if (!isGloballyPaused.value) {
          generateOrdersFromLevels();
          allOrders = allOrders.concat(automaticOrders.value);
        }

        if (!senderDetails.value?.address) {
          isCheckingPendingOrders = false;
          return console.log('skipping pending orders check, no sender address');
        }
        if (!allOrders || !allOrders.length) {
          isCheckingPendingOrders = false;
          return
        }

        for (const order of allOrders) {
          // Skip if order is not pending or already being processed
          if (!order || !order.status || (order.status !== 'pending')) continue;
          try {
            // Validate token addresses first
            if (!order.fromToken?.address || !order.toToken?.address || 
                !ethers.utils.isAddress(order.fromToken.address) || 
                !ethers.utils.isAddress(order.toToken.address)) {
              console.error(`Order ${order.id} has invalid token addresses:`, {
                fromToken: order.fromToken?.address,
                toToken: order.toToken?.address
              });
              continue;
            }
            
            // Get current token prices from our updated token list
            const fromToken = tokensByAddresses.value[order.fromToken.address];
            if (!order.automatic) {
              const senderD = props.addresses.find((a) => a && a.address && order.sender && order.sender.address && a.address.toLowerCase() === order.sender.address.toLowerCase());

              if (senderD?.balances == null || !fromToken) {
                console.log(`Skipping order ${order.id} due to missing token or sender data`);
                continue;
              }

              if (Number(order.fromAmount) > senderD.balances[fromToken.address.toLowerCase()]) {
                order.isWaitingBalance = true;
                continue;
              } else if (order.isWaitingBalance) {
                order.isWaitingBalance = false;
              }
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
            
            // Convert to comparable units
            let comparableMarketPrice = currentMarketPrice;
            let comparablePriceLimit = order.priceLimit;
            
            if (order.limitPriceInDollars) {
              if (!order.shouldSwitchTokensForLimit) {
                // Sell levels: monitor fromToken price in dollars
                comparableMarketPrice = fromToken.price;
              } else {
                // Buy levels: monitor toToken price in dollars
                comparableMarketPrice = toToken.price;
              }
              // For dollar-based orders, the priceLimit is already in dollars
              comparablePriceLimit = order.priceLimit;
            }

            // Define price tolerance (e.g., within 1% of trigger price)
            const PRICE_TOLERANCE = 0.01; // 1%
            const priceDifference = Math.abs(comparableMarketPrice - comparablePriceLimit) / comparablePriceLimit;
            
            // Only proceed with expensive getBestTrades call if we're close to trigger price
            let shouldCheckExactPrice = false;
            let shouldTrigger = false;

            // New trigger logic based on price comparison using comparable units
            // If not inverted: trigger when market price >= limit price
            // If inverted: trigger when market price <= limit price
            if (!order.shouldSwitchTokensForLimit) {
              // Normal case: check if we're close to trigger price (>=)
              shouldCheckExactPrice = comparableMarketPrice >= comparablePriceLimit || priceDifference <= PRICE_TOLERANCE;
            } else {
              // Inverted case: check if we're close to trigger price (<=)
              shouldCheckExactPrice = comparableMarketPrice <= comparablePriceLimit || priceDifference <= PRICE_TOLERANCE;
            }

            if (!shouldCheckExactPrice) {
              // Price is not close enough to trigger, log and continue
              const unit = order.limitPriceInDollars ? '$' : '';
              console.log(`Order ${order.id}: market price ${unit}${comparableMarketPrice.toFixed(6)} not close to limit ${unit}${comparablePriceLimit.toFixed(6)} (diff: ${(priceDifference * 100).toFixed(2)}%) - skipping exact price check`);
              continue;
            }

            const unit = order.limitPriceInDollars ? '$' : '';
            console.log(`Order ${order.id}: market price ${unit}${comparableMarketPrice.toFixed(6)} is close to limit ${unit}${comparablePriceLimit.toFixed(6)} - checking exact execution price`);

            // Get exact trade execution price by fetching best trades
            const bestTradeResult = await getBestTrades(
              order.fromToken.address,
              order.toToken.address,
              (Number(order.fromAmount) * 0.01).toString(),
              order?.sender?.address || senderDetails.value.address,
              true,
              true,
              tokensByAddresses.value[order.fromToken.address].price * Number(order.fromAmount) >= 100,
            );

            // Calculate exact execution price using the helper (with small test amount)
            // No gas deduction for initial price check
            const { executionPrice: exactExecutionPrice, comparableExecutionPrice } = calculateExecutionPrice(
              order, 
              bestTradeResult, 
              Number(order.fromAmount) * 0.01,
              toToken.price,
              false  // Don't deduct gas cost for initial check
            );
            console.log({exactExecutionPrice, comparableExecutionPrice})

            // Get the comparable price limit
            comparablePriceLimit = order.priceLimit;
            if (order.limitPriceInDollars) {
              // For dollar-based orders, the priceLimit is already in dollars
              comparablePriceLimit = order.priceLimit;
            }
            
            // Determine if order should be triggered based on new logic
            if (!order.shouldSwitchTokensForLimit) {
              // Normal case: trigger when execution price >= limit price
              shouldTrigger = comparableExecutionPrice >= comparablePriceLimit;
            } else {
              // Inverted case: trigger when execution price <= limit price
              shouldTrigger = comparableExecutionPrice <= comparablePriceLimit;
            }

            if (!shouldTrigger) {
              const unit = order.limitPriceInDollars ? '$' : '';
              console.log(`Order ${order.id}: exact execution price ${unit}${comparableExecutionPrice.toFixed(9)} vs limit ${unit}${comparablePriceLimit.toFixed(9)} - not triggered`);
              continue
            }
          
            // Execute order asynchronously without blocking main loop
            tryExecutePendingOrder(order, exactExecutionPrice);
            await new Promise(r => setTimeout(r, 2000));
          } catch (error) {
            console.error(`Error checking limit order ${order.id}:`, error);
          }
        }
      } catch (err) {
        automaticMessage.value = err;
        console.error(err)
      }
      isCheckingPendingOrders = false;
    }

    /**
     * Try to execute a pending order asynchronously with proper locking
     * @param {Object} order - The order to execute
     * @param {number} exactExecutionPrice - The calculated execution price
     */
    // Helper function to test if an amount can be executed at the required price
    async function testExecutableAmount(order, testAmount) {
      // Validate amount is not zero or invalid
      if (!testAmount || Number(testAmount) <= 0) {
        console.warn(`testExecutableAmount: Invalid amount ${testAmount} for order ${order.id}`);
        return { meetsCondition: false, executionPrice: undefined, tradeResult: null, unprofitable: false };
      }
      
      // Validate token data exists
      const fromTokenData = tokensByAddresses.value[order.fromToken.address];
      const toTokenData = tokensByAddresses.value[order.toToken.address];
      
      if (!fromTokenData || !toTokenData) {
        console.error(`Missing token data for order ${order.id}:`, {
          fromToken: order.fromToken.address,
          toToken: order.toToken.address
        });
        return { meetsCondition: false, executionPrice: undefined, tradeResult: null, unprofitable: false };
      }
      
      // Get trade result for this amount
      let testResult;
      try {
        testResult = await getBestTrades(
          order.fromToken.address,
          order.toToken.address,
          testAmount.toString(),
          order?.sender?.address || senderDetails.value.address,
          true,
          true,
          fromTokenData.price * testAmount >= 100,
        );
      } catch (error) {
        console.error(`Error getting best trades for order ${order.id}:`, error);
        return { meetsCondition: false, executionPrice: undefined, tradeResult: null, unprofitable: false };
      }
      
      if (!testResult || !testResult.totalHuman) {
        console.error(`Invalid trade result for order ${order.id}`);
        return { meetsCondition: false, executionPrice: undefined, tradeResult: null, unprofitable: false };
      }
      
      // Calculate loss protection check using configurable percentage
      const inputValueUSD = Number(testAmount) * fromTokenData.price;
      const outputValueUSD = Number(testResult.totalHuman) * toTokenData.price;
      const lossPercentage = ((inputValueUSD - outputValueUSD) / inputValueUSD) * 100;
      
      if (lossPercentage > 40) {
        // Trade rejected due to excessive loss - treat as unprofitable
        return { meetsCondition: false, executionPrice: undefined, tradeResult: testResult, unprofitable: true };
      }
      
      // Calculate execution price using the helper
      const { executionPrice: testExecutionPrice, comparableExecutionPrice: comparableTestPrice, unprofitable } = calculateExecutionPrice(
        order,
        testResult,
        testAmount,
        toTokenData.price
      );
      
      if (unprofitable) {
        return { meetsCondition: false, executionPrice: undefined, tradeResult: testResult, unprofitable: true };
      }
      
      // Get the comparable price limit
      let comparablePriceLimit = order.priceLimit;
      
      // Check if this amount meets the limit condition
      let meetsCondition;
      if (!order.shouldSwitchTokensForLimit) {
        meetsCondition = comparableTestPrice >= comparablePriceLimit;
      } else {
        meetsCondition = comparableTestPrice <= comparablePriceLimit;
      }

      // Check minimum amount requirement for automatic orders
      if (order.automatic && order.sourceLocation) {
        const { rowIndex, colIndex } = order.sourceLocation;
        const tradingPairConfig = tokensInRow.value?.[rowIndex]?.columns?.[colIndex];
        const minimumAmount = tradingPairConfig?.details?.minimumAmount || 0;
        
        if (minimumAmount > 0) {
          let meetsMinimumRequirement = false;
          
          if (order.sourceLocation.levelType === 'buy') {
            // For buy orders: check expected output amount (buying toToken)
            const expectedOutputAmount = Number(order.fromAmount) * order.priceLimit;
            meetsMinimumRequirement = expectedOutputAmount >= minimumAmount;
            
            if (!meetsMinimumRequirement) {
              console.log(`Skipping automatic BUY order ${order.id}: expected output ${expectedOutputAmount} ${order.toToken.symbol} below minimum amount ${minimumAmount}`);
              return { meetsCondition: false, executionPrice: undefined, tradeResult: testResult, unprofitable: false };
            }
          } else if (order.sourceLocation.levelType === 'sell') {
            // For sell orders: check input amount (selling fromToken)
            meetsMinimumRequirement = Number(order.fromAmount) >= minimumAmount;
            
            if (!meetsMinimumRequirement) {
              console.log(`Skipping automatic SELL order ${order.id}: ${order.fromAmount} ${order.fromToken.symbol} below minimum amount ${minimumAmount}`);
              return { meetsCondition: false, executionPrice: undefined, tradeResult: testResult, unprofitable: false };
            }
          }
        }
      }
      
      return { meetsCondition, executionPrice: testExecutionPrice, tradeResult: testResult, unprofitable: false };
    }

    async function tryExecutePendingOrder(order, exactExecutionPrice) {
      // Check if this order is already being executed (lock mechanism)
      if (orderExecutionLocks.has(order.id)) {
        console.log(`Order ${order.id} is already being executed, skipping...`);
        return;
      }

      // Acquire lock for this order
      orderExecutionLocks.set(order.id, {
        startTime: Date.now(),
        status: 'executing'
      });

      try {
        console.log(`🔄 Executing order ${order.id} asynchronously...`);
        
        const remainingAmount = order.remainingAmount || order.fromAmount;
        const originalFromAmount = Number(order.fromAmount);
        const remainingPercentage = Number(remainingAmount) / originalFromAmount;
        
        // First, try 100% of the remaining amount
        console.log(`Order ${order.id}: Testing 100% of remaining amount (${remainingAmount}) first...`);
        
        let executableAmount;
        let newRemainingAmount;
        let bestTestResult;

        const fullAmountTest = await testExecutableAmount(order, Number(remainingAmount));
        
        // Check that no other automatic order from the same OrderBookLevel is in "processing" mode
        if (order.automatic && order.sourceLocation) {
          const { rowIndex, colIndex, levelType } = order.sourceLocation;
          const hasProcessingOrder = automaticOrders.value.some(o => 
            o.id !== order.id &&
            o.status === 'processing' &&
            o.sourceLocation &&
            o.sourceLocation.rowIndex === rowIndex &&
            o.sourceLocation.colIndex === colIndex &&
            o.sourceLocation.levelType === levelType
          );
          
          if (hasProcessingOrder) {
            console.log(`Order ${order.id}: Skipping because another order from the same ${levelType} levels is currently processing`);
            return { meetsCondition: false, executionPrice: undefined, tradeResult: fullAmountTest.tradeResult, unprofitable: false };
          }
        }
        
        if (fullAmountTest.meetsCondition && !fullAmountTest.unprofitable) {
          console.log(`Order ${order.id}: 100% of remaining amount can be executed at price ${fullAmountTest.executionPrice.toFixed(6)}`);
          
          // Update order status to processing while processing
          order.status = props.isTestMode ? 'processed': 'processing';
          
          // Update remaining amount to 0 since we're executing everything
          await window.electronAPI.updatePendingOrder({
            ...JSON.parse(JSON.stringify(order)),
            remainingAmount: '0',
            status: 'processing'
          });

          if (order.automatic && order.sourceLocation) {
            const { rowIndex, colIndex, levelIndex, levelType } = order.sourceLocation;
            if (tokensInRow[rowIndex]?.columns[colIndex]?.details) {
              const level = tokensInRow[rowIndex].columns[colIndex].details[levelType + 'Levels'][levelIndex];
              if (level) {
                level.remainingAmount = '0';
              }
            }
          }

          bestTestResult = fullAmountTest;
          executableAmount = order.fromAmount;
          newRemainingAmount = 0;
        } else {
          console.log(`Order ${order.id}: 100% amount doesn't meet conditions, using dichotomy algorithm...`);
          
          // Use dichotomy to find the maximum executable percentage of fromAmount
          
          let lowPercentage = 0;
          let highPercentage = remainingPercentage;
          let bestPercentage = 0;
          const marginError = 0.007; // 0.7% margin error
          const minPercentage = marginError; // Minimum percentage to consider
          // Binary search to find maximum executable percentage
          while ((highPercentage - lowPercentage) > minPercentage) {
            const midPercentage = (lowPercentage + highPercentage) / 2;
            const testAmount = originalFromAmount * midPercentage;
            
            await new Promise(r => setTimeout(1000, r))
            const testResult = await testExecutableAmount(order, testAmount);
            
            if (testResult.unprofitable) {
              // This amount is unprofitable, try lower percentage
              highPercentage = midPercentage;
              continue;
            }
            
            if (testResult.meetsCondition) {
              bestTestResult = testResult;
              bestPercentage = midPercentage;
              lowPercentage = midPercentage;
            } else {
              highPercentage = midPercentage;
            }
          }
          
          // If we couldn't find any executable percentage, release lock and return
          if (bestPercentage < minPercentage) {
            console.log(`Order ${order.id}: No executable amount found within price limits`);
            // Important: This early return is OK because finally block will handle cleanup
            return;
          }
          
          // Calculate the best executable amount from the percentage
          executableAmount = (originalFromAmount * bestPercentage).toString();
          console.log(`Order ${order.id}: Found optimal executable amount: ${executableAmount} (${(bestPercentage*100).toFixed(1)}% of original)`);
          
          // Update order status to processing while processing
          order.status = props.isTestMode ? 'processed': 'processing';
          
          // Update remaining amount immediately
          newRemainingAmount = Number(remainingAmount) - (originalFromAmount * bestPercentage);
          window.electronAPI.updatePendingOrder({
            ...JSON.parse(JSON.stringify(order)),
            remainingAmount: newRemainingAmount.toString(),
            status: 'processing'
          });

          if (order.automatic && order.sourceLocation) {
            const { rowIndex, colIndex, levelIndex, levelType } = order.sourceLocation;
            if (tokensInRow[rowIndex]?.columns[colIndex]?.details) {
              const levels = levelType === 'sell' 
                ? tokensInRow[rowIndex].columns[colIndex].details.sellLevels 
                : tokensInRow[rowIndex].columns[colIndex].details.buyLevels;
                
              if (levels[levelIndex]) {
                levels[levelIndex].status = 'processing';
                // Update the UI
                updateDetailsOrder(rowIndex, colIndex, tokensInRow[rowIndex].columns[colIndex].details);
              }
            }
          } else {
            await window.electronAPI.updatePendingOrder(JSON.parse(JSON.stringify(order)));
          }
        }
        // Get the final best trades for the executable amount
        const finalBestTrades = bestTestResult.tradeResult;
                
        // Create a trade summary object for this limit order
        const limitOrderTradeSummary = {
          protocol: finalBestTrades.protocol,
          sender: order.sender,
          fromAmount: executableAmount,
          toAmount: finalBestTrades.totalHuman,
          expectedToAmount: finalBestTrades.totalHuman,
          fromTokenSymbol: finalBestTrades.fromToken.symbol,
          toTokenSymbol: finalBestTrades.toToken.symbol,
          fromAddressName: order.sender?.name,
          fromToken: finalBestTrades.fromToken,
          fromTokenAddress: finalBestTrades.fromToken.address,
          toToken: finalBestTrades.toToken,
          toTokenAddress: finalBestTrades.toToken.address,
          gasLimit: finalBestTrades.gasLimit,
          automatic: order.automatic,
          priceLimit: order.priceLimit, // Add priceLimit to enable correct type detection
        };

        if (finalBestTrades.bestMixed) {
          limitOrderTradeSummary.fromAmountU = (Number(executableAmount) * finalBestTrades.fractionMixed / 100).toFixed(7);
          limitOrderTradeSummary.fromAmountB = (Number(executableAmount) - Number(limitOrderTradeSummary.fromAmountU)).toFixed(7);
          limitOrderTradeSummary.toAmountU = Number(ethers.utils.formatUnits(finalBestTrades.bestMixed.tradesU.totalBig, finalBestTrades.toToken.decimals)).toFixed(7);
          limitOrderTradeSummary.toAmountB = Number(ethers.utils.formatUnits(finalBestTrades.bestMixed.tradesB.outputAmount, finalBestTrades.toToken.decimals)).toFixed(7);
          limitOrderTradeSummary.fraction = finalBestTrades.fractionMixed;
        }

        // Execute the trade based on order type
        await executeOrderTrade(order, executableAmount, limitOrderTradeSummary, newRemainingAmount, exactExecutionPrice);
      } catch (error) {
        console.error(`❌ Error executing order ${order.id}:`, error);
        
        // Restore order status on error
        try {
          await window.electronAPI.updatePendingOrder({
            ...JSON.parse(JSON.stringify(order)),
            status: 'pending'
          });
        } catch (dbError) {
          console.error(`Failed to restore order ${order.id} status:`, dbError);
        }
      } finally {
        // Always release the lock
        orderExecutionLocks.delete(order.id);
        console.log(`🔓 Released lock for order ${order.id}`);
      }
    }

    /**
     * Execute the actual trade for an order
     */
    async function executeOrderTrade(order, executableAmount, limitOrderTradeSummary, newRemainingAmount, exactExecutionPrice) {
      try {
        // Handle different execution paths based on order type
        if (order.automatic && order.remainingAmount > 0) {
          // Multi-address execution for automatic orders
          const addressSelection = getAddressesWithHighestBalances(
            order.fromToken.address, 
            executableAmount, 
            order
          );
          
          if (addressSelection.totalAvailable < executableAmount) {
            console.log(`Insufficient total balance across all addresses. Need: ${executableAmount}, Available: ${addressSelection.totalAvailable}`);
            return;
          }
          
          // Execute multi-address trade asynchronously without blocking main loop
          order.status = 'processing';
          console.log(`Executing multi-address trade for order ${order.id} with amount ${executableAmount}`);
          console.log({addressSelection})
          await executeMultiAddressTrade(order, addressSelection, exactExecutionPrice, executableAmount);
        } else {
          // Limit order: Single address execution
          const singleAddress = order.sender;
          
          // Update status to running before execution
          await window.electronAPI.updatePendingOrder({
            ...JSON.parse(JSON.stringify(order)),
            status: 'pending',
            remainingAmount: newRemainingAmount.toString()
          });
          
          let execution = await executeTradeWithAddress(order, singleAddress, executableAmount);
          
          if (execution.success) {
            // Check if order is 97.5% or more filled
            const originalAmount = Number(order.fromAmount);
            const filledAmount = originalAmount - newRemainingAmount;
            const fillPercentage = (filledAmount / originalAmount) * 100;
            
            if (fillPercentage >= 97.5 || newRemainingAmount < originalAmount * 0.025) {
              // Mark order as completed
              order.status = 'completed';
              order.completedAt = new Date().toISOString();
              order.executionPrice = exactExecutionPrice;
              
              // Update UI for automatic orders BEFORE database update
              if (order.automatic && order.sourceLocation) {
                const { rowIndex, colIndex, levelIndex, levelType } = order.sourceLocation;
                // Validate indices are still valid
                if (tokensInRow[rowIndex] && tokensInRow[rowIndex].columns[colIndex] && tokensInRow[rowIndex].columns[colIndex].details) {
                  const levels = levelType === 'sell' 
                    ? tokensInRow[rowIndex].columns[colIndex].details.sellLevels 
                    : tokensInRow[rowIndex].columns[colIndex].details.buyLevels;
                    
                  if (levels && levels[levelIndex]) {
                    levels[levelIndex].status = 'processing';
                    levels[levelIndex].executionPrice = exactExecutionPrice;
                    levels[levelIndex].executionDate = new Date().toISOString();
                    // Force immediate UI update
                    await nextTick();
                    updateDetailsOrder(rowIndex, colIndex, tokensInRow[rowIndex].columns[colIndex].details);
                  } else {
                    console.warn(`Level ${levelIndex} not found in ${levelType}Levels for order ${order.id}`);
                  }
                } else {
                  console.warn(`Invalid row/column indices for order ${order.id}: row=${rowIndex}, col=${colIndex}`);
                }
              }
              
              // Update database AFTER UI update
              await window.electronAPI.updatePendingOrder({
                ...JSON.parse(JSON.stringify(order)),
                remainingAmount: newRemainingAmount.toString(),
                status: order.status
              });
              
              // Remove from pending orders AFTER database update
              pendingLimitOrders.value = pendingLimitOrders.value.filter(o => o.id !== order.id);
              console.log(`Order ${order.id} completed - filled ${fillPercentage.toFixed(1)}%`);
            } else {
              // Order partially filled, set back to pending for future executions
              order.status = 'pending';
              console.log(`Order ${order.id} partially filled - ${fillPercentage.toFixed(1)}% complete, remaining: ${newRemainingAmount}`);
              
              await window.electronAPI.updatePendingOrder({
                ...JSON.parse(JSON.stringify(order)),
                remainingAmount: newRemainingAmount.toString(),
                status: order.status
              });
            }
          } else {
            // Trade failed, restore the remaining amount
            const restoredAmount = Number(order.remainingAmount || order.fromAmount);
            await window.electronAPI.updatePendingOrder({
              ...JSON.parse(JSON.stringify(order)),
              remainingAmount: restoredAmount.toString(),
              status: 'pending'
            });
            throw new Error(execution.error || 'Trade execution failed');
          }
        }
        
        console.log(`✅ Order ${order.id} execution completed successfully`);
        
      } catch (tradeError) {
        console.error(`❌ Failed to execute trade for order ${order.id}:`, tradeError);
        
        // Create failed trade entry
        const failedTradeEntry = {
          ...limitOrderTradeSummary,
          sentDate: new Date(),
          isConfirmed: true,
          timestamp: new Date(),
        };
        
        emit('update:trade', failedTradeEntry);
        
        // Mark order as failed and restore remaining amount
        const restoredAmount = Number(order.remainingAmount || order.fromAmount);
        order.status = 'failed';
        order.failedAt = new Date().toISOString();
        order.errorMessage = tradeError.message || String(tradeError);
        order.remainingAmount = restoredAmount.toString();
        
        if (order.automatic && order.sourceLocation) {
          const { rowIndex, colIndex, levelIndex, levelType } = order.sourceLocation;
          if (tokensInRow[rowIndex]?.columns[colIndex]?.details) {
            const levels = levelType === 'sell' 
              ? tokensInRow[rowIndex].columns[colIndex].details.sellLevels 
              : tokensInRow[rowIndex].columns[colIndex].details.buyLevels;
              
            if (levels[levelIndex]) {
              levels[levelIndex].status = 'failed';
              levels[levelIndex].failureReason = tradeError.message || String(tradeError);
              updateDetailsOrder(rowIndex, colIndex, tokensInRow[rowIndex].columns[colIndex].details);
            }
          }
        }
        
        await window.electronAPI.updatePendingOrder(JSON.parse(JSON.stringify(order)));
        
        throw tradeError; // Re-throw to be caught by tryExecutePendingOrder
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
    });

    const deleteColumn = (i, j) => {
      console.log({i, j});
      tokensInRow[i].columns.splice(j, 1);
    }

    const deleteRow = (i) => {
      // Check if this row actually has content to delete
      if (!tokensInRow[i]?.token?.address && !tokensInRow[i]?.token?.symbol) {
        console.log(`Row ${i} is already empty, nothing to delete`);
        return;
      }
      
      console.log(`Deleting row ${i} and shifting subsequent rows up...`);
      
      // Remove the row from the array (this automatically shifts subsequent elements)
      tokensInRow.splice(i, 1);
      
      // Add an empty row at the end to maintain the total count
      tokensInRow.push({
        token: {
          symbol: null,
          address: null,
          decimals: 18,
          price: 0,
        },
        columns: []
      });
      
      // 🔄 Update row indices in all automatic orders
      if (automaticOrders.value && automaticOrders.value.length > 0) {
        automaticOrders.value.forEach(order => {
          if (order.sourceLocation && order.sourceLocation.rowIndex > i) {
            const oldRowIndex = order.sourceLocation.rowIndex;
            order.sourceLocation.rowIndex = oldRowIndex - 1;
            console.log(`Updated automatic order ${order.id}: rowIndex ${oldRowIndex} → ${order.sourceLocation.rowIndex}`);
          }
        });
      }
      
      // 🔄 Update row indices in any processing orders that might exist
      // This ensures consistency for orders that are currently being executed
      automaticOrders.value.forEach(order => {
        if (order.automatic && order.sourceLocation && order.sourceLocation.rowIndex > i && 
            (order.status === 'processing' || order.status === 'partially_filled')) {
          const oldRowIndex = order.sourceLocation.rowIndex;
          order.sourceLocation.rowIndex = oldRowIndex - 1;
          console.log(`Updated processing order ${order.id}: rowIndex ${oldRowIndex} → ${order.sourceLocation.rowIndex}`);
        }
      });
      
      console.log(`Row deletion complete. ${tokensInRow.length} total rows, updated ${automaticOrders.value.filter(o => o.sourceLocation?.rowIndex >= i).length} order references`);
      
      // Regenerate orders with updated indices
      generateOrdersFromLevels();
    }

    const addRowToMatrix = () => {
      let firstEmptyIndex = tokensInRow.findIndex(t => !t?.token?.address && !t?.token?.columns?.length)
      if (firstEmptyIndex === -1)
        return;

      tokensInRow[firstEmptyIndex] = {
        token: tokensByAddresses.value[newTokenAddress.value],
        columns: []
      }

      newTokenAddress.value = null;
      shouldSelectTokenInRow.value = false;
    }

    const addCellToRow = (i) => {
      tokensInRow[i].columns.push({
        ...tokensByAddresses.value[newCellTokenAddress.value],
        details: {
          isPaused: false,
          isRandomMode: false,
          minimumAmount: 0,
          limitPriceInDollars: false,
          buyLevels: [
            { triggerPrice: null, balancePercentage: null },
            { triggerPrice: null, balancePercentage: null },
            { triggerPrice: null, balancePercentage: null }
          ],
          sellLevels: [
            { triggerPrice: null, balancePercentage: null },
            { triggerPrice: null, balancePercentage: null },
            { triggerPrice: null, balancePercentage: null }
          ]
        }
      })

      shouldSelectTokenInCell.value = false;
      newCellTokenAddress.value = null;
    }

    const toggleGlobalPause = () => {
      isGloballyPaused.value = !isGloballyPaused.value;
    }

    const updateDetailsOrder = (i, j, details) => {
      // Clean level data when modified to ensure clean state
      const cleanedDetails = {
        ...details,
        buyLevels: details.buyLevels.map(level => {
          // Remove execution-related properties when level is modified
          const cleanedLevel = { ...level };
          if (cleanedLevel.triggerPrice !== undefined || cleanedLevel.balancePercentage !== undefined) {
            delete cleanedLevel.partialExecutionDate;
            delete cleanedLevel.executedAmount; 
            delete cleanedLevel.originalPercentage;
            delete cleanedLevel.executionPrice;
            delete cleanedLevel.executionDate;
            delete cleanedLevel.failureReason;
            // Reset status if it was partially executed before, but preserve processed status
            if (cleanedLevel.status === 'partially_filled') {
              cleanedLevel.status = 'active';
            }
            // Never reset processed status - once processed, always processed
            if (cleanedLevel.status === 'processed') {
              // Keep as processed, don't reset
            }
          }
          return cleanedLevel;
        }),
        sellLevels: details.sellLevels.map(level => {
          // Remove execution-related properties when level is modified
          const cleanedLevel = { ...level };
          if (cleanedLevel.triggerPrice !== undefined || cleanedLevel.balancePercentage !== undefined) {
            delete cleanedLevel.partialExecutionDate;
            delete cleanedLevel.executedAmount;
            delete cleanedLevel.originalPercentage;
            delete cleanedLevel.executionPrice;
            delete cleanedLevel.executionDate;
            delete cleanedLevel.failureReason;
            // Reset status if it was partially executed before, but preserve processed status
            if (cleanedLevel.status === 'partially_filled') {
              cleanedLevel.status = 'active';
            }
            // Never reset processed status - once processed, always processed
            if (cleanedLevel.status === 'processed') {
              // Keep as processed, don't reset
            }
          }
          return cleanedLevel;
        })
      };
      
      tokensInRow[i].columns[j].details = cleanedDetails;
      
      if (props.isInitialBalanceFetchDone)
        generateOrdersFromLevels();
    }

    const removeTrailingZeros = (num, precision = 8) => {
      if (num === null || num === undefined) return '0';
      
      // Convert to string with fixed precision
      const fixed = Number(num).toFixed(precision);
      
      // Remove trailing zeros after the decimal point
      // If all digits after decimal are zeros, remove decimal point too
      return fixed.replace(/\.?0+$/, '');
    };

    const summedBalances = computed(() => {
      const result = {};
      
      // Loop through all addresses
      for (const detail of props.addresses) {
        if (!detail || !detail.address || !detail.balances) continue;
        
        // For each token in the address's balance
        for (const tokenAddr in detail.balances) {
          const tokenAddrLower = tokenAddr.toLowerCase();
          
          // Initialize if not exists
          if (!result[tokenAddrLower]) {
            result[tokenAddrLower] = 0;
          }
          
          // Add to summed balance
          let bal = detail.balances[tokenAddr];
          
          // Subtract any pending offsets
          if (balanceOffsetByTokenByAddress[tokenAddrLower] && 
              balanceOffsetByTokenByAddress[tokenAddrLower][detail.address.toLowerCase()]) {
            bal -= balanceOffsetByTokenByAddress[tokenAddrLower][detail.address.toLowerCase()];
          }
          
          result[tokenAddrLower] += bal;
        }
      }
      
      console.log('Summed balances across all addresses:', result);
      return result;
    });

    const generateOrdersFromLevels = async () => {
      const orders = [];
      const sender = senderDetails.value;
      
      // Create a set of existing orders to prevent duplicates
      const existingOrders = new Set();
      automaticOrders.value.forEach(order => {
        if (order.sourceLocation && (order.status === 'processing' || order.status === 'partially_filled')) {
          const { rowIndex, colIndex, levelIndex, levelType } = order.sourceLocation;
          const key = `${rowIndex}-${colIndex}-${levelIndex}-${levelType}`;
          existingOrders.add(key);
        }
      });
      
      // Preserve existing orders that are currently being processed
      const preservedOrders = automaticOrders.value.filter(order => 
        order.status === 'processing' || order.status === 'partially_filled'
      );
      if (!sender?.address) {
        console.log('No sender address, skipping order generation');
        return;
      }

      // Wait for initial balance fetch if needed
      while (!props.isInitialBalanceFetchDone) {
        await new Promise(r => setTimeout(r, 1000));
        console.log('sleep wait for initial balance end');
      }

      // Use SUMMED balances instead of single address balance
      const balances = summedBalances.value;
      // console.log('Available summed balances across all addresses:', balances);
      
      // Check if we have any valid rows
      const validRows = tokensInRow.filter(row => row.token?.address && row.columns?.length > 0);
      if (validRows.length === 0) {
        console.log('No valid token rows found');
        return;
      }
      
      tokensInRow.forEach((row, i) => {
        // Skip rows without valid tokens
        if (!row.token?.address) {
          return;
        }
        
        // console.log(`Processing row ${i} with token ${row.token.symbol || row.token.address}`);
        
        row.columns.forEach((col, j) => {
          // Skip columns without valid tokens or details
          if (!col?.address) {
            // console.log(`Skipping column ${j} in row ${i} - missing address`);
            return;
          }
          
          if (col.details && col.details.isPaused) {
            return;
          }

          if (!col.details || !col.details.buyLevels || !col.details.sellLevels) {
            console.log(`Skipping column ${j} in row ${i} - missing level details`);
            return;
          }
          
          // console.log(`Processing column ${j} - ${col.symbol || col.address}`);
          
          // BUY LEVELS - user sells "col" token to buy "row.token"
          col.details.buyLevels.forEach((buyLevel, k) => {
            const orderKey = `${i}-${j}-${k}-buy`;
            if (
              buyLevel.triggerPrice &&
              buyLevel.balancePercentage &&
              !isNaN(buyLevel.triggerPrice) &&
              !isNaN(buyLevel.balancePercentage) &&        
              buyLevel.status !== 'processed' &&
              buyLevel.status !== 'pending' &&
              buyLevel.status !== 'processing' &&
              !existingOrders.has(orderKey)
            ) {
              // For a buy, fromToken is col, toToken is row.token
              const fromToken = col;
              const toToken = row.token;
              const fromTokenAddr = fromToken.address?.toLowerCase();
              
              // Check if we have balance for this token
              if (!balances[fromTokenAddr] && fromTokenAddr) {
                console.log(`No balance found for token ${fromTokenAddr} (${fromToken.symbol})`);
                return;
              }
              
              const balance = balances[fromTokenAddr] || 0;
              const fromAmount = (buyLevel.balancePercentage * 0.01 * balance);
              
              console.log(`Buy level ${k}: Token ${fromToken.symbol}, balance: ${balance}, amount: ${fromAmount}, trigger price: ${buyLevel.triggerPrice}`);
              
              // Check minimum amount requirement for output token (toToken)
              const minimumAmount = col.details?.minimumAmount || 0;
              let meetsMinimumRequirement = true;
              
              if (minimumAmount > 0 && fromAmount > 0) {
                // Calculate expected output amount using trigger price
                // For buy levels: we're buying toToken with fromToken
                let effectiveTriggerPrice = buyLevel.triggerPrice;
                if (col.details.limitPriceInDollars && toToken.price) {
                  effectiveTriggerPrice = buyLevel.triggerPrice / toToken.price;
                }
                const expectedOutputAmount = fromAmount * effectiveTriggerPrice;
                meetsMinimumRequirement = expectedOutputAmount >= minimumAmount;
                
                if (!meetsMinimumRequirement) {
                  console.log(`Skipping BUY order: expected output ${expectedOutputAmount} ${toToken.symbol} below minimum amount ${minimumAmount}`);
                }
              }
              
              if (fromAmount > 0 && meetsMinimumRequirement) {
                orders.push({
                  id: Math.floor(Math.random() * 10000000000000),
                  fromAmount,
                  remainingAmount: fromAmount,
                  fromToken: { ...fromToken },
                  toToken: { ...toToken },
                  priceLimit: buyLevel.triggerPrice,
                  // orderType removed - using shouldSwitchTokensForLimit instead
                  shouldSwitchTokensForLimit: true,
                  status: 'pending',
                  createdAt: new Date().toISOString(),
                  automatic: true,
                  limitPriceInDollars: col.details.limitPriceInDollars || false,
                  sourceLocation: {
                    rowIndex: i,
                    colIndex: j,
                    levelIndex: k,
                    levelType: 'buy'
                  }
                });
                console.log(`Created BUY order for ${fromAmount} ${fromToken.symbol} → ${toToken.symbol}`);
              }
            }
          });
          
          // SELL LEVELS - user sells "row.token" to buy "col" token
          col.details.sellLevels.forEach((sellLevel, k) => {
            const orderKey = `${i}-${j}-${k}-sell`;
            if (
              sellLevel.triggerPrice &&
              sellLevel.balancePercentage &&
              !isNaN(sellLevel.triggerPrice) &&
              !isNaN(sellLevel.balancePercentage) &&
              sellLevel.status !== 'processed' &&
              sellLevel.status !== 'pending' &&
              sellLevel.status !== 'processing' &&
              !existingOrders.has(orderKey)
            ) {
              // For a sell, fromToken is row.token, toToken is col
              const fromToken = row.token;
              const toToken = col;
              const fromTokenAddr = fromToken.address?.toLowerCase();
              
              // Check if we have balance for this token
              if (!balances[fromTokenAddr] && fromTokenAddr) {
                console.log(`No balance found for token ${fromTokenAddr} (${fromToken.symbol})`);
                return;
              }
              
              const balance = balances[fromTokenAddr] || 0;
              const fromAmount = (sellLevel.balancePercentage * 0.01 * balance);
              
              console.log(`Sell level ${k}: Token ${fromToken.symbol}, balance: ${balance}, amount: ${fromAmount}, trigger price: ${sellLevel.triggerPrice}`);
              
              // Check minimum amount requirement for input token (fromToken being sold)
              const minimumAmount = col.details?.minimumAmount || 0;
              let meetsMinimumRequirement = true;
              
              if (minimumAmount > 0 && fromAmount > 0) {
                meetsMinimumRequirement = fromAmount >= minimumAmount;
                
                if (!meetsMinimumRequirement) {
                  console.log(`Skipping SELL order: ${fromAmount} ${fromToken.symbol} below minimum amount ${minimumAmount}`);
                }
              }
              
              if (fromAmount > 0 && meetsMinimumRequirement) {             
                orders.push({
                  id: Math.floor(Math.random() * 10000000000000),
                  fromAmount,
                  remainingAmount: fromAmount,
                  fromToken: { ...fromToken },
                  toToken: { ...toToken },
                  priceLimit: sellLevel.triggerPrice,
                  // orderType removed - using shouldSwitchTokensForLimit instead
                  shouldSwitchTokensForLimit: false,
                  status: 'pending',
                  createdAt: new Date().toISOString(),
                  automatic: true,
                  limitPriceInDollars: col.details.limitPriceInDollars || false,
                  sourceLocation: {
                    rowIndex: i,
                    colIndex: j,
                    levelIndex: k,
                    levelType: 'sell'
                  }
                });
                console.log(`Created SELL order for ${fromAmount} ${fromToken.symbol} → ${toToken.symbol}`);
              }
            }
          });
        });
      });
      
      if (orders.length)
        console.log(`Generated ${orders.length} new orders:`, orders);
      // Combine preserved orders (currently being processed) with new orders
      automaticOrders.value = [...preservedOrders, ...orders];
      if (automaticOrders.value.length)
        console.log(`Total automatic orders after regeneration: ${automaticOrders.value.length} (${preservedOrders.length} preserved + ${orders.length} new)`);
    };
    // Whenever the tokens list is edited (addresses, symbols, decimals), rebuild tokensByAddresses
    watch(
      () => tokens.value,
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

    watch(() => tokens.value, (tokensValue) => emit('update:settings', { tokens: [...tokensValue] }), { deep: true });
    watch(() => tokensInRow, () => emit('update:settings', { tokensInRow: [...tokensInRow] }), { deep: true });
    watch(
      () => props.addresses,
      async (addrs) => {
        if (addrs && addrs[0]) {
          senderDetails.value = addrs[0];
        }
        generateOrdersFromLevels();
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

    onMounted(async () => {
      const settings = await window.electronAPI.loadSettings();
      console.log(settings)
      if (settings?.tokens) {
        for (let i = 0; i < settings.tokens.length; i++) {
          if (settings.tokens[i]?.address && settings.tokens[i]?.symbol) {
            tokens.value[i] = settings.tokens[i];
          }
        }
      }
      if (settings?.tokensInRow) {
        for (let i = 0; i < settings.tokensInRow.length; i++) {
          if (settings.tokensInRow[i]?.token?.address && settings.tokensInRow[i]?.token?.symbol) {
            tokensInRow[i] = settings.tokensInRow[i];
          }
        }
        generateOrdersFromLevels();
      }

      const dbOrders = await window.electronAPI.getPendingOrders();
      if (dbOrders && Array.isArray(dbOrders)) {
        pendingLimitOrders.value = dbOrders.filter(o => tokensByAddresses.value[o.fromTokenAddress] && tokensByAddresses.value[o.toTokenAddress]).map(o => ({
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
          // orderType field removed - using shouldSwitchTokensForLimit instead
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

        const outdateOrders = dbOrders.filter(o => !tokensByAddresses.value[o.fromTokenAddress] || !tokensByAddresses.value[o.toTokenAddress])
        outdateOrders.map(o => deletePendingOrder(o.id))
      }
      stopEthBalanceMonitoring();
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
      effectivePrice,

      // methods
      switchTokens,
      triggerTrade,
      approveSpending,
      findSymbol,
      deleteToken,
      toggleEditingTokens,
      shouldSwitchTokensForLimit,
      setMarketPriceAsLimit,

      pendingLimitOrders,
      placeLimitOrder,
      placeLimitOrderConfirmed,
      cancelLimitOrder,
      formatUsdPrice,
      getCurrentMarketPrice,
      
      // Price deviation modal
      showPriceDeviationModal,
      priceDeviationModalData,
      checkPriceDeviation,
      validateAgainstPendingOrders,
      showPriceDeviationConfirmation,
      confirmPriceDeviationAction,
      cancelPriceDeviationAction,
      
      currentMode,
      tokensInRow,

      deleteColumn,
      deleteRow,
      shouldSelectTokenInRow,
      shouldSelectTokenInCell,
      newTokenAddress,
      newCellTokenAddress,
      addRowToMatrix,
      addCellToRow,
      updateDetailsOrder,
      automaticOrders,
      allExistingOrders,
      computedEthPrice,
      removeTrailingZeros,
      automaticMessage,
      isGloballyPaused,
      toggleGlobalPause,
    };
  }
};
</script>

<style scoped>
.manual-trading {
  border-radius: 4px;
  box-shadow: 0 6px 8px rgba(0, 0, 0, 0.2);
  border-radius: 5px;
  background-color: #fff;
  display: flex;
  flex-direction: row;
  position: relative;
  padding: 0px 0px 20px;
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
  top: 40px;
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
  cursor: pointer;
}


.token-details .delete-row {
  display: none;
  width: 20px;
  height: 15px;
}

.token-details:hover .delete-row {
  width: 15px;
  height: 15px;
  display: inline-block;
  cursor: pointer;
  top: 5px;
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
  position: relative;
}

.order-meta {
  font-size: 12px;
  color: #666;
  margin-top: 5px;
  display: flex;
  justify-content: space-between;
  width: 40%;
  position: absolute;
  top: 5px;
  right: 10px;
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

.check-if-trigger {
  background-color: #0b9135; /* Orange for waiting balance */
  font-weight: 600;
}

.top-nav-bar {
  width: 100%;
  display: flex;
  justify-content: space-around;
}
.top-nav-bar div {
  cursor: pointer;
  padding: 10px;
  border-radius: 5px;
  background-color: #f0f0f0;
  transition: background-color 0.1s ease-in-out, transform 0.1s ease-in-out, box-shadow 0.1s ease-in-out;
  width: 50%;
  z-index: 0;
}
.top-nav-bar div:hover {
  background-color: #e0e0e0;
}
.top-nav-bar div.active-tab {
  background-color: #b0b0b0;
  transform: scale(1.01);
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  z-index: 10;
}
.top-nav-bar div.active-tab h3 {
  font-weight: 700;
}
.editing-tokens, .pending-orders {
  padding: 20px;
}
h3 {
  font-weight: 600;
  margin: 0;
}

.token-row {
  display: flex;
  flex-direction: row;
}

.automatic-mode {
  padding: 20px 20px 20px;
}

.automatic-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.automatic-info {
  flex: 1;
}

.global-pause-btn {
  background-color: #fff;
  color: #000;
  border: none;
  padding: 10px 20px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 16px;
  font-weight: bold;
  transition: background-color 0.3s ease;
  min-width: 150px;
  position: absolute;
}

.global-pause-btn:hover {
  background-color: #ccc;
}

.global-pause-btn.paused {
  background-color: #fba09a;
}

.global-pause-btn.paused:hover {
  background-color: #d27771;
}

.matrix {
  max-height: 900px;
  overflow-y: auto;
}

.token-details {
  border: 2px solid #ddd;
  border-radius: 8px;
  background-color: #fafafa;
  align-content: center;
  text-align: center;
  border-right: 1px solid #eee;
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  width: 120px;
  position: relative;
}

.token-price {
  color: #666;
  font-size: 12px;
}

.horizontal-scroll {
  width: 85vw;
  overflow-x: auto;
  display: flex;
  flex-direction: row;
  background-color: #fafafa;
  border-bottom: 2px solid #ddd;
  border-top: 2px solid #ddd;
}
.token-symbol {
  font-size: 22px;
}
.new-token-details {
  cursor: pointer;
  border-radius: 5px !important;
  border: 2px solid #ddd !important;
}
.new-cell-details {
  cursor: pointer;
  border-radius: 0 !important;
  border-top-right-radius: 5px !important;
  border-bottom-right-radius: 5px !important;
  border-left: 1px solid #eee;
  border-right: 2px solid #ddd !important;
  border: 0px;
  display: flex;
  justify-content: center;
  align-content: center;
  flex-wrap: wrap;
  width: 50px;
  padding: 20px;
}
.no-addresses-unlocked {
  background-color: #aaa;
  opacity: .5;
}

input.amount-out {
  background-color: #fff;
  width: 240px;
  border: none;
  text-align: left;
  padding: 5px;
  font-weight: 500;
  font-size: 22px;
  display: inline-block;
}
</style>