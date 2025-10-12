import { ethers } from 'ethers';

// Constants
const ETH_ADDRESS = '0x0000000000000000000000000000000000000000';
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const { BigNumber } = ethers;
const balancerEncoderAddress = '0x0156BB9cCeF37D3d1b9a3CB52b9b4BC26dA1563e';
const uniswapEncoderAddress = '0x4B748Ed83A186E214696487E5686fB1B5bD19932';

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
 * @returns {Object} Arguments for the WalletBundler encodeAndExecute function
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
    let inputTokenAddress = step.inputToken?.address ||
                             (step.inputToken === 'ETH' ? ETH_ADDRESS :
                              step.inputToken === 'WETH' ? WETH_ADDRESS :
                              tokenIn.address);
    const outputTokenAddress = step.outputToken?.address ||
                              (step.outputToken === 'ETH' ? ETH_ADDRESS :
                               step.outputToken === 'WETH' ? WETH_ADDRESS :
                               tokenOut.address);

    // CRITICAL: For Balancer, if the pool uses WETH but we have ETH, we need to wrap
    // Check if pool expects WETH but we're sending ETH
    let needsWrapBeforeSwap = false;
    if (step.protocol === 'balancer') {
      const poolExpectsWETH = step.path?.hops?.[0]?.tokenIn?.toLowerCase() === WETH_ADDRESS.toLowerCase();
      const weHaveETH = tokenIn.address === ETH_ADDRESS || inputTokenAddress === ETH_ADDRESS;

      if (poolExpectsWETH && weHaveETH) {
        console.log('   🔄 Pool expects WETH but we have ETH - will wrap before swap');
        // Use WETH address for the encoder
        inputTokenAddress = WETH_ADDRESS;
        needsWrapBeforeSwap = true;
      }
    }

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
      // Extract Balancer V3 pool address (NOT bytes32, just address)
      console.log(`   [Balancer] step.poolId: ${step.poolId || 'undefined'}`);
      console.log(`   [Balancer] step.poolAddress: ${step.poolAddress || 'undefined'}`);
      console.log(`   [Balancer] step.path?.hops?.[0]?.poolAddress: ${step.path?.hops?.[0]?.poolAddress || 'undefined'}`);
      // For V3, poolId is just a 20-byte address
      poolId = step.poolAddress || step.poolId || step.path?.hops?.[0]?.poolAddress || '0x0000000000000000000000000000000000000000';
      console.log(`   [Balancer V3] Final pool address: ${poolId}`);
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
          ['address', 'address', 'address', 'uint256', 'uint8'],
          [
            poolId,  // V3 uses address, not bytes32
            inputTokenAddress,
            outputTokenAddress,
            minAmountOut,
            step.wrapOperation || 0
          ]
        );

        // Encode the function selector for encodeUseAllBalanceSwap (V3 signature)
        const selector = ethers.utils.id('encodeUseAllBalanceSwap(address,address,address,uint256,uint8)').slice(0, 10);
        encoderData.push(selector + encoderCalldata.slice(2));
      } else {
        // Regular swap with exact amount
        const encoderCalldata = ethers.utils.defaultAbiCoder.encode(
          ['address', 'address', 'address', 'uint256', 'uint256'],
          [
            poolId,  // V3 uses address, not bytes32
            inputTokenAddress,
            outputTokenAddress,
            inputAmount,
            minAmountOut
          ]
        );

        // Encode the function selector for encodeSingleSwap (V3 signature)
        const selector = ethers.utils.id('encodeSingleSwap(address,address,address,uint256,uint256)').slice(0, 10);
        encoderData.push(selector + encoderCalldata.slice(2));
      }
    } else if (step.protocol === 'uniswap') {
      encoderTargets.push(uniswapEncoderAddress);

      if (inputAmount.eq(ethers.constants.MaxUint256)) {
        // Use all balance swap - encoder will query actual balance
        const encoderCalldata = ethers.utils.defaultAbiCoder.encode(
          ['address', 'address', 'uint24', 'uint256', 'uint8'],
          [
            inputTokenAddress,
            outputTokenAddress,
            fee,
            minAmountOut,
            step.wrapOperation || 0
          ]
        );

        // Encode the function selector for encodeUseAllBalanceSwap
        const selector = ethers.utils.id('encodeUseAllBalanceSwap(address,address,uint24,uint256,uint8)').slice(0, 10);
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

  return {
    fromToken: tokenIn.address || ETH_ADDRESS,
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
  console.log(`   Received inputAmount param: ${inputAmount ? inputAmount.toString() : 'null/undefined'}`);

  // Simple single-path routes (balancer-path-1, uniswap-path-1, etc.)
  if (route.type && (route.type.startsWith('balancer-path-') || route.type.startsWith('uniswap-path-'))) {
    const path = route.paths && route.paths[0];
    if (!path) {
      throw new Error(`Route ${route.type} missing paths array`);
    }

    console.log(`   path.inputAmount: ${path.inputAmount ? path.inputAmount.toString() : 'undefined'}`);
    console.log(`   route.inputAmount: ${route.inputAmount ? route.inputAmount.toString() : 'undefined'}`);

    // Determine the input amount from multiple sources (use ?? for BigNumber safety)
    const firstHopInputAmount = inputAmount ?? path.inputAmount ?? route.inputAmount;
    console.log(`   Final firstHopInputAmount: ${firstHopInputAmount ? firstHopInputAmount.toString() : 'undefined'}`);

    const pools = [];

    if (route.protocol === 'balancer') {
      // Balancer single path - could be multi-hop
      if (path.path && path.path.hops) {
        console.log(`   Balancer path.path.hops:`, JSON.stringify(path.path.hops, null, 2));
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
              console.log(`   🔄 Pool expects WETH but user sends ETH - setting wrapOperation: 1 (wrap before)`);
            } else if (poolExpectsETH && userSendsWETH) {
              wrapOp = 3; // Unwrap WETH to ETH before swap
              console.log(`   🔄 Pool expects ETH but user sends WETH - setting wrapOperation: 3 (unwrap before)`);
            }
          }

          pools.push({
            poolAddress: balancerPoolId,
            poolId: balancerPoolId,
            protocol: 'balancer',
            inputToken: hopIndex === 0 ? tokenIn.symbol : hop.poolData?.tokens?.find(t => t.address.toLowerCase() === hop.tokenIn.toLowerCase())?.symbol || 'UNKNOWN',
            outputToken: hopIndex === path.path.hops.length - 1 ? tokenOut.symbol : hop.poolData?.tokens?.find(t => t.address.toLowerCase() === hop.tokenOut.toLowerCase())?.symbol || 'UNKNOWN',
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
      pools.push({
        poolAddress: path.trade?.route?.pools?.[0]?.address || '',
        poolId: path.trade?.route?.pools?.[0]?.address || '',
        protocol: 'uniswap',
        inputToken: tokenIn.symbol,
        outputToken: tokenOut.symbol,
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

  return route;
}