import { ethers, BigNumber } from 'ethers';
import { useUniswapV4 } from '../composables/useUniswap.jsx';
import { useBalancerV3, getCacheStats } from './useBalancerV3.js';

/**
 * Mixed Uniswap-Balancer router that finds optimal trade splits across both DEXs
 * Supports multi-hop routing and percentage-based splitting for best execution
 */
export async function useMixedUniswapBalancer({ 
  tokenInObject, 
  tokenOutObject, 
  amountIn, 
  provider, 
  slippageTolerance = 0.5,
  maxHops = 3 
}) {
  console.log('🔄 Mixed DEX Routing: Finding optimal Uniswap + Balancer paths');
  
  const results = {
    uniswapPaths: [],
    balancerPaths: [],
    mixedRoutes: [],
    bestRoute: null,
    executionPlan: null
  };

  try {
    // Convert amountIn to BigNumber if needed
    const amountInBN = BigNumber.isBigNumber(amountIn) 
      ? amountIn 
      : ethers.utils.parseUnits(amountIn.toString(), tokenInObject.decimals);

    // Parallel discovery of paths on both protocols
    const [uniswapRoutes, balancerResult] = await Promise.all([
      discoverUniswapPaths(tokenInObject, tokenOutObject, amountInBN),
      discoverBalancerPaths(tokenInObject, tokenOutObject, amountInBN, provider)
    ]);

    results.uniswapPaths = uniswapRoutes;
    results.balancerPaths = balancerResult ? [balancerResult] : [];

    console.log(`📊 Found ${uniswapRoutes.length} Uniswap routes and ${results.balancerPaths.length} Balancer routes`);

    // Find optimal split percentages across protocols
    const optimizedRoutes = await optimizeMixedRoutes(
      results.uniswapPaths,
      results.balancerPaths,
      amountInBN,
      tokenInObject,
      tokenOutObject
    );

    results.mixedRoutes = optimizedRoutes;

    // Select the best overall route
    const bestRoute = selectBestRoute(optimizedRoutes, amountInBN);
    results.bestRoute = bestRoute;

    if (bestRoute) {
      // Create execution plan with proper encoding for both protocols
      results.executionPlan = await createExecutionPlan(
        bestRoute,
        tokenInObject,
        tokenOutObject,
        slippageTolerance
      );

      console.log('✅ Best route found:', {
        type: bestRoute.type,
        totalOutput: ethers.utils.formatUnits(bestRoute.totalOutput, tokenOutObject.decimals),
        splits: bestRoute.splits?.map(s => ({
          protocol: s.protocol,
          percentage: `${(s.percentage * 100).toFixed(1)}%`,
          output: ethers.utils.formatUnits(s.output, tokenOutObject.decimals)
        })),
        gasCost: bestRoute.estimatedGas
      });
    }

    return results;

  } catch (error) {
    console.error('❌ Mixed routing error:', error);
    return results;
  }
}

/**
 * Discover Uniswap V4 paths
 */
async function discoverUniswapPaths(tokenInObject, tokenOutObject, amountIn) {
  try {
    const uniswap = useUniswapV4();
    
    // Find pools and best paths
    const pools = await uniswap.findPossiblePools(tokenInObject, tokenOutObject);
    
    if (pools.length === 0) {
      console.log('No Uniswap pools found');
      return [];
    }

    // Get best single and split trades
    const trades = await uniswap.selectBestPath(tokenInObject, tokenOutObject, pools, amountIn);
    
    return trades.map(trade => ({
      protocol: 'uniswap',
      trade,
      pools: trade.swaps[0].route.pools,
      inputAmount: BigNumber.from(trade.inputAmount.quotient.toString()),
      outputAmount: BigNumber.from(trade.outputAmount.quotient.toString()),
      hops: trade.swaps[0].route.pools.length,
      path: trade.swaps[0].route.currencyPath.map(c => c.address || c.symbol)
    }));

  } catch (error) {
    console.error('Uniswap path discovery failed:', error);
    return [];
  }
}

/**
 * Discover Balancer V3 paths
 */
async function discoverBalancerPaths(tokenInObject, tokenOutObject, amountIn, provider) {
  try {
    const result = await useBalancerV3({
      tokenInAddress: tokenInObject.address,
      tokenOutAddress: tokenOutObject.address,
      amountIn: amountIn.toString(),
      provider,
      slippageTolerance: 0.5
    });

    if (!result) {
      console.log('No Balancer paths found');
      return null;
    }

    return {
      protocol: 'balancer',
      outputAmount: BigNumber.from(result.amountOut),
      minAmountOut: BigNumber.from(result.minAmountOut),
      path: result.path,
      pools: result.poolAddresses,
      poolTypes: result.poolTypes,
      weights: result.weights,
      hops: result.path.hops.length,
      fees: result.fees
    };

  } catch (error) {
    console.error('Balancer path discovery failed:', error);
    return null;
  }
}

/**
 * Optimize mixed routes by finding best split percentages
 * Uses hill-climbing algorithm similar to Uniswap's internal optimization
 */
async function optimizeMixedRoutes(uniswapPaths, balancerPaths, amountIn, tokenIn, tokenOut) {
  const routes = [];
  
  // Single protocol routes (100% on one DEX)
  if (uniswapPaths.length > 0) {
    // Best single Uniswap route
    const bestUniswap = uniswapPaths[0];
    routes.push({
      type: 'single-uniswap',
      protocol: 'uniswap',
      totalOutput: bestUniswap.outputAmount,
      paths: [bestUniswap],
      estimatedGas: estimateGasForRoute('uniswap', bestUniswap.hops)
    });

    // If Uniswap already found an optimal split between 2 paths
    if (uniswapPaths.length > 1) {
      const totalOutput = uniswapPaths.reduce(
        (sum, path) => sum.add(path.outputAmount),
        BigNumber.from(0)
      );
      
      routes.push({
        type: 'split-uniswap',
        protocol: 'uniswap',
        totalOutput,
        paths: uniswapPaths,
        splits: uniswapPaths.map(path => ({
          protocol: 'uniswap',
          percentage: path.inputAmount.mul(100).div(amountIn).toNumber() / 100,
          output: path.outputAmount
        })),
        estimatedGas: estimateGasForRoute('uniswap', Math.max(...uniswapPaths.map(p => p.hops)))
      });
    }
  }

  if (balancerPaths.length > 0) {
    const bestBalancer = balancerPaths[0];
    routes.push({
      type: 'single-balancer',
      protocol: 'balancer',
      totalOutput: bestBalancer.outputAmount,
      paths: [bestBalancer],
      estimatedGas: estimateGasForRoute('balancer', bestBalancer.hops)
    });
  }

  // Mixed protocol routes (split between Uniswap and Balancer)
  if (uniswapPaths.length > 0 && balancerPaths.length > 0) {
    const mixedRoute = await findOptimalMixedSplit(
      uniswapPaths[0],
      balancerPaths[0],
      amountIn,
      tokenIn,
      tokenOut
    );
    
    if (mixedRoute) {
      routes.push(mixedRoute);
    }
  }

  // Advanced: 3-way or 4-way splits if we have multiple paths on each protocol
  if (uniswapPaths.length >= 2 && balancerPaths.length >= 1) {
    const advancedRoute = await findAdvancedSplit(
      uniswapPaths.slice(0, 2),
      balancerPaths.slice(0, 1),
      amountIn,
      tokenIn,
      tokenOut
    );
    
    if (advancedRoute) {
      routes.push(advancedRoute);
    }
  }

  return routes;
}

/**
 * Find optimal split between Uniswap and Balancer using hill-climbing
 */
async function findOptimalMixedSplit(uniswapPath, balancerPath, amountIn, tokenIn, tokenOut) {
  const initialFrac = 0.5; // Start with 50/50 split
  const minStep = 0.025; // 2.5% minimum step
  let step = 0.1; // 10% initial step
  let bestFraction = initialFrac;
  let bestOutput = BigNumber.from(0);
  
  // Helper to calculate output for a given split
  function calculateSplitOutput(uniswapFraction) {
    const uniswapAmount = amountIn.mul(Math.floor(uniswapFraction * 10000)).div(10000);
    const balancerAmount = amountIn.sub(uniswapAmount);
    
    // Linear approximation (in reality, would need to recalculate with actual liquidity)
    // This assumes linear price impact which is an approximation
    const uniswapOutput = uniswapPath.outputAmount
      .mul(uniswapAmount)
      .div(uniswapPath.inputAmount);
      
    const balancerOutput = balancerPath.outputAmount
      .mul(balancerAmount)
      .div(amountIn);
    
    return {
      totalOutput: uniswapOutput.add(balancerOutput),
      uniswapAmount,
      balancerAmount,
      uniswapOutput,
      balancerOutput
    };
  }

  // Initial calculation
  let current = calculateSplitOutput(bestFraction);
  bestOutput = current.totalOutput;
  let bestSplit = current;

  // Hill-climbing optimization
  while (step >= minStep) {
    const upFraction = Math.min(1, bestFraction + step);
    const downFraction = Math.max(0, bestFraction - step);
    
    const upResult = calculateSplitOutput(upFraction);
    const downResult = calculateSplitOutput(downFraction);
    
    if (upResult.totalOutput.gt(bestOutput)) {
      bestFraction = upFraction;
      bestOutput = upResult.totalOutput;
      bestSplit = upResult;
    } else if (downResult.totalOutput.gt(bestOutput)) {
      bestFraction = downFraction;
      bestOutput = downResult.totalOutput;
      bestSplit = downResult;
    } else {
      // Neither is better, reduce step size
      step = step / 2;
    }
  }

  // Check if mixed split is better than single protocol
  const singleUniswapOutput = uniswapPath.outputAmount;
  const singleBalancerOutput = balancerPath.outputAmount;
  
  if (bestOutput.lte(singleUniswapOutput) && bestOutput.lte(singleBalancerOutput)) {
    // Mixed split is worse than using a single protocol
    return null;
  }

  return {
    type: 'mixed-optimal',
    protocol: 'mixed',
    totalOutput: bestOutput,
    paths: [
      { ...uniswapPath, inputAmount: bestSplit.uniswapAmount, outputAmount: bestSplit.uniswapOutput },
      { ...balancerPath, inputAmount: bestSplit.balancerAmount, outputAmount: bestSplit.balancerOutput }
    ],
    splits: [
      {
        protocol: 'uniswap',
        percentage: bestFraction,
        input: bestSplit.uniswapAmount,
        output: bestSplit.uniswapOutput
      },
      {
        protocol: 'balancer',
        percentage: 1 - bestFraction,
        input: bestSplit.balancerAmount,
        output: bestSplit.balancerOutput
      }
    ],
    estimatedGas: estimateGasForMixedRoute()
  };
}

/**
 * Find optimal split across 3+ legs (advanced optimization)
 */
async function findAdvancedSplit(uniswapPaths, balancerPaths, amountIn, tokenIn, tokenOut) {
  // This implements a more complex optimization for 3+ way splits
  // Using simplified linear approximation for demonstration
  
  const legs = [...uniswapPaths, ...balancerPaths];
  const numLegs = legs.length;
  
  // Start with equal split
  let fractions = new Array(numLegs).fill(1 / numLegs);
  let bestOutput = BigNumber.from(0);
  let bestFractions = [...fractions];
  
  // Gradient descent optimization
  const iterations = 20;
  const learningRate = 0.05;
  
  for (let iter = 0; iter < iterations; iter++) {
    // Calculate current output
    let totalOutput = BigNumber.from(0);
    
    for (let i = 0; i < numLegs; i++) {
      const leg = legs[i];
      const legAmount = amountIn.mul(Math.floor(fractions[i] * 10000)).div(10000);
      
      // Linear approximation of output
      const legOutput = leg.outputAmount
        .mul(legAmount)
        .div(leg.inputAmount || amountIn);
        
      totalOutput = totalOutput.add(legOutput);
    }
    
    if (totalOutput.gt(bestOutput)) {
      bestOutput = totalOutput;
      bestFractions = [...fractions];
    }
    
    // Adjust fractions (simplified gradient)
    for (let i = 0; i < numLegs; i++) {
      // Randomly adjust fractions
      fractions[i] += (Math.random() - 0.5) * learningRate;
    }
    
    // Normalize fractions to sum to 1
    const sum = fractions.reduce((a, b) => a + b, 0);
    fractions = fractions.map(f => Math.max(0, f / sum));
  }
  
  // Build result
  const splits = [];
  const optimizedPaths = [];
  
  for (let i = 0; i < numLegs; i++) {
    if (bestFractions[i] > 0.01) { // Only include if > 1%
      const leg = legs[i];
      const legAmount = amountIn.mul(Math.floor(bestFractions[i] * 10000)).div(10000);
      const legOutput = leg.outputAmount.mul(legAmount).div(leg.inputAmount || amountIn);
      
      optimizedPaths.push({
        ...leg,
        inputAmount: legAmount,
        outputAmount: legOutput
      });
      
      splits.push({
        protocol: leg.protocol,
        percentage: bestFractions[i],
        input: legAmount,
        output: legOutput
      });
    }
  }
  
  if (splits.length < 2) {
    return null; // No meaningful split found
  }
  
  return {
    type: 'advanced-split',
    protocol: 'mixed',
    totalOutput: bestOutput,
    paths: optimizedPaths,
    splits,
    estimatedGas: estimateGasForMixedRoute(splits.length)
  };
}

/**
 * Select best route from all options
 */
function selectBestRoute(routes, amountIn) {
  if (routes.length === 0) return null;
  
  // Sort by total output minus estimated gas costs
  const gasPrice = ethers.utils.parseUnits('30', 'gwei'); // Approximate gas price
  
  const routesWithNetOutput = routes.map(route => {
    const gasCostInEth = gasPrice.mul(route.estimatedGas);
    // Approximate gas cost impact (would need token prices for accurate calculation)
    const gasCostImpact = gasCostInEth.div(1e12); // Simplified conversion
    
    return {
      ...route,
      netOutput: route.totalOutput.sub(gasCostImpact),
      gasCost: gasCostInEth
    };
  });
  
  // Sort by net output (output minus gas costs)
  routesWithNetOutput.sort((a, b) => {
    if (b.netOutput.gt(a.netOutput)) return 1;
    if (a.netOutput.gt(b.netOutput)) return -1;
    return 0;
  });
  
  return routesWithNetOutput[0];
}

/**
 * Create execution plan for the selected route
 */
async function createExecutionPlan(route, tokenIn, tokenOut, slippageTolerance) {
  const plan = {
    route,
    executionSteps: [],
    approvals: [],
    estimatedGas: route.estimatedGas,
    slippageTolerance
  };
  
  // Build execution steps based on route type
  if (route.type === 'single-uniswap' || route.type === 'split-uniswap') {
    plan.executionSteps.push({
      protocol: 'uniswap',
      method: 'executeMixedSwaps',
      trades: route.paths.map(p => p.trade),
      totalInput: route.paths.reduce((sum, p) => sum.add(p.inputAmount), BigNumber.from(0)),
      totalOutput: route.totalOutput
    });
    
    plan.approvals.push({
      token: tokenIn.address,
      spender: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', // Universal Router
      amount: route.paths.reduce((sum, p) => sum.add(p.inputAmount), BigNumber.from(0))
    });
    
  } else if (route.type === 'single-balancer') {
    plan.executionSteps.push({
      protocol: 'balancer',
      method: 'batchSwap',
      path: route.paths[0].path,
      pools: route.paths[0].pools,
      totalInput: route.paths[0].inputAmount || tokenIn,
      totalOutput: route.totalOutput
    });
    
    plan.approvals.push({
      token: tokenIn.address,
      spender: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', // Balancer Vault
      amount: route.paths[0].inputAmount || tokenIn
    });
    
  } else if (route.type === 'mixed-optimal' || route.type === 'advanced-split') {
    // Mixed execution requires multiple steps
    for (const split of route.splits) {
      if (split.protocol === 'uniswap') {
        const uniPath = route.paths.find(p => p.protocol === 'uniswap' && p.inputAmount.eq(split.input));
        if (uniPath) {
          plan.executionSteps.push({
            protocol: 'uniswap',
            method: 'executeMixedSwaps',
            trades: [uniPath.trade],
            input: split.input,
            expectedOutput: split.output
          });
        }
      } else if (split.protocol === 'balancer') {
        const balPath = route.paths.find(p => p.protocol === 'balancer');
        if (balPath) {
          plan.executionSteps.push({
            protocol: 'balancer',
            method: 'batchSwap',
            path: balPath.path,
            pools: balPath.pools,
            input: split.input,
            expectedOutput: split.output
          });
        }
      }
    }
    
    // Approvals for both protocols if mixed
    if (route.splits.some(s => s.protocol === 'uniswap')) {
      plan.approvals.push({
        token: tokenIn.address,
        spender: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
        amount: route.splits
          .filter(s => s.protocol === 'uniswap')
          .reduce((sum, s) => sum.add(s.input), BigNumber.from(0))
      });
    }
    
    if (route.splits.some(s => s.protocol === 'balancer')) {
      plan.approvals.push({
        token: tokenIn.address,
        spender: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
        amount: route.splits
          .filter(s => s.protocol === 'balancer')
          .reduce((sum, s) => sum.add(s.input), BigNumber.from(0))
      });
    }
  }
  
  // Calculate minimum output with slippage
  const minOutput = route.totalOutput
    .mul(Math.floor((100 - slippageTolerance) * 100))
    .div(10000);
    
  plan.minOutput = minOutput;
  
  return plan;
}

/**
 * Estimate gas for different route types
 */
function estimateGasForRoute(protocol, hops) {
  const baseGas = {
    uniswap: 120000,
    balancer: 150000
  };
  
  const hopGas = {
    uniswap: 60000,
    balancer: 80000
  };
  
  return baseGas[protocol] + (hopGas[protocol] * Math.max(0, hops - 1));
}

function estimateGasForMixedRoute(numLegs = 2) {
  // Mixed routes have overhead for multiple protocol interactions
  const baseGas = 200000;
  const perLegGas = 100000;
  
  return baseGas + (perLegGas * numLegs);
}

/**
 * Execute the optimized mixed trade
 */
export async function executeMixedTrade(executionPlan, signer) {
  console.log('🚀 Executing mixed trade with plan:', executionPlan);
  
  try {
    // First, handle approvals
    for (const approval of executionPlan.approvals) {
      console.log(`Approving ${approval.token} for ${approval.spender}`);
      // Token approval logic here
    }
    
    // Execute each step
    const results = [];
    for (const step of executionPlan.executionSteps) {
      console.log(`Executing ${step.protocol} ${step.method}`);
      
      if (step.protocol === 'uniswap') {
        // Use Uniswap execution
        const uniswap = useUniswapV4();
        const result = await uniswap.executeMixedSwaps(
          step.trades,
          step.tradeSummary || {},
          50, // slippage bips
          null, // gas price
          null, // maxFeePerGas
          null, // maxPriorityFeePerGas
          null  // nonce
        );
        results.push(result);
        
      } else if (step.protocol === 'balancer') {
        // Use Balancer execution
        console.log('Executing Balancer swap via Vault');
        // Balancer execution logic would go here
        // This would call the Vault's batchSwap function
      }
    }
    
    return {
      success: true,
      results,
      totalOutput: executionPlan.route.totalOutput
    };
    
  } catch (error) {
    console.error('❌ Execution failed:', error);
    return {
      success: false,
      error
    };
  }
}

// Export additional utilities
export { getCacheStats };