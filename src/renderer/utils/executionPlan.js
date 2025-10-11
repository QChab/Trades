import { ethers } from 'ethers';
import {
  encodeBalancerBatchSwap,
  encodeBalancerSingleSwap,
  encodeUniswapExactInput,
  encodeUniswapTrades
} from './encoders.js'

// Constants
const ETH_ADDRESS = '0x0000000000000000000000000000000000000000';
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const { BigNumber } = ethers;

/**
 * Create execution plan for the selected route
 * Now async to support intermediate amount calculations
 */
export async function createExecutionPlan(route, tokenIn, tokenOut, slippageTolerance) {
  const plan = {
    route,
    executionSteps: [],
    approvals: [],
    estimatedGas: route.estimatedGas,
    slippageTolerance
  };

  // Build execution steps based on route type
  if (route.type === 'cross-dex-optimized-exact' || route.type === 'cross-dex-optimized-direct') {
    // Step 1: First hop - split across DEXs
    const firstHopOutputs = [];
    let needsConversion = false;

    for (const split of route.splits) {
      const stepData = {
        hop: 1,
        protocol: split.protocol,
        percentage: split.percentage,
        input: split.input,
        expectedOutput: split.output
      };

      if (split.protocol === 'balancer') {
        stepData.method = 'swap';
        stepData.tokenPath = `${tokenIn.symbol} -> WETH`;
        stepData.outputToken = 'WETH';

        // Balancer outputs WETH, but we need ETH for the next hop
        if (route.path && route.path.includes('ETH') && route.path.includes('SEV')) {
          stepData.unwrapAfter = true;
          needsConversion = true;
        }

        // Track WETH output
        firstHopOutputs.push({
          token: stepData.unwrapAfter ? 'ETH' : 'WETH',
          amount: split.output,
          protocol: 'balancer',
          requiresUnwrap: stepData.unwrapAfter
        });

        // Add Balancer approval
        if (!plan.approvals.find(a => a.spender === '0xBA12222222228d8Ba445958a75a0704d566BF2C8')) {
          plan.approvals.push({
            token: tokenIn.address,
            spender: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', // Balancer Vault
            amount: split.input
          });
        }
      } else if (split.protocol === 'uniswap') {
        stepData.method = 'exactInputSingle';
        stepData.tokenPath = `${tokenIn.symbol} -> ETH`;
        stepData.outputToken = 'ETH';

        // Check if Uniswap needs WETH instead of ETH (rare case)
        if (split.requiresWrap) {
          stepData.wrapAfter = true;
        }

        // Track ETH output
        firstHopOutputs.push({
          token: stepData.wrapAfter ? 'WETH' : 'ETH',
          amount: split.output,
          protocol: 'uniswap',
          requiresWrap: stepData.wrapAfter
        });

        // Add Uniswap approval
        if (!plan.approvals.find(a => a.spender === '0x66a9893cc07d91d95644aedd05d03f95e1dba8af')) {
          plan.approvals.push({
            token: tokenIn.address,
            spender: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', // Universal Router
            amount: split.input
          });
        }
      }

      plan.executionSteps.push(stepData);
    }

    // Step 2: Second hop - combined amount to final token
    if (route.secondHop || (route.path && route.path.includes('->') && route.path.includes(tokenOut.symbol))) {
      const totalFirstHopOutput = firstHopOutputs.reduce((sum, o) => sum.add(o.amount), BigNumber.from(0));

      // Determine input token for second hop
      const secondHopInputToken = firstHopOutputs[0].token; // They should all be the same after conversion

      const secondHopStep = {
        hop: 2,
        protocol: route.secondHop?.protocol || 'uniswap',
        method: 'exactInputSingle',
        tokenPath: `${secondHopInputToken} -> ${tokenOut.symbol}`,
        input: totalFirstHopOutput,
        expectedOutput: route.totalOutput,
        inputToken: secondHopInputToken,
        outputToken: tokenOut.symbol,
        pools: route.secondHop?.pools,
        gasEstimate: 150000
      };

      // Check if we need to wrap ETH to WETH for the second hop (e.g., for Balancer)
      if (secondHopInputToken === 'ETH' && route.secondHop?.protocol === 'balancer') {
        secondHopStep.wrapBefore = true;
      }

      // Check if output needs unwrapping (e.g., WETH to ETH)
      if (tokenOut.symbol === 'ETH' && route.secondHop?.outputToken === 'WETH') {
        secondHopStep.unwrapAfter = true;
      }

      plan.executionSteps.push(secondHopStep);
    }

  } else if (route.type === 'uniswap-pre-optimized-split') {
    // Pre-optimized split from useUniswap (already has optimized split amounts)
    plan.executionSteps.push({
      hop: 1,
      protocol: 'uniswap',
      method: 'executeMixedSwaps',
      tokenPath: `${tokenIn.symbol} -> ${tokenOut.symbol}`,
      trades: route.trades,  // Use trades from the pre-optimized split
      totalInput: route.splits.reduce((sum, s) => sum.add(s.inputAmount), BigNumber.from(0)),
      totalOutput: route.totalOutput
    });

    plan.approvals.push({
      token: tokenIn.address,
      spender: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', // Universal Router
      amount: route.splits.reduce((sum, s) => sum.add(s.inputAmount), BigNumber.from(0))
    });

  } else if (route.type === 'single-uniswap' || route.type === 'split-uniswap') {
    plan.executionSteps.push({
      hop: 1,
      protocol: 'uniswap',
      method: 'executeMixedSwaps',
      tokenPath: `${tokenIn.symbol} -> ${tokenOut.symbol}`,
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
    
  } else if (route.type === 'optimized-multi-route-split') {
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
          method: pool.protocol === 'uniswap' ? 'exactInputSingle' : 'batchSwap',
          // Include execution details
          ...(pool.protocol === 'uniswap' && {
            trade: pool.trade
          }),
          ...(pool.protocol === 'balancer' && {
            path: pool.path
          })
        };

        plan.executionSteps.push(step);

        console.log(`      ${poolIdx + 1}. ${pool.protocol}: ${pool.inputToken}→${pool.outputToken}`);
        console.log(`         Pool: ${pool.poolAddress.slice(0, 10)}...`);
        console.log(`         Allocation: ${(pool.percentage * 100).toFixed(1)}% of level ${level.level} input`);
        if (pool.routeIndices && pool.routeIndices.length > 1) {
          console.log(`         Converges ${pool.routeIndices.length} routes`);
        }
      });
    });
    console.log('');

    // Add approvals for all protocols used
    const protocolsUsed = new Set(plan.executionSteps.map(s => s.protocol));

    if (protocolsUsed.has('uniswap')) {
      plan.approvals.push({
        token: tokenIn.address,
        spender: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', // Universal Router
        amount: route.splits
          .filter(s => s.route.protocol === 'uniswap' || s.route.legs?.some(l => l.protocol === 'uniswap'))
          .reduce((sum, s) => sum.add(s.amount), ethers.BigNumber.from(0))
      });
    }

    if (protocolsUsed.has('balancer')) {
      plan.approvals.push({
        token: tokenIn.address,
        spender: '0xBA12222222228d8Ba445958a75a0704d566BF2C8', // Balancer Vault
        amount: route.splits
          .filter(s => s.route.protocol === 'balancer' || s.route.legs?.some(l => l.protocol === 'balancer'))
          .reduce((sum, s) => sum.add(s.amount), ethers.BigNumber.from(0))
      });
    }

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
 * Build sequential execution steps with convergence handling
 * CRITICAL: Uses pre-computed convergence information from optimizer
 * @param {Object} route - The optimized multi-route split with convergence info
 * @param {Array} convergingPools - Pre-computed convergence information from optimizer (REQUIRED)
 * @param {Array} poolGroups - Pre-computed pool groups from optimizer (REQUIRED)
 * @returns {Object} { steps: [...], convergenceInfo: {...} }
 */
async function buildSequentialExecutionSteps(route, convergingPools, poolGroups) {
  if (!convergingPools || !poolGroups) {
    throw new Error('buildSequentialExecutionSteps requires pre-computed convergence info from optimizer');
  }

  console.log('   ✅ Using pre-computed convergence info from optimizer');
  console.log(`   📊 ${convergingPools.length} convergence points, ${poolGroups.length} pool groups`);

  const steps = [];
  const convergenceInfo = {
    totalRoutes: route.splits.length,
    uniquePools: 0,
    convergencePoints: []
  };

  // Step 1: Extract input amounts for each route based on percentage splits
  // No need to calculate intermediate flows - just use the split percentages
  const routeInputs = new Map(); // routeIndex -> initial input amount

  route.splits.forEach((split, routeIndex) => {
    routeInputs.set(routeIndex, split.amount);
  });

  // Step 2: Use pre-computed convergence information
  // Build convergence points for display from pre-computed data
  convergingPools.forEach(convergence => {
    const legIndex = parseInt(convergence.legPosition.replace('leg', ''));
    const displayPoolKey = convergence.poolKey.split('@')[0]; // Remove address suffix for display

    convergenceInfo.convergencePoints.push({
      legIndex,
      poolKey: displayPoolKey,
      routeCount: convergence.count,
      routeIndices: convergence.routes.map(r => r.index)
    });
  });

  // Step 3: Build sequential execution steps using pre-computed pool groups and actual flow amounts
  // Group pool groups by leg index for sequential execution
  const stepsByLeg = new Map();

  poolGroups.forEach(group => {
    if (group.legIndex === null) return; // Skip independent routes without specific leg

    if (!stepsByLeg.has(group.legIndex)) {
      stepsByLeg.set(group.legIndex, []);
    }

    // Count this as a unique pool interaction
    convergenceInfo.uniquePools++;

    // Get route information from the first route in the group
    const firstRouteIndex = group.routes[0];
    const firstSplit = route.splits[firstRouteIndex];
    const firstRoute = firstSplit.route;

    if (!firstRoute.legs || group.legIndex >= firstRoute.legs.length) return;

    const leg = firstRoute.legs[group.legIndex];
    const displayPoolKey = group.poolKey ? group.poolKey.split('@')[0] : 'unknown';

    // Extract token information from leg
    let inputToken = 'UNKNOWN';
    let outputToken = 'UNKNOWN';
    let protocol = leg.protocol;
    let poolAddress = null;
    let poolId = null;

    if (leg.protocol === 'uniswap' && leg.trade) {
      const tradeRoute = leg.trade.route || leg.trade.swaps?.[0]?.route;
      if (tradeRoute && tradeRoute.pools && tradeRoute.pools.length > 0) {
        const pool = tradeRoute.pools[0];
        const path = tradeRoute.currencyPath || tradeRoute.path;
        if (path && path.length >= 2) {
          inputToken = path[path.length - 2].symbol.replace(/WETH/g, 'ETH');
          outputToken = path[path.length - 1].symbol.replace(/WETH/g, 'ETH');
          poolAddress = pool.address || pool.id;
        }
      }
    } else if (leg.protocol === 'balancer' && leg.path) {
      const hops = leg.path.hops || [];
      if (hops.length > 0) {
        const firstHop = hops[0];
        const lastHop = hops[hops.length - 1];

        if (firstHop.poolData && firstHop.poolData.tokens) {
          const tokenInObj = firstHop.poolData.tokens.find(
            t => t.address.toLowerCase() === firstHop.tokenIn.toLowerCase()
          );
          if (tokenInObj && tokenInObj.symbol) {
            inputToken = tokenInObj.symbol.replace(/WETH/g, 'ETH');
          }
        }

        if (lastHop.poolData && lastHop.poolData.tokens) {
          const tokenOutObj = lastHop.poolData.tokens.find(
            t => t.address.toLowerCase() === lastHop.tokenOut.toLowerCase()
          );
          if (tokenOutObj && tokenOutObj.symbol) {
            outputToken = tokenOutObj.symbol.replace(/WETH/g, 'ETH');
          }
        }

        poolAddress = firstHop.poolAddress;
        poolId = firstHop.poolId;
      }
    }

    // Calculate combined input/output using actual flow amounts
    const combinedInput = group.routes.reduce((sum, routeIndex) => {
      const flow = routeFlows.get(routeIndex)?.get(group.legIndex);
      return sum.add(flow?.input || ethers.BigNumber.from(0));
    }, ethers.BigNumber.from(0));

    const combinedOutput = group.routes.reduce((sum, routeIndex) => {
      const flow = routeFlows.get(routeIndex)?.get(group.legIndex);
      return sum.add(flow?.output || ethers.BigNumber.from(0));
    }, ethers.BigNumber.from(0));

    // Create execution step
    const step = {
      legIndex: group.legIndex,
      poolKey: displayPoolKey,
      protocol,
      method: protocol === 'uniswap' ? 'exactInputSingle' : 'batchSwap',
      inputToken,
      outputToken,
      input: combinedInput,
      expectedOutput: combinedOutput,
      convergent: group.isConvergent,
      routeCount: group.routes.length,
      routeIndices: group.routes,
      // Include pool/path info for execution
      ...(protocol === 'uniswap' && {
        trade: leg.trade,
        poolAddress
      }),
      ...(protocol === 'balancer' && {
        path: leg.path,
        poolId
      })
    };

    stepsByLeg.get(group.legIndex).push(step);
  });

  // Flatten steps by leg index (sorted)
  const legIndices = Array.from(stepsByLeg.keys()).sort((a, b) => a - b);
  legIndices.forEach(legIndex => {
    steps.push(...stepsByLeg.get(legIndex));
  });

  // Step 4: Sort steps to ensure proper execution order
  steps.sort((a, b) => {
    if (a.legIndex !== b.legIndex) {
      return a.legIndex - b.legIndex;
    }
    // Within same leg, convergent pools first (since they consume more input)
    if (a.convergent && !b.convergent) return -1;
    if (!a.convergent && b.convergent) return 1;
    return 0;
  });

  // Step 5: Add hop numbers for clarity
  steps.forEach((step, index) => {
    step.hop = step.legIndex + 1; // hop 1 = leg 0, hop 2 = leg 1, etc.
    step.stepNumber = index + 1;
  });

  return { steps, convergenceInfo };
}

/**
 * Convert execution plan to encoder-based contract arguments
 * @param {Object} executionPlan - The execution plan from createExecutionPlan
 * @param {Object} tokenIn - Input token object
 * @param {Object} tokenOut - Output token object
 * @param {string} walletBundlerAddress - Address of the WalletBundler contract
 * @param {string} balancerEncoderAddress - Address of BalancerEncoder contract
 * @param {string} uniswapEncoderAddress - Address of UniswapEncoder contract
 * @param {number} slippagePercent - Slippage tolerance in percent (default 0.5%)
 * @returns {Object} Arguments for the WalletBundler encodeAndExecute function
 */
export function createEncoderExecutionPlan(
  executionPlan,
  tokenIn,
  tokenOut,
  balancerEncoderAddress,
  uniswapEncoderAddress,
  slippagePercent = 0.5
) {
  const encoderTargets = [];
  const encoderData = [];

  // First, mark split legs in the execution plan
  const markedPlan = markSplitLegs(executionPlan);

  // Process each execution step
  markedPlan.executionSteps.forEach((step) => {
    // Determine input amount based on smart analysis
    let inputAmount;
    if (shouldUseAllBalance(step, markedPlan)) {
      // Use all available balance for this token
      inputAmount = ethers.constants.MaxUint256; // Special marker for "use all"
    } else {
      // Use exact calculated amount
      inputAmount = step.input || step.amount || BigNumber.from(0);
    }

    // Determine actual token addresses
    const inputTokenAddress = step.inputToken?.address ||
                             (step.inputToken === 'ETH' ? ETH_ADDRESS :
                              step.inputToken === 'WETH' ? WETH_ADDRESS :
                              tokenIn.address);
    const outputTokenAddress = step.outputToken?.address ||
                              (step.outputToken === 'ETH' ? ETH_ADDRESS :
                               step.outputToken === 'WETH' ? WETH_ADDRESS :
                               tokenOut.address);

    // Calculate minimum amount out with slippage for this step
    let minAmountOut = BigNumber.from(0);
    if (step.expectedOutput || step.output) {
      const expectedOut = step.expectedOutput || step.output || BigNumber.from(0);
      // Apply slippage: minAmount = expectedAmount * (100 - slippagePercent) / 100
      minAmountOut = expectedOut.mul(Math.floor((100 - slippagePercent) * 100)).div(10000);
    }

    // Create encoder calldata
    if (step.protocol === 'balancer') {
      encoderTargets.push(balancerEncoderAddress);

      if (inputAmount.eq(ethers.constants.MaxUint256)) {
        // Use all balance swap - encoder will query actual balance
        const encoderCalldata = ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'address', 'address', 'uint256'],
          [
            step.poolId || step.pools?.[0]?.id || '0x0000000000000000000000000000000000000000000000000000000000000000',
            inputTokenAddress,
            outputTokenAddress,
            minAmountOut
          ]
        );

        // Encode the function selector for encodeUseAllBalanceSwap (no sender/recipient params)
        const selector = ethers.utils.id('encodeUseAllBalanceSwap(bytes32,address,address,uint256)').slice(0, 10);
        encoderData.push(selector + encoderCalldata.slice(2));
      } else {
        // Regular swap with exact amount
        const encoderCalldata = ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'address', 'address', 'uint256', 'uint256'],
          [
            step.poolId || step.pools?.[0]?.id || '0x0000000000000000000000000000000000000000000000000000000000000000',
            inputTokenAddress,
            outputTokenAddress,
            inputAmount,
            minAmountOut
          ]
        );

        // Encode the function selector for encodeSingleSwap (no sender/recipient params)
        const selector = ethers.utils.id('encodeSingleSwap(bytes32,address,address,uint256,uint256)').slice(0, 10);
        encoderData.push(selector + encoderCalldata.slice(2));
      }
    } else if (step.protocol === 'uniswap') {
      encoderTargets.push(uniswapEncoderAddress);

      if (inputAmount.eq(ethers.constants.MaxUint256)) {
        // Use all balance swap - encoder will query actual balance
        const encoderCalldata = ethers.utils.defaultAbiCoder.encode(
          ['address', 'address', 'uint24', 'uint256'],
          [
            inputTokenAddress,
            outputTokenAddress,
            step.fee || 3000, // Default 0.3% fee
            minAmountOut
          ]
        );

        // Encode the function selector for encodeUseAllBalanceSwap (no sender/recipient params)
        const selector = ethers.utils.id('encodeUseAllBalanceSwap(address,address,uint24,uint256)').slice(0, 10);
        encoderData.push(selector + encoderCalldata.slice(2));
      } else {
        // Regular swap with exact amount
        const encoderCalldata = ethers.utils.defaultAbiCoder.encode(
          ['address', 'address', 'uint24', 'uint256', 'uint256'],
          [
            inputTokenAddress,
            outputTokenAddress,
            step.fee || 3000,
            inputAmount,
            minAmountOut
          ]
        );

        // Encode the function selector for encodeSingleSwap (no sender/recipient params)
        const selector = ethers.utils.id('encodeSingleSwap(address,address,uint24,uint256,uint256)').slice(0, 10);
        encoderData.push(selector + encoderCalldata.slice(2));
      }
    }
  });

  // Calculate minimum total output with slippage for final validation
  const minOutputAmount = executionPlan.minOutput ||
                          executionPlan.route.totalOutput.mul(Math.floor((100 - slippagePercent) * 100)).div(10000);

  return {
    fromToken: tokenIn.address || ETH_ADDRESS,
    fromAmount: executionPlan.route.inputAmount ||
                executionPlan.route.paths?.[0]?.inputAmount ||
                executionPlan.route.splits?.reduce((sum, s) => sum.add(s.input || s.amount), BigNumber.from(0)) ||
                BigNumber.from(0),
    toToken: tokenOut.address || ETH_ADDRESS,
    encoderTargets,
    encoderData,
    minOutputAmount,
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
 * @param {Object} executionPlan - The original execution plan
 * @returns {Object} Modified plan with split indices
 */
export function markSplitLegs(executionPlan) {
  const modifiedPlan = { ...executionPlan };

  // Group steps by their input token, hop number, and path
  const tokenUsage = new Map(); // Track how each token is used

  modifiedPlan.executionSteps.forEach((step, index) => {
    const inputTokenKey = `${step.inputToken?.address || step.inputToken?.symbol || step.inputToken || 'UNKNOWN'}`;
    const hop = step.hop || Math.floor(index / 2); // Estimate hop if not provided

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
          hopUsages.forEach((usage, splitIndex) => {
            usage.step.splitIndex = splitIndex;
            usage.step.splitTotal = hopUsages.length;
            // Last leg of the split uses all remaining
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
 * Based on the token flow analysis
 */
export function shouldUseAllBalance(step, executionPlan) {
  // Special cases where we always use all balance:

  // 1. If this is the only consumer of an intermediate token
  // (e.g., tokenB in path: tokenA -> tokenB -> tokenC)
  if (step.isOnlyConsumer) {
    return true;
  }

  // 2. If marked as last leg of a split
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

  return false;
}

/**
 * Convert execution plan to WalletBundler contract call arguments
 * @param {Object} executionPlan - The execution plan from createExecutionPlan
 * @param {Object} tokenIn - Input token object
 * @param {Object} tokenOut - Output token object
 * @param {string} walletBundlerAddress - Address of the WalletBundler contract
 * @returns {Object} Arguments for the WalletBundler execute function
 */
export function convertExecutionPlanToContractArgs(executionPlan, tokenIn, tokenOut, walletBundlerAddress, slippagePercent = 0.5) {
  const targets = [];
  const data = [];
  const values = [];
  const inputAmounts = [];
  const outputTokens = [];
  const wrapOperations = [];

  // Process each execution step
  for (const step of executionPlan.executionSteps) {
    let target;
    let callData;
    let value = BigNumber.from(0);
    let inputAmount = BigNumber.from(0);
    let stepOutputToken = ETH_ADDRESS; // Default to ETH
    let wrapOp = 0; // Default: no operation

    if (step.protocol === 'uniswap') {
      target = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af'; // Universal Router

      // Encode Uniswap call data based on method
      if (step.method === 'executeMixedSwaps' && step.trades) {
        // Encode the trades for Universal Router
        callData = encodeUniswapTrades(step.trades, walletBundlerAddress, slippagePercent);
      } else if (step.method === 'exactInputSingle') {
        callData = encodeUniswapExactInput(step, walletBundlerAddress, slippagePercent);
      }

      // Check if ETH is being sent as value
      if (step.inputToken === 'ETH' && step.input) {
        value = step.input;
      }

    } else if (step.protocol === 'balancer') {
      target = '0xBA12222222228d8Ba445958a75a0704d566BF2C8'; // Balancer Vault

      // Encode Balancer batch swap
      if (step.method === 'batchSwap') {
        callData = encodeBalancerBatchSwap(step, walletBundlerAddress, slippagePercent);
      } else if (step.method === 'swap') {
        callData = encodeBalancerSingleSwap(step, walletBundlerAddress, slippagePercent);
      }
    }

    // Determine wrap/unwrap operations and input amounts
    if (step.wrapBefore) {
      wrapOp = 1; // Wrap ETH to WETH before call
      inputAmount = step.input || BigNumber.from(0);
    } else if (step.wrapAfter) {
      wrapOp = 2; // Wrap ETH to WETH after call
      // Input amount will be 0 since we calculate output dynamically
      inputAmount = BigNumber.from(0);
    } else if (step.unwrapBefore) {
      wrapOp = 3; // Unwrap WETH to ETH before call
      inputAmount = step.input || BigNumber.from(0);
    } else if (step.unwrapAfter) {
      wrapOp = 4; // Unwrap WETH to ETH after call
      // Input amount will be 0 since we calculate output dynamically
      inputAmount = BigNumber.from(0);
    } else {
      // No wrap/unwrap - use step input amount if available
      inputAmount = step.input || BigNumber.from(0);
    }

    // Set the output token for this step
    if (step.outputToken) {
      if (step.outputToken === 'ETH') {
        stepOutputToken = ETH_ADDRESS;
      } else if (step.outputToken === 'WETH') {
        stepOutputToken = WETH_ADDRESS;
      } else if (typeof step.outputToken === 'object' && step.outputToken.address) {
        stepOutputToken = step.outputToken.address;
      } else {
        // Infer from tokenOut for last step
        stepOutputToken = (step.hop === executionPlan.executionSteps.length) ?
                         (tokenOut.address || ETH_ADDRESS) : ETH_ADDRESS;
      }
    } else {
      // Default to final output token for last step
      stepOutputToken = (step === executionPlan.executionSteps[executionPlan.executionSteps.length - 1]) ?
                       (tokenOut.address || ETH_ADDRESS) : ETH_ADDRESS;
    }

    targets.push(target);
    data.push(callData);
    values.push(value);
    inputAmounts.push(inputAmount);
    outputTokens.push(stepOutputToken);
    wrapOperations.push(wrapOp);
  }

  return {
    fromToken: tokenIn.address || ETH_ADDRESS,
    fromAmount: executionPlan.route.paths?.[0]?.inputAmount ||
                executionPlan.route.splits?.reduce((sum, s) => sum.add(s.input || s.amount), BigNumber.from(0)) ||
                BigNumber.from(0),
    toToken: tokenOut.address || ETH_ADDRESS,
    targets,
    data,
    values,
    inputAmounts,
    outputTokens,
    wrapOperations,
    // Additional metadata for reference
    metadata: {
      routeType: executionPlan.route.type,
      expectedOutput: executionPlan.route.totalOutput,
      slippageTolerance: executionPlan.slippageTolerance,
      steps: executionPlan.executionSteps.length
    }
  };
}