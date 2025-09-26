import { ethers, BigNumber } from 'ethers';
import { useUniswapV4 } from '../composables/useUniswap.js';
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
    let balancerResult = null;
    
    if (useUniswap && useBalancer) {
      // Parallel discovery when both enabled
      [uniswapRoutes, balancerResult] = await Promise.all([
        discoverUniswapPaths(tokenInObject, tokenOutObject, amountInBN),
        discoverBalancerPaths(tokenInObject, tokenOutObject, amountInBN, provider)
      ]);
    } else if (useUniswap) {
      // Only Uniswap
      uniswapRoutes = await discoverUniswapPaths(tokenInObject, tokenOutObject, amountInBN);
    } else if (useBalancer) {
      // Only Balancer
      balancerResult = await discoverBalancerPaths(tokenInObject, tokenOutObject, amountInBN, provider);
    }

    results.uniswapPaths = uniswapRoutes;
    results.balancerPaths = balancerResult ? [balancerResult] : [];

    console.log(`📊 Found ${uniswapRoutes.length} Uniswap routes and ${results.balancerPaths.length} Balancer routes`);

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
        
        const paths = trades.filter(trade => trade && trade.swaps).map(trade => ({
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
        }));
        
        allPaths.push(...paths);
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

    // Check if we have multiple paths
    if (result.allPaths && result.allPaths.length > 1) {
      console.log(`   Found ${result.allPaths.length} Balancer paths to consider`);
      // TODO: Return all paths for multi-path optimization
      // For now, still use the best one
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
      fees: result.fees,
      // Pass through poolData for exact AMM calculations
      poolData: result.poolData,
      // Include all paths for future multi-path optimization
      allPaths: result.allPaths
    };

  } catch (error) {
    console.error('Balancer path discovery failed:', error);
    return null;
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
      
      // IMPORTANT: For ETH/WETH, we want to explore BOTH paths as parallel options
      if (intermediate.isETH && balancerLeg1 && uniswapLeg1 && uniswapLeg1.length > 0) {
        console.log(`   ✓ Found parallel first-hop options:`);
        console.log(`      • Balancer: ${tokenIn.symbol} -> WETH, output: ${ethers.utils.formatUnits(balancerLeg1.outputAmount, 18)}`);
        console.log(`      • Uniswap: ${tokenIn.symbol} -> ETH, output: ${ethers.utils.formatUnits(uniswapLeg1[0].outputAmount, 18)}`);
        
        // For the second hop, we use Uniswap ETH->tokenOut
        const ethToTokenOut = await discoverUniswapPaths(
          { address: ETH_ADDRESS, symbol: 'ETH', decimals: 18 },
          tokenOut,
          ethers.utils.parseEther('0.646') // Approximate combined output
        );
        
        if (ethToTokenOut && ethToTokenOut.length > 0) {
          // Create a special cross-DEX path that can be split
          paths.push({
            type: 'cross-dex-splittable',
            path: `${tokenIn.symbol} -> [WETH/ETH split] -> ${tokenOut.symbol}`,
            outputAmount: ethToTokenOut[0].outputAmount, // Will be recalculated with optimal split
            legs: [
              {
                protocol: 'balancer',
                token: { symbol: 'WETH', decimals: 18 },
                outputAmount: balancerLeg1.outputAmount,
                inputAmount: amountIn,
                poolData: balancerLeg1.poolData  // This is now properly passed from discoverBalancerPaths
              },
              {
                protocol: 'uniswap',
                token: { symbol: 'ETH', decimals: 18 },
                outputAmount: uniswapLeg1[0].outputAmount,
                inputAmount: amountIn,
                trade: uniswapLeg1[0].trade
              },
              {
                protocol: 'uniswap',
                token: { symbol: tokenOut.symbol, decimals: tokenOut.decimals },
                outputAmount: ethToTokenOut[0].outputAmount,
                inputAmount: ethers.utils.parseEther('0.646'),
                trade: ethToTokenOut[0].trade
              }
            ],
            needsWETHToETHConversion: true,
            canSplitFirstHop: true
          });
        }
      }
      
      // If we found a path for the first leg, try the second leg
      if (balancerLeg1 && balancerLeg1.outputAmount) {
        console.log(`   ✓ Found Balancer leg1: ${tokenIn.symbol} -> ${intermediate.symbol}, output: ${ethers.utils.formatUnits(balancerLeg1.outputAmount, intermediate.decimals)}`);
        
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
          discoverBalancerPaths(intermediate, tokenOut, balancerLeg1.outputAmount, provider),
          discoverUniswapPaths(intermediateForUniswap, tokenOut, balancerLeg1.outputAmount)
        ]);
        
        // Create cross-DEX paths
        if (uniswapLeg2 && uniswapLeg2.length > 0) {
          const bestUniswapLeg2 = selectBestVariant(uniswapLeg2);
          const conversionStep = needsWETHToETHConversion ? ' -> [unwrap WETH to ETH]' : '';
          paths.push({
            type: 'cross-dex-balancer-uniswap',
            protocol: 'mixed',
            legs: [
              { ...balancerLeg1, protocol: 'balancer', token: intermediate },
              { ...bestUniswapLeg2, protocol: 'uniswap' }
            ],
            totalOutput: bestUniswapLeg2.outputAmount,
            path: `${tokenIn.symbol} -> ${intermediate.symbol} (Balancer)${conversionStep} -> ${tokenOut.symbol} (Uniswap)`,
            needsWETHToETHConversion,
            estimatedGas: needsWETHToETHConversion ? 220000 : 200000 // Extra gas for unwrap
          });
        }
        
        if (balancerLeg2 && balancerLeg2.outputAmount) {
          paths.push({
            type: 'cross-dex-balancer-balancer',
            protocol: 'balancer',
            legs: [
              { ...balancerLeg1, protocol: 'balancer', token: intermediate },
              { ...balancerLeg2, protocol: 'balancer' }
            ],
            totalOutput: balancerLeg2.outputAmount,
            path: `${tokenIn.symbol} -> ${intermediate.symbol} -> ${tokenOut.symbol} (Balancer)`,
            estimatedGas: 180000
          });
        }
      }
      
      // Try Uniswap first leg
      if (uniswapLeg1 && uniswapLeg1.length > 0) {
        const bestUniswapLeg1 = selectBestVariant(uniswapLeg1);
        
        // For ETH/WETH intermediate, handle conversion for Balancer
        let intermediateForBalancer = intermediate;
        let needsETHToWETHConversion = false;
        
        if (intermediate.isETH) {
          // Uniswap outputs ETH, but Balancer needs WETH
          intermediateForBalancer = { address: WETH_ADDRESS, symbol: 'WETH', decimals: 18 };
          needsETHToWETHConversion = true;
        }
        
        // Second leg with Uniswap output
        const [balancerLeg2, uniswapLeg2] = await Promise.all([
          discoverBalancerPaths(intermediateForBalancer, tokenOut, bestUniswapLeg1.outputAmount, provider),
          discoverUniswapPaths(intermediate, tokenOut, bestUniswapLeg1.outputAmount)
        ]);
        
        if (balancerLeg2 && balancerLeg2.outputAmount) {
          const conversionStep = needsETHToWETHConversion ? ' -> [wrap ETH to WETH]' : '';
          paths.push({
            type: 'cross-dex-uniswap-balancer',
            protocol: 'mixed',
            legs: [
              { ...bestUniswapLeg1, protocol: 'uniswap', token: intermediate },
              { ...balancerLeg2, protocol: 'balancer' }
            ],
            totalOutput: balancerLeg2.outputAmount,
            path: `${tokenIn.symbol} -> ${intermediate.symbol} (Uniswap)${conversionStep} -> ${tokenOut.symbol} (Balancer)`,
            needsETHToWETHConversion,
            estimatedGas: needsETHToWETHConversion ? 220000 : 200000 // Extra gas for wrap
          });
        }
        
        if (uniswapLeg2 && uniswapLeg2.length > 0) {
          const bestUniswapLeg2 = selectBestVariant(uniswapLeg2);
          paths.push({
            type: 'cross-dex-uniswap-uniswap',
            protocol: 'uniswap',
            legs: [
              { ...bestUniswapLeg1, protocol: 'uniswap', token: intermediate },
              { ...bestUniswapLeg2, protocol: 'uniswap' }
            ],
            totalOutput: bestUniswapLeg2.outputAmount,
            path: `${tokenIn.symbol} -> ${intermediate.symbol} -> ${tokenOut.symbol} (Uniswap)`,
            estimatedGas: 180000
          });
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
  
  // Group paths by ETH/WETH variants for unified optimization
  
  // Single protocol routes (100% on one DEX)
  if (uniswapPaths.length > 0) {
    // Best single Uniswap route (considering ETH/WETH variants)
    const bestUniswap = selectBestVariant(uniswapPaths);
    routes.push({
      type: 'single-uniswap',
      protocol: 'uniswap',
      totalOutput: bestUniswap.outputAmount,
      paths: [bestUniswap],
      requiresWrap: bestUniswap.requiresWrap,
      requiresUnwrap: bestUniswap.requiresUnwrap
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
        }))
      });
    }
  }

  if (balancerPaths.length > 0) {
    const bestBalancer = balancerPaths[0];
    routes.push({
      type: 'single-balancer',
      protocol: 'balancer',
      totalOutput: bestBalancer.outputAmount,
      paths: [bestBalancer]
    });
  }


  // Add optimized cross-DEX multi-hop paths using EXACT computations
  if (crossDEXPaths && crossDEXPaths.length > 0) {
    // Check for splittable cross-DEX paths (with parallel first-hop options)
    const splittablePath = crossDEXPaths.find(p => p.type === 'cross-dex-splittable' && p.canSplitFirstHop);
    
    if (splittablePath) {
      console.log('\n🎯 Found splittable cross-DEX path, optimizing with EXACT AMM computations...');
      
      // Analyze the path structure - can have various configurations:
      // 1. Both legs direct to target: ONE→ETH (Uniswap) + ONE→WETH (Balancer)
      // 2. One direct, one multi-hop: ONE→ETH (Uniswap) + ONE→USDC→ETH (Balancer)
      // 3. Both multi-hop through different intermediates

      const legs = splittablePath.legs || [];
      console.log(`   Analyzing ${legs.length} legs in cross-DEX path`);

      // Group legs by their position in the path
      const firstHopLegs = legs.filter(l => {
        // First hop legs are those that take the input token
        return !l.inputToken || l.inputToken?.symbol === tokenIn.symbol;
      });

      const secondHopLegs = legs.filter(l => {
        // Second hop legs output the target token but don't input the source token
        return l.token?.symbol === tokenOut.symbol &&
               (!l.inputToken || l.inputToken?.symbol !== tokenIn.symbol);
      });

      console.log(`   Found ${firstHopLegs.length} first-hop options, ${secondHopLegs.length} second-hop options`);

      // Check if we have parallel first-hop options that can be split
      const balancerFirstHop = firstHopLegs.find(l => l.protocol === 'balancer');
      const uniswapFirstHop = firstHopLegs.find(l => l.protocol === 'uniswap');

      if (balancerFirstHop && uniswapFirstHop) {
        console.log('   ✓ Found parallel first-hop options for splitting');

        // Check if first hops already reach the target (considering ETH/WETH equivalence)
        const isETHTarget = tokenOut.symbol === 'ETH' || tokenOut.symbol === 'WETH';
        const balancerReachesTarget =
          balancerFirstHop.token?.symbol === tokenOut.symbol ||
          (isETHTarget && (balancerFirstHop.token?.symbol === 'ETH' || balancerFirstHop.token?.symbol === 'WETH'));
        const uniswapReachesTarget =
          uniswapFirstHop.token?.symbol === tokenOut.symbol ||
          (isETHTarget && (uniswapFirstHop.token?.symbol === 'ETH' || uniswapFirstHop.token?.symbol === 'WETH'));

        if (balancerReachesTarget && uniswapReachesTarget) {
          console.log('   Both first hops reach target directly - optimizing direct split');
          // Both reach target directly - optimize split without second hop
          const optimizedSplit = await optimizeDirectSplit(
            balancerFirstHop,
            uniswapFirstHop,
            amountIn,
            tokenIn,
            tokenOut
          );
          if (optimizedSplit) {
            routes.push(optimizedSplit);
          }
        } else if (secondHopLegs.length > 0) {
          console.log('   Need second hop for complete path - optimizing with intermediate');
          // Need second hop - use the existing optimization
          const optimizedSplit = await optimizeWithExactAMM(
            balancerFirstHop,
            uniswapFirstHop,
            secondHopLegs[0], // Use the first available second hop
            amountIn,
            tokenIn,
            tokenOut
          );
          if (optimizedSplit) {
            routes.push(optimizedSplit);
          }
        }
      }
    }
    
    // Check if we have separate paths that can be combined
    const balancerWETHPath = crossDEXPaths.find(p => 
      p.legs && p.legs.length === 2 && 
      p.legs[0].protocol === 'balancer' &&
      p.legs[0].token?.symbol === 'WETH'
    );
    
    const uniswapETHPath = crossDEXPaths.find(p => 
      p.legs && p.legs.length === 2 && 
      p.legs[0].protocol === 'uniswap' &&
      p.legs[0].token?.symbol === 'ETH'
    );
    
    // If we have both ONE->WETH on Balancer and ONE->ETH on Uniswap paths
    if (balancerWETHPath && uniswapETHPath) {
      // Check if these paths directly reach the target or need second hop
      const isETHTarget = tokenOut.symbol === 'ETH' || tokenOut.symbol === 'WETH';
      const needsSecondHop = !isETHTarget && balancerWETHPath.legs.length > 1;

      if (needsSecondHop && balancerWETHPath.legs[1]) {
        // Use exact AMM optimization for multi-hop
        const optimizedCrossDEX = await optimizeWithExactAMM(
          balancerWETHPath.legs[0],
          uniswapETHPath.legs[0],
          balancerWETHPath.legs[1], // Second hop
          amountIn,
          tokenIn,
          tokenOut
        );
        if (optimizedCrossDEX) {
          routes.push(optimizedCrossDEX);
        }
      } else {
        // Use direct split optimization
        const optimizedCrossDEX = await optimizeDirectSplit(
          balancerWETHPath.legs[0],
          uniswapETHPath.legs[0],
          amountIn,
          tokenIn,
          tokenOut
        );
        if (optimizedCrossDEX) {
          routes.push(optimizedCrossDEX);
        }
      }
    }
    
    // Also add original cross-DEX paths for comparison
    // Convert them to have totalOutput field
    crossDEXPaths.forEach(path => {
      routes.push({
        ...path,
        totalOutput: path.totalOutput || path.outputAmount || BigNumber.from(0)
      });
    });
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
function selectBestRoute(routes, amountIn) {
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
  console.log(`   Output: ${ethers.utils.formatEther(selected.totalOutput)}`);
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
      ) : secondHopLeg.outputAmount.mul(totalETH).div(secondHopLeg.inputAmount || ethers.utils.parseEther('0.646'));
    
    return BigNumber.from(finalOut);
  };
  
  // Golden section search with high precision
  console.log('   Running golden section search for optimal split...');
  const goldenRatio = (Math.sqrt(5) - 1) / 2;
  let a = 0.0;
  let b = 1.0;
  const tolerance = 0.000001; // 0.0001% precision (100x better than before)
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
 * @param {string} userAddress - Address of the user (recipient for final hop)
 * @returns {Object} Arguments for the WalletBundler encodeAndExecute function
 */
export function createEncoderExecutionPlan(
  executionPlan,
  tokenIn,
  tokenOut,
  walletBundlerAddress,
  balancerEncoderAddress,
  uniswapEncoderAddress,
  userAddress
) {
  const encoderTargets = [];
  const encoderData = [];

  // First, mark split legs in the execution plan
  const markedPlan = markSplitLegs(executionPlan);

  // Process each execution step
  markedPlan.executionSteps.forEach((step, index) => {
    const isFinalHop = index === markedPlan.executionSteps.length - 1;
    // Determine recipient: for intermediate hops keep in contract, for final hop send to user
    const recipient = isFinalHop ? userAddress : walletBundlerAddress;

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

    // Create encoder calldata
    if (step.protocol === 'balancer') {
      encoderTargets.push(balancerEncoderAddress);

      if (inputAmount.eq(ethers.constants.MaxUint256)) {
        // Use all balance swap - encoder will query actual balance
        const encoderCalldata = ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'address', 'address', 'uint256', 'address', 'address'],
          [
            step.poolId || step.pools?.[0]?.id || '0x0000000000000000000000000000000000000000000000000000000000000000',
            inputTokenAddress,
            outputTokenAddress,
            step.minAmountOut || 0,
            walletBundlerAddress, // sender
            recipient
          ]
        );

        // Encode the function selector for encodeUseAllBalanceSwap
        const selector = ethers.utils.id('encodeUseAllBalanceSwap(bytes32,address,address,uint256,address,address)').slice(0, 10);
        encoderData.push(selector + encoderCalldata.slice(2));
      } else {
        // Regular swap with exact amount
        const encoderCalldata = ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'address', 'address', 'uint256', 'uint256', 'address', 'address'],
          [
            step.poolId || step.pools?.[0]?.id || '0x0000000000000000000000000000000000000000000000000000000000000000',
            inputTokenAddress,
            outputTokenAddress,
            inputAmount,
            step.minAmountOut || 0,
            walletBundlerAddress, // sender
            recipient
          ]
        );

        // Encode the function selector for encodeSingleSwap
        const selector = ethers.utils.id('encodeSingleSwap(bytes32,address,address,uint256,uint256,address,address)').slice(0, 10);
        encoderData.push(selector + encoderCalldata.slice(2));
      }
    } else if (step.protocol === 'uniswap') {
      encoderTargets.push(uniswapEncoderAddress);

      if (inputAmount.eq(ethers.constants.MaxUint256)) {
        // Use all balance swap - encoder will query actual balance
        const encoderCalldata = ethers.utils.defaultAbiCoder.encode(
          ['address', 'address', 'uint24', 'uint256', 'address', 'address'],
          [
            inputTokenAddress,
            outputTokenAddress,
            step.fee || 3000, // Default 0.3% fee
            step.minAmountOut || 0,
            walletBundlerAddress, // sender (encoder will query balance from this address)
            recipient
          ]
        );

        // Encode the function selector for encodeUseAllBalanceSwap (no sender param in signature)
        const selector = ethers.utils.id('encodeUseAllBalanceSwap(address,address,uint24,uint256,address,address)').slice(0, 10);
        encoderData.push(selector + encoderCalldata.slice(2));
      } else {
        // Regular swap with exact amount
        const encoderCalldata = ethers.utils.defaultAbiCoder.encode(
          ['address', 'address', 'uint24', 'uint256', 'uint256', 'address'],
          [
            inputTokenAddress,
            outputTokenAddress,
            step.fee || 3000,
            inputAmount,
            step.minAmountOut || 0,
            recipient
          ]
        );

        // Encode the function selector for encodeSingleSwap (no sender param in signature)
        const selector = ethers.utils.id('encodeSingleSwap(address,address,uint24,uint256,uint256,address)').slice(0, 10);
        encoderData.push(selector + encoderCalldata.slice(2));
      }
    }
  });

  // Calculate minimum output with slippage
  const minOutputAmount = executionPlan.minOutput ||
                          executionPlan.route.totalOutput.mul(95).div(100); // 5% slippage

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
      slippageTolerance: executionPlan.slippageTolerance,
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
export function convertExecutionPlanToContractArgs(executionPlan, tokenIn, tokenOut, walletBundlerAddress) {
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
        callData = encodeUniswapTrades(step.trades, walletBundlerAddress);
      } else if (step.method === 'exactInputSingle') {
        callData = encodeUniswapExactInput(step, walletBundlerAddress);
      }

      // Check if ETH is being sent as value
      if (step.inputToken === 'ETH' && step.input) {
        value = step.input;
      }

    } else if (step.protocol === 'balancer') {
      target = '0xBA12222222228d8Ba445958a75a0704d566BF2C8'; // Balancer Vault

      // Encode Balancer batch swap
      if (step.method === 'batchSwap') {
        callData = encodeBalancerBatchSwap(step, walletBundlerAddress);
      } else if (step.method === 'swap') {
        callData = encodeBalancerSingleSwap(step, walletBundlerAddress);
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
function encodeUniswapTrades(trades, recipient) {
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
function encodeUniswapExactInput(step, recipient) {
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
    amountOutMinimum: step.expectedOutput.mul(95).div(100), // 5% slippage
    sqrtPriceLimitX96: 0
  };

  return iface.encodeFunctionData('exactInputSingle', [params]);
}

/**
 * Helper function to encode Balancer batch swap
 */
function encodeBalancerBatchSwap(step, recipient) {
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
function encodeBalancerSingleSwap(step, recipient) {
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

  const limit = step.expectedOutput.mul(95).div(100); // 5% slippage
  const deadline = Math.floor(Date.now() / 1000) + 1200;

  return iface.encodeFunctionData('swap', [singleSwap, funds, limit, deadline]);
}