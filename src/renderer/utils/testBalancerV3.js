import { ethers } from 'ethers';
import { useBalancerV3 } from './useBalancerV3.js';

async function testBalancerV3() {
  console.log('🧪 Testing Balancer V3 Implementation with Pool Type Detection\n');
  
  const provider = new ethers.providers.JsonRpcProvider('https://eth.llamarpc.com');
  
  const testCases = [
    {
      name: 'ONE to SEV - Detect pool types and weights',
      tokenIn: '0x91c65c2a9a3adfe2424ecc4a4890b8334c3a8212', // ONE
      tokenOut: '0x965b64ae2c04cff248e6502c10cf3a4931e1f1d9', // SEV
      amountIn: ethers.utils.parseEther('1'),
      expectedType: 'Should detect weighted or stable pools'
    },
    {
      name: 'SEV to DAI - Through weighted/stable pools',
      tokenIn: '0x965b64ae2c04cff248e6502c10cf3a4931e1f1d9', // SEV
      tokenOut: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
      amountIn: ethers.utils.parseEther('100'),
      expectedType: 'Should find multi-hop path'
    },
    {
      name: 'ONE to USDC - Through weighted pools',
      tokenIn: '0x91c65c2a9a3adfe2424ecc4a4890b8334c3a8212', // ONE
      tokenOut: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      amountIn: ethers.utils.parseEther('10'),
      expectedType: 'Should detect 80/20 or 50/50 weighted pools'
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n📊 Test: ${testCase.name}`);
    console.log(`Expected: ${testCase.expectedType}`);
    console.log(`Input: ${ethers.utils.formatEther(testCase.amountIn)} tokens`);
    
    try {
      const result = await useBalancerV3({
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
        console.log(`  - Pool details:`);
        
        result.path.hops.forEach((hop, i) => {
          console.log(`    ${i + 1}. Pool ${hop.poolAddress.slice(0, 10)}...`);
          console.log(`       Type: ${hop.poolType}`);
          console.log(`       Weights: ${hop.weights || 'N/A'}`);
          console.log(`       ${hop.tokenIn.slice(0, 10)}... → ${hop.tokenOut.slice(0, 10)}...`);
          console.log(`       Fee: ${(parseFloat(hop.swapFee) * 100).toFixed(3)}%`);
        });
        
        // Verify pool types were detected
        const poolTypes = result.poolTypes;
        console.log(`\n  Pool Types Detected: ${poolTypes.join(', ')}`);
        
        if (result.weights && result.weights.length > 0) {
          console.log(`  Weights Distribution: ${result.weights.filter(w => w).join(', ')}`);
        }
      } else {
        console.log('❌ No path found');
      }
    } catch (error) {
      console.log('❌ Error:', error.message);
    }
  }
  
  console.log('\n\n🔬 Testing pool type detection...\n');
  
  // Test specific pool detection
  const testPools = [
    '0x5c6Ee304399DBdB9C8Ef030aB642B10820DB8F56', // BAL/WETH 80/20 weighted
    '0x32296969Ef14EB0c6d29669C550D4a0449130230', // wstETH/WETH stable pool
    '0x96646936b91d6B9D7D0c47C496AfBF3D6ec7B6f8' // USDC/WETH weighted
  ];
  
  for (const poolAddress of testPools) {
    console.log(`Testing pool ${poolAddress}:`);
    try {
      // Create a minimal pool object for testing
      const pool = { address: poolAddress, id: poolAddress };
      
      // This would normally be done internally, but let's test detection
      const weightedPool = new ethers.Contract(
        poolAddress,
        ['function getNormalizedWeights() external view returns (uint256[] memory)'],
        provider
      );
      
      try {
        const weights = await weightedPool.getNormalizedWeights();
        const totalWeight = ethers.utils.parseEther('1');
        const normalizedWeights = weights.map(w => {
          const percentage = ethers.BigNumber.from(w).mul(100).div(totalWeight);
          return percentage.toNumber();
        });
        console.log(`  ✅ Weighted Pool - Weights: ${normalizedWeights.join('/')}%`);
      } catch (e) {
        // Try stable pool
        const stablePool = new ethers.Contract(
          poolAddress,
          ['function getAmplificationParameter() external view returns (uint256 value, bool isUpdating, uint256 precision)'],
          provider
        );
        
        try {
          const ampData = await stablePool.getAmplificationParameter();
          console.log(`  ✅ Stable Pool - Amplification: ${ampData.value.toString()}`);
        } catch (e2) {
          console.log(`  ⚠️  Unknown pool type`);
        }
      }
    } catch (error) {
      console.log(`  ❌ Error detecting pool type: ${error.message}`);
    }
  }
  
  console.log('\n✅ All tests completed!');
}

testBalancerV3().catch(console.error);