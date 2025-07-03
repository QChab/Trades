<template>
  <div class="order-book-levels">
    <!-- Header with controls -->
    <div class="header">
      <button 
        @click="togglePause" 
        class="control-btn pause-btn"
        :class="{ active: isPaused }"
      >
        {{ isPaused ? '▶️' : '⏸️' }}
      </button>
      
      <div class="token-pair">
        <span class="token-name">{{ tokenB?.symbol }}</span>
        <span class="token-price">@ ${{ removeTrailingZeros(tokenB?.price, 8) }}</span>
      </div>
      
      <button 
        @click="$emit('delete')" 
        class="control-btn delete-btn"
      >
        🗑️
      </button>
    </div>

    <!-- Current market price -->
    <div class="market-price">
      <span class="price-value">1 {{ tokenA?.symbol }} = {{ currentMarketPrice.toFixed(7) }} {{ tokenB?.symbol }}</span>
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
          <div class="level-inputs">
            <img :src="deleteImage" class="delete" @click="cleanLevel(level, index)" />
            <label class="input-group">
              <span class="first-part-price">{{ tokenA?.symbol }} ≤ </span>
              <input
                v-model.number="level.triggerPrice"
                @input="updateLevel('buy', index)"
                type="number"
                step="0.000001"
                placeholder="0.0"
                class="price-input"
              />
              <span class="second-part-price">{{ tokenB?.symbol }}</span>
              <span v-if="level.triggerPrice" class="usd-price">${{ getUsdPrice(level.triggerPrice) }}</span>
            </label>
            <label class="input-group">
              Buy
              <input
                v-model.number="level.balancePercentage"
                @input="updateLevel('buy', index)"
                type="number"
                min="0"
                max="100"
                step="1"
                placeholder="0"
                class="percentage-input"
                :title="getPercentageTooltip('buy', level.balancePercentage)"
              />
              <span class="percentage-symbol">%</span>
              <span class="level-status-inline" :class="getLevelStatusClass('buy', level)">
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
            <img :src="deleteImage" class="delete" @click="cleanLevel(level, index)" />
            <label class="input-group">
              <span class="first-part-price">{{ tokenA?.symbol }} ≥ </span>
              <input
                v-model.number="level.triggerPrice"
                @input="updateLevel('sell', index)"
                type="number"
                step="0.000001"
                placeholder="0.0"
                class="price-input"
              />
              <span class="second-part-price">{{ tokenB?.symbol }}</span>
              <span v-if="level.triggerPrice" class="usd-price">${{ getUsdPrice(level.triggerPrice) }}</span>
            </label>
            <label class="input-group">
              Sell
              <input
                v-model.number="level.balancePercentage"
                @input="updateLevel('sell', index)"
                type="number"
                min="0"
                max="100"
                step="1"
                placeholder="0"
                class="percentage-input"
                :title="getPercentageTooltip('sell', level.balancePercentage)"
              />
              <span class="percentage-symbol">%</span>
              <span class="level-status-inline" :class="getLevelStatusClass('sell', level)">
                {{ getLevelStatus('sell', level) }}
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, reactive, computed, watch, onMounted, toRefs } from 'vue';
import deleteImage from '@/../assets/delete.svg';

export default {
  name: 'OrderBookLevels',
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
      
      if (!priceA || !priceB) {
        console.log('Cannot calculate market price - missing prices', { priceA, priceB });
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
      
      const marketPrice = currentMarketPrice.value;
      if (!marketPrice || marketPrice <= 0) return false;
      
      const priceDifference = Math.abs(marketPrice - level.triggerPrice) / level.triggerPrice;
      return priceDifference <= props.priceThreshold;
    };

    const togglePause = () => {
      isPaused.value = !isPaused.value;
      emitOrderUpdate();
    };
    
    const isPriceValid = (type, price) => {
      if (price === null) return true; // No price entered yet
      
      const marketPrice = currentMarketPrice.value;
      if (!marketPrice || marketPrice <= 0) return true; // Can't validate without market price
      
      if (type === 'buy') {
        // Buy level price shouldn't be higher than current market price
        return price <= marketPrice;
      } else {
        // Sell level price shouldn't be lower than current market price
        return price >= marketPrice;
      }
    };

    const updateLevel = (type, index) => {
      const levels = type === 'sell' ? sellLevels : buyLevels;
      const level = levels[index];
      
      // Validate inputs
      if (level.triggerPrice < 0) level.triggerPrice = 0;
      if (level.balancePercentage < 0) level.balancePercentage = 0;
      if (level.balancePercentage > 100) level.balancePercentage = 100;
      
      // Add price validity check
      level.priceValid = isPriceValid(type, level.triggerPrice);
      
      // Update status based on inputs
      updateLevelStatus(type, index);
      
      if (level.priceValid && level.balancePercentage)
        emitOrderUpdate();
    };

    const updateLevelStatus = (type, index) => {
      const levels = type === 'sell' ? sellLevels : buyLevels;
      const level = levels[index];
      
      if (!level.triggerPrice || !level.balancePercentage) {
        level.status = 'inactive';
        return;
      }
      
      if (isPaused.value) {
        level.status = 'paused';
        return;
      }
      
      // Check if price is valid
      if (!level.priceValid) {
        level.status = 'invalid';
        return;
      }
      
      // Check if price conditions are met
      const marketPrice = currentMarketPrice.value;
      
      if (type === 'sell') {
        // Sell when market price goes below trigger (stop loss) or above trigger (take profit)
        level.status = 'active';
      } else {
        // Buy when market price goes above trigger (momentum) or below trigger (dip buying)
        level.status = 'active';
      }
    };

    const getLevelStatus = (type, level) => {
      if (!level.triggerPrice || !level.balancePercentage) return 'Not set';
      if (isPaused.value) return 'Paused';
      
      // Check if level is being processed or has completed
      if (level.status === 'processing') return 'Processing...';
      if (level.status === 'processed') return 'Processed ✓';
      if (level.status === 'failed') return 'Failed ✗';
      
      // Check price validity
      if (level.triggerPrice !== null && !isPriceValid(type, level.triggerPrice)) {
        if (type === 'buy') {
          return 'lower?';
        } else {
          return 'higher?';
        }
      }
      
      if (level.status === 'active') return 'Active';
      if (level.status === 'triggered') return 'Triggered';
      if (isCloseToTrigger(type, level)) return 'Close';
      return 'Waiting';
    };

    // Also update the getLevelStatusClass method
    const getLevelStatusClass = (type, level) => {
      if (!level.triggerPrice || !level.balancePercentage) return 'status-inactive';
      if (isPaused.value) return 'status-paused';
      
      // Add new status classes
      if (level.status === 'processing') return 'status-processing';
      if (level.status === 'processed') return 'status-processed';
      if (level.status === 'failed') return 'status-failed';
      
      // Check price validity
      if (level.triggerPrice !== null && !isPriceValid(type, level.triggerPrice)) {
        return 'status-invalid';
      }
      
      if (level.status === 'active') return 'status-active';
      if (level.status === 'triggered') return 'status-triggered';
      if (isCloseToTrigger(type, level)) return 'status-close-trigger';
      return 'status-waiting';
    };

    const emitOrderUpdate = () => {
      const orderData = {
        isPaused: isPaused.value,
        sellLevels: sellLevels.map((level, index) => ({
          ...level,
          index,
          type: 'sell',
          priceValid: isPriceValid('sell', level.triggerPrice),
          isValid: !!(level.triggerPrice && level.balancePercentage && isPriceValid('sell', level.triggerPrice))
        })),
        buyLevels: buyLevels.map((level, index) => ({
          ...level,
          index,
          type: 'buy',
          priceValid: isPriceValid('buy', level.triggerPrice),
          isValid: !!(level.triggerPrice && level.balancePercentage && isPriceValid('buy', level.triggerPrice))
        })),
      };
      
      emit('orderUpdate', orderData);
    };

    const cleanLevel = (level, index) => {
      level.triggerPrice = null;
      level.balancePercentage = null;
      level.priceValid = true; // Reset price validity
      updateLevelStatus('sell', index);
      updateLevelStatus('buy', index);
      emitOrderUpdate();
    };

    const getUsdPrice = (triggerPrice) => {
      if (!triggerPrice || !tokenBPrice.value) return '0.00';
      const usdPrice = triggerPrice * tokenBPrice.value;
      return removeTrailingZeros(usdPrice, 4);
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
    
    onMounted(() => {
      if (props.details) {
        if (props.details.sellLevels) {
          for (let i = 0; i < props.details.sellLevels.length; i++) {
            sellLevels[i] = props.details.sellLevels[i];
            sellLevels[i].priceValid = isPriceValid('sell', sellLevels[i].triggerPrice);
          }
        }
        if (props.details.buyLevels) {
          for (let i = 0; i < props.details.buyLevels.length; i++) {
            buyLevels[i] = props.details.buyLevels[i];
            buyLevels[i].priceValid = isPriceValid('buy', buyLevels[i].triggerPrice);
          }
        }
        if (props.details.isPaused)
          isPaused.value = true
      }
      
      // Initialize all rows
      sellLevels.forEach((level, index) => updateLevelStatus('sell', index));
      buyLevels.forEach((level, index) => updateLevelStatus('buy', index));
    });

    // Watch for market price changes to update price validity
    watch(
      () => currentMarketPrice.value,
      () => {
        // Update all price validations when market price changes
        sellLevels.forEach((level, index) => {
          level.priceValid = isPriceValid('sell', level.triggerPrice);
          updateLevelStatus('sell', index);
        });
        buyLevels.forEach((level, index) => {
          level.priceValid = isPriceValid('buy', level.triggerPrice);
          updateLevelStatus('buy', index);
        });
      }
    );

    return {
      isPaused,
      sellLevels,
      buyLevels,
      currentMarketPrice,
      togglePause,
      updateLevel,
      getLevelStatus,
      getLevelStatusClass,
      isCloseToTrigger,
      deleteImage,
      cleanLevel,
      removeTrailingZeros,
      getUsdPrice,
      getPercentageTooltip,
    };
  }
};
</script>

<style scoped>
.order-book-levels {
  border: 2px solid #ddd;
  border-right: 1px solid #eee;;
  border-left: 1px solid #eee;;
  padding: 0px; /* Reduced from 16px */
  background-color: #fafafa;
  width: 309px;
  flex-shrink: 0;
  min-height: 250px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
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
  padding: 0 8px 8px;
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
  flex-wrap: wrap;
  min-width: 135px;
}

.input-group span {
  font-weight: 500;
  font-size: 11px; /* Reduced from 12px */
}

.price-input {
  flex: 1;
  padding: 4px 6px; /* Reduced from 6px 8px */
  border: 1px solid #ccc;
  border-radius: 3px; /* Reduced from 4px */
  font-size: 12px; /* Reduced from 14px */
  transition: all 0.2s ease;
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
  margin-left: 4px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 500;
  transition: all 0.3s ease;
  display: inline-block;
}

.usd-price {
  font-size: 9px;
  color: #666;
  margin-left: 50px;
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

.status-triggered {
  background-color: #d1ecf1;
  color: #0c5460;
  border: 1px solid #bee5eb;
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

/* Keep spinners for percentage inputs - remove the previous rules that hid them */
input.percentage-input::-webkit-outer-spin-button,
input.percentage-input::-webkit-inner-spin-button {
  -webkit-appearance: auto !important; /* Show the spinners */
  margin: 0;
  height: 100%;
}

input.percentage-input[type=number] {
  appearance: auto !important; /* Show spinners in Firefox */
  -moz-appearance: auto !important; /* Show spinners in Firefox */
}

/* Style the percentage input to make spinners more visible */
input.percentage-input {
  max-width: 32px;
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
  background-color: #ffc107;
  color: #212529;
  border: 1px solid #ffc107;
  font-weight: 600;
  animation: pulse-yellow 1.5s infinite;
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
</style>