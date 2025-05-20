<template>
  <div class="transfer-history">
    <!-- Wrap the list in a transition-group to animate new items -->
    <transition-group name="transfer" tag="ul">
      <li v-for="(transfer, index) in transfers" :key="transfer.timestamp" @click="openTxDetails(transfer.txId)">
        {{ formatTimestamp(transfer.timestamp) }} | {{ transfer.amount }} {{ transfer.tokenSymbol ? transfer.tokenSymbol : transfer.token?.symbol }} from {{ transfer.fromAddress ? transfer.fromAddress : transfer.from }} to {{ transfer.toAddress ? transfer.toAddress : transfer.to }}
      </li>
    </transition-group>
  </div>
</template>

<script>
import { computed } from 'vue';

export default {
  name: 'TransferHistory',
  props: {
    transfers: {
      type: Array,
      default: () => []
    }
  },
  setup(props) {
    // Utility function to format UNIX timestamps.
    function formatTimestamp(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleString();
    }

    const openTxDetails = (txId) => {
      if (!txId) return;
      window.electronAPI.openURL('https://etherscan.io/tx/' + txId);
    }
    
    return { 
      formatTimestamp,
      openTxDetails,
    };
  }
};
</script>

<style scoped>
.transfer-history {
  padding: 10px;
  border-radius: 4px;
  overflow-y: auto;
}

ul {
  list-style-type: none;
  padding: 0;
  margin: 0;
}

li {
  padding: 5px 0;
  border-bottom: 1px solid #eee;
}


/* Transition classes for the transition-group */
.transfer-enter-active,
.transfer-leave-active,
.transfer-move {
  transition: all 0.5s ease;
}
.transfer-enter-from {
  opacity: 0;
  transform: translateY(-20px);
}
.transfer-enter-to {
  opacity: 1;
  transform: translateY(0);
}

</style>