<!-- GasPrice.vue -->
<template>
  <div class="gas-price-container">
    <!-- Display the formatted gas price (in gwei) -->
    <span :class="{'high-gas': maxGasPrice * 1000000000 < Number(gasPrice?.toString()) }">currently {{ formattedGasPrice }} gwei</span>
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted, computed, toRaw } from 'vue';
import { ethers } from 'ethers';

export default {
  name: 'GasPrice',
  props: {
    pollInterval: {
      type: Number,
      default: 10000,
    },
    maxGasPrice: {
      type: Number,
      default: 3,
    },
    provider: {
      type: Object,
    }
  },
  emits: ['update:gasPrice'],
  setup(props, { emit }) {
    // Reactive variable to store the fetched gas price (in wei as a BigNumber)
    const gasPrice = ref(null);

    // Function to fetch the current gas price from the blockchain
    async function fetchGasPrice() {
      try {
        const feeData = await toRaw(props.provider).getFeeData();
        // Extract the current gas price from the feeData object
        const currentGasPrice = feeData.gasPrice;
        // Update our reactive variable with the fetched gas price
        gasPrice.value = currentGasPrice;
        emit('update:gasPrice', currentGasPrice.toString());
      } catch (error) {
        // Log any errors during fetch
        console.error('Error fetching gas price:', error);
      }
    }

    let intervalId = null;
    onMounted(() => {
      if (intervalId) return;

      fetchGasPrice();
      // Set an interval to repeatedly fetch the gas price
      intervalId = setInterval(fetchGasPrice, props.pollInterval);
    });

    // Clear the polling interval when the component is unmounted to avoid memory leaks
    onUnmounted(() => {
      clearInterval(intervalId);
    });

    // Computed property to format the gas price from wei to gwei for display
    const formattedGasPrice = computed(() => {
      if (gasPrice.value) {
        // formatUnits converts the BigNumber value from wei to gwei
        return ethers.utils.formatUnits(gasPrice.value, 'gwei').substring(0, 6);
      }
      // Return a placeholder while the gas price is being fetched
      return '...';
    });

    // Return the reactive and computed variables to the template
    return {
      formattedGasPrice,
      gasPrice,
    };
  },
};
</script>

<style scoped>
/* Basic styling for the gas price display component */
.gas-price-container {
  display: block;
  text-align: center;
  padding: 5px;
  color: #555;
  margin-left: 10px;
  font-size: 0.9em;
}

.high-gas {
  font-weight: 700;
  color: red;
  font-size: 15px;
}
</style>  