<template>
  <div class="order-book-levels">
    <!-- Header with controls -->
    <div class="header">
      <button 
        class="control-btn pause-btn" 
        :class="{ active: isPaused }"
        @click="togglePause"
      >
        {{ isPaused ? '▶️' : '⏸️' }}
      </button>
      
      <div class="token-pair">
        <span class="token-name">{{ tokenB?.symbol }}</span>
        <span class="token-price">{{ '  $' + removeTrailingZeros(tokenB?.price, 8) }}</span>
      </div>
      
      <button 
        class="control-btn delete-btn" 
        @click="$emit('delete')"
      >
        🗑️
      </button>
    </div>

    <!-- Address selection and minimum amount controls -->
    <div class="address-controls">
      <div class="left-controls">
        <div class="address-selection">
          <label class="middle-label">
            <input 
              v-model="isRandomMode" 
              type="checkbox"
              @change="emitOrderUpdate"
            >
            <span
              class="higher-label"
              :class="{'slider-selected': isRandomMode}"
            >Random</span>
          </label>
        </div>
        <div class="price-unit-selection">
          <span
            class="slider-label left"
            :class="{'slider-selected': !limitPriceInDollars}"
          >{{ tokenB?.symbol }}</span>
          <label class="slider-toggle">
            <input 
              v-model="limitPriceInDollars" 
              type="checkbox"
              @change="togglePriceUnit"
            >
            <span class="slider" />
          </label>
          <span
            class="slider-label right"
            :class="{'slider-selected': limitPriceInDollars}"
          >$</span>
        </div>
      </div>
      <div class="minimum-amount">
        <label class="amount-label">
          Min: 
          <input 
            v-model.number="minimumAmount" 
            type="number"
            step="0.000001"
            min="0"
            placeholder="0.0"
            class="min-amount-input"
            @input="emitOrderUpdate"
          >
          <!-- <span class="token-symbol">{{ tokenA?.symbol }}</span> -->
        </label>
      </div>
    </div>

    <!-- Current market price -->
    <div class="market-price">
      <span class="price-value">
        1 {{ tokenA?.symbol }} = 
        <span>{{ currentMarketPrice.toFixed(7) }} {{ tokenB?.symbol }}</span>
      </span>
    </div>

    <!-- Order levels grid -->
    <div class="levels-container">
      <!-- Buy levels (left column) -->
      <div class="buy-levels">
        <div 
          v-for="(level, index) in buyLevels" 
          :key="`buy-${index}`"
          class="level-row buy-row"
          :class="{ 'close-to-trigger': isCloseToTrigger('buy', level) }"
        >
        {{ level }}
          <div class="level-inputs">
            <img
              :src="deleteImage"
              class="delete"
              @click="cleanLevel(level, index)"
            >
            <div class="price-input-container">
              <label class="input-group">
                <span
                  v-if="!limitPriceInDollars"
                  class="first-part-price"
                >{{ tokenA?.symbol }} ≤ </span>
                <span
                  v-else
                  class="first-part-price"
                >{{ tokenA?.symbol }} ≤</span>
                <input
                  v-model.number="level.triggerPrice"
                  type="number"
                  step="0.000001"
                  placeholder="0.0"
                  class="price-input"
                  @change="updateLevel('buy', index)"
                >
                <span
                  v-if="!limitPriceInDollars"
                  class="second-part-price"
                >{{ tokenB?.symbol }}</span>
                <span
                  v-else
                  class="second-part-price"
                >$</span>
              </label>
              <div
                v-if="level.triggerPrice"
                class="secondary-price"
              >
                <span
                  v-if="!limitPriceInDollars"
                  class="usd-price"
                >${{ getUsdPrice(level.triggerPrice) }}</span>
                <span
                  v-if="limitPriceInDollars"
                  class="token-price-below"
                >{{ getTokenPriceFromDollar(level.triggerPrice) }} {{ tokenB?.symbol }}</span>
              </div>
            </div>
            <label
              v-if="level.triggerPrice"
              class="input-group"
            >
              Buy
              <input
                v-model.number="level.balancePercentage"
                type="number"
                min="0"
                max="100"
                step="1"
                placeholder="0"
                class="percentage-input"
                :title="getPercentageTooltip('buy', level.balancePercentage)"
                @input="updateLevel('buy', index)"
              >
              <span class="percentage-symbol">%</span>
              <span
                class="level-status-inline"
                :class="getLevelStatusClass('buy', level)"
              >
                {{ getLevelStatus('buy', level) }}
              </span>
            </label>
          </div>
        </div>
      </div>
      <!-- Sell levels (right column) -->
      <div class="sell-levels">
        <div 
          v-for="(level, index) in sellLevels" 
          :key="`sell-${index}`"
          class="level-row sell-row"
          :class="{ 'close-to-trigger': isCloseToTrigger('sell', level) }"
        >
          <div class="level-inputs">
            <img
              v-if="level.triggerPrice"
              :src="deleteImage"
              class="delete"
              @click="cleanLevel(level, index)"
            >
            <div class="price-input-container">
              <label class="input-group">
                <span
                  v-if="!limitPriceInDollars"
                  class="first-part-price"
                >{{ tokenA?.symbol }} ≥ </span>
                <span
                  v-else
                  class="first-part-price"
                >{{ tokenA?.symbol }} ≥ </span>
                <input
                  v-model.number="level.triggerPrice"
                  type="number"
                  step="0.000001"
                  placeholder="0.0"
                  class="price-input"
                  @change="updateLevel('sell', index)"
                >
                <span
                  v-if="!limitPriceInDollars"
                  class="second-part-price"
                >{{ tokenB?.symbol }}</span>
                <span
                  v-else
                  class="second-part-price"
                >$</span>
              </label>
              <div
                v-if="level.triggerPrice"
                class="secondary-price"
              >
                <span
                  v-if="!limitPriceInDollars"
                  class="usd-price"
                >${{ getUsdPrice(level.triggerPrice) }}</span>
                <span
                  v-if="limitPriceInDollars"
                  class="token-price-below"
                >{{ getTokenPriceFromDollar(level.triggerPrice) }} {{ tokenB?.symbol }}</span>
              </div>
            </div>
            <label
              v-if="level.triggerPrice"
              class="input-group"
            >
              Sell
              <input
                v-model.number="level.balancePercentage"
                type="number"
                min="0"
                max="100"
                step="1"
                placeholder="0"
                class="percentage-input"
                :title="getPercentageTooltip('sell', level.balancePercentage)"
                @input="updateLevel('sell', index)"
              >
              <span class="percentage-symbol">%</span>
              <span
                class="level-status-inline"
                :class="getLevelStatusClass('sell', level)"
              >
                {{ getLevelStatus('sell', level) }}
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <!-- Price Deviation Confirmation Modal -->
  <ConfirmationModal
    :show="showPriceDeviationModal"
    :title="pendingLevelUpdate ? 'Price Deviation Warning' : 'Order Conflict'"
    :message="priceDeviationMessage"
    :details="priceDeviationDetails"
    :showConfirmButton="!!pendingLevelUpdate"
    :cancelText="pendingLevelUpdate ? 'Cancel' : 'OK'"
    @confirm="confirmPriceDeviationUpdate"
    @cancel="cancelPriceDeviationUpdate"
  ></ConfirmationModal>
</template>

<script>
import { ref, reactive, computed, watch, onMounted, toRefs } from 'vue';
import deleteImage from '@/../assets/delete.svg';
import ConfirmationModal from './ConfirmationModal.vue';

export default {
  name: 'OrderBookLevels',
  components: {
    ConfirmationModal
  },
  props: {
    tokenA: {
      type: Object,
      required: true,
      // Expected: { symbol: 'ETH', address: '0x...', price: 3000, decimals: 18 }
    },
    tokenB: {
      type: Object,
      required: true,
      // Expected: { symbol: 'USDT', address: '0x...', price: 1, decimals: 6 }
    },
    senderAddress: {
      type: String,
      default: ''
    },
    priceThreshold: {
      type: Number,
      default: 0.01 // 1% threshold for "close to trigger"
    },
    priceDeviationPercentage: {
      type: Number,
      default: 20
    },
    existingOrders: {
      type: Array,
      default: () => []
    },
    details: {
      type: Object,
    },
    tokensByAddresses: {
      type: Object,
      default: () => ({})
    },
    balances: {
      type: Object,
      default: () => ({})
    },
  },
  emits: ['orderUpdate', 'delete'],
  setup(props, { emit }) {
    const isPaused = ref(false);
    const isRandomMode = ref(false); // false = highest balance, true = random
    const minimumAmount = ref(0);
    const limitPriceInDollars = ref(false);
    
    // Modal state for price deviation warning
    const showPriceDeviationModal = ref(false);
    const pendingLevelUpdate = ref(null);
    const priceDeviationMessage = ref('');
    const priceDeviationDetails = ref(null);

    // Initialize 3 sell levels and 3 buy levels
    const sellLevels = reactive([
      { triggerPrice: null, balancePercentage: null, status: 'inactive' },
      { triggerPrice: null, balancePercentage: null, status: 'inactive' },
      { triggerPrice: null, balancePercentage: null, status: 'inactive' }
    ]);
    
    const buyLevels = reactive([
      { triggerPrice: null, balancePercentage: null, status: 'inactive' },
      { triggerPrice: null, balancePercentage: null, status: 'inactive' },
      { triggerPrice: null, balancePercentage: null, status: 'inactive' }
    ]);

    const { tokenA, tokenB, tokensByAddresses } = toRefs(props);
    
    // Create computed properties for prices
    const tokenAPrice = computed(() => {
      if (!tokenA.value) return 0;
      // First check tokensByAddresses for most up-to-date price
      if (tokensByAddresses.value && tokenA.value.address) {
        const address = tokenA.value.address.toLowerCase();
        if (tokensByAddresses.value[address]) {
          return tokensByAddresses.value[address].price || 0;
        }
      }
      return tokenA.value.price || 0;
    });
    
    const tokenBPrice = computed(() => {
      if (!tokenB.value) return 0;
      if (tokensByAddresses.value && tokenB.value.address) {
        const address = tokenB.value.address.toLowerCase();
        if (tokensByAddresses.value[address]) {
          return tokensByAddresses.value[address].price || 0;
        }
      }
      return tokenB.value.price || 0;
    });

    const currentMarketPrice = computed(() => {
      const priceA = Number(tokenAPrice.value);
      const priceB = Number(tokenBPrice.value);
      
      // Check for invalid prices (0, null, undefined, NaN)
      if (priceA <= 0 || priceB <= 0 || !Number.isFinite(priceA) || !Number.isFinite(priceB)) {
        console.log('Cannot calculate market price - invalid prices', { 
          priceA, 
          priceB,
          tokenA: tokenA.value?.symbol,
          tokenB: tokenB.value?.symbol,
          tokenAAddress: tokenA.value?.address,
          tokenBAddress: tokenB.value?.address
        });
        return 0;
      }
      
      const ratio = priceA / priceB;
      return ratio;
    });
    
    const removeTrailingZeros = (num, precision = 8) => {
      if (num === null || num === undefined) return '0';
      
      // Convert to string with fixed precision
      const fixed = Number(num).toFixed(precision);
      
      // Remove trailing zeros after the decimal point
      // If all digits after decimal are zeros, remove decimal point too
      return fixed.replace(/\.?0+$/, '');
    };

    const isCloseToTrigger = (type, level) => {
      if (!level.triggerPrice || !level.balancePercentage || isPaused.value) return false;
      if (level.status === 'processed') return false;
      
      const marketPrice = currentMarketPrice.value;
      if (!marketPrice || marketPrice <= 0) return false;
      
      // Convert prices to same unit for comparison
      let levelPriceInTokenRatio;
      let marketPriceForComparison;
      
      if (limitPriceInDollars.value) {
        // Level price is in dollars, convert to token ratio for comparison
        levelPriceInTokenRatio = level.triggerPrice / tokenBPrice.value;
        marketPriceForComparison = marketPrice;
      } else {
        // Both are already in token ratios
        levelPriceInTokenRatio = level.triggerPrice;
        marketPriceForComparison = marketPrice;
      }
      
      // Check if far from trigger point (not close)
      if (type === 'sell' && levelPriceInTokenRatio < marketPriceForComparison) {
        return true; // Not close to trigger
      } else if (type === 'buy' && levelPriceInTokenRatio > marketPriceForComparison) {
        return true; // Not close to trigger
      }

      // Calculate price difference as percentage
      const priceDifference = Math.abs(marketPriceForComparison - levelPriceInTokenRatio) / levelPriceInTokenRatio;
      return priceDifference <= props.priceThreshold;
    };

    const togglePause = () => {
      isPaused.value = !isPaused.value;
      emitOrderUpdate();
    };

    const togglePriceUnit = () => {
      // Clear all levels when switching modes
      buyLevels.forEach((level) => {
        level.triggerPrice = null;
        level.balancePercentage = null;
        level.status = 'inactive';
      });
      
      sellLevels.forEach((level) => {
        level.triggerPrice = null;
        level.balancePercentage = null;
        level.status = 'inactive';
      });
      
      emitOrderUpdate();
    };
    
    // Price deviation check functions
    const checkPriceDeviation = (userPrice, marketPrice, orderType) => {
      if (!marketPrice || marketPrice === 0) return { needsConfirmation: false };
      
      const deviation = Math.abs((userPrice - marketPrice) / marketPrice * 100);
      
      if (deviation > props.priceDeviationPercentage) {
        const isBuyOrder = orderType === 'buy';
        const isUnfavorable = isBuyOrder ? userPrice > marketPrice : userPrice < marketPrice;
        
        if (isUnfavorable) {
          return {
            needsConfirmation: true,
            deviation: deviation.toFixed(2),
            isBuyOrder
          };
        }
      }
      
      return { needsConfirmation: false };
    };
    
    // Validate against existing orders from other OrderBookLevels instances
    const validateAgainstExistingOrders = (userPrice, orderType) => {
      try {
        // Filter existing orders for the same token pair
        const relevantOrders = props.existingOrders.filter(order => {
          if (!order.tokenA || !order.tokenB) return false;
          
          const orderTokenA = order.tokenA.address.toLowerCase();
          const orderTokenB = order.tokenB.address.toLowerCase();
          const currentTokenA = tokenA.value.address.toLowerCase();
          const currentTokenB = tokenB.value.address.toLowerCase();
          
          // Check if same token pair (either direction)
          return (orderTokenA === currentTokenA && orderTokenB === currentTokenB) ||
                 (orderTokenA === currentTokenB && orderTokenB === currentTokenA);
        });
        
        if (relevantOrders.length === 0) return { isValid: true };
        
        for (const existingOrder of relevantOrders) {
          // Get all buy and sell levels from existing order
          const buyLevels = existingOrder.buyLevels || [];
          const sellLevels = existingOrder.sellLevels || [];
          
          if (orderType === 'sell') {
            // Current is sell - cannot be <= any active buy level
            for (const buyLevel of buyLevels) {
              if (buyLevel.status === 'processed') continue;
              if (buyLevel.status === 'paused') continue;
              if (buyLevel.triggerPrice && buyLevel.balancePercentage && buyLevel.status === 'active') {
                let buyPrice = buyLevel.triggerPrice;
                
                // Convert existing order's price to comparable units
                if (existingOrder.limitPriceInDollars) {
                  // Existing order uses dollar prices
                  if (limitPriceInDollars.value) {
                    // Both use dollars - direct comparison
                    buyPrice = buyLevel.triggerPrice;
                  } else {
                    // Convert existing dollar price to token ratio
                    const existingTokenBPrice = existingOrder.tokenB.price || tokenBPrice.value;
                    buyPrice = buyLevel.triggerPrice / existingTokenBPrice;
                  }
                } else {
                  // Existing order uses token ratios
                  if (limitPriceInDollars.value) {
                    // Convert existing token ratio to dollars
                    const existingTokenBPrice = existingOrder.tokenB.price || tokenBPrice.value;
                    buyPrice = buyLevel.triggerPrice * existingTokenBPrice;
                  } else {
                    // Both use token ratios - check if tokens are swapped
                    const orderTokenA = existingOrder.tokenA.address.toLowerCase();
                    const currentTokenA = tokenA.value.address.toLowerCase();
                    if (orderTokenA !== currentTokenA) {
                      buyPrice = 1 / buyLevel.triggerPrice;
                    } else {
                      buyPrice = buyLevel.triggerPrice;
                    }
                  }
                }
                
                if (userPrice <= buyPrice) {
                  const unit = limitPriceInDollars.value ? '$' : '';
                  return {
                    isValid: false,
                    reason: `Sell price ${unit}${userPrice.toFixed(6)} cannot be at or below existing buy level at ${unit}${buyPrice.toFixed(6)}`
                  };
                }
              }
            }
          } else if (orderType === 'buy') {
            // Current is buy - cannot be >= any active sell level
            for (const sellLevel of sellLevels) {
              if (sellLevel.status === 'processed') continue;
              if (sellLevel.status === 'paused') continue;
              if (sellLevel.triggerPrice && sellLevel.balancePercentage && sellLevel.status === 'active') {
                let sellPrice = sellLevel.triggerPrice;
                
                // Convert existing order's price to comparable units
                if (existingOrder.limitPriceInDollars) {
                  // Existing order uses dollar prices
                  if (limitPriceInDollars.value) {
                    // Both use dollars - direct comparison
                    sellPrice = sellLevel.triggerPrice;
                  } else {
                    // Convert existing dollar price to token ratio
                    const existingTokenBPrice = existingOrder.tokenB.price || tokenBPrice.value;
                    sellPrice = sellLevel.triggerPrice / existingTokenBPrice;
                  }
                } else {
                  // Existing order uses token ratios
                  if (limitPriceInDollars.value) {
                    // Convert existing token ratio to dollars
                    const existingTokenBPrice = existingOrder.tokenB.price || tokenBPrice.value;
                    sellPrice = sellLevel.triggerPrice * existingTokenBPrice;
                  } else {
                    // Both use token ratios - check if tokens are swapped
                    const orderTokenA = existingOrder.tokenA.address.toLowerCase();
                    const currentTokenA = tokenA.value.address.toLowerCase();
                    if (orderTokenA !== currentTokenA) {
                      sellPrice = 1 / sellLevel.triggerPrice;
                    } else {
                      sellPrice = sellLevel.triggerPrice;
                    }
                  }
                }
                
                if (userPrice >= sellPrice) {
                  const unit = limitPriceInDollars.value ? '$' : '';
                  return {
                    isValid: false,
                    reason: `Buy price ${unit}${userPrice.toFixed(6)} cannot be at or above existing sell level at ${unit}${sellPrice.toFixed(6)}`
                  };
                }
              }
            }
          }
        }
        
        // Also check within current component's levels
        if (orderType === 'sell') {
          // Check against current component's buy levels
          for (const buyLevel of buyLevels) {
            if (buyLevel.status === 'processed') continue;
            if (buyLevel.status === 'paused') continue;
            if (buyLevel.triggerPrice && buyLevel.balancePercentage) {
              // Convert both prices to token ratios for comparison
              const buyPriceInTokenRatio = limitPriceInDollars.value ? 
                (buyLevel.triggerPrice / tokenBPrice.value) : buyLevel.triggerPrice;
              const sellPriceInTokenRatio = limitPriceInDollars.value ? 
                (userPrice / tokenBPrice.value) : userPrice;
              
              if (sellPriceInTokenRatio <= buyPriceInTokenRatio) {
                const unit = limitPriceInDollars.value ? '$' : tokenB.value?.symbol;
                const displayBuyPrice = limitPriceInDollars.value ? buyLevel.triggerPrice : buyLevel.triggerPrice;
                const displaySellPrice = limitPriceInDollars.value ? userPrice : userPrice;
                return {
                  isValid: false,
                  reason: `Sell price ${unit}${displaySellPrice.toFixed(6)} cannot be at or below buy level at ${unit}${displayBuyPrice.toFixed(6)}`
                };
              }
            }
          }
        } else if (orderType === 'buy') {
          // Check against current component's sell levels
          for (const sellLevel of sellLevels) {
            if (sellLevel.status === 'processed') continue;
            if (sellLevel.status === 'paused') continue;
            if (sellLevel.triggerPrice && sellLevel.balancePercentage) {
              // Convert both prices to token ratios for comparison
              const sellPriceInTokenRatio = limitPriceInDollars.value ? 
                (sellLevel.triggerPrice / tokenBPrice.value) : sellLevel.triggerPrice;
              const buyPriceInTokenRatio = limitPriceInDollars.value ? 
                (userPrice / tokenBPrice.value) : userPrice;
              
              if (buyPriceInTokenRatio >= sellPriceInTokenRatio) {
                const unit = limitPriceInDollars.value ? '$' : tokenB.value?.symbol;
                const displaySellPrice = limitPriceInDollars.value ? sellLevel.triggerPrice : sellLevel.triggerPrice;
                const displayBuyPrice = limitPriceInDollars.value ? userPrice : userPrice;
                return {
                  isValid: false,
                  reason: `Buy price ${unit}${displayBuyPrice.toFixed(6)} cannot be at or above sell level at ${unit}${displaySellPrice.toFixed(6)}`
                };
              }
            }
          }
        }
        
        return { isValid: true };
      } catch (error) {
        console.error('Error validating against existing orders:', error);
        return { isValid: true }; // Allow on error
      }
    };
    
    const confirmPriceDeviationUpdate = () => {
      showPriceDeviationModal.value = false;
      if (pendingLevelUpdate.value) {
        const { type, index } = pendingLevelUpdate.value;
        updateLevelConfirmed(type, index);
        pendingLevelUpdate.value = null;
      }
    };
    
    const cancelPriceDeviationUpdate = () => {
      showPriceDeviationModal.value = false;
      if (pendingLevelUpdate.value) {
        const { type, index, originalPrice } = pendingLevelUpdate.value;
        const levels = type === 'sell' ? sellLevels : buyLevels;
        levels[index].triggerPrice = originalPrice; // Restore original price
        pendingLevelUpdate.value = null;
      }
    };
    
    const updateLevel = (type, index) => {
      const levels = type === 'sell' ? sellLevels : buyLevels;
      const level = levels[index];
      
      // Store original price for potential restoration
      const originalPrice = level.triggerPrice;
      
      // Validate inputs
      if (level.triggerPrice < 0) level.triggerPrice = 0;
      if (level.balancePercentage < 0) level.balancePercentage = 0;
      if (level.balancePercentage > 100) level.balancePercentage = 100;

      // Check against existing orders (bid-ask spread validation)
      if (!level.triggerPrice)
        return updateLevelConfirmed(type, index);

      const bidAskValidation = validateAgainstExistingOrders(level.triggerPrice, type);
      
      if (!bidAskValidation.isValid) {
        // Show modal for order conflicts
        showPriceDeviationModal.value = true;
        priceDeviationMessage.value = `Order aborted: ${bidAskValidation.reason}`;
        priceDeviationDetails.value = null;
        pendingLevelUpdate.value = null; // No action needed

        // Clear the invalid price
        level.triggerPrice = null;
        return;
      }
      
      // Check for price deviation if we have a trigger price
      if (tokenAPrice.value && tokenBPrice.value) {
        const marketPrice = tokenAPrice.value / tokenBPrice.value;
        // Convert user price to token ratio if in dollar mode
        const priceForDeviation = limitPriceInDollars.value ? 
          (level.triggerPrice / tokenBPrice.value) : level.triggerPrice;
        const deviationCheck = checkPriceDeviation(priceForDeviation, marketPrice, type);
        
        if (!deviationCheck.needsConfirmation)
          return updateLevelConfirmed(type, index);

        // Store pending update info
        pendingLevelUpdate.value = {
          type,
          index,
          originalPrice
        };
        
        // Set modal data
        priceDeviationMessage.value = deviationCheck.isBuyOrder 
          ? `Your buy price is ${deviationCheck.deviation}% higher than the current market price. Are you sure you want to set this level?`
          : `Your sell price is ${deviationCheck.deviation}% lower than the current market price. Are you sure you want to set this level?`;
        
        priceDeviationDetails.value = {
          marketPrice: limitPriceInDollars.value 
            ? `1 ${tokenA.value.symbol} = $${(marketPrice * tokenBPrice.value).toFixed(2)}`
            : `1 ${tokenA.value.symbol} = ${marketPrice.toFixed(6)} ${tokenB.value.symbol}`,
          userPrice: limitPriceInDollars.value 
            ? `1 ${tokenA.value.symbol} = $${level.triggerPrice.toFixed(2)}`
            : `1 ${tokenA.value.symbol} = ${level.triggerPrice.toFixed(6)} ${tokenB.value.symbol}`,
          deviation: deviationCheck.deviation
        };
        
        console.log('should show modal')
        showPriceDeviationModal.value = true;
        return; // Don't continue with update until confirmed
      }
    };
    
    const updateLevelConfirmed = (type, index) => {
      const levels = type === 'sell' ? sellLevels : buyLevels;
      const level = levels[index];
      
      // Update status based on inputs - reset status when user modifies level
      if (level.triggerPrice && level.balancePercentage) {
        // Reset status to allow reprocessing when user modifies level
        // BUT preserve 'processed' status - don't reset processed levels
        if (level.status === 'processed') {
          // Keep processed status - do nothing
        } else {
          level.status = 'active';
        }
      } else {
        // Even if invalid inputs, preserve processed status
        if (level.status !== 'processed') {
          console.log('set inactive')
          level.status = 'inactive';
        }
      }
            
      if (level.triggerPrice && level.balancePercentage)
        emitOrderUpdate();
    };

    const getLevelStatus = computed(() => (type, level) => {
      if (!level.triggerPrice || !level.balancePercentage) return 'Not set';
      if (isPaused.value) return 'Paused';
      
      // Check if level is being processed or has completed
      if (level.status === 'processing') return 'Processing';
      if (level.status === 'processed') return 'Processed';
      if (level.status === 'partially_filled') return 'Partial';
      if (level.status === 'failed') return 'Failed ✗';
      
      if (isCloseToTrigger(type, level)) return 'Close';
      if (level.status === 'active') return 'Active';
      return 'Waiting';
    });

    // Also update the getLevelStatusClass method
    const getLevelStatusClass = computed(() => (type, level) => {
      if (!level.triggerPrice || !level.balancePercentage) return 'status-inactive';
      if (isPaused.value) return 'status-paused';
      
      // Add new status classes
      if (level.status === 'processing') return 'status-processing';
      if (level.status === 'processed') return 'status-processed';
      if (level.status === 'partially_filled') return 'status-partially-filled';
      if (level.status === 'failed') return 'status-failed';
      

      if (isCloseToTrigger(type, level)) return 'status-close-trigger';
      if (level.status === 'active') return 'status-active';
      return 'status-waiting';
    });

    const emitOrderUpdate = () => {
      const orderData = {
        isPaused: isPaused.value,
        isRandomMode: isRandomMode.value,
        minimumAmount: minimumAmount.value,
        limitPriceInDollars: limitPriceInDollars.value,
        sellLevels: sellLevels.map((level, index) => ({
          ...level,
          index,
          type: 'sell',
        })),
        buyLevels: buyLevels.map((level, index) => ({
          ...level,
          index,
          type: 'buy',
        })),
      };
      
      emit('orderUpdate', orderData);
    };

    const cleanLevel = (level, index) => {
      level.triggerPrice = null;
      level.balancePercentage = null;
      level.status = 'inactive'; // Reset status when cleaning
      level.failedTxId = null;
      level.confirmedTxId = null;
      level.lastFailureDate = null;
      emitOrderUpdate();
    };

    const getUsdPrice = (triggerPrice) => {
      if (!triggerPrice || !tokenBPrice.value) return '0.00';
      const usdPrice = triggerPrice * tokenBPrice.value;
      return removeTrailingZeros(usdPrice, 4);
    };

    const getTokenPriceFromDollar = (dollarPrice) => {
      if (!dollarPrice || !tokenBPrice.value) return '0.00';
      const tokenPrice = dollarPrice / tokenBPrice.value;
      return removeTrailingZeros(tokenPrice, 7);
    };

    const getPercentageTooltip = (type, percentage) => {
      if (!percentage) return '';
      
      const tokenAddress = tokenA.value?.address?.toLowerCase();
      if (!tokenAddress || !props.balances[tokenAddress]) return '';
      
      const balance = props.balances[tokenAddress];
      const tokenAmount = (balance * percentage) / 100;
      const tokenSymbol = tokenA.value?.symbol || 'TOKEN';
      
      return `${percentage}% = ${removeTrailingZeros(tokenAmount, 6)} ${tokenSymbol}`;
    };

    watch(() => props.tokensByAddresses, (newTokens) => {
      if (newTokens[props.tokenA.address]) {
        props.tokenA.price = newTokens[props.tokenA.address].price;
      }
      if (newTokens[props.tokenB.address]) {
        props.tokenB.price = newTokens[props.tokenB.address].price;
      }
    }, { immediate: true, deep: true });
    
    // Watch for changes in details prop to update local levels
    watch(() => props.details, (newDetails) => {
      if (newDetails) {
        if (newDetails.sellLevels) {
          for (let i = 0; i < newDetails.sellLevels.length; i++) {
            // Update the reactive level object properties
            Object.assign(sellLevels[i], newDetails.sellLevels[i]);
          }
        }
        if (newDetails.buyLevels) {
          for (let i = 0; i < newDetails.buyLevels.length; i++) {
            // Update the reactive level object properties
            Object.assign(buyLevels[i], newDetails.buyLevels[i]);
          }
        }
        if (newDetails.isPaused !== undefined)
          isPaused.value = newDetails.isPaused
        if (newDetails.isRandomMode !== undefined)
          isRandomMode.value = newDetails.isRandomMode
        if (newDetails.minimumAmount !== undefined)
          minimumAmount.value = newDetails.minimumAmount
        if (newDetails.limitPriceInDollars !== undefined)
          limitPriceInDollars.value = newDetails.limitPriceInDollars
      }
    }, { deep: true });
    
    onMounted(() => {
      if (props.details) {
        if (props.details.sellLevels) {
          for (let i = 0; i < props.details.sellLevels.length; i++) {
            sellLevels[i] = props.details.sellLevels[i];
          }
        }
        if (props.details.buyLevels) {
          for (let i = 0; i < props.details.buyLevels.length; i++) {
            buyLevels[i] = props.details.buyLevels[i];
          }
        }
        if (props.details.isPaused)
          isPaused.value = true
        if (props.details.isRandomMode !== undefined)
          isRandomMode.value = props.details.isRandomMode
        if (props.details.minimumAmount !== undefined)
          minimumAmount.value = props.details.minimumAmount
        if (props.details.limitPriceInDollars !== undefined)
          limitPriceInDollars.value = props.details.limitPriceInDollars
      }
    });

    return {
      isPaused,
      isRandomMode,
      minimumAmount,
      sellLevels,
      buyLevels,
      currentMarketPrice,
      togglePause,
      updateLevel,
      updateLevelConfirmed,
      getLevelStatus,
      getLevelStatusClass,
      isCloseToTrigger,
      deleteImage,
      cleanLevel,
      removeTrailingZeros,
      getUsdPrice,
      getPercentageTooltip,
      emitOrderUpdate,
      
      // Dollar mode functions
      limitPriceInDollars,
      togglePriceUnit,
      getTokenPriceFromDollar,
      
      // Price deviation modal
      pendingLevelUpdate,
      showPriceDeviationModal,
      priceDeviationMessage,
      priceDeviationDetails,
      checkPriceDeviation,
      validateAgainstExistingOrders,
      confirmPriceDeviationUpdate,
      cancelPriceDeviationUpdate,
    };
  }
};
</script>

<style scoped>
.order-book-levels {
  border-right: 1px solid #eee;;
  border-left: 1px solid #eee;;
  padding: 0px; /* Reduced from 16px */
  background-color: #fafafa;
  width: 309px;
  flex-shrink: 0;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.address-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 6px;
  background-color: #f8f9fa;
  font-size: 11px;
}

.left-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.address-selection {
  display: flex;
  align-items: center;
  gap: 6px;
}

.price-unit-selection {
  display: flex;
  align-items: center;
  gap: 6px;
}

.slider-label {
  font-size: 10px;
  color: #666;
  font-weight: 500;
}

.middle-label {
  display: flex;
  align-items: center;
  width: 75px;
}

.higher-label {
  font-size: 10px;
  color: #666;
  font-weight: 500;
  white-space: nowrap;
}

.slider-label.left {
  margin-right: 2px;
}

.slider-label.right {
  margin-left: 2px;
}

.slider-toggle {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 18px;
}

.slider-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #4CAF50;
  transition: .3s;
  border-radius: 18px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 14px;
  width: 14px;
  left: 2px;
  bottom: 2px;
  background-color: white;
  transition: .3s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: #2196F3;
}

input:checked + .slider:before {
  transform: translateX(18px);
}

.minimum-amount {
  display: flex;
  align-items: center;
}

.amount-label {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: #666;
}

.min-amount-input {
  width: 70px;
  padding: 2px 4px;
  border: 1px solid #eee;
  border-radius: 3px;
  font-size: 10px;
  text-align: center;
}

.token-symbol {
  font-size: 9px;
  color: #888;
}

.control-btn {
  background: none;
  border: 2px solid #ccc;
  border-radius: 4px; /* Reduced from 6px */
  padding: 1px 4px; /* Reduced from 8px 12px */
  cursor: pointer;
  transition: all 0.2s;
  font-size: 14px; /* Reduced from 16px */
}

.order-book-levels .control-btn {
  display: none;
}
.order-book-levels:hover .control-btn {
  display: inline-block;
}

.pause-btn:hover {
  border-color: #c2a276;
  background-color: #f0f8ff;
}

.pause-btn.active {
  background-color: #ff9500;
  border-color: #ff7700;
  color: white;
}

.delete-btn:hover {
  border-color: #dc3545;
  background-color: #ffe6e6;
}

.token-pair {
  text-align: center;
  flex-grow: 1;
}

.token-name {
  font-size: 16px; /* Reduced from 20px */
  font-weight: 600;
  color: #333;
}

.market-price {
  text-align: center;
  background-color: #e8f4fd;
  border-radius: 4px; /* Reduced from 6px */
  border: 1px solid #b3d9ff;
  width: 80%;
  margin-right: auto;
  margin-left: auto;
}

.price-label {
  font-weight: 500;
  color: #555;
  margin-right: 6px; /* Reduced from 8px */
  font-size: 12px; /* Added smaller font */
}

.price-value {
  font-weight: 600;
  font-size: 18px;
  color: #333;
  font-family: monospace;
  font-size: 11px; /* Added smaller font */
}

.levels-container {
  display: flex; /* Changed from grid to flex */
  flex-direction: row; /* Stack vertically instead of side by side */
  width: 100%; /* Use full width instead of fixed 120px */
}

.column-title {
  text-align: center;
  margin: 0 0 8px 0; /* Reduced from 12px */
  padding: 6px; /* Reduced from 8px */
  border-radius: 4px; /* Reduced from 6px */
  font-size: 12px; /* Reduced from 14px */
  font-weight: 600;
}

.sell-title {
  background-color: #dc3545;
  color: white;
  border: 1px solid #dc3545;
}

.buy-title {
  background-color: #28a745;
  color: white;
  border: 1px solid #28a745;
}

.level-row {
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 0 3px 3px;
  margin-bottom: 0px;
  background-color: white;
  transition: all 0.3s ease;
  position: relative;
}

.sell-row {
  border-left: 3px solid #ff6b6b; /* Reduced from 4px */
}

.buy-row {
  border-left: 3px solid #4ecdc4; /* Reduced from 4px */
}

/* Bright background when close to trigger */
.sell-row.close-to-trigger {
  background-color: #ff47579c !important; /* Bright red */
  color: white;
  border-color: #ff3742;
  animation: pulse-red 2s infinite;
}

.buy-row.close-to-trigger {
  background-color: #2ed5739c !important; /* Bright green */
  color: white;
  border-color: #1dd565;
  animation: pulse-green 2s infinite;
}

.close-to-trigger .input-group span {
  color: white !important;
  font-weight: 600;
}

.close-to-trigger .percentage-symbol {
  color: white !important;
}

.close-to-trigger .price-input,
.close-to-trigger .percentage-input {
  background-color: rgba(255, 255, 255, 0.9);
  border-color: rgba(255, 255, 255, 0.7);
  font-weight: 600;
}

.price-input {
  width: 50px;
}

@keyframes pulse-red {
  0% {
    box-shadow: 0 0 10px rgba(255, 71, 87, 0.5);
  }
  50% {
    box-shadow: 0 0 20px rgba(255, 71, 87, 0.8);
  }
  100% {
    box-shadow: 0 0 10px rgba(255, 71, 87, 0.5);
  }
}

@keyframes pulse-green {
  0% {
    box-shadow: 0 0 10px rgba(46, 213, 115, 0.5);
  }
  50% {
    box-shadow: 0 0 20px rgba(46, 213, 115, 0.8);
  }
  100% {
    box-shadow: 0 0 10px rgba(46, 213, 115, 0.5);
  }
}

.level-inputs {
  display: flex;
  flex-direction: column;
}

.input-group {
  display: flex;
  align-items: center;
  gap: 1px; /* Reduced from 8px */
  margin-left: auto;
  margin-right: auto;
  flex-wrap: nowrap;
  min-width: 145px;
}

.input-group span {
  font-weight: 500;
  font-size: 11px; /* Reduced from 12px */
}

.price-input {
  flex: 1;
  padding: 1px;
  border: 1px solid #eee;
  border-radius: 3px; /* Reduced from 4px */
  font-size: 12px; /* Reduced from 14px */
  transition: all 0.2s ease;
  text-align: center;
  max-width: 65px;
}

.price-input:focus, .percentage-input:focus {
  outline: none;
  border-color: #007bff;
  box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
}

.percentage-input {
  max-width: 50px; /* Reduced from 60px */
}

.percentage-symbol {
  font-weight: 500;
  color: #666;
  font-size: 11px; /* Added smaller font */
}

.level-status {
  padding: 3px 6px; /* Reduced from 4px 8px */
  margin-bottom: 2px;
  margin-left: -8px;
  border-radius: 3px; /* Reduced from 4px */
  text-align: center;
  font-size: 10px; /* Reduced from 12px */
  font-weight: 500;
  transition: all 0.3s ease;
  width: 30%;
}

.level-status-inline {
  padding: 2px 4px;
  margin-left: auto;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 500;
  transition: all 0.3s ease;
  display: inline-block;
}

.usd-price {
  font-size: 10px;
  color: #666;
  font-weight: 500;
}

.token-price-below {
  font-size: 10px;
  color: #666;
  font-weight: 500;
}

.secondary-price {
  text-align: center;
  margin-top: 2px;
  font-size: 9px;
  color: #666;
  font-weight: 500;
}

.status-inactive {
  background-color: #f8f9fa;
  color: #6c757d;
  border: 1px solid #dee2e6;
}

.status-waiting {
  background-color: #cdcfff;
  color: #1e7cc4;
  border: 1px solid #cdcfff;
}

.status-active {
  background-color: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.status-paused {
  background-color: #dca380;
  color: #d17b45;
  border: 1px solid #f5c6cb;
}

.status-close-trigger {
  background-color: #91c97e !important;
  color: #212529 !important;
  border: 1px solid #91c97e !important;
  font-weight: 700 !important;
  animation: blink 1s infinite;
}

@keyframes blink {
  0%, 50% {
    opacity: .95;
  }
  51%, 100% {
    opacity: 0.8;
  }
}

.price-input::-webkit-outer-spin-button,
.price-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.price-input[type=number] {
  -moz-appearance: textfield;
}

/* Hide spinners for percentage inputs */
input.percentage-input::-webkit-outer-spin-button,
input.percentage-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

input.percentage-input[type=number] {
  -moz-appearance: textfield;
}

/* Style the percentage input to make spinners more visible */
input.percentage-input {
  border: 1px solid #eee;
  width: 25px;
  border-radius: 4px;
  text-align: center;
  margin-left: 2px;
}
.first-part-price {
  width: 35px;
}

.token-price {
  color: #666;
  font-size: 12px;
}

.level-row .delete {
  display: none;
  width: 20px;
}

.level-row:hover .delete {
  width: 15px;
  height: 15px;
  display: inline-block;
  position: absolute;
  top: 30px;
  right: 3px;
  cursor: pointer;
}
.status-invalid {
  background-color: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
  font-weight: 600;
}

.price-input.invalid {
  border-color: #dc3545 !important;
  background-color: rgba(255, 230, 230, 0.7) !important;
}

.status-processing {
  background-color: #8bff07;
  color: #212529;
  border: 1px solid #07ff5a;
  font-weight: 600;
}

.status-processed {
  background-color: #28a745;
  color: white;
  border: 1px solid #28a745;
  font-weight: 600;
}

.status-failed {
  background-color: #dc3545;
  color: white;
  border: 1px solid #dc3545;
  font-weight: 600;
}

.status-partially-filled {
  background-color: #fd7e14;
  color: white;
  border: 1px solid #fd7e14;
  font-weight: 600;
  animation: pulse-orange 1.5s infinite;
}

@keyframes pulse-yellow {
  0% {
    box-shadow: 0 0 10px rgba(255, 193, 7, 0.5);
  }
  50% {
    box-shadow: 0 0 20px rgba(255, 193, 7, 0.8);
  }
  100% {
    box-shadow: 0 0 10px rgba(255, 193, 7, 0.5);
  }
}

@keyframes pulse-orange {
  0% {
    box-shadow: 0 0 10px rgba(253, 126, 20, 0.5);
  }
  50% {
    box-shadow: 0 0 20px rgba(253, 126, 20, 0.8);
  }
  100% {
    box-shadow: 0 0 10px rgba(253, 126, 20, 0.5);
  }
}

.slider-selected {
  font-weight: 700;
}
</style>