import { ethers } from 'ethers';
import { useMixedUniswapBalancer } from './useMixedUniswapBalancer.js';
import { getV4SDK } from './uniswapV4ESM.js';

/**
 * Test cross-DEX routing for ONE -> SEV
 * Expected path: ONE -> WETH (Balancer) -> SEV (Uniswap)
 */
async function testCrossDEXRouting() {
  console.log('=== Testing Cross-DEX Routing (ONE -> SEV) ===\n');
  
  // Pre-load the ESM module to verify it's working
  const v4sdk = await getV4SDK;
  console.log('Loaded V4 SDK modules:', Object.keys(v4sdk));
  
  const provider = new ethers.providers.JsonRpcProvider('https://eth.llamarpc.com');
  
  // Correct token addresses
  const ONE = {
    address: '0x91c65c2a9a3adfe2424ecc4a4890b8334c3a8212',
    symbol: 'ONE',
    decimals: 18
  };
  
  const SEV = {
    address: '0x965b64ae2c04cff248e6502c10cf3a4931e1f1d9',
    symbol: 'SEV',
    decimals: 18
  };
  
  const amountIn = ethers.utils.parseUnits('10', 18); // 10 ONE
  
  console.log('Input: 10 ONE');
  console.log('Expected path: ONE -> WETH (Balancer) -> SEV (Uniswap)');
  console.log('----------------------------------------\n');
  
  try {
    const result = await useMixedUniswapBalancer({
      tokenInObject: ONE,
      tokenOutObject: SEV,
      amountIn,
      provider,
      slippageTolerance: 0.5,
      maxHops: 2,
      useUniswap: true,
      useBalancer: true
    });
    
    if (result && result.bestRoute) {
      const outputFormatted = ethers.utils.formatUnits(result.bestRoute.totalOutput, 18);
      console.log('\n✅ Best route found:');
      console.log(`   Type: ${result.bestRoute.type}`);
      console.log(`   Output: ${outputFormatted} SEV`);
      
      if (result.bestRoute.path) {
        console.log(`   Path: ${result.bestRoute.path}`);
      }
      
      // Extract split percentages if available
      if (result.bestRoute.type === 'cross-dex-optimized-exact' && result.bestRoute.splits) {
        const balancerSplit = result.bestRoute.splits.find(s => s.protocol === 'balancer');
        const uniswapSplit = result.bestRoute.splits.find(s => s.protocol === 'uniswap');
        
        if (balancerSplit && uniswapSplit) {
          const balPercent = (balancerSplit.percentage * 100).toFixed(2);
          const uniPercent = (uniswapSplit.percentage * 100).toFixed(2);
          
          console.log('\n   Split Analysis:');
          console.log(`   • Balancer: ${balPercent}% (target: 47.36%)`);
          console.log(`   • Uniswap: ${uniPercent}% (target: 52.64%)`);
          console.log(`   • Deviation from optimal: ${Math.abs(balancerSplit.percentage - 0.4736).toFixed(4)}`);
        }
      }
      
      if (result.bestRoute.legs) {
        console.log('\n   Legs breakdown:');
        result.bestRoute.legs.forEach((leg, i) => {
          const legOutput = leg.outputAmount ? 
            ethers.utils.formatUnits(leg.outputAmount, leg.token?.decimals || 18) : 
            'N/A';
          console.log(`   ${i + 1}. ${leg.protocol}: Output ${legOutput} ${leg.token?.symbol || ''}`);
        });
      }
      
      // Check if output is reasonable (target is 4.99 SEV for 10 ONE with 47.36/52.64 split)
      const actualOutput = parseFloat(outputFormatted);
      const targetOutput = 4.99;
      const deviation = Math.abs(actualOutput - targetOutput);
      
      if (deviation < 0.02) {
        console.log(`\n   ✅ Output is optimal (${deviation.toFixed(4)} deviation from ${targetOutput} SEV target)`);
      } else if (deviation < 0.05) {
        console.log(`\n   ✅ Output is good (${deviation.toFixed(4)} deviation from ${targetOutput} SEV target)`);
      } else {
        console.log(`\n   ⚠️ Output could be better (${deviation.toFixed(4)} deviation from ${targetOutput} SEV target)`);
      }
      
    } else {
      console.log('❌ No route found');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
  
  console.log('\n=== Test Complete ===\n');
}

// Run the test
testCrossDEXRouting().catch(console.error);