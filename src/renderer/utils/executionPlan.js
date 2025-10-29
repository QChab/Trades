import { ethers } from 'ethers';
import {
  encodeUniswapV4Swap,
  createUniswapV4Step,
  createUniswapV4UseAllStep,
  UNIVERSAL_ROUTER
} from './uniswapV4Encoder.js';
import {
  encodeBalancerSwap,
  createBalancerUseAllStep,
  BALANCER_ROUTER
} from './balancerEncoder.js';

// Constants
const ETH_ADDRESS = '0x0000000000000000000000000000000000000000';
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const { BigNumber } = ethers;
const balancerEncoderAddress = '0x9fAb0aEaA4B54C2Ab94d1a2414CF96B4102eFc4B';
const uniswapEncoderAddress = '0x11d264629b6277a6fABb2870318982CC9353fffb';  // V4 with correct action codes

/**
 * Create execution plan for the selected route
 * Now async to support intermediate amount calculations
 * @param {Object} route - The route object from routing optimizer
 * @param {Object} tokenIn - Input token object
 * @param {Object} tokenOut - Output token object
 * @param {number} slippageTolerance - Slippage tolerance percentage
 * @param {BigNumber} inputAmount - Optional input amount in wei (required for normalized routes)
 */
export async function createExecutionPlan(route, tokenIn, tokenOut, slippageTolerance, inputAmount = null) {
  const plan = {
    route,
    executionSteps: [],
    approvals: [],
    estimatedGas: route.estimatedGas,
    slippageTolerance
  };

  // Normalize route to have poolExecutionStructure if it doesn't have one
  // OR if we have inputAmount but the structure doesn't have inputAmounts set
  const needsNormalization = !route.poolExecutionStructure ||
    (inputAmount && route.poolExecutionStructure &&
     route.poolExecutionStructure.levels?.[0]?.pools?.[0]?.inputAmount === undefined);

  if (needsNormalization) {
    console.log(`   🔄 ${route.poolExecutionStructure ? 'Re-normalizing with inputAmount' : 'Normalizing route'}`);
    route = normalizeRouteToPoolStructure(route, tokenIn, tokenOut, inputAmount);
  }

  if (route.type === 'optimized-multi-route-split' || route.poolExecutionStructure) {
    // Use pool-based execution structure from optimizer
    if (!route.poolExecutionStructure) {
      throw new Error('Pool execution structure missing from optimized route');
    }

    const poolStructure = route.poolExecutionStructure;

    console.log('\n📊 Pool-Based Execution Plan:');
    console.log(`   Total Execution Levels: ${poolStructure.levels.length}`);
    console.log(`   Total Unique Pools: ${poolStructure.poolMap.size}`);

    // Build execution steps from pool structure
    poolStructure.levels.forEach((level, levelIdx) => {
      console.log(`\n   Level ${level.level}:`);

      level.pools.forEach((pool, poolIdx) => {
        const step = {
          level: level.level,
          poolAddress: pool.poolAddress,
          poolId: pool.poolId,
          protocol: pool.protocol,
          inputToken: pool.inputToken,
          outputToken: pool.outputToken,
          percentage: pool.percentage,
          inputAmount: pool.inputAmount,              // Exact input in wei
          expectedOutput: pool.expectedOutput,        // Expected output in wei
          wrapOperation: pool.wrapOperation || 0,      // Wrap/unwrap operation code
          useAllBalance: pool.shouldUseAllBalance || false,  // Mark if should use all balance
          method: pool.protocol === 'uniswap' ? 'exactInputSingle' : 'singleSwap',
          // Include execution details
          ...(pool.protocol === 'uniswap' && {
            trade: pool.trade
          }),
          ...(pool.protocol === 'balancer' && {
            path: pool.path
          })
        };

        plan.executionSteps.push(step);

        // Extract token symbols for display (handle both string and object formats)
        const inputTokenSymbol = typeof pool.inputToken === 'string' ? pool.inputToken : (pool.inputToken?.symbol || 'UNKNOWN');
        const outputTokenSymbol = typeof pool.outputToken === 'string' ? pool.outputToken : (pool.outputToken?.symbol || 'UNKNOWN');

        // Get pool identifier (poolAddress for Balancer, poolId for Uniswap)
        const poolIdentifier = pool.poolAddress || pool.poolId || 'unknown';

        console.log(`      ${poolIdx + 1}. ${pool.protocol}: ${inputTokenSymbol}→${outputTokenSymbol}`);
        console.log(`         Pool: ${poolIdentifier}`);
        console.log(`         Allocation: ${(pool.percentage * 100).toFixed(3)}% of level ${level.level} input${pool.shouldUseAllBalance ? ' [USE ALL]' : ''}`);

        // Display wrap/unwrap operation if applicable
        if (pool.wrapOperation && pool.wrapOperation !== 0) {
          const wrapOperationNames = {
            1: 'Wrap ETH→WETH before swap',
            2: 'Wrap ETH→WETH after swap',
            3: 'Unwrap WETH→ETH before swap',
            4: 'Unwrap WETH→ETH after swap'
          };
          console.log(`         Conversion: ${wrapOperationNames[pool.wrapOperation]} (code ${pool.wrapOperation})`);
        }

        // Display exact input/output amounts if available
        if (pool.inputAmount) {
          // Determine decimal places for input token
          const inputDecimals = { 'ETH': 18, 'WETH': 18, 'USDC': 6, 'USDT': 6, 'DAI': 18, 'WBTC': 8, 'AAVE': 18 }[inputTokenSymbol] || 18;
          const inputFormatted = ethers.utils.formatUnits(pool.inputAmount, inputDecimals);
          console.log(`         Input: ${inputFormatted} ${inputTokenSymbol} (${pool.inputAmount.toString()} wei)`);
        }

        if (pool.expectedOutput) {
          // Determine decimal places for output token
          const outputDecimals = { 'ETH': 18, 'WETH': 18, 'USDC': 6, 'USDT': 6, 'DAI': 18, 'WBTC': 8, '1INCH': 18 }[outputTokenSymbol] || 18;
          const outputFormatted = ethers.utils.formatUnits(pool.expectedOutput, outputDecimals);
          console.log(`         Expected Output: ${outputFormatted} ${outputTokenSymbol} (${pool.expectedOutput.toString()} wei)`);
        }

        if (pool.routeIndices && pool.routeIndices.length > 1) {
          console.log(`         Converges ${pool.routeIndices.length} routes`);
        }
      });
    });
    console.log('');
  } else {
    throw new Error('Unknown route type, cannot create execution plan')
  }

  // Calculate minimum output with slippage
  const minOutput = route.totalOutput
    .mul(Math.floor((100 - slippageTolerance) * 100))
    .div(10000);
    
  plan.minOutput = minOutput;

  // Add summary for better visibility
  if (plan.executionSteps.length > 0) {
    plan.summary = {
      totalSteps: plan.executionSteps.length,
      protocols: [...new Set(plan.executionSteps.map(s => s.protocol))],
      estimatedOutput: ethers.utils.formatUnits(route.totalOutput, tokenOut.decimals || 18),
      minOutput: ethers.utils.formatUnits(minOutput, tokenOut.decimals || 18),
      tokenOut: tokenOut.symbol
    };
  }

  return plan;
}

/**
 * Convert execution plan to encoder-based contract arguments
 * @param {Object} executionPlan - The execution plan from createExecutionPlan
 * @param {Object} tokenIn - Input token object
 * @param {Object} tokenOut - Output token object
 * @param {string} walletBundlerAddress - Address of the WalletBundler contract
 * @param {number} slippagePercent - Slippage tolerance in percent (default 0.5%)
 * @returns {Object} Arguments for the WalletBundler encodeAndExecuteaaaaaYops function
 */
export function createEncoderExecutionPlan(
  executionPlan,
  tokenIn,
  tokenOut,
  slippagePercent = 0.5
) {
  const encoderTargets = [];
  const encoderData = [];
  const wrapOperations = [];

  // CRITICAL: DO NOT sort or re-order execution steps!
  // The execution plan from the optimizer already has the correct order
  // and the shouldUseAllBalance flags are already set correctly
  // console.log('\n🔄 Processing execution steps in original order (as defined by optimizer)');

  // Process each execution step in the order they appear
  executionPlan.executionSteps.forEach((step, stepIndex) => {
    // OPTIMIZATION: Always use exact amounts, determine encoding strategy via flag
    const inputAmount = step.inputAmount || BigNumber.from(0);

    // CRITICAL: Only use "useAll" encoder for level 1+ (intermediate hops)
    // Level 0 always has exact split amounts from optimizer - no encoder overhead!
    const shouldUseAllBalance = step.level > 0 && step.useAllBalance;

    if (shouldUseAllBalance) {
      console.log(`   🔄 Step at level ${step.level} will use encoder (useAllBalance)`);
    } else if (step.level === 0) {
      console.log(`   📊 Level 0 step: using exact amount ${inputAmount.toString()} (no encoder)`);
    }

    // Map of common token symbols to addresses
    const TOKEN_ADDRESSES = {
      'ETH': ETH_ADDRESS,
      'WETH': WETH_ADDRESS,
      'USDC': '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      'USDT': '0xdac17f958d2ee523a2206206994597c13d831ec7',
      'DAI': '0x6b175474e89094c44da98b954eedeac495271d0f',
      'WBTC': '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
      'AAVE': '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
      '1INCH': '0x111111111117dc0aa78b770fa6a738034120c302'
    };

    // Determine actual token addresses
    // Handle both object {address, symbol} and string formats
    let inputTokenAddress;
    if (step.inputToken?.address) {
      inputTokenAddress = step.inputToken.address;
    } else if (typeof step.inputToken === 'string') {
      inputTokenAddress = TOKEN_ADDRESSES[step.inputToken] || tokenIn.address;
    } else {
      inputTokenAddress = tokenIn.address;
    }

    let outputTokenAddress;
    if (step.outputToken?.address) {
      outputTokenAddress = step.outputToken.address;
    } else if (typeof step.outputToken === 'string') {
      outputTokenAddress = TOKEN_ADDRESSES[step.outputToken] || tokenOut.address;
    } else {
      outputTokenAddress = tokenOut.address;
    }

    // CRITICAL: Adjust inputTokenAddress based on wrap operations
    // When we wrap/unwrap BEFORE the swap, the token used in the swap changes
    const wrapOp = step.wrapOperation || 0;

    if (wrapOp === 1) {
      // Wrap ETH to WETH before swap → the swap uses WETH as input
      inputTokenAddress = WETH_ADDRESS;
      console.log('   🔄 WrapOp=1: Adjusting inputToken to WETH (swap uses WETH after wrapping)');
    } else if (wrapOp === 3) {
      // Unwrap WETH to ETH before swap → the swap uses ETH as input
      inputTokenAddress = ETH_ADDRESS;
      console.log('   🔄 WrapOp=3: Adjusting inputToken to ETH (swap uses ETH after unwrapping)');
    }

    // Calculate minimum amount out with slippage for this step
    let minAmountOut = BigNumber.from(0);
    if (step.expectedOutput || step.output) {
      const expectedOut = step.expectedOutput || step.output || BigNumber.from(0);
      // Apply slippage: minAmount = expectedAmount * (100 - slippagePercent) / 100
      minAmountOut = expectedOut.mul(Math.floor((100 - slippagePercent) * 100)).div(10000);
    } else {
      // For intermediate hops, we don't enforce a minimum output (use 0)
      // since they use all balance from the previous step anyway
      console.log(`   ⚠️  Step ${step.level} has no expectedOutput, using minAmountOut = 0 (intermediate hop)`);
      minAmountOut = BigNumber.from(0);
    }

    // Extract protocol-specific data
    let poolId, fee, currency0, currency1, tickSpacing, hooks, zeroForOne;

    // console.log(`   📍 Step ${stepIndex}: protocol="${step.protocol}" (type: ${typeof step.protocol}), useAllBalance=${step.useAllBalance}, inputToken=${getTokenSymbol(step.inputToken)}, outputToken=${getTokenSymbol(step.outputToken)}`);
    // DEBUG: Check protocol matching
    // console.log(`      Testing protocol: step.protocol === 'balancer' → ${step.protocol === 'balancer'}`);
    // console.log(`      Testing protocol: step.protocol === 'uniswap' → ${step.protocol === 'uniswap'}`);

    if (step.protocol === 'balancer') {
      // For V3, poolId is just a 20-byte address
      poolId = step.poolAddress || step.poolId || step.path?.hops?.[0]?.poolAddress || '0x0000000000000000000000000000000000000000';
    } else if (step.protocol === 'uniswap') {
      // Extract V4 PoolKey data from Uniswap trade
      const tradeRoute = step.trade?.route || step.trade?.swaps?.[0]?.route;
      const pool = tradeRoute?.pools?.[0];

      if (pool?.poolKey) {
        // V4 pool with full PoolKey
        currency0 = pool.poolKey.currency0;
        currency1 = pool.poolKey.currency1;
        fee = pool.poolKey.fee;
        tickSpacing = pool.poolKey.tickSpacing;
        hooks = pool.poolKey.hooks;

        // Determine swap direction: zeroForOne = true if inputToken is currency0
        zeroForOne = inputTokenAddress.toLowerCase() === currency0.toLowerCase();
      } else {
        // Fallback for V3 pools (shouldn't happen if using V4)
        throw new Error('Uniswap pool missing poolKey data - V4 pools required');
      }
    }

    // Add wrap operation to array
    wrapOperations.push(step.wrapOperation || 0);

    // Create encoder calldata
    if (step.protocol === 'balancer') {
      if (shouldUseAllBalance) {
        // USE_ALL: Use encoder contract to query balance (level 1+)
        console.log(`      ✅ Pushing Balancer encoder (USE_ALL): ${balancerEncoderAddress}`);
        encoderTargets.push(balancerEncoderAddress);

        // Use helper function to create USE_ALL step
        const balancerStep = createBalancerUseAllStep(
          balancerEncoderAddress,
          poolId,  // V3 uses address as pool identifier
          inputTokenAddress,
          outputTokenAddress === ETH_ADDRESS ? WETH_ADDRESS : outputTokenAddress,
          minAmountOut,
          step.wrapOperation || 0
        );

        encoderData.push(balancerStep.encoderData);
      } else {
        // EXACT AMOUNT: Encode swapSingleTokenExactIn directly in JS (zero overhead!)
        console.log(`      ✅ Pushing Balancer direct encoding (exact amount): address(1)`);
        encoderTargets.push('0x0000000000000000000000000000000000000001');  // Flag: data is pre-encoded

        const { data } = encodeBalancerSwap(
          poolId,  // V3 uses address as pool identifier
          inputTokenAddress,
          outputTokenAddress === ETH_ADDRESS ? WETH_ADDRESS : outputTokenAddress,
          inputAmount,
          minAmountOut
        );

        encoderData.push(data);
      }
    } else if (step.protocol === 'uniswap') {
      if (shouldUseAllBalance) {
        // USE_ALL: Use encoder contract to query balance (level 1+)
        console.log(`      ✅ Pushing Uniswap encoder (USE_ALL): ${uniswapEncoderAddress}`);
        encoderTargets.push(uniswapEncoderAddress);

        // Build poolKey object for createUniswapV4UseAllStep
        const poolKey = {
          currency0: currency0,
          currency1: currency1,
          fee: fee,
          tickSpacing: tickSpacing,
          hooks: hooks
        };

        // Use helper function to create USE_ALL step
        const uniswapStep = createUniswapV4UseAllStep(
          uniswapEncoderAddress,
          inputTokenAddress,
          poolKey,
          minAmountOut,
          step.wrapOperation || 0
        );

        encoderData.push(uniswapStep.encoderData);
      } else {
        // EXACT AMOUNT: Encode unlock callback format directly in JS (zero overhead!)
        console.log(`      ✅ Pushing Uniswap direct encoding (exact amount): address(0)`);
        encoderTargets.push(ethers.constants.AddressZero);  // Flag: data is pre-encoded

        // Build poolKey object for encodeUniswapV4Swap
        const poolKey = {
          currency0: currency0,
          currency1: currency1,
          fee: fee,
          tickSpacing: tickSpacing,
          hooks: hooks
        };

        // Determine output token address
        const outputTokenForSwap = outputTokenAddress === ETH_ADDRESS ? ETH_ADDRESS : outputTokenAddress;

        // Encode unlock callback format directly using pure JS function
        const { data } = encodeUniswapV4Swap(
          inputTokenAddress,
          outputTokenForSwap,
          poolKey,
          inputAmount,
          minAmountOut
        );

        // Push pre-encoded unlock format (WalletBundler will use as-is!)
        encoderData.push(data);
        // console.log(`         📦 Pre-encoded unlock format (${data.length} bytes) - zero contract overhead!`);
      }
    }
  });

  console.log(`\n✅ Finished processing ${executionPlan.executionSteps.length} steps`);
  console.log(`   encoderTargets array length: ${encoderTargets.length}`);
  console.log(`   encoderTargets content:`, encoderTargets);
  console.log(`   Expected Uniswap encoder: ${uniswapEncoderAddress}`);
  console.log(`   Expected Balancer encoder: ${balancerEncoderAddress}`);

  // Calculate total input amount from level 0 execution steps
  const totalInputAmount = executionPlan.executionSteps
    .filter(step => step.level === 0)
    .reduce((sum, step) => {
      const stepAmount = step.inputAmount || BigNumber.from(0);
      return sum.add(stepAmount);
    }, BigNumber.from(0));

  // Fallback to route properties if no execution steps with input amounts
  const fromAmount = totalInputAmount.gt(0)
    ? totalInputAmount
    : (executionPlan.route.inputAmount ||
       executionPlan.route.paths?.[0]?.inputAmount ||
       executionPlan.route.splits?.reduce((sum, s) => sum.add(s.input || s.amount), BigNumber.from(0)) ||
       BigNumber.from(0));

  // fromToken represents what the USER sends TO the contract
  // (NOT what the contract uses internally after wrapping/unwrapping)
  const fromToken = tokenIn.address || ETH_ADDRESS;

  return {
    fromToken,
    fromAmount,
    toToken: tokenOut.address || ETH_ADDRESS,
    encoderTargets,
    encoderData,
    wrapOperations,  // CRITICAL: Array of wrap/unwrap operations
    // Additional metadata
    metadata: {
      routeType: executionPlan.route.type,
      expectedOutput: executionPlan.route.totalOutput,
      slippageTolerance: slippagePercent,
      steps: executionPlan.executionSteps.length
    }
  };
}

/**
 * Helper function to mark split legs in execution plan
 * Sorts trades by allocation percentage and marks highest share as useAll
 * @param {Object} executionPlan - The original execution plan
 * @returns {Object} Modified plan with split indices
 */
export function markSplitLegs(executionPlan) {
  const modifiedPlan = { ...executionPlan };

  // Group steps by their input token, hop number, and path
  const tokenUsage = new Map(); // Track how each token is used

  modifiedPlan.executionSteps.forEach((step, index) => {
    const inputTokenKey = `${step.inputToken?.address || step.inputToken?.symbol || step.inputToken || 'UNKNOWN'}`;
    const hop = step.hop || step.level || Math.floor(index / 2); // Estimate hop if not provided

    if (!tokenUsage.has(inputTokenKey)) {
      tokenUsage.set(inputTokenKey, []);
    }
    tokenUsage.get(inputTokenKey).push({ step, index, hop });
  });

  // Analyze each token's usage
  tokenUsage.forEach((usages, tokenKey) => {
    if (usages.length === 1) {
      // Single usage - use all available balance
      usages[0].step.useAllBalance = true;
      usages[0].step.splitIndex = 0;
      usages[0].step.splitTotal = 1;
    } else {
      // Multiple usages of the same token
      // Check if they're in the same hop (parallel split) or different hops (sequential)
      const hopGroups = new Map();
      usages.forEach(usage => {
        const hop = usage.hop;
        if (!hopGroups.has(hop)) {
          hopGroups.set(hop, []);
        }
        hopGroups.get(hop).push(usage);
      });

      hopGroups.forEach((hopUsages) => {
        if (hopUsages.length === 1) {
          // Single usage in this hop - use all available
          hopUsages[0].step.useAllBalance = true;
          hopUsages[0].step.splitIndex = 0;
          hopUsages[0].step.splitTotal = 1;
        } else {
          // Multiple parallel usages in same hop - this is a split
          // CRITICAL: Sort by allocation percentage (lowest to highest)
          hopUsages.sort((a, b) => {
            const aPercentage = a.step.percentage || 0;
            const bPercentage = b.step.percentage || 0;

            // If percentage is available, use it
            if (aPercentage !== bPercentage) {
              return aPercentage - bPercentage; // Ascending order (lowest to highest)
            }

            // Otherwise, compare inputAmount
            const aAmount = a.step.inputAmount || a.step.input || BigNumber.from(0);
            const bAmount = b.step.inputAmount || b.step.input || BigNumber.from(0);

            if (BigNumber.isBigNumber(aAmount) && BigNumber.isBigNumber(bAmount)) {
              if (aAmount.lt(bAmount)) return -1;
              if (aAmount.gt(bAmount)) return 1;
              return 0;
            }

            // Fallback to original order
            return a.index - b.index;
          });

          // Mark splits with sorted indices
          hopUsages.forEach((usage, splitIndex) => {
            usage.step.splitIndex = splitIndex;
            usage.step.splitTotal = hopUsages.length;
            // LAST leg (highest share) uses all remaining balance
            usage.step.useAllBalance = (splitIndex === hopUsages.length - 1);
          });
        }
      });
    }
  });

  return modifiedPlan;
}

/**
 * Determine if a step should use all available balance
 * Based on the token flow analysis and allocation percentages
 */
export function shouldUseAllBalance(step, executionPlan) {
  // Special cases where we always use all balance:

  // 1. If this is the only consumer of an intermediate token
  // (e.g., tokenB in path: tokenA -> tokenB -> tokenC)
  if (step.isOnlyConsumer) {
    return true;
  }

  // 2. If marked as last leg of a split (highest share)
  if (step.useAllBalance) {
    return true;
  }

  // 3. If input token is unique to this path
  // (e.g., tokenD in: tokenA -> tokenD -> tokenC, when another path goes tokenA -> tokenB -> tokenC)
  const inputToken = step.inputToken?.address || step.inputToken;
  const allStepsUsingToken = executionPlan.executionSteps.filter(s =>
    (s.inputToken?.address || s.inputToken) === inputToken
  );
  if (allStepsUsingToken.length === 1) {
    return true;
  }

  // 4. Check if this step has the highest allocation percentage for its input token at this level
  const stepLevel = step.level || step.hop || 0;
  const stepsAtSameLevel = allStepsUsingToken.filter(s =>
    (s.level || s.hop || 0) === stepLevel
  );

  if (stepsAtSameLevel.length > 1) {
    // Find the step with the highest percentage
    const highestPercentageStep = stepsAtSameLevel.reduce((max, current) => {
      const maxPercentage = max.percentage || 0;
      const currentPercentage = current.percentage || 0;

      if (currentPercentage > maxPercentage) return current;
      if (currentPercentage < maxPercentage) return max;

      // If percentages are equal, compare inputAmount
      const maxAmount = max.inputAmount || max.input || BigNumber.from(0);
      const currentAmount = current.inputAmount || current.input || BigNumber.from(0);

      if (BigNumber.isBigNumber(maxAmount) && BigNumber.isBigNumber(currentAmount)) {
        return currentAmount.gt(maxAmount) ? current : max;
      }

      return max;
    });

    // If this step is the highest, it should use all remaining balance
    if (highestPercentageStep === step) {
      return true;
    }
  }

  return false;
}

/**
 * Normalize any route type to have a poolExecutionStructure
 * Converts single-path routes (balancer-path-1, uniswap-path-1, etc) to pool-based structure
 * @param {Object} route - The route to normalize
 * @param {Object} tokenIn - Input token object
 * @param {Object} tokenOut - Output token object
 * @param {BigNumber} inputAmount - The input amount in wei
 */
function normalizeRouteToPoolStructure(route, tokenIn, tokenOut, inputAmount = null) {
  console.log(`\n📐 Normalizing route type "${route.type}" to pool execution structure...`);
  // Simple single-path routes (balancer-path-1, uniswap-path-1, etc.)
  if (route.type && (route.type.startsWith('balancer-path-') || route.type.startsWith('uniswap-path-'))) {
    const path = route.paths && route.paths[0];
    if (!path) {
      throw new Error(`Route ${route.type} missing paths array`);
    }

    // Determine the input amount from multiple sources (use ?? for BigNumber safety)
    const firstHopInputAmount = inputAmount ?? path.inputAmount ?? route.inputAmount;
    console.log(`   Final firstHopInputAmount: ${firstHopInputAmount ? firstHopInputAmount.toString() : 'undefined'}`);

    const pools = [];

    if (route.protocol === 'balancer') {
      // Balancer single path - could be multi-hop
      if (path.path && path.path.hops) {
        path.path.hops.forEach((hop, hopIndex) => {
          // For Balancer V3, the pool address IS the pool ID
          const balancerPoolId = hop.poolAddress || hop.poolData?.address || hop.poolData?.id || '';

          // Detect if we need to wrap/unwrap ETH<->WETH for first hop
          let wrapOp = 0;
          if (hopIndex === 0) {
            const poolExpectsWETH = hop.tokenIn?.toLowerCase() === WETH_ADDRESS.toLowerCase();
            const poolExpectsETH = hop.tokenIn?.toLowerCase() === ETH_ADDRESS.toLowerCase();
            const userSendsETH = tokenIn.address === ETH_ADDRESS;
            const userSendsWETH = tokenIn.address === WETH_ADDRESS;

            if (poolExpectsWETH && userSendsETH) {
              wrapOp = 1; // Wrap ETH to WETH before swap
            } else if (poolExpectsETH && userSendsWETH) {
              wrapOp = 3; // Unwrap WETH to ETH before swap
            }
          }

          // Extract token objects for intermediate hops
          let hopInputToken, hopOutputToken;
          if (hopIndex === 0) {
            hopInputToken = { symbol: tokenIn.symbol, address: tokenIn.address };
          } else {
            const inputTokenData = hop.poolData?.tokens?.find(t => t.address.toLowerCase() === hop.tokenIn.toLowerCase());
            hopInputToken = inputTokenData ? { symbol: inputTokenData.symbol, address: inputTokenData.address } : { symbol: 'UNKNOWN', address: hop.tokenIn };
          }

          if (hopIndex === path.path.hops.length - 1) {
            hopOutputToken = { symbol: tokenOut.symbol, address: tokenOut.address };
          } else {
            const outputTokenData = hop.poolData?.tokens?.find(t => t.address.toLowerCase() === hop.tokenOut.toLowerCase());
            hopOutputToken = outputTokenData ? { symbol: outputTokenData.symbol, address: outputTokenData.address } : { symbol: 'UNKNOWN', address: hop.tokenOut };
          }

          pools.push({
            poolAddress: balancerPoolId,
            poolId: balancerPoolId,
            protocol: 'balancer',
            inputToken: hopInputToken,
            outputToken: hopOutputToken,
            percentage: 1.0,
            inputAmount: hopIndex === 0 ? firstHopInputAmount : undefined,
            expectedOutput: hopIndex === path.path.hops.length - 1 ? path.outputAmount : undefined,
            wrapOperation: wrapOp,
            shouldUseAllBalance: true,
            path: path.path
          });
        });
      }
    } else if (route.protocol === 'uniswap') {
      // Uniswap single path
      // Use path.pools (already extracted) or fallback to trade.swaps[0].route.pools
      const poolId = path.pools?.[0]?.poolId || path.trade?.swaps?.[0]?.route?.pools?.[0]?.poolId || '';

      pools.push({
        poolAddress: poolId,
        poolId: poolId,
        protocol: 'uniswap',
        inputToken: { symbol: tokenIn.symbol, address: tokenIn.address },
        outputToken: { symbol: tokenOut.symbol, address: tokenOut.address },
        percentage: 1.0,
        inputAmount: firstHopInputAmount,
        expectedOutput: path.outputAmount,
        wrapOperation: 0,
        shouldUseAllBalance: true,
        trade: path.trade
      });
    }

    // Create pool execution structure
    const poolMap = new Map();
    pools.forEach((pool, idx) => {
      poolMap.set(`pool-${idx}`, pool);
    });

    route.poolExecutionStructure = {
      levels: pools.map((pool, idx) => ({
        level: idx,
        pools: [pool]
      })),
      poolMap
    };

    console.log(`   ✓ Converted to ${pools.length} execution level(s)`);
  }

  // Cross-DEX routes (cross-dex-uniswap-uniswap, cross-dex-uniswap-balancer, etc.)
  // These are optimized routes that should already have poolExecutionStructure from the optimizer
  else if (route.type && route.type.startsWith('cross-dex-')) {
    console.log(`   ⚠️ Cross-DEX route should have poolExecutionStructure from optimizer`);

    // If it doesn't have one, try to build it from route.legs or route.splits
    if (!route.poolExecutionStructure && route.legs) {
      console.log(`   Building poolExecutionStructure from route.legs...`);

      const pools = [];
      route.legs.forEach((leg, legIndex) => {
        const protocol = leg.protocol.toLowerCase();

        // Extract BOTH token symbols AND addresses from trade/route data
        let inputToken = { symbol: null, address: null };
        let outputToken = { symbol: null, address: null };

        if (protocol === 'uniswap' && leg.trade) {
          // Extract from Uniswap trade object
          const tradeRoute = leg.trade.route || leg.trade.swaps?.[0]?.route;
          inputToken.symbol = tradeRoute?.input?.symbol || leg.trade.inputAmount?.currency?.symbol;
          inputToken.address = tradeRoute?.input?.address || leg.trade.inputAmount?.currency?.address;
          outputToken.symbol = tradeRoute?.output?.symbol || leg.trade.outputAmount?.currency?.symbol;
          outputToken.address = tradeRoute?.output?.address || leg.trade.outputAmount?.currency?.address;
        } else if (protocol === 'balancer' && leg.path) {
          // Extract from Balancer path object
          const hops = leg.path.hops || leg.path.path?.hops;
          if (hops && hops.length > 0) {
            const firstHop = hops[0];
            const lastHop = hops[hops.length - 1];

            // Find input token from first hop
            const inputTokenData = firstHop.poolData?.tokens?.find(t =>
              t.address.toLowerCase() === firstHop.tokenIn?.toLowerCase()
            );
            if (inputTokenData) {
              inputToken.symbol = inputTokenData.symbol;
              inputToken.address = inputTokenData.address;
            }

            // Find output token from last hop
            const outputTokenData = lastHop.poolData?.tokens?.find(t =>
              t.address.toLowerCase() === lastHop.tokenOut?.toLowerCase()
            );
            if (outputTokenData) {
              outputToken.symbol = outputTokenData.symbol;
              outputToken.address = outputTokenData.address;
            }
          }
        }

        // Fallback logic for input token
        if (!inputToken.symbol || !inputToken.address) {
          if (legIndex === 0) {
            inputToken = { symbol: tokenIn.symbol, address: tokenIn.address };
          } else if (pools[legIndex - 1]) {
            // Use previous leg's output as this leg's input
            inputToken = pools[legIndex - 1].outputToken;
          } else {
            inputToken = leg.inputToken || { symbol: 'UNKNOWN', address: tokenIn.address };
          }
        }

        // Fallback logic for output token
        if (!outputToken.symbol || !outputToken.address) {
          if (legIndex === route.legs.length - 1) {
            outputToken = { symbol: tokenOut.symbol, address: tokenOut.address };
          } else {
            outputToken = leg.outputToken || { symbol: 'UNKNOWN', address: tokenOut.address };
          }
        }

        // Determine wrap operation
        let wrapOp = 0;

        // Check what the pool expects based on protocol
        let poolExpectsWETH = false;
        let poolExpectsETH = false;

        if (protocol === 'balancer') {
          // Balancer ALWAYS uses WETH, never native ETH
          poolExpectsWETH = true;
        } else if (protocol === 'uniswap') {
          // Uniswap V4 uses native ETH
          poolExpectsETH = true;
        }

        if (legIndex === 0) {
          // First leg: Check against user's input token
          const userSendsETH = tokenIn.address === ETH_ADDRESS;
          const userSendsWETH = tokenIn.address === WETH_ADDRESS;

          if (poolExpectsWETH && userSendsETH) {
            wrapOp = 1; // Wrap ETH to WETH before swap
            console.log(`   🔄 Leg 0 (${protocol}): Pool expects WETH, user sends ETH → wrapOp=1 (wrap before)`);
          } else if (poolExpectsETH && userSendsWETH) {
            wrapOp = 3; // Unwrap WETH to ETH before swap
            console.log(`   🔄 Leg 0 (${protocol}): Pool expects ETH, user sends WETH → wrapOp=3 (unwrap before)`);
          }
        } else {
          // Subsequent legs: Check against previous leg's output
          const prevLeg = pools[legIndex - 1];
          if (prevLeg && prevLeg.outputToken) {
            const prevOutputsETH = prevLeg.outputToken.address === ETH_ADDRESS;
            const prevOutputsWETH = prevLeg.outputToken.address === WETH_ADDRESS;

            if (poolExpectsWETH && prevOutputsETH) {
              wrapOp = 1; // Wrap ETH to WETH before swap
              console.log(`   🔄 Leg ${legIndex} (${protocol}): Pool expects WETH, previous outputs ETH → wrapOp=1 (wrap before)`);
            } else if (poolExpectsETH && prevOutputsWETH) {
              wrapOp = 3; // Unwrap WETH to ETH before swap
              console.log(`   🔄 Leg ${legIndex} (${protocol}): Pool expects ETH, previous outputs WETH → wrapOp=3 (unwrap before)`);
            }
          }
        }

        // Extract pool identifier from various possible locations
        let poolIdentifier = '';
        if (protocol === 'uniswap' && leg.trade) {
          // Try multiple paths for Uniswap pool data (V4 uses swaps[0].route.pools)
          const pool = leg.trade.swaps?.[0]?.route?.pools?.[0] || leg.trade.route?.pools?.[0];
          if (pool) {
            // Uniswap V4 pools use poolId as primary identifier
            poolIdentifier = pool.poolId || pool.id || pool.address || '';
          }
        } else if (protocol === 'balancer' && leg.path) {
          // Extract from Balancer path hops
          const hops = leg.path.hops || leg.path.path?.hops;
          if (hops && hops.length > 0) {
            poolIdentifier = hops[0].poolAddress || hops[0].poolId || leg.path.poolId || leg.path.poolAddress || '';
          } else {
            poolIdentifier = leg.path.poolId || leg.path.poolAddress || '';
          }
        }

        // Fallback to leg-level properties
        if (!poolIdentifier) {
          poolIdentifier = leg.poolAddress || leg.poolId || '';
        }

        // Debug logging if still no pool identifier
        if (!poolIdentifier) {
          console.warn(`   ⚠️  Leg ${legIndex} (${protocol}) missing pool identifier. Trade structure:`, {
            hasTrade: !!leg.trade,
            hasRoute: !!leg.trade?.route,
            hasSwaps: !!leg.trade?.swaps,
            swapsPools: !!leg.trade?.swaps?.[0]?.route?.pools,
            routePools: !!leg.trade?.route?.pools,
            poolsLength: leg.trade?.swaps?.[0]?.route?.pools?.length || leg.trade?.route?.pools?.length || 0
          });
        }

        const pool = {
          poolAddress: poolIdentifier,
          poolId: poolIdentifier,
          protocol: protocol,
          inputToken: inputToken,  // Store complete token object {symbol, address}
          outputToken: outputToken,  // Store complete token object {symbol, address}
          percentage: leg.percentage || 1.0,
          inputAmount: legIndex === 0 ? (inputAmount ?? leg.inputAmount ?? route.inputAmount) : undefined,
          expectedOutput: legIndex === route.legs.length - 1 ? leg.outputAmount : undefined,
          wrapOperation: wrapOp,
          shouldUseAllBalance: legIndex > 0, // First leg uses exact amount, others use all balance
          ...(protocol === 'uniswap' && { trade: leg.trade }),
          ...(protocol === 'balancer' && { path: leg.path })
        };

        pools.push(pool);
        console.log(`   Added leg ${legIndex}: ${pool.protocol} ${pool.inputToken.symbol}→${pool.outputToken.symbol} (${(pool.percentage * 100).toFixed(1)}%)`);
      });

      // Create pool execution structure with all legs at separate levels
      const poolMap = new Map();
      pools.forEach((pool, idx) => {
        poolMap.set(`pool-${idx}`, pool);
      });

      route.poolExecutionStructure = {
        levels: pools.map((pool, idx) => ({
          level: idx,
          pools: [pool]
        })),
        poolMap
      };

      console.log(`   ✓ Converted to ${pools.length} execution level(s)`);
    } else if (!route.poolExecutionStructure) {
      throw new Error(`Cross-DEX route "${route.type}" missing poolExecutionStructure and cannot be built from legs`);
    }

    // Now convert type to optimized-multi-route-split so it's handled correctly
    console.log(`   Converting route.type from "${route.type}" to "optimized-multi-route-split"`);
    route.type = 'optimized-multi-route-split';
  }

  return route;
}