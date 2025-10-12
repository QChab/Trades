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
  pools,
  tokensByAddresses,
  getTradesUniswapFn
}) {
  try {
    console.log('📊 Fetching Uniswap quote...');

    // Call the provided getTradesUniswap function
    const result = await getTradesUniswapFn(
      fromToken.address,
      toToken.address,
      amount
    );

    if (!result || result === 'no swap found' || result === 'outdated') {
      return null;
    }

    // Extract 100% trades
    const trades100 = result[100];
    if (!trades100 || !trades100.validTrades || trades100.validTrades.length === 0) {
      return null;
    }

    // Calculate gas estimate (120k base + 60k per hop)
    const gasEstimate = 120000 + (60000 * trades100.validTrades.length);

    return {
      protocol: 'Uniswap',
      outputAmount: trades100.totalBig,
      gasEstimate,
      trades: trades100.validTrades,
      rawData: result,
      totalHuman: trades100.totalHuman
    };

  } catch (error) {
    console.error('❌ Uniswap quote error:', error.message);
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
    console.log('📊 Fetching Balancer quote...');

    // Call the provided getTradesBalancer function
    const result = await getTradesBalancerFn(
      fromToken.address,
      toToken.address,
      amount,
      senderAddress,
      true // isForQuote
    );

    if (!result || !result.outputAmount) {
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
    console.error('❌ Balancer quote error:', error.message);
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
  provider
}) {
  try {
    console.log('📊 Fetching WalletBundler (cross-DEX) quote...');

    const mixedResult = await useMixedUniswapBalancer({
      tokenInObject: fromToken,
      tokenOutObject: toToken,
      amountIn: amount,
      provider: toRaw(provider),
      slippageTolerance: 0.5,
      maxHops: 3,
      useUniswap: true,
      useBalancer: true
    });

    if (!mixedResult || !mixedResult.bestRoute || !mixedResult.bestRoute.totalOutput) {
      return null;
    }

    const route = mixedResult.bestRoute;
    const gasEstimate = route.estimatedGas || 500000;

    return {
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
    };

  } catch (error) {
    console.error('❌ WalletBundler quote error:', error.message);
    return null;
  }
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
    console.log('📊 Fetching Odos quote...');

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

    return {
      protocol: 'Odos',
      outputAmount: quote.toTokenAmount,
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
 * Modes:
 * - undefined/null: All protocols (Uniswap, Balancer, WalletBundler, Odos)
 * - "contract": Only WalletBundler
 * - "odos": Only Odos (aggregator)
 * - "odos & contract": Odos and WalletBundler
 */
export function getAllowedProtocols(walletMode) {
  const mode = walletMode?.toLowerCase() || '';

  if (mode === 'contract') {
    return ['WalletBundler'];
  }

  if (mode === 'odos') {
    return ['Odos'];
  }

  if (mode.includes('odos') && mode.includes('contract')) {
    return ['WalletBundler', 'Odos'];
  }

  // Default: All 4 protocols for redundancy
  return ['Uniswap', 'Balancer', 'WalletBundler', 'Odos'];
}

/**
 * Get quotes from all allowed protocols in parallel
 * Returns array of quote results (nulls filtered out)
 */
export async function getAllQuotes({
  fromToken,
  toToken,
  amount,
  senderAddress,
  walletMode,
  provider,
  pools,
  tokensByAddresses,
  getTradesUniswapFn,
  getTradesBalancerFn
}) {
  const allowedProtocols = getAllowedProtocols(walletMode);
  console.log(`🔍 Querying protocols: ${allowedProtocols.join(', ')}`);

  const quotePromises = [];

  if (allowedProtocols.includes('Uniswap') && getTradesUniswapFn) {
    quotePromises.push(
      getQuoteUniswap({
        fromToken,
        toToken,
        amount,
        pools,
        tokensByAddresses,
        getTradesUniswapFn
      })
    );
  }

  if (allowedProtocols.includes('Balancer') && getTradesBalancerFn) {
    quotePromises.push(
      getQuoteBalancer({
        fromToken,
        toToken,
        amount,
        senderAddress,
        provider,
        getTradesBalancerFn
      })
    );
  }

  if (allowedProtocols.includes('WalletBundler')) {
    quotePromises.push(
      getQuoteWalletBundler({ fromToken, toToken, amount, provider })
    );
  }

  if (allowedProtocols.includes('Odos')) {
    quotePromises.push(
      getQuoteOdos({ fromToken, toToken, amount, senderAddress })
    );
  }

  // Execute all queries in parallel
  const results = await Promise.allSettled(quotePromises);

  // Extract successful results
  const quotes = results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);

  console.log(`✅ Received ${quotes.length} valid quotes from ${allowedProtocols.length} protocols`);

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
 */
function calculateGasCostInToken(gasEstimate, toToken, ethPrice, gasPrice) {
  if (!gasEstimate || !ethPrice || !gasPrice || !toToken.price) {
    return BigNumber.from(0);
  }

  // Gas cost in ETH = gasEstimate * gasPrice / 1e18
  // Gas cost in USD = gasCostInEth * ethPrice
  // Gas cost in output token = gasCostInUSD / tokenPrice * 10^decimals
  const gasCostWei = BigNumber.from(gasEstimate).mul(BigNumber.from(gasPrice));
  const gasCostEth = Number(ethers.utils.formatEther(gasCostWei));
  const gasCostUsd = gasCostEth * ethPrice;
  const gasCostInToken = (gasCostUsd / toToken.price) * Math.pow(10, toToken.decimals);

  return BigNumber.from(Math.ceil(gasCostInToken));
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
