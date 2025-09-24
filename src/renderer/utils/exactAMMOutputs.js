import { ethers, BigNumber } from 'ethers';
import { calculateSwapOutput } from './useBalancerV3.js';

/**
 * Calculate exact output for Uniswap V4 pool
 */
export async function calculateUniswapExactOutput(amountIn, pool, tokenInSymbol, tokenOutSymbol) {
  try {
    // The pool has currency0/currency1, not token0/token1
    // We need to create a proper CurrencyAmount for the input
    
    // Import needed classes
    const { CurrencyAmount, Token } = await import('@uniswap/sdk-core');
    
    const token0Symbol = pool.token0?.symbol || pool.currency0?.symbol || 'unknown';
    const token1Symbol = pool.token1?.symbol || pool.currency1?.symbol || 'unknown';
    
    // Determine which token we're swapping from
    let inputCurrency, outputCurrency;
    
    if (token0Symbol === tokenInSymbol || (tokenInSymbol === 'ETH' && token0Symbol === 'WETH') || (tokenInSymbol === 'WETH' && token0Symbol === 'ETH')) {
      // Swapping token0 -> token1
      inputCurrency = pool.token0 || pool.currency0;
      outputCurrency = pool.token1 || pool.currency1;
    } else if (token1Symbol === tokenInSymbol || (tokenInSymbol === 'ETH' && token1Symbol === 'WETH') || (tokenInSymbol === 'WETH' && token1Symbol === 'ETH')) {
      // Swapping token1 -> token0 (reverse direction)
      inputCurrency = pool.token1 || pool.currency1;
      outputCurrency = pool.token0 || pool.currency0;
    } else {
      throw new Error(`Token ${tokenInSymbol} not found in pool (${token0Symbol}/${token1Symbol})`);
    }
    
    if (!inputCurrency) {
      throw new Error('Pool missing currency information');
    }
    
    // Create a CurrencyAmount from the input
    const inputAmount = CurrencyAmount.fromRawAmount(
      inputCurrency,
      amountIn.toString()
    );
    
    // Call getOutputAmount with the proper CurrencyAmount
    // getOutputAmount doesn't take a direction parameter - it figures it out from the input token
    const result = await pool.getOutputAmount(inputAmount);
    
    // Debug the output
    const outputStr = result[0].quotient.toString();
    console.log('   Output:', ethers.utils.formatUnits(outputStr, outputCurrency?.decimals || 18), outputCurrency?.symbol || '');
    
    // Return the output amount as a BigNumber string
    return outputStr;
  } catch (error) {
    console.error('Error calculating Uniswap output:', error);
    console.log('   Falling back to approximation');
    // Fallback to approximation
    return amountIn.mul(997).div(1000); // 0.3% fee approximation
  }
}


/**
 * Calculate exact output for Balancer pool using the calculateSwapOutput from useBalancerV3
 * This reuses the exact calculation logic with power functions
 */
export function calculateBalancerExactOutput(amountIn, pool, tokenInIndex, tokenOutIndex) {
  const tokenIn = pool.tokens[tokenInIndex];
  const tokenOut = pool.tokens[tokenOutIndex];

  if (!tokenIn || !tokenOut) {
    return BigNumber.from(0);
  }

  // Handle balance that might be a decimal string
  const balanceInValue = tokenIn.balanceRaw || tokenIn.balance;
  const balanceOutValue = tokenOut.balanceRaw || tokenOut.balance;

  const balanceIn = typeof balanceInValue === 'string' && balanceInValue.includes('.')
    ? ethers.utils.parseEther(balanceInValue)
    : BigNumber.from(balanceInValue);

  const balanceOut = typeof balanceOutValue === 'string' && balanceOutValue.includes('.')
    ? ethers.utils.parseEther(balanceOutValue)
    : BigNumber.from(balanceOutValue);
  const weightIn = pool.weights?.[tokenInIndex] || 50;  // Use 50 for default 50/50 pools
  const weightOut = pool.weights?.[tokenOutIndex] || 50;
  const swapFee = pool.swapFee || '3000000000000000'; // 0.3%
  const poolType = pool.poolType || 'WeightedPool';
  const amplificationParameter = pool.amplificationParameter || null;

  // Use the exact calculation from useBalancerV3 which now includes exact power calculations
  return calculateSwapOutput(
    amountIn,
    balanceIn,
    balanceOut,
    swapFee,
    poolType,
    weightIn,
    weightOut,
    amplificationParameter
  );
}

export default {
  calculateUniswapExactOutput,
  calculateBalancerExactOutput
};