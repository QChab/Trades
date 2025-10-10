import {
  encodeBalancerBatchSwap,
  encodeBalancerSingleSwap,
  encodeUniswapExactInput,
  encodeUniswapTrades
} from './encoders.js'


/**
 * Create execution plan for the selected route
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