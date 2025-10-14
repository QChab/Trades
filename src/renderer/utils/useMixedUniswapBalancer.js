import { ethers, BigNumber } from 'ethers';
import { CurrencyAmount } from '@uniswap/sdk-core';
import { useUniswapV4 } from '../../../tests/node/useUniswap.js';
// import { useUniswapV4 } from '../composables/useUniswap.js';
import { getCacheStats, fetchAllBalancerPools, findOptimalPaths } from './useBalancerV3.js';
import {
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
  uniswapPools = null,  // Pre-fetched Uniswap pools (optional)
  slippageTolerance = 0.5,
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

    // ========================================
    // BULK POOL FETCHING (NEW OPTIMIZATION)
    // ========================================
    // Collect all tokens that might be used in routing
    const intermediates = [
      WETH_ADDRESS,
      ETH_ADDRESS,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
      '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
      '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'  // WBTC
    ];

    const allTokens = [
      tokenInObject.address,
      tokenOutObject.address,
      ...intermediates
    ];

    // Bulk fetch all pools once at the start
    let allBalancerPools = [];
    let allUniswapPools = [];

    const uniswap = useUniswapV4();

    if (useBalancer || useUniswap) {
      // Use pre-fetched Uniswap pools if provided, otherwise fetch them
      if (useUniswap && uniswapPools) {
        console.log(`📦 Using ${uniswapPools.length} pre-fetched Uniswap pools`);
        allUniswapPools = uniswapPools;
      } else if (useUniswap && !uniswapPools) {
        console.log('📦 Fetching Uniswap pools...');
        // Fallback: fetch specific pools for the direct tokenIn → tokenOut pair
        const specificPools = await uniswap.findPossiblePools(tokenInObject, tokenOutObject).catch(err => {
          console.log(`   No specific pools for ${tokenInObject.symbol}→${tokenOutObject.symbol}: ${err.message}`);
          return [];
        });
        allUniswapPools = specificPools;
      }

      // Fetch Balancer pools
      if (useBalancer) {
        console.log('📦 Fetching Balancer pools...');
        allBalancerPools = await fetchAllBalancerPools(allTokens, provider);
      }

      console.log(`✅ Using ${allBalancerPools.length} Balancer pools and ${allUniswapPools.length} Uniswap pools`);
    }

    // Discover paths based on enabled DEXs
    let uniswapRoutes = [];
    let balancerRoutes = [];

    if (useUniswap && useBalancer) {
      // Parallel discovery when both enabled
      [uniswapRoutes, balancerRoutes] = await Promise.all([
        discoverUniswapPaths(tokenInObject, tokenOutObject, amountInBN, allUniswapPools),
        discoverBalancerPaths(tokenInObject, tokenOutObject, amountInBN, provider, allBalancerPools)
      ]);
    } else if (useUniswap) {
      // Only Uniswap
      uniswapRoutes = await discoverUniswapPaths(tokenInObject, tokenOutObject, amountInBN, allUniswapPools);
    } else if (useBalancer) {
      // Only Balancer
      balancerRoutes = await discoverBalancerPaths(tokenInObject, tokenOutObject, amountInBN, provider, allBalancerPools);
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
        provider,
        allUniswapPools,
        allBalancerPools
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
 * Now uses pre-fetched pools instead of querying
 */
async function discoverUniswapPaths(tokenInObject, tokenOutObject, amountIn, prefetchedPools = []) {
  try {
    // Validate: prevent same-token swaps
    const normalizeAddress = (addr) => addr === ETH_ADDRESS ? WETH_ADDRESS : addr.toLowerCase();
    if (normalizeAddress(tokenInObject.address) === normalizeAddress(tokenOutObject.address)) {
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
      // Use pre-fetched pools (already includes bulk + specific pairs)
      const pools = prefetchedPools;

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

        // Multiple unique trades - add each as separate route for optimization
        if (uniqueTrades.length > 1) {
          // console.log(`   ✓ Found ${uniqueTrades.length} unique Uniswap routes`);

          const paths = uniqueTrades.filter(trade => trade && trade.swaps).map((trade, i) => {
            const path = trade.swaps[0].route.currencyPath.map(c => c.symbol).join(' → ');
            const inputAmount = BigNumber.from(trade.inputAmount.quotient.toString());
            const outputAmount = BigNumber.from(trade.outputAmount.quotient.toString());

            // console.log(`      Route ${i + 1}: ${ethers.utils.formatUnits(inputAmount, variant.tokenIn.decimals)} ${variant.tokenIn.symbol} -> ${ethers.utils.formatUnits(outputAmount, variant.tokenOut.decimals)} ${variant.tokenOut.symbol}`);

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

            // console.log(`   ✓ Found 1 Uniswap route`);
            // console.log(`      ${ethers.utils.formatUnits(inputAmount, variant.tokenIn.decimals)} ${variant.tokenIn.symbol} -> ${ethers.utils.formatUnits(outputAmount, variant.tokenOut.decimals)} ${variant.tokenOut.symbol}`);

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
    
    // console.log(`Found ${allPaths.length} Uniswap paths (including ETH/WETH variants)`);
    return allPaths;

  } catch (error) {
    console.error('Uniswap path discovery failed:', error);
    return [];
  }
}

/**
 * Discover Balancer V3 paths
 * Now uses pre-fetched pools instead of querying
 */
async function discoverBalancerPaths(tokenInObject, tokenOutObject, amountIn, provider, prefetchedPools = []) {
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
      // console.log(`   ⚠️  Skipping same-token swap: ${normalizedTokenIn.symbol} → ${normalizedTokenOut.symbol}`);
      return null;
    }

    // Filter pre-fetched pools for relevant tokens
    const tokenInAddr = normalizedTokenIn.address.toLowerCase();
    const tokenOutAddr = normalizedTokenOut.address.toLowerCase();

    // Include intermediates for multi-hop routing
    const intermediates = [
      WETH_ADDRESS,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
      '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
      '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'  // WBTC
    ].map(addr => addr.toLowerCase());

    const relevantTokens = [tokenInAddr, tokenOutAddr, ...intermediates];

    const filteredPools = prefetchedPools.filter(pool => {
      if (!pool.tokens || pool.tokens.length === 0) return false;
      const poolTokens = pool.tokens.map(t => t.address.toLowerCase());
      // Pool must contain at least one of our relevant tokens
      return poolTokens.some(addr => relevantTokens.includes(addr));
    });

    // Use findOptimalPaths directly with filtered pools
    const paths = await findOptimalPaths(
      normalizedTokenIn.address,
      normalizedTokenOut.address,
      amountIn.toString(),
      filteredPools,
      provider,
      1  // maxHops
    );

    if (paths.length === 0) {
      console.log('No Balancer paths found');
      return null;
    }

    // Limit to top 5 paths
    const topPaths = paths.slice(0, 5);
    const result = {
      allPaths: topPaths.map(path => ({
        amountOut: path.amountOut.toString(),
        minAmountOut: path.amountOut.mul(995).div(1000).toString(), // 0.5% slippage
        path: path,
        priceImpact: path.priceImpact || '0',
        fees: path.totalFees || '0',
        poolAddresses: path.hops.map(h => h.poolAddress),
        poolTypes: path.hops.map(h => h.poolType),
        weights: path.hops.map(h => h.weights),
        poolData: path.hops.length > 0 ? path.hops[0].poolData : null
      }))
    };

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
          return false; // Skip duplicate
        }

        seenPools.add(poolKey);
        return true;
      });

      pathsToReturn = uniquePaths;
    }

    // Return ALL unique paths as array
    if (pathsToReturn.length > 1) {
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
 * Now uses pre-fetched pools instead of querying
 */
async function discoverCrossDEXPaths(tokenIn, tokenOut, amountIn, provider, prefetchedUniswapPools = [], prefetchedBalancerPools = []) {
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
        discoverBalancerPaths(tokenIn, intermediate, amountIn, provider, prefetchedBalancerPools),
        discoverUniswapPaths(tokenIn, intermediateForUniswap, amountIn, prefetchedUniswapPools)
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
          // Balancer outputs WETH, needs conversion to ETH for next leg (Uniswap or direct output)
          intermediateForUniswap = { address: ETH_ADDRESS, symbol: 'ETH', decimals: 18 };
          needsWETHToETHConversion = true;
          console.log(`   🔄 Balancer leg1 outputs WETH, will convert to ETH for leg2`);
        }

        // Second leg: intermediate -> tokenOut using Balancer output
        const [balancerLeg2, uniswapLeg2] = await Promise.all([
          discoverBalancerPaths(intermediate, tokenOut, balancerLeg1[0].outputAmount, provider, prefetchedBalancerPools),
          discoverUniswapPaths(intermediateForUniswap, tokenOut, balancerLeg1[0].outputAmount, prefetchedUniswapPools)
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
            discoverBalancerPaths(intermediateForBalancer, tokenOut, estimatedMaxOutput, provider, prefetchedBalancerPools),
            discoverUniswapPaths(intermediate, tokenOut, estimatedMaxOutput, prefetchedUniswapPools)
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
            const secondLegForThisRoute = await discoverUniswapPaths(intermediate, tokenOut, firstLegOutput, prefetchedUniswapPools);

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
          const uniswapLeg2ToETH = await discoverUniswapPaths(intermediate, ethIntermediate, estimatedMaxOutput, prefetchedUniswapPools);

          if (uniswapLeg2ToETH && uniswapLeg2ToETH.length > 0) {
            const bestLeg2 = selectBestVariant(uniswapLeg2ToETH);

            // Third leg: ETH → tokenOut
            const uniswapLeg3 = await discoverUniswapPaths(ethIntermediate, tokenOut, bestLeg2.outputAmount, prefetchedUniswapPools);

            if (uniswapLeg3 && uniswapLeg3.length > 0) {
              // IMPORTANT: Calculate output for EACH first-leg pool's specific output chain
              for (let i = 0; i < uniswapLeg1.length; i++) {
                const firstLegRoute = uniswapLeg1[i];
                const firstLegOutput = firstLegRoute.outputAmount;

                // Query second leg with THIS specific first leg's output
                const leg2ForThisRoute = await discoverUniswapPaths(intermediate, ethIntermediate, firstLegOutput, prefetchedUniswapPools);

                if (!leg2ForThisRoute || leg2ForThisRoute.length === 0) {
                  console.log(`   ⚠️  No second leg found for 3-hop pool ${i + 1}`);
                  continue;
                }

                const bestLeg2ForThisRoute = selectBestVariant(leg2ForThisRoute);
                const secondLegOutput = bestLeg2ForThisRoute.outputAmount;

                // Query third leg with second leg's output
                const leg3ForThisRoute = await discoverUniswapPaths(ethIntermediate, tokenOut, secondLegOutput, prefetchedUniswapPools);

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
 * Optimize a single token-pair group independently
 * Uses hill-climbing to find optimal split across pools in this group
 *
 * @param {Object} group - Token pair group with pools array
 * @param {BigNumber} groupInputAmount - Amount of input token for this group
 * @param {Object} tokenIn - Input token info
 * @param {Object} tokenOut - Output token info (for this specific leg)
 * @param {Map} poolInitialAllocations - Initial allocations from route analysis (optional)
 * @returns {Object} { poolAllocations: Map(poolAddress -> percentage), totalOutput }
 */
async function optimizeTokenPairGroup(group, groupInputAmount, tokenIn, tokenOut, poolInitialAllocations = null) {
  const pools = group.pools;
  const numPools = pools.length;

  // Single pool case - 100% allocation
  if (numPools === 1) {
    // console.log(`   ${group.tokenPairKey}: 1 pool - allocating 100% (skipping optimization)`);

    const allocations = new Map();
    const poolInputs = new Map();
    const poolOutputs = new Map();

    allocations.set(pools[0].poolAddress, 1.0);
    poolInputs.set(pools[0].poolAddress, groupInputAmount);

    // Calculate output for this single pool
    const output = await calculatePoolExactOutput(pools[0], groupInputAmount, tokenIn, tokenOut);
    poolOutputs.set(pools[0].poolAddress, output);

    return {
      poolAllocations: allocations,
      poolInputs: poolInputs,
      poolOutputs: poolOutputs,
      totalOutput: output,
      iterations: 0
    };
  }

  // Multiple pools - optimize split
  // console.log(`   Optimizing ${group.tokenPairKey}: ${numPools} pools`);

  // Initialize split from route-based analysis if available
  let currentSplit;
  if (poolInitialAllocations) {
    currentSplit = pools.map(pool => {
      const poolKey = pool.poolKey || `${pool.poolAddress}@${pool.inputToken}-${pool.outputToken}`;
      const initialPct = poolInitialAllocations.get(poolKey) || (1.0 / numPools);
      return Math.max(0.001, initialPct); // Minimum 0.1%
    });

    // Normalize
    const sum = currentSplit.reduce((a, b) => a + b, 0);
    currentSplit = currentSplit.map(x => x / sum);
  } else {
    // Fallback: proportional to outputs with full amount
    const fullOutputs = await Promise.all(
      pools.map(pool => calculatePoolExactOutput(pool, groupInputAmount, tokenIn, tokenOut))
    );

    const totalInitialOutput = fullOutputs.reduce((sum, out) => sum.add(out), BigNumber.from(0));
    currentSplit = fullOutputs.map(out => {
      const proportion = out.mul(100000).div(totalInitialOutput).toNumber() / 100000;
      return Math.max(0.001, proportion);
    });

    // Normalize
    const sum = currentSplit.reduce((a, b) => a + b, 0);
    currentSplit = currentSplit.map(x => x / sum);
  }

  // Evaluate initial split
  let bestSplit = [...currentSplit];
  let bestOutput = await evaluateGroupSplit(currentSplit, pools, groupInputAmount, tokenIn, tokenOut);

  // Hill climbing optimization
  const maxIterations = 30;
  const initialStepSize = 0.02;
  const minStepSize = 0.0001;
  const stepReduction = 0.8;
  let stepSize = initialStepSize;
  let iteration = 0;
  let noImprovementCount = 0;

  while (stepSize >= minStepSize && iteration < maxIterations) {
    let improved = false;
    iteration++;

    // Try moving percentage between each pair of pools
    outerLoop:
    for (let i = 0; i < numPools - 1; i++) {
      for (let j = i + 1; j < numPools; j++) {
        // Try moving from i to j
        if (currentSplit[i] >= stepSize) {
          const testSplit = [...currentSplit];
          testSplit[i] -= stepSize;
          testSplit[j] += stepSize;

          // Normalize
          const testSum = testSplit.reduce((a, b) => a + b, 0);
          const normalizedSplit = testSplit.map(x => x / testSum);

          const testOutput = await evaluateGroupSplit(normalizedSplit, pools, groupInputAmount, tokenIn, tokenOut);

          if (testOutput.gt(bestOutput)) {
            bestOutput = testOutput;
            bestSplit = normalizedSplit;
            currentSplit = normalizedSplit;
            improved = true;
            break outerLoop;
          }
        }

        // Try moving from j to i
        if (currentSplit[j] >= stepSize) {
          const testSplit = [...currentSplit];
          testSplit[j] -= stepSize;
          testSplit[i] += stepSize;

          // Normalize
          const testSum = testSplit.reduce((a, b) => a + b, 0);
          const normalizedSplit = testSplit.map(x => x / testSum);

          const testOutput = await evaluateGroupSplit(normalizedSplit, pools, groupInputAmount, tokenIn, tokenOut);

          if (testOutput.gt(bestOutput)) {
            bestOutput = testOutput;
            bestSplit = normalizedSplit;
            currentSplit = normalizedSplit;
            improved = true;
            break outerLoop;
          }
        }
      }
    }

    if (!improved) {
      stepSize = stepSize * stepReduction;
      noImprovementCount++;

      // Early convergence: stop if no improvement for 3 consecutive iterations
      if (noImprovementCount >= 6) {
        break;
      }
    } else {
      noImprovementCount = 0;
    }
  }

  // FILTER: Remove pools with allocation < 0.02% and re-optimize
  const ALLOCATION_THRESHOLD = 0.0002; // 0.02%
  let filteredIndices = [];
  let filteredPools = [];
  let sumFilteredAllocation = 0; // Track total allocation that was filtered out

  for (let idx = 0; idx < pools.length; idx++) {
    const allocationPct = bestSplit[idx] * 100;
    // console.log(`         Pool ${idx}: ${allocationPct.toFixed(4)}% (${bestSplit[idx] >= ALLOCATION_THRESHOLD ? 'KEEP' : 'FILTER'})`);

    if (bestSplit[idx] >= ALLOCATION_THRESHOLD) {
      filteredIndices.push(idx);
      filteredPools.push(pools[idx]);
    } else {
      // console.log(`      ⚠️  Filtering out pool ${pools[idx].poolAddress?.slice(0, 10)}... with ${allocationPct.toFixed(4)}% allocation (< 0.02% threshold)`);
      sumFilteredAllocation += bestSplit[idx]; // Accumulate filtered allocation
    }
  }

  // If we filtered out any pools, handle redistribution
  if (filteredPools.length < pools.length && filteredPools.length > 0) {
    // console.log(`      🔄 Filtered ${pools.length - filteredPools.length} pool(s) with total ${(sumFilteredAllocation * 100).toFixed(4)}% allocation`);

    // If only ONE pool remains, give it 100% and stop optimization
    if (filteredPools.length === 1) {
      // console.log(`      ✓ Only 1 pool remaining - allocating 100%`);

      const allocations = new Map();
      const poolInputs = new Map();
      const poolOutputs = new Map();

      allocations.set(filteredPools[0].poolAddress, 1.0);
      poolInputs.set(filteredPools[0].poolAddress, groupInputAmount);

      // Calculate output for this single pool
      const output = await calculatePoolExactOutput(filteredPools[0], groupInputAmount, tokenIn, tokenOut);
      poolOutputs.set(filteredPools[0].poolAddress, output);

      return {
        poolAllocations: allocations,
        poolInputs: poolInputs,
        poolOutputs: poolOutputs,
        totalOutput: output,
        iterations: iteration
      };
    }

    // Multiple pools remain - re-optimize with filtered pools
    // console.log(`      🔄 Re-optimizing with ${filteredPools.length} remaining pools...`);

    // Create a new group object with filtered pools for recursive call
    const filteredGroup = {
      ...group,
      pools: filteredPools
    };

    // Recursive call with filtered group
    return await optimizeTokenPairGroup(filteredGroup, groupInputAmount, tokenIn, tokenOut, poolInitialAllocations);
  }

  // Convert to Map and calculate exact amounts for each pool
  const allocations = new Map();
  const poolInputs = new Map();
  const poolOutputs = new Map();

  for (let idx = 0; idx < pools.length; idx++) {
    const pool = pools[idx];
    const percentage = bestSplit[idx];
    const poolInput = groupInputAmount.mul(Math.floor(percentage * 1000000)).div(1000000);
    const poolOutput = await calculatePoolExactOutput(pool, poolInput, tokenIn, tokenOut);

    allocations.set(pool.poolAddress, percentage);
    poolInputs.set(pool.poolAddress, poolInput);
    poolOutputs.set(pool.poolAddress, poolOutput);
  }

  // console.log(`      ✓ Optimized in ${iteration} iterations: ${bestSplit.map(x => (x * 100).toFixed(3) + '%').join(' / ')}`);

  return {
    poolAllocations: allocations,
    poolInputs: poolInputs,           // NEW: Exact input amount per pool
    poolOutputs: poolOutputs,         // NEW: Exact output amount per pool
    totalOutput: bestOutput,
    iterations: iteration
  };
}

/**
 * Evaluate a split configuration for a token-pair group
 * IMPORTANT: Must use exact AMM calculations for each pool
 */
async function evaluateGroupSplit(split, pools, totalAmount, tokenIn, tokenOut) {
  let totalOutput = BigNumber.from(0);

  for (let i = 0; i < pools.length; i++) {
    const percentage = split[i];
    if (percentage <= 0) continue;

    const poolAmount = totalAmount.mul(Math.floor(percentage * 1000000)).div(1000000);
    const poolOutput = await calculatePoolExactOutput(pools[i], poolAmount, tokenIn, tokenOut);

    totalOutput = totalOutput.add(poolOutput);
  }

  return totalOutput;
}

/**
 * Calculate exact output for a single pool using exact AMM math
 * Routes to appropriate protocol-specific calculation
 */
async function calculatePoolExactOutput(pool, amount, tokenIn, tokenOut) {
  if (pool.protocol === 'uniswap' && pool.trade) {
    // Use Uniswap SDK
    const tradeRoute = pool.trade.route || pool.trade.swaps?.[0]?.route;
    if (tradeRoute && tradeRoute.pools && tradeRoute.pools.length > 0) {
      const poolObj = tradeRoute.pools[0];
      const inputAmount = CurrencyAmount.fromRawAmount(
        tradeRoute.currencyPath[0],
        amount.toString()
      );
      const result = await poolObj.getOutputAmount(inputAmount);
      const outputAmount = result[0];
      const output = BigNumber.from(outputAmount.quotient.toString());

      return output;
    }
  } else if (pool.protocol === 'balancer' && pool.path) {
    // Use Balancer exact calculation
    // Path structure from useBalancerV3: { hops: [...], outputAmount, poolAddresses }
    // For single-hop (most pools), just use the first hop's pool data
    const firstHop = pool.path.hops?.[0];
    if (firstHop && firstHop.poolData) {
      const poolData = firstHop.poolData;

      // Find token indices
      const tokenInAddr = firstHop.tokenIn.toLowerCase();
      const tokenOutAddr = firstHop.tokenOut.toLowerCase();

      const tokenInIndex = poolData.tokens.findIndex(t => t.address.toLowerCase() === tokenInAddr);
      const tokenOutIndex = poolData.tokens.findIndex(t => t.address.toLowerCase() === tokenOutAddr);

      if (tokenInIndex >= 0 && tokenOutIndex >= 0) {
        const output = calculateBalancerExactOutput(amount, poolData, tokenInIndex, tokenOutIndex);

        return output;
      }
    }

    // Fallback: use the path's output amount (less accurate for different input amounts)
    return pool.path.outputAmount || BigNumber.from(0);
  }

  return BigNumber.from(0);
}

/**
 * Optimize mixed routes by finding best split percentages
 * Now handles unified ETH/WETH liquidity across protocols
 */
async function optimizeMixedRoutes(uniswapPaths, balancerPaths, crossDEXPaths, amountIn, tokenIn, tokenOut) {
  let routes = [];

  // Add ALL Uniswap paths as individual routes
  if (uniswapPaths && uniswapPaths.length > 0) {
    uniswapPaths.forEach((uniPath, index) => {
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
      console.log(`   Added ${uniswapPaths.length} Uniswap routes`);
    })
  }

  // Add ALL Balancer paths as individual routes
  if (balancerPaths && balancerPaths.length > 0) {
    balancerPaths.forEach((balPath, index) => {
      routes.push({
        type: `balancer-path-${index + 1}`,
        protocol: 'balancer',
        totalOutput: balPath.outputAmount,
        paths: [balPath],
        legs: [{
          ...balPath,  // Spread all properties (includes path, outputAmount, etc.)
          protocol: 'balancer'  // Ensure protocol is set
        }],
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

  // Filter out routes with terrible outputs (< 1/1000000 of best)
  if (routes.length > 0) {
    const bestOutput = routes.reduce((max, route) =>
      route.totalOutput.gt(max) ? route.totalOutput : max
    , BigNumber.from(0));

    const threshold = bestOutput.div(1000000); // 1 millionth of best
    const beforeFilter = routes.length;

    routes = routes.filter(route => {
      if (route.totalOutput.lt(threshold)) {
        console.log(`   ❌ Filtered out route with output ${ethers.utils.formatUnits(route.totalOutput, tokenOut.decimals)} ${tokenOut.symbol} (< 1/1000000 of best)`);
        return false;
      }
      return true;
    });

    if (routes.length < beforeFilter) {
      console.log(`   ✓ Filtered ${beforeFilter - routes.length} routes with terrible outputs`);
      console.log(`   ✓ Remaining routes: ${routes.length}`);
    }
  }

  // Display routes in readable format
  displayRoutes(routes, tokenOut);

  // If we have multiple routes, optimize split percentages
  if (routes.length >= 2) {
    // Filter to top 10 routes if we have too many (avoid combinatorial explosion)
    let routesToOptimize = routes;
    if (routes.length > 20) {
      console.log(`\n🎯 ${routes.length} routes discovered - selecting top 10 by output for optimization...`);
      routesToOptimize = [...routes].sort((a, b) => {
        return b.totalOutput.sub(a.totalOutput).gt(0) ? 1 : -1;
      }).slice(0, 20);
      console.log(`   ✓ Optimizing splits across top 20 routes (outputs: ${routesToOptimize.map(r =>
        parseFloat(ethers.utils.formatUnits(r.totalOutput, tokenOut.decimals)).toFixed(1)
      ).join(', ')} ${tokenOut.symbol})`);
    } else {
      console.log(`\n🎯 Optimizing split across ${routes.length} routes...`);
    }

    const optimizedSplit = await optimizeSplitSimple(routesToOptimize, amountIn, tokenIn, tokenOut);
    if (optimizedSplit) {
      routes.push(optimizedSplit);
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
 * Detect routes that converge to the same pool at ANY level (not just final)
 * Returns groups of routes that share pools, organized by pool and leg position
 */
function detectPoolConvergence(routes) {
  // Map of poolKey -> leg position -> routes
  const poolsByLegPosition = new Map();

  routes.forEach((route, index) => {
    if (!route.legs || route.legs.length === 0) return;

    // Check each leg for convergence
    route.legs.forEach((leg, legIndex) => {
      let poolKey = null;

      if (leg.trade) {
        const tradeRoute = leg.trade.route || leg.trade.swaps?.[0]?.route;
        if (tradeRoute && tradeRoute.pools && tradeRoute.pools.length > 0) {
          const pool = tradeRoute.pools[tradeRoute.pools.length - 1];
          const path = tradeRoute.currencyPath || tradeRoute.path;
          if (path && path.length >= 2) {
            // Create key from token pair AND pool address to distinguish different pools
            const tokenPair = `${path[path.length - 2].symbol}-${path[path.length - 1].symbol}`;
            const normalizedPair = tokenPair.replace(/WETH/g, 'ETH');
            const poolAddress = pool.address || pool.id || pool.poolId || 'unknown';
            // Include pool address to distinguish different pools for same token pair
            poolKey = `${normalizedPair}@${poolAddress.slice(0, 10)}`;
          }
        }
      }

      if (poolKey) {
        const legKey = `leg${legIndex}`;

        if (!poolsByLegPosition.has(poolKey)) {
          poolsByLegPosition.set(poolKey, new Map());
        }

        const legMap = poolsByLegPosition.get(poolKey);
        if (!legMap.has(legKey)) {
          legMap.set(legKey, []);
        }

        legMap.get(legKey).push({ route, index, legIndex });
      }
    });
  });

  // Find convergence groups (pools with multiple routes at the same leg position)
  const converging = [];

  poolsByLegPosition.forEach((legMap, poolKey) => {
    legMap.forEach((routesAtLeg, legKey) => {
      if (routesAtLeg.length > 1) {
        converging.push({
          poolKey,
          legPosition: legKey,
          routes: routesAtLeg,
          count: routesAtLeg.length
        });
      }
    });
  });

  return converging;
}

/**
 * Build token-pair groups for optimization
 * Groups all pools by their (inputToken, outputToken) pair
 * Each pool gets optimized within its token-pair group independently
 *
 * @param {Array} routes - All discovered routes
 * @returns {Array} Array of token-pair groups, each with { tokenPair, pools: [...] }
 */
function buildTokenPairGroups(routes) {
  const tokenPairMap = new Map(); // "TOKEN_A->TOKEN_B" -> array of pool info

  routes.forEach((route, routeIndex) => {
    // Handle routes with legs array (multi-leg routes)
    if (route.legs && route.legs.length > 0) {
      route.legs.forEach((leg, legIndex) => {
        let poolInfo = null;

        // Extract pool information from Uniswap leg
        if (leg.protocol === 'uniswap' && leg.trade) {
        const tradeRoute = leg.trade.route || leg.trade.swaps?.[0]?.route;
        if (tradeRoute && tradeRoute.pools && tradeRoute.pools.length > 0) {
          const pool = tradeRoute.pools[0];
          const path = tradeRoute.currencyPath || tradeRoute.path;
          if (path && path.length >= 2) {
            let inputToken = path[path.length - 2].symbol.replace(/WETH/g, 'ETH');
            let outputToken = path[path.length - 1].symbol.replace(/WETH/g, 'ETH');
            const poolAddress = pool.address || pool.id || pool.poolId || 'unknown';

            // If leg has a token property, use that as the output (more reliable for cross-DEX routes)
            if (leg.token && leg.token.symbol) {
              outputToken = leg.token.symbol.replace(/WETH/g, 'ETH');
            }

            poolInfo = {
              poolAddress,
              poolKey: `${poolAddress}@${inputToken}-${outputToken}`,
              protocol: 'uniswap',
              inputToken,
              outputToken,
              trade: leg.trade,
              routeIndex,
              legIndex
            };
          }
        }
      }
      // Extract pool information from Balancer leg
      else if (leg.protocol === 'balancer' && leg.path) {
        const hops = leg.path.hops || [];
        if (hops.length > 0) {
          const firstHop = hops[0];
          const lastHop = hops[hops.length - 1];

          let inputToken = 'UNKNOWN';
          let outputToken = 'UNKNOWN';

          if (firstHop.poolData && firstHop.poolData.tokens) {
            const tokenInObj = firstHop.poolData.tokens.find(
              t => t.address.toLowerCase() === firstHop.tokenIn.toLowerCase()
            );
            inputToken = tokenInObj?.symbol?.replace(/WETH/g, 'ETH') || 'UNKNOWN';
          }

          if (lastHop.poolData && lastHop.poolData.tokens) {
            const tokenOutObj = lastHop.poolData.tokens.find(
              t => t.address.toLowerCase() === lastHop.tokenOut.toLowerCase()
            );
            outputToken = tokenOutObj?.symbol?.replace(/WETH/g, 'ETH') || 'UNKNOWN';
          }

          // If leg has a token property, use that as the output (more reliable for cross-DEX routes)
          if (leg.token && leg.token.symbol) {
            outputToken = leg.token.symbol.replace(/WETH/g, 'ETH');
          }

          const poolAddress = firstHop.poolAddress;
          poolInfo = {
            poolAddress,
            poolKey: `${poolAddress}@${inputToken}-${outputToken}`,
            poolId: firstHop.poolId,
            protocol: 'balancer',
            inputToken,
            outputToken,
            path: leg.path,
            routeIndex,
            legIndex
          };
        }
      }

      if (poolInfo) {
        const tokenPairKey = `${poolInfo.inputToken}->${poolInfo.outputToken}`;

        if (!tokenPairMap.has(tokenPairKey)) {
          tokenPairMap.set(tokenPairKey, []);
        }

        // Check if this exact pool (by address) is already in the group
        const existingPool = tokenPairMap.get(tokenPairKey).find(
          p => p.poolAddress === poolInfo.poolAddress
        );

        if (!existingPool) {
          // New unique pool for this token pair
          tokenPairMap.get(tokenPairKey).push({
            ...poolInfo,
            routeIndices: [routeIndex],
            legIndices: [legIndex]
          });
        } else {
          // Same pool used by multiple routes - track all routes using it
          if (!existingPool.routeIndices.includes(routeIndex)) {
            existingPool.routeIndices.push(routeIndex);
            existingPool.legIndices.push(legIndex);
          }
        }
      }
      });
    }
    // Handle simple single-path routes without legs (uniswap-path-1, balancer-path-1)
    else if (route.paths && route.paths.length > 0) {
      const path = route.paths[0];
      let poolInfo = null;

      // Extract pool info from Uniswap path
      if (route.protocol === 'uniswap' && path.trade) {
        const tradeRoute = path.trade.route || path.trade.swaps?.[0]?.route;
        if (tradeRoute && tradeRoute.pools && tradeRoute.pools.length > 0) {
          const pool = tradeRoute.pools[0];
          const routePath = tradeRoute.currencyPath || tradeRoute.path;
          if (routePath && routePath.length >= 2) {
            const inputToken = routePath[0].symbol.replace(/WETH/g, 'ETH');
            const outputToken = routePath[routePath.length - 1].symbol.replace(/WETH/g, 'ETH');
            const poolAddress = pool.address || pool.id || pool.poolId || 'unknown';

            poolInfo = {
              poolAddress,
              poolKey: `${poolAddress}@${inputToken}-${outputToken}`,
              protocol: 'uniswap',
              inputToken,
              outputToken,
              trade: path.trade,
              routeIndex,
              legIndex: 0
            };
          }
        }
      }
      // Extract pool info from Balancer path
      else if (route.protocol === 'balancer' && path.path) {
        const hops = path.path.hops || [];
        if (hops.length > 0) {
          const firstHop = hops[0];
          const lastHop = hops[hops.length - 1];

          let inputToken = 'UNKNOWN';
          let outputToken = 'UNKNOWN';

          if (firstHop.poolData && firstHop.poolData.tokens) {
            const tokenInObj = firstHop.poolData.tokens.find(
              t => t.address.toLowerCase() === firstHop.tokenIn.toLowerCase()
            );
            inputToken = tokenInObj?.symbol?.replace(/WETH/g, 'ETH') || 'UNKNOWN';
          }

          if (lastHop.poolData && lastHop.poolData.tokens) {
            const tokenOutObj = lastHop.poolData.tokens.find(
              t => t.address.toLowerCase() === lastHop.tokenOut.toLowerCase()
            );
            outputToken = tokenOutObj?.symbol?.replace(/WETH/g, 'ETH') || 'UNKNOWN';
          }

          const poolAddress = firstHop.poolAddress;
          poolInfo = {
            poolAddress,
            poolKey: `${poolAddress}@${inputToken}-${outputToken}`,
            poolId: firstHop.poolId,
            protocol: 'balancer',
            inputToken,
            outputToken,
            path: path.path,
            routeIndex,
            legIndex: 0
          };
        }
      }

      // Add pool to tokenPairMap
      if (poolInfo) {
        const tokenPairKey = `${poolInfo.inputToken}->${poolInfo.outputToken}`;

        if (!tokenPairMap.has(tokenPairKey)) {
          tokenPairMap.set(tokenPairKey, []);
        }

        // Check if this exact pool (by address) is already in the group
        const existingPool = tokenPairMap.get(tokenPairKey).find(
          p => p.poolAddress === poolInfo.poolAddress
        );

        if (!existingPool) {
          // New unique pool for this token pair
          tokenPairMap.get(tokenPairKey).push({
            ...poolInfo,
            routeIndices: [routeIndex],
            legIndices: [0]
          });
        } else {
          // Same pool used by multiple routes - track all routes using it
          if (!existingPool.routeIndices.includes(routeIndex)) {
            existingPool.routeIndices.push(routeIndex);
            existingPool.legIndices.push(0);
          }
        }
      }
    }
  });

  // Convert to array of groups
  const groups = [];
  tokenPairMap.forEach((pools, tokenPairKey) => {
    const [inputToken, outputToken] = tokenPairKey.split('->');
    groups.push({
      tokenPairKey,
      inputToken,
      outputToken,
      pools,
      poolCount: pools.length
    });
  });

  return groups;
}

/**
 * Build pool groups for optimization
 * Routes that converge on the same pool are grouped together
 * Independent routes get their own group
 *
 * @param {Array} routes - All discovered routes
 * @param {Array} convergingPools - Pool convergence information from detectPoolConvergence
 * @returns {Array} Array of pool groups, each with { groupKey, routes: [routeIndices] }
 */
function buildPoolGroups(routes, convergingPools) {
  const poolGroups = [];
  const routeAssignment = new Map(); // route index -> group assignment

  // Step 1: Assign converging routes to their earliest convergence pool
  convergingPools.forEach(convergence => {
    convergence.routes.forEach(({ index, legIndex }) => {
      const existing = routeAssignment.get(index);

      // Use earliest convergence point (lowest leg index)
      if (!existing || legIndex < existing.legIndex) {
        routeAssignment.set(index, {
          groupKey: `${convergence.poolKey}@${convergence.legPosition}`,
          poolKey: convergence.poolKey,
          legPosition: convergence.legPosition,
          legIndex: legIndex,
          isConvergent: true
        });
      }
    });
  });

  // Step 2: Build groups from convergence assignments
  const groupsByKey = new Map();

  routeAssignment.forEach((assignment, routeIndex) => {
    const key = assignment.groupKey;
    if (!groupsByKey.has(key)) {
      groupsByKey.set(key, {
        groupKey: key,
        poolKey: assignment.poolKey,
        legPosition: assignment.legPosition,
        legIndex: assignment.legIndex,
        isConvergent: true,
        routes: []
      });
    }
    groupsByKey.get(key).routes.push(routeIndex);
  });

  // Step 3: Add independent routes (not in any convergence group)
  for (let i = 0; i < routes.length; i++) {
    if (!routeAssignment.has(i)) {
      poolGroups.push({
        groupKey: `independent-${i}`,
        poolKey: null,
        legPosition: null,
        legIndex: null,
        isConvergent: false,
        routes: [i]
      });
    }
  }

  // Step 4: Add convergent groups
  groupsByKey.forEach(group => {
    poolGroups.push(group);
  });

  return poolGroups;
}

/**
 * Build pool-based execution structure from routes
 * Flattens routes into pools with execution levels based on token dependencies
 */
function buildPoolExecutionStructure(routes, splitPercentages) {
  const poolMap = new Map(); // poolKey -> pool info
  const tokenProducers = new Map(); // outputToken -> [poolKeys that produce it]

  routes.forEach((route, routeIndex) => {
    if (!route.legs || route.legs.length === 0) return;

    const routePercentage = splitPercentages[routeIndex];

    route.legs.forEach((leg, legIndex) => {
      let poolKey = null;
      let poolInfo = {};

      // Extract pool information
      if (leg.protocol === 'uniswap' && leg.trade) {
        const tradeRoute = leg.trade.route || leg.trade.swaps?.[0]?.route;
        if (tradeRoute && tradeRoute.pools && tradeRoute.pools.length > 0) {
          const pool = tradeRoute.pools[0];
          const path = tradeRoute.currencyPath || tradeRoute.path;
          if (path && path.length >= 2) {
            const inputToken = path[path.length - 2].symbol.replace(/WETH/g, 'ETH');
            const outputToken = path[path.length - 1].symbol.replace(/WETH/g, 'ETH');
            const poolAddress = pool.address || pool.id;

            poolKey = `${poolAddress}@${inputToken}-${outputToken}`;
            poolInfo = {
              poolAddress,
              protocol: 'uniswap',
              inputToken,
              outputToken,
              trade: leg.trade,
              legIndex
            };
          }
        }
      } else if (leg.protocol === 'balancer' && leg.path) {
        const hops = leg.path.hops || [];
        if (hops.length > 0) {
          const firstHop = hops[0];
          const lastHop = hops[hops.length - 1];

          let inputToken = 'UNKNOWN';
          let outputToken = 'UNKNOWN';

          if (firstHop.poolData && firstHop.poolData.tokens) {
            const tokenInObj = firstHop.poolData.tokens.find(
              t => t.address.toLowerCase() === firstHop.tokenIn.toLowerCase()
            );
            inputToken = tokenInObj?.symbol?.replace(/WETH/g, 'ETH') || 'UNKNOWN';
          }

          if (lastHop.poolData && lastHop.poolData.tokens) {
            const tokenOutObj = lastHop.poolData.tokens.find(
              t => t.address.toLowerCase() === lastHop.tokenOut.toLowerCase()
            );
            outputToken = tokenOutObj?.symbol?.replace(/WETH/g, 'ETH') || 'UNKNOWN';
          }

          const poolAddress = firstHop.poolAddress;
          poolKey = `${poolAddress}@${inputToken}-${outputToken}`;
          poolInfo = {
            poolAddress,
            poolId: firstHop.poolId,
            protocol: 'balancer',
            inputToken,
            outputToken,
            path: leg.path,
            legIndex
          };
        }
      }

      if (poolKey) {
        // Add or update pool with accumulated percentage
        if (!poolMap.has(poolKey)) {
          poolMap.set(poolKey, {
            ...poolInfo,
            percentage: routePercentage,
            routeIndices: [routeIndex]
          });
        } else {
          const existing = poolMap.get(poolKey);
          existing.percentage += routePercentage;
          existing.routeIndices.push(routeIndex);
        }

        // Track what this pool produces
        if (!tokenProducers.has(poolInfo.outputToken)) {
          tokenProducers.set(poolInfo.outputToken, []);
        }
        if (!tokenProducers.get(poolInfo.outputToken).includes(poolKey)) {
          tokenProducers.get(poolInfo.outputToken).push(poolKey);
        }
      }
    });
  });

  // Determine execution levels based on token dependencies
  const poolLevels = new Map(); // poolKey -> level
  const poolArray = Array.from(poolMap.entries());

  // Assign levels using topological sort
  let currentLevel = 0;
  let remainingPools = new Set(poolArray.map(([key]) => key));

  while (remainingPools.size > 0) {
    const poolsAtThisLevel = [];

    for (const poolKey of remainingPools) {
      const pool = poolMap.get(poolKey);

      // Check if this pool's input token is produced by any remaining pool
      const inputProducers = tokenProducers.get(pool.inputToken) || [];
      const hasUnresolvedDependency = inputProducers.some(producerKey =>
        remainingPools.has(producerKey) && producerKey !== poolKey
      );

      if (!hasUnresolvedDependency) {
        poolsAtThisLevel.push(poolKey);
        poolLevels.set(poolKey, currentLevel);
      }
    }

    if (poolsAtThisLevel.length === 0) {
      // Circular dependency or isolated pools - assign remaining to current level
      remainingPools.forEach(poolKey => poolLevels.set(poolKey, currentLevel));
      break;
    }

    poolsAtThisLevel.forEach(poolKey => remainingPools.delete(poolKey));
    currentLevel++;
  }

  // Build level-based structure
  const levels = [];
  const maxLevel = Math.max(...Array.from(poolLevels.values()));

  for (let level = 0; level <= maxLevel; level++) {
    const poolsAtLevel = [];

    poolMap.forEach((poolInfo, poolKey) => {
      if (poolLevels.get(poolKey) === level) {
        poolsAtLevel.push({
          poolKey,
          ...poolInfo,
          level
        });
      }
    });

    if (poolsAtLevel.length > 0) {
      levels.push({
        level,
        pools: poolsAtLevel
      });
    }
  }

  return { levels, poolMap, tokenProducers };
}

/**
 * Initialize group and pool allocations based on discovered route outputs
 * This provides a much better starting point than arbitrary 50/50 splits
 *
 * Strategy:
 * - Groups that appear in high-output routes get more initial allocation
 * - Pools that appear in high-output routes get more allocation within their group
 */
function initializeFromRoutes(routes, groupsWithLevels, totalAmount) {
  // console.log(`   📊 Initializing from route outputs...`);

  // Step 1: Map each route's legs to pools
  const routePoolMapping = new Map(); // routeIndex -> array of {poolKey, groupKey, inputToken, outputToken}

  console.log(`      Mapping ${routes.length} routes to pools...`);
  for (let routeIdx = 0; routeIdx < routes.length; routeIdx++) {
    const route = routes[routeIdx];
    const poolsUsed = [];
    const routeDesc = route.description || route.path || `Route ${routeIdx + 1}`;

    if (route.legs && route.legs.length > 0) {
      // console.log(`         Route ${routeIdx + 1} (${routeDesc}): ${route.legs.length} legs`);
      for (const leg of route.legs) {
        // Extract pool identification info
        let poolAddress = null;
        let inputToken = null;
        let outputToken = null;

        if (leg.protocol === 'uniswap' && leg.trade) {
          const tradeRoute = leg.trade.route || leg.trade.swaps?.[0]?.route;
          if (tradeRoute && tradeRoute.pools && tradeRoute.pools.length > 0) {
            const pool = tradeRoute.pools[0];
            const path = tradeRoute.currencyPath || tradeRoute.path;
            if (path && path.length >= 2) {
              poolAddress = pool.address || pool.id || pool.poolId || 'unknown';
              inputToken = path[path.length - 2].symbol.replace(/WETH/g, 'ETH');
              outputToken = path[path.length - 1].symbol.replace(/WETH/g, 'ETH');

              // If leg has a token property, use that as the output (more reliable for cross-DEX routes)
              if (leg.token && leg.token.symbol) {
                outputToken = leg.token.symbol.replace(/WETH/g, 'ETH');
              }
            }
          }
        } else if (leg.protocol === 'balancer' && leg.path) {
          const firstHop = leg.path.hops?.[0];
          if (firstHop) {
            poolAddress = firstHop.poolAddress;

            if (firstHop.poolData && firstHop.poolData.tokens) {
              const tokenInObj = firstHop.poolData.tokens.find(
                t => t.address.toLowerCase() === firstHop.tokenIn.toLowerCase()
              );
              const tokenOutObj = firstHop.poolData.tokens.find(
                t => t.address.toLowerCase() === firstHop.tokenOut.toLowerCase()
              );
              inputToken = tokenInObj?.symbol?.replace(/WETH/g, 'ETH') || 'UNKNOWN';
              outputToken = tokenOutObj?.symbol?.replace(/WETH/g, 'ETH') || 'UNKNOWN';
            }

            // If leg has a token property, use that as the output (more reliable for cross-DEX routes)
            if (leg.token && leg.token.symbol) {
              outputToken = leg.token.symbol.replace(/WETH/g, 'ETH');
            }
          }
        }

        if (poolAddress && inputToken && outputToken) {
          const poolKey = `${poolAddress}@${inputToken}-${outputToken}`;
          const groupKey = `${inputToken}->${outputToken}`;

          // console.log(`            └─ Extracted: ${groupKey} (${leg.protocol})`);

          poolsUsed.push({
            poolKey,
            groupKey,
            inputToken,
            outputToken,
            poolAddress
          });
        } else {
          // console.log(`            └─ Skipped leg (${leg.protocol}): poolAddr=${!!poolAddress}, in=${inputToken}, out=${outputToken}`);
        }
      }
    }

    // console.log(`         Route ${routeIdx + 1} mapped to ${poolsUsed.length} pools`);
    routePoolMapping.set(routeIdx, poolsUsed);
  }

  // Step 2: Calculate importance of each group based on route outputs
  const groupImportance = new Map(); // groupKey -> total output from routes using this group
  const poolImportance = new Map(); // poolKey -> total output from routes using this pool

  for (let routeIdx = 0; routeIdx < routes.length; routeIdx++) {
    const route = routes[routeIdx];
    const routeOutput = route.totalOutput || BigNumber.from(0);
    const poolsUsed = routePoolMapping.get(routeIdx) || [];

    // Track which groups this route uses (first occurrence only per group)
    const seenGroups = new Set();

    for (const poolInfo of poolsUsed) {
      // Add to pool importance
      const currentPoolImp = poolImportance.get(poolInfo.poolKey) || BigNumber.from(0);
      poolImportance.set(poolInfo.poolKey, currentPoolImp.add(routeOutput));

      // Add to group importance (once per route)
      if (!seenGroups.has(poolInfo.groupKey)) {
        const currentGroupImp = groupImportance.get(poolInfo.groupKey) || BigNumber.from(0);
        groupImportance.set(poolInfo.groupKey, currentGroupImp.add(routeOutput));
        seenGroups.add(poolInfo.groupKey);
      }
    }
  }

  // Step 3: Calculate initial allocations for competing groups
  const competingGroupSets = groupByInputTokenAndLevel(groupsWithLevels);
  const groupInitialAllocations = new Map(); // tokenPairKey -> percentage

  // DEBUG: Log all group importances
  console.log(`      Group importances calculated:`);
  for (const [key, value] of groupImportance.entries()) {
    console.log(`         ${key}: ${ethers.utils.formatUnits(value, 18)} (raw)`);
  }

  for (const [key, competingGroups] of competingGroupSets) {
    if (competingGroups.length === 1) {
      // Sequential group - gets 100%
      groupInitialAllocations.set(competingGroups[0].tokenPairKey, 1.0);
    } else {
      // Competing groups - distribute based on importance
      let totalImportance = BigNumber.from(0);
      const importanceByGroup = new Map();

      console.log(`      Looking up competing groups for ${key}:`);
      for (const group of competingGroups) {
        const importance = groupImportance.get(group.tokenPairKey);

        if (!importance) {
          console.warn(`         ⚠️  No importance found for ${group.tokenPairKey}! Using minimum.`);
          console.warn(`         Available keys: ${Array.from(groupImportance.keys()).join(', ')}`);
        }

        const finalImportance = importance || BigNumber.from(1);
        importanceByGroup.set(group.tokenPairKey, finalImportance);
        totalImportance = totalImportance.add(finalImportance);
      }

      // Normalize to percentages
      const rawPercentages = [];
      for (const group of competingGroups) {
        const importance = importanceByGroup.get(group.tokenPairKey);
        const percentage = importance.mul(100000).div(totalImportance).toNumber() / 100000;
        rawPercentages.push({ group, percentage }); // Allow any percentage including 0%
      }

      // Normalize to ensure sum = 1.0
      const sum = rawPercentages.reduce((acc, item) => acc + item.percentage, 0);
      for (const item of rawPercentages) {
        groupInitialAllocations.set(item.group.tokenPairKey, item.percentage / sum);
      }

      console.log(`      ${key} competing groups initialized:`);
      for (const group of competingGroups) {
        const pct = groupInitialAllocations.get(group.tokenPairKey);
        console.log(`         • ${group.tokenPairKey}: ${(pct * 100).toFixed(1)}%`);
      }
    }
  }

  // Step 4: Calculate initial pool allocations within each group
  const poolInitialAllocations = new Map(); // poolKey -> percentage within group

  for (const group of groupsWithLevels) {
    if (group.pools.length === 1) {
      // Single pool - gets 100%
      const pool = group.pools[0];
      const poolKey = pool.poolKey || `${pool.poolAddress}@${pool.inputToken}-${pool.outputToken}`;
      poolInitialAllocations.set(poolKey, 1.0);
    } else {
      // Multiple pools - distribute based on importance
      let totalImportance = BigNumber.from(0);
      const importanceByPool = new Map();

      for (const pool of group.pools) {
        const poolKey = pool.poolKey || `${pool.poolAddress}@${pool.inputToken}-${pool.outputToken}`;
        const importance = poolImportance.get(poolKey) || BigNumber.from(1); // Minimum 1
        importanceByPool.set(poolKey, importance);
        totalImportance = totalImportance.add(importance);
      }

      // Normalize to percentages
      for (const pool of group.pools) {
        const poolKey = pool.poolKey || `${pool.poolAddress}@${pool.inputToken}-${pool.outputToken}`;
        const importance = importanceByPool.get(poolKey);
        const percentage = importance.mul(100000).div(totalImportance).toNumber() / 100000;
        poolInitialAllocations.set(poolKey, Math.max(0.01, percentage)); // Minimum 1%
      }
    }
  }

  console.log(`      ✓ Initialized ${groupInitialAllocations.size} groups and ${poolInitialAllocations.size} pools from route data`);

  return {
    groupInitialAllocations,
    poolInitialAllocations
  };
}

/**
 * Optimize split between competing groups (Phase 1)
 * Uses hill-climbing to find optimal allocation of shared input resource
 * Evaluates full end-to-end output including downstream groups
 */
async function optimizeInterGroupSplit(
  competingGroups,
  totalInput,
  tokenIn,
  tokenOut,
  allGroupsWithLevels,
  previousOptimizations,
  groupInitialAllocations,
  poolInitialAllocations
) {
  // CRITICAL: Define token decimals lookup for intermediate tokens
  const tokenDecimalsLookup = {
    [tokenIn.symbol]: tokenIn.decimals,
    [tokenOut.symbol]: tokenOut.decimals,
    'ETH': 18,
    'WETH': 18,
    'USDC': 6,
    'USDT': 6,
    'DAI': 18,
    'WBTC': 8
  };

  const numGroups = competingGroups.length;
  console.log(`      Inter-group optimization: ${numGroups} groups competing for input`);

  // Initialize split from route-based analysis
  let currentSplit = competingGroups.map(group => {
    const initialPct = groupInitialAllocations.get(group.tokenPairKey) || (1.0 / numGroups);
    return initialPct; // Allow any percentage including 0%
  });

  // Normalize to ensure sum is exactly 1.0
  const sum = currentSplit.reduce((a, b) => a + b, 0);
  currentSplit = currentSplit.map(x => x / sum);

  console.log(`      Initial inter-group split: ${currentSplit.map(x => (x * 100).toFixed(1) + '%').join(' / ')}`);

  // Evaluate initial split
  let bestSplit = [...currentSplit];
  let bestOutput = await evaluateInterGroupSplit(
    currentSplit,
    competingGroups,
    totalInput,
    tokenIn,
    tokenOut,
    allGroupsWithLevels,
    previousOptimizations,
    poolInitialAllocations
  );

  console.log(`      Initial end-to-end output: ${ethers.utils.formatUnits(bestOutput, tokenOut.decimals)} ${tokenOut.symbol}`);

  // Hill climbing
  const maxIterations = 100;
  const initialStepSize = 0.05; // 5%
  const minStepSize = 0.0001; // 0.01%
  const MIN_GROUP_ALLOCATION = 0.001; // 0.1% minimum (define early for pruning)
  const stepReduction = 0.7;
  let stepSize = initialStepSize;
  let iteration = 0;
  let noImprovementCount = 0; // Track consecutive iterations without improvement
  const excludedGroups = new Set(); // Track groups below threshold

  while (stepSize >= minStepSize && iteration < maxIterations) {
    let improved = false;
    iteration++;

    // PRUNE: After fine-tuning starts, exclude groups below threshold from optimization
    if (stepSize < 0.01) { // Only prune after coarse optimization
      for (let i = 0; i < numGroups; i++) {
        if (currentSplit[i] < MIN_GROUP_ALLOCATION && !excludedGroups.has(i)) {
          excludedGroups.add(i);
          console.log(`      🚫 Excluding ${competingGroups[i].tokenPairKey} (${(currentSplit[i] * 100).toFixed(3)}%) from further optimization`);
        }
      }
    }

    outerLoop:
    for (let i = 0; i < numGroups - 1; i++) {
      // Skip excluded groups
      if (excludedGroups.has(i)) continue;

      for (let j = i + 1; j < numGroups; j++) {
        // Skip excluded groups
        if (excludedGroups.has(j)) continue;

        // Try moving from i to j
        if (currentSplit[i] >= stepSize) { // Allow 0% minimum
          const testSplit = [...currentSplit];
          testSplit[i] -= stepSize;
          testSplit[j] += stepSize;

          const testOutput = await evaluateInterGroupSplit(
            testSplit,
            competingGroups,
            totalInput,
            tokenIn,
            tokenOut,
            allGroupsWithLevels,
            previousOptimizations,
            poolInitialAllocations
          );

          if (testOutput.gt(bestOutput)) {
            bestOutput = testOutput;
            bestSplit = testSplit;
            currentSplit = testSplit;
            improved = true;
            console.log(`      Iteration ${iteration}: ${ethers.utils.formatUnits(bestOutput, tokenOut.decimals)} ${tokenOut.symbol} - Split: ${bestSplit.map(x => (x * 100).toFixed(1) + '%').join(' / ')}`);
            break outerLoop;
          }
        }

        // Try moving from j to i
        if (currentSplit[j] >= stepSize) {
          const testSplit = [...currentSplit];
          testSplit[j] -= stepSize;
          testSplit[i] += stepSize;

          const testOutput = await evaluateInterGroupSplit(
            testSplit,
            competingGroups,
            totalInput,
            tokenIn,
            tokenOut,
            allGroupsWithLevels,
            previousOptimizations,
            poolInitialAllocations
          );

          if (testOutput.gt(bestOutput)) {
            bestOutput = testOutput;
            bestSplit = testSplit;
            currentSplit = testSplit;
            improved = true;
            console.log(`      Iteration ${iteration}: ${ethers.utils.formatUnits(bestOutput, tokenOut.decimals)} ${tokenOut.symbol} - Split: ${bestSplit.map(x => (x * 100).toFixed(1) + '%').join(' / ')}`);
            break outerLoop;
          }
        }
      }
    }

    if (!improved) {
      stepSize = stepSize * stepReduction;
      noImprovementCount++;

      // Early convergence: stop if no improvement for 5 consecutive iterations
      if (noImprovementCount >= 6) {
        console.log(`      ✓ Converged after ${iteration} iterations (no improvement for 5 iterations)`);
        break;
      }
    } else {
      noImprovementCount = 0; // Reset counter on improvement
    }
  }

  // console.log(`      ✓ Optimized inter-group split: ${bestSplit.map(x => (x * 100).toFixed(3) + '%').join(' / ')}`);

  // CONSOLIDATE: Redistribute tiny allocations to groups with same input token
  // Then cascade removal to downstream groups that lose their only input source
  const consolidatedSplit = [...bestSplit];
  const removedIndices = new Set();

  // Phase 1: Consolidate tiny groups
  for (let i = 0; i < numGroups; i++) {
    if (consolidatedSplit[i] < MIN_GROUP_ALLOCATION && consolidatedSplit[i] > 0) {
      const smallGroup = competingGroups[i];

      // Find a larger group with same input token to absorb this allocation
      let targetIdx = -1;
      let maxAllocation = 0;

      for (let j = 0; j < numGroups; j++) {
        if (i !== j &&
            competingGroups[j].inputToken === smallGroup.inputToken &&
            consolidatedSplit[j] >= MIN_GROUP_ALLOCATION &&
            consolidatedSplit[j] > maxAllocation) {
          targetIdx = j;
          maxAllocation = consolidatedSplit[j];
        }
      }

      if (targetIdx >= 0) {
        // console.log(`      ⚠️  Redistributing ${(consolidatedSplit[i] * 100).toFixed(3)}% from ${smallGroup.tokenPairKey} to ${competingGroups[targetIdx].tokenPairKey}`);
        consolidatedSplit[targetIdx] += consolidatedSplit[i];
        consolidatedSplit[i] = 0;
        removedIndices.add(i);
      } else {
        // No similar group found - keep it even if small
        // console.log(`      ⚠️  Keeping small allocation ${(consolidatedSplit[i] * 100).toFixed(3)}% for ${smallGroup.tokenPairKey} (no similar group to merge)`);
      }
    }
  }

  // Phase 2: Cascade removal to downstream groups that lost their only input source
  // Track all removed groups (consolidated + cascaded) for skipping during processing
  const removedGroupKeys = new Set();
  for (let i = 0; i < numGroups; i++) {
    if (removedIndices.has(i)) {
      removedGroupKeys.add(competingGroups[i].tokenPairKey);
    }
  }

  // Mark groups whose output tokens are no longer produced by any non-removed group
  const removedOutputTokens = new Set();
  for (let i = 0; i < numGroups; i++) {
    if (removedIndices.has(i)) {
      removedOutputTokens.add(competingGroups[i].outputToken);
    }
  }

  // For each removed output token, check if there are other groups producing it
  for (const token of removedOutputTokens) {
    const hasOtherProducers = competingGroups.some((g, idx) =>
      !removedIndices.has(idx) && g.outputToken === token
    );

    if (!hasOtherProducers) {
      // No other producers - find downstream groups consuming this token in ALL groups
      const downstreamGroups = allGroupsWithLevels.filter(g =>
        g.level > competingGroups[0].level &&
        g.inputToken === token
      );

      for (const downstream of downstreamGroups) {
        // console.log(`      🔗 Cascading removal: ${downstream.tokenPairKey} loses input (${token} no longer produced)`);
        removedGroupKeys.add(downstream.tokenPairKey);
      }
    }
  }

  if (removedIndices.size > 0) {
    console.log(`      ✓ Consolidated split: ${consolidatedSplit.filter((_, i) => !removedIndices.has(i)).map(x => (x * 100).toFixed(3) + '%').join(' / ')}`);
  }

  // Now optimize each group with its allocated input
  // IMPORTANT: Maintain parallel array structure with competingGroups (null for removed indices)
  const groupOptimizations = [];
  const groupInputs = [];

  for (let i = 0; i < numGroups; i++) {
    if (removedIndices.has(i)) {
      // Consolidated group - store null placeholders
      groupInputs.push(BigNumber.from(0));
      groupOptimizations.push(null);
      continue;
    }

    const group = competingGroups[i];
    const groupInput = totalInput.mul(Math.floor(consolidatedSplit[i] * 1000000)).div(1000000);
    groupInputs.push(groupInput);

    const groupTokenIn = { symbol: group.inputToken, decimals: tokenDecimalsLookup[group.inputToken] || 18, address: tokenIn.address };
    const groupTokenOut = { symbol: group.outputToken, decimals: tokenDecimalsLookup[group.outputToken] || 18, address: tokenOut.address };
    const result = await optimizeTokenPairGroup(group, groupInput, groupTokenIn, groupTokenOut, poolInitialAllocations);
    result.inputPercentage = consolidatedSplit[i];
    groupOptimizations.push(result);
  }

  return {
    groupOptimizations,
    groupInputs,
    split: bestSplit,
    totalOutput: bestOutput,
    removedGroupKeys // NEW: Pass cascaded removals up for filtering
  };
}

/**
 * Evaluate a specific inter-group split configuration
 * Calculates full end-to-end output including all downstream groups
 */
async function evaluateInterGroupSplit(
  split,
  competingGroups,
  totalInput,
  tokenIn,
  tokenOut,
  allGroupsWithLevels,
  previousOptimizations,
  poolInitialAllocations
) {
  // CRITICAL: Define token decimals lookup for intermediate tokens
  const tokenDecimalsLookup = {
    [tokenIn.symbol]: tokenIn.decimals,
    [tokenOut.symbol]: tokenOut.decimals,
    'ETH': 18,
    'WETH': 18,
    'USDC': 6,
    'USDT': 6,
    'DAI': 18,
    'WBTC': 8
  };

  // Calculate outputs for each competing group with its split
  const groupOutputs = new Map(); // tokenPairKey -> output amount

  for (let i = 0; i < competingGroups.length; i++) {
    const group = competingGroups[i];
    const groupInput = totalInput.mul(Math.floor(split[i] * 1000000)).div(1000000);

    // OPTIMIZATION: Skip expensive intra-group optimization for groups with < 2.5% allocation
    // The output difference is negligible and not worth 6-11 iterations
    if (split[i] < 0.025 && group.pools.length > 1) {
      // Use simple single-best-pool strategy for tiny allocations
      const groupTokenIn = { symbol: group.inputToken, decimals: tokenDecimalsLookup[group.inputToken] || 18, address: tokenIn.address };
      const groupTokenOut = { symbol: group.outputToken, decimals: tokenDecimalsLookup[group.outputToken] || 18, address: tokenOut.address };

      // Just use the first pool (already sorted by output in route discovery)
      const bestPool = group.pools[0];
      const output = await calculatePoolExactOutput(bestPool, groupInput, groupTokenIn, groupTokenOut);

      groupOutputs.set(group.tokenPairKey, output);
      continue;
    }

    const groupTokenIn = { symbol: group.inputToken, decimals: tokenDecimalsLookup[group.inputToken] || 18, address: tokenIn.address };
    const groupTokenOut = { symbol: group.outputToken, decimals: tokenDecimalsLookup[group.outputToken] || 18, address: tokenOut.address };
    const result = await optimizeTokenPairGroup(group, groupInput, groupTokenIn, groupTokenOut, poolInitialAllocations);

    groupOutputs.set(group.tokenPairKey, result.totalOutput);
  }

  // Now evaluate all downstream groups using these outputs
  const currentLevel = competingGroups[0].level;
  const downstreamGroups = allGroupsWithLevels.filter(g => g.level > currentLevel);

  // Process downstream groups level by level
  const maxLevel = downstreamGroups.length > 0 ? Math.max(...downstreamGroups.map(g => g.level)) : currentLevel;

  for (let level = currentLevel + 1; level <= maxLevel; level++) {
    const groupsAtLevel = downstreamGroups.filter(g => g.level === level);

    for (const group of groupsAtLevel) {
      // Calculate input for this downstream group
      let inputAmount = BigNumber.from(0);

      // Sum outputs from previous level(s) that produce this input token
      for (const [tpKey, output] of groupOutputs) {
        const prevGroup = allGroupsWithLevels.find(g => g.tokenPairKey === tpKey);
        if (prevGroup && prevGroup.outputToken === group.inputToken) {
          inputAmount = inputAmount.add(output);
        }
      }

      // Also add from previousOptimizations if not yet in groupOutputs
      for (const [tpKey, opt] of previousOptimizations) {
        if (!groupOutputs.has(tpKey)) {
          const prevGroup = allGroupsWithLevels.find(g => g.tokenPairKey === tpKey);
          if (prevGroup && prevGroup.outputToken === group.inputToken) {
            inputAmount = inputAmount.add(opt.totalOutput);
          }
        }
      }

      if (inputAmount.gt(0)) {
        // OPTIMIZATION: Skip expensive optimization for downstream groups with tiny inputs (< 2.5% of original total)
        const inputPct = inputAmount.mul(100).div(totalInput).toNumber() / 100;

        if (inputPct < 0.025 && group.pools.length > 1) {
          // Use simple single-best-pool strategy for tiny downstream groups
          const groupTokenIn = { symbol: group.inputToken, decimals: tokenDecimalsLookup[group.inputToken] || 18, address: tokenIn.address };
          const groupTokenOut = { symbol: group.outputToken, decimals: tokenDecimalsLookup[group.outputToken] || 18, address: tokenOut.address };

          const bestPool = group.pools[0];
          const output = await calculatePoolExactOutput(bestPool, inputAmount, groupTokenIn, groupTokenOut);

          groupOutputs.set(group.tokenPairKey, output);
        } else {
          // Normal optimization for significant groups
          const groupTokenIn = { symbol: group.inputToken, decimals: tokenDecimalsLookup[group.inputToken] || 18, address: tokenIn.address };
          const groupTokenOut = { symbol: group.outputToken, decimals: tokenDecimalsLookup[group.outputToken] || 18, address: tokenOut.address };
          const result = await optimizeTokenPairGroup(group, inputAmount, groupTokenIn, groupTokenOut, poolInitialAllocations);

          groupOutputs.set(group.tokenPairKey, result.totalOutput);
        }
      }
    }
  }

  // Sum final outputs (groups that output the target token)
  let totalOutput = BigNumber.from(0);
  for (const [tpKey, output] of groupOutputs) {
    const group = allGroupsWithLevels.find(g => g.tokenPairKey === tpKey);
    if (group && group.outputToken === tokenOut.symbol) {
      totalOutput = totalOutput.add(output);
    }
  }

  return totalOutput;
}

/**
 * Assign execution levels to token-pair groups using topological sort
 * Level 0 = groups that consume the initial input token
 * Level N = groups that consume outputs from level N-1
 */
function assignLevelsToGroups(tokenPairGroups, initialInputToken) {
  const groupsWithLevels = tokenPairGroups.map(g => ({ ...g, level: -1 }));
  const tokenProducers = new Map(); // outputToken -> [groups that produce it]

  // Build producer map
  for (const group of groupsWithLevels) {
    if (!tokenProducers.has(group.outputToken)) {
      tokenProducers.set(group.outputToken, []);
    }
    tokenProducers.get(group.outputToken).push(group);
  }

  // Assign levels using topological sort
  let currentLevel = 0;
  let remaining = new Set(groupsWithLevels);

  // Level 0: Groups that consume the initial input token
  for (const group of groupsWithLevels) {
    if (group.inputToken === initialInputToken) {
      group.level = 0;
      remaining.delete(group);
    }
  }

  // Subsequent levels: Groups that consume outputs from previous levels
  while (remaining.size > 0 && currentLevel < 10) {
    currentLevel++;
    const assignedThisLevel = [];

    for (const group of remaining) {
      // Check if this group's input is produced by a lower level
      const producers = tokenProducers.get(group.inputToken) || [];
      const hasUnresolvedDependency = producers.some(p =>
        p !== group && remaining.has(p)
      );

      if (!hasUnresolvedDependency) {
        group.level = currentLevel;
        assignedThisLevel.push(group);
      }
    }

    if (assignedThisLevel.length === 0) {
      // Circular dependency or isolated groups - assign to current level
      remaining.forEach(g => g.level = currentLevel);
      break;
    }

    assignedThisLevel.forEach(g => remaining.delete(g));
  }

  // CRITICAL FIX: Detect and resolve circular token flows at the same level
  // Use leg indices from routes to determine correct execution order
  const maxAssignedLevel = Math.max(...groupsWithLevels.map(g => g.level));

  for (let level = 0; level <= maxAssignedLevel; level++) {
    const groupsAtLevel = groupsWithLevels.filter(g => g.level === level);

    // Check for circular token flows
    for (let i = 0; i < groupsAtLevel.length; i++) {
      for (let j = i + 1; j < groupsAtLevel.length; j++) {
        const groupA = groupsAtLevel[i];
        const groupB = groupsAtLevel[j];

        // Detect circular flow: A→B and B→A
        if (groupA.inputToken === groupB.outputToken &&
            groupA.outputToken === groupB.inputToken) {
          console.log(`   ⚠️  Circular token flow detected at Level ${level}:`);
          console.log(`       ${groupA.tokenPairKey} ⇄ ${groupB.tokenPairKey}`);

          // Use leg indices to determine which should execute first
          // Find routes where BOTH token-pairs appear together
          const routeIndicesA = new Set(groupA.pools.flatMap(p => p.routeIndices || []));
          const routeIndicesB = new Set(groupB.pools.flatMap(p => p.routeIndices || []));
          const sharedRoutes = [...routeIndicesA].filter(r => routeIndicesB.has(r));

          console.log(`       Shared routes: [${sharedRoutes.join(', ')}]`);

          if (sharedRoutes.length > 0) {
            // Check which one appears earlier in shared routes
            let sumLegA = 0;
            let sumLegB = 0;

            for (const routeIdx of sharedRoutes) {
              // Find leg index for groupA in this route
              for (const pool of groupA.pools) {
                const idx = pool.routeIndices.indexOf(routeIdx);
                if (idx !== -1) {
                  sumLegA += pool.legIndices[idx];
                  break;
                }
              }

              // Find leg index for groupB in this route
              for (const pool of groupB.pools) {
                const idx = pool.routeIndices.indexOf(routeIdx);
                if (idx !== -1) {
                  sumLegB += pool.legIndices[idx];
                  break;
                }
              }
            }

            const avgLegA = sumLegA / sharedRoutes.length;
            const avgLegB = sumLegB / sharedRoutes.length;

            // The one with higher average leg index executes AFTER, so push to next level
            if (avgLegA > avgLegB) {
              groupA.level = level + 1;
              console.log(`       → Moved ${groupA.tokenPairKey} to Level ${level + 1} (appears later in routes)`);
            } else if (avgLegB > avgLegA) {
              groupB.level = level + 1;
              console.log(`       → Moved ${groupB.tokenPairKey} to Level ${level + 1} (appears later in routes)`);
            } else {
              console.log(`       ⚠️  Same average - keeping both at Level ${level}`);
            }
          } else {
            console.log(`       ⚠️  No shared routes - keeping both at Level ${level}`);
          }
        }
      }
    }
  }

  return groupsWithLevels;
}

/**
 * Group token-pair groups by (inputToken, level) to identify competing groups
 * Groups with the same inputToken at the same level compete for that resource
 */
function groupByInputTokenAndLevel(groupsWithLevels) {
  const competingGroupSets = new Map(); // "inputToken@level" -> [groups]

  for (const group of groupsWithLevels) {
    const key = `${group.inputToken}@${group.level}`;
    if (!competingGroupSets.has(key)) {
      competingGroupSets.set(key, []);
    }
    competingGroupSets.get(key).push(group);
  }

  return competingGroupSets;
}

/**
 * Token-pair-based hierarchical optimization
 * Phase 1: Optimize split between competing groups (same input, same level)
 * Phase 2: Optimize pool splits within each group
 */
async function optimizeSplitSimple(routes, totalAmount, tokenIn, tokenOut) {
  console.log(`   Input: ${ethers.utils.formatUnits(totalAmount, tokenIn.decimals)} ${tokenIn.symbol}`);

  // Build token-pair groups from all route legs
  const tokenPairGroups = buildTokenPairGroups(routes);

  console.log(`\n📊 Discovered Token Pair Groups:`);
  tokenPairGroups.forEach((group, idx) => {
    console.log(`   ${idx + 1}. ${group.tokenPairKey}: ${group.poolCount} pool(s)`);
    group.pools.forEach(pool => {
      const poolAddr = pool.poolAddress || pool.poolId || 'unknown';
      console.log(`      • ${pool.protocol} (${poolAddr.slice(0, 10)}...) - Used by ${pool.routeIndices.length} route(s)`);
    });
  });

  // Assign execution levels
  let groupsWithLevels = assignLevelsToGroups(tokenPairGroups, tokenIn.symbol);

  // CRITICAL: Remove backwards routes that consume the target output token
  // Example: For ETH→ONE, remove ONE→ETH (trades away our target)
  const beforeFilterCount = groupsWithLevels.length;
  groupsWithLevels = groupsWithLevels.filter(g => g.inputToken !== tokenOut.symbol);
  if (groupsWithLevels.length < beforeFilterCount) {
    console.log(`\n🚫 Filtered out ${beforeFilterCount - groupsWithLevels.length} backwards route(s) that consume target token ${tokenOut.symbol}`);
  }

  console.log(`\n📋 Execution Levels:`);
  const maxLevel = Math.max(...groupsWithLevels.map(g => g.level));
  for (let level = 0; level <= maxLevel; level++) {
    const groupsAtLevel = groupsWithLevels.filter(g => g.level === level);
    console.log(`   Level ${level}: ${groupsAtLevel.length} group(s)`);
    groupsAtLevel.forEach(g => {
      console.log(`      • ${g.tokenPairKey} (${g.poolCount} pools)`);
    });
  }

  // Group by (inputToken, level) to identify competing groups
  const competingGroupSets = groupByInputTokenAndLevel(groupsWithLevels);

  console.log(`\n⚡ Optimization Strategy:`);
  for (const [key, groups] of competingGroupSets) {
    if (groups.length > 1) {
      console.log(`   ${key}: ${groups.length} COMPETING groups - inter-group optimization needed`);
      groups.forEach(g => console.log(`      • ${g.tokenPairKey}`));
    } else {
      console.log(`   ${key}: 1 sequential group - intra-group optimization only`);
      console.log(`      • ${groups[0].tokenPairKey}`);
    }
  }

  // Initialize allocations from route outputs
  console.log(`\n🎯 Initializing from discovered routes...`);
  const { groupInitialAllocations, poolInitialAllocations } = initializeFromRoutes(routes, groupsWithLevels, totalAmount);

  const groupOptimizations = new Map(); // tokenPairKey -> { poolAllocations, totalOutput, inputPercentage }
  const groupInputAmounts = new Map(); // tokenPairKey -> input amount for this group
  const allRemovedGroupKeys = new Set(); // Track all removed groups (consolidated + cascaded)

  // Process each level sequentially (dependencies flow from lower to higher levels)
  for (let level = 0; level <= maxLevel; level++) {
    // Filter out groups that were removed in previous levels or cascaded
    const groupsAtLevel = groupsWithLevels.filter(g =>
      g.level === level && !allRemovedGroupKeys.has(g.tokenPairKey)
    );
    console.log(`\n🔄 Processing Level ${level}: ${groupsAtLevel.length} group(s)`);

    // Get competing group sets at this level (filter out removed groups)
    const competingAtLevel = Array.from(competingGroupSets.entries())
      .filter(([key]) => key.endsWith(`@${level}`))
      .map(([, groups]) => groups.filter(g => !allRemovedGroupKeys.has(g.tokenPairKey)))
      .filter(groups => groups.length > 0); // Remove empty sets

    // CRITICAL: Define token decimals lookup OUTSIDE conditionals so it's available for all paths
    const tokenDecimalsLookup = {
      [tokenIn.symbol]: tokenIn.decimals,
      [tokenOut.symbol]: tokenOut.decimals,
      'ETH': 18,
      'WETH': 18,
      'USDC': 6,
      'USDT': 6,
      'DAI': 18,
      'WBTC': 8
    };

    for (const competingGroups of competingAtLevel) {
      if (competingGroups.length === 1) {
        // Sequential group - no inter-group optimization needed
        const group = competingGroups[0];
        console.log(`\n   ${group.tokenPairKey} (sequential)`);

        // Determine input amount (100% of available input token)
        let inputAmount;
        if (level === 0) {
          inputAmount = totalAmount; // Initial input
        } else {
          // Sum outputs from previous level that produce this input token
          inputAmount = BigNumber.from(0);
          for (const [tpKey, opt] of groupOptimizations) {
            const prevGroup = groupsWithLevels.find(g => g.tokenPairKey === tpKey);
            if (prevGroup && prevGroup.outputToken === group.inputToken) {
              inputAmount = inputAmount.add(opt.totalOutput);
            }
          }
        }

        groupInputAmounts.set(group.tokenPairKey, inputAmount);

        const groupTokenIn = { symbol: group.inputToken, decimals: tokenDecimalsLookup[group.inputToken] || 18, address: tokenIn.address };
        const groupTokenOut = { symbol: group.outputToken, decimals: tokenDecimalsLookup[group.outputToken] || 18, address: tokenOut.address };
        const result = await optimizeTokenPairGroup(group, inputAmount, groupTokenIn, groupTokenOut, poolInitialAllocations);

        result.inputPercentage = 1.0; // Gets 100% of input
        groupOptimizations.set(group.tokenPairKey, result);

      } else {
        // Competing groups - need inter-group optimization
        console.log(`\n   Competing groups (${competingGroups.map(g => g.tokenPairKey).join(' vs ')})`);

        // Determine total input amount available for these competing groups
        let totalInput;
        if (level === 0) {
          totalInput = totalAmount; // Initial input
        } else {
          // Sum outputs from previous level
          totalInput = BigNumber.from(0);
          const inputToken = competingGroups[0].inputToken;
          for (const [tpKey, opt] of groupOptimizations) {
            const prevGroup = groupsWithLevels.find(g => g.tokenPairKey === tpKey);
            if (prevGroup && prevGroup.outputToken === inputToken) {
              totalInput = totalInput.add(opt.totalOutput);
            }
          }
        }

        // Phase 1: Optimize split between competing groups
        const interGroupResult = await optimizeInterGroupSplit(
          competingGroups,
          totalInput,
          tokenIn,
          tokenOut,
          groupsWithLevels,
          groupOptimizations,
          groupInitialAllocations,
          poolInitialAllocations
        );

        // Accumulate removed groups from this optimization
        if (interGroupResult.removedGroupKeys) {
          interGroupResult.removedGroupKeys.forEach(key => allRemovedGroupKeys.add(key));
        }

        // Store results for each group (skip null entries from consolidated groups)
        for (let i = 0; i < competingGroups.length; i++) {
          const group = competingGroups[i];
          const optimization = interGroupResult.groupOptimizations[i];

          // Skip consolidated/removed groups (marked with null)
          if (optimization === null) {
            console.log(`   ⚠️  Skipping consolidated group: ${group.tokenPairKey}`);
            continue;
          }

          groupInputAmounts.set(group.tokenPairKey, interGroupResult.groupInputs[i]);
          groupOptimizations.set(group.tokenPairKey, optimization);
        }
      }
    }
  }

  // Calculate total output (sum of final-level group outputs)
  let totalOptimizedOutput = BigNumber.from(0);

  // Build token decimals lookup for proper display formatting
  const tokenDecimals = {
    [tokenIn.symbol]: tokenIn.decimals,
    [tokenOut.symbol]: tokenOut.decimals,
    'ETH': 18,
    'WETH': 18,
    'USDC': 6,
    'USDT': 6,
    'DAI': 18,
    'WBTC': 8
  };

  console.log(`\n✅ Optimization Complete:`);
  for (const group of groupsWithLevels) {
    const opt = groupOptimizations.get(group.tokenPairKey);
    const inputAmt = groupInputAmounts.get(group.tokenPairKey);

    // Skip consolidated groups (not in optimization results)
    if (!opt || !inputAmt) {
      // console.log(`   ${group.tokenPairKey} (Level ${group.level}): ⚠️  Consolidated (merged into another group)`);
      continue;
    }

    const outputDecimals = tokenDecimals[group.outputToken] || 18;
    console.log(`   ${group.tokenPairKey} (Level ${group.level}):`);
    console.log(`      Input: ${ethers.utils.formatUnits(inputAmt, tokenIn.decimals)} ${group.inputToken}`);
    console.log(`      Output: ${ethers.utils.formatUnits(opt.totalOutput, outputDecimals)} ${group.outputToken}`);
    if (opt.inputPercentage !== undefined) {
      console.log(`      Share: ${(opt.inputPercentage * 100).toFixed(1)}%`);
    }

    // Sum final outputs
    if (group.outputToken === tokenOut.symbol) {
      totalOptimizedOutput = totalOptimizedOutput.add(opt.totalOutput);
    }
  }

  console.log(`\n   🎯 Total ${tokenOut.symbol} output: ${ethers.utils.formatUnits(totalOptimizedOutput, tokenOut.decimals)}`);

  // Map pool allocations back to route percentages (for compatibility)
  const bestSplit = routes.map(() => 0); // Initialize with zeros

  // For each group, distribute its pool allocations to the routes that use those pools
  for (const group of tokenPairGroups) {
    const optimization = groupOptimizations.get(group.tokenPairKey);

    // Skip consolidated groups (not in optimization results)
    if (!optimization) {
      continue;
    }

    for (const pool of group.pools) {
      const poolPercentage = optimization.poolAllocations.get(pool.poolAddress);

      // Skip pools that were filtered out during optimization (undefined allocation)
      if (poolPercentage === undefined) {
        continue;
      }

      // Distribute this pool's percentage to all routes that use it
      for (const routeIdx of pool.routeIndices) {
        bestSplit[routeIdx] += poolPercentage / pool.routeIndices.length;
      }
    }
  }

  // Normalize bestSplit to sum to 1.0
  const splitSum = bestSplit.reduce((a, b) => a + b, 0);
  const normalizedSplit = bestSplit.map(x => x / splitSum);

  // Build pool execution structure with optimized percentages
  const poolExecutionStructure = buildPoolExecutionStructureFromGroups(groupsWithLevels, groupOptimizations);

  console.log(`   📊 Pool Execution Structure (${poolExecutionStructure.levels.length} levels):`);
  poolExecutionStructure.levels.forEach(level => {
    console.log(`\n   Level ${level.level}:`);
    level.pools.forEach(pool => {
      const poolAddr = pool.poolAddress || pool.poolKey || 'unknown';
      const displayAddr = poolAddr.length > 10 ? poolAddr.slice(0, 10) + '...' : poolAddr;
      const pct = pool.percentage !== undefined ? (pool.percentage * 100).toFixed(1) + '%' : 'N/A';
      console.log(`      • ${pool.protocol} (${displayAddr}): ${pool.inputToken}→${pool.outputToken} at ${pct}`);
    });
  });

  // Build result with calculated outputs for each split (keep for compatibility)
  // Filter out routes that were removed (backwards routes)
  const validRoutesWithSplits = normalizedSplit
    .map((pct, index) => ({ pct, index, route: routes[index] }))
    .filter(item => item.pct > 0 && item.route && item.route.totalOutput);

  const splits = await Promise.all(validRoutesWithSplits.map(async (item) => {
    const amount = totalAmount.mul(Math.floor(item.pct * 1000000)).div(1000000);
    const output = await calculateRouteExactOutput(item.route, amount, tokenIn, tokenOut);

    return {
      route: item.route,
      protocol: item.route.protocol || 'mixed',  // ADD: protocol property for display
      percentage: item.pct,
      amount: amount,
      output: output,
      description: item.route.description || item.route.path || `Route ${item.index + 1}`
    };
  }));

  return {
    type: 'optimized-multi-route-split',
    totalOutput: totalOptimizedOutput,
    splits,
    numRoutes: routes.length,
    description: `Token-pair optimized ${tokenPairGroups.length}-group split`,
    // NEW: Token-pair-based execution structure
    poolExecutionStructure: poolExecutionStructure,
    tokenPairGroups: tokenPairGroups,
    groupOptimizations: groupOptimizations
  };
}

/**
 * Build pool execution structure from token-pair groups and their optimizations
 * @param {Array} tokenPairGroups - Array of token pair groups
 * @param {Map} groupOptimizations - Map of tokenPairKey -> optimization result
 * @returns {Object} Execution structure with levels and pools
 */
function buildPoolExecutionStructureFromGroups(tokenPairGroups, groupOptimizations) {
  // Group pools by execution level
  const levelMap = new Map(); // level number -> pools array
  const poolMap = new Map(); // poolKey -> pool info

  for (const group of tokenPairGroups) {
    const optimization = groupOptimizations.get(group.tokenPairKey);
    const level = group.level;

    if (!levelMap.has(level)) {
      levelMap.set(level, []);
    }

    for (const pool of group.pools) {
      const poolKey = pool.poolKey || `${pool.poolAddress || pool.poolId}@${pool.inputToken}-${pool.outputToken}`;

      // CRITICAL: Calculate percentage of level input, not just group input
      // percentage = group's share of level × pool's share within group
      const poolPercentageWithinGroup = optimization?.poolAllocations?.get(pool.poolAddress || pool.poolId) || 0;
      const groupPercentageOfLevel = optimization?.inputPercentage || 1.0;
      const percentageOfLevelInput = poolPercentageWithinGroup * groupPercentageOfLevel;

      // FILTER: Skip pools with allocation < 0.01% (0.0001) to save gas
      if (percentageOfLevelInput < 0.0001) {
        // console.log(`      ⚠️  Skipping pool ${pool.poolAddress?.slice(0, 10)}... at Level ${level}: ${(percentageOfLevelInput * 100).toFixed(4)}% (< 0.01% threshold)`);
        continue; // Skip this pool
      }

      // Get exact input and output amounts from optimization
      const poolInput = optimization?.poolInputs?.get(pool.poolAddress || pool.poolId);
      const poolOutput = optimization?.poolOutputs?.get(pool.poolAddress || pool.poolId);

      // Determine wrap/unwrap operation needed
      // Balancer uses WETH, Uniswap uses ETH
      // Operation codes: 0=none, 1=wrap before, 2=wrap after, 3=unwrap before, 4=unwrap after
      let wrapOperation = 0;

      const isETHOrWETH = (token) => token === 'ETH' || token === 'WETH';

      // Determine actual tokens used by this protocol
      const actualInput = (pool.protocol === 'balancer' && pool.inputToken === 'ETH') ? 'WETH' : pool.inputToken;
      const actualOutput = (pool.protocol === 'balancer' && pool.outputToken === 'ETH') ? 'WETH' : pool.outputToken;

      // FIRST: Check if INPUT conversion is needed
      // This applies to ALL levels, not just level 0
      if (isETHOrWETH(pool.inputToken)) {
        if (pool.protocol === 'balancer' && pool.inputToken === 'ETH') {
          // Balancer expects WETH, but input is ETH → wrap before call
          wrapOperation = 1;
          console.log(`      🔄 Level ${level} Balancer pool needs ETH→WETH wrap (wrapOp=1)`);
        } else if (pool.protocol === 'uniswap' && pool.inputToken === 'WETH') {
          // Uniswap expects ETH, but input is WETH → unwrap before call
          wrapOperation = 3;
          console.log(`      🔄 Level ${level} Uniswap pool needs WETH→ETH unwrap (wrapOp=3)`);
        }
      }

      // SECOND: Check if output conversion is needed for consuming level OR final output
      // Only set wrap operation if it wasn't already set by input conversion above
      if (wrapOperation === 0 && isETHOrWETH(pool.outputToken)) {
        // Find all future levels that consume ETH/WETH
        const consumingLevels = tokenPairGroups.filter(g =>
          g.level > level &&
          g.pools.some(p => isETHOrWETH(p.inputToken))
        );

        // Check the nearest consuming level
        if (consumingLevels.length > 0) {
          const nearestConsumingLevel = consumingLevels[0]; // Already sorted by level
          const needsWETH = nearestConsumingLevel.pools.some(p => p.protocol === 'balancer' && isETHOrWETH(p.inputToken));
          const needsETH = nearestConsumingLevel.pools.some(p => p.protocol === 'uniswap' && isETHOrWETH(p.inputToken));

          // MIXED CONSUMPTION: If consuming level needs BOTH WETH and ETH, don't convert at output
          // Instead, individual consuming pools will handle conversion via "before" operations
          if (needsWETH && needsETH) {
            // Keep output in its native form, let consumers convert
            wrapOperation = 0;
          }
          // SINGLE TYPE CONSUMPTION: Convert at output if all consumers need the same form
          else if (pool.protocol === 'balancer' && needsETH && !needsWETH) {
            wrapOperation = 4; // Unwrap WETH to ETH after call (all consumers need ETH)
          }
          else if (pool.protocol === 'uniswap' && needsWETH && !needsETH) {
            wrapOperation = 2; // Wrap ETH to WETH after call (all consumers need WETH)
          }
        }
        // FINAL OUTPUT: If no consuming levels, this is final output to user
        else {
          // Balancer outputs WETH but user expects ETH → unwrap after call
          if (pool.protocol === 'balancer' && pool.outputToken === 'ETH') {
            wrapOperation = 4; // Unwrap WETH to ETH after call
            console.log(`      🔄 Level ${level} Balancer final output needs WETH→ETH unwrap (wrapOp=4)`);
          }
          // Uniswap outputs ETH but user expects WETH (rare) → wrap after call
          else if (pool.protocol === 'uniswap' && pool.outputToken === 'WETH') {
            wrapOperation = 2; // Wrap ETH to WETH after call
            console.log(`      🔄 Level ${level} Uniswap final output needs ETH→WETH wrap (wrapOp=2)`);
          }
        }
      }

      const poolInfo = {
        poolAddress: pool.poolAddress || pool.poolId,
        poolKey: poolKey,
        protocol: pool.protocol,
        inputToken: pool.inputToken,
        outputToken: pool.outputToken,
        percentage: percentageOfLevelInput, // Percentage of level input
        inputAmount: poolInput,              // NEW: Exact input amount in wei
        expectedOutput: poolOutput,          // NEW: Expected output amount in wei
        wrapOperation: wrapOperation,        // NEW: Wrap/unwrap operation code
        routeIndices: pool.routeIndices,
        legIndices: pool.legIndices,
        trade: pool.trade,
        path: pool.path,
        level: level
      };

      levelMap.get(level).push(poolInfo);
      poolMap.set(poolKey, poolInfo);
    }
  }

  // Convert to levels array sorted by level number
  const levels = Array.from(levelMap.entries())
    .sort((a, b) => a[0] - b[0])  // Sort levels by number (unchanged)
    .map(([levelNum, pools]) => {
      // Group pools by input token within this level
      const inputTokenGroups = new Map();

      pools.forEach(pool => {
        const inputToken = pool.inputToken;
        if (!inputTokenGroups.has(inputToken)) {
          inputTokenGroups.set(inputToken, []);
        }
        inputTokenGroups.get(inputToken).push(pool);
      });

      // Sort each input token group by percentage (lowest to highest)
      // Mark the highest allocation for each input token as shouldUseAllBalance
      const sortedPools = [];

      inputTokenGroups.forEach((poolGroup, inputToken) => {
        // Sort by percentage: lowest to highest
        poolGroup.sort((a, b) => {
          if (a.percentage !== b.percentage) {
            return a.percentage - b.percentage; // Ascending
          }
          // Fallback: compare inputAmount
          const aAmount = a.inputAmount || ethers.BigNumber.from(0);
          const bAmount = b.inputAmount || ethers.BigNumber.from(0);
          if (aAmount.lt(bAmount)) return -1;
          if (aAmount.gt(bAmount)) return 1;
          return 0;
        });

        // Mark the last one (highest percentage) as shouldUseAllBalance
        if (poolGroup.length > 0) {
          poolGroup[poolGroup.length - 1].shouldUseAllBalance = true;
        }

        sortedPools.push(...poolGroup);
      });

      return {
        level: levelNum,
        pools: sortedPools
      };
    });

  return {
    levels,
    poolMap
  };
}

/**
 * Evaluate a specific split configuration using EXACT AMM calculations
 * Returns total output when input is split according to percentages
 *
 * CRITICAL: Handles pool convergence to account for compound slippage
 * When multiple routes hit the same pool, they are grouped and calculated together
 */
async function evaluateSplit(splitPercentages, routes, totalAmount, tokenIn, tokenOut, displayDetails = false) {
  // Detect pool convergence
  const convergenceGroups = detectPoolConvergence(routes);

  // If no convergence, use simple independent calculation
  if (convergenceGroups.length === 0) {
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

  // Build convergence map: route index -> earliest convergence group
  // If a route converges at multiple points, use the EARLIEST (lowest leg index)
  const convergenceMap = new Map();
  convergenceGroups.forEach(group => {
    group.routes.forEach(({ index, legIndex }) => {
      const existing = convergenceMap.get(index);
      if (!existing || legIndex < existing.legIndex) {
        convergenceMap.set(index, {
          poolKey: group.poolKey,
          legPosition: group.legPosition,
          legIndex: legIndex
        });
      }
    });
  });

  // Group routes by their earliest convergence point
  const poolGroups = new Map();

  for (let i = 0; i < routes.length; i++) {
    const convergence = convergenceMap.get(i);
    const groupKey = convergence
      ? `${convergence.poolKey}@${convergence.legPosition}`
      : `independent-${i}`;

    if (!poolGroups.has(groupKey)) {
      poolGroups.set(groupKey, []);
    }

    poolGroups.get(groupKey).push({
      route: routes[i],
      index: i,
      convergence: convergence,
      percentage: splitPercentages[i],
      amount: totalAmount.mul(Math.floor(splitPercentages[i] * 100000000)).div(100000000)
    });
  }

  // Display pool groups for debugging (only when requested)
  if (displayDetails) {
    console.log(`\n   🔍 Pool Groups (${poolGroups.size} groups):`);
    poolGroups.forEach((groupRoutes, groupKey) => {
      if (groupKey.startsWith('independent-')) {
        const routeIndex = groupRoutes[0].index;
        console.log(`      • Independent route ${routeIndex + 1}: ${(groupRoutes[0].percentage * 100).toFixed(1)}%`);
      } else {
        const totalPercentage = groupRoutes.reduce((sum, r) => sum + r.percentage, 0);
        const [poolKey, legPosition] = groupKey.split('@');
        const legNum = parseInt(legPosition.replace('leg', '')) + 1;
        console.log(`      • Converging at ${poolKey} (Leg ${legNum}): ${groupRoutes.length} routes (${(totalPercentage * 100).toFixed(1)}% combined)`);
        groupRoutes.forEach(({ index, percentage }) => {
          console.log(`         - Route ${index + 1}: ${(percentage * 100).toFixed(1)}%`);
        });
      }
    });
    console.log('');
  }

  // Calculate output for each pool group
  let totalOutput = BigNumber.from(0);

  for (const [groupKey, groupRoutes] of poolGroups.entries()) {
    if (groupRoutes.length === 1) {
      // Independent route - calculate normally
      const { route, amount } = groupRoutes[0];

      if (amount.lte(0)) continue;

      const output = await calculateRouteExactOutput(route, amount, tokenIn, tokenOut);
      totalOutput = totalOutput.add(output);

    } else {
      // Converging routes - calculate with compound slippage at specific leg
      const convergence = groupRoutes[0].convergence;
      const [poolKey, legPosition] = groupKey.split('@');
      const convergenceLegIndex = convergence ? convergence.legIndex : groupRoutes[0].route.legs.length - 1;

      if (displayDetails) {
        const legNum = convergenceLegIndex + 1;
        console.log(`      💥 Calculating compound slippage for ${poolKey} (Leg ${legNum}):`);
      }

      // Calculate each route up to the converging leg, then combine inputs
      const routeIntermediates = [];

      for (const { route, amount, index, convergence } of groupRoutes) {
        if (amount.lte(0)) {
          routeIntermediates.push({ amount: BigNumber.from(0), route, originalAmount: amount, index });
          continue;
        }

        // Calculate up to (but not including) the converging leg
        const intermediateAmount = await calculateRouteUpToSpecificLeg(route, amount, convergenceLegIndex, tokenIn, tokenOut);
        routeIntermediates.push({ amount: intermediateAmount, route, originalAmount: amount, index, convergenceLegIndex });

        if (displayDetails) {
          // Get the intermediate token symbol for display
          const intermediateToken = route.legs && route.legs.length > convergenceLegIndex
            ? route.legs[convergenceLegIndex].token?.symbol || 'tokens'
            : tokenIn.symbol;

          console.log(`         Route ${index + 1}: ${ethers.utils.formatUnits(amount, tokenIn.decimals)} ${tokenIn.symbol} → ${ethers.utils.formatUnits(intermediateAmount, tokenOut.decimals)} ${intermediateToken}`);
        }
      }

      // Sum all inputs that will hit the converging pool
      const totalIntermediateAmount = routeIntermediates.reduce(
        (sum, { amount }) => sum.add(amount),
        BigNumber.from(0)
      );

      if (totalIntermediateAmount.lte(0)) continue;

      // Calculate the converging leg output for the COMBINED input
      const referenceRoute = groupRoutes[0].route;
      const convergingLegOutput = await calculateSpecificLegOutput(
        referenceRoute,
        convergenceLegIndex,
        totalIntermediateAmount,
        tokenIn,
        tokenOut
      );

      // Now calculate the remaining legs for each route independently
      // Each route gets a proportional share of the converging leg output
      let groupTotalOutput = BigNumber.from(0);

      for (const { route, amount, index, convergenceLegIndex } of routeIntermediates) {
        if (amount.lte(0)) continue;

        // Calculate this route's proportional share of the converging leg output
        const routeShare = convergingLegOutput.mul(amount).div(totalIntermediateAmount);

        // Calculate from the converging leg output through the remaining legs
        const remainingLegsOutput = await calculateRemainingLegs(
          route,
          convergenceLegIndex + 1,
          routeShare,
          tokenIn,
          tokenOut
        );
        groupTotalOutput = groupTotalOutput.add(remainingLegsOutput);
      }

      if (displayDetails) {
        // Get intermediate token for display
        const intermediateToken = referenceRoute.legs && referenceRoute.legs.length > convergenceLegIndex
          ? referenceRoute.legs[convergenceLegIndex].token?.symbol || 'tokens'
          : tokenIn.symbol;

        console.log(`         ═══════════════════════════════════════`);
        console.log(`         Combined: ${ethers.utils.formatUnits(totalIntermediateAmount, tokenOut.decimals)} ${intermediateToken} → ${ethers.utils.formatUnits(groupTotalOutput, tokenOut.decimals)} ${tokenOut.symbol}`);
        console.log(`         (Compound slippage applied to ${poolKey})\n`);
      }

      totalOutput = totalOutput.add(groupTotalOutput);
    }
  }

  // Display final pool allocation summary (only when requested)
  if (displayDetails && convergenceGroups.length > 0) {
    console.log(`   📊 Final Pool Allocation Summary:`);

    // Group by pool and calculate totals
    const poolAllocations = new Map();

    poolGroups.forEach((groupRoutes, groupKey) => {
      const totalPercentage = groupRoutes.reduce((sum, r) => sum + r.percentage, 0);
      const numRoutes = groupRoutes.length;

      if (!groupKey.startsWith('independent-')) {
        const [poolKey, legPosition] = groupKey.split('@');
        const displayKey = legPosition ? `${poolKey} (${legPosition.replace('leg', 'Leg ')})` : poolKey;

        poolAllocations.set(displayKey, {
          percentage: totalPercentage,
          numRoutes: numRoutes
        });
      } else {
        // Count independent routes separately
        const independentKey = 'Independent Routes';
        if (!poolAllocations.has(independentKey)) {
          poolAllocations.set(independentKey, { percentage: 0, numRoutes: 0 });
        }
        const current = poolAllocations.get(independentKey);
        current.percentage += totalPercentage;
        current.numRoutes += numRoutes;
      }
    });

    // Sort by percentage (descending)
    const sorted = Array.from(poolAllocations.entries()).sort((a, b) => b[1].percentage - a[1].percentage);

    sorted.forEach(([displayKey, { percentage, numRoutes }]) => {
      if (displayKey === 'Independent Routes') {
        console.log(`      • ${displayKey}: ${(percentage * 100).toFixed(1)}% (${numRoutes} route${numRoutes > 1 ? 's' : ''})`);
      } else {
        console.log(`      • ${displayKey}: ${(percentage * 100).toFixed(1)}% (${numRoutes} routes converging)`);
      }
    });

    console.log(`      Total output: ${ethers.utils.formatUnits(totalOutput, tokenOut.decimals)} ${tokenOut.symbol}\n`);
  }

  return totalOutput;
}

/**
 * Calculate route up to (but not including) a specific leg index
 * Used to determine how much will hit the converging pool at that leg
 */
async function calculateRouteUpToSpecificLeg(route, amountIn, upToLegIndex, tokenIn, tokenOut) {
  try {
    // If upToLegIndex is 0, return input amount (no legs processed yet)
    if (upToLegIndex === 0) {
      return amountIn;
    }

    // For routes without legs or single-leg routes
    if (!route.legs || route.legs.length === 0 || upToLegIndex >= route.legs.length) {
      return amountIn;
    }

    let currentAmount = amountIn;

    // Process legs from 0 to upToLegIndex-1
    for (let i = 0; i < upToLegIndex; i++) {
      const leg = route.legs[i];

      if (leg.protocol === 'balancer' && leg.path) {
        currentAmount = await calculateBalancerRouteOutput(leg, currentAmount);

        // Handle WETH→ETH conversion if needed
        if (route.needsWETHToETHConversion && i === 0) {
          // 1:1 conversion, amount stays the same
        }
      } else if (leg.protocol === 'uniswap' && leg.trade) {
        currentAmount = await calculateUniswapRouteOutput(leg, currentAmount);
      } else if (leg.trades && leg.trades.length > 0) {
        const singleLeg = { ...leg, trade: leg.trades[0] };
        currentAmount = await calculateUniswapRouteOutput(singleLeg, currentAmount);
      }
    }

    return currentAmount;

  } catch (error) {
    console.error('   ❌ Error calculating route up to specific leg:', error.message);
    return BigNumber.from(0);
  }
}

/**
 * Calculate output of a specific leg with a given input amount
 */
async function calculateSpecificLegOutput(route, legIndex, inputAmount, tokenIn, tokenOut) {
  try {
    if (!route.legs || legIndex >= route.legs.length) {
      return BigNumber.from(0);
    }

    const leg = route.legs[legIndex];

    if (leg.protocol === 'balancer' && leg.path) {
      return await calculateBalancerRouteOutput(leg, inputAmount);
    } else if (leg.protocol === 'uniswap' && leg.trade) {
      return await calculateUniswapRouteOutput(leg, inputAmount);
    } else if (leg.trades && leg.trades.length > 0) {
      const singleLeg = { ...leg, trade: leg.trades[0] };
      return await calculateUniswapRouteOutput(singleLeg, inputAmount);
    }

    return BigNumber.from(0);

  } catch (error) {
    console.error('   ❌ Error calculating specific leg output:', error.message);
    return BigNumber.from(0);
  }
}

/**
 * Calculate remaining legs from a specific starting leg index
 */
async function calculateRemainingLegs(route, fromLegIndex, inputAmount, tokenIn, tokenOut) {
  try {
    // If no remaining legs, return input amount
    if (!route.legs || fromLegIndex >= route.legs.length) {
      return inputAmount;
    }

    let currentAmount = inputAmount;

    // Process remaining legs
    for (let i = fromLegIndex; i < route.legs.length; i++) {
      const leg = route.legs[i];

      if (leg.protocol === 'balancer' && leg.path) {
        currentAmount = await calculateBalancerRouteOutput(leg, currentAmount);
      } else if (leg.protocol === 'uniswap' && leg.trade) {
        currentAmount = await calculateUniswapRouteOutput(leg, currentAmount);
      } else if (leg.trades && leg.trades.length > 0) {
        const singleLeg = { ...leg, trade: leg.trades[0] };
        currentAmount = await calculateUniswapRouteOutput(singleLeg, currentAmount);
      }
    }

    return currentAmount;

  } catch (error) {
    console.error('   ❌ Error calculating remaining legs:', error.message);
    return BigNumber.from(0);
  }
}

/**
 * Calculate route up to (but not including) the final pool
 * Used to determine how much will hit the converging pool
 */
async function calculateRouteUpToFinalPool(route, amountIn, tokenIn, tokenOut) {
  try {
    // For single-protocol, single-hop routes, return the input (no intermediate hops)
    if (route.paths && route.paths.length === 1) {
      const path = route.paths[0];

      // Single hop = no intermediate calculation needed
      if (!route.legs || route.legs.length === 0) {
        return amountIn;
      }
    }

    // For multi-leg routes, calculate through all legs except the last
    if (route.legs && route.legs.length > 1) {
      let currentAmount = amountIn;

      // Process all legs except the last one
      for (let i = 0; i < route.legs.length - 1; i++) {
        const leg = route.legs[i];

        if (leg.protocol === 'balancer' && leg.path) {
          currentAmount = await calculateBalancerRouteOutput(leg, currentAmount);

          // Handle WETH→ETH conversion if needed
          if (route.needsWETHToETHConversion && i === 0) {
            // 1:1 conversion, amount stays the same
          }
        } else if (leg.protocol === 'uniswap' && leg.trade) {
          currentAmount = await calculateUniswapRouteOutput(leg, currentAmount);
        } else if (leg.trades && leg.trades.length > 0) {
          const singleLeg = { ...leg, trade: leg.trades[0] };
          currentAmount = await calculateUniswapRouteOutput(singleLeg, currentAmount);
        }
      }

      return currentAmount;
    }

    // Single-leg route: return input amount (will be used directly in final pool)
    return amountIn;

  } catch (error) {
    console.error('   ❌ Error calculating route up to final pool:', error.message);
    return BigNumber.from(0);
  }
}

/**
 * Calculate output of just the final pool with a given input amount
 * Used for compound slippage calculation when routes converge
 */
async function calculateFinalPoolOutput(referenceRoute, inputAmount, tokenIn, tokenOut) {
  try {
    // For routes with legs, use the last leg
    if (referenceRoute.legs && referenceRoute.legs.length > 0) {
      const lastLeg = referenceRoute.legs[referenceRoute.legs.length - 1];

      if (lastLeg.protocol === 'balancer' && lastLeg.path) {
        return await calculateBalancerRouteOutput(lastLeg, inputAmount);
      } else if (lastLeg.protocol === 'uniswap' && lastLeg.trade) {
        return await calculateUniswapRouteOutput(lastLeg, inputAmount);
      } else if (lastLeg.trades && lastLeg.trades.length > 0) {
        const singleLeg = { ...lastLeg, trade: lastLeg.trades[0] };
        return await calculateUniswapRouteOutput(singleLeg, inputAmount);
      }
    }

    // For single-hop routes, calculate directly
    if (referenceRoute.paths && referenceRoute.paths.length === 1) {
      const path = referenceRoute.paths[0];

      if (path.protocol === 'balancer' || referenceRoute.protocol === 'balancer') {
        return await calculateBalancerRouteOutput(path, inputAmount);
      } else if (path.protocol === 'uniswap' || referenceRoute.protocol === 'uniswap') {
        return await calculateUniswapRouteOutput(path, inputAmount);
      }
    }

    console.warn('   ⚠️  Could not determine final pool structure');
    return BigNumber.from(0);

  } catch (error) {
    console.error('   ❌ Error calculating final pool output:', error.message);
    return BigNumber.from(0);
  }
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

  // Explain why this minimizes arbitrage
  if (selected.arbitrageRisk < 0.5) {
    console.log(`   ✓ Well-distributed trade minimizes MEV opportunities`);
  } else if (selected.arbitrageRisk < 0.8) {
    console.log(`   ⚠ Moderate concentration, some arbitrage possible`);
  } else {
    console.log(`   ⚡ High concentration chosen for maximum output`);
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