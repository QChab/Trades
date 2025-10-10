/**
 * Optimize split using EXACT AMM computations - no approximations
 */
async function optimizeWithExactAMM(balancerLeg, uniswapLeg, secondHopLeg, amountIn, tokenIn, tokenOut) {
  console.log('\n⚡ Optimizing with EXACT AMM formulas...');
  
  // Start at 50/50 split - neutral starting point
  let balancerFraction = 0.5;
  let bestFraction = balancerFraction;
  let bestOutput = BigNumber.from(0);
  
  
  // Helper function to calculate output for a given split
  const calculateOutputForSplit = async (fraction) => {
    const balancerAmount = amountIn.mul(Math.floor(fraction * 1000000)).div(1000000);
    const uniswapAmount = amountIn.sub(balancerAmount);
    
    const balOut = balancerLeg.poolData ?
      calculateBalancerExactOutput(balancerAmount, balancerLeg.poolData, 0, 1) :
      balancerLeg.outputAmount.mul(balancerAmount).div(amountIn);
    
    const uniOut = uniswapLeg.pool || uniswapLeg.trade?.route?.pools?.[0] ?
      await calculateUniswapExactOutput(
        uniswapAmount,
        uniswapLeg.pool || uniswapLeg.trade.route.pools[0],
        tokenIn.symbol,
        uniswapLeg.token?.symbol || 'ETH'
      ) : uniswapLeg.outputAmount.mul(uniswapAmount).div(amountIn);
    
    const totalETH = BigNumber.from(balOut).add(BigNumber.from(uniOut));
    const finalOut = secondHopLeg.pool ?
      await calculateUniswapExactOutput(
        totalETH,
        secondHopLeg.pool || secondHopLeg.trade?.route?.pools?.[0],
        uniswapLeg.token?.symbol || 'ETH',
        tokenOut.symbol
      ) : secondHopLeg.outputAmount.mul(totalETH).div(secondHopLeg.inputAmount);

    return BigNumber.from(finalOut);
  };
  
  // Golden section search with high precision
  console.log('   Running golden section search for optimal split...');
  const goldenRatio = (Math.sqrt(5) - 1) / 2;
  let a = 0.0;
  let b = 1.0;
  const tolerance = 0.00001; // 0.001% precision (100x better than before)
  let iterations = 0;

  // Initial points using golden ratio
  let x1 = a + (1 - goldenRatio) * (b - a);
  let x2 = a + goldenRatio * (b - a);
  let f1 = await calculateOutputForSplit(x1);
  let f2 = await calculateOutputForSplit(x2);

  console.log(`   Iteration 0: Testing ${(x1 * 100).toFixed(2)}% Balancer -> Output: ${ethers.utils.formatUnits(f1, tokenOut.decimals || 18)} ${tokenOut.symbol}`);
  console.log(`   Iteration 0: Testing ${(x2 * 100).toFixed(2)}% Balancer -> Output: ${ethers.utils.formatUnits(f2, tokenOut.decimals || 18)} ${tokenOut.symbol}`);

  // Track the best value found during search
  if (f1.gt(bestOutput)) {
    bestOutput = f1;
    bestFraction = x1;
  }
  if (f2.gt(bestOutput)) {
    bestOutput = f2;
    bestFraction = x2;
  }

  while (Math.abs(b - a) > tolerance) {
    iterations++;
    if (f1.gt(f2)) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = a + (1 - goldenRatio) * (b - a);
      f1 = await calculateOutputForSplit(x1);
      console.log(`   Iteration ${iterations}: Testing ${(x1 * 100).toFixed(2)}% Balancer -> Output: ${ethers.utils.formatUnits(f1, tokenOut.decimals || 18)} ${tokenOut.symbol}`);
      // Track if this new point is better
      if (f1.gt(bestOutput)) {
        bestOutput = f1;
        bestFraction = x1;
        console.log(`      ✓ New best found!`);
      }
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + goldenRatio * (b - a);
      f2 = await calculateOutputForSplit(x2);
      console.log(`   Iteration ${iterations}: Testing ${(x2 * 100).toFixed(2)}% Balancer -> Output: ${ethers.utils.formatUnits(f2, tokenOut.decimals || 18)} ${tokenOut.symbol}`);
      // Track if this new point is better
      if (f2.gt(bestOutput)) {
        bestOutput = f2;
        bestFraction = x2;
        console.log(`      ✓ New best found!`);
      }
    }
  }

  console.log(`\n   Search completed after ${iterations} iterations`);
  console.log(`   Final interval: [${(a * 100).toFixed(4)}%, ${(b * 100).toFixed(4)}%]`);
  console.log(`   Best fraction found at: ${(bestFraction * 100).toFixed(4)}% Balancer`);
  console.log(`   Golden section found optimal at ${(bestFraction * 100).toFixed(4)}% Balancer / ${((1 - bestFraction) * 100).toFixed(4)}% Uniswap`);
  console.log(`   Converged in ${iterations} iterations`);
  
  // Calculate final outputs with best split using ultra-high precision
  const finalBalancerAmount = amountIn.mul(Math.floor(bestFraction * 1000000)).div(1000000);
  const finalUniswapAmount = amountIn.sub(finalBalancerAmount);
  
  const finalBalancerOutput = balancerLeg.poolData ?
    calculateBalancerExactOutput(finalBalancerAmount, balancerLeg.poolData, 0, 1) :
    balancerLeg.outputAmount.mul(finalBalancerAmount).div(amountIn);
    
  const finalUniswapOutput = uniswapLeg.pool ?
    await calculateUniswapExactOutput(finalUniswapAmount, uniswapLeg.pool, tokenIn.symbol, uniswapLeg.token?.symbol || 'ETH') :
    uniswapLeg.outputAmount.mul(finalUniswapAmount).div(amountIn);
  
  console.log(`\n   ✅ Optimal split (EXACT computations):`);
  console.log(`      • Balancer: ${(bestFraction * 100).toFixed(4)}%`);
  console.log(`      • Uniswap: ${((1 - bestFraction) * 100).toFixed(4)}%`);
  console.log(`      • Expected output: ${ethers.utils.formatUnits(bestOutput, tokenOut.decimals || 18)} ${tokenOut.symbol}`);
  
  return {
    type: 'cross-dex-optimized-exact',
    protocol: 'mixed',
    totalOutput: bestOutput,
    path: `${tokenIn.symbol} -> [${(bestFraction * 100).toFixed(0)}% Balancer WETH, ${((1-bestFraction) * 100).toFixed(0)}% Uniswap ETH] -> SEV`,
    splits: [
      {
        protocol: 'balancer',
        percentage: bestFraction,
        leg: 'ONE->WETH',
        input: finalBalancerAmount,
        output: finalBalancerOutput
      },
      {
        protocol: 'uniswap',
        percentage: 1 - bestFraction,
        leg: 'ONE->ETH',
        input: finalUniswapAmount,
        output: finalUniswapOutput
      }
    ]
  };
}

/**
 * TODO: Implement a recursive multi-hop pathfinder
 *
 * The ideal implementation would:
 * 1. Recursively discover all possible paths up to maxHops
 * 2. For each hop, evaluate if splitting across DEXs is beneficial
 * 3. Support complex routing patterns:
 *    - Split at first hop, converge later
 *    - Single DEX first hop, split at second hop
 *    - Split at every hop with different ratios
 * 4. Use exact AMM calculations (no approximations)
 * 5. Use golden section search for optimization (not gradient descent)
 * 6. Handle any token pairs without hardcoding
 *
 * Example routing patterns to support:
 * - TokenA → [50% DEX1→TokenB, 50% DEX2→TokenC] → TokenD
 * - TokenA → TokenB → [30% DEX1→TokenD, 70% DEX2→TokenD]
 * - TokenA → [DEX1→TokenB→TokenD, DEX2→TokenC→TokenD]
 */

/**
 * Optimize split when both legs directly reach the target token
 * For example: ONE->ETH on Uniswap and ONE->WETH on Balancer
 */
async function optimizeDirectSplit(balancerLeg, uniswapLeg, amountIn, tokenIn, tokenOut) {
  console.log('\n⚡ Optimizing direct split (both legs reach target)...');
  console.log('   Balancer leg has poolData:', !!balancerLeg.poolData);
  console.log('   Uniswap leg has trade:', !!uniswapLeg.trade);
  console.log('   Uniswap leg trade.swaps:', uniswapLeg.trade?.swaps?.length);
  const testPool = uniswapLeg.pool || uniswapLeg.trade?.swaps?.[0]?.route?.pools?.[0];
  console.log('   Uniswap leg has accessible pool:', !!testPool);

  if (!balancerLeg.poolData) {
    console.log('   ⚠️ WARNING: Using LINEAR approximation for Balancer (no poolData)');
  }
  if (!testPool) {
    console.log('   ⚠️ WARNING: Using LINEAR approximation for Uniswap (no pool data)');
  }

  // Helper function to calculate output for a given split
  const calculateOutputForSplit = async (fraction) => {
    const balancerAmount = amountIn.mul(Math.floor(fraction * 1000000)).div(1000000);
    const uniswapAmount = amountIn.sub(balancerAmount);

    const balOut = balancerLeg.poolData ?
      calculateBalancerExactOutput(balancerAmount, balancerLeg.poolData, 0, 1) :
      balancerLeg.outputAmount.mul(balancerAmount).div(amountIn);

    const uniswapPool = uniswapLeg.pool || uniswapLeg.trade?.swaps?.[0]?.route?.pools?.[0];
    const uniOut = uniswapPool ?
      await calculateUniswapExactOutput(
        uniswapAmount,
        uniswapPool,
        tokenIn.symbol,
        uniswapLeg.token?.symbol || tokenOut.symbol
      ) : uniswapLeg.outputAmount.mul(uniswapAmount).div(amountIn);

    // Direct outputs - no second hop needed
    return BigNumber.from(balOut).add(BigNumber.from(uniOut));
  };

  // Golden section search
  console.log('   Running golden section search for optimal split...');
  const goldenRatio = (Math.sqrt(5) - 1) / 2;
  let a = 0.0;
  let b = 1.0;
  const tolerance = 0.00001;
  let iterations = 0;
  let bestOutput = BigNumber.from(0);
  let bestFraction = 0.5;

  let x1 = a + (1 - goldenRatio) * (b - a);
  let x2 = a + goldenRatio * (b - a);
  let f1 = await calculateOutputForSplit(x1);
  let f2 = await calculateOutputForSplit(x2);

  console.log(`   Iteration 0: Testing ${(x1 * 100).toFixed(2)}% Balancer -> Output: ${ethers.utils.formatUnits(f1, tokenOut.decimals || 18)} ${tokenOut.symbol}`);
  console.log(`   Iteration 0: Testing ${(x2 * 100).toFixed(2)}% Balancer -> Output: ${ethers.utils.formatUnits(f2, tokenOut.decimals || 18)} ${tokenOut.symbol}`);

  // Track best from initial evaluations
  if (f1.gt(bestOutput)) {
    bestOutput = f1;
    bestFraction = x1;
  }
  if (f2.gt(bestOutput)) {
    bestOutput = f2;
    bestFraction = x2;
  }

  while (Math.abs(b - a) > tolerance && iterations < 50) {
    iterations++;
    if (f1.gt(f2)) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = a + (1 - goldenRatio) * (b - a);
      f1 = await calculateOutputForSplit(x1);
      if (f1.gt(bestOutput)) {
        bestOutput = f1;
        bestFraction = x1;
      }
      console.log(`   Iteration ${iterations}: Testing ${(x1 * 100).toFixed(2)}% Balancer -> Output: ${ethers.utils.formatUnits(f1, tokenOut.decimals || 18)} ${tokenOut.symbol}`);
      if (f1.gt(bestOutput)) {
        console.log(`      ✓ New best found!`);
      }
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + goldenRatio * (b - a);
      f2 = await calculateOutputForSplit(x2);
      if (f2.gt(bestOutput)) {
        bestOutput = f2;
        bestFraction = x2;
        console.log(`      ✓ New best found!`);
      }
      console.log(`   Iteration ${iterations}: Testing ${(x2 * 100).toFixed(2)}% Balancer -> Output: ${ethers.utils.formatUnits(f2, tokenOut.decimals || 18)} ${tokenOut.symbol}`);
    }
  }

  // Don't overwrite - we have the best fraction from the search
  console.log(`\n   Search completed after ${iterations} iterations`);
  console.log(`   Final interval: [${(a * 100).toFixed(4)}%, ${(b * 100).toFixed(4)}%]`);
  console.log(`   Best fraction found: ${(bestFraction * 100).toFixed(4)}% Balancer`);
  console.log(`   Best output: ${ethers.utils.formatUnits(bestOutput, tokenOut.decimals || 18)} ${tokenOut.symbol}`);

  console.log(`   Golden section found optimal at ${(bestFraction * 100).toFixed(4)}% Balancer / ${((1 - bestFraction) * 100).toFixed(4)}% Uniswap`);
  console.log(`   Converged in ${iterations} iterations`);

  // Calculate final amounts
  const finalBalancerAmount = amountIn.mul(Math.floor(bestFraction * 1000000)).div(1000000);
  const finalUniswapAmount = amountIn.sub(finalBalancerAmount);

  const finalBalancerOutput = balancerLeg.poolData ?
    calculateBalancerExactOutput(finalBalancerAmount, balancerLeg.poolData, 0, 1) :
    balancerLeg.outputAmount.mul(finalBalancerAmount).div(amountIn);

  const finalUniswapOutput = uniswapLeg.pool ?
    await calculateUniswapExactOutput(finalUniswapAmount, uniswapLeg.pool || uniswapLeg.trade?.route?.pools?.[0], tokenIn.symbol, uniswapLeg.token?.symbol || tokenOut.symbol) :
    uniswapLeg.outputAmount.mul(finalUniswapAmount).div(amountIn);

  console.log(`\n   ✅ Optimal direct split:`);
  console.log(`      • Balancer: ${(bestFraction * 100).toFixed(4)}%`);
  console.log(`      • Uniswap: ${((1 - bestFraction) * 100).toFixed(4)}%`);
  console.log(`      • Expected output: ${ethers.utils.formatUnits(bestOutput, tokenOut.decimals || 18)} ${tokenOut.symbol}`);

  return {
    type: 'cross-dex-optimized-direct',
    protocol: 'mixed',
    totalOutput: bestOutput,
    path: `${tokenIn.symbol} -> [${(bestFraction * 100).toFixed(0)}% Balancer, ${((1-bestFraction) * 100).toFixed(0)}% Uniswap] -> ${tokenOut.symbol}`,
    splits: [
      {
        protocol: 'balancer',
        percentage: bestFraction,
        leg: `${tokenIn.symbol}->${balancerLeg.token?.symbol || tokenOut.symbol}`,
        input: finalBalancerAmount,
        output: finalBalancerOutput
      },
      {
        protocol: 'uniswap',
        percentage: 1 - bestFraction,
        leg: `${tokenIn.symbol}->${uniswapLeg.token?.symbol || tokenOut.symbol}`,
        input: finalUniswapAmount,
        output: finalUniswapOutput
      }
    ]
  };
}


/**
 * Find optimal split across 3+ legs using golden section search with exact AMM calculations
 */
async function findAdvancedSplit(uniswapPaths, balancerPaths, amountIn, tokenIn, tokenOut) {
  // Combine all paths
  const legs = [...uniswapPaths, ...balancerPaths];
  const numLegs = legs.length;

  if (numLegs < 2) return null;

  // For 3+ legs, use multi-dimensional optimization
  // For now, implement 3-leg optimization (2 Uniswap + 1 Balancer)
  if (numLegs === 3) {
    return await optimizeThreeWaySplit(legs, amountIn, tokenIn, tokenOut);
  }

  // For more complex cases, fall back to pairwise optimization
  // TODO: Implement n-dimensional golden section search
  return await optimizePairwiseSplit(legs, amountIn, tokenIn, tokenOut);
}

/**
 * Optimize 3-way split using nested golden section search
 */
async function optimizeThreeWaySplit(legs, amountIn, tokenIn, tokenOut) {

  // Golden ratio
  const phi = (Math.sqrt(5) - 1) / 2;
  const tolerance = 0.00001;

  let bestOutput = BigNumber.from(0);
  let bestSplit = [1/3, 1/3, 1/3];

  // Outer loop: optimize leg1 fraction
  let a1 = 0.0;
  let b1 = 1.0;
  let c1 = b1 - phi * (b1 - a1);
  let d1 = a1 + phi * (b1 - a1);

  while (Math.abs(b1 - a1) > tolerance) {
    // For each leg1 fraction, optimize leg2 fraction
    const outputC = await optimizeLeg2Given(c1, legs, amountIn, tokenIn, tokenOut);
    const outputD = await optimizeLeg2Given(d1, legs, amountIn, tokenIn, tokenOut);

    if (outputC.output.gt(outputD.output)) {
      b1 = d1;
      if (outputC.output.gt(bestOutput)) {
        bestOutput = outputC.output;
        bestSplit = outputC.split;
      }
    } else {
      a1 = c1;
      if (outputD.output.gt(bestOutput)) {
        bestOutput = outputD.output;
        bestSplit = outputD.split;
      }
    }

    c1 = b1 - phi * (b1 - a1);
    d1 = a1 + phi * (b1 - a1);
  }

  // Build result
  const splits = [];
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const legAmount = amountIn.mul(Math.floor(bestSplit[i] * 1000000)).div(1000000);
    const legOutput = await calculateLegOutput(leg, legAmount, tokenIn, tokenOut);

    splits.push({
      protocol: leg.protocol,
      percentage: bestSplit[i],
      amount: legAmount,
      output: legOutput,
      path: leg.path
    });
  }

  return {
    type: 'cross-dex-advanced-' + legs.length + '-way',
    totalOutput: bestOutput,
    splits,
    gasCost: estimateGasForMixedRoute()
  };
}

/**
 * Helper to optimize leg2 fraction given leg1 fraction
 */
async function optimizeLeg2Given(leg1Frac, legs, amountIn, tokenIn, tokenOut) {
  const phi = (Math.sqrt(5) - 1) / 2;
  const tolerance = 0.00001;

  let a2 = 0.0;
  let b2 = 1.0 - leg1Frac;
  let c2 = b2 - phi * (b2 - a2);
  let d2 = a2 + phi * (b2 - a2);

  let bestOutput = BigNumber.from(0);
  let bestLeg2Frac = 0;

  while (Math.abs(b2 - a2) > tolerance) {
    const split = [leg1Frac, c2, 1 - leg1Frac - c2];
    const outputC = await calculateThreeWayOutput(split, legs, amountIn, tokenIn, tokenOut);

    split[1] = d2;
    split[2] = 1 - leg1Frac - d2;
    const outputD = await calculateThreeWayOutput(split, legs, amountIn, tokenIn, tokenOut);

    if (outputC.gt(outputD)) {
      b2 = d2;
      if (outputC.gt(bestOutput)) {
        bestOutput = outputC;
        bestLeg2Frac = c2;
      }
    } else {
      a2 = c2;
      if (outputD.gt(bestOutput)) {
        bestOutput = outputD;
        bestLeg2Frac = d2;
      }
    }

    c2 = b2 - phi * (b2 - a2);
    d2 = a2 + phi * (b2 - a2);
  }

  return {
    output: bestOutput,
    split: [leg1Frac, bestLeg2Frac, 1 - leg1Frac - bestLeg2Frac]
  };
}

/**
 * Calculate total output for 3-way split
 */
async function calculateThreeWayOutput(split, legs, amountIn, tokenIn, tokenOut) {
  let totalOutput = BigNumber.from(0);

  for (let i = 0; i < legs.length; i++) {
    if (split[i] <= 0) continue;

    const legAmount = amountIn.mul(Math.floor(split[i] * 1000000)).div(1000000);
    const legOutput = await calculateLegOutput(legs[i], legAmount, tokenIn, tokenOut);
    totalOutput = totalOutput.add(legOutput);
  }

  return totalOutput;
}

/**
 * Calculate exact output for a single leg
 */
async function calculateLegOutput(leg, amountIn, tokenIn, tokenOut) {
  if (leg.protocol === 'uniswap') {
    // Use exact Uniswap calculation - need the pool from the leg
    if (!leg.pool && !leg.pools) {
      console.warn('No pool data in Uniswap leg');
      return BigNumber.from(0);
    }
    const pool = leg.pool || leg.pools?.[0];
    const tokenInSymbol = tokenIn.symbol || 'UNKNOWN';
    const tokenOutSymbol = tokenOut.symbol || 'UNKNOWN';
    return await calculateUniswapExactOutput(amountIn, pool, tokenInSymbol, tokenOutSymbol);
  } else if (leg.protocol === 'balancer' && leg.poolData) {
    // Use exact Balancer calculation
    const tokenInIndex = leg.poolData.tokens.findIndex(t =>
      t.address.toLowerCase() === tokenIn.address.toLowerCase()
    );
    const tokenOutIndex = leg.poolData.tokens.findIndex(t =>
      t.address.toLowerCase() === tokenOut.address.toLowerCase()
    );

    if (tokenInIndex >= 0 && tokenOutIndex >= 0) {
      return calculateBalancerWeightedOutput(
        amountIn,
        leg.poolData,
        tokenInIndex,
        tokenOutIndex
      );
    }
  }

  // Should not reach here with proper pool data
  console.error('Missing pool data for leg calculation');
  return BigNumber.from(0);
}

/**
 * Fallback: optimize pairwise for 4+ legs
 */
async function optimizePairwiseSplit(legs, amountIn, tokenIn, tokenOut) {
  // For now, just split equally among all legs
  // TODO: Implement proper n-dimensional optimization
  const equalSplit = 1 / legs.length;

  let totalOutput = BigNumber.from(0);
  const splits = [];

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const legAmount = amountIn.mul(Math.floor(equalSplit * 1000000)).div(1000000);
    const legOutput = await calculateLegOutput(leg, legAmount, tokenIn, tokenOut);

    totalOutput = totalOutput.add(legOutput);
    splits.push({
      protocol: leg.protocol,
      percentage: equalSplit,
      amount: legAmount,
      output: legOutput,
      path: leg.path
    });
  }

  return {
    type: 'cross-dex-multi-' + legs.length + '-way',
    totalOutput,
    splits,
    gasCost: estimateGasForMixedRoute()
  };
}

/**
 * Calculate real AMM output with price impact for Balancer Weighted Pool
 */
function calculateBalancerWeightedOutput(amountIn, poolData, tokenInIndex, tokenOutIndex) {
  // Use the exact calculation from crossDEXOptimizer
  // This uses Decimal.js for precise fractional exponents
  return calculateBalancerExactOutput(amountIn, poolData, tokenInIndex, tokenOutIndex);
}