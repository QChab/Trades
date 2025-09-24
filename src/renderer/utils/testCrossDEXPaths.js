import { ethers } from 'ethers';
import { useMixedUniswapBalancer } from './useMixedUniswapBalancer.js';

async function testCrossDEXPaths() {
  console.log('=== Testing Cross-DEX Paths ===\n');
  
  const provider = new ethers.providers.JsonRpcProvider('https://eth.llamarpc.com');
  const ONE = { address: '0x91c65c2a9a3adfe2424ecc4a4890b8334c3a8212', symbol: 'ONE', decimals: 18 };
  const SEV = { address: '0x965b64ae2c04cff248e6502c10cf3a4931e1f1d9', symbol: 'SEV', decimals: 18 };
  const amountIn = ethers.utils.parseUnits('10', 18);
  
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
    
    if (result?.bestRoute) {
      console.log('\n📊 Best Route:');
      console.log(`   Type: ${result.bestRoute.type}`);
      console.log(`   Output: ${ethers.utils.formatUnits(result.bestRoute.totalOutput || 0, 18)} SEV`);
      
      if (result.bestRoute.splits) {
        console.log('\n   Splits:');
        result.bestRoute.splits.forEach(split => {
          console.log(`   - ${split.protocol}: ${(split.percentage * 100).toFixed(1)}%`);
        });
      }
      
      if (result.bestRoute.legs) {
        console.log('\n   Legs:');
        result.bestRoute.legs.forEach(leg => {
          const output = leg.outputAmount ? ethers.utils.formatUnits(leg.outputAmount, 18) : 'N/A';
          console.log(`   - ${leg.protocol}: ${leg.description || leg.token?.symbol || '?'} (${output})`);
        });
      }
    }
    
    // Check if we have cross-DEX optimized route
    if (result?.mixedRoutes) {
      const optimized = result.mixedRoutes.find(r => r.type === 'cross-dex-optimized');
      if (optimized) {
        console.log('\n🎯 Found Optimized Cross-DEX Route:');
        console.log(`   Output: ${ethers.utils.formatUnits(optimized.totalOutput || 0, 18)} SEV`);
        console.log(`   Path: ${optimized.path}`);
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testCrossDEXPaths().catch(console.error);