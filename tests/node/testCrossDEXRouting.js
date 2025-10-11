import { ethers } from 'ethers';
import { useMixedUniswapBalancer } from '../../src/renderer/utils/useMixedUniswapBalancer.js';
import { getV4SDK } from './uniswapV4ESM.js';

/**
 * Test cross-DEX routing for ONE -> ETH
 * Testing mixed strategy optimization with potential 1-hop on each DEX
 */
async function testCrossDEXRouting() {
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

  const ETH = {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    decimals: 18
  };

  const SEV = {
    address: '0x965b64ae2c04cff248e6502c10cf3a4931e1f1d9',
    symbol: 'SEV',
    decimals: 18
  };

  const USDC = {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    decimals: 6  // USDC has 6 decimals
  };

  const AAVE = {
    address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
    symbol: 'AAVE',
    decimals: 18
  };

  const INCH = {
    address: '0x111111111117dc0aa78b770fa6a738034120c302',
    symbol: '1INCH',
    decimals: 18
  };

  const rawAmountIn = '10'
  const amountIn = ethers.utils.parseUnits(rawAmountIn, 18);


  const tokensTraded = {
    tokenInObject: ONE,
    tokenOutObject: SEV,
  }
  console.log(`=== Testing Cross-DEX Routing (${tokensTraded.tokenInObject.symbol} -> ${tokensTraded.tokenOutObject.symbol}- ===\n`);
  console.log(`Input: ${rawAmountIn} ${tokensTraded.tokenInObject.symbol}`);
  console.log('----------------------------------------\n');

  try {
    const result = await useMixedUniswapBalancer({
      ...tokensTraded,
      amountIn,
      provider,
      slippageTolerance: 0.5,
      maxHops: 1,
      useUniswap: true,
      useBalancer: true
    });
    
    if (result && result.bestRoute) {
      const outputFormatted = ethers.utils.formatUnits(result.bestRoute.totalOutput, tokensTraded.tokenOutObject.decimals);
      console.log('\n✅ Best route found:');
      console.log(`   Type: ${result.bestRoute.type}`);
      console.log(`   Output: ${outputFormatted} ${tokensTraded.tokenOutObject.symbol}`);
      
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
          console.log(`   • Balancer: ${balPercent}%`);
          console.log(`   • Uniswap: ${uniPercent}%`);
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
      
      // Check if a mixed strategy was considered
      const actualOutput = parseFloat(outputFormatted);
      console.log(`\n   📊 Total output: ${actualOutput} ${tokensTraded.tokenOutObject.symbol}`);

      // Show all route types that were evaluated
      if (result.allRoutes) {
        console.log('\n   📈 Routes evaluated:');
        result.allRoutes.forEach(route => {
          const routeOutput = ethers.utils.formatUnits(route.totalOutput, tokensTraded.tokenOutObject.decimals);
          console.log(`      ${route.type}: ${routeOutput} ${tokensTraded.tokenOutObject.symbol}`);
        });
      }

      // Show the execution plan
      // if (result.executionPlan) {
      //   console.log('\n   📋 Execution Plan:');
      //   console.log('   ================');
      //   console.log(JSON.stringify(result.executionPlan, null, 2));
      // } else {
      //   console.log('\n   ⚠️ No execution plan generated');
      // }
      
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