<template>
  <div class="transfer-history">
    <!-- Wrap the list in a transition-group to animate new items -->
    <transition-group name="transfer" tag="ul">
      <li v-for="(t, index) in trades" :key="t.timestamp" @click="openTxDetails(t.txId)">
        {{ t.hasFailed ? '❌' : (t.isConfirmed ? '✅' : '⏳') }}
        {{ t.fromAmount }} {{ t.fromTokenSymbol || t.fromToken?.symbol }} -> 
        <span v-if="t.toAmount"> {{ t.toAmount }} ({{ t.expectedToAmount }}) </span>
        <span v-else> {{ t.toAmount || t.expectedToAmount }} </span>
        {{ t.toTokenSymbol || t.toToken?.symbol }}
        from {{ t.senderName || t.sender?.name }} on {{ (new Date(t.sentDate || t.timestamp)).toLocaleString() }}
        <span v-if="t.gasCost">; gas cost: ${{ t.gasCost.fixed(2)}} </span>
        {{t}}
      </li>
    </transition-group>
  </div>
</template>

<script>
import { computed, watch } from 'vue';
import provider from '@/ethersProvider';
import {ethers} from 'ethers';

export default {
  name: 'TransferHistory',
  props: {
    trades: {
      type: Array,
      default: () => ([])
    },
    ethPrice: {
      type: Number,
      default: 2500,
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
      for (const log of credits) {
        const tokenAddr   = log.address;
        const amountRaw   = ethers.BigNumber.from(log.data);

        // quick-load ERC-20 meta
        const erc20 = new ethers.Contract(tokenAddr, iface, provider);
        const [dec, sym] = await Promise.all([erc20.decimals(), erc20.symbol()]);

        const humanAmt    = Number(ethers.utils.formatUnits(amountRaw, dec));

        tokens.push({ symbol: sym, amount: humanAmt });
      }

      return { gas: gasInfo, tokens };
    }

    const checkTx = async (trade) => {
      if (trade.isConfirmed) return;

      while (!trade.isConfirmed && trade.txId && !trade.hasFailed) {
        await new Promise((r) => setTimeout(r, 3000));
        const receipt = await provider.getTransactionReceipt(trade.txId)
        if (receipt) {
          if (receipt.status === '1' || receipt.status === 1) {
            trade.isConfirmed = true;
            const {gas, tokens} = await analyseReceipt(trade, receipt, provider)
            console.log(gas, tokens)
            window.electronAPI.confirmTrade(trade.txId, gas.paidUsd, tokens[0].amount);
          } else {
            trade.hasFailed = true;
            window.electronAPI.failTrade(trade.txId);
          }
        }
      }
    }
//         {
//     "to": "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",
//     "from": "0x67d0Df6735122F4F9758F9ee54ed233746681A7f",
//     "contractAddress": null,
//     "transactionIndex": 284,
//     "gasUsed": {
//         "type": "BigNumber",
//         "hex": "0x01a822"
//     },
//     "logsBloom": "0x00000000000000000000000000000000000000000000000000000001000000000000000020080000001000000000010000000000040000000000000000000000000000000000000000000008004000000020000000000020000000000000000000000000000000000000000000000000000000000000000000000010000000000000000800000000000000000000000000000000000000000000080000100000000000000000000000000080100000000000000000000000000000000000000000000802100000000000000000000000000400400000000000000000000000000000000000000000004080000000000000000000000000000000000000040000",
//     "blockHash": "0xe18341965a878f6cc529785c372cd2a4d6bc679d2c7ab91e0fbe0f3dbe23712f",
//     "transactionHash": "0x74c21fdf04806332b8fd15db43fa0509707baf26fca1a263f8759a763893b4bb",
//     "logs": [
//         {
//             "transactionIndex": 284,
//             "blockNumber": 22570228,
//             "transactionHash": "0x74c21fdf04806332b8fd15db43fa0509707baf26fca1a263f8759a763893b4bb",
//             "address": "0x000000000004444c5dc75cB358380D2e3dE08A90",
//             "topics": [
//                 "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f",
//                 "0x72331fcb696b0151904c03584b66dc8365bc63f8a144d89a773384e3a579ca73",
//                 "0x00000000000000000000000066a9893cc07d91d95644aedd05d03f95e1dba8af"
//             ],
//             "data": "0xffffffffffffffffffffffffffffffffffffffffffffffffffffa50cef85c000000000000000000000000000000000000000000000000000000000000003e6860000000000000000000000000000000000000000000350743b0a8a2a67bb5e7d000000000000000000000000000000000000000000000000111503750bd7e9cdfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcfb2300000000000000000000000000000000000000000000000000000000000001f4",
//             "logIndex": 492,
//             "blockHash": "0xe18341965a878f6cc529785c372cd2a4d6bc679d2c7ab91e0fbe0f3dbe23712f"
//         },
//         {
//             "transactionIndex": 284,
//             "blockNumber": 22570228,
//             "transactionHash": "0x74c21fdf04806332b8fd15db43fa0509707baf26fca1a263f8759a763893b4bb",
//             "address": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
//             "topics": [
//                 "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
//                 "0x000000000000000000000000000000000004444c5dc75cb358380d2e3de08a90",
//                 "0x00000000000000000000000067d0df6735122f4f9758f9ee54ed233746681a7f"
//             ],
//             "data": "0x000000000000000000000000000000000000000000000000000000000003e686",
//             "logIndex": 493,
//             "blockHash": "0xe18341965a878f6cc529785c372cd2a4d6bc679d2c7ab91e0fbe0f3dbe23712f"
//         }
//     ],
//     "blockNumber": 22570228,
//     "confirmations": 1,
//     "cumulativeGasUsed": {
//         "type": "BigNumber",
//         "hex": "0x0135905a"
//     },
//     "effectiveGasPrice": {
//         "type": "BigNumber",
//         "hex": "0x2331ce80"
//     },
//     "status": 1,
//     "type": 2,
//     "byzantium": true
// }
    
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