import { ethers } from 'ethers';
import { 
  discoverAllPools, 
  buildPossiblePaths, 
  findOptimalMixedStrategy 
} from './crossDEXOptimizer.js';

/**
 * Test advanced cross-DEX routing with exact AMM calculations
 */
async function testAdvancedCrossDEX() {
  console.log('=== Testing Advanced Cross-DEX Optimizer ===\n');
  
  const provider = new ethers.providers.JsonRpcProvider('https://eth.llamarpc.com');
  
  // Test tokens
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
  console.log('Target: SEV');
  console.log('Expected: ~4.99 SEV with optimal 47/53 split\n');
  console.log('----------------------------------------\n');
  
  try {
    // Step 1: Discover all relevant pools
    console.log('Step 1: Discovering pools...');
    const pools = await discoverAllPools(ONE, SEV, provider);
    
    // Count total pools
    const uniswapCount = Object.values(pools.uniswap).flat().length;
    const balancerCount = Object.values(pools.balancer).flat().length;
    console.log(`\nFound ${uniswapCount} Uniswap pools and ${balancerCount} Balancer pools\n`);
    
    // Step 2: Build all possible paths
    console.log('Step 2: Building paths...');
    const paths = buildPossiblePaths(ONE, SEV, pools, 3);
    
    // Show path distribution
    const pathsByProtocol = {
      uniswap: paths.filter(p => p.protocol === 'uniswap').length,
      balancer: paths.filter(p => p.protocol === 'balancer').length,
      mixed: paths.filter(p => p.protocol === 'mixed').length
    };
    
    console.log(`\nPath distribution:`);
    console.log(`  • Uniswap only: ${pathsByProtocol.uniswap}`);
    console.log(`  • Balancer only: ${pathsByProtocol.balancer}`);
    console.log(`  • Mixed (cross-DEX): ${pathsByProtocol.mixed}\n`);
    
    // Show some interesting paths
    const interestingPaths = paths.filter(p => 
      (p.protocol === 'mixed' && p.hops === 2) ||
      (p.route.includes('WETH') || p.route.includes('ETH'))
    ).slice(0, 5);
    
    console.log('Interesting paths found:');
    interestingPaths.forEach(path => {
      console.log(`  • ${path.route.join(' -> ')} (${path.protocol}, ${path.hops} hops)`);
    });
    
    // Step 3: Find optimal mixed strategy
    console.log('\nStep 3: Finding optimal strategy...');
    const optimalStrategy = await findOptimalMixedStrategy(paths, amountIn, ONE, SEV);
    
    if (optimalStrategy) {
      const outputFormatted = ethers.utils.formatUnits(optimalStrategy.totalOutput, SEV.decimals);
      
      console.log('\n🎯 OPTIMAL STRATEGY FOUND:');
      console.log(`   Type: ${optimalStrategy.type}`);
      console.log(`   Route: ${optimalStrategy.route}`);
      console.log(`   Output: ${outputFormatted} SEV`);
      
      // Check if we achieved the target
      const actualOutput = parseFloat(outputFormatted);
      const targetOutput = 4.99;
      const difference = Math.abs(actualOutput - targetOutput);
      const percentDiff = (difference / targetOutput * 100).toFixed(2);
      
      if (actualOutput >= 4.9 && actualOutput <= 5.1) {
        console.log(`\n   ✅ SUCCESS! Output is within expected range`);
        console.log(`      Difference from target: ${percentDiff}%`);
      } else {
        console.log(`\n   ⚠️ Output differs from expected`);
        console.log(`      Expected: ~${targetOutput} SEV`);
        console.log(`      Actual: ${actualOutput} SEV`);
        console.log(`      Difference: ${percentDiff}%`);
      }
      
      // Show split details if parallel
      if (optimalStrategy.legs && optimalStrategy.legs.length > 1) {
        console.log(`\n   Split Details:`);
        optimalStrategy.legs.forEach((leg, i) => {
          const inputFormatted = ethers.utils.formatUnits(leg.input, ONE.decimals);
          const outputFormatted = ethers.utils.formatUnits(leg.output || 0, 18);
          console.log(`   ${i+1}. ${(leg.fraction * 100).toFixed(1)}% (${inputFormatted} ONE)`);
          console.log(`      Protocol: ${leg.protocol || 'unknown'}`);
          console.log(`      Output: ${outputFormatted}`);
        });
      }
      
    } else {
      console.log('❌ No optimal strategy found');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
  
  console.log('\n=== Test Complete ===\n');
}

// Run the test
testAdvancedCrossDEX().catch(console.error);