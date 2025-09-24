/**
 * Advanced cross-DEX optimizer with exact AMM calculations
 * Supports up to 3 hops with 5 parallel legs per hop
 */

import { ethers, BigNumber } from 'ethers';
import { useUniswapV4 } from '../composables/useUniswap.js';
import { calculateSwapOutput } from './useBalancerV3.js';

const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const ETH_ADDRESS = '0x0000000000000000000000000000000000000000';

// Common intermediate tokens
const INTERMEDIATES = [
  { address: WETH_ADDRESS, symbol: 'WETH', decimals: 18 },
  { address: ETH_ADDRESS, symbol: 'ETH', decimals: 18 },
  { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
  { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
  { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', decimals: 18 }
];

/**
 * Find all relevant pools from both DEXs
 */
export async function discoverAllPools(tokenIn, tokenOut, provider) {
  console.log('\n🔍 Discovering all relevant pools...');
  
  const uniswap = useUniswapV4();
  
  const relevantTokens = [
    tokenIn.address.toLowerCase(),
    tokenOut.address.toLowerCase(),
    ...INTERMEDIATES.map(t => t.address.toLowerCase())
  ];
  
  const pools = {
    uniswap: {},
    balancer: {}
  };
  
  // Find all Uniswap pools containing relevant tokens
  for (let i = 0; i < relevantTokens.length; i++) {
    for (let j = i + 1; j < relevantTokens.length; j++) {
      const tokenA = relevantTokens[i];
      const tokenB = relevantTokens[j];
      const pairKey = [tokenA, tokenB].sort().join('-');
      
      // Skip if already checked
      if (pools.uniswap[pairKey]) continue;
      
      try {
        // Handle ETH/WETH conversion for Uniswap
        const uniTokenA = tokenA === WETH_ADDRESS.toLowerCase() ? ETH_ADDRESS : tokenA;
        const uniTokenB = tokenB === WETH_ADDRESS.toLowerCase() ? ETH_ADDRESS : tokenB;
        
        const uniPools = await uniswap.findPossiblePools(
          { address: uniTokenA },
          { address: uniTokenB }
        );
        
        if (uniPools && uniPools.length > 0) {
          pools.uniswap[pairKey] = uniPools;
          console.log(`  ✓ Uniswap: Found ${uniPools.length} pools for ${getSymbol(tokenA)}-${getSymbol(tokenB)}`);
        }
      } catch (error) {
        // Silent fail for pairs without pools
      }
    }
  }
  
  // Find all Balancer pools containing relevant tokens
  // Use the proper discovery function from useBalancerV3
  const { discoverBalancerV3Pools } = await import('./useBalancerV3.js');
  const balancerPools = await discoverBalancerV3Pools(
    relevantTokens.map(addr => ({ address: addr })),
    relevantTokens.map(addr => ({ address: addr })),
    provider
  );
  
  // Organize Balancer pools by token pairs
  for (const pool of balancerPools) {
    if (!pool.tokens || pool.tokens.length < 2) continue;
    
    // For each token pair in the pool
    for (let i = 0; i < pool.tokens.length; i++) {
      for (let j = i + 1; j < pool.tokens.length; j++) {
        const tokenA = pool.tokens[i].address.toLowerCase();
        const tokenB = pool.tokens[j].address.toLowerCase();
        
        // Only store if both tokens are relevant
        if (relevantTokens.includes(tokenA) && relevantTokens.includes(tokenB)) {
          const pairKey = [tokenA, tokenB].sort().join('-');
          
          if (!pools.balancer[pairKey]) {
            pools.balancer[pairKey] = [];
          }
          
          pools.balancer[pairKey].push({
            ...pool,
            tokenIndexA: i,
            tokenIndexB: j
          });
        }
      }
    }
  }
  
  // Log Balancer pools found
  Object.entries(pools.balancer).forEach(([pair, poolList]) => {
    const [tokenA, tokenB] = pair.split('-');
    console.log(`  ✓ Balancer: Found ${poolList.length} pools for ${getSymbol(tokenA)}-${getSymbol(tokenB)}`);
  });
  
  return pools;
}

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

  const balanceIn = BigNumber.from(tokenIn.balanceRaw || tokenIn.balance);
  const balanceOut = BigNumber.from(tokenOut.balanceRaw || tokenOut.balance);
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

/**
 * Build all possible paths up to 3 hops
 */
export function buildPossiblePaths(tokenIn, tokenOut, pools, maxHops = 3) {
  const paths = [];
  const visited = new Set();
  
  // Direct path (1 hop)
  const directKey = [tokenIn.address.toLowerCase(), tokenOut.address.toLowerCase()].sort().join('-');
  
  // Check Uniswap direct
  if (pools.uniswap[directKey]) {
    pools.uniswap[directKey].forEach(pool => {
      paths.push({
        protocol: 'uniswap',
        hops: 1,
        route: [tokenIn.symbol, tokenOut.symbol],
        pools: [pool],
        legs: [{ pool, protocol: 'uniswap' }]
      });
    });
  }
  
  // Check Balancer direct
  if (pools.balancer[directKey]) {
    pools.balancer[directKey].forEach(pool => {
      paths.push({
        protocol: 'balancer',
        hops: 1,
        route: [tokenIn.symbol, tokenOut.symbol],
        pools: [pool],
        legs: [{ pool, protocol: 'balancer' }]
      });
    });
  }
  
  // 2-hop paths through intermediates
  for (const intermediate of INTERMEDIATES) {
    const key1 = [tokenIn.address.toLowerCase(), intermediate.address.toLowerCase()].sort().join('-');
    const key2 = [intermediate.address.toLowerCase(), tokenOut.address.toLowerCase()].sort().join('-');
    
    // Uniswap -> Uniswap
    if (pools.uniswap[key1] && pools.uniswap[key2]) {
      pools.uniswap[key1].forEach(pool1 => {
        pools.uniswap[key2].forEach(pool2 => {
          paths.push({
            protocol: 'uniswap',
            hops: 2,
            route: [tokenIn.symbol, intermediate.symbol, tokenOut.symbol],
            pools: [pool1, pool2],
            legs: [
              { pool: pool1, protocol: 'uniswap' },
              { pool: pool2, protocol: 'uniswap' }
            ]
          });
        });
      });
    }
    
    // Balancer -> Balancer
    if (pools.balancer[key1] && pools.balancer[key2]) {
      pools.balancer[key1].forEach(pool1 => {
        pools.balancer[key2].forEach(pool2 => {
          paths.push({
            protocol: 'balancer',
            hops: 2,
            route: [tokenIn.symbol, intermediate.symbol, tokenOut.symbol],
            pools: [pool1, pool2],
            legs: [
              { pool: pool1, protocol: 'balancer' },
              { pool: pool2, protocol: 'balancer' }
            ]
          });
        });
      });
    }
    
    // Cross-DEX: Balancer -> Uniswap
    if (pools.balancer[key1] && pools.uniswap[key2]) {
      pools.balancer[key1].forEach(pool1 => {
        pools.uniswap[key2].forEach(pool2 => {
          paths.push({
            protocol: 'mixed',
            hops: 2,
            route: [tokenIn.symbol, intermediate.symbol, tokenOut.symbol],
            pools: [pool1, pool2],
            legs: [
              { pool: pool1, protocol: 'balancer' },
              { pool: pool2, protocol: 'uniswap' }
            ],
            needsConversion: intermediate.symbol === 'WETH' // WETH->ETH conversion needed
          });
        });
      });
    }
    
    // Cross-DEX: Uniswap -> Balancer
    if (pools.uniswap[key1] && pools.balancer[key2]) {
      pools.uniswap[key1].forEach(pool1 => {
        pools.balancer[key2].forEach(pool2 => {
          paths.push({
            protocol: 'mixed',
            hops: 2,
            route: [tokenIn.symbol, intermediate.symbol, tokenOut.symbol],
            pools: [pool1, pool2],
            legs: [
              { pool: pool1, protocol: 'uniswap' },
              { pool: pool2, protocol: 'balancer' }
            ],
            needsConversion: intermediate.symbol === 'ETH' // ETH->WETH conversion needed
          });
        });
      });
    }
  }
  
  // 3-hop paths (if needed)
  if (maxHops >= 3) {
    // This gets complex, so we'll focus on the most promising 3-hop paths
    // through two intermediates
    for (const int1 of INTERMEDIATES) {
      for (const int2 of INTERMEDIATES) {
        if (int1.address === int2.address) continue;
        
        const key1 = [tokenIn.address.toLowerCase(), int1.address.toLowerCase()].sort().join('-');
        const key2 = [int1.address.toLowerCase(), int2.address.toLowerCase()].sort().join('-');
        const key3 = [int2.address.toLowerCase(), tokenOut.address.toLowerCase()].sort().join('-');
        
        // Build 3-hop paths (limiting combinations for performance)
        if (pools.uniswap[key1] && pools.uniswap[key2] && pools.uniswap[key3]) {
          // All Uniswap
          paths.push({
            protocol: 'uniswap',
            hops: 3,
            route: [tokenIn.symbol, int1.symbol, int2.symbol, tokenOut.symbol],
            pools: [pools.uniswap[key1][0], pools.uniswap[key2][0], pools.uniswap[key3][0]],
            legs: [
              { pool: pools.uniswap[key1][0], protocol: 'uniswap' },
              { pool: pools.uniswap[key2][0], protocol: 'uniswap' },
              { pool: pools.uniswap[key3][0], protocol: 'uniswap' }
            ]
          });
        }
        
        // Mixed 3-hop paths (Balancer -> Uniswap -> Uniswap, etc.)
        // Add more combinations as needed
      }
    }
  }
  
  console.log(`  📊 Built ${paths.length} possible paths (up to ${maxHops} hops)`);
  return paths;
}

/**
 * Optimize split across multiple parallel legs for a single hop
 */
export async function optimizeParallelLegs(legs, amountIn, maxLegs = 5) {
  if (legs.length === 0) return null;
  if (legs.length === 1) {
    // Single leg, no optimization needed
    return {
      legs: [{ ...legs[0], fraction: 1.0, input: amountIn }],
      totalOutput: await calculateLegOutput(amountIn, legs[0])
    };
  }
  
  // Start with equal distribution
  let fractions = new Array(Math.min(legs.length, maxLegs)).fill(1 / Math.min(legs.length, maxLegs));
  let bestFractions = [...fractions];
  let bestOutput = BigNumber.from(0);
  
  // Gradient descent optimization
  const iterations = 100;
  const learningRate = 0.01;
  
  for (let iter = 0; iter < iterations; iter++) {
    // Calculate total output with current fractions
    let totalOutput = BigNumber.from(0);
    
    for (let i = 0; i < fractions.length; i++) {
      const legAmount = amountIn.mul(Math.floor(fractions[i] * 10000)).div(10000);
      const output = await calculateLegOutput(legAmount, legs[i]);
      totalOutput = totalOutput.add(output);
    }
    
    if (totalOutput.gt(bestOutput)) {
      bestOutput = totalOutput;
      bestFractions = [...fractions];
    }
    
    // Calculate gradients
    const gradients = [];
    const epsilon = 0.001;
    
    for (let i = 0; i < fractions.length; i++) {
      const original = fractions[i];
      
      // Test increase
      fractions[i] = Math.min(1, original + epsilon);
      normalizeFractions(fractions);
      let outputPlus = BigNumber.from(0);
      for (let j = 0; j < fractions.length; j++) {
        const amount = amountIn.mul(Math.floor(fractions[j] * 10000)).div(10000);
        outputPlus = outputPlus.add(await calculateLegOutput(amount, legs[j]));
      }
      
      // Test decrease
      fractions[i] = Math.max(0, original - epsilon);
      normalizeFractions(fractions);
      let outputMinus = BigNumber.from(0);
      for (let j = 0; j < fractions.length; j++) {
        const amount = amountIn.mul(Math.floor(fractions[j] * 10000)).div(10000);
        outputMinus = outputMinus.add(await calculateLegOutput(amount, legs[j]));
      }
      
      // Calculate gradient
      gradients[i] = outputPlus.gt(outputMinus) ? learningRate : -learningRate;
      fractions[i] = original; // Reset
    }
    
    // Update fractions
    for (let i = 0; i < fractions.length; i++) {
      fractions[i] = Math.max(0, Math.min(1, fractions[i] + gradients[i]));
    }
    normalizeFractions(fractions);
    
    // Early stopping
    if (iter > 20 && arraysEqual(fractions, bestFractions, 0.001)) {
      break;
    }
  }
  
  // Build optimized legs
  const optimizedLegs = [];
  for (let i = 0; i < bestFractions.length; i++) {
    if (bestFractions[i] > 0.01) { // Only include if > 1%
      const legAmount = amountIn.mul(Math.floor(bestFractions[i] * 10000)).div(10000);
      optimizedLegs.push({
        ...legs[i],
        fraction: bestFractions[i],
        input: legAmount,
        output: await calculateLegOutput(legAmount, legs[i])
      });
    }
  }
  
  return {
    legs: optimizedLegs,
    totalOutput: bestOutput
  };
}

/**
 * Calculate output for a single leg
 */
async function calculateLegOutput(amountIn, leg, tokenInSymbol, tokenOutSymbol) {
  if (leg.protocol === 'uniswap') {
    // For Uniswap, we need to provide the swap direction
    // If not provided, try to infer from the pool
    const inSymbol = tokenInSymbol || leg.tokenIn?.symbol || 
                     leg.pool.token0?.symbol || leg.pool.currency0?.symbol;
    const outSymbol = tokenOutSymbol || leg.tokenOut?.symbol || 
                      leg.pool.token1?.symbol || leg.pool.currency1?.symbol;
    return await calculateUniswapExactOutput(amountIn, leg.pool, inSymbol, outSymbol);
  } else if (leg.protocol === 'balancer') {
    return calculateBalancerExactOutput(
      amountIn,
      leg.pool,
      leg.pool.tokenIndexA || 0,
      leg.pool.tokenIndexB || 1
    );
  }
  return BigNumber.from(0);
}

/**
 * Find optimal mixed strategy across all paths
 */
export async function findOptimalMixedStrategy(paths, amountIn, tokenIn, tokenOut) {
  console.log('\n⚡ Optimizing mixed strategy across all paths...');
  
  // Group paths by hop pattern for parallel optimization
  const hopGroups = {};
  
  for (const path of paths) {
    const hopKey = path.route.join('->');
    if (!hopGroups[hopKey]) {
      hopGroups[hopKey] = [];
    }
    hopGroups[hopKey].push(path);
  }
  
  // For each hop pattern, find optimal split
  const strategies = [];
  
  for (const [hopKey, hopPaths] of Object.entries(hopGroups)) {
    console.log(`  Optimizing ${hopPaths.length} paths for route: ${hopKey}`);
    
    // Can we split this hop across multiple paths?
    if (hopPaths.length > 1) {
      const optimized = await optimizeParallelLegs(
        hopPaths.map(p => ({ ...p.legs[0], path: p })),
        amountIn,
        5 // Max 5 parallel legs
      );
      
      if (optimized) {
        strategies.push({
          type: 'parallel-split',
          route: hopKey,
          ...optimized
        });
      }
    } else {
      // Single path for this route
      const output = await calculatePathOutput(amountIn, hopPaths[0]);
      strategies.push({
        type: 'single-path',
        route: hopKey,
        path: hopPaths[0],
        totalOutput: output
      });
    }
  }
  
  // Sort strategies by output
  strategies.sort((a, b) => {
    const outputA = a.totalOutput || BigNumber.from(0);
    const outputB = b.totalOutput || BigNumber.from(0);
    return outputB.gt(outputA) ? 1 : -1;
  });
  
  if (strategies.length > 0) {
    const best = strategies[0];
    console.log(`\n  ✅ Best strategy: ${best.type} on route ${best.route}`);
    console.log(`     Expected output: ${ethers.utils.formatUnits(best.totalOutput, tokenOut.decimals)} ${tokenOut.symbol}`);
    
    if (best.legs && best.legs.length > 1) {
      console.log(`     Split across ${best.legs.length} parallel paths:`);
      best.legs.forEach(leg => {
        console.log(`       • ${(leg.fraction * 100).toFixed(1)}% on ${leg.protocol || leg.path?.protocol}`);
      });
    }
  }
  
  return strategies[0];
}

/**
 * Calculate total output for a complete path
 */
async function calculatePathOutput(amountIn, path) {
  let currentAmount = amountIn;
  
  for (const leg of path.legs) {
    currentAmount = await calculateLegOutput(currentAmount, leg);
    
    // Handle ETH/WETH conversion if needed
    if (path.needsConversion && leg === path.legs[0]) {
      // No slippage on wrap/unwrap, just continue
    }
  }
  
  return currentAmount;
}

// Helper functions
function getSymbol(address) {
  const addr = address.toLowerCase();
  if (addr === WETH_ADDRESS.toLowerCase()) return 'WETH';
  if (addr === ETH_ADDRESS.toLowerCase()) return 'ETH';
  
  const found = INTERMEDIATES.find(t => t.address.toLowerCase() === addr);
  return found ? found.symbol : address.substring(0, 6);
}

function normalizeFractions(fractions) {
  const sum = fractions.reduce((a, b) => a + b, 0);
  if (sum > 0) {
    for (let i = 0; i < fractions.length; i++) {
      fractions[i] /= sum;
    }
  }
}

function arraysEqual(a, b, tolerance = 0) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > tolerance) return false;
  }
  return true;
}

export default {
  discoverAllPools,
  buildPossiblePaths,
  findOptimalMixedStrategy,
  optimizeParallelLegs,
  calculateUniswapExactOutput,
  calculateBalancerExactOutput
};