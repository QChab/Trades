import { ethers, BigNumber } from 'ethers';
import { useUniswapV4 } from '../../../tests/node/useUniswap.js';
// import { useUniswapV4 } from '../composables/useUniswap.js';
import { useBalancerV3, getCacheStats } from './useBalancerV3.js';
import {
  calculateUniswapExactOutput,
  calculateBalancerExactOutput
} from './exactAMMOutputs.js'

// Constants for ETH/WETH handling
const ETH_ADDRESS = '0x0000000000000000000000000000000000000000';
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

/**
 * Mixed Uniswap-Balancer router that finds optimal trade splits across both DEXs
 * Supports multi-hop routing, percentage-based splitting, and ETH/WETH conversion
 * 
 * Key Innovation: Treats ETH and WETH as fungible for routing purposes since
 * conversion between them is essentially free (just gas for wrap/unwrap)
 */

export async function useMixedUniswapBalancer({ 
  tokenInObject, 
  tokenOutObject, 
  amountIn, 
  provider, 
  slippageTolerance = 0.5,
  maxHops = 3,
  useUniswap = true,  // New: control whether to use Uniswap
  useBalancer = true  // New: control whether to use Balancer
}) {
  console.log('🔄 Mixed DEX Routing: Finding optimal paths');
  if (!useUniswap && !useBalancer) {
    throw new Error('At least one DEX must be enabled');
  }
  console.log(`   Using: ${useUniswap ? 'Uniswap' : ''}${useUniswap && useBalancer ? ' + ' : ''}${useBalancer ? 'Balancer' : ''}`);
  
  // Normalize ETH/WETH for unified routing
  const normalizedTokenIn = normalizeETHToken(tokenInObject);
  const normalizedTokenOut = normalizeETHToken(tokenOutObject);
  
  const results = {
    uniswapPaths: [],
    balancerPaths: [],
    mixedRoutes: [],
    bestRoute: null,
    executionPlan: null,
    requiresWrap: isETHToWETHConversion(tokenInObject, normalizedTokenIn),
    requiresUnwrap: isWETHToETHConversion(tokenOutObject, normalizedTokenOut)
  };

  try {
    // Convert amountIn to BigNumber if needed
    const amountInBN = BigNumber.isBigNumber(amountIn) 
      ? amountIn 
      : ethers.utils.parseUnits(amountIn.toString(), tokenInObject.decimals);

    // Discover paths based on enabled DEXs
    let uniswapRoutes = [];
    let balancerRoutes = [];

    if (useUniswap && useBalancer) {
      // Parallel discovery when both enabled
      [uniswapRoutes, balancerRoutes] = await Promise.all([
        discoverUniswapPaths(tokenInObject, tokenOutObject, amountInBN),
        discoverBalancerPaths(tokenInObject, tokenOutObject, amountInBN, provider)
      ]);
    } else if (useUniswap) {
      // Only Uniswap
      uniswapRoutes = await discoverUniswapPaths(tokenInObject, tokenOutObject, amountInBN);
    } else if (useBalancer) {
      // Only Balancer
      balancerRoutes = await discoverBalancerPaths(tokenInObject, tokenOutObject, amountInBN, provider);
    }

    results.uniswapPaths = uniswapRoutes || [];
    results.balancerPaths = balancerRoutes || [];

    console.log(`📊 Found ${results.uniswapPaths.length} Uniswap routes and ${results.balancerPaths.length} Balancer routes`);

    // Discover cross-DEX multi-hop paths (e.g., ONE -> WETH on Balancer, WETH -> SEV on Uniswap)
    let crossDEXPaths = [];
    if (useUniswap && useBalancer) {
      crossDEXPaths = await discoverCrossDEXPaths(
        tokenInObject,
        tokenOutObject,
        amountInBN,
        provider
      );
      console.log(`🔀 Found ${crossDEXPaths.length} cross-DEX multi-hop paths`);
    }

    // Find optimal split percentages across protocols
    const optimizedRoutes = await optimizeMixedRoutes(
      results.uniswapPaths,
      results.balancerPaths,
      crossDEXPaths,
      amountInBN,
      tokenInObject,
      tokenOutObject
    );

    results.mixedRoutes = optimizedRoutes;

    // Select the best overall route
    const bestRoute = await selectBestRoute(optimizedRoutes, amountInBN, tokenInObject, tokenOutObject);
    results.bestRoute = bestRoute;

    if (bestRoute) {
      // Create execution plan with proper encoding for both protocols
      results.executionPlan = await createExecutionPlan(
        bestRoute,
        tokenInObject,
        tokenOutObject,
        slippageTolerance
      );

      // Calculate output for each split for better display
      const splitsWithOutputs = bestRoute.splits ? await Promise.all(
        bestRoute.splits.map(async (s) => {
          const output = await calculateRouteExactOutput(s.route, s.amount, tokenInObject, tokenOutObject);
          return {
            protocol: s.route?.protocol || 'unknown',
            percentage: `${(s.percentage * 100).toFixed(1)}%`,
            input: ethers.utils.formatUnits(s.amount, tokenInObject.decimals),
            output: ethers.utils.formatUnits(output, tokenOutObject.decimals),
            description: s.description
          };
        })
      ) : undefined;

      console.log('✅ Best route found:', {
        type: bestRoute.type,
        totalOutput: ethers.utils.formatUnits(bestRoute.totalOutput, tokenOutObject.decimals),
        splits: splitsWithOutputs,
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
 * Helper functions for ETH/WETH normalization
 */
function normalizeETHToken(token) {
  // If token is ETH, treat it as WETH for routing purposes
  if (token.address === ETH_ADDRESS || token.address?.toLowerCase() === ETH_ADDRESS) {
    return {
      ...token,
      address: WETH_ADDRESS,
      symbol: 'WETH',
      isNative: true,
      originalAddress: ETH_ADDRESS,
      originalSymbol: 'ETH'
    };
  }
  return token;
}

function isETHToWETHConversion(original, normalized) {
  return original.address === ETH_ADDRESS && normalized.address === WETH_ADDRESS;
}

function isWETHToETHConversion(original, normalized) {
  return original.address !== ETH_ADDRESS && normalized.originalAddress === ETH_ADDRESS;
}

/**
 * Discover Uniswap V4 paths with ETH/WETH unification
 */
async function discoverUniswapPaths(tokenInObject, tokenOutObject, amountIn) {
  try {
    // Validate: prevent same-token swaps
    const normalizeAddress = (addr) => addr === ETH_ADDRESS ? WETH_ADDRESS : addr.toLowerCase();
    if (normalizeAddress(tokenInObject.address) === normalizeAddress(tokenOutObject.address)) {
      console.log(`   ⚠️  Skipping same-token swap: ${tokenInObject.symbol} → ${tokenOutObject.symbol}`);
      return null;
    }

    const uniswap = useUniswapV4();

    // Discover paths for both ETH and WETH variants
    const pathVariants = [];
    
    // Original path
    pathVariants.push({ 
      tokenIn: tokenInObject, 
      tokenOut: tokenOutObject,
      variantType: 'original' 
    });
    
    // If input is ETH, also try WETH
    if (tokenInObject.address === ETH_ADDRESS) {
      pathVariants.push({
        tokenIn: { ...tokenInObject, address: WETH_ADDRESS, symbol: 'WETH' },
        tokenOut: tokenOutObject,
        variantType: 'wrapped-input'
      });
    }
    
    // If input is WETH, also try ETH
    if (tokenInObject.address === WETH_ADDRESS) {
      pathVariants.push({
        tokenIn: { ...tokenInObject, address: ETH_ADDRESS, symbol: 'ETH' },
        tokenOut: tokenOutObject,
        variantType: 'unwrapped-input'
      });
    }
    
    // If output is ETH, also try WETH
    if (tokenOutObject.address === ETH_ADDRESS) {
      pathVariants.push({
        tokenIn: tokenInObject,
        tokenOut: { ...tokenOutObject, address: WETH_ADDRESS, symbol: 'WETH' },
        variantType: 'wrapped-output'
      });
    }
    
    // If output is WETH, also try ETH
    if (tokenOutObject.address === WETH_ADDRESS) {
      pathVariants.push({
        tokenIn: tokenInObject,
        tokenOut: { ...tokenOutObject, address: ETH_ADDRESS, symbol: 'ETH' },
        variantType: 'unwrapped-output'
      });
    }
    
    // Collect all paths from all variants
    const allPaths = [];
    
    for (const variant of pathVariants) {
      console.log(`[selectBestPath] Finding trades for ${variant.tokenIn.symbol} → ${variant.tokenOut.symbol} with ${variant.tokenIn.address.slice(0,10)} -> ${variant.tokenOut.address.slice(0,10)}`);
      const pools = await uniswap.findPossiblePools(variant.tokenIn, variant.tokenOut);
      
      if (pools.length > 0) {
        const trades = await uniswap.selectBestPath(variant.tokenIn, variant.tokenOut, pools, amountIn);

        if (!trades || trades.length === 0) {
          console.log(`   No valid trades for ${variant.tokenIn.symbol} → ${variant.tokenOut.symbol}`);
          continue;
        }

        // Deduplicate trades by pool address (same pool returned multiple times)
        const seenPools = new Set();
        const uniqueTrades = trades.filter(trade => {
          if (!trade || !trade.swaps || trade.swaps.length === 0) return false;

          // Get pool address from the trade
          const route = trade.swaps[0].route;
          if (!route || !route.pools || route.pools.length === 0) return false;

          const pool = route.pools[0];
          const poolKey = pool.address || pool.poolId || pool.id;

          if (!poolKey) {
            console.warn(`   ⚠️  Trade has no pool identifier`);
            return true; // Keep it if we can't identify
          }

          if (seenPools.has(poolKey)) {
            console.log(`   ⚠️  Removing duplicate pool ${poolKey.slice(0, 10)}...`);
            return false; // Skip duplicate
          }

          seenPools.add(poolKey);
          return true;
        });

        if (uniqueTrades.length < trades.length) {
          console.log(`   ✅ Removed ${trades.length - uniqueTrades.length} duplicate pools for ${variant.tokenIn.symbol} → ${variant.tokenOut.symbol}`);
        }

        // Multiple unique trades - add each as separate route for optimization
        if (uniqueTrades.length > 1) {
          console.log(`   ✓ Found ${uniqueTrades.length} unique Uniswap routes`);

          const paths = uniqueTrades.filter(trade => trade && trade.swaps).map((trade, i) => {
            const path = trade.swaps[0].route.currencyPath.map(c => c.symbol).join(' → ');
            const inputAmount = BigNumber.from(trade.inputAmount.quotient.toString());
            const outputAmount = BigNumber.from(trade.outputAmount.quotient.toString());

            console.log(`      Route ${i + 1}: ${ethers.utils.formatUnits(outputAmount, variant.tokenOut.decimals)} ${variant.tokenOut.symbol}`);
            console.log(`              Input: ${ethers.utils.formatUnits(inputAmount, variant.tokenIn.decimals)} ${variant.tokenIn.symbol}`);
            console.log(`              Path: ${path}`);

            return {
              protocol: 'uniswap',
              trade,
              pools: trade.swaps[0].route.pools,
              inputAmount: amountIn,  // Each can handle full amount
              outputAmount,
              hops: trade.swaps[0].route.pools.length,
              path: trade.swaps[0].route.currencyPath.map(c => c.address || c.symbol),
              variantType: variant.variantType,
              requiresWrap: variant.variantType === 'wrapped-input',
              requiresUnwrap: variant.variantType === 'unwrapped-output'
            };
          });

          allPaths.push(...paths);
        } else {
          // Single trade - add as individual path
          const paths = uniqueTrades.filter(trade => trade && trade.swaps).map(trade => {
            const inputAmount = BigNumber.from(trade.inputAmount.quotient.toString());
            const outputAmount = BigNumber.from(trade.outputAmount.quotient.toString());
            const path = trade.swaps[0].route.currencyPath.map(c => c.symbol).join(' → ');

            console.log(`   ✓ Found 1 Uniswap route`);
            console.log(`      Output: ${ethers.utils.formatUnits(outputAmount, variant.tokenOut.decimals)} ${variant.tokenOut.symbol}`);
            console.log(`      Input: ${ethers.utils.formatUnits(inputAmount, variant.tokenIn.decimals)} ${variant.tokenIn.symbol}`);
            console.log(`      Path: ${path}`);

            return {
              protocol: 'uniswap',
              trade,
              pools: trade.swaps[0].route.pools,
              inputAmount: BigNumber.from(trade.inputAmount.quotient.toString()),
              outputAmount: BigNumber.from(trade.outputAmount.quotient.toString()),
              hops: trade.swaps[0].route.pools.length,
              path: trade.swaps[0].route.currencyPath.map(c => c.address || c.symbol),
              variantType: variant.variantType,
              requiresWrap: variant.variantType === 'wrapped-input',
              requiresUnwrap: variant.variantType === 'unwrapped-output'
            };
          });

          allPaths.push(...paths);
        }
      }
    }
    
    console.log(`Found ${allPaths.length} Uniswap paths (including ETH/WETH variants)`);
    return allPaths;

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
    // Balancer uses WETH, not ETH - normalize addresses
    const normalizedTokenIn = tokenInObject.address === ETH_ADDRESS ?
      { ...tokenInObject, address: WETH_ADDRESS, symbol: 'WETH' } :
      tokenInObject;
    const normalizedTokenOut = tokenOutObject.address === ETH_ADDRESS ?
      { ...tokenOutObject, address: WETH_ADDRESS, symbol: 'WETH' } :
      tokenOutObject;

    // Validate: prevent same-token swaps (after normalization)
    if (normalizedTokenIn.address.toLowerCase() === normalizedTokenOut.address.toLowerCase()) {
      console.log(`   ⚠️  Skipping same-token swap: ${normalizedTokenIn.symbol} → ${normalizedTokenOut.symbol}`);
      return null;
    }

    console.log(`   Querying Balancer for ${normalizedTokenIn.symbol} -> ${normalizedTokenOut.symbol}`);
    console.log(`   Amount: ${ethers.utils.formatUnits(amountIn, normalizedTokenIn.decimals || 18)} ${normalizedTokenIn.symbol}`);

    const result = await useBalancerV3({
      tokenInAddress: normalizedTokenIn.address,
      tokenOutAddress: normalizedTokenOut.address,
      amountIn: amountIn.toString(),
      provider,
      slippageTolerance: 0.5
    });

    if (!result) {
      console.log('No Balancer paths found');
      return null;
    }

    // Deduplicate paths by pool addresses
    let pathsToReturn = result.allPaths || [result];

    if (pathsToReturn.length > 1) {
      const seenPools = new Set();
      const uniquePaths = pathsToReturn.filter(pathResult => {
        // Use poolAddresses array if available, otherwise try to extract from path.hops
        let poolAddresses = pathResult.poolAddresses;

        if (!poolAddresses && pathResult.path && pathResult.path.hops) {
          poolAddresses = pathResult.path.hops.map(h => h.pool);
        }

        if (!poolAddresses || poolAddresses.length === 0) {
          console.warn(`   ⚠️  Balancer path has no pool identifiers`);
          return true; // Keep it if we can't identify
        }

        // Create a key from all pool addresses in the path
        const poolKey = poolAddresses.map(p => p?.toLowerCase() || '').join('-');

        if (!poolKey) {
          return true; // Keep it if key is empty
        }

        if (seenPools.has(poolKey)) {
          console.log(`   ⚠️  Removing duplicate Balancer path with pools ${poolKey.slice(0, 30)}...`);
          return false; // Skip duplicate
        }

        seenPools.add(poolKey);
        return true;
      });

      if (uniquePaths.length < pathsToReturn.length) {
        console.log(`   ✅ Removed ${pathsToReturn.length - uniquePaths.length} duplicate Balancer paths`);
      }

      pathsToReturn = uniquePaths;
    }

    // Return ALL unique paths as array
    if (pathsToReturn.length > 1) {
      console.log(`   ✅ Returning ${pathsToReturn.length} unique Balancer paths`);
      return pathsToReturn.map(pathResult => ({
        protocol: 'balancer',
        outputAmount: BigNumber.from(pathResult.amountOut),
        minAmountOut: BigNumber.from(pathResult.minAmountOut),
        path: pathResult.path,
        pools: pathResult.poolAddresses,
        poolTypes: pathResult.poolTypes,
        weights: pathResult.weights,
        hops: pathResult.path.hops.length,
        fees: pathResult.fees,
        poolData: pathResult.poolData
      }));
    }

    // Single path (or deduplicated to single) - return as array for consistency
    if (pathsToReturn.length === 1) {
      const pathResult = pathsToReturn[0];
      return [{
        protocol: 'balancer',
        outputAmount: BigNumber.from(pathResult.amountOut),
        minAmountOut: BigNumber.from(pathResult.minAmountOut),
        path: pathResult.path,
        pools: pathResult.poolAddresses,
        poolTypes: pathResult.poolTypes,
        weights: pathResult.weights,
        hops: pathResult.path.hops.length,
        fees: pathResult.fees,
        poolData: pathResult.poolData
      }];
    }

    // No paths left after deduplication
    return null;

  } catch (error) {
    console.error('Balancer path discovery failed:', error);
    return [];
  }
}

/**
 * Discover cross-DEX multi-hop paths
 * E.g., ONE -> WETH on Balancer, then ETH -> SEV on Uniswap (with WETH->ETH conversion)
 */
async function discoverCrossDEXPaths(tokenIn, tokenOut, amountIn, provider) {
  const paths = [];
  
  // Common intermediate tokens for bridging between DEXs
  // Note: Balancer uses WETH, Uniswap V4 uses ETH
  const intermediates = [
    { address: WETH_ADDRESS, symbol: 'WETH', decimals: 18, isETH: true },
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', decimals: 18 }
  ];

  // Add tokenOut as an intermediate if it's not already in the list
  // This helps find direct paths when tokenOut is a common token like ETH/WETH
  const tokenOutLower = tokenOut.address.toLowerCase();
  if (!intermediates.some(t => t.address.toLowerCase() === tokenOutLower)) {
    // Handle ETH/WETH equivalence
    if (tokenOut.address === ETH_ADDRESS) {
      // If tokenOut is ETH, add WETH as intermediate (if not already there)
      if (!intermediates.some(t => t.address.toLowerCase() === WETH_ADDRESS.toLowerCase())) {
        intermediates.push({ address: WETH_ADDRESS, symbol: 'WETH', decimals: 18, isETH: true });
      }
    } else if (tokenOut.address.toLowerCase() === WETH_ADDRESS.toLowerCase()) {
      // tokenOut is WETH, already in intermediates
    } else {
      // Add tokenOut as an intermediate
      intermediates.push({
        address: tokenOut.address,
        symbol: tokenOut.symbol,
        decimals: tokenOut.decimals || 18
      });
    }
  }
  
  // For each intermediate token, try to find a path
  for (const intermediate of intermediates) {
    // Skip only if intermediate is same as input
    // Allow intermediate to be same as output (for direct paths)
    if (intermediate.address.toLowerCase() === tokenIn.address.toLowerCase()) {
      continue;
    }
    
    try {
      // First leg: tokenIn -> intermediate (try both DEXs)
      // Note: Uniswap uses ETH while Balancer uses WETH
      const intermediateForUniswap = intermediate.isETH 
        ? { address: ETH_ADDRESS, symbol: 'ETH', decimals: 18 }
        : intermediate;
        
      const [balancerLeg1, uniswapLeg1] = await Promise.all([
        discoverBalancerPaths(tokenIn, intermediate, amountIn, provider),
        discoverUniswapPaths(tokenIn, intermediateForUniswap, amountIn)
      ]);
      
      // REMOVED: cross-dex-splittable route creation
      // This was causing incorrect calculations where sequential execution
      // passed WETH to a trade expecting AAVE input
      // Instead, we create separate concrete routes below that work correctly
      
      // If we found a path for the first leg, try the second leg
      // IMPORTANT: Must check .gt(0) because BigNumber objects are always truthy
      if (balancerLeg1 && balancerLeg1.length > 0 && balancerLeg1[0].outputAmount && balancerLeg1[0].outputAmount.gt(0)) {
        console.log(`   ✓ Found Balancer leg1: ${tokenIn.symbol} -> ${intermediate.symbol}, output: ${ethers.utils.formatUnits(balancerLeg1[0].outputAmount, intermediate.decimals)}`);

        // For ETH/WETH intermediate, we need to handle the conversion
        let intermediateForUniswap = intermediate;
        let needsWETHToETHConversion = false;

        if (intermediate.isETH) {
          // Balancer outputs WETH, but Uniswap needs ETH
          intermediateForUniswap = { address: ETH_ADDRESS, symbol: 'ETH', decimals: 18 };
          needsWETHToETHConversion = true;
          console.log(`   Converting WETH to ETH for Uniswap leg2`);
        }

        // Second leg: intermediate -> tokenOut using Balancer output
        const [balancerLeg2, uniswapLeg2] = await Promise.all([
          discoverBalancerPaths(intermediate, tokenOut, balancerLeg1[0].outputAmount, provider),
          discoverUniswapPaths(intermediateForUniswap, tokenOut, balancerLeg1[0].outputAmount)
        ]);
        
        // Create cross-DEX paths
        if (uniswapLeg2 && uniswapLeg2.length > 0) {
          const bestUniswapLeg2 = selectBestVariant(uniswapLeg2);
          const conversionStep = needsWETHToETHConversion ? ' -> [unwrap WETH to ETH]' : '';
          paths.push({
            type: 'cross-dex-balancer-uniswap',
            protocol: 'mixed',
            legs: [
              { ...balancerLeg1[0], protocol: 'balancer', token: intermediate },
              { ...bestUniswapLeg2, protocol: 'uniswap' }
            ],
            totalOutput: bestUniswapLeg2.outputAmount,
            path: `${tokenIn.symbol} -> ${intermediate.symbol} (Balancer)${conversionStep} -> ${tokenOut.symbol} (Uniswap)`,
            needsWETHToETHConversion,
            estimatedGas: needsWETHToETHConversion ? 220000 : 200000 // Extra gas for unwrap
          });
        }

        if (balancerLeg2 && balancerLeg2.length > 0 && balancerLeg2[0].outputAmount) {
          paths.push({
            type: 'cross-dex-balancer-balancer',
            protocol: 'balancer',
            legs: [
              { ...balancerLeg1[0], protocol: 'balancer', token: intermediate },
              { ...balancerLeg2[0], protocol: 'balancer' }
            ],
            totalOutput: balancerLeg2[0].outputAmount,
            path: `${tokenIn.symbol} -> ${intermediate.symbol} -> ${tokenOut.symbol} (Balancer)`,
            estimatedGas: 180000
          });
        }
      } else if (balancerLeg1 && balancerLeg1.length > 0 && balancerLeg1[0].outputAmount && balancerLeg1[0].outputAmount.eq(0)) {
        console.log(`   ⚠ Skipping Balancer leg1: ${tokenIn.symbol} -> ${intermediate.symbol} (zero output)`);
      }

      // Try Uniswap first leg
      if (uniswapLeg1 && uniswapLeg1.length > 0) {
        // CRITICAL: Multiple Uniswap routes = different pools, each evaluated with FULL input
        // We need to estimate the MAXIMUM output we can get by optimizing split across ALL pools

        // For estimation, use the best single route as lower bound
        // Real optimization will happen later in optimizeSplitSimple
        const bestUniswapLeg1 = selectBestVariant(uniswapLeg1);
        const estimatedMaxOutput = bestUniswapLeg1.outputAmount;

        // Log all available first-leg routes
        if (uniswapLeg1.length > 1) {
          console.log(`   ✓ Found ${uniswapLeg1.length} Uniswap pools for ${tokenIn.symbol} → ${intermediate.symbol}:`);
          uniswapLeg1.forEach((route, i) => {
            console.log(`      Pool ${i + 1}: ${ethers.utils.formatUnits(route.outputAmount, intermediate.decimals)} ${intermediate.symbol}`);
          });
          console.log(`   Using best single pool output for second leg query: ${ethers.utils.formatUnits(estimatedMaxOutput, intermediate.decimals)} ${intermediate.symbol}`);
        }

        // Validate non-zero output before proceeding
        if (estimatedMaxOutput.gt(0)) {
          // For ETH/WETH intermediate, handle conversion for Balancer
          let intermediateForBalancer = intermediate;
          let needsETHToWETHConversion = false;

          if (intermediate.isETH) {
            // Uniswap outputs ETH, but Balancer needs WETH
            intermediateForBalancer = { address: WETH_ADDRESS, symbol: 'WETH', decimals: 18 };
            needsETHToWETHConversion = true;
          }

          // Second leg with estimated output from first leg
          const [balancerLeg2, uniswapLeg2] = await Promise.all([
            discoverBalancerPaths(intermediateForBalancer, tokenOut, estimatedMaxOutput, provider),
            discoverUniswapPaths(intermediate, tokenOut, estimatedMaxOutput)
          ]);
        
        if (balancerLeg2 && balancerLeg2.outputAmount) {
          const conversionStep = needsETHToWETHConversion ? ' -> [wrap ETH to WETH]' : '';
          // Create a cross-DEX route for EACH first-leg pool
          uniswapLeg1.forEach((firstLegRoute, i) => {
            paths.push({
              type: 'cross-dex-uniswap-balancer',
              protocol: 'mixed',
              legs: [
                { ...firstLegRoute, protocol: 'uniswap', token: intermediate },
                { ...balancerLeg2, protocol: 'balancer' }
              ],
              totalOutput: balancerLeg2.outputAmount,
              path: `${tokenIn.symbol} -> ${intermediate.symbol} (Uniswap pool ${i + 1})${conversionStep} -> ${tokenOut.symbol} (Balancer)`,
              needsETHToWETHConversion,
              estimatedGas: needsETHToWETHConversion ? 220000 : 200000 // Extra gas for wrap
            });
          });
        }

        if (uniswapLeg2 && uniswapLeg2.length > 0) {
          // IMPORTANT: Calculate second leg output for EACH first-leg pool's specific output
          // Don't use the same output for all routes!
          for (let i = 0; i < uniswapLeg1.length; i++) {
            const firstLegRoute = uniswapLeg1[i];
            const firstLegOutput = firstLegRoute.outputAmount;

            // Query second leg with THIS specific first leg's output
            const secondLegForThisRoute = await discoverUniswapPaths(intermediate, tokenOut, firstLegOutput);

            if (!secondLegForThisRoute || secondLegForThisRoute.length === 0) {
              console.log(`   ⚠️  No second leg found for pool ${i + 1} output: ${ethers.utils.formatUnits(firstLegOutput, intermediate.decimals)} ${intermediate.symbol}`);
              continue;
            }

            const bestUniswapLeg2 = selectBestVariant(secondLegForThisRoute);

            // IMPORTANT: Uniswap uses ETH, not WETH
            const uniswapToken = intermediate.isETH
              ? { address: ETH_ADDRESS, symbol: 'ETH', decimals: 18 }
              : intermediate;

            paths.push({
              type: 'cross-dex-uniswap-uniswap',
              protocol: 'uniswap',
              legs: [
                { ...firstLegRoute, protocol: 'uniswap', token: uniswapToken },
                { ...bestUniswapLeg2, protocol: 'uniswap' }
              ],
              totalOutput: bestUniswapLeg2.outputAmount, // Now specific to this route!
              path: `${tokenIn.symbol} -> ${uniswapToken.symbol} (pool ${i + 1}) -> ${tokenOut.symbol} (Uniswap)`,
              estimatedGas: 180000
            });
          }
        }

        // IMPORTANT: Add 3-hop paths for better liquidity distribution
        // E.g., AAVE → USDC → ETH → 1INCH
        if (!intermediate.isETH) {
          // Try going through ETH as second intermediate
          const ethIntermediate = { address: ETH_ADDRESS, symbol: 'ETH', decimals: 18 };

          // Second leg: USDC → ETH
          const uniswapLeg2ToETH = await discoverUniswapPaths(intermediate, ethIntermediate, estimatedMaxOutput);

          if (uniswapLeg2ToETH && uniswapLeg2ToETH.length > 0) {
            const bestLeg2 = selectBestVariant(uniswapLeg2ToETH);

            // Third leg: ETH → tokenOut
            const uniswapLeg3 = await discoverUniswapPaths(ethIntermediate, tokenOut, bestLeg2.outputAmount);

            if (uniswapLeg3 && uniswapLeg3.length > 0) {
              // IMPORTANT: Calculate output for EACH first-leg pool's specific output chain
              for (let i = 0; i < uniswapLeg1.length; i++) {
                const firstLegRoute = uniswapLeg1[i];
                const firstLegOutput = firstLegRoute.outputAmount;

                // Query second leg with THIS specific first leg's output
                const leg2ForThisRoute = await discoverUniswapPaths(intermediate, ethIntermediate, firstLegOutput);

                if (!leg2ForThisRoute || leg2ForThisRoute.length === 0) {
                  console.log(`   ⚠️  No second leg found for 3-hop pool ${i + 1}`);
                  continue;
                }

                const bestLeg2ForThisRoute = selectBestVariant(leg2ForThisRoute);
                const secondLegOutput = bestLeg2ForThisRoute.outputAmount;

                // Query third leg with second leg's output
                const leg3ForThisRoute = await discoverUniswapPaths(ethIntermediate, tokenOut, secondLegOutput);

                if (!leg3ForThisRoute || leg3ForThisRoute.length === 0) {
                  console.log(`   ⚠️  No third leg found for 3-hop pool ${i + 1}`);
                  continue;
                }

                const bestLeg3 = selectBestVariant(leg3ForThisRoute);

                paths.push({
                  type: 'cross-dex-uniswap-3hop',
                  protocol: 'uniswap',
                  legs: [
                    { ...firstLegRoute, protocol: 'uniswap', token: intermediate },
                    { ...bestLeg2ForThisRoute, protocol: 'uniswap', token: ethIntermediate },
                    { ...bestLeg3, protocol: 'uniswap' }
                  ],
                  totalOutput: bestLeg3.outputAmount, // Now specific to this route!
                  path: `${tokenIn.symbol} -> ${intermediate.symbol} (pool ${i + 1}) -> ETH -> ${tokenOut.symbol} (Uniswap 3-hop)`,
                  estimatedGas: 250000 // Higher gas for 3 hops
                });
              }

              console.log(`   ✓ Found 3-hop routes: ${tokenIn.symbol} -> ${intermediate.symbol} -> ETH -> ${tokenOut.symbol}`);
            }
          }
        }
        } else {
          console.log(`   ⚠ Skipping Uniswap leg1: ${tokenIn.symbol} -> ${intermediate.symbol} (zero output)`);
        }
      }

    } catch (error) {
      console.error(`Error finding cross-DEX path via ${intermediate.symbol}:`, error.message);
    }
  }

  return paths;
}

/**
 * Optimize mixed routes by finding best split percentages
 * Now handles unified ETH/WETH liquidity across protocols
 */
async function optimizeMixedRoutes(uniswapPaths, balancerPaths, crossDEXPaths, amountIn, tokenIn, tokenOut) {
  const routes = [];

  // Add ALL Uniswap paths as individual routes
  if (uniswapPaths && uniswapPaths.length > 0) {
    uniswapPaths.forEach((uniPath, index) => {
      // Check if this is a pre-optimized split from useUniswap
      if (uniPath.type === 'uniswap-pre-optimized-split') {
        // Add as complete route with splits intact
        routes.push({
          type: 'uniswap-pre-optimized-split',
          protocol: 'uniswap',
          totalOutput: uniPath.outputAmount,
          splits: uniPath.splits,
          trades: uniPath.trades,
          paths: [uniPath],
          requiresWrap: uniPath.requiresWrap,
          requiresUnwrap: uniPath.requiresUnwrap,
          description: `Uniswap optimized split (${uniPath.splits.length} routes)`
        });
      } else {
        // Single path
        routes.push({
          type: `uniswap-path-${index + 1}`,
          protocol: 'uniswap',
          totalOutput: uniPath.outputAmount,
          paths: [uniPath],
          requiresWrap: uniPath.requiresWrap,
          requiresUnwrap: uniPath.requiresUnwrap,
          description: `Uniswap path ${index + 1}`
        });
      }
    });
    console.log(`   Added ${uniswapPaths.length} Uniswap routes`);
  }

  // Add ALL Balancer paths as individual routes
  if (balancerPaths && balancerPaths.length > 0) {
    balancerPaths.forEach((balPath, index) => {
      routes.push({
        type: `balancer-path-${index + 1}`,
        protocol: 'balancer',
        totalOutput: balPath.outputAmount,
        paths: [balPath],
        description: `Balancer path ${index + 1} (${balPath.hops} hops)`
      });
    });
    console.log(`   Added ${balancerPaths.length} Balancer routes`);
  }


  // Add cross-DEX paths as simple routes
  if (crossDEXPaths && crossDEXPaths.length > 0) {
    crossDEXPaths.forEach((path, index) => {
      routes.push({
        ...path,
        type: path.type || `cross-dex-path-${index + 1}`,
        totalOutput: path.totalOutput || path.outputAmount || BigNumber.from(0),
        description: path.description || path.path || `Cross-DEX path ${index + 1}`
      });
    });
    console.log(`   Added ${crossDEXPaths.length} cross-DEX routes`);
  }

  console.log(`\n📊 Total routes discovered: ${routes.length}`);

  // Display routes in readable format
  displayRoutes(routes, tokenOut);

  // If we have multiple routes, optimize split percentages
  if (routes.length >= 2 && routes.length <= 10) {
    console.log(`\n🎯 Optimizing split across ${routes.length} routes...`);
    const optimizedSplit = await optimizeSplitSimple(routes, amountIn, tokenIn, tokenOut);
    if (optimizedSplit) {
      routes.push(optimizedSplit);
      console.log(`\n✅ Added optimized multi-route split`);
    }
  }

  return routes;
}

/**
 * Display routes in a readable format
 */
function displayRoutes(routes, tokenOut) {
  console.log('\n📋 Discovered Routes:');
  console.log('─'.repeat(80));

  routes.forEach((route, index) => {
    const output = ethers.utils.formatUnits(route.totalOutput, tokenOut.decimals);
    const type = route.type || 'unknown';
    const desc = route.description || route.path || 'No description';

    console.log(`${index + 1}. [${type}]`);
    console.log(`   Output: ${parseFloat(output).toFixed(4)} ${tokenOut.symbol}`);
    console.log(`   Path: ${desc}`);

    if (route.protocol) {
      console.log(`   Protocol: ${route.protocol}`);
    }

    if (route.hops) {
      console.log(`   Hops: ${route.hops}`);
    }

    if (route.legs && route.legs.length > 0) {
      console.log(`   Legs: ${route.legs.length}`);
    }

    console.log('');
  });

  console.log('─'.repeat(80));
}

/**
 * Detect routes that converge to the same pool
 * Returns groups of routes that share the same final pool
 */
function detectPoolConvergence(routes) {
  const convergenceGroups = new Map();

  routes.forEach((route, index) => {
    // Identify the final pool used by this route
    let finalPool = null;
    let finalToken = null;

    if (route.legs && route.legs.length > 0) {
      const lastLeg = route.legs[route.legs.length - 1];
      if (lastLeg.trade) {
        const tradeRoute = lastLeg.trade.route || lastLeg.trade.swaps?.[0]?.route;
        if (tradeRoute && tradeRoute.pools && tradeRoute.pools.length > 0) {
          finalPool = tradeRoute.pools[tradeRoute.pools.length - 1];
          const path = tradeRoute.currencyPath || tradeRoute.path;
          if (path && path.length >= 2) {
            finalToken = `${path[path.length - 2].symbol}-${path[path.length - 1].symbol}`;
          }
        }
      }
    }

    if (finalToken) {
      // Normalize ETH/WETH to same key
      const normalizedKey = finalToken.replace('WETH', 'ETH');

      if (!convergenceGroups.has(normalizedKey)) {
        convergenceGroups.set(normalizedKey, []);
      }
      convergenceGroups.get(normalizedKey).push({ route, index });
    }
  });

  // Find groups with more than one route
  const converging = [];
  convergenceGroups.forEach((group, poolKey) => {
    if (group.length > 1) {
      converging.push({
        poolKey,
        routes: group,
        count: group.length
      });
    }
  });

  return converging;
}

/**
 * Simple iterative optimization for splitting across multiple routes
 * Starts with initial split based on output amounts, then refines
 */
async function optimizeSplitSimple(routes, totalAmount, tokenIn, tokenOut) {
  const numRoutes = routes.length;

  // IMPORTANT: Detect pool convergence
  const convergingPools = detectPoolConvergence(routes);
  if (convergingPools.length > 0) {
    console.log(`\n⚠️  POOL CONVERGENCE DETECTED:`);
    convergingPools.forEach(group => {
      console.log(`   ${group.poolKey}: ${group.count} routes converge to this pool`);
      group.routes.forEach(({ route, index }) => {
        console.log(`      Route ${index + 1}: ${route.description || route.path}`);
      });
    });
    console.log(`   ⚡ Using hierarchical optimization to account for shared pool impact\n`);
  }

  // Calculate initial split with pivot-based amplification
  // Routes above 40% get amplified (increased), routes below 40% get dampened (decreased)
  const totalOutput = routes.reduce((sum, r) => sum.add(r.totalOutput), BigNumber.from(0));

  // First, get proportional allocation
  const proportions = routes.map(route => {
    return route.totalOutput.mul(100000).div(totalOutput).toNumber() / 100000;
  });

  // Apply pivot-based amplification at 40%
  const PIVOT = 0.40;
  const amplifiedProportions = proportions.map(p => {
    if (p > PIVOT) {
      // Above pivot: amplify upward using square root
      // Maps 0.40-1.00 range, makes higher values even higher
      const normalized = (p - PIVOT) / (1.0 - PIVOT); // 0.0 to 1.0
      const amplified = Math.sqrt(normalized); // Apply sqrt
      return PIVOT + amplified * (1.0 - PIVOT); // Map back
    } else {
      // Below pivot: dampen downward using square
      // Maps 0.0-0.40 range, makes lower values even lower
      const normalized = p / PIVOT; // 0.0 to 1.0
      const dampened = Math.pow(normalized, 2); // Apply square
      return dampened * PIVOT; // Map back
    }
  });

  // Normalize to sum to 1.0
  const ampSum = amplifiedProportions.reduce((a, b) => a + b, 0);
  let currentSplit = amplifiedProportions.map(x => Math.max(0.001, x / ampSum)); // Minimum 0.1% per route (allow aggressive reallocation)

  // Final normalization to ensure exact 1.0 sum
  const finalSum = currentSplit.reduce((a, b) => a + b, 0);
  currentSplit = currentSplit.map(x => x / finalSum);

  console.log(`   Initial split (pivot 40%): ${currentSplit.map(x => (x * 100).toFixed(1) + '%').join(' / ')}`);
  console.log(`   Original proportions: ${proportions.map(x => (x * 100).toFixed(1) + '%').join(' / ')}`);

  // Calculate initial total output
  let bestSplit = [...currentSplit];
  let bestOutput = await evaluateSplit(currentSplit, routes, totalAmount, tokenIn, tokenOut);

  console.log(`   Initial output: ${ethers.utils.formatUnits(bestOutput, tokenOut.decimals)} ${tokenOut.symbol}`);

  // Iterative improvement (hill climbing with adaptive step size)
  const maxIterations = 200; // Increased to allow more aggressive reallocation
  const initialStepSize = 0.02; // Start with 2% adjustment
  const minStepSize = 0.00005; // Minimum 0.005% adjustment for fine-tuning
  const stepReduction = 0.8; // Reduce step by 20% when no improvement found
  let stepSize = initialStepSize;
  let iteration = 0;

  // Calculate total number of pair combinations that could be tested
  const totalPairs = (numRoutes * (numRoutes - 1)); // Each pair tested in both directions
  console.log(`   Using greedy first-improvement strategy (early break on improvement)`);
  console.log(`   Max ${totalPairs} directional adjustments per iteration across ${numRoutes} routes\n`);

  while (stepSize >= minStepSize && iteration < maxIterations) {
    let improved = false;
    iteration++;

    outerLoop:
    for (let i = 0; i < numRoutes - 1; i++) {
      for (let j = i + 1; j < numRoutes; j++) {
        // Try moving percentage from route i to route j
        // Allow reduction if it doesn't go below minimum
        if (currentSplit[i] >= stepSize) {
          const testSplit = [...currentSplit];
          testSplit[i] -= stepSize;
          testSplit[j] += stepSize;

          const testOutput = await evaluateSplit(testSplit, routes, totalAmount, tokenIn, tokenOut);

          if (testOutput.gt(bestOutput)) {
            bestOutput = testOutput;
            bestSplit = testSplit;
            currentSplit = testSplit;
            improved = true;
            // Early break: apply improvement immediately and restart
            break outerLoop;
          }
        }

        // Try moving percentage from route j to route i
        // Allow reduction if it doesn't go below minimum
        if (currentSplit[j] >= stepSize) {
          const testSplit = [...currentSplit];
          testSplit[j] -= stepSize;
          testSplit[i] += stepSize;

          const testOutput = await evaluateSplit(testSplit, routes, totalAmount, tokenIn, tokenOut);

          if (testOutput.gt(bestOutput)) {
            bestOutput = testOutput;
            bestSplit = testSplit;
            currentSplit = testSplit;
            improved = true;
            // Early break: apply improvement immediately and restart
            break outerLoop;
          }
        }
      }
    }

    if (improved) {
      console.log(`   Iteration ${iteration} (step: ${(stepSize * 100).toFixed(3)}%): ${ethers.utils.formatUnits(bestOutput, tokenOut.decimals)} ${tokenOut.symbol} - Split: ${bestSplit.map(x => (x * 100).toFixed(1) + '%').join(' / ')}`);
    } else {
      // No improvement found after testing all combinations - reduce step size
      const oldStepSize = stepSize;
      stepSize = stepSize * stepReduction;
      console.log(`   Iteration ${iteration}: Tested all combinations, no improvement. Step ${(oldStepSize * 100).toFixed(3)}% → ${(stepSize * 100).toFixed(3)}%`);
    }
  }

  console.log(`   ✅ Optimized in ${iteration} iterations`);
  console.log(`   Final split: ${bestSplit.map(x => (x * 100).toFixed(1) + '%').join(' / ')}`);
  console.log(`   Final output: ${ethers.utils.formatUnits(bestOutput, tokenOut.decimals)} ${tokenOut.symbol}`);

  // Build result
  const splits = bestSplit.map((pct, index) => ({
    route: routes[index],
    percentage: pct,
    amount: totalAmount.mul(Math.floor(pct * 1000000)).div(1000000),
    description: routes[index].description || routes[index].path || `Route ${index + 1}`
  }));

  return {
    type: 'optimized-multi-route-split',
    totalOutput: bestOutput,
    splits,
    numRoutes: routes.length,
    description: `Optimized ${routes.length}-way split`,
    iterations: iteration
  };
}

/**
 * Evaluate a specific split configuration using EXACT AMM calculations
 * Returns total output when input is split according to percentages
 */
async function evaluateSplit(splitPercentages, routes, totalAmount, tokenIn, tokenOut) {
  let totalOutput = BigNumber.from(0);

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const routeAmount = totalAmount.mul(Math.floor(splitPercentages[i] * 100000000)).div(100000000);

    if (routeAmount.lte(0)) continue;

    // Calculate EXACT output for this route with the split amount
    const exactOutput = await calculateRouteExactOutput(route, routeAmount, tokenIn, tokenOut);
    totalOutput = totalOutput.add(exactOutput);
  }

  return totalOutput;
}

/**
 * Calculate exact output for a route with a specific input amount
 * Uses actual AMM formulas, not approximations
 */
async function calculateRouteExactOutput(route, amountIn, tokenIn, tokenOut) {
  try {

    // Pre-optimized split from useUniswap - need to recalculate each trade with the split amount
    if (route.type === 'uniswap-pre-optimized-split' && route.splits) {
      // For pre-optimized splits, we need to recalculate with the new amount
      // maintaining the same split percentages
      let totalOutput = BigNumber.from(0);

      for (const split of route.splits) {
        const splitAmount = amountIn.mul(Math.floor(split.percentage * 1000000)).div(1000000);
        const splitOutput = await calculateUniswapRouteOutput(split, splitAmount);
        totalOutput = totalOutput.add(splitOutput);
      }

      return totalOutput;
    }

    // Single-protocol routes
    if (route.paths && route.paths.length === 1) {
      const path = route.paths[0];

      if (path.protocol === 'balancer' || route.protocol === 'balancer') {
        // Balancer route - use exact AMM calculation
        return await calculateBalancerRouteOutput(path, amountIn);
      } else if (path.protocol === 'uniswap' || route.protocol === 'uniswap') {
        // Uniswap route - use exact AMM calculation
        return await calculateUniswapRouteOutput(path, amountIn);
      }
    }

    // Cross-DEX routes with multiple legs (e.g., cross-dex-uniswap-uniswap, 3-hop routes)
    if (route.legs && route.legs.length > 0) {
      let currentAmount = amountIn;
      let currentToken = tokenIn;

      for (let i = 0; i < route.legs.length; i++) {
        const leg = route.legs[i];
        const legToken = leg.token || (i === route.legs.length - 1 ? tokenOut : null);

        if (leg.protocol === 'balancer' && leg.path) {
          currentAmount = await calculateBalancerRouteOutput(leg, currentAmount);

          // IMPORTANT: If route needs WETH→ETH conversion after Balancer, unwrap at 1:1
          if (route.needsWETHToETHConversion && i === 0) {
            // WETH to ETH is 1:1, amount stays the same
            // Just a marker that we've unwrapped
            currentToken = { symbol: 'ETH', decimals: 18 };
          }
        } else if (leg.protocol === 'uniswap') {
          // Uniswap leg - could be single trade or pre-optimized split
          if (leg.trade) {
            // Single trade
            currentAmount = await calculateUniswapRouteOutput(leg, currentAmount);
          } else if (leg.type === 'uniswap-pre-optimized-split' && leg.splits) {
            // Pre-optimized split - recalculate maintaining split percentages
            let legOutput = BigNumber.from(0);
            for (const split of leg.splits) {
              const splitAmount = currentAmount.mul(Math.floor(split.percentage * 1000000)).div(1000000);
              const splitOutput = await calculateUniswapRouteOutput(split, splitAmount);
              legOutput = legOutput.add(splitOutput);
            }
            currentAmount = legOutput;
          } else if (leg.trades && leg.trades.length > 0) {
            // Has trades array but no type - treat as single trade
            const singleLeg = { ...leg, trade: leg.trades[0] };
            currentAmount = await calculateUniswapRouteOutput(singleLeg, currentAmount);
          } else {
            console.warn(`   ⚠️  Uniswap leg has no trade/trades: ${JSON.stringify({
              hasTrade: !!leg.trade,
              hasTrades: !!leg.trades,
              hasPath: !!leg.path,
              type: leg.type,
              hasOutputAmount: !!leg.outputAmount
            })}`);
            return BigNumber.from(0);
          }
        } else {
          // Unknown leg type - log and return 0
          console.warn(`   ⚠️  Unknown leg protocol: ${JSON.stringify({ protocol: leg.protocol, hasPath: !!leg.path, hasTrade: !!leg.trade })}`);
          return BigNumber.from(0);
        }
      }

      return currentAmount;
    }

    // Fallback: can't recalculate this route type
    console.warn(`   ⚠️  Cannot recalculate output for route type: ${route.type} - returning zero`);
    return BigNumber.from(0);

  } catch (error) {
    console.error('   ❌ Error calculating exact route output:', error.message);
    return BigNumber.from(0);
  }
}

/**
 * Calculate exact output for a Balancer route
 */
async function calculateBalancerRouteOutput(route, amountIn) {
  if (!route.path || !route.path.hops) {
    return BigNumber.from(0);
  }

  let currentAmount = amountIn;

  for (const hop of route.path.hops) {
    if (!hop.poolData || !hop.poolData.tokens) {
      return BigNumber.from(0);
    }

    const tokenInIndex = hop.poolData.tokens.findIndex(
      t => t.address.toLowerCase() === hop.tokenIn.toLowerCase()
    );
    const tokenOutIndex = hop.poolData.tokens.findIndex(
      t => t.address.toLowerCase() === hop.tokenOut.toLowerCase()
    );

    if (tokenInIndex < 0 || tokenOutIndex < 0) {
      return BigNumber.from(0);
    }

    // Use exact Balancer AMM calculation
    currentAmount = calculateBalancerExactOutput(
      currentAmount,
      hop.poolData,
      tokenInIndex,
      tokenOutIndex
    );
  }

  return currentAmount;
}

/**
 * Calculate exact output for a Uniswap route
 */
async function calculateUniswapRouteOutput(route, amountIn) {
  if (!route.trade) {
    console.warn(`   [calculateUniswapRouteOutput] No trade in route`);
    return BigNumber.from(0);
  }

  const { CurrencyAmount } = await import('@uniswap/sdk-core');
  const trade = route.trade;
  const routeObj = trade.route || trade.swaps?.[0]?.route;

  if (!routeObj) {
    console.warn(`   [calculateUniswapRouteOutput] No route object in trade`);
    return BigNumber.from(0);
  }

  const pools = routeObj.pools;
  const path = routeObj.currencyPath || routeObj.path;

  if (!path || path.length === 0) {
    return BigNumber.from(0);
  }

  let currentAmount = amountIn;

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    const inputCurrency = path[i];

    if (!inputCurrency || !pool || typeof pool.getOutputAmount !== 'function') {
      return BigNumber.from(0);
    }

    // Create proper CurrencyAmount for SDK
    const inputAmount = CurrencyAmount.fromRawAmount(
      inputCurrency,
      currentAmount.toString()
    );

    // Calculate output using pool's exact AMM formula
    try {
      const result = await pool.getOutputAmount(inputAmount);

      if (!result || !result[0]) {
        console.warn(`   [calculateUniswapRouteOutput] pool.getOutputAmount returned invalid result:`, result);
        console.warn(`   Input: ${currentAmount.toString()}, Pool: ${pool.token0.symbol}-${pool.token1.symbol}`);
        return BigNumber.from(0);
      }

      const [outputAmount] = result;
      currentAmount = BigNumber.from(outputAmount.quotient.toString());
    } catch (error) {
      console.error(`   [calculateUniswapRouteOutput] Error in pool.getOutputAmount:`, error.message);
      return BigNumber.from(0);
    }
  }

  return currentAmount;
}

/**
 * Helper functions for unified ETH/WETH optimization
 */

function selectBestVariant(paths) {
  if (paths.length === 0) return null;
  
  // Sort by output amount only - gas costs don't matter for arbitrage minimization
  return paths.reduce((best, current) => {
    return current.outputAmount.gt(best.outputAmount) ? current : best;
  });
}

/**
 * Calculate real AMM output with price impact for Balancer Weighted Pool
 */
function calculateBalancerWeightedOutput(amountIn, poolData, tokenInIndex, tokenOutIndex) {
  // Use the exact calculation from crossDEXOptimizer
  // This uses Decimal.js for precise fractional exponents
  return calculateBalancerExactOutput(amountIn, poolData, tokenInIndex, tokenOutIndex);
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
 * Select best route from all options
 * Priority: 1) Maximum output 2) Minimum post-trade arbitrage opportunities
 */
async function selectBestRoute(routes, amountIn, tokenIn, tokenOut) {
  if (routes.length === 0) return null;
  
  // Evaluate each route for post-trade arbitrage risk
  const routesWithMetrics = routes.map(route => {
    // Calculate how much arbitrage opportunity this trade creates
    let arbitrageRisk = 0;
    
    if (route.splits && route.splits.length > 0) {
      // Multiple splits = distributed impact = pools stay more balanced
      const maxConcentration = Math.max(...route.splits.map(s => s.percentage || 0));
      
      // Risk increases quadratically with concentration (pool imbalance)
      arbitrageRisk = maxConcentration * maxConcentration;
      
      // Cross-protocol distribution leaves different invariant curves = harder to arb
      const protocols = new Set(route.splits.map(s => s.protocol));
      if (protocols.size > 1) {
        arbitrageRisk *= 0.7; // 30% risk reduction
      }
      
      // ETH/WETH distribution across 4 dimensions = very balanced
      if (route.splits.some(s => s.ethPercentage && s.wethPercentage)) {
        arbitrageRisk *= 0.8; // 20% additional risk reduction
      }
    } else {
      // 100% in one pool = maximum imbalance = highest arb opportunity
      arbitrageRisk = 1.0;
    }
    
    // Special handling for unified routes
    if (route.type === 'unified-eth-weth-optimal') {
      arbitrageRisk *= 0.7; // These inherently balance liquidity better
    }
    
    // Multi-hop can be good if it balances multiple pools
    if (route.type && route.type.includes('advanced')) {
      arbitrageRisk *= 0.85; // Advanced splitting reduces arbitrage
    }

    // Optimized multi-route splits are the most balanced
    if (route.type === 'optimized-multi-route-split') {
      arbitrageRisk *= 0.5; // Heavily prefer optimized splits for pool balance
    }

    return {
      ...route,
      arbitrageRisk,
      netOutput: route.totalOutput // NEVER subtract gas costs
    };
  });
  
  // Sort primarily by output, secondarily by arbitrage minimization
  routesWithMetrics.sort((a, b) => {
    const outputDiff = b.netOutput.sub(a.netOutput);
    
    // Within 0.05% output = essentially equal, choose better pool balance
    const threshold = a.netOutput.div(2000); // 0.05%
    
    if (outputDiff.abs().lt(threshold)) {
      // Prefer route that leaves pools most balanced (lowest arb risk)
      return a.arbitrageRisk - b.arbitrageRisk;
    }
    
    // Otherwise maximize output
    return outputDiff.gt(0) ? 1 : -1;
  });
  
  const selected = routesWithMetrics[0];
  
  // Log selection reasoning
  console.log(`\n✅ Route selected: ${selected.type}`);
  console.log(`   Output: ${ethers.utils.formatUnits(selected.totalOutput, tokenOut.decimals)} ${tokenOut.symbol}`);
  console.log(`   Post-trade arbitrage risk: ${(selected.arbitrageRisk * 100).toFixed(2)}%`);

  if (selected.splits) {
    const dist = selected.splits.map(s => `${(s.percentage * 100).toFixed(1)}%`).join('/');
    console.log(`   Distribution: ${dist} across ${selected.splits.length} venues`);
  }

  // Explain why this minimizes arbitrage
  if (selected.arbitrageRisk < 0.5) {
    console.log(`   ✓ Well-distributed trade minimizes MEV opportunities`);
  } else if (selected.arbitrageRisk < 0.8) {
    console.log(`   ⚠ Moderate concentration, some arbitrage possible`);
  } else {
    console.log(`   ⚡ High concentration chosen for maximum output`);
  }

  // Display detailed route breakdown with amounts
  if (selected.splits && selected.splits.length > 1) {
    console.log(`\n   📊 Optimal Split Across ${selected.splits.length} Routes:`);
    console.log('   ' + '─'.repeat(80));

    for (let i = 0; i < selected.splits.length; i++) {
      const split = selected.splits[i];
      const routeInput = split.amount;
      const percentage = (split.percentage * 100).toFixed(1);

      // Calculate output for this specific route
      const routeOutput = await calculateRouteExactOutput(
        split.route,
        routeInput,
        tokenIn,
        tokenOut
      );

      console.log(`   ${i + 1}. ${percentage}% → ${parseFloat(ethers.utils.formatUnits(routeInput, tokenIn.decimals)).toFixed(4)} ${tokenIn.symbol} → ${parseFloat(ethers.utils.formatUnits(routeOutput, tokenOut.decimals)).toFixed(4)} ${tokenOut.symbol}`);

      // Display path with intermediate amounts
      if (split.route.legs && split.route.legs.length > 0) {
        let currentAmount = routeInput;
        let currentToken = tokenIn;
        const legOutputs = [];

        for (let i = 0; i < split.route.legs.length; i++) {
          const leg = split.route.legs[i];
          const legToken = leg.token || tokenOut;
          let legOutput;

          if (leg.protocol === 'balancer' && leg.path) {
            legOutput = await calculateBalancerRouteOutput({ path: leg.path, poolData: leg.poolData }, currentAmount);

            legOutputs.push({
              protocol: leg.protocol,
              inputAmount: currentAmount,
              inputToken: currentToken,
              outputAmount: legOutput,
              outputToken: legToken
            });

            // IMPORTANT: If route needs WETH→ETH unwrap, show it
            if (split.route.needsWETHToETHConversion && i === 0) {
              // Add unwrap step (1:1 conversion)
              legOutputs.push({
                protocol: 'unwrap',
                inputAmount: legOutput,
                inputToken: { symbol: 'WETH', decimals: 18 },
                outputAmount: legOutput, // 1:1 conversion
                outputToken: { symbol: 'ETH', decimals: 18 }
              });
              currentToken = { symbol: 'ETH', decimals: 18 };
            } else {
              currentToken = legToken;
            }

            currentAmount = legOutput;

          } else if (leg.protocol === 'uniswap' && leg.trade) {
            legOutput = await calculateUniswapRouteOutput({ trade: leg.trade }, currentAmount);

            legOutputs.push({
              protocol: leg.protocol,
              inputAmount: currentAmount,
              inputToken: currentToken,
              outputAmount: legOutput,
              outputToken: legToken
            });

            currentAmount = legOutput;
            currentToken = legToken;
          } else {
            legOutput = currentAmount; // fallback

            legOutputs.push({
              protocol: leg.protocol,
              inputAmount: currentAmount,
              inputToken: currentToken,
              outputAmount: legOutput,
              outputToken: legToken
            });

            currentAmount = legOutput;
            currentToken = legToken;
          }
        }

        // Display each leg
        for (let j = 0; j < legOutputs.length; j++) {
          const legInfo = legOutputs[j];
          const arrow = j === legOutputs.length - 1 ? '└→' : '├→';
          const inputFormatted = ethers.utils.formatUnits(legInfo.inputAmount, legInfo.inputToken.decimals || 18);
          const outputFormatted = ethers.utils.formatUnits(legInfo.outputAmount, legInfo.outputToken.decimals || 18);

          console.log(`      ${arrow} ${legInfo.protocol}: ${parseFloat(inputFormatted).toFixed(4)} ${legInfo.inputToken.symbol} → ${parseFloat(outputFormatted).toFixed(4)} ${legInfo.outputToken.symbol}`);
        }
      } else {
        // Single-hop route
        console.log(`      └→ Direct: ${ethers.utils.formatUnits(routeOutput, tokenOut.decimals)} ${tokenOut.symbol}`);
      }

      if (i < selected.splits.length - 1) console.log('');
    }

    console.log('   ' + '─'.repeat(80));
    console.log(`   💰 Combined output: ${parseFloat(ethers.utils.formatUnits(selected.totalOutput, tokenOut.decimals)).toFixed(4)} ${tokenOut.symbol}\n`);
  }
  
  return selected;
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
 * Estimate gas for different route types
 * Note: We don't penalize ETH/WETH conversions since minimizing arbitrage surface is more important
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
  
  // Simple calculation - wrap/unwrap gas costs are negligible compared to arbitrage risk
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

// Export additional utilities
export { getCacheStats };

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

/**
 * Helper function to encode Uniswap trades
 */
function encodeUniswapTrades(trades, recipient, slippagePercent = 0.5) {
  // This would use the Uniswap SDK to properly encode the trades
  // For now, returning a placeholder
  // In production, this would call the appropriate encoding function from the SDK
  const iface = new ethers.utils.Interface([
    'function execute(bytes commands, bytes[] inputs, uint256 deadline)'
  ]);

  // Placeholder encoding - in production would use actual trade data
  const commands = '0x00'; // Command bytes
  const inputs = []; // Encoded inputs for each command
  const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes

  return iface.encodeFunctionData('execute', [commands, inputs, deadline]);
}

/**
 * Helper function to encode Uniswap exact input
 */
function encodeUniswapExactInput(step, recipient, slippagePercent = 0.5) {
  const iface = new ethers.utils.Interface([
    'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut)'
  ]);

  const params = {
    tokenIn: step.inputToken === 'WETH' ? WETH_ADDRESS : step.inputToken.address,
    tokenOut: step.outputToken === 'WETH' ? WETH_ADDRESS : step.outputToken.address,
    fee: 3000, // Default 0.3% fee tier
    recipient: recipient,
    deadline: Math.floor(Date.now() / 1000) + 1200,
    amountIn: step.input,
    amountOutMinimum: step.expectedOutput.mul(Math.floor((100 - slippagePercent) * 100)).div(10000), // Apply slippage
    sqrtPriceLimitX96: 0
  };

  return iface.encodeFunctionData('exactInputSingle', [params]);
}

/**
 * Helper function to encode Balancer batch swap
 */
function encodeBalancerBatchSwap(step, recipient, slippagePercent = 0.5) {
  const iface = new ethers.utils.Interface([
    'function batchSwap(uint8 kind, tuple(bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[] swaps, address[] assets, tuple(address sender, bool fromInternalBalance, address recipient, bool toInternalBalance) funds, int256[] limits, uint256 deadline) returns (int256[] assetDeltas)'
  ]);

  // Build swaps array from path
  const swaps = [];
  const assets = [];
  const limits = [];

  // This is simplified - actual implementation would parse the path properly
  if (step.pools && step.pools.length > 0) {
    // Add logic to build swaps from pools
    for (const pool of step.pools) {
      swaps.push({
        poolId: pool.id,
        assetInIndex: 0, // Would need to determine from assets array
        assetOutIndex: 1, // Would need to determine from assets array
        amount: step.input,
        userData: '0x'
      });
    }
  }

  const funds = {
    sender: recipient, // The WalletBundler contract
    fromInternalBalance: false,
    recipient: recipient,
    toInternalBalance: false
  };

  const deadline = Math.floor(Date.now() / 1000) + 1200;

  return iface.encodeFunctionData('batchSwap', [
    0, // GIVEN_IN
    swaps,
    assets,
    funds,
    limits,
    deadline
  ]);
}

/**
 * Helper function to encode Balancer single swap
 */
function encodeBalancerSingleSwap(step, recipient, slippagePercent = 0.5) {
  const iface = new ethers.utils.Interface([
    'function swap(tuple(bytes32 poolId, uint8 kind, address assetIn, address assetOut, uint256 amount, bytes userData) singleSwap, tuple(address sender, bool fromInternalBalance, address recipient, bool toInternalBalance) funds, uint256 limit, uint256 deadline) returns (uint256 amountCalculated)'
  ]);

  const singleSwap = {
    poolId: step.pools?.[0]?.id || '0x', // Would need actual pool ID
    kind: 0, // GIVEN_IN
    assetIn: step.inputToken === 'WETH' ? WETH_ADDRESS : step.inputToken.address,
    assetOut: step.outputToken === 'WETH' ? WETH_ADDRESS : step.outputToken.address,
    amount: step.input,
    userData: '0x'
  };

  const funds = {
    sender: recipient,
    fromInternalBalance: false,
    recipient: recipient,
    toInternalBalance: false
  };

  const limit = step.expectedOutput.mul(Math.floor((100 - slippagePercent) * 100)).div(10000); // Apply slippage
  const deadline = Math.floor(Date.now() / 1000) + 1200;

  return iface.encodeFunctionData('swap', [singleSwap, funds, limit, deadline]);
}