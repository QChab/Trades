import { ethers } from 'ethers';
import { useBalancerV2 } from './useBalancerV2.js';

async function testBalancerV2() {
  console.log('🧪 Testing Balancer V2 Pool Query Implementation\n');
  
  const provider = new ethers.providers.JsonRpcProvider('https://eth.llamarpc.com');
  
  const testCases = [
    {
      name: 'WETH to USDC - Direct Pool',
      tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      tokenOut: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      amountIn: ethers.utils.parseEther('1'),
      expectedHops: 1
    },
    {
      name: 'USDC to DAI - Multi-hop through WETH',
      tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      tokenOut: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      amountIn: ethers.utils.parseUnits('1000', 6),
      expectedHops: 2
    },
    {
      name: 'WETH to WBTC - Through liquidity pools',
      tokenIn: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      tokenOut: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      amountIn: ethers.utils.parseEther('1'),
      expectedHops: 1
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n📊 Test: ${testCase.name}`);
    console.log(`Input: ${ethers.utils.formatEther(testCase.amountIn)} tokens`);
    
    try {
      const result = await useBalancerV2({
        tokenInAddress: testCase.tokenIn,
        tokenOutAddress: testCase.tokenOut,
        amountIn: testCase.amountIn.toString(),
        slippageTolerance: 0.5,
        provider
      });
      
      if (result) {
        console.log('✅ Path found:');
        console.log(`  - Hops: ${result.path.hops.length}`);
        console.log(`  - Output: ${ethers.utils.formatEther(result.amountOut)} tokens`);
        console.log(`  - Min Output: ${ethers.utils.formatEther(result.minAmountOut)} tokens`);
        console.log(`  - Price Impact: ${(parseFloat(result.priceImpact) / 100).toFixed(2)}%`);
        console.log(`  - Total Fees: ${ethers.utils.formatEther(result.fees)} tokens`);
        console.log(`  - Pools used:`);
        result.path.hops.forEach((hop, i) => {
          console.log(`    ${i + 1}. Pool ${hop.poolId.slice(0, 10)}...`);
          console.log(`       ${hop.tokenIn.slice(0, 10)}... → ${hop.tokenOut.slice(0, 10)}...`);
          console.log(`       Fee: ${(parseFloat(hop.swapFee) * 100).toFixed(2)}%`);
        });
        
        if (result.path.hops.length !== testCase.expectedHops) {
          console.log(`⚠️  Warning: Expected ${testCase.expectedHops} hops, got ${result.path.hops.length}`);
        }
      } else {
        console.log('❌ No path found');
      }
    } catch (error) {
      console.log('❌ Error:', error.message);
    }
  }
  
  console.log('\n\n🔬 Testing edge cases...\n');
  
  console.log('Test: Non-existent token pair');
  const noPath = await useBalancerV2({
    tokenInAddress: '0x0000000000000000000000000000000000000001',
    tokenOutAddress: '0x0000000000000000000000000000000000000002',
    amountIn: '1000000000000000000',
    provider
  });
  console.log(noPath ? '❌ Unexpected path found' : '✅ Correctly returned null for invalid tokens');
  
  console.log('\nTest: Very small amount (dust)');
  const dustResult = await useBalancerV2({
    tokenInAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    tokenOutAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    amountIn: '1000',
    provider
  });
  console.log(dustResult ? `✅ Handled dust amount: ${dustResult.amountOut}` : '❌ Failed on dust amount');
  
  console.log('\nTest: Large slippage tolerance');
  const highSlippage = await useBalancerV2({
    tokenInAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    tokenOutAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    amountIn: ethers.utils.parseEther('1').toString(),
    slippageTolerance: 5,
    provider
  });
  
  if (highSlippage) {
    const normalSlippage = await useBalancerV2({
      tokenInAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      tokenOutAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      amountIn: ethers.utils.parseEther('1').toString(),
      slippageTolerance: 0.5,
      provider
    });
    
    const highMin = ethers.BigNumber.from(highSlippage.minAmountOut);
    const normalMin = ethers.BigNumber.from(normalSlippage.minAmountOut);
    
    console.log(highMin.lt(normalMin) ? '✅ Higher slippage = lower minimum' : '❌ Slippage calculation issue');
  }
  
  console.log('\n✅ All tests completed!');
}

testBalancerV2().catch(console.error);