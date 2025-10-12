import { ethers } from 'ethers';

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

  if (route.type === 'optimized-multi-route-split') {
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

        console.log(`      ${poolIdx + 1}. ${pool.protocol}: ${pool.inputToken}→${pool.outputToken}`);
        console.log(`         Pool: ${pool.poolAddress.slice(0, 10)}...`);
        console.log(`         Allocation: ${(pool.percentage * 100).toFixed(1)}% of level ${level.level} input${pool.shouldUseAllBalance ? ' [USE ALL]' : ''}`);

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
          const inputDecimals = { 'ETH': 18, 'WETH': 18, 'USDC': 6, 'USDT': 6, 'DAI': 18, 'WBTC': 8, 'AAVE': 18 }[pool.inputToken] || 18;
          const inputFormatted = ethers.utils.formatUnits(pool.inputAmount, inputDecimals);
          console.log(`         Input: ${inputFormatted} ${pool.inputToken} (${pool.inputAmount.toString()} wei)`);
        }

        if (pool.expectedOutput) {
          // Determine decimal places for output token
          const outputDecimals = { 'ETH': 18, 'WETH': 18, 'USDC': 6, 'USDT': 6, 'DAI': 18, 'WBTC': 8, '1INCH': 18 }[pool.outputToken] || 18;
          const outputFormatted = ethers.utils.formatUnits(pool.expectedOutput, outputDecimals);
          console.log(`         Expected Output: ${outputFormatted} ${pool.outputToken} (${pool.expectedOutput.toString()} wei)`);
        }

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
  const wrapOperations = [];

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
      inputAmount = step.inputAmount || BigNumber.from(0);
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

    // Extract protocol-specific data
    let poolId, fee;

    if (step.protocol === 'balancer') {
      // Extract Balancer pool ID from path
      poolId = step.poolId || step.path?.hops?.[0]?.poolId || '0x0000000000000000000000000000000000000000000000000000000000000000';
    } else if (step.protocol === 'uniswap') {
      // Extract fee from Uniswap trade
      const tradeRoute = step.trade?.route || step.trade?.swaps?.[0]?.route;
      const pool = tradeRoute?.pools?.[0];
      fee = pool?.feeTier || 3000; // Default 0.3% fee
    }

    // Add wrap operation to array
    wrapOperations.push(step.wrapOperation || 0);

    // Create encoder calldata
    if (step.protocol === 'balancer') {
      encoderTargets.push(balancerEncoderAddress);

      if (inputAmount.eq(ethers.constants.MaxUint256)) {
        // Use all balance swap - encoder will query actual balance
        const encoderCalldata = ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'address', 'address', 'uint256'],
          [
            poolId,
            inputTokenAddress,
            outputTokenAddress,
            minAmountOut
          ]
        );

        // Encode the function selector for encodeUseAllBalanceSwap
        const selector = ethers.utils.id('encodeUseAllBalanceSwap(bytes32,address,address,uint256)').slice(0, 10);
        encoderData.push(selector + encoderCalldata.slice(2));
      } else {
        // Regular swap with exact amount
        const encoderCalldata = ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'address', 'address', 'uint256', 'uint256'],
          [
            poolId,
            inputTokenAddress,
            outputTokenAddress,
            inputAmount,
            minAmountOut
          ]
        );

        // Encode the function selector for encodeSingleSwap
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
            fee,
            minAmountOut
          ]
        );

        // Encode the function selector for encodeUseAllBalanceSwap
        const selector = ethers.utils.id('encodeUseAllBalanceSwap(address,address,uint24,uint256)').slice(0, 10);
        encoderData.push(selector + encoderCalldata.slice(2));
      } else {
        // Regular swap with exact amount
        const encoderCalldata = ethers.utils.defaultAbiCoder.encode(
          ['address', 'address', 'uint24', 'uint256', 'uint256'],
          [
            inputTokenAddress,
            outputTokenAddress,
            fee,
            inputAmount,
            minAmountOut
          ]
        );

        // Encode the function selector for encodeSingleSwap
        const selector = ethers.utils.id('encodeSingleSwap(address,address,uint24,uint256,uint256)').slice(0, 10);
        encoderData.push(selector + encoderCalldata.slice(2));
      }
    }
  });

  return {
    fromToken: tokenIn.address || ETH_ADDRESS,
    fromAmount: executionPlan.route.inputAmount ||
                executionPlan.route.paths?.[0]?.inputAmount ||
                executionPlan.route.splits?.reduce((sum, s) => sum.add(s.input || s.amount), BigNumber.from(0)) ||
                BigNumber.from(0),
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