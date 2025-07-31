<template>
  <div class="transfer-history">
    <!-- Wrap the list in a transition-group to animate new items -->
    <span class="bold">
      Swap
    </span>
    <span class="from" style="margin-left: 20px;">
      From
    </span>
    <span class="date">
      Date
    </span>
    <span class="gas">
      Gas
    </span>
    <span class="gas">
      Type
    </span>
    <transition-group name="transfer" tag="ul">
      <li 
        v-for="(t, index) in trades"
        :key="t.timestamp + t.txId" 
        :class="{ 'is-manual': t.type === 'manual', 'is-auto': t.type === 'automatic', 'is-limit': t.type === 'limit' }"
      >
        {{ t.hasFailed ? '❌' : (t.isConfirmed ? '✅' : '⏳') }}
        <span class="bold">
          {{ t.fromAmount }} {{ t.fromTokenSymbol || t.fromToken?.symbol }} -> 
          <span v-if="t.toAmount"> {{ (!t.toAmount || t.toAmount === 'unknown') ? t.expectedToAmount : (t.toAmount + ' (' + t.expectedToAmount + ')') }}  </span>
          <span v-else> {{ t.toAmount || t.expectedToAmount }} </span>
          {{ t.toTokenSymbol || t.toToken?.symbol }}
        </span>
        {{ t }}
        <span class="from">{{ t.senderName || t.sender?.name }} | {{ t.protocol }}</span>
        <span class="date">{{ (new Date(t.sentDate || t.timestamp)).toLocaleString() }}</span>
        <span class="gas">{{ t.txId && t.txId.toString().startsWith('TEST') ? 'TEST' : '$' + (t.gasCost?.substring(0, 4) || '0') }}</span>
        <span class="gas" v-if="t.type"> {{ t.type }} </span>
        <span v-if="!t.txId || !t.txId.toString().startsWith('TEST')" @click.stop="openTxDetails(t.txId)" class="view">View</span>
        <span @click.stop="deleteTrade(t, index)" class="delete">Delete</span>
      </li>
    </transition-group>
    <button class="delete-all" @click="deleteAll">Delete all</button>
    <button class="download-all" @click="downloadAllAsCSV">Download all</button>
  </div>
</template>

<script>
import { toRaw, watch } from 'vue';
import {BigNumber, ethers} from 'ethers';

export default {
  name: 'TransferHistory',
  props: {
    trades: {
      type: Array,
      default: () => ([])
    },
    ethPrice: {
      type: Number,
    },
    provider: {
      type: Object,
    }
  },
  emits: ['confirmedTrade'],
  setup(props, {emit}) {
    // Utility function to format UNIX timestamps.
    function formatTimestamp(timestamp) {
      const date = new Date(timestamp);
      return date.toLocaleString();
    }

    const openTxDetails = (txId) => {
      if (!txId) return;
      window.electronAPI.openURL('https://etherscan.io/tx/' + txId);
    }

    watch(() => props.trades, (tradesValue) => {
      for (const trade of tradesValue) {
        checkTx(trade);
      }
    }, {immediate: true, deep: true})

    const ERC20_TRANSFER_SIG =
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

    const toEth  = wei => Number(ethers.utils.formatEther(wei));
    const toGwei = weiBN => Number(ethers.utils.formatUnits(weiBN, 9));

    const analyseReceipt = async (trade, rcpt, provider) => {
      /* ── gas ─────────────────────────────── */
      const ethUsd        = props.ethPrice;
      const gasPaidWei    = rcpt.gasUsed.mul(rcpt.effectiveGasPrice);
      const gasInfo = {
        gasUsed:   rcpt.gasUsed.toNumber(),
        gasPrice:  toGwei(rcpt.effectiveGasPrice),   // gwei
        paidEth:   toEth(gasPaidWei),
        paidUsd:   toEth(gasPaidWei) * ethUsd
      };

      if (!rcpt.status || rcpt.status === '0')
        return {gas: gasInfo}

      /* ── ERC-20 credits to tx-sender ──────── */
      const sender = rcpt.from.toLowerCase();
      const iface  = new ethers.utils.Interface([
        'function decimals() view returns (uint8)',
        'function symbol()   view returns (string)'
      ]);

      const credits = rcpt.logs
        .filter(l =>
          l.topics[0].toLowerCase() === ERC20_TRANSFER_SIG &&
          ('0x' + l.topics[2].slice(26)).toLowerCase() === sender
        );

      const tokens = [];
      let sumRawAmountByToken = {};
      for (const log of credits) {
        const tokenAddr   = log.address;
        const amountRaw   = BigNumber.from(log.data);

        // quick-load ERC-20 meta
        const erc20 = new ethers.Contract(tokenAddr, iface, provider);
        const [dec, sym] = await Promise.all([erc20.decimals(), erc20.symbol()]);

        if (!sumRawAmountByToken[tokenAddr]) {
          sumRawAmountByToken[tokenAddr] = BigNumber.from(0);
        }
        sumRawAmountByToken[tokenAddr] = sumRawAmountByToken[tokenAddr].add(amountRaw);

        const humanAmt    = Number(ethers.utils.formatUnits(sumRawAmountByToken[tokenAddr], dec));

        let indexToken = tokens.findIndex((t) => t.symbol === sym)
        if (indexToken === -1)
          tokens.push({ symbol: sym, amount: humanAmt.toFixed(6) });
        else 
          tokens[indexToken].amount = humanAmt.toFixed(6);
      }

      return { gas: gasInfo, tokens };
    }

    const checkTx = async (trade) => {
      // Validate input
      if (!trade || !trade.txId || trade.isConfirmed) return;
      
      // Skip checking TEST transactions (they don't exist on blockchain)
      if (trade.txId.toString().startsWith('TEST')) {
        trade.isConfirmed = true;
        trade.gasCost = 'TEST';
        return;
      }

      const providersList = [
        new ethers.providers.JsonRpcProvider('https://eth1.lava.build', { chainId: 1, name: 'homestead' }),
        new ethers.providers.JsonRpcProvider('https://mainnet.gateway.tenderly.co', { chainId: 1, name: 'homestead' }),
        new ethers.providers.JsonRpcProvider('https://0xrpc.io/eth', { chainId: 1, name: 'homestead' }),
        new ethers.providers.JsonRpcProvider('https://eth.drpc.org', { chainId: 1, name: 'homestead' }),
        new ethers.providers.JsonRpcProvider('https://ethereum.therpc.io', { chainId: 1, name: 'homestead' }),
      ];

      let i = 0;
      const maxRetries = 100; // Prevent infinite loop - ~5 minutes with 3s delay
      
      while (!trade.isConfirmed && trade.txId && !trade.hasFailed && i < maxRetries) {
        await new Promise((r) => setTimeout(r, 4000));
        
        try {
          const receipt = await providersList[i % providersList.length].getTransactionReceipt(trade.txId)
          if (receipt) {
            emit('confirmedTrade', trade);
            try {
              if (receipt.status === '1' || receipt.status === 1) {
                trade.isConfirmed = true;
                const {gas, tokens} = await analyseReceipt(trade, receipt, toRaw(props.provider))
                trade.gasCost = gas.paidUsd + '';
                trade.toAmount = tokens[0]?.amount || 'unknown';
                window.electronAPI.confirmTrade(trade.txId, gas.paidUsd, trade.toAmount);
              } else {
                const {gas} = await analyseReceipt(trade, receipt, toRaw(props.provider))
                trade.hasFailed = true;
                trade.gasCost = gas.paidUsd + '';
                window.electronAPI.failTrade(trade.txId, trade.gasCost);
              }
            } catch (analyseError) {
              console.error('Error analyzing receipt:', analyseError);
              // Still mark as confirmed/failed even if analysis fails
              if (receipt.status === '1' || receipt.status === 1) {
                trade.isConfirmed = true;
                window.electronAPI.confirmTrade(trade.txId, 0, 'unknown');
              } else {
                trade.hasFailed = true;
                window.electronAPI.failTrade(trade.txId, '0');
              }
            }
            break; // Exit loop once receipt is found
          }
        } catch (error) {
          console.error(`Provider ${i % providersList.length} failed:`, error.message);
          // Continue to next provider
        }
        
        ++i;
      }
      
      if (i >= maxRetries) {
        console.error(`Transaction ${trade.txId} check timed out after ${maxRetries} attempts`);
      }
    }

    const deleteTrade = (trade, index) => {
      props.trades.splice(index, 1);
      window.electronAPI.deleteTrade(trade.txId);
    }

    const deleteAll = () => {
      props.trades.splice(0, props.trades.length);
      window.electronAPI.deleteHistory();
    }

    const downloadAllAsCSV = async () => {
      try {
        const result = await window.electronAPI.getAllTrades();
        if (!result.success) {
          console.error('Failed to get all trades:', result.error);
          return;
        }

        const trades = result.data;
        if (!trades || trades.length === 0) {
          alert('No trades to export');
          return;
        }

        // CSV headers
        const headers = [
          'Status',
          'From Amount',
          'From Token',
          'To Amount',
          'To Token',
          'Expected To Amount',
          'Sender',
          'Protocol',
          'Date',
          'Gas Cost ($)',
          'Type',
          'Transaction ID'
        ];

        // Convert trades to CSV rows
        const rows = trades.map(t => {
          const status = t.hasFailed ? 'Failed' : (t.isConfirmed ? 'Confirmed' : 'Pending');
          const toAmount = (!t.toAmount || t.toAmount === 'unknown') ? t.expectedToAmount : t.toAmount;
          const date = new Date(t.sentDate || t.timestamp).toISOString();
          const gasCost = (t.txId && t.txId.toString().startsWith('TEST')) ? 'TEST' : (t.gasCost || '0');
          
          return [
            status,
            t.fromAmount || '',
            t.fromTokenSymbol || t.fromToken?.symbol || '',
            toAmount || '',
            t.toTokenSymbol || t.toToken?.symbol || '',
            t.expectedToAmount || '',
            t.senderName || t.sender?.name || '',
            t.protocol || '',
            date,
            gasCost,
            t.type || '',
            t.txId || ''
          ];
        });

        // Combine headers and rows
        const csvContent = [
          headers,
          ...rows
        ].map(row => row.map(cell => {
          // Escape quotes and wrap in quotes if contains comma or quotes
          const cellStr = String(cell);
          if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
            return '"' + cellStr.replace(/"/g, '""') + '"';
          }
          return cellStr;
        }).join(',')).join('\n');

        // Create blob and download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `trades_export_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
      } catch (error) {
        console.error('Error downloading trades:', error);
        alert('Failed to download trades');
      }
    }

    return { 
      formatTimestamp,
      openTxDetails,
      deleteTrade,
      deleteAll,
      downloadAllAsCSV,
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
  padding: 3px 0 2px 4px;
  border-bottom: 1px solid #eee;
  position: relative;
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
.bold, .bold span {
  font-weight: 600;
  font-size: 14px !important;
}
.bold {
  width: 500px;
  display: inline-block;
  text-align: center;
}
.from {
  width: 250px;
  text-align: center;
  display: inline-block;
  text-align: center;
}
.date {
  margin-left: 5px;
  display: inline-block;
  width: 200px;
  text-align: center;
}
.gas {
  text-align: center;
  width: 100px;
  display: inline-block;
}
.delete {
  display: none;
  right: 0px;
  position: absolute;
  cursor: pointer;
  color: rgb(171, 37, 37);
  padding: 5px;
}
.view {
  display: none;
  right: 50px;
  position: absolute;
  cursor: pointer;
  padding: 5px;
}

li:hover .delete, li:hover .view {
  display: inline-block;
}

.delete:hover, .view:hover {
  text-decoration: underline;
}

.delete-all {
  margin-left: auto;
  display: block;
  margin-top: 10px;
}

.download-all {
  margin-left: auto;
  display: block;
  margin-top: 10px;
  background-color: #4CAF50;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
}

.download-all:hover {
  background-color: #45a049;
}

.is-manual {
  background-color: #eee;
}

.is-limit {
  background-color: #fcffe4;
}

.is-auto {
  background-color: #dbf1ff;
}
</style>