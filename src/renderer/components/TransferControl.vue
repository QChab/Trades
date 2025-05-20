<template>
  <div class="transfer-control">
    <img class="absolute-right" :src="deleteImage" width="20px" @click="deleteHistory"/>
    <h2>Transfers</h2>
    <div class="button-group">
      <button 
        @click="isProcessStarted && !isProcessPaused ? pauseProcess() : (isProcessStarted ? resumeProcess() : startProcess())"
      >
        <img 
          v-if="isProcessStarted && !isProcessPaused" 
          width="20" 
          :src="pauseImage" 
          class="icon-line"
          alt="Pause"
        />
        <img 
          v-else 
          width="20" 
          :src="playImage" 
          class="icon-line"
          alt="Play"
        />
        <span>
          {{ isProcessStarted && !isProcessPaused ? 'Pause' : (isProcessStarted ? 'Resume' : 'Start' )}}
        </span>
      </button>
      <button 
        v-if="isProcessStarted" 
        @click="stopProcess"
      >
        <img width="20" :src="stopImage" class="icon-line" alt="Stop"/>
        <span>Stop</span>
      </button>
    </div>
    <div class="status-info">
      <span v-if="isProcessStarted" class="status">
        Status: {{ isProcessPaused ? 'Paused' : 'Running' }} {{ '(' + transferCount + '/' + currentDestinationAddresses.length + ')' }}
      </span>
      <span v-if="errorMessage" class="error-message">{{ errorMessage }}</span>
      <span v-if="warningMessages.length > 0" class="warning-message">Warnings: {{ warningMessages.join(' ;') }}</span>
      <span v-if="hasProcessSucceeded" class="success-message">
        Success: {{ transferCount }} transfers done
      </span>
    </div>
  </div>
</template>

<script>
import { reactive, ref, watch } from 'vue';
import pauseImage from '@/../assets/pause.svg';
import playImage from '@/../assets/play.svg';
import stopImage from '@/../assets/stop.svg';
import { Contract, isAddress } from 'ethers';
import provider from '@/ethersProvider';

import deleteImage from '@/../assets/delete.svg';

let processId = 0;

export default {
  name: 'TransferControl',
  props: {
    settings: {
      type: Object,
      default: {},
    },
    sourceAddresses: {
      type: Array,
      default: () => [],
    },
    destinationAddresses: {
      type: Array,
      default: () => [],
    },
    gasPrice: {
      type: Number,
      default: 1000000000,
    },
    maxGasPrice: {
      type: Number,
      default: 2000000000,
    },
    isTestMode: {
      type: Boolean,
      default: false,
    },
    infuraKeys: {
      type: Array,
      default: [],
    },
  },
  emits: ['sentTransfer', 'update:isProcessRunning', 'deleteHistory'],
  setup(props, { emit }) {
    const isProcessStarted = ref(false);
    const isProcessPaused = ref(false);
    const errorMessage = ref('');
    const warningMessages = reactive([]);
    const hasProcessSucceeded = ref(false);
    const transferCount = ref(0);

    // Save current settings and addresses on process start.
    const currentSettings = ref({});
    const currentSourceAddresses = ref([]);
    const currentDestinationAddresses = ref([]);

    const balanceOffsetByTokenByAddress = reactive({});

    function randomDelay() {
      if (!currentSettings.value.delayMax) throw new Error('Max delay between transfers not specified');
      let delay = Math.floor((Math.random() * (currentSettings.value.delayMax - currentSettings.value.delayMin) + currentSettings.value.delayMin) * 1000);
      if (props.isTestMode) return delay;

      if (delay < 2000) return 0;
      return delay - 2000;
    }
    
    async function sleep(ms) {
      console.log(`Sleeping ${ms}ms`);
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    const erc20Abi = [
      "function balanceOf(address) view returns (uint256)",
      "function decimals() view returns (uint256)",
    ];

    const getBalance = async (address, token) => {
      if (props.isTestMode) {
        return Math.floor(Math.random() * 60);
      }

      const contract = new Contract(token.address, erc20Abi, provider);
      if (!token.decimals)
        token.decimals = await contract.decimals();

      let balance = await contract.balanceOf(address);
      if (balance.toString() === "0") return 0;
      
      const balanceOffset = balanceOffsetByTokenByAddress[token.address] && balanceOffsetByTokenByAddress[token.address][address] ? balanceOffsetByTokenByAddress[token.address][address] : 0;
      balance = Number(balance) * Math.pow(10, -Number(token.decimals)) - balanceOffset;
      console.log("ERC20 balance:", Number(balance));
      return Number(balance);
    };

    const choseToken = async (count, address, minAmount) => {
      if (!currentSettings.value.tokens?.length) throw new Error('No tokens selected');
      let retries = 0;
      let balance = 0;

      // use for random choice
      const tokenIndexOffset = Math.floor(Math.random() * (currentSettings.value.tokens.length));
      // console.log({tokenIndexOffset});

      while ((balance === 0 || balance <= minAmount) && isProcessStarted.value) {
        while (isProcessStarted.value && isProcessPaused.value) await sleep(1000);
        if (!isProcessStarted.value) return false;

        if (currentSettings.value.isRandomToken) {
          if (++retries === currentSettings.value.tokens.length + 2) return undefined;
          const tokenIndex = (tokenIndexOffset + retries) % currentSettings.value.tokens.length;
          // console.log({tokenIndex, retries});
          const token = currentSettings.value.tokens[tokenIndex];
          console.log('trying ' + token.symbol + ' on ' + address);
          balance = await getBalance(address, token);
          if (balance === 0 || balance <= minAmount) continue;
          return { ...token, balance };
        } else {
          if (retries >= currentSettings.value.tokens.length) return undefined;
          const tokenIndex = ((count % currentSettings.value.tokens.length) + retries) % currentSettings.value.tokens.length;
          console.log('trying ' + tokenIndex);
          const token = currentSettings.value.tokens[tokenIndex];
          balance = await getBalance(address, token);
          if (balance === 0 || balance <= minAmount) {
            ++retries;
            continue;
          }
          return { ...token, balance };
        }
      }
    };

    const numericRegex = /^\d+(\.\d+)?$/;

    async function startProcess() {
      console.log('Starting process');
      warningMessages.length = 0;
      hasProcessSucceeded.value = false;
      transferCount.value = 0;
      errorMessage.value = '';
      currentSettings.value = { ...props.settings };
      currentSourceAddresses.value = [...props.sourceAddresses];
      currentDestinationAddresses.value = [...props.destinationAddresses];
      let transferFrom = '';

      try {
        if (!props.infuraKeys || props.infuraKeys.length === 0) throw new Error('No RPC');
        if (!props.gasPrice) throw new Error('No gas price found');
        if (!currentSettings.value.delayMax) throw new Error('No max delay found');
        if (!currentSettings.value.delayMin && currentSettings.value.delayMin !== 0) throw new Error('Invalid min delay');
        if (currentSettings.value.delayMin > currentSettings.value.delayMax) throw new Error('Max delay lower than min delay');

        if (!currentSettings.value.amounts?.length) throw new Error('No amounts selected');
        for (const amount of currentSettings.value.amounts) {
          if (amount.isRange) {
            if (typeof amount.min !== 'number') {
              if (typeof amount.min !== 'string') {
                throw new Error('Invalid min range amount selected');
              }
              if (!numericRegex.test(amount.min.trim()))
                throw new Error('Invalid min range amount selected');
            }
            if (typeof amount.max !== 'number') {
              if (typeof amount.max !== 'string') {
                throw new Error('Invalid max range amount selected');
              }
              if (!numericRegex.test(amount.max.trim()))
                throw new Error('Invalid max range amount selected');
            }
            if (amount.max < amount.min)
              throw new Error('Invalid amount range, max > min')
            continue;
          }
              
          if (typeof amount.value === 'number') continue;
          if (typeof amount.value !== 'string') {
            throw new Error('Invalid amount selected: ' + amount.value);
          }

          if (!numericRegex.test(amount.value.trim()))
            throw new Error('Invalid amount selected: '  + amount.value);
        }

        let minAmount = Number.MAX_SAFE_INTEGER;
        for (const amount of currentSettings.value.amounts) {
          if (amount.isRange) {
            if (minAmount >= amount.min) minAmount = amount.min;
            continue;
          }

          if (minAmount >= amount.value) minAmount = amount.value;
        }
        console.log({minAmount});
        
        if (isProcessStarted.value) throw new Error('Transfer process already started');
        
        if (!currentSourceAddresses.value.length) throw new Error('No source addresses')
        if (!currentDestinationAddresses.value.length) throw new Error('No destination addresses');

        const {success, addressWithoutPrivateKey, error} = await window.electronAPI.checkPrivateKeys([...currentSourceAddresses.value]);
        if (!success) throw new Error(error);
        if (addressWithoutPrivateKey) throw new Error('Missing private key for source address ' + addressWithoutPrivateKey);

        isProcessStarted.value = true;
        isProcessPaused.value = false;
        let sourceIndex = 0;
        let destinationIndex = 0;
        const myProcessId = ++processId;

        let consecutiveFailures = 0;
        while (isProcessStarted.value && destinationIndex < currentDestinationAddresses.value.length) {
          if (!props.infuraKeys || props.infuraKeys.length === 0) throw new Error('No RPC');
          if (myProcessId !== processId) {
            console.log('[startProcess] Detected a new process start. Exiting instance: ' + myProcessId);
            return false;
          }

          while (isProcessStarted.value && isProcessPaused.value) await sleep(1000);
          if (!isProcessStarted.value) return false;

          if (sourceIndex >= currentSourceAddresses.value.length) {
            sourceIndex = 0;
          }
          let sourceAddress = currentSourceAddresses.value[sourceIndex];
          if (!isAddress(sourceAddress)) throw new Error(`Source address ${sourceAddress} is not EVM compatible`);

          const token = await choseToken(transferCount.value, sourceAddress, minAmount);

          if (!token) {
            ++sourceIndex;
            console.log(`No token balance for ${sourceAddress}`);
            consecutiveFailures++;

            // If we've failed on all source addresses in one cycle, throw an error.
            if (consecutiveFailures >= (currentSourceAddresses.value?.length + 2))
              throw new Error('Cannot find remaining tokens on source addresses');
            continue;
          }

          console.log(token);
          while (isProcessStarted.value && isProcessPaused.value) await sleep(1000);
          if (!isProcessStarted.value) return false;

          const possibleAmounts = currentSettings.value.amounts.filter((amount) => !amount.isRange && amount.value <= token.balance);

          const rangeAmount = currentSettings.value.amounts.find((amount) => amount.isRange);
          if (rangeAmount) {
            if (!rangeAmount.min) rangeAmount.min = 0;
            if (rangeAmount.min <= token.balance) {
              if (rangeAmount.max <= token.balance) {
                possibleAmounts.push(rangeAmount);
              } else {
                possibleAmounts.push({ ...rangeAmount, max: token.balance });
              }
            }
          }
          if (possibleAmounts.length === 0) {
            ++sourceIndex;
            console.log(`No possible amount for ${sourceAddress}`);
            consecutiveFailures++;

            // If we've failed on all source addresses in one cycle, throw an error.
            if (consecutiveFailures >= (currentSourceAddresses.value?.length + 2))
              throw new Error('Cannot find remaining tokens on source addresses');
            continue;
          }

          const amountIndex = Math.floor(Math.random() * possibleAmounts.length);
          const chosenAmount = possibleAmounts[amountIndex];
          let amount;
          if (chosenAmount.isRange) {
            amount = Number((Math.random() * (Number(chosenAmount.max) - Number(chosenAmount.min)) + Number(chosenAmount.min))).toFixed(chosenAmount.decimals);
          } else {
            amount = chosenAmount.value;
          }

          let destinationAddress = currentDestinationAddresses.value[destinationIndex++];
          if (!isAddress(destinationAddress)) throw new Error(`Destination address ${destinationAddress} is not EVM compatible`);

          if (myProcessId !== processId) {
            console.log('[startProcess] Detected a new process start. Exiting instance: ' + myProcessId);
            return false;
          }

          const transfer = {
            from: sourceAddress,
            to: destinationAddress,
            amount,
            token,
            isTestMode: props.isTestMode,
          };
          transferFrom = transfer.from;

          while (isProcessStarted.value && isProcessPaused.value) await sleep(1000);
          if (!isProcessStarted.value) return false;

          if (currentSettings.value.maxGasPrice < props.gasPrice) {
            warningMessages.push('Gas price too high, pausing the transfers');
            isProcessPaused.value = true;
          }
          while (currentSettings.value.maxGasPrice < props.gasPrice) {
            await sleep(4000);
          }
          const indexOfWarning = warningMessages.indexOf('Gas price too high, pausing the transfers');
          if (indexOfWarning > -1) {
            warningMessages.splice(indexOfWarning, 1);
            isProcessPaused.value = false;
          }

          if (!props.infuraKeys || props.infuraKeys.length === 0) throw new Error('No RPC');
          const result = await sendTransfer(transfer);
          if (result.warnings) {
            warningMessages.push(...result.warnings);
          }
          if (!result.success)
            throw new Error(result.error);
          if (result.txId)
            transfer.txId = result.txId;
          
          consecutiveFailures = 0;

          if (!balanceOffsetByTokenByAddress[token.address]) balanceOffsetByTokenByAddress[token.address] = {};

          if (!balanceOffsetByTokenByAddress[token.address][transfer.from]) balanceOffsetByTokenByAddress[token.address][transfer.from] = Number(transfer.amount);
          else balanceOffsetByTokenByAddress[token.address][transfer.from] += Number(transfer.amount);

          setTimeout(() => {
            balanceOffsetByTokenByAddress[token.address][transfer.from] -= Number(transfer.amount);
          }, 25000);

          emit('sentTransfer', transfer);
          ++transferCount.value;
          ++sourceIndex;

          if (destinationIndex >= currentDestinationAddresses.value.length) break;

          const delay = randomDelay();
          await sleep(delay);
        }
        hasProcessSucceeded.value = true;
      } catch (err) {
        console.error(err);
        if (err && err.toString) {
          errorMessage.value = err.toString();
        } else {
          errorMessage.value = err;
        }
        if (errorMessage.value.includes('ERC20: transfer amount exceeds balance')) {
          errorMessage.value = "Error: Not enough ERC20 balance on the address " + transferFrom;
        }
        else if (errorMessage.value.startsWith('Error: quorum not met (request="%sub-requests", info={ "request": { "method": "estimateGas", "transaction')) {
          errorMessage.value = "Error: RPCs usage exceeded"
        }
      }
      isProcessPaused.value = false;
      isProcessStarted.value = false;
    }

    watch(isProcessStarted, () => {
      emit('update:isProcessRunning', isProcessStarted.value)
    });

    async function sendTransfer(transfer) {
      console.log(transfer);
      const result = await window.electronAPI.sendTransfer(transfer);
      return result;
    }

    function pauseProcess() {
      isProcessPaused.value = true;
    }
    
    function resumeProcess() {
      if (props.maxGasPrice > props.gasPrice)
        isProcessPaused.value = false;
    }

    function stopProcess() {
      processId++;
      isProcessStarted.value = false;
      isProcessPaused.value = false;
    }

    function deleteHistory () {
      window.electronAPI.deleteHistory();
      emit('deleteHistory');
    }

    return { 
      startProcess,
      pauseProcess,
      resumeProcess,
      stopProcess,
      isProcessStarted,
      isProcessPaused,
      pauseImage,
      playImage,
      stopImage,
      errorMessage,
      warningMessages,
      hasProcessSucceeded,
      transferCount,
      currentDestinationAddresses,
      deleteImage,
      deleteHistory,
    };
  }
};
</script>

<style scoped>
.transfer-control {
  background-color: #f0f0f0;
  border-radius: 5px;
  text-align: center;
  width: 100%;
  padding-bottom: 10px;
}

.transfer-control h2 {
  margin-top: 0;
  margin-bottom: 15px;
  font-size: 1.5em;
}

.button-group {
  display: flex;
  justify-content: center;
  gap: 20px;
  margin-bottom: 15px;
}

.button-group button {
  padding: 10px 20px;
  font-size: 1em;
  cursor: pointer;
  border: none;
  border-radius: 5px;
  background-color: #fff;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  transition: background-color 0.3s ease;
  display: flex;
  align-items: center;
  gap: 8px;
}

.button-group button:hover {
  background-color: #e0e0e0;
}

.icon-line {
  vertical-align: middle;
}

.status-info {
  font-size: 0.9em;
  color: #333;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.status-info .error-message {
  color: red;
}

.status-info .warning-message {
  color: rgb(171, 124, 35);
}

.status-info .success-message {
  color: green;
}

.absolute-right {
  position: absolute;
  right: 10px;
  cursor: pointer;
  padding: 5px;
}
</style>