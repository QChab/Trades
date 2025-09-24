import { ethers } from 'ethers';
import { useMixedUniswapBalancer } from './useMixedUniswapBalancer.js';

/**
 * Test optimal routing for ONE -> SEV swap
 * Challenge: ONE liquidity is primarily in Balancer V3
 *           SEV liquidity is primarily in Uniswap V4
 * Solution: Multi-hop routing through WETH with protocol switching
 */

// Token configurations
const TOKENS = {
  ONE: {
    address: '0x91c65c2a9a3adfe2424ecc4a4890b8334c3a8212',
    symbol: 'ONE',
    decimals: 18
  },
  SEV: {
    address: '0x965b64ae2c04cff248e6502c10cf3a4931e1f1d9', 
    symbol: 'SEV',
    decimals: 18
  },
  WETH: {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    symbol: 'WETH',
    decimals: 18
  },
  USDC: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    decimals: 6
  },
  USDT: {
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    symbol: 'USDT',
    decimals: 6
  },
  DAI: {
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    symbol: 'DAI',
    decimals: 18
  },
  WBTC: {
    address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
    symbol: 'WBTC',
    decimals: 8
  }
};

// Trusted intermediate tokens for multi-hop routing (ordered by preference)
const TRUSTED_INTERMEDIATES = [
  TOKENS.WETH,  // Most liquid, bridges most pairs
  TOKENS.USDC,  // Stable, high liquidity
  TOKENS.USDT,  // Stable, alternative to USDC
  TOKENS.DAI,   // Stable, decentralized option
  TOKENS.WBTC   // For certain pairs
];

/**
 * Main test function for optimal ONE -> SEV routing
 */
export async function findOptimalONESEVRoute(provider, maxHops = 4, options = {}) {
  const { useUniswap = true, useBalancer = true } = options;
  
  console.log('🔍 Finding optimal route for 10 ONE -> SEV');
  console.log(`📊 Using DEXs: ${useUniswap ? 'Uniswap' : ''}${useUniswap && useBalancer ? ' + ' : ''}${useBalancer ? 'Balancer' : ''}`);
  console.log('📊 Known liquidity distribution:');
  console.log('   - ONE: Primarily in Balancer V3 (80/20 WETH/ONE pool)');
  console.log('   - SEV: Primarily in Uniswap V4 pools');
  console.log(`   - Max hops allowed: ${maxHops}`);
  console.log(`   - Trusted intermediates: ${TRUSTED_INTERMEDIATES.map(t => t.symbol).join(', ')}`);
  
  const amountIn = ethers.utils.parseUnits('10', 18); // 10 ONE tokens
  
  try {
    // Discover all possible paths up to maxHops
    console.log('\n🔎 Discovering all possible paths...');
    const allPaths = await discoverAllPaths(
      TOKENS.ONE,
      TOKENS.SEV,
      TRUSTED_INTERMEDIATES,
      maxHops,
      provider
    );
    
    console.log(`\n📊 Found ${allPaths.length} possible paths to analyze`);
    
    // Analyze each discovered path
    const analyzedRoutes = [];
    for (const path of allPaths) {
      console.log(`\n📍 Analyzing path: ${path.map(t => t.symbol).join(' → ')}`);
      const route = await analyzeMultiHopPath(path, amountIn, provider, { useUniswap, useBalancer });
      if (route) {
        analyzedRoutes.push(route);
      }
    }
    
    if (analyzedRoutes.length === 0) {
      throw new Error('No valid routes found');
    }
    
    // Compare all routes and select optimal
    console.log('\n🏆 Comparing all routes...');
    const optimalRoute = selectOptimalRoute(analyzedRoutes);
    
    // Generate execution plan
    console.log('\n🚀 Generating execution plan...');
    const executionPlan = await generateExecutionPlan(optimalRoute);
    
    return {
      optimalRoute,
      executionPlan,
      summary: generateSummary(optimalRoute),
      allAnalyzedRoutes: analyzedRoutes
    };
    
  } catch (error) {
    console.error('❌ Error finding optimal route:', error);
    throw error;
  }
}

/**
 * Discover all possible paths between two tokens using DFS
 * @param {Object} fromToken - Starting token
 * @param {Object} toToken - Target token
 * @param {Array} intermediates - List of trusted intermediate tokens
 * @param {Number} maxHops - Maximum number of hops allowed
 * @param {Object} provider - Ethereum provider
 * @returns {Array} Array of token paths
 */
async function discoverAllPaths(fromToken, toToken, intermediates, maxHops, provider) {
  const paths = [];
  
  // Direct path (1 hop)
  paths.push([fromToken, toToken]);
  
  // 2-hop paths through each intermediate
  for (const intermediate of intermediates) {
    if (intermediate.address !== fromToken.address && intermediate.address !== toToken.address) {
      paths.push([fromToken, intermediate, toToken]);
    }
  }
  
  // 3-hop paths (if maxHops >= 3)
  if (maxHops >= 3) {
    for (let i = 0; i < intermediates.length; i++) {
      for (let j = 0; j < intermediates.length; j++) {
        if (i !== j && 
            intermediates[i].address !== fromToken.address && 
            intermediates[i].address !== toToken.address &&
            intermediates[j].address !== fromToken.address && 
            intermediates[j].address !== toToken.address) {
          paths.push([fromToken, intermediates[i], intermediates[j], toToken]);
        }
      }
    }
  }
  
  // 4-hop paths (if maxHops >= 4)
  if (maxHops >= 4) {
    // Example: ONE -> WETH -> USDC -> USDT -> SEV
    for (let i = 0; i < intermediates.length; i++) {
      for (let j = 0; j < intermediates.length; j++) {
        for (let k = 0; k < intermediates.length; k++) {
          if (i !== j && j !== k && i !== k &&
              intermediates[i].address !== fromToken.address && 
              intermediates[i].address !== toToken.address &&
              intermediates[j].address !== fromToken.address && 
              intermediates[j].address !== toToken.address &&
              intermediates[k].address !== fromToken.address && 
              intermediates[k].address !== toToken.address) {
            paths.push([fromToken, intermediates[i], intermediates[j], intermediates[k], toToken]);
          }
        }
      }
    }
  }
  
  // Filter out duplicate paths and limit total paths to analyze
  const uniquePaths = [];
  const pathStrings = new Set();
  
  for (const path of paths) {
    const pathString = path.map(t => t.address).join('-');
    if (!pathStrings.has(pathString)) {
      pathStrings.add(pathString);
      uniquePaths.push(path);
    }
  }
  
  // Prioritize shorter paths and common intermediates
  uniquePaths.sort((a, b) => {
    // First by hop count
    if (a.length !== b.length) return a.length - b.length;
    
    // Then by presence of WETH (most liquid)
    const aHasWETH = a.some(t => t.symbol === 'WETH');
    const bHasWETH = b.some(t => t.symbol === 'WETH');
    if (aHasWETH && !bHasWETH) return -1;
    if (!aHasWETH && bHasWETH) return 1;
    
    return 0;
  });
  
  // Limit to top 10 most promising paths to avoid too many API calls
  return uniquePaths.slice(0, 10);
}

/**
 * Analyze a multi-hop path dynamically
 * @param {Array} path - Array of tokens representing the path
 * @param {BigNumber} amountIn - Initial input amount
 * @param {Object} provider - Ethereum provider
 * @param {Object} options - Options for DEX selection
 * @returns {Object} Analyzed route with all metrics
 */
async function analyzeMultiHopPath(path, amountIn, provider, options = {}) {
  const legs = [];
  let currentAmount = amountIn;
  let totalGas = 0;
  let totalArbitrageRisk = 0;
  
  // Process each hop in the path
  for (let i = 0; i < path.length - 1; i++) {
    const fromToken = path[i];
    const toToken = path[i + 1];
    
    console.log(`   Leg ${i + 1}: ${fromToken.symbol} → ${toToken.symbol}`);
    
    // Analyze this hop using mixed router
    const legResult = await useMixedUniswapBalancer({
      tokenInObject: fromToken,
      tokenOutObject: toToken,
      amountIn: currentAmount,
      provider,
      slippageTolerance: 0.3,
      useUniswap: options.useUniswap !== false,
      useBalancer: options.useBalancer !== false
    });
    
    if (!legResult.bestRoute) {
      console.log(`   ❌ No liquidity for ${fromToken.symbol} → ${toToken.symbol}`);
      return null;
    }
    
    const outputAmount = legResult.bestRoute.totalOutput;
    console.log(`   ✅ ${fromToken.symbol} → ${toToken.symbol}: ${formatOutput(outputAmount, toToken.decimals)} ${toToken.symbol}`);
    console.log(`      Protocol split: ${describeSplit(legResult.bestRoute)}`);
    
    legs.push({
      from: fromToken.symbol,
      to: toToken.symbol,
      fromToken,
      toToken,
      inputAmount: currentAmount,
      outputAmount,
      route: legResult.bestRoute,
      protocols: getProtocolBreakdown(legResult.bestRoute),
      priceImpact: legResult.bestRoute.metrics?.priceImpact || 0.003,
      arbitrageRisk: legResult.bestRoute.metrics?.arbitrageRisk || 0
    });
    
    // Update for next iteration
    currentAmount = outputAmount;
    totalGas += (legResult.bestRoute.estimatedGas || 150000);
    totalArbitrageRisk += (legResult.bestRoute.metrics?.arbitrageRisk || 0);
  }
  
  // Calculate compound price impact
  const totalPriceImpact = legs.reduce((acc, leg) => {
    return acc + leg.priceImpact + (acc * leg.priceImpact); // Compound effect
  }, 0);
  
  return {
    type: `multi-hop-${path.length - 1}`,
    path: path.map(t => t.symbol),
    legs,
    totalOutput: currentAmount,
    estimatedGas: totalGas,
    priceImpact: totalPriceImpact,
    metrics: {
      totalArbitrageRisk,
      hopCount: path.length - 1,
      averageImpactPerHop: totalPriceImpact / (path.length - 1)
    }
  };
}

/**
 * Select the optimal route from all analyzed options
 * Prioritizes: 1) Best output, 2) Lower arbitrage risk, 3) Fewer hops
 */
function selectOptimalRoute(routes) {
  const validRoutes = routes.filter(r => r !== null);
  
  if (validRoutes.length === 0) {
    throw new Error('No valid routes found');
  }
  
  // Sort by multiple criteria to minimize arbitrage surface
  validRoutes.sort((a, b) => {
    // Primary: Sort by output amount (higher is better)
    const outputDiff = b.totalOutput.sub(a.totalOutput);
    
    // If outputs are very close (within 0.1%), consider other factors
    const threshold = a.totalOutput.div(1000); // 0.1% threshold
    
    if (outputDiff.abs().lt(threshold)) {
      // Secondary: Prefer fewer hops (less arbitrage surface)
      const hopsA = a.path.length - 1;
      const hopsB = b.path.length - 1;
      if (hopsA !== hopsB) {
        return hopsA - hopsB; // Fewer hops is better
      }
      
      // Tertiary: Prefer routes with lower arbitrage risk
      const riskA = a.metrics?.totalArbitrageRisk || a.priceImpact || 0;
      const riskB = b.metrics?.totalArbitrageRisk || b.priceImpact || 0;
      return riskA - riskB; // Lower risk is better
    }
    
    // Primary criterion: higher output wins
    return outputDiff.gt(0) ? 1 : -1;
  });
  
  const optimal = validRoutes[0];
  
  console.log(`\n✅ Optimal route selected: ${optimal.path.join(' -> ')}`);
  console.log(`   Output: ${formatOutput(optimal.totalOutput)} SEV`);
  console.log(`   Type: ${optimal.type}`);
  console.log(`   Hops: ${optimal.path.length - 1}`);
  console.log(`   Arbitrage risk: ${optimal.metrics?.totalArbitrageRisk ? 
    (optimal.metrics.totalArbitrageRisk * 100).toFixed(3) + '%' : 'N/A'}`);
  console.log(`   Estimated gas: ${optimal.estimatedGas} (not factored in selection)`);
  
  if (optimal.legs) {
    console.log('\n   Leg breakdown:');
    optimal.legs.forEach((leg, i) => {
      console.log(`   ${i + 1}. ${leg.from} -> ${leg.to}: ${leg.protocols.join(', ')}`);
    });
  }
  
  return optimal;
}

/**
 * Generate detailed execution plan
 */
async function generateExecutionPlan(route) {
  const plan = {
    route: route.path.join(' -> '),
    type: route.type,
    expectedOutput: formatOutput(route.totalOutput),
    steps: []
  };
  
  if (route.type === 'direct') {
    plan.steps.push({
      action: 'swap',
      from: 'ONE',
      to: 'SEV',
      protocol: route.protocol,
      amount: '10 ONE'
    });
  } else if (route.legs) {
    // Multi-hop execution
    route.legs.forEach((leg, index) => {
      const protocols = leg.protocols;
      
      if (protocols.length === 1) {
        // Single protocol for this leg
        plan.steps.push({
          action: 'swap',
          from: leg.from,
          to: leg.to,
          protocol: protocols[0],
          amount: index === 0 ? '10 ONE' : 'output from previous step'
        });
      } else {
        // Mixed protocol for this leg
        plan.steps.push({
          action: 'mixed-swap',
          from: leg.from,
          to: leg.to,
          protocols: protocols,
          splits: leg.route.splits?.map(s => `${(s.percentage * 100).toFixed(1)}% ${s.protocol}`),
          amount: index === 0 ? '10 ONE' : 'output from previous step'
        });
      }
    });
  }
  
  // Add approval steps
  const approvals = new Set();
  plan.steps.forEach(step => {
    if (step.protocol === 'uniswap' || step.protocols?.includes('uniswap')) {
      approvals.add('Approve ONE/WETH/SEV for Universal Router (0x66a9...)');
    }
    if (step.protocol === 'balancer' || step.protocols?.includes('balancer')) {
      approvals.add('Approve ONE/WETH for Balancer Vault (0xBA12...)');
    }
  });
  
  plan.approvals = Array.from(approvals);
  plan.estimatedGas = route.estimatedGas;
  plan.priceImpact = route.priceImpact || 'N/A';
  
  return plan;
}

// Helper functions
function formatOutput(amount, decimals = 18) {
  return parseFloat(ethers.utils.formatUnits(amount, decimals)).toFixed(6);
}

function describeSplit(route) {
  if (!route.splits) {
    return `100% ${route.protocol || 'unknown'}`;
  }
  
  return route.splits
    .map(s => `${(s.percentage * 100).toFixed(1)}% ${s.protocol}`)
    .join(', ');
}

function getProtocolBreakdown(route) {
  if (!route.splits) {
    return [route.protocol || 'unknown'];
  }
  
  // Return unique protocols used
  return [...new Set(route.splits.map(s => s.protocol))];
}


function generateSummary(route) {
  const output = formatOutput(route.totalOutput);
  const path = route.path.join(' -> ');
  
  let protocolSummary = '';
  if (route.legs) {
    const protocols = new Set();
    route.legs.forEach(leg => {
      leg.protocols.forEach(p => protocols.add(p));
    });
    protocolSummary = `Protocols used: ${Array.from(protocols).join(', ')}`;
  } else {
    protocolSummary = `Protocol: ${route.protocol}`;
  }
  
  return `
🎯 Optimal Route Summary
========================
Input: 10 ONE
Output: ${output} SEV
Path: ${path}
${protocolSummary}
Gas estimate: ${route.estimatedGas || 'N/A'}
Price impact: ${(route.priceImpact * 100).toFixed(2)}%

Recommendation: ${getRecommendation(route)}
  `.trim();
}

function getRecommendation(route) {
  if (route.type === 'multi-hop-weth') {
    return 'Use WETH as bridge token. Balancer for ONE->WETH, Uniswap for WETH->SEV.';
  } else if (route.type === 'multi-hop-usdc') {
    return 'Alternative route through USDC. May have higher slippage.';
  } else if (route.type === 'direct') {
    return 'Direct swap available but may have limited liquidity.';
  } else {
    return 'Execute as optimized by the routing engine.';
  }
}

// Test execution
async function runTest() {
  console.log('🧪 Running ONE -> SEV optimal routing test...\n');
  
  // Mock provider for testing (replace with real provider in production)
  const provider = new ethers.providers.JsonRpcProvider('https://eth.llamarpc.com');
  
  try {
    const result = await findOptimalONESEVRoute(provider);
    console.log('\n' + result.summary);
    
    console.log('\n📋 Execution Plan:');
    console.log(JSON.stringify(result.executionPlan, null, 2));
    
    return result;
  } catch (error) {
    console.error('Test failed:', error);
    throw error;
  }
}

// Export test runner
export { runTest };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTest().then(() => {
    console.log('\n✅ Test completed successfully');
    process.exit(0);
  }).catch(error => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });
}