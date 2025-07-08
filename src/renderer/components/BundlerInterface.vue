<template>
  <div class="bundler-interface">
    <div class="bundler-header">
      <h3>MEV Protection Bundler</h3>
      <div class="bundler-status">
        <span v-if="!bundlerAddress" class="status-inactive">
          No bundler deployed
        </span>
        <span v-else class="status-active">
          Bundler: {{ shortenAddress(bundlerAddress) }}
          <span class="copy-icon" @click="copyAddress(bundlerAddress)">📋</span>
        </span>
      </div>
    </div>

    <div v-if="!bundlerAddress" class="deploy-section">
      <button 
        @click="deployBundler" 
        :disabled="isDeploying"
        class="deploy-button"
      >
        {{ isDeploying ? 'Deploying...' : 'Deploy Personal Bundler' }}
      </button>
      <p class="deploy-info">
        Deploy your own bundler contract for MEV-protected trades.
        Estimated cost: ~$30-50
      </p>
    </div>

    <div v-else class="bundler-details">
      <!-- Balances Section -->
      <div class="balances-section">
        <h4>Bundler Balances</h4>
        <div v-if="balances.length === 0" class="no-balances">
          No tokens in bundler
        </div>
        <ul v-else class="balance-list">
          <li v-for="item in balances" :key="item.token.address">
            <span class="token-symbol">{{ item.token.symbol }}</span>
            <span class="token-balance">{{ item.formatted }}</span>
            <button 
              v-if="item.balance.gt(0)"
              @click="withdrawToken(item.token)"
              class="withdraw-btn"
            >
              Withdraw
            </button>
          </li>
        </ul>
      </div>

      <!-- Approvals Section -->
      <div class="approvals-section">
        <h4>DEX Approvals</h4>
        <button 
          @click="checkAndSetupApprovals"
          :disabled="isSettingApprovals"
          class="approve-button"
        >
          {{ isSettingApprovals ? 'Setting up...' : 'Setup All Approvals' }}
        </button>
        <div v-if="approvalStatus" class="approval-status">
          {{ approvalStatus }}
        </div>
      </div>

      <!-- Bundle Execution -->
      <div v-if="hasPendingTrades" class="bundle-execution">
        <h4>Bundle Execution</h4>
        <div class="bundle-info">
          <p>{{ pendingTrades.length }} trades ready for bundling</p>
          <p class="gas-savings">Estimated gas savings: ~{{ estimatedGasSavings }}%</p>
        </div>
        <button 
          @click="executeBundledTrades"
          :disabled="isExecuting"
          class="execute-button"
        >
          {{ isExecuting ? 'Executing...' : 'Execute Bundle' }}
        </button>
      </div>
    </div>

    <!-- Transaction Status -->
    <div v-if="txStatus" class="tx-status" :class="txStatusClass">
      {{ txStatus }}
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, watch } from 'vue';
import { ethers } from 'ethers';
import { BundlerManager } from '../bundler/BundlerManager';

export default {
  name: 'BundlerInterface',
  props: {
    signer: Object,
    provider: Object,
    currentAddress: String,
    tokens: Array,
    pendingTrades: Array
  },
  setup(props) {
    const bundlerManager = ref(null);
    const bundlerContract = ref(null);
    const bundlerAddress = ref(null);
    const balances = ref([]);
    const isDeploying = ref(false);
    const isSettingApprovals = ref(false);
    const isExecuting = ref(false);
    const txStatus = ref('');
    const txStatusClass = ref('');
    const approvalStatus = ref('');

    const hasPendingTrades = computed(() => props.pendingTrades && props.pendingTrades.length > 0);
    const estimatedGasSavings = computed(() => {
      if (!props.pendingTrades || props.pendingTrades.length < 2) return 0;
      // Rough estimate: 20-30% savings for bundling
      return 20 + Math.min(props.pendingTrades.length * 3, 10);
    });

    const shortenAddress = (addr) => {
      return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
    };

    const copyAddress = async (addr) => {
      await navigator.clipboard.writeText(addr);
      showStatus('Address copied!', 'success');
    };

    const showStatus = (message, type = 'info') => {
      txStatus.value = message;
      txStatusClass.value = `status-${type}`;
      setTimeout(() => {
        txStatus.value = '';
        txStatusClass.value = '';
      }, 5000);
    };

    const deployBundler = async () => {
      try {
        isDeploying.value = true;
        showStatus('Deploying bundler contract...', 'info');
        
        bundlerContract.value = await bundlerManager.value.deployBundler();
        bundlerAddress.value = bundlerContract.value.address;
        
        showStatus('Bundler deployed successfully!', 'success');
        await refreshBalances();
      } catch (error) {
        console.error('Deploy error:', error);
        showStatus(`Deploy failed: ${error.message}`, 'error');
      } finally {
        isDeploying.value = false;
      }
    };

    const checkAndSetupApprovals = async () => {
      try {
        isSettingApprovals.value = true;
        approvalStatus.value = 'Checking current approvals...';
        
        await bundlerManager.value.setupApprovals(bundlerContract.value, props.tokens);
        
        approvalStatus.value = 'All approvals set!';
        showStatus('DEX approvals configured', 'success');
      } catch (error) {
        console.error('Approval error:', error);
        approvalStatus.value = 'Approval setup failed';
        showStatus(`Approval failed: ${error.message}`, 'error');
      } finally {
        isSettingApprovals.value = false;
      }
    };

    const refreshBalances = async () => {
      if (!bundlerContract.value) return;
      
      try {
        const tokenList = [
          { address: ethers.constants.AddressZero, symbol: 'ETH', decimals: 18 },
          ...props.tokens
        ];
        
        balances.value = await bundlerManager.value.getBundlerBalances(
          bundlerContract.value,
          tokenList
        );
      } catch (error) {
        console.error('Balance refresh error:', error);
      }
    };

    const withdrawToken = async (token) => {
      try {
        showStatus(`Withdrawing ${token.symbol}...`, 'info');
        await bundlerManager.value.emergencyWithdraw(bundlerContract.value, token);
        showStatus(`${token.symbol} withdrawn successfully`, 'success');
        await refreshBalances();
      } catch (error) {
        console.error('Withdraw error:', error);
        showStatus(`Withdraw failed: ${error.message}`, 'error');
      }
    };

    const executeBundledTrades = async () => {
      try {
        isExecuting.value = true;
        showStatus('Executing bundled trades...', 'info');
        
        // First, transfer required tokens to bundler
        for (const trade of props.pendingTrades) {
          if (trade.fromToken.address !== ethers.constants.AddressZero) {
            await bundlerManager.value.transferToBundler(
              bundlerContract.value,
              trade.fromToken,
              trade.fromAmount
            );
          }
        }
        
        // Execute bundle
        const results = await bundlerManager.value.executeBundledTrades(
          bundlerContract.value,
          props.pendingTrades
        );
        
        const successCount = results.filter(r => r.success).length;
        showStatus(`Bundle executed: ${successCount}/${results.length} trades successful`, 'success');
        
        await refreshBalances();
        
        // Emit event for parent component
        emit('bundleExecuted', results);
      } catch (error) {
        console.error('Bundle execution error:', error);
        showStatus(`Execution failed: ${error.message}`, 'error');
      } finally {
        isExecuting.value = false;
      }
    };

    // Initialize
    onMounted(async () => {
      if (props.signer && props.provider) {
        bundlerManager.value = new BundlerManager(props.provider, props.signer);
        
        // Check for existing bundler
        const existing = await bundlerManager.value.getBundler(props.currentAddress);
        if (existing) {
          bundlerContract.value = existing;
          bundlerAddress.value = existing.address;
          await refreshBalances();
        }
      }
    });

    // Watch for address changes
    watch(() => props.currentAddress, async (newAddress) => {
      if (newAddress && bundlerManager.value) {
        const existing = await bundlerManager.value.getBundler(newAddress);
        if (existing) {
          bundlerContract.value = existing;
          bundlerAddress.value = existing.address;
        } else {
          bundlerContract.value = null;
          bundlerAddress.value = null;
        }
        await refreshBalances();
      }
    });

    return {
      bundlerAddress,
      balances,
      isDeploying,
      isSettingApprovals,
      isExecuting,
      txStatus,
      txStatusClass,
      approvalStatus,
      hasPendingTrades,
      estimatedGasSavings,
      shortenAddress,
      copyAddress,
      deployBundler,
      checkAndSetupApprovals,
      refreshBalances,
      withdrawToken,
      executeBundledTrades
    };
  }
};
</script>

<style scoped>
.bundler-interface {
  background: #1e1e1e;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 20px;
  margin: 20px 0;
}

.bundler-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.bundler-header h3 {
  margin: 0;
  color: #fff;
}

.bundler-status {
  font-size: 14px;
}

.status-inactive {
  color: #888;
}

.status-active {
  color: #4CAF50;
}

.copy-icon {
  cursor: pointer;
  margin-left: 5px;
}

.deploy-section {
  text-align: center;
  padding: 30px 0;
}

.deploy-button {
  background: #4CAF50;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 4px;
  font-size: 16px;
  cursor: pointer;
  transition: background 0.3s;
}

.deploy-button:hover:not(:disabled) {
  background: #45a049;
}

.deploy-button:disabled {
  background: #555;
  cursor: not-allowed;
}

.deploy-info {
  color: #888;
  font-size: 14px;
  margin-top: 10px;
}

.bundler-details {
  display: grid;
  gap: 20px;
}

.balances-section,
.approvals-section,
.bundle-execution {
  background: #2a2a2a;
  padding: 15px;
  border-radius: 4px;
}

.balances-section h4,
.approvals-section h4,
.bundle-execution h4 {
  margin: 0 0 15px 0;
  color: #fff;
}

.balance-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.balance-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #333;
}

.balance-list li:last-child {
  border-bottom: none;
}

.token-symbol {
  color: #fff;
  font-weight: bold;
}

.token-balance {
  color: #4CAF50;
}

.withdraw-btn {
  background: #ff5722;
  color: white;
  border: none;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.approve-button,
.execute-button {
  background: #2196F3;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 4px;
  cursor: pointer;
  width: 100%;
}

.approve-button:hover:not(:disabled),
.execute-button:hover:not(:disabled) {
  background: #1976D2;
}

.approval-status {
  margin-top: 10px;
  color: #888;
  font-size: 14px;
}

.bundle-info {
  background: #1e1e1e;
  padding: 10px;
  border-radius: 4px;
  margin-bottom: 10px;
}

.bundle-info p {
  margin: 5px 0;
  color: #ccc;
}

.gas-savings {
  color: #4CAF50;
}

.tx-status {
  margin-top: 20px;
  padding: 10px;
  border-radius: 4px;
  text-align: center;
}

.status-info {
  background: #2196F3;
  color: white;
}

.status-success {
  background: #4CAF50;
  color: white;
}

.status-error {
  background: #f44336;
  color: white;
}

.no-balances {
  color: #666;
  text-align: center;
  padding: 20px;
}
</style>