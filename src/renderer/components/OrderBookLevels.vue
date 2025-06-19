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
        <span class="token-price">@ ${{ tokenB?.price }}</span>
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
      <span class="price-value">1 {{ tokenA.symbol }} = {{ currentMarketPrice.toFixed(6) }} {{ tokenB?.symbol }}</span>
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
          <div class="level-status" :class="getLevelStatusClass('buy', level)">
            {{ getLevelStatus('buy', level) }}
          </div>
          <div class="level-inputs">
            <img :src="deleteImage" class="delete" @click="level.triggerPrice = null; level.balancePercentage = null;" />
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
              <span class="second-part-price">{{ tokenB?.symbol }} </span>
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
              />
              <span class="percentage-symbol">%</span>
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
          <div class="level-status" :class="getLevelStatusClass('sell', level)">
            {{ getLevelStatus('sell', level) }}
          </div>
          <div class="level-inputs">
            <img :src="deleteImage" class="delete" @click="level.triggerPrice = null; level.balancePercentage = null;" />
            <label class="input-group">
              <span class="first-part-price">{{ tokenA?.symbol }} ≥ </span>
              <input
                v-model.number="level.triggerPrice"
                @input="updateLevel('sell', index)"
                placeholder="0.0"
                class="price-input"
              />
              <span>{{ tokenB?.symbol }} </span>
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
              />
              <span class="percentage-symbol">%</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, reactive, computed, watch } from 'vue';
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
    }
  },
  emits: ['orderUpdate', 'delete'],
  setup(props, { emit }) {
    const isPaused = ref(false);
    
    // Initialize 3 sell levels and 3 buy levels
    const sellLevels = reactive([
      { triggerPrice: null, balancePercentage: null },
      { triggerPrice: null, balancePercentage: null },
      { triggerPrice: null, balancePercentage: null  }
    ]);
    
    const buyLevels = reactive([
      { triggerPrice: null, balancePercentage: null },
      { triggerPrice: null, balancePercentage: null },
      { triggerPrice: null, balancePercentage: null  }
    ]);

    // Calculate current market price
    const currentMarketPrice = computed(() => {
      if (!props.tokenA?.price || !props.tokenB?.price) return 0;
      return props.tokenA.price / props.tokenB.price;
    });

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

    const updateLevel = (type, index) => {
      const levels = type === 'sell' ? sellLevels : buyLevels;
      const level = levels[index];
      
      // Validate inputs
      if (level.triggerPrice < 0) level.triggerPrice = 0;
      if (level.balancePercentage < 0) level.balancePercentage = 0;
      if (level.balancePercentage > 100) level.balancePercentage = 100;
      
      // Update status based on inputs
      updateLevelStatus(type, index);
      
      // Emit the update
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
      if (level.status === 'active') return 'Active';
      if (level.status === 'triggered') return 'Triggered';
      if (isCloseToTrigger(type, level)) return 'Close';
      return 'Waiting';
    };

    const getLevelStatusClass = (type, level) => {
      if (!level.triggerPrice || !level.balancePercentage) return 'status-inactive';
      if (isPaused.value) return 'status-paused';
      if (level.status === 'active') return 'status-active';
      if (level.status === 'triggered') return 'status-triggered';
      if (isCloseToTrigger(type, level)) return 'status-close-trigger';
      return 'status-waiting';
    };

    const emitOrderUpdate = () => {
      const orderData = {
        tokenPair: {
          tokenA: props.tokenA,
          tokenB: props.tokenB
        },
        isPaused: isPaused.value,
        senderAddress: props.senderAddress,
        sellLevels: sellLevels.map((level, index) => ({
          ...level,
          index,
          type: 'sell',
          isValid: !!(level.triggerPrice && level.balancePercentage)
        })),
        buyLevels: buyLevels.map((level, index) => ({
          ...level,
          index,
          type: 'buy',
          isValid: !!(level.triggerPrice && level.balancePercentage)
        })),
        currentMarketPrice: currentMarketPrice.value
      };
      
      emit('orderUpdate', orderData);
    };

    // Watch for token price changes to update status
    watch(
      () => [props.tokenA?.price, props.tokenB?.price],
      () => {
        // Update all level statuses when market price changes
        sellLevels.forEach((_, index) => updateLevelStatus('sell', index));
        buyLevels.forEach((_, index) => updateLevelStatus('buy', index));
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
    };
  }
};
</script>

<style scoped>
.order-book-levels {
  border: 2px solid #ddd;
  border-right: 1px solid #eee;;
  border-left: 1px solid #eee;;
  padding: 6px; /* Reduced from 16px */
  background-color: #fafafa;
  width: 310px;
  flex-shrink: 0;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #eee;
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
  box-shadow: 0 0 10px rgba(255, 71, 87, 0.5); /* Reduced shadow */
  animation: pulse-red 2s infinite;
}

.buy-row.close-to-trigger {
  background-color: #2ed5739c !important; /* Bright green */
  color: white;
  border-color: #1dd565;
  box-shadow: 0 0 10px rgba(46, 213, 115, 0.5); /* Reduced shadow */
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
  gap: 4px; /* Reduced from 8px */
  margin-left: auto;
  margin-right: auto;
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

.status-inactive {
  background-color: #f8f9fa;
  color: #6c757d;
  border: 1px solid #dee2e6;
}

.status-waiting {
  background-color: #cdcfff;
  color: #9ebbd1;
  border: 1px solid #ffeaa7;
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
  max-width: 60px; /* Increased from 50px to accommodate spinners */
  padding-right: 2px; /* Less padding on right to make room for spinners */
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
  top: 3px;
  right: 3px;
  cursor: pointer;
}
</style>