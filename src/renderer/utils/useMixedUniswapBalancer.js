import { ethers, BigNumber } from 'ethers';
import { useUniswapV4 } from '../../../tests/node/useUniswap.js';
// import { useUniswapV4 } from '../composables/useUniswap.js';
import { useBalancerV3, getCacheStats } from './useBalancerV3.js';
import {
  calculateUniswapExactOutput,
  calculateBalancerExactOutput
} from './exactAMMOutputs.js'

import { 
  createExecutionPlan
} from './executionPlan.js'

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