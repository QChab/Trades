import { ethers, BigNumber } from 'ethers';
import { calculateSwapOutput } from './useBalancerV3.js';

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

  // CRITICAL: Balancer AMM math works in 18-decimal format!
  // GraphQL returns human-readable balances, so we:
  // 1. Parse with actual decimals to get raw wei amount
  // 2. Scale to 18-decimal normalized format

  const decimalsIn = tokenIn.decimals || 18;
  const decimalsOut = tokenOut.decimals || 18;

  let balanceIn, balanceOut;

  if (typeof balanceInValue === 'string' && balanceInValue.includes('.')) {
    const rawBalance = ethers.utils.parseUnits(balanceInValue, decimalsIn);
    if (decimalsIn < 18) {
      balanceIn = rawBalance.mul(BigNumber.from(10).pow(18 - decimalsIn));
    } else if (decimalsIn > 18) {
      balanceIn = rawBalance.div(BigNumber.from(10).pow(decimalsIn - 18));
    } else {
      balanceIn = rawBalance;
    }
  } else {
    balanceIn = BigNumber.from(balanceInValue);
  }

  if (typeof balanceOutValue === 'string' && balanceOutValue.includes('.')) {
    const rawBalance = ethers.utils.parseUnits(balanceOutValue, decimalsOut);
    if (decimalsOut < 18) {
      balanceOut = rawBalance.mul(BigNumber.from(10).pow(18 - decimalsOut));
    } else if (decimalsOut > 18) {
      balanceOut = rawBalance.div(BigNumber.from(10).pow(decimalsOut - 18));
    } else {
      balanceOut = rawBalance;
    }
  } else {
    balanceOut = BigNumber.from(balanceOutValue);
  }
  const weightIn = pool.weights?.[tokenInIndex] || 50;  // Use 50 for default 50/50 pools
  const weightOut = pool.weights?.[tokenOutIndex] || 50;
  const swapFee = pool.swapFee || '3000000000000000'; // 0.3%
  const poolType = pool.poolType || 'WeightedPool';
  const amplificationParameter = pool.amplificationParameter || null;

  // CRITICAL: Normalize amountIn to 18 decimals to match normalized balances!
  // The amountIn comes in actual token decimals, but calculateSwapOutput expects 18-decimal normalized values
  let amountInNormalized;
  if (decimalsIn < 18) {
    amountInNormalized = amountIn.mul(BigNumber.from(10).pow(18 - decimalsIn));
  } else if (decimalsIn > 18) {
    amountInNormalized = amountIn.div(BigNumber.from(10).pow(decimalsIn - 18));
  } else {
    amountInNormalized = amountIn;
  }

  // Use the exact calculation from useBalancerV3 which now includes exact power calculations
  const outputNormalized = calculateSwapOutput(
    amountInNormalized,  // Use normalized amount!
    balanceIn,
    balanceOut,
    swapFee,
    poolType,
    weightIn,
    weightOut,
    amplificationParameter
  );

  // Denormalize output to actual token decimals
  let finalOutput;
  if (decimalsOut < 18) {
    finalOutput = outputNormalized.div(BigNumber.from(10).pow(18 - decimalsOut));
  } else if (decimalsOut > 18) {
    finalOutput = outputNormalized.mul(BigNumber.from(10).pow(decimalsOut - 18));
  } else {
    finalOutput = outputNormalized;
  }

  return finalOutput;
}

export default {
  calculateBalancerExactOutput
};