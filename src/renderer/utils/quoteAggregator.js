import { ethers, BigNumber } from 'ethers';
import { useMixedUniswapBalancer } from './useMixedUniswapBalancer.js';
import { getOdosQuote } from './useOdos.js';
import { toRaw } from 'vue';

/**
 * Quote Aggregator - Standardized interface for all DEX protocols
 *
 * This module provides a unified interface for querying quotes across:
 * - Uniswap V4 (direct DEX)
 * - Balancer V3 (direct DEX)
 * - WalletBundler (cross-DEX optimization via smart contract)
 * - Odos (aggregator API)
 *
 * All methods return a standardized response format:
 * {
 *   protocol: string,           // Protocol identifier
 *   outputAmount: BigNumber,    // Expected output tokens (raw)
 *   gasEstimate: number,        // Estimated gas for execution
 *   trades: any,                // Protocol-specific trade data
 *   rawData: any                // Original response for execution
 * }
 */

/**
 * Get quote from Uniswap V4
 * Queries with 100% of input amount only (no percentage splits)
 *
 * NOTE: This function needs getTradesUniswap to be passed as a parameter
 * since it's defined inline in ManualTrading.vue
 */
export async function getQuoteUniswap({
  fromToken,
  toToken,
  amount,
  uniswapPools,
  tokensByAddresses,
  getTradesUniswapFn
}) {
  try {
    // Call the provided getTradesUniswap function with pools
    const result = await getTradesUniswapFn(
      fromToken.address,
      toToken.address,
      amount,
      uniswapPools // Pass the pre-fetched pools
    );
    
    if (!result || result === 'no swap found' || result === 'outdated') {
      console.log(`  ⚠️ Uniswap: No valid result (${result})`);
      return null;
    }

    // Extract 100% trades
    const trades100 = result[100];

    if (!trades100 || !trades100.validTrades || trades100.validTrades.length === 0) {
      console.log(`  ⚠️ Uniswap: No valid trades in result[100]`);
      return null;
    }

    // Calculate gas estimate (110k base + 60k per hop)
    const gasEstimate = 80000 + (60000 * trades100.validTrades.length);

    return {
      protocol: 'Uniswap',
      outputAmount: trades100.totalBig,
      gasEstimate,
      trades: trades100.validTrades,
      rawData: result,
      totalHuman: trades100.totalHuman
    };

  } catch (error) {
    console.log(`  ⚠️ Uniswap quote error: ${error.message}`);
    return null;
  }
}

/**
 * Get quote from Balancer V3
 * Queries with 100% of input amount only
 *
 * NOTE: This function needs getTradesBalancer to be passed as a parameter
 * since it's defined inline in ManualTrading.vue
 */
export async function getQuoteBalancer({
  fromToken,
  toToken,
  amount,
  senderAddress,
  provider,
  getTradesBalancerFn
}) {
  try {
    // Call the provided getTradesBalancer function
    const result = await getTradesBalancerFn(
      fromToken.address,
      toToken.address,
      amount,
      senderAddress,
      true // isForQuote
    );

    if (!result || !result.outputAmount) {
      console.log(`  ⚠️ Balancer: No valid result`);
      return null;
    }

    return {
      protocol: 'Balancer',
      outputAmount: BigNumber.from(result.outputAmount),
      gasEstimate: result.gasLimit || 300000,
      trades: [{
        callData: result.callData,
        outputAmount: result.outputAmount,
        value: result.value,
        contractAddress: result.contractAddress
      }],
      rawData: result
    };

  } catch (error) {
    console.log(`  ⚠️ Balancer quote error: ${error.message}`);
    return null;
  }
}

/**
 * Get quote from WalletBundler (cross-DEX optimization)
 * Uses useMixedUniswapBalancer for optimal routing across Uniswap + Balancer
 */
export async function getQuoteWalletBundler({
  fromToken,
  toToken,
  amount,
  provider,
  uniswapPools
}) {
  try {
    const mixedResult = await useMixedUniswapBalancer({
      tokenInObject: fromToken,
      tokenOutObject: toToken,
      amountIn: amount,
      provider: toRaw(provider),
      uniswapPools,
      slippageTolerance: 0.6,
      useUniswap: true,
      useBalancer: true
    });

    if (!mixedResult || !mixedResult.bestRoute || !mixedResult.bestRoute.totalOutput) {
      return { error: null, result: null };
    }

    const route = mixedResult.bestRoute;

    // Calculate dynamic gas estimate based on route composition
    // Base: 50k, Uniswap pool: +100k, Balancer pool: +200k
    const gasEstimate = calculateWalletBundlerGas(route);

    return {
      error: null,
      result: {
        protocol: 'WalletBundler',
        outputAmount: route.totalOutput,
        gasEstimate,
        trades: [{
          route: route,
          executionPlan: mixedResult.executionPlan,
          outputAmount: route.totalOutput,
          isMixed: true
        }],
        rawData: mixedResult,
        splits: route.splits // Keep split info for display
      }
    };

  } catch (error) {
    console.error('❌ WalletBundler quote error:', error.message);

    // Check if it's a rate limit error
    const errorMsg = error.message?.toLowerCase() || '';
    if (errorMsg.includes('rate limit') || errorMsg.includes('429')) {
      return { error: 429, result: null };
    }

    return { error: null, result: null };
  }
}

/**
 * Calculate gas estimate for WalletBundler based on route composition
 * Formula: 50k base + 100k per Uniswap pool + 200k per Balancer pool
 */
function calculateWalletBundlerGas(route) {
  const BASE_GAS = 80000;
  const UNISWAP_POOL_GAS = 100000;
  const BALANCER_POOL_GAS = 180000;

  let uniswapPools = 0;
  let balancerPools = 0;

  // Use poolExecutionStructure if available (optimized routes)
  // This contains only the pools that will actually be executed, not all evaluated pools
  if (route.poolExecutionStructure && route.poolExecutionStructure.levels) {
    route.poolExecutionStructure.levels.forEach(level => {
      level.pools.forEach(pool => {
        if (pool.protocol === 'uniswap') {
          uniswapPools += 1;
        } else if (pool.protocol === 'balancer') {
          balancerPools += 1;
        }
      });
    });
  }
  // Fallback: check if route has paths array (single path routes)
  else if (route.paths && Array.isArray(route.paths)) {
    route.paths.forEach(path => {
      if (path.protocol === 'uniswap') {
        uniswapPools += 1;
      } else if (path.protocol === 'balancer') {
        if (path.path && path.path.hops) {
          balancerPools += path.path.hops.length;
        } else {
          balancerPools += 1;
        }
      }
    });
  }

  let gasEstimate = BASE_GAS + (uniswapPools * UNISWAP_POOL_GAS) + (balancerPools * BALANCER_POOL_GAS);
  
  if (balancerPools >= 1 && uniswapPools >= 1) {
    gasEstimate = gasEstimate * 0.3; // we decrease because the goal is to favorize more pools to avoid arbitrage
  }

  console.log(`  ⛽ Gas estimate: ${gasEstimate} (base: ${BASE_GAS} + ${uniswapPools} Uniswap pools + ${balancerPools} Balancer pools)`);

  return gasEstimate;
}

/**
 * Get quote from Odos aggregator
 * Queries Odos API for best cross-DEX route
 */
export async function getQuoteOdos({
  fromToken,
  toToken,
  amount,
  senderAddress
}) {
  try {
    const quote = await getOdosQuote({
      fromToken,
      toToken,
      amount,
      userAddr: senderAddress,
      chainId: 1,
      slippageLimitPercent: 0.5,
      disableRFQs: true,
      compact: true
    });

    if (!quote || !quote.toTokenAmount) {
      return null;
    }

    // Apply 0.15% Odos protocol fee deduction
    const ODOS_FEE_BPS = 15; // 0.15% = 15 basis points
    const outputAmountAfterFee = quote.toTokenAmount
      .mul(10000 - ODOS_FEE_BPS)
      .div(10000);

    const feeAmount = quote.toTokenAmount.sub(outputAmountAfterFee);

    return {
      protocol: 'Odos',
      outputAmount: outputAmountAfterFee,
      gasEstimate: quote.estimatedGas || 300000,
      trades: [quote],
      rawData: quote,
      pathId: quote.pathId, // Needed for execution
      priceImpact: quote.priceImpact
    };

  } catch (error) {
    console.error('❌ Odos quote error:', error.message);
    return null;
  }
}

/**
 * Determine which protocols are allowed based on wallet mode
 *
 * IMPORTANT: Uniswap and Balancer are ALWAYS queried for redundancy and comparison.
 * The wallet mode only adds additional aggregator protocols on top.
 *
 * Modes:
 * - undefined/null: Base protocols (just 2)
 * - "contract": Base protocols + WalletBundler (Uniswap, Balancer, WalletBundler)
 * - "odos": Base protocols + Odos (Uniswap, Balancer, Odos)
 * - "odos & contract": All 4 protocols (Uniswap, Balancer, WalletBundler, Odos)
 */
export function getAllowedProtocols(walletMode) {
  const mode = walletMode?.toLowerCase() || '';

  // Always include base protocols
  const baseProtocols = ['Uniswap', 'Balancer'];

  if (mode === 'contract') {
    return [...baseProtocols, 'WalletBundler'];
  }

  if (mode === 'odos') {
    return [...baseProtocols, 'Odos'];
  }

  if (mode.includes('odos') && mode.includes('contract')) {
    return [...baseProtocols, 'WalletBundler', 'Odos'];
  }

  // Default: All 4 protocols for redundancy
  return baseProtocols;
}

/**
 * Wraps a promise with a timeout
 * Returns null if the promise doesn't resolve within the timeout period
 */
function withTimeout(promise, timeoutMs, protocolName, shouldThrow) {
  const timeoutPromise = new Promise((resolve, reject) => {
    setTimeout(() => {
      if (shouldThrow) 
        return reject('Quote on contract took too long, please trigger another quote. First usages are slower as we cache the Balancer pools.');

      resolve(null);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Get quotes from all allowed protocols in parallel
 * Returns array of quote results (nulls filtered out)
 * Each protocol has 30 seconds to respond before timing out
 */
export async function getAllQuotes({
  fromToken,
  toToken,
  amount,
  senderAddress,
  walletMode,
  provider,
  uniswapPools,
  tokensByAddresses,
  getTradesUniswapFn,
  getTradesBalancerFn
}) {
  const allowedProtocols = getAllowedProtocols(walletMode);
  console.log(`🔍 Querying protocols: ${allowedProtocols.join(', ')}`);

  const TIMEOUT_MS = 10000; // 30 seconds
  const quotePromises = [];
  const queriedProtocols = []; // Track which protocols are actually queried

  if (allowedProtocols.includes('Uniswap') && getTradesUniswapFn) {
    queriedProtocols.push('Uniswap');
    quotePromises.push(
      withTimeout(
        getQuoteUniswap({
          fromToken,
          toToken,
          amount,
          uniswapPools,
          tokensByAddresses,
          getTradesUniswapFn
        }),
        TIMEOUT_MS,
        'Uniswap'
      )
    );
  } else if (allowedProtocols.includes('Uniswap')) {
    console.log(`  ⚠️ Uniswap: Skipped (getTradesUniswapFn not provided)`);
  }

  if (allowedProtocols.includes('Balancer') && getTradesBalancerFn) {
    queriedProtocols.push('Balancer');
    quotePromises.push(
      withTimeout(
        getQuoteBalancer({
          fromToken,
          toToken,
          amount,
          senderAddress,
          provider,
          getTradesBalancerFn
        }),
        TIMEOUT_MS,
        'Balancer'
      )
    );
  } else if (allowedProtocols.includes('Balancer')) {
    console.log(`  ⚠️ Balancer: Skipped (getTradesBalancerFn not provided)`);
  }

  if (allowedProtocols.includes('WalletBundler')) {
    queriedProtocols.push('WalletBundler');
    quotePromises.push(
      withTimeout(
        getQuoteWalletBundler({
          fromToken,
          toToken,
          amount,
          provider,
          uniswapPools
        }),
        TIMEOUT_MS * 12,
        'WalletBundler',
        true
      )
    );
  }

  if (allowedProtocols.includes('Odos')) {
    queriedProtocols.push('Odos');
    quotePromises.push(
      withTimeout(
        getQuoteOdos({ fromToken, toToken, amount, senderAddress }),
        TIMEOUT_MS,
        'Odos'
      )
    );
  }

  console.log(`📡 Actually querying: ${queriedProtocols.join(', ')}`);

  // Execute all queries in parallel with timeout protection
  const results = await Promise.allSettled(quotePromises);

  // Log detailed results for debugging (using correct protocol names)
  console.log('📊 Quote results:');
  results.forEach((result, index) => {
    const protocolName = queriedProtocols[index]; // Use queriedProtocols, not allowedProtocols
    if (result.status === 'fulfilled') {
      // Check if this is WalletBundler with error response
      if (protocolName === 'WalletBundler' && result.value && result.value.error === 429) {
        throw new Error('⚠️ Rate limit error on the RPC when quoting WalletBundler due to massive pools caching');
      }

      // Handle WalletBundler's {error, result} format
      if (protocolName === 'WalletBundler') {
        if (result.value && result.value.result !== null) {
          console.log(`  ✅ ${protocolName}: Quote received`);
        } else {
          console.log(`  ⚠️ ${protocolName}: Returned null (failed or timed out)`);
        }
      } else {
        // Handle other protocols
        if (result.value !== null) {
          console.log(`  ✅ ${protocolName}: Quote received`);
        } else {
          console.log(`  ⚠️ ${protocolName}: Returned null (failed or timed out)`);
        }
      }
    } else {
      if (protocolName === 'WalletBundler') {
        throw new Error(result?.reason || 'ERROR IN CONTRACT, QUOTE TOOK TOO LONG, PLEASE TRY AGAIN');
      }

      console.error(`  ❌ ${protocolName}: Promise rejected - ${result.reason?.message || result.reason}`);
    }
  });

  // Extract successful results
  const quotes = results
    .map((r, index) => {
      if (r.status !== 'fulfilled') return null;

      const protocolName = queriedProtocols[index];

      // Handle WalletBundler's {error, result} format
      if (protocolName === 'WalletBundler') {
        if (r.value && r.value.result !== null) {
          return r.value.result;
        }
        return null;
      }

      // Handle other protocols (return value directly)
      return r.value;
    })
    .filter(quote => quote !== null);

  console.log(`✅ Received ${quotes.length} valid quotes from ${queriedProtocols.length} queried protocols`);

  return quotes;
}

/**
 * Select the best quote from multiple quotes
 * Accounts for gas costs to determine true net output
 */
export function selectBestQuote(quotes, toToken, ethPrice, gasPrice) {
  if (!quotes || quotes.length === 0) {
    return null;
  }

  let bestQuote = null;
  let bestNetOutput = BigNumber.from(0);
  let bestNegativeOutput = null; // Track least bad option if all unprofitable

  for (const quote of quotes) {
    // Calculate gas cost in output token
    const gasCostInOutputToken = calculateGasCostInToken(
      quote.gasEstimate,
      toToken,
      ethPrice,
      gasPrice
    );

    // Calculate net output (output - gas cost)
    let netOutput;
    let negativeOutput = null;

    if (quote.outputAmount.gte(gasCostInOutputToken)) {
      netOutput = quote.outputAmount.sub(gasCostInOutputToken);
    } else {
      // Trade is unprofitable - track negative amount
      negativeOutput = gasCostInOutputToken.sub(quote.outputAmount);
      netOutput = BigNumber.from(0);
    }

    console.log(`${quote.protocol}: ${ethers.utils.formatUnits(quote.outputAmount, toToken.decimals)} - gas ≈ ${ethers.utils.formatUnits(netOutput, toToken.decimals)}`);

    // Compare quotes
    if (netOutput.gt(bestNetOutput)) {
      bestQuote = quote;
      bestNetOutput = netOutput;
      bestNegativeOutput = null;
    } else if (netOutput.eq(0) && bestNetOutput.eq(0)) {
      // Both unprofitable - choose less negative
      if (!bestNegativeOutput || (negativeOutput && negativeOutput.lt(bestNegativeOutput))) {
        bestQuote = quote;
        bestNegativeOutput = negativeOutput;
      }
    }
  }

  if (bestQuote) {
    console.log(`🏆 Best quote: ${bestQuote.protocol}`);
  }

  return bestQuote;
}

/**
 * Calculate gas cost in terms of output token
 * Uses BigNumber arithmetic to avoid overflow with high-decimal tokens
 */
function calculateGasCostInToken(gasEstimate, toToken, ethPrice, gasPrice) {
  if (!gasEstimate || !ethPrice || !gasPrice || !toToken.price) {
    console.warn(`⚠️ Missing parameters for gas calculation:`, {
      hasGasEstimate: !!gasEstimate,
      hasEthPrice: !!ethPrice,
      hasGasPrice: !!gasPrice,
      hasTokenPrice: !!toToken.price
    });
    return BigNumber.from(0);
  }

  try {
    // Gas cost in wei = gasEstimate * gasPrice
    const gasCostWei = BigNumber.from(gasEstimate).mul(BigNumber.from(gasPrice));

    // Scale prices to avoid floating point
    const ethPriceScaled = Math.floor(ethPrice * 1e6); // Scale ETH price to integer
    const tokenPriceScaled = Math.floor(toToken.price * 1e6); // Scale token price to integer

    if (tokenPriceScaled === 0) {
      console.warn('Token price is zero, cannot calculate gas cost');
      return BigNumber.from(0);
    }

    // Calculate gas cost in output token using one formula to avoid precision loss
    // Formula: gasCostInToken = (gasCostWei * ethPrice * 10^decimals) / (1e18 * tokenPrice)
    // With scaling: = (gasCostWei * ethPriceScaled * 10^decimals) / (tokenPriceScaled * 1e18)
    // Note: The 1e6 scaling factors cancel out (both numerator and denominator have 1e6)

    const decimalsMultiplier = BigNumber.from(10).pow(toToken.decimals);

    // Numerator = gasCostWei * ethPriceScaled * decimalsMultiplier
    const numerator = gasCostWei
      .mul(BigNumber.from(ethPriceScaled))
      .mul(decimalsMultiplier);

    // Denominator = tokenPriceScaled * 1e18 (wei conversion only, scaling factors cancel)
    const denominator = BigNumber.from(tokenPriceScaled)
      .mul(BigNumber.from('1000000000000000000')); // 1e18

    const gasCostInToken = numerator.div(denominator);

    console.log(`   Gas cost: ${ethers.utils.formatUnits(gasCostInToken, toToken.decimals)} ${toToken.symbol}`);

    return gasCostInToken;
  } catch (error) {
    console.error('Error calculating gas cost in token:', error);
    return BigNumber.from(0);
  }
}

export default {
  getQuoteUniswap,
  getQuoteBalancer,
  getQuoteWalletBundler,
  getQuoteOdos,
  getAllowedProtocols,
  getAllQuotes,
  selectBestQuote
};
