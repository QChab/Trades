import { ethers } from 'ethers';
import { useUniswapV4 } from '../composables/useUniswap.js';

async function debugUniswapPaths() {
  console.log('=== Debugging Uniswap Path Discovery ===\n');
  
  const ONE = { address: '0x91c65c2a9a3adfe2424ecc4a4890b8334c3a8212', symbol: 'ONE', decimals: 18 };
  const ETH = { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 };
  const SEV = { address: '0x965b64ae2c04cff248e6502c10cf3a4931e1f1d9', symbol: 'SEV', decimals: 18 };
  
  const amountIn = ethers.utils.parseUnits('10', 18);
  const uniswap = useUniswapV4();
  
  console.log('1. Finding ONE -> ETH (should be 1 hop):');
  const oneToEthPools = await uniswap.findPossiblePools(ONE, ETH);
  console.log(`   Found ${oneToEthPools.length} pools`);
  
  if (oneToEthPools.length > 0) {
    const oneToEthTrades = await uniswap.selectBestPath(ONE, ETH, oneToEthPools, amountIn);
    console.log(`   Found ${oneToEthTrades?.length || 0} trades`);
    
    if (oneToEthTrades && oneToEthTrades[0]) {
      const trade = oneToEthTrades[0];
      console.log(`   Best trade:`);
      console.log(`     - Route: ${trade.route?.path?.map(t => t.symbol).join(' -> ') || 'N/A'}`);
      console.log(`     - Hops: ${trade.swaps?.[0]?.route?.pools?.length || 0}`);
      console.log(`     - Output: ${ethers.utils.formatUnits(trade.outputAmount?.quotient?.toString() || '0', 18)} ETH`);
    }
  }
  
  console.log('\n2. Finding ETH -> SEV (should be 1 hop):');
  const ethToSevPools = await uniswap.findPossiblePools(ETH, SEV);
  console.log(`   Found ${ethToSevPools.length} pools`);
  
  const ethAmount = ethers.utils.parseEther('0.646'); // Approximate combined from first hop
  if (ethToSevPools.length > 0) {
    const ethToSevTrades = await uniswap.selectBestPath(ETH, SEV, ethToSevPools, ethAmount);
    console.log(`   Found ${ethToSevTrades?.length || 0} trades`);
    
    if (ethToSevTrades && ethToSevTrades[0]) {
      const trade = ethToSevTrades[0];
      console.log(`   Best trade:`);
      console.log(`     - Route: ${trade.route?.path?.map(t => t.symbol).join(' -> ') || 'N/A'}`);
      console.log(`     - Hops: ${trade.swaps?.[0]?.route?.pools?.length || 0}`);
      console.log(`     - Output: ${ethers.utils.formatUnits(trade.outputAmount?.quotient?.toString() || '0', 18)} SEV`);
    }
  }
  
  console.log('\n3. Checking if ONE -> SEV gives 2-hop path:');
  const oneToSevPools = await uniswap.findPossiblePools(ONE, SEV);
  console.log(`   Found ${oneToSevPools.length} direct pools`);
  
  const oneToSevTrades = await uniswap.selectBestPath(ONE, SEV, oneToSevPools, amountIn);
  if (oneToSevTrades && oneToSevTrades[0]) {
    const trade = oneToSevTrades[0];
    console.log(`   Best trade:`);
    console.log(`     - Route: ${trade.route?.path?.map(t => t.symbol).join(' -> ') || 'N/A'}`);
    console.log(`     - Hops: ${trade.swaps?.[0]?.route?.pools?.length || 0}`);
    console.log(`     - Output: ${ethers.utils.formatUnits(trade.outputAmount?.quotient?.toString() || '0', 18)} SEV`);
  }
}

debugUniswapPaths().catch(console.error);