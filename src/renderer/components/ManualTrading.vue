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
                @ ${{ spaceThousands(tokensByAddresses[fromTokenAddress]?.price?.toFixed(2)) }}
              </span>
            </div>
            <span
              v-if="fromAmount"
              class="usd-amount"
            >
              ${{ spaceThousands((fromAmount * tokensByAddresses[fromTokenAddress]?.price).toFixed(2)) }}
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
                ${{ spaceThousands((Number(tradeSummary.toAmount) * tokensByAddresses[toTokenAddress].price).toFixed(2)) }}
              </span>
              <span v-if="tokensByAddresses[fromTokenAddress]?.price && tokensByAddresses[toTokenAddress]?.price">
                ({{ -((fromAmount * tokensByAddresses[fromTokenAddress].price - Number(tradeSummary.toAmount) * tokensByAddresses[toTokenAddress].price) * 100 / (fromAmount * tokensByAddresses[fromTokenAddress].price)).toFixed(2) }}%)
              </span>
            </span>
            <p class="right-price">
              @ ${{ spaceThousands(tokensByAddresses[toTokenAddress]?.price?.toFixed(2)) }}
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
                On {{ tradeSummary.protocol }}
              </span> with
            </p>
            <div class="sender-buttons">
              <select
                class="addressSelect"
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
              <select
                v-if="senderDetails?.address"
                class="addressMode"
                id="sender-modes"
                v-model="senderDetails.mode"
              >
                <option
                  :key="'none'"
                  :value="undefined"
                >
                  None
                </option>
                <option
                  :key="'odos & contract'"
                  :value="'odos & contract'"
                  :disabled="!contractAddress[senderDetails?.address]"
                >
                  Odos & Contract
                </option>
                <option
                  :key="'odos'"
                  :value="'odos'"
                >
                  Odos
                </option>
                <option
                  :key="'contract'"
                  :value="'contract'"
                  :disabled="!contractAddress[senderDetails?.address]"
                >
                  Contract
                </option>
              </select>
            </div>
            <div class="deployInfo" v-if="senderDetails?.address">
              <button
                v-if="!contractAddress?.[senderDetails?.address]"
                class="deploy-button"
                @click="deployBundler"
                :disabled="isDeploying"
              >
                {{ isDeploying ? 'Deploying...' : `Deploy ($${deploymentCostUsd})` }}
              </button>
              <p v-else class="deploy-address">
                {{ contractAddress?.[senderDetails?.address] }}
                <span class="copy-area" @click="copy(contractAddress?.[senderDetails?.address])">Copy</span> 
              </p>
            </div>
          </div>

          <p class="details-message">
            {{ swapMessage }}
          </p>
          <div
            v-if="tabOrder === 'market' && !isEditingTokens"
            class="swap-buttons"
          >
            <div v-if="!needsToApprove">
              <button
                v-if="!needsToApprove"
                :disabled="!senderDetails?.mode || isSwapButtonDisabled || isFetchingPrice || maxGasPrice < gasPrice || trades.length === 0"
                class="swap-button"
                @click="isSwapButtonDisabled=true; triggerTrade()"
              >
                {{ (isSwapButtonDisabled && trades.length > 0 && !isFetchingPrice) ? 'Swapping...' : `Swap ($${((tradeSummary?.gasLimit || 300000) * ethPrice * Number(gasPrice) * 1.1 / 1e18).toFixed(2) })`}}
              </button>
            </div>
            <div v-else>
              <p class="details-message">
                Gas cost ~ ${{ ((tradeSummary.protocol === 'Uniswap' ? 100000 : 100000) * ethPrice * Number(gasPrice) * 1.1 / 1e18).toFixed(2) }}
              </p>
              <button
                :disabled="!senderDetails?.mode || isSwapButtonDisabled || isFetchingPrice || maxGasPrice < gasPrice || trades.length === 0"
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
                :disabled="!senderDetails?.mode || !priceLimit || !fromAmount || senderDetails?.address === ''"
                class="swap-button"
                @click="placeLimitOrder()"
              >
                {{ 'Place order' }}
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
              :title="isGloballyPaused ? 'Off' : 'On'"
              @click="toggleGlobalPause"
            >
              {{ isGloballyPaused ? 'Off' : 'On' }}
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
                  ${{ spaceThousands(tokenInRow.token.price?.toFixed(2)) }}
                </p>
                <img
                  :src="deleteImage"
                  class="delete-row"
                  @click="deleteRow(i)"
                >
                <div
                  class="compensate-height"
                />
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
                    :price-threshold="priceThreshold / 100"
                    :details="token.details"
                    :price-deviation-percentage="priceDeviationPercentage"
                    :existing-orders="allExistingOrders"
                    :orders="getOrdersForColumn(i, j)"
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
                    <span>Price: ${{ token.price.toFixed(2) }}</span>
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
        <h4>Limit Orders</h4>
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
                      If {{ order.fromToken.symbol }} ≥ {{ order.priceLimit }} {{ order.toToken.symbol }}
                    </span>
                    <span v-else>
                      If {{ order.toToken.symbol }} ≤ {{ order.priceLimit }} {{ order.fromToken.symbol }}
                    </span>
                    <span
                      class="current-market-price"
                      style="color: #000; font-size: 1em; margin-left: 40px;"
                    >
                      <span v-if="!order.shouldSwitchTokensForLimit">
                        <span style="font-weight: 600; font-size: 1.1em;">{{ getCurrentMarketPrice(order.fromToken, order.toToken, false) }}</span> {{ order.toToken.symbol }}/{{ order.fromToken.symbol }}
                      </span>
                      <span v-else>
                        <span style="font-weight: 600; font-size: 1.1em;">{{ getCurrentMarketPrice(order.fromToken, order.toToken, true) }}</span> {{ order.fromToken.symbol }}/{{ order.toToken.symbol }}
                      </span>
                    </span>
                    <div>
                      <span style="font-size:16px;color:rgb(223,81,81);">
                        Sell <span style="font-size:16px;font-weight:800;text-decoration:underline;">{{ order.fromAmount }} {{ order.fromToken.symbol }} </span>
                        (${{ tokensByAddresses[order.fromToken?.address].price.toFixed(2) }})
                      </span> 
                      -> 
                      <span style="font-size:16px;color:rgb(69,201,99);">
                        Buy <span style="font-size:16px;font-weight:800;text-decoration:underline;">{{ order.toAmount || '' }} {{ order.toToken.symbol }} </span>
                        (${{ tokensByAddresses[order.toToken?.address].price.toFixed(2) }})
                      </span>
                    </div>
                  </span>
                </div>
                <div class="order-meta">
                  <span>
                    {{ order.createdAt ? new Date(order.createdAt).toLocaleString() : 'Unknown' }}
                    <span v-if="order.currentMarketPrice">
                      at {{ order.currentMarketPrice.toFixed(4) }}
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
import { useChainlinkPrice } from '../composables/useChainlinkPrice';
import { getAllQuotes, selectBestQuote } from '../utils/quoteAggregator.js';
import { createEncoderExecutionPlan } from '../utils/executionPlan.js';
import { getOdosAssemble } from '../utils/useOdos.js';
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
    priceThreshold: { type: Number, default: 1 },
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
    const SUBGRAPH_URL = `https://gateway.thegraph.com/api/d692082c59f956790647e889e75fa84d/subgraphs/id/DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G`;

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
    const senderDetails    = ref({
      address: undefined,
      name: undefined,
      mode: undefined,
    });
    const tabOrder         = ref('market');
    const isSwapButtonDisabled = ref(false);
    const needsToApprove   = ref(false);
    const odosRouterAddress = ref(null); // Store Odos router address for approval
    const slippage         = ref(70);
    const priceLimit = ref(null);
    const contractAddress = reactive({});
    const walletModes = reactive({});

    // Bundler-related state
    const isDeploying = ref(false);

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

    // Deployment cost calculation
    const deploymentCostUsd = computed(() => {
      const DEPLOYMENT_GAS = 1000000;
      const gasPriceWei = props.gasPrice || 0;
      const ethPriceUsd = props.ethPrice || 0;

      // Calculate cost in ETH: (gas * gasPrice) / 1e18
      const costInEth = (DEPLOYMENT_GAS * gasPriceWei) / 1e18;

      // Calculate cost in USD
      const costInUsd = costInEth * ethPriceUsd;

      return costInUsd.toFixed(2);
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
    const isGloballyPaused = ref(true);
    
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
        // Limit orders are always selling fromToken to buy toToken
        // If shouldSwitchTokensForLimit is true, we need to invert the price
        const triggerPrice = order.shouldSwitchTokensForLimit ? 
          (1 / order.priceLimit) : order.priceLimit;
        
        const level = {
          triggerPrice: triggerPrice,
          balancePercentage: 100, // Assume full percentage for limit orders
          status: 'active'
        };
        
        // Limit orders are always sell orders (selling fromToken for toToken)
        allOrders.push({
          tokenA: order.fromToken,
          tokenB: order.toToken,
          buyLevels: [],
          sellLevels: [level],
          limitPriceInDollars: order.limitPriceInDollars || false,
          source: 'limitorder',
          orderId: order.id,
          shouldSwitchTokensForLimit: order.shouldSwitchTokensForLimit
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

        // In automatic mode, skip wallets without a mode defined
        if (currentMode.value === 'automatic' && !walletModes[addr]) {
          continue;
        }

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
        usdValueInverse = fromTokenPrice.toFixed(2);
      else
        usdValueInverse = toTokenPrice > 0 ? (pricePerInputToken * toTokenPrice).toFixed(2) : '0.00';

      if (list100CoinsEth.includes(toSymbol))
        usdValue = toTokenPrice.toFixed(2);
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
      
      return displayPrice.toFixed(4);
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
          // isSwapButtonDisabled.value = false;
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
      senderAddr
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

      // Get wallet mode for protocol filtering
      const walletMode = senderDetails.value.mode;

      // Fetch all Uniswap pools for both tokens
      console.log('🔍 Fetching Uniswap pools...');
      const tokenAddresses = Object.keys(tokensByAddresses.value);
      const uniswapPools = await findPossiblePools(fromToken, toToken);
      console.log(`✅ Fetched ${uniswapPools ? uniswapPools.length : 0} Uniswap pools`);

      // Get quotes from all allowed protocols
      const quotes = await getAllQuotes({
        fromToken,
        toToken,
        amount,
        senderAddress: senderAddr,
        walletMode,
        provider: props.provider,
        uniswapPools,
        tokensByAddresses: tokensByAddresses.value,
        getTradesUniswapFn: getTradesUniswap,
        getTradesBalancerFn: getTradesBalancer
      });

      if (!quotes || quotes.length === 0) {
        throw new Error('No quotes available from any protocol');
      }

      // Select best quote based on output after gas costs
      const bestQuote = selectBestQuote(
        quotes,
        toToken,
        props.ethPrice,
        props.gasPrice
      );

      if (!bestQuote) {
        throw new Error('No valid quote found');
      }

      // Format output for display
      const totalHuman = ethers.utils.formatUnits(bestQuote.outputAmount, toToken.decimals);
      let finalTotalHuman;
      finalTotalHuman = totalHuman.length > 9 && totalHuman[0] !== '0' ? Number(totalHuman).toFixed(4) : Number(totalHuman).toFixed(6);
      if (finalTotalHuman === '0.000000' || finalTotalHuman === '0.00') {
        finalTotalHuman = tokensByAddresses.value[toTokenAddr].decimals >= 9 ? Number(totalHuman).toFixed(9) : Number(totalHuman).toFixed(6);
      }

      // Map protocol names to match existing execution logic
      let protocol = bestQuote.protocol;
      if (protocol === 'WalletBundler') {
        protocol = 'Contract';
      } else if (protocol === 'Odos') {
        protocol = 'Odos';
      }

      return {
        trades: bestQuote.trades,
        totalHuman: finalTotalHuman,
        protocol,
        gasLimit: bestQuote.gasEstimate,
        bestMixed: protocol === 'Contract' ? {
          outputAmount: bestQuote.outputAmount,
          rawTotalOutput: bestQuote.outputAmount,
          route: bestQuote.trades[0]?.route,
          executionPlan: bestQuote.trades[0]?.executionPlan
        } : null,
        fractionMixed: bestQuote.splits ? Math.round((1 - (bestQuote.splits.find(s => s.protocol === 'balancer')?.percentage || 0)) * 100) : null,
        pathId: bestQuote.pathId, // For Odos protocol
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
        () => tabOrder.value,
        () => currentMode.value,
        () => senderDetails.value?.mode,
      ],
      async (
        [_newFrom, _newTo, _newAmt, _newSender, tabOrderValue, currentModeValue, senderMode],
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
              _newSender.address
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

            // Note: Split information is now handled internally by the quote aggregator
            // The bestMixed structure contains the unified result, not separate tradesU/tradesB
            if (bestTradeResult.bestMixed) {
              tradeSummary.fraction = bestTradeResult.fractionMixed;
            }

            // Check if approval is needed
            if (_newFrom !== ethers.constants.AddressZero) {
              await checkAllowances(_newFrom, null, bestTradeResult.trades);
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

      // Uniswap
      if (tradeSummary.protocol === 'Uniswap') {
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

      // Balancer V3
      if (tradeSummary.protocol === 'Balancer') {
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
          }
        }
        needsToApprove.value = false;
        return;
      }

      // Contract (WalletBundler)
      if (tradeSummary.protocol === 'Contract') {
        const bundlerAddress = contractAddress[senderDetails.value.address];
        if (!bundlerAddress) {
          console.error('No bundler contract found for Contract protocol');
          needsToApprove.value = false;
          return;
        }

        // Check allowance for bundler contract
        const allowance = await erc20.allowance(
          senderDetails.value.address,
          bundlerAddress
        );

        if (BigNumber.from(allowance).lt(BigNumber.from('100000000000000000000000000'))) {
          needsToApprove.value = true;
          return;
        }
        needsToApprove.value = false;
        return;
      }

      // Odos
      if (tradeSummary.protocol === 'Odos') {
        // For Odos, we need the router address from the assembled transaction
        // This will be available in trades[0].rawData
        if (localTrades && localTrades.length > 0 && localTrades[0].rawData) {
          // Store Odos router address for later approval use
          odosRouterAddress.value = null;

          // We need to get the assembled transaction to know the router address
          // For now, we'll fetch it to check allowance
          try {
            const trade = localTrades[0];
            if (!trade.rawData.pathId) {
              console.error('Missing pathId for Odos allowance check');
              needsToApprove.value = false;
              return;
            }

            // Get assembled transaction to get router address
            const assembled = await getOdosAssemble({
              pathId: trade.rawData.pathId,
              userAddr: senderDetails.value.address,
              simulate: false
            });

            if (!assembled || !assembled.routerAddress) {
              console.error('Failed to get Odos router address');
              needsToApprove.value = false;
              return;
            }

            // Store router address for later use in approval
            odosRouterAddress.value = assembled.routerAddress;

            // Check allowance for Odos router
            const allowance = await erc20.allowance(
              senderDetails.value.address,
              assembled.routerAddress
            );

            if (BigNumber.from(allowance).lt(BigNumber.from('100000000000000000000000000'))) {
              needsToApprove.value = true;
              return;
            }
            needsToApprove.value = false;
            return;
          } catch (error) {
            console.error('Error checking Odos allowance:', error);
            needsToApprove.value = false;
            return;
          }
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

      // Calculate raw total output before gas costs
      const rawTotalOutput = (totalBig || BigNumber.from('0')).add(outputAmount || BigNumber.from('0'));
      
      return {
        outputAmount: totalOutput,
        rawTotalOutput: rawTotalOutput, // Total raw output before gas costs for display
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
        if (err?.toString()?.includes('execution reverted'))
          console.log('Error in estimateGas: execution reverted');
        else {
          console.log('Error in estimateGas');
          console.error(err);
        }
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

    const getTradesUniswap = async (_newFrom, _newTo, _newAmt, _pools = null) => {
      // Validate amount is not zero or invalid
      if (!_newAmt || Number(_newAmt) <= 0) {
        console.warn('getTradesUniswap: Invalid amount', _newAmt);
        return 'no swap found';
      }

      // Use pre-fetched pools if provided, otherwise fetch them
      const pools = _pools || await findPossiblePools(tokensByAddresses.value[_newFrom], tokensByAddresses.value[_newTo]);
      console.log(`getTradesUniswap: Using ${_pools ? 'pre-fetched' : 'newly fetched'} pools (${pools.length} total)`);
      
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
      
      // If price is 0 or not found, try Chainlink as fallback
      if (d === 0) {
        const { getPriceFromChainlink } = useChainlinkPrice();
        try {
          const chainlinkResult = await getPriceFromChainlink(lc, toRaw(props.provider));
          if (chainlinkResult.success && chainlinkResult.price > 0) {
            return chainlinkResult.price;
          }
        } catch (error) {
          console.log(`Chainlink price fetch failed for ${lc}:`, error);
        }
      }
      
      return d * ethUsd;
    }

    async function tokensUsd(tokenArray, ethUsd) {
      const { getPriceFromChainlink } = useChainlinkPrice();
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
      
      // Process tokens from The Graph
      for (const token of (data?.data?.tokens || [])) {
        if (!token.id) continue;
        const d = token?.derivedETH ? Number(token.derivedETH) : 0;
        tokenPrices[token.id] = d * ethUsd;
      }

      // Use Chainlink as fallback ONLY for tokens without price from The Graph
      for (const address of addressesToFetch) {
        const lc = address.toLowerCase();
        // Only fetch from Chainlink if price is 0 or not set
        if (!tokenPrices[lc] || tokenPrices[lc] === 0) {
          try {
            const chainlinkResult = await getPriceFromChainlink(lc, toRaw(props.provider));
            if (chainlinkResult.success && chainlinkResult.price > 0) {
              tokenPrices[lc] = chainlinkResult.price;
            }
          } catch (error) {
            console.log(`Chainlink price fetch failed for ${lc}:`, error);
          }
        }
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
        // Convert to lowercase immediately
        if (contractAddress && typeof contractAddress === 'string') {
          contractAddress = contractAddress.toLowerCase();
          tokens.value[index].address = contractAddress;
        }
        
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
        } else if (currentTradeSummary.protocol === 'Contract') {
          // WalletBundler execution for cross-DEX optimization
          const trade = currentTrades[0];
          if (!trade || !trade.executionPlan) {
            throw new Error('Missing execution plan for Contract protocol');
          }

          // Create encoder-based execution plan
          // Note: slippage.value is in basis points (70 = 0.7%), but createEncoderExecutionPlan expects percentage
          const encoderPlan = createEncoderExecutionPlan(
            trade.executionPlan,
            currentTradeSummary.fromToken,
            currentTradeSummary.toToken,
            slippage.value / 100  // Convert basis points to percentage (70 → 0.7)
          );

          // Get bundler contract address for this wallet
          const bundlerAddress = contractAddress[currentTradeSummary.sender.address];
          if (!bundlerAddress) {
            throw new Error('No bundler contract deployed for this wallet. Please deploy first.');
          }

          // Execute via bundler contract
          const bundlerArgs = {
            bundlerAddress,
            fromToken: encoderPlan.fromToken,
            fromAmount: encoderPlan.fromAmount.toString(),
            toToken: encoderPlan.toToken,
            encoderTargets: encoderPlan.encoderTargets,
            encoderData: encoderPlan.encoderData,
            wrapOperations: encoderPlan.wrapOperations,
            minOutputAmount: trade.executionPlan.minOutput.toString(),
            from: currentTradeSummary.sender.address,
            tradeSummary: JSON.parse(JSON.stringify(currentTradeSummary)),
            value: encoderPlan.fromToken === ethers.constants.AddressZero ? encoderPlan.fromAmount.toString() : '0'
          };

          const response = await window.electronAPI.executeBundler(bundlerArgs);
          if (!response?.success) {
            throw new Error('Problem in executing WalletBundler transaction: ' + response?.error?.toString());
          }
          if (response.warnings && response.warnings.length) {
            globalWarnings = response.warnings;
          }

          globalTxs.push(response.tx);
        } else if (currentTradeSummary.protocol === 'Odos') {
          // Odos aggregator execution
          const trade = currentTrades[0];
          if (!trade || !trade.pathId) {
            console.error('Trade object:', trade);
            throw new Error('Missing pathId for Odos protocol');
          }

          // Get assembled transaction data from Odos
          const assembled = await getOdosAssemble({
            pathId: trade.pathId,
            userAddr: currentTradeSummary.sender.address,
            simulate: false
          });

          console.log('Odos assembled response:', assembled);

          if (!assembled || !assembled.tx) {
            console.error('Assembled object:', assembled);
            throw new Error('Failed to assemble Odos transaction - no tx object');
          }

          if (!assembled.tx.to) {
            console.error('Assembled tx:', assembled.tx);
            throw new Error('Failed to assemble Odos transaction - missing "to" address');
          }

          if (!assembled.tx.data) {
            console.error('Assembled tx:', assembled.tx);
            throw new Error('Failed to assemble Odos transaction - missing calldata');
          }

          console.log('Odos transaction to send:', {
            to: assembled.tx.to,
            data: assembled.tx.data?.substring(0, 66) + '...',
            value: assembled.tx.value || '0',
            gasLimit: assembled.estimatedGas || assembled.tx.gas
          });

          // Match the format that Balancer uses (which sendTransaction expects)
          const odosArgs = {
            contractAddress: assembled.tx.to,  // sendTransaction expects 'contractAddress', not 'to'
            callData: assembled.tx.data,        // sendTransaction expects 'callData', not 'data'
            value: assembled.tx.value || '0',
            from: currentTradeSummary.sender.address,
            tradeSummary: JSON.parse(JSON.stringify(currentTradeSummary)),
            gasLimit: assembled.estimatedGas || assembled.tx.gas || trade.gasEstimate || 300000
          };

          console.log('🚨 FINAL ODOS TRANSACTION (formatted for sendTransaction):', {
            contractAddress: odosArgs.contractAddress,
            callData: odosArgs.callData?.substring(0, 66) + '...',
            value: odosArgs.value,
            gasLimit: odosArgs.gasLimit,
            from: odosArgs.from
          });

          const response = await window.electronAPI.sendTransaction(odosArgs);
          if (!response?.success) {
            throw new Error('Problem in sending Odos transaction: ' + response?.error?.toString());
          }
          if (response.warnings && response.warnings.length) {
            globalWarnings = response.warnings;
          }

          globalTxs.push(response.tx);
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

        currentTradeSummary.txId = globalTxs[0]?.hash || null;
        emit('update:trade', { ...currentTradeSummary });
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
      const activeTradeSummary = localTradeSummary || tradeSummary;
      
      try {
        isSwapButtonDisabled.value = true;
                
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
        if (activeTradeSummary.protocol === 'Uniswap') {
          const { success, error } = await window.electronAPI.approveSpender(
            senderAddress,
            tokenAddr,
            PERMIT2_ADDRESS,
            UNIVERSAL_ROUTER_ADDRESS
          );
          if (!success) throw error;
        }
        // Balancer
        else if (activeTradeSummary.protocol === 'Balancer') {
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
        // Contract (WalletBundler)
        else if (activeTradeSummary.protocol === 'Contract') {
          const bundlerAddress = contractAddress[senderAddress];
          if (!bundlerAddress) {
            throw new Error('No bundler contract deployed for this wallet. Please deploy first.');
          }

          const { success, error } = await window.electronAPI.approveSpender(
            senderAddress,
            tokenAddr,
            bundlerAddress
          );
          if (!success) throw error;
        }
        // Odos
        else if (activeTradeSummary.protocol === 'Odos') {
          // Use stored router address from allowance check
          if (!odosRouterAddress.value) {
            throw new Error('Odos router address not available. Please refresh quote.');
          }

          const { success, error } = await window.electronAPI.approveSpender(
            senderAddress,
            tokenAddr,
            odosRouterAddress.value
          );
          if (!success) throw error;
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
          order?.sender?.address || senderDetails.value.address
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
        
        if (lossPercentage > 99.99) {
          return { 
            valid: false, 
            exactExecutionPrice,
            comparableExecutionPrice,
            currentMarketPrice,
            priceDifference: 0,
            bestTradeResult,
            reason: `Excessive loss: ${lossPercentage.toFixed(1)}% (max ${99.99}% allowed)` 
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
            
            // Track cumulative executed amount on the order
            if (!order.executedAmount) order.executedAmount = execution.executedAmount;
            else order.executedAmount += execution.executedAmount;

            // Add delay before next address (except for last address)
            if (i < addressSelection.addresses.length - 1 && totalExecuted < order.remainingAmount) {
              console.log(`⏳ Waiting 25 seconds before next address execution...`);
              await new Promise(resolve => setTimeout(resolve, 25000)); 
            }
          } else {
            console.error(`❌ Failed to execute trade with address ${addressInfo?.name}: ${execution.error}`);
            allExecutionSuccessful = false;
            
            // Check if failure is due to price conditions
            if (execution?.error?.toString()?.includes('Price condition no longer valid')) {
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
          if (totalExecuted > 0 && order.automatic && order.sourceLocation) {
            const { rowIndex, colIndex, levelIndex, levelType } = order.sourceLocation;
            if (tokensInRow[rowIndex]?.columns[colIndex]?.details) {
              const levels = levelType === 'sell' 
                ? tokensInRow[rowIndex].columns[colIndex].details.sellLevels 
                : tokensInRow[rowIndex].columns[colIndex].details.buyLevels;
                
              if (levels[levelIndex]) {
                // Use the order's cumulative executedAmount which tracks all executions
                const totalExecutedSoFar = order.executedAmount || totalExecuted;
                
                console.log(`Marking level as partially filled. Executed: ${totalExecutedSoFar}/${order.fromAmount}`);
                
                // Update the level status to partially filled (keep original percentage)
                levels[levelIndex].status = 'partially_filled'; // Mark as partially filled, not active
                levels[levelIndex].partialExecutionDate = new Date().toISOString();
                levels[levelIndex].executedAmount = totalExecutedSoFar;
                
                console.log(`Setting executedAmount for level ${levelIndex}:`, {
                  orderExecutedAmount: order.executedAmount,
                  currentExecuted: totalExecuted,
                  totalExecutedSoFar,
                  status: levels[levelIndex].status,
                  levelExecutedAmount: levels[levelIndex].executedAmount,
                  originalAmount: order.fromAmount
                });
                
                updateDetailsOrder(rowIndex, colIndex, tokensInRow[rowIndex].columns[colIndex].details);
                
                // Verify the data after update
                console.log(`After updateDetailsOrder, level ${levelIndex} data:`, {
                  status: levels[levelIndex].status,
                  executedAmount: levels[levelIndex].executedAmount,
                  partialExecutionDate: levels[levelIndex].partialExecutionDate
                });
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
        
        console.log(`Multi-address execution completed. Order ${order.id}: ${order.status}, executed: ${totalExecuted}/${order.remainingAmount}`);
        
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
        // Note: Split information is now handled internally by the quote aggregator
        if (bestTradeResult.bestMixed) {
          limitOrderTradeSummary.fraction = bestTradeResult.fractionMixed;
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
    const locationProcessingTimestamps = new Map(); // Track when orders from each location started processing
    
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

            if (orderExecutionLocks.has(order.id)) {
              console.log(`Order ${order.id} is already being executed, skipping...`);
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

            // Use price tolerance from props (converted from percentage to decimal)
            const PRICE_TOLERANCE = props.priceThreshold / 100;
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

            // Try progressively smaller test amounts to find the right range
            // Calculate multipliers dynamically to ensure test amounts don't exceed $10,000
            const fromTokenPrice = tokensByAddresses.value[order.fromToken.address]?.price || 0;
            // Calculate remaining amount for this order
            const executedSoFar = order.executedAmount || 0;
            const remainingAmount = Number(order.fromAmount) - executedSoFar;
            const orderValueUSD = remainingAmount * fromTokenPrice;  // Use remaining amount, not original
            
            // Generate test multipliers from higher to lower so we can stop as soon as we find one that works
            const testMultipliers = [];
            const testAmountsUSD = [50000, 5000, 500, 50, 5]; // Test amounts in USD, from high to low
            
            // Add multipliers for each test amount (only if they don't exceed the order value)
            for (const testUSD of testAmountsUSD) {
              const multiplier = testUSD / orderValueUSD;
              if (multiplier <= 1) {
                testMultipliers.push(multiplier);
              }
            }
            
            // If no standard test amounts work, add some percentage-based fallbacks
            if (testMultipliers.length === 0) {
              testMultipliers.push(0.1);
            }
            
            console.log(`Order ${order.id}: Testing with multipliers (high to low): ${testMultipliers.map(m => `${(m * 100)}%`).join(', ')}`);
            
            let exactExecutionPrice = null;
            let comparableExecutionPrice = null;
            let workingMultiplier = null;
            
            for (const multiplier of testMultipliers) {
              const testAmount = Number(order.fromAmount) * multiplier;
              const testValueUSD = testAmount * fromTokenPrice;
              
              console.log(`Order ${order.id}: Testing with ${(multiplier * 100)}% amount ($${testValueUSD.toFixed(2)} worth)`);
              
              // Get exact trade execution price by fetching best trades
              const bestTradeResult = await getBestTrades(
                order.fromToken.address,
                order.toToken.address,
                testAmount.toString(),
                order?.sender?.address || senderDetails.value.address
              );

              // Calculate exact execution price using the helper (with small test amount)
              // No gas deduction for initial price check
              const priceResult = calculateExecutionPrice(
                order, 
                bestTradeResult, 
                testAmount,
                toToken.price,
                false  // Don't deduct gas cost for initial check
              );
              
              exactExecutionPrice = priceResult.executionPrice;
              comparableExecutionPrice = priceResult.comparableExecutionPrice;
              
              console.log(`Order ${order.id}: Testing with ${(multiplier * 100)}% amount - execution price: ${comparableExecutionPrice?.toFixed(9) || 'N/A'}`);

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

              if (shouldTrigger) {
                const unit = order.limitPriceInDollars ? '$' : '';
                console.log(`Order ${order.id}: Found triggerable amount at ${(multiplier * 100)}% - execution price ${unit}${comparableExecutionPrice.toFixed(9)} vs limit ${unit}${comparablePriceLimit.toFixed(9)}`);
                // Store the working multiplier in separate variable
                workingMultiplier = multiplier;
                break;
              }
            }

            if (!shouldTrigger) {
              const unit = order.limitPriceInDollars ? '$' : '';
              console.log(`Order ${order.id}: No test amount met trigger condition - smallest test execution price ${unit}${comparableExecutionPrice?.toFixed(9) || 'N/A'} vs limit ${unit}${comparablePriceLimit.toFixed(9)} - not triggered`);
              continue
            }
            
            // Check if another order from the same location is already processing
            if (order.automatic && order.sourceLocation) {
              const { rowIndex, colIndex } = order.sourceLocation;
              const locationKey = `${rowIndex}-${colIndex}`;
              
              // Check if there's an active processing order from this location
              const hasProcessingOrder = automaticOrders.value.some(o => 
                o.id !== order.id &&
                (o.status === 'processing') &&
                o.sourceLocation &&
                o.sourceLocation.rowIndex === rowIndex &&
                o.sourceLocation.colIndex === colIndex
              );
              
              if (hasProcessingOrder) {
                // No timestamp recorded, skip this iteration
                console.log(`Order ${order.id}: Another order from row ${rowIndex}, col ${colIndex} is processing. Waiting for next cycle...`);
                continue;
              }

              const processingStartTime = locationProcessingTimestamps.get(locationKey);
              if (processingStartTime) {
                const elapsedSeconds = (Date.now() - processingStartTime) / 1000;
                if (elapsedSeconds < 30) {
                  console.log(`Order ${order.id}: Another order from row ${rowIndex}, col ${colIndex} is processing. Waiting ${(30 - elapsedSeconds).toFixed(1)} more seconds...`);
                  continue;
                }
              }
            }
          
            // Execute order asynchronously without blocking main loop
            tryExecutePendingOrder(order, exactExecutionPrice, workingMultiplier);
            
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
          order?.sender?.address || senderDetails.value.address
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
      
      if (lossPercentage > 99.999) {
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

    async function tryExecutePendingOrder(order, exactExecutionPrice, workingMultiplier) {
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
        
        const executedSoFar = order.executedAmount || 0;
        const originalFromAmount = Number(order.fromAmount);
        const remainingAmount = originalFromAmount - executedSoFar;
        const remainingPercentage = remainingAmount / originalFromAmount;
        
        // First, try 100% of the remaining amount
        console.log(`Order ${order.id}: Testing 100% of remaining amount (${remainingAmount}) first...`);
        
        let executableAmount;
        let newRemainingAmount;
        let bestTestResult;

        const fullAmountTest = await testExecutableAmount(order, Number(remainingAmount));
        
        // Note: Check for concurrent processing is now done before calling tryExecutePendingOrder
        // This ensures we don't waste resources fetching trade data for orders that can't execute
        
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
          executableAmount = remainingAmount;  // Use remaining amount, not original fromAmount
          newRemainingAmount = 0;
        } else {
          // If we don't have a working multiplier from the initial test, we can't proceed
          if (!workingMultiplier) {
            console.log(`Order ${order.id}: No working multiplier provided, cannot determine executable range`);
            return;
          }

          // The working multiplier is already a percentage of remainingAmount
          // Search between this and 10x this value (since test amounts are in factors of 10)
          let lowPercentage = workingMultiplier;
          let highPercentage = workingMultiplier * 10;
          
          // Cap at 100% if needed
          if (highPercentage > 1) {
            highPercentage = 1;
          }
          
          console.log(`Order ${order.id}: Using working multiplier ${workingMultiplier} - range ${(lowPercentage * 100)}% to ${(highPercentage * 100)}%`);

          // Use dichotomy to find the maximum executable percentage of fromAmount
          let bestPercentage = lowPercentage;
          // Adapt margin error based on the range we're working with
          // Use 2.5% of the range size as margin error
          const rangeSize = highPercentage - lowPercentage;
          const marginError = rangeSize * 0.01; // 1% precision of the search range
          const minPercentage = marginError; // Minimum percentage to consider
                    
          // Binary search to find maximum executable percentage
          while ((highPercentage - lowPercentage) > minPercentage) {
            const midPercentage = (lowPercentage + highPercentage) / 2;
            const testAmount = Number(remainingAmount) * midPercentage;
            console.log('Dichotomy iteration:', {
              remainingAmount,
              midPercentage,
              testAmount,
              typeOfRemainingAmount: typeof remainingAmount
            });
            
            await new Promise(r => setTimeout(r, 6000));
            const testResult = await testExecutableAmount(order, testAmount);
            console.log(testResult)
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
          
          console.log({bestPercentage})
          // If we couldn't find any executable percentage, release lock and return
          if (!bestTestResult || bestPercentage < minPercentage) {
            console.log(`Order ${order.id}: No executable amount found within price limits (bestTestResult: ${!!bestTestResult}, bestPercentage: ${bestPercentage})`);
            orderExecutionLocks.delete(order.id);
            console.log(`🔓 Released lock for order ${order.id}`);
            return;
          }
          
          // Calculate the best executable amount from the percentage
          executableAmount = (remainingAmount * bestPercentage).toString();
          console.log(`Order ${order.id}: Found optimal executable amount: ${executableAmount} (${(bestPercentage*100).toFixed(1)}% of original)`);
          
          // Update order status to processing while processing
          order.status = props.isTestMode ? 'processed': 'processing';
          
          // Update executed amount immediately
          const executedThisTime = originalFromAmount * bestPercentage;
          const newExecutedAmount = (order.executedAmount || 0) + executedThisTime;
          newRemainingAmount = originalFromAmount - newExecutedAmount;
          window.electronAPI.updatePendingOrder({
            ...JSON.parse(JSON.stringify(order)),
            executedAmount: newExecutedAmount,
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

        // Handle mixed trades if applicable
        // Note: Split information is now handled internally by the quote aggregator
        if (finalBestTrades.bestMixed) {
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
          if (order.sourceLocation) {
            const { rowIndex, colIndex } = order.sourceLocation;
            const locationKey = `${rowIndex}-${colIndex}`;
            locationProcessingTimestamps.set(locationKey, Date.now());
            console.log(`Order ${order.id}: Set processing timestamp for location ${locationKey}`);
          }
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
            // Track cumulative executed amount
            if (!order.executedAmount) order.executedAmount = Number(executableAmount);
            else order.executedAmount += Number(executableAmount);
            
            // Check if order is 97.5% or more filled based on cumulative execution
            const originalAmount = Number(order.fromAmount);
            const totalExecutedAmount = order.executedAmount;
            const fillPercentage = (totalExecutedAmount / originalAmount) * 100;
            const actualRemainingAmount = originalAmount - totalExecutedAmount;
            
            if (fillPercentage >= 97.5 || actualRemainingAmount < originalAmount * 0.025) {
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
                remainingAmount: actualRemainingAmount.toString(),
                executedAmount: totalExecutedAmount,
                status: order.status
              });
              
              // Remove from pending orders AFTER database update
              pendingLimitOrders.value = pendingLimitOrders.value.filter(o => o.id !== order.id);
              console.log(`Order ${order.id} completed - filled ${fillPercentage.toFixed(1)}%`);
            } else {
              // Order partially filled, set back to pending for future executions
              order.status = 'pending';
              order.remainingAmount = actualRemainingAmount;
              console.log(`Order ${order.id} partially filled - ${fillPercentage.toFixed(1)}% complete, remaining: ${actualRemainingAmount}`);
              
              await window.electronAPI.updatePendingOrder({
                ...JSON.parse(JSON.stringify(order)),
                remainingAmount: actualRemainingAmount.toString(),
                executedAmount: totalExecutedAmount,
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
          // Only clean if the level is being user-modified (has triggerPrice or balancePercentage changes)
          // AND is not currently in partially_filled status (preserve execution data for partial fills)
          if ((cleanedLevel.triggerPrice !== undefined || cleanedLevel.balancePercentage !== undefined) 
              && cleanedLevel.status !== 'partially_filled') {
            delete cleanedLevel.partialExecutionDate;
            delete cleanedLevel.executedAmount; 
            delete cleanedLevel.originalPercentage;
            delete cleanedLevel.executionPrice;
            delete cleanedLevel.executionDate;
            delete cleanedLevel.failureReason;
            delete cleanedLevel.lastFailureDate;
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
          // Only clean if the level is being user-modified (has triggerPrice or balancePercentage changes)
          // AND is not currently in partially_filled status (preserve execution data for partial fills)
          if ((cleanedLevel.triggerPrice !== undefined || cleanedLevel.balancePercentage !== undefined) 
              && cleanedLevel.status !== 'partially_filled') {
            delete cleanedLevel.partialExecutionDate;
            delete cleanedLevel.executedAmount;
            delete cleanedLevel.originalPercentage;
            delete cleanedLevel.executionPrice;
            delete cleanedLevel.executionDate;
            delete cleanedLevel.failureReason;
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

        // Skip addresses with undefined mode for automatic trading
        if (!detail.mode) continue;
        
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

    const getOrdersForColumn = (rowIndex, colIndex) => {
      // Filter automaticOrders for this specific column
      return automaticOrders.value.filter(order => 
        order.sourceLocation &&
        order.sourceLocation.rowIndex === rowIndex &&
        order.sourceLocation.colIndex === colIndex
      );
    };
    
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
              const originalFromAmount = (buyLevel.balancePercentage * 0.01 * balance);
              
              // Check if this level has already been partially executed
              const existingExecutedAmount = buyLevel.executedAmount || 0;
              
              // If the level has already executed 97.5% or more, skip it
              if (existingExecutedAmount >= originalFromAmount * 0.975) {
                console.log(`Buy level ${k}: Already executed ${existingExecutedAmount}/${originalFromAmount} (>97.5%), marking as processed`);
                buyLevel.status = 'processed';
                return;
              }
              
              // Calculate remaining amount to execute
              const fromAmount = originalFromAmount - existingExecutedAmount;
              
              console.log(`Buy level ${k}: Token ${fromToken.symbol}, balance: ${balance}, amount: ${fromAmount}, already executed: ${existingExecutedAmount}`);
              
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
                // Generate a stable ID based on location instead of random
                // This ensures the same order keeps the same ID across regenerations
                const stableId = `auto_${i}_${j}_${k}_buy`;
                orders.push({
                  id: stableId,
                  fromAmount: originalFromAmount,  // Use original amount for calculations
                  remainingAmount: fromAmount,     // This is what's left to execute
                  fromToken: { ...fromToken },
                  toToken: { ...toToken },
                  priceLimit: buyLevel.triggerPrice,
                  // orderType removed - using shouldSwitchTokensForLimit instead
                  shouldSwitchTokensForLimit: true,
                  status: 'pending',
                  createdAt: new Date().toISOString(),
                  automatic: true,
                  limitPriceInDollars: col.details.limitPriceInDollars || false,
                  // Initialize with any existing executedAmount from the level
                  executedAmount: existingExecutedAmount,
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
              const originalFromAmount = (sellLevel.balancePercentage * 0.01 * balance);
              
              // Check if this level has already been partially executed
              const existingExecutedAmount = sellLevel.executedAmount || 0;
              
              // If the level has already executed 97.5% or more, skip it
              if (existingExecutedAmount >= originalFromAmount * 0.975) {
                console.log(`Sell level ${k}: Already executed ${existingExecutedAmount}/${originalFromAmount} (>97.5%), marking as processed`);
                sellLevel.status = 'processed';
                return;
              }
              
              // Calculate remaining amount to execute
              const fromAmount = originalFromAmount - existingExecutedAmount;
              
              console.log(`Sell level ${k}: Token ${fromToken.symbol}, balance: ${balance}, amount: ${fromAmount}, already executed: ${existingExecutedAmount}`);
              
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
                // Generate a stable ID based on location instead of random
                // This ensures the same order keeps the same ID across regenerations
                const stableId = `auto_${i}_${j}_${k}_sell`;
                orders.push({
                  id: stableId,
                  fromAmount: originalFromAmount,  // Use original amount for calculations
                  remainingAmount: fromAmount,     // This is what's left to execute
                  fromToken: { ...fromToken },
                  toToken: { ...toToken },
                  priceLimit: sellLevel.triggerPrice,
                  // orderType removed - using shouldSwitchTokensForLimit instead
                  shouldSwitchTokensForLimit: false,
                  status: 'pending',
                  createdAt: new Date().toISOString(),
                  automatic: true,
                  limitPriceInDollars: col.details.limitPriceInDollars || false,
                  // Initialize with any existing executedAmount from the level
                  executedAmount: existingExecutedAmount,
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

    watch(() => senderDetails.value?.mode, (newMode) => {
      if (senderDetails.value.address) {
        console.log('saving wallet mode');
        window.electronAPI.saveWalletMode(senderDetails.value.address, newMode)
      }
    })
    // Helper function to load contract addresses for all wallets
    const loadContractAddresses = async (addresses) => {
      console.log('🔍 Starting to load contract addresses for all wallets...');
      console.log('Number of addresses to check:', addresses?.length || 0);

      if (!addresses || addresses.length === 0) {
        console.log('No addresses to process');
        return;
      }

      for (const address of addresses) {
        if (address?.address) {
          console.log(`\n📍 Processing address: ${address.address}`);

          // First, load saved contract address from settings (fast, offline)
          console.log(`  ⏳ Calling getContractAddress for ${address.address.slice(0, 10)}...`);
          const savedContractAddr = await window.electronAPI.getContractAddress(address.address);
          console.log(`  ✅ getContractAddress returned:`, savedContractAddr || 'null/undefined');

          if (savedContractAddr) {
            contractAddress[address.address] = savedContractAddr;
            console.log(`  💾 Loaded saved contract address: ${savedContractAddr.slice(0, 10)}...${savedContractAddr.slice(-10)}`);
          } else {
            console.log(`  ⚠️ No saved contract address found in settings`);
          }

          // Then verify/update from blockchain registry (slower, but authoritative)
          try {
            console.log(`  ⏳ Querying blockchain registry with getBundler...`);
            const result = await window.electronAPI.getBundler(address.address, undefined);
            console.log(`  ✅ getBundler returned:`, result);

            if (result.success && result.address) {
              // Update if different from saved value
              if (contractAddress[address.address] !== result.address) {
                contractAddress[address.address] = result.address;
                console.log(`  🔄 Updated contract address from registry: ${result.address.slice(0, 10)}...${result.address.slice(-10)}`);
              } else {
                console.log(`  ✓ Registry address matches saved address`);
              }
            } else if (result.success && !result.address) {
              console.log(`  ℹ️ No bundler deployed on-chain for this address`);
            } else {
              console.log(`  ❌ getBundler failed:`, result.error || 'unknown error');
            }
          } catch (error) {
            console.error(`  ❌ Exception querying registry for ${address.address}:`, error);
            // Keep using saved address if registry query fails
          }

          // Load wallet mode
          console.log(`  ⏳ Loading wallet mode...`);
          const mode = await window.electronAPI.getWalletMode(address.address);
          console.log(`  ✅ Wallet mode:`, mode || 'undefined');
          address.mode = mode;
        }
      }

      console.log('\n🏁 Finished loading contract addresses');
      console.log('Final contractAddress object:', contractAddress);
    };

    watch(() => tokens.value, (tokensValue) => emit('update:settings', { tokens: [...tokensValue] }), { deep: true });
    watch(() => tokensInRow, () => emit('update:settings', { tokensInRow: [...tokensInRow] }), { deep: true });
    watch(
      () => props.addresses,
      async (addrs) => {
        if (addrs && addrs[0]) {
          senderDetails.value = addrs[0];
        }
        // Load contract addresses when addresses change
        await loadContractAddresses(addrs);
        generateOrdersFromLevels();
      },
      { immediate: true }
    );
    watch(
      () => senderDetails.value,
      async (val, oldVal) => {
        if (!val) {
          isSwapButtonDisabled.value = true;
        } else {
          console.log('Loaded senderDetails');
          needsToApprove.value = false;

          // Load mode and contract address for the selected wallet when address changes
          if (val.address) {
            const mode = await window.electronAPI.getWalletMode(val.address);

            // Update senderDetails with loaded values
            if (mode !== undefined) {
              senderDetails.value.mode = mode;
              walletModes[val.address] = mode;
            }
          }
        }
      },
      { immediate: true }
    );

    // Watch for mode changes separately
    watch(
      () => senderDetails.value?.mode,
      async (newMode, oldMode) => {
        // Save mode when it changes
        if (newMode !== oldMode && senderDetails.value?.address) {
          await window.electronAPI.saveWalletMode(senderDetails.value.address, newMode);
        }
      }
    );
    // Watch for sender address changes to load contract address
    watch(
      () => senderDetails.value?.address,
      async (newAddress, oldAddress) => {
        if (newAddress && newAddress !== oldAddress) {
          // Load contract address if not already loaded
          if (!contractAddress[newAddress]) {
            const savedContractAddr = await window.electronAPI.getContractAddress(newAddress);
            if (savedContractAddr) {
              contractAddress[newAddress] = savedContractAddr;
              console.log(`Loaded contract address for ${newAddress.slice(0, 10)}...: ${savedContractAddr.slice(0, 10)}...`);
            }
          }
        }
      }
    );

    // Watch for contract address changes for current wallet
    watch(
      () => senderDetails.value?.address ? contractAddress[senderDetails.value.address] : null,
      async (newContractAddr, oldContractAddr) => {
        // Save contract address when it changes (not on initial load)
        if (oldContractAddr !== undefined && newContractAddr !== oldContractAddr && senderDetails.value?.address) {
          await window.electronAPI.saveContractAddress(senderDetails.value.address, newContractAddr);
        }
      }
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
        outdateOrders.map(o => window.electronAPI.deletePendingOrder(o.id))
      }

      // Load contract addresses and wallet modes for all wallets
      await loadContractAddresses(props.addresses);

      stopEthBalanceMonitoring();
    });

    // Bundler deployment function
    const deployBundler = async () => {
      try {
        isDeploying.value = true;
        swapMessage.value = 'Deploying bundler contract...';

        const result = await window.electronAPI.deployBundler(senderDetails.value.address, undefined);

        if (result.success && result.address) {
          contractAddress[senderDetails.value.address] = result.address;
          swapMessage.value = 'Bundler deployed successfully!';
        } else {
          throw new Error(result.error || 'Deployment failed');
        }
      } catch (error) {
        console.error('Deploy error:', error);
        swapMessage.value = `Deploy failed: ${error.message}`;
      } finally {
        isDeploying.value = false;
      }
    };

    const copy = (string) => {
      navigator.clipboard.writeText(string);
    }

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
      deploymentCostUsd,

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
      getOrdersForColumn,

      contractAddress,
      copy,
      deployBundler,
      isDeploying,
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
  margin-bottom: 10px;
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

.token-details .compensate-height {
  display: block;
  height: 20px;
}

.token-details:hover .compensate-height {
  display: none;
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
  font-size: 15px;
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
  background-color: #ffd08a90; /* Orange for waiting balance */
  font-weight: 600;
}

.check-if-trigger {
  background-color: #a6c9b1; /* Orange for waiting balance */
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
  background-color: #2dab3e;
  color: #000;
  border: none;
  padding: 4px 8px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 16px;
  font-weight: bold;
  transition: background-color 0.3s ease;
  min-width: 40px;
  position: absolute;
}

.global-pause-btn.paused {
  background-color: #ca4f46;
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
  pointer-events: none;
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

.sender-buttons {
  margin-left: auto ;
  margin-right: auto ;
  display: block;
  width: 680px;
}

.sender-buttons select {
  display: inline-block;
}

.sender-buttons .addressSelect {
  margin-left: auto;
  margin-right: 5px;
}

.sender-buttons .addressMode {
  margin-right: auto;
  width: 200px;
}

.deployInfo {
  width: 100%;
  margin-left: auto;
  margin-right: auto;
}

.deploy-button {
  width: 100px;
  margin-left: auto;
  margin-right: auto;
  display: block;
}

.deploy-address {
  text-align: center;
}

.copy-area:hover {
  cursor: pointer;
}
</style>