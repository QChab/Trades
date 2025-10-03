import { ethers } from 'ethers';
import axios from 'axios';
import Decimal from 'decimal.js';

// Balancer V3 uses a different architecture than V2
const BALANCER_V3_SUBGRAPH = 'https://gateway.thegraph.com/api/d692082c59f956790647e889e75fa84d/subgraphs/id/4rixbLvpuBCwXTJSwyAzQgsLR8KprnyMfyCuXT8Fj5cd';

// In-memory cache for browser environment
let memoryCache = { pools: {}, lastUpdated: '', version: '1.0.0' };

// Calculate spot prices from pool data
function calculateSpotPrices(poolData) {
  let spotPrices = {};
  
  if (poolData.poolType === 'Weighted' && poolData.weights && poolData.tokens) {
    for (let i = 0; i < poolData.tokens.length - 1; i++) {
      for (let j = i + 1; j < poolData.tokens.length; j++) {
        const tokenA = poolData.tokens[i];
        const tokenB = poolData.tokens[j];
        const weightA = poolData.weights[i];
        const weightB = poolData.weights[j];
        
        // Parse balances (already from GraphQL, no need for RPC)
        let balanceA, balanceB;
        try {
          // Balance from GraphQL is already a string
          if (tokenA.balance.includes('.')) {
            balanceA = ethers.utils.parseUnits(tokenA.balance, tokenA.decimals || 18);
          } else {
            balanceA = ethers.BigNumber.from(tokenA.balance);
          }
          
          if (tokenB.balance.includes('.')) {
            balanceB = ethers.utils.parseUnits(tokenB.balance, tokenB.decimals || 18);
          } else {
            balanceB = ethers.BigNumber.from(tokenB.balance);
          }
        } catch (e) {
          continue;
        }
        
        // Spot price = (balanceB/weightB) / (balanceA/weightA)
        if (balanceA.gt(0) && balanceB.gt(0)) {
          const price = balanceB.mul(Math.floor(weightA * 1000))
            .div(balanceA.mul(Math.floor(weightB * 1000)));
          
          spotPrices[`${tokenA.symbol}/${tokenB.symbol}`] = price.toString();
          spotPrices[`${tokenB.symbol}/${tokenA.symbol}`] = 
            ethers.BigNumber.from(10).pow(18).div(price).toString();
        }
      }
    }
  }
  
  return spotPrices;
}

// Load pool cache (uses in-memory cache for browser, file cache for Node.js via IPC if available)
function loadPoolCache() {
  // In browser environment, use memory cache
  // TODO: Consider using localStorage or IPC to main process for persistence
  return memoryCache;
}

// Save pool cache (uses in-memory cache for browser)
function savePoolCache(cache) {
  cache.lastUpdated = new Date().toISOString();
  memoryCache = cache;
  // TODO: Consider using localStorage or IPC to main process for persistence
}

// Get pool data from cache or detect
async function getPoolData(poolAddress, provider, poolInfo = null) {
  const cache = loadPoolCache();
  
  // Check if pool data is already cached (static data like weights, type)
  if (cache.pools[poolAddress.toLowerCase()]) {
    const cachedData = cache.pools[poolAddress.toLowerCase()];
    
    // If we have fresh poolInfo from GraphQL, use its balances
    if (poolInfo && poolInfo.tokens) {
      // Merge cached static data with fresh GraphQL data
      const mergedData = {
        ...cachedData,
        tokens: poolInfo.tokens, // Fresh balances from GraphQL
        swapFee: poolInfo.swapFee || cachedData.swapFee,
        spotPrices: calculateSpotPrices({
          ...cachedData,
          tokens: poolInfo.tokens
        }),
        isFresh: true,
        fetchedAt: Date.now()
      };
      return mergedData;
    }
    
    return cachedData;
  }
  
  // Not in cache, detect pool type and get data
  console.log(`⚙ Detecting type for pool ${poolAddress.slice(0, 10)}...`);
  const poolData = await detectPoolType(poolAddress, provider);
  
  // Calculate total liquidity (sum of token balances)
  let totalLiquidity = 0;
  if (poolInfo && poolInfo.tokens && poolInfo.tokens.length > 0) {
    // Sum up token balances as a rough liquidity metric
    totalLiquidity = poolInfo.tokens.reduce((sum, token) => {
      const balance = parseFloat(token.balance || '0');
      return sum + balance;
    }, 0);
  }
  
  // Skip pools with less than 1 total tokens (too small to be useful)
  if (totalLiquidity < 1) {
    console.log(`  ⚠️ Pool has insufficient liquidity (${totalLiquidity.toFixed(4)} total tokens)`);
    return null;
  }
  
  // Add additional useful data
  const enrichedData = {
    ...poolData,
    address: poolAddress,
    id: poolAddress, // In V3, ID is the address
    tokens: poolInfo?.tokens || [],
    totalLiquidity,
    swapFee: poolInfo?.swapFee || '0.003',
    queriedAt: new Date().toISOString()
  };
  
  // Cache the result
  cache.pools[poolAddress.toLowerCase()] = enrichedData;
  savePoolCache(cache);
  
  return enrichedData;
}

// Get cache statistics
export function getCacheStats() {
  const cache = loadPoolCache();
  const poolCount = Object.keys(cache.pools).length;
  const poolTypes = {};
  const weightDistributions = {};
  
  Object.values(cache.pools).forEach(pool => {
    // Count pool types
    poolTypes[pool.poolType] = (poolTypes[pool.poolType] || 0) + 1;
    
    // Track weight distributions
    if (pool.weights) {
      const weightStr = pool.weights.join('/');
      weightDistributions[weightStr] = (weightDistributions[weightStr] || 0) + 1;
    }
  });
  
  return {
    totalPools: poolCount,
    lastUpdated: cache.lastUpdated,
    poolTypes,
    weightDistributions,
    cacheSize: JSON.stringify(cache).length
  };
}

// Pool type detection ABIs
const WEIGHTED_POOL_ABI = [
  'function getNormalizedWeights() external view returns (uint256[] memory)',
  'function getSwapFeePercentage() external view returns (uint256)',
  'function getPoolId() external view returns (bytes32)',
  'function totalSupply() external view returns (uint256)',
  'function getVault() external view returns (address)'
];

const STABLE_POOL_ABI = [
  'function getAmplificationParameter() external view returns (uint256 value, bool isUpdating, uint256 precision)',
  'function getSwapFeePercentage() external view returns (uint256)',
  'function getPoolId() external view returns (bytes32)',
  'function totalSupply() external view returns (uint256)',
  'function getVault() external view returns (address)'
];

// Generic pool ABI for basic operations
const POOL_ABI = [
  'function getPoolId() external view returns (bytes32)',
  'function getSwapFeePercentage() external view returns (uint256)',
  'function totalSupply() external view returns (uint256)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)'
];

export async function useBalancerV3({ tokenInAddress, tokenOutAddress, amountIn, slippageTolerance = 0.5, provider }) {
  try {
    console.log('🔍 Discovering Balancer V3 pools for tokens:', tokenInAddress, tokenOutAddress);
    console.log('   Input amount:', ethers.utils.formatEther(amountIn), 'tokens');
    
    const pools = await discoverV3Pools(tokenInAddress, tokenOutAddress, provider);
    console.log(`Found ${pools.length} V3 pools containing one or both tokens`);
    
    // Debug: Show which tokens are in the pools
    const tokenSet = new Set();
    pools.forEach(p => p.tokens.forEach(t => tokenSet.add(t.symbol || t.address.slice(0, 6))));
    console.log(`Tokens in pools: ${Array.from(tokenSet).slice(0, 10).join(', ')}...`);
    
    // Check for optimal intermediate pools
    const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'.toLowerCase();
    const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'.toLowerCase();
    const intermediates = [weth, usdc, '0xdAC17F958D2ee523a2206206994597C13D831ec7', '0x6B175474E89094C44Da98b954EedeAC495271d0F'];
    
    let optimalPoolsCount = 0;
    for (const inter of intermediates) {
      const hasInter = pools.filter(p => p.tokens.some(t => t.address.toLowerCase() === inter)).length;
      if (hasInter > 0) optimalPoolsCount += hasInter;
    }
    console.log(`Found ${optimalPoolsCount} pools with optimal intermediates (WETH, USDC, USDT, DAI)`);
    
    // Enrich pools with on-chain data (weights, pool types)
    const enrichedPools = await enrichPoolData(pools, provider);
    
    const paths = await findOptimalPaths(
      tokenInAddress,
      tokenOutAddress,
      amountIn,
      enrichedPools,
      provider,
      3
    );
    
    if (paths.length === 0) {
      console.log('❌ No valid paths found');
      return null;
    }

    // Return ALL paths for the mixed optimizer to consider
    // Don't pre-select the "best" - let golden section search handle optimization
    console.log(`✅ Found ${paths.length} paths through Balancer`);

    // For now, limit to top 5 paths to avoid too much complexity
    const topPaths = paths.slice(0, 5);

    // Log the best path for debugging
    const bestPath = paths[0];

    // Check if this is WETH->USDC and format correctly
    let outputFormatted;
    if (tokenOutAddress.toLowerCase() === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48') { // USDC
      outputFormatted = ethers.utils.formatUnits(bestPath.amountOut, 6) + ' USDC';
    } else {
      outputFormatted = ethers.utils.formatEther(bestPath.amountOut) + ' tokens';
    }

    console.log('Best single Balancer path:', {
      hops: bestPath.hops.length,
      expectedOutput: outputFormatted,
      pools: bestPath.hops.map(h => ({
        pool: h.poolAddress.slice(0, 10) + '...',
        type: h.poolType,
        weights: h.weights
      }))
    });

    // Create result for each path
    const allResults = topPaths.map(path => {
      const minAmountOut = calculateMinAmountOut(path.amountOut, slippageTolerance);
      return {
        amountOut: path.amountOut.toString(),
        minAmountOut: minAmountOut.toString(),
        path: path,
        priceImpact: path.priceImpact || '0',
        fees: path.totalFees || '0',
        poolAddresses: path.hops.map(h => h.poolAddress),
        poolTypes: path.hops.map(h => h.poolType),
        weights: path.hops.map(h => h.weights),
        poolData: path.hops.length > 0 ? path.hops[0].poolData : null
      };
    });

    // For backward compatibility, return the first (best) path as the main result
    // But also include all paths for mixed optimization
    return {
      ...allResults[0],
      allPaths: allResults  // Include all paths for the optimizer to use
    };
    
  } catch (error) {
    console.error('❌ Error in useBalancerV3:', error);
    return null;
  }
}

async function discoverV3Pools(tokenA, tokenB, provider) {
  try {
    // Intermediate tokens for multi-hop routing
    const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'.toLowerCase();
    const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'.toLowerCase();
    const usdt = '0xdAC17F958D2ee523a2206206994597C13D831ec7'.toLowerCase();
    const dai = '0x6B175474E89094C44Da98b954EedeAC495271d0F'.toLowerCase();
    const wbtc = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'.toLowerCase();
    
    // Build array of all tokens to search for
    const searchTokens = [
      tokenA.toLowerCase(),
      tokenB.toLowerCase(),
      weth, usdc, usdt, dai, wbtc
    ];
    
    const query = `
      {
        pools(
          first: 200,
          where: {
            isInitialized: true,
            isPaused: false,
            isInRecoveryMode: false,
            tokens_: {
              address_in: ${JSON.stringify(searchTokens)}
            }
          }
        ) {
          id
          address
          name
          symbol
          swapFee
          tokens {
            address
            balance
            decimals
            symbol
          }
        }
      }
    `;
    
    const response = await axios.post(BALANCER_V3_SUBGRAPH, { query });
    
    if (!response.data || !response.data.data) {
      console.log('No data from V3 subgraph');
      return [];
    }
    
    const allPools = response.data.data.pools || [];
    
    // Filter out pools with insufficient liquidity
    const validPools = allPools.filter(pool => {
      const totalBalance = pool.tokens.reduce((sum, token) => {
        return sum + parseFloat(token.balance || '0');
      }, 0);
      
      return totalBalance >= 1; // Skip tiny pools
    });
    
    console.log(`Found ${validPools.length} pools with sufficient liquidity`);
    
    // Since we already filtered by tokens in the GraphQL query,
    // all these pools are relevant (they contain tokenA, tokenB, or intermediates)
    return validPools;
    
  } catch (error) {
    console.error('Error fetching V3 pools:', error);
    return [];
  }
}

async function enrichPoolData(pools, provider) {
  const enrichedPools = [];
  
  // Prioritize pools with WETH for better routing
  const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'.toLowerCase();
  const wethPools = pools.filter(p => 
    p.tokens.some(t => t.address.toLowerCase() === weth)
  );
  const otherPools = pools.filter(p => 
    !p.tokens.some(t => t.address.toLowerCase() === weth)
  );
  
  // Process WETH pools first, then others, limit to 20 total
  const poolsToProcess = [...wethPools.slice(0, 15), ...otherPools.slice(0, 5)];
  console.log(`Processing ${poolsToProcess.length} pools (${wethPools.length} with WETH)...`);
  
  for (const pool of poolsToProcess) {
    try {
      const poolAddress = pool.address || pool.id;
      
      // Use cached pool data or detect if not cached
      const poolData = await getPoolData(poolAddress, provider, pool);
      
      enrichedPools.push({
        ...pool,
        poolType: poolData.poolType,
        weights: poolData.weights,
        amplificationParameter: poolData.amplificationParameter,
        poolAddress: poolAddress,
        cachedData: true
      });
      
    } catch (error) {
      console.error(`Failed to enrich pool ${pool.id}:`, error.message);
      enrichedPools.push({
        ...pool,
        poolType: 'Unknown',
        weights: null,
        poolAddress: pool.address || pool.id
      });
    }
  }
  
  return enrichedPools;
}

async function detectPoolType(poolAddress, provider) {
  try {
    // Try to detect if it's a weighted pool
    const weightedPool = new ethers.Contract(poolAddress, WEIGHTED_POOL_ABI, provider);
    try {
      const weights = await weightedPool.getNormalizedWeights();
      console.log(`Pool ${poolAddress.slice(0, 10)}... is a Weighted Pool`);
      
      // Convert weights from uint256 to percentages
      const totalWeight = ethers.utils.parseEther('1');
      const normalizedWeights = weights.map(w => {
        const percentage = ethers.BigNumber.from(w).mul(100).div(totalWeight);
        return percentage.toNumber();
      });
      
      return {
        poolType: 'WeightedPool',
        weights: normalizedWeights,
        amplificationParameter: null
      };
    } catch (e) {
      // Not a weighted pool, continue
    }
    
    // Try to detect if it's a stable pool
    const stablePool = new ethers.Contract(poolAddress, STABLE_POOL_ABI, provider);
    try {
      const ampData = await stablePool.getAmplificationParameter();
      console.log(`Pool ${poolAddress.slice(0, 10)}... is a Stable Pool`);
      
      return {
        poolType: 'StablePool',
        weights: null, // Stable pools don't have weights
        amplificationParameter: ampData.value.toString()
      };
    } catch (e) {
      // Not a stable pool, continue
    }
    
    // Check if it has basic pool functions (might be composable stable or other type)
    const basicPool = new ethers.Contract(poolAddress, POOL_ABI, provider);
    try {
      const name = await basicPool.name();
      
      // Try to infer pool type from name
      if (name.toLowerCase().includes('weighted')) {
        return {
          poolType: 'WeightedPool',
          weights: [50, 50], // Default to 50/50 if we can't get actual weights
          amplificationParameter: null
        };
      } else if (name.toLowerCase().includes('stable')) {
        return {
          poolType: 'StablePool',
          weights: null,
          amplificationParameter: '100' // Default amplification
        };
      } else if (name.toLowerCase().includes('linear')) {
        return {
          poolType: 'LinearPool',
          weights: null,
          amplificationParameter: null
        };
      }
    } catch (e) {
      // Can't determine from name
    }
    
    // Default to constant product if we can't determine
    return {
      poolType: 'ConstantProduct',
      weights: [50, 50],
      amplificationParameter: null
    };
    
  } catch (error) {
    console.error(`Error detecting pool type for ${poolAddress}:`, error.message);
    return {
      poolType: 'Unknown',
      weights: null,
      amplificationParameter: null
    };
  }
}

/**
 * Find paths through Balancer pools
 * Note: This function returns paths sorted by output amount (best first)
 * For mixed DEX optimization, we currently use only the best Balancer path
 * and let the golden section search optimize the split at a higher level.
 *
 * Future enhancement: Return multiple paths to allow splitting across
 * different Balancer routes in addition to Uniswap routes.
 */
async function findOptimalPaths(tokenIn, tokenOut, amountIn, pools, provider, maxHops = 3) {
  const paths = [];
  const visited = new Set();
  
  // Define priority intermediate tokens for optimal routing
  const priorityIntermediates = [
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
  ].map(t => t.toLowerCase());
  
  // First, try direct paths and 2-hop paths through priority intermediates
  await findDirectAndPriorityPaths();
  
  // Then use DFS for more complex paths if needed
  async function findDirectAndPriorityPaths() {
    const tokenInLower = tokenIn.toLowerCase();
    const tokenOutLower = tokenOut.toLowerCase();
    
    // Check for direct path
    for (const pool of pools) {
      const poolTokens = pool.tokens.map(t => t.address.toLowerCase());
      if (poolTokens.includes(tokenInLower) && poolTokens.includes(tokenOutLower)) {
        // Direct pool exists!
        try {
          const result = await calculateSingleHop(pool, tokenIn, tokenOut, amountIn);
          if (result) {
            paths.push({
              hops: [result],
              amountOut: result.amountOut,
              totalFees: result.swapFee,
              priceImpact: '0' // Direct path has minimal impact
            });
          }
        } catch (e) {
          console.error(`Error calculating direct path: ${e.message}`);
        }
      }
    }
    
    // Try 2-hop paths through each priority intermediate
    for (const intermediate of priorityIntermediates) {
      if (intermediate === tokenInLower || intermediate === tokenOutLower) continue;
      
      // Find pools: tokenIn -> intermediate
      const firstHopPools = pools.filter(p => {
        const addrs = p.tokens.map(t => t.address.toLowerCase());
        return addrs.includes(tokenInLower) && addrs.includes(intermediate);
      });
      
      // Find pools: intermediate -> tokenOut
      const secondHopPools = pools.filter(p => {
        const addrs = p.tokens.map(t => t.address.toLowerCase());
        return addrs.includes(intermediate) && addrs.includes(tokenOutLower);
      });
      
      // Try all combinations
      for (const firstPool of firstHopPools) {
        for (const secondPool of secondHopPools) {
          try {
            const hop1 = await calculateSingleHop(firstPool, tokenIn, 
              firstPool.tokens.find(t => t.address.toLowerCase() === intermediate).address, 
              amountIn);
            if (!hop1) continue;
            
            const hop2 = await calculateSingleHop(secondPool, 
              secondPool.tokens.find(t => t.address.toLowerCase() === intermediate).address,
              secondPool.tokens.find(t => t.address.toLowerCase() === tokenOutLower).address,
              hop1.amountOut);
            if (!hop2) continue;
            
            paths.push({
              hops: [hop1, hop2],
              amountOut: hop2.amountOut,
              totalFees: calculateTotalFees([hop1, hop2]),
              priceImpact: calculatePriceImpact(amountIn, hop2.amountOut, [hop1, hop2])
            });
          } catch (e) {
            // Skip this combination
          }
        }
      }
    }
  }
  
  async function calculateSingleHop(pool, tokenIn, tokenOut, amountIn) {
    const tokens = pool.tokens.map(t => t.address.toLowerCase());
    const tokenInIndex = tokens.indexOf(tokenIn.toLowerCase());
    const tokenOutIndex = tokens.indexOf(tokenOut.toLowerCase());

    if (tokenInIndex === -1 || tokenOutIndex === -1) return null;

    // Try with both the original amount AND a small test amount
    // This helps identify pools that work for small trades but not large ones
    const testAmount = ethers.BigNumber.from(amountIn).div(1000); // 1/1000 of original
    
    // Get token balances
    const balanceInStr = pool.tokens[tokenInIndex].balance;
    const balanceOutStr = pool.tokens[tokenOutIndex].balance;
    
    let balanceIn, balanceOut;
    try {
      if (balanceInStr.includes('.')) {
        const decimalsIn = pool.tokens[tokenInIndex].decimals || 18;
        balanceIn = ethers.utils.parseUnits(balanceInStr, decimalsIn);
      } else {
        balanceIn = ethers.BigNumber.from(balanceInStr);
      }
      
      if (balanceOutStr.includes('.')) {
        const decimalsOut = pool.tokens[tokenOutIndex].decimals || 18;
        balanceOut = ethers.utils.parseUnits(balanceOutStr, decimalsOut);
      } else {
        balanceOut = ethers.BigNumber.from(balanceOutStr);
      }
    } catch (e) {
      return null;
    }
    
    // Debug for WETH->USDC trades
    const tokenInSymbol = pool.tokens[tokenInIndex].symbol;
    const tokenOutSymbol = pool.tokens[tokenOutIndex].symbol;

    if (tokenInSymbol === 'WETH' && tokenOutSymbol === 'USDC') {
      console.log('\n   🔍 Debug WETH->USDC calculation:');
      console.log('   Pool ID:', pool.poolAddress.slice(0, 10) + '...');
      console.log('   Pool Type:', pool.poolType);
      console.log('   Input amount:', ethers.utils.formatEther(amountIn), 'WETH');
      console.log('   Balance WETH (raw):', balanceInStr);
      console.log('   Balance WETH (parsed):', ethers.utils.formatEther(balanceIn), 'WETH');
      console.log('   Balance USDC (raw):', balanceOutStr);
      console.log('   Balance USDC (parsed):', ethers.utils.formatUnits(balanceOut, 6), 'USDC');
      console.log('   Swap fee:', pool.swapFee);
      if (pool.weights) {
        console.log('   Weights:', pool.weights[tokenInIndex], '/', pool.weights[tokenOutIndex]);
      }
    }

    // Calculate output for the requested amount
    const outputAmount = calculateSwapOutput(
      ethers.BigNumber.from(amountIn),
      balanceIn,
      balanceOut,
      pool.swapFee,
      pool.poolType,
      pool.weights ? pool.weights[tokenInIndex] : null,
      pool.weights ? pool.weights[tokenOutIndex] : null,
      pool.amplificationParameter
    );

    // Also calculate output for test amount to check pool viability
    const testOutputAmount = calculateSwapOutput(
      testAmount,
      balanceIn,
      balanceOut,
      pool.swapFee,
      pool.poolType,
      pool.weights ? pool.weights[tokenInIndex] : null,
      pool.weights ? pool.weights[tokenOutIndex] : null,
      pool.amplificationParameter
    );

    // Check if the pool can handle small trades reasonably
    // Expected rate for WETH->USDC should be around 4100
    const testRate = testOutputAmount.mul(1000).div(testAmount);
    const expectedRate = pool.tokens[tokenOutIndex].symbol === 'USDC' ? 4100 : 1;

    // If the test trade gives unreasonable output, pool has liquidity issues
    if (pool.tokens[tokenInIndex].symbol === 'WETH' && pool.tokens[tokenOutIndex].symbol === 'USDC') {
      const testRateNum = parseFloat(ethers.utils.formatUnits(testRate, 6));
      if (testRateNum < expectedRate * 0.5) { // Less than 50% of expected rate
        console.log(`   ⚠️ Pool ${pool.poolAddress.slice(0, 10)}... has poor liquidity (rate: ${testRateNum.toFixed(0)} vs expected: ${expectedRate})`);
        // Don't return null, but mark it as low liquidity
      }
    }

    // Debug output for WETH->USDC
    if (tokenInSymbol === 'WETH' && tokenOutSymbol === 'USDC') {
      console.log('   Calculated output:', ethers.utils.formatUnits(outputAmount, 6), 'USDC');
      console.log('   Output (raw):', outputAmount.toString());
    }
    
    return {
      poolAddress: pool.poolAddress,
      poolType: pool.poolType,
      tokenIn: tokenIn,
      tokenOut: tokenOut,
      amountIn: amountIn,
      amountOut: outputAmount,
      swapFee: pool.swapFee,
      weights: pool.weights ? `${pool.weights[tokenInIndex]}/${pool.weights[tokenOutIndex]}` : null,
      testRate: testRate, // Rate for small trades to assess pool quality
      // Add full pool data for exact AMM calculations
      poolData: {
        tokens: pool.tokens,
        poolType: pool.poolType,
        weights: pool.weights,
        swapFee: pool.swapFee,
        amplificationParameter: pool.amplificationParameter
      }
    };
  }
  
  async function dfs(currentToken, targetToken, remainingAmount, currentPath, hopsLeft) {
    if (hopsLeft === 0) return;
    
    const pathKey = `${currentToken}-${currentPath.map(p => p.poolAddress).join(',')}`;
    if (visited.has(pathKey)) return;
    visited.add(pathKey);
    
    for (const pool of pools) {
      const tokens = pool.tokens.map(t => t.address.toLowerCase());
      const currentTokenLower = currentToken.toLowerCase();
      
      if (!tokens.includes(currentTokenLower)) continue;
      
      for (let i = 0; i < tokens.length; i++) {
        const nextToken = tokens[i];
        if (nextToken === currentTokenLower) continue;
        
        try {
          const tokenInIndex = tokens.indexOf(currentTokenLower);
          const tokenOutIndex = i;
          
          // Get token balances from pool data
          // Handle decimal balances by converting to wei
          const balanceInStr = pool.tokens[tokenInIndex].balance;
          const balanceOutStr = pool.tokens[tokenOutIndex].balance;
          
          let balanceIn, balanceOut;
          try {
            // If balance is a decimal string, parse it properly
            if (balanceInStr.includes('.')) {
              const decimalsIn = pool.tokens[tokenInIndex].decimals || 18;
              balanceIn = ethers.utils.parseUnits(balanceInStr, decimalsIn);
            } else {
              balanceIn = ethers.BigNumber.from(balanceInStr);
            }
            
            if (balanceOutStr.includes('.')) {
              const decimalsOut = pool.tokens[tokenOutIndex].decimals || 18;
              balanceOut = ethers.utils.parseUnits(balanceOutStr, decimalsOut);
            } else {
              balanceOut = ethers.BigNumber.from(balanceOutStr);
            }
          } catch (e) {
            console.error(`Error parsing balances for pool ${pool.poolAddress}: ${e.message}`);
            continue;
          }
          
          // Calculate weights for this specific swap
          let weightIn = null;
          let weightOut = null;
          if (pool.weights && pool.weights.length > 0) {
            weightIn = pool.weights[tokenInIndex];
            weightOut = pool.weights[tokenOutIndex];
          }
          
          const outputAmount = calculateSwapOutput(
            remainingAmount,
            balanceIn,
            balanceOut,
            pool.swapFee,
            pool.poolType,
            weightIn,
            weightOut,
            pool.amplificationParameter
          );
          
          const hop = {
            poolAddress: pool.poolAddress,
            poolType: pool.poolType,
            tokenIn: currentToken,
            tokenOut: pool.tokens[tokenOutIndex].address,
            amountIn: remainingAmount,
            amountOut: outputAmount,
            swapFee: pool.swapFee,
            weights: pool.weights ? `${weightIn}/${weightOut}` : null,
            // Add full pool data for exact AMM calculations
            poolData: {
              tokens: pool.tokens,
              poolType: pool.poolType,
              weights: pool.weights,
              swapFee: pool.swapFee,
              amplificationParameter: pool.amplificationParameter
            }
          };
          
          const newPath = [...currentPath, hop];
          
          if (nextToken === targetToken.toLowerCase()) {
            const totalFees = calculateTotalFees(newPath);
            
            paths.push({
              hops: newPath,
              amountOut: outputAmount,
              totalFees: totalFees.toString(),
              priceImpact: calculatePriceImpact(amountIn, outputAmount, newPath)
            });
          } else if (hopsLeft > 1) {
            await dfs(pool.tokens[tokenOutIndex].address, targetToken, outputAmount, newPath, hopsLeft - 1);
          }
        } catch (error) {
          console.error(`Error processing pool ${pool.poolAddress}:`, error.message);
        }
      }
    }
  }
  
  // If we didn't find enough good paths with priority routing, try DFS for 3-hop paths
  if (paths.length < 3) {
    await dfs(tokenIn, tokenOut, ethers.BigNumber.from(amountIn), [], maxHops);
  }
  
  // Sort paths by best output
  paths.sort((a, b) => {
    const aOut = ethers.BigNumber.from(a.amountOut);
    const bOut = ethers.BigNumber.from(b.amountOut);
    return bOut.gt(aOut) ? 1 : -1;
  });
  
  console.log(`Found ${paths.length} total paths, returning best ${Math.min(5, paths.length)}`);
  return paths.slice(0, 5);
}

/**
 * Calculate exact power using decimal.js for precise decimal exponents
 * base^(numerator/denominator) with arbitrary precision
 */
function calculateExactPower(base, numerator, denominator) {
  // Handle edge cases
  if (base.isZero()) return ethers.BigNumber.from(0);
  if (numerator === 0) return ethers.utils.parseEther('1');
  if (numerator === denominator) return base;

  // Convert ethers.BigNumber to string for decimal.js
  const baseStr = ethers.utils.formatEther(base);

  // Configure decimal.js for high precision
  Decimal.set({
    precision: 50,
    rounding: Decimal.ROUND_DOWN
  });

  // Create Decimal instances
  const baseDecimal = new Decimal(baseStr);
  const exponent = new Decimal(numerator).div(denominator);

  // Calculate base^(numerator/denominator) with exact precision
  const resultDecimal = baseDecimal.pow(exponent);

  // Convert back to ethers.BigNumber
  // Ensure we have exactly 18 decimal places for Wei conversion
  const resultStr = resultDecimal.toFixed(18, Decimal.ROUND_DOWN);

  try {
    return ethers.utils.parseEther(resultStr);
  } catch (e) {
    // Handle very small numbers that might underflow
    if (resultDecimal.lessThan(1e-18)) {
      return ethers.BigNumber.from(0);
    }
    throw e;
  }
}

export function calculateSwapOutput(amountIn, balanceIn, balanceOut, swapFee, poolType, weightIn, weightOut, amplificationParameter) {
  // Convert swap fee to BigNumber (handle both decimal and wei formats)
  const feeValue = typeof swapFee === 'string' && swapFee.includes('.')
    ? ethers.utils.parseEther(swapFee)
    : ethers.BigNumber.from(String(swapFee));
  const oneEther = ethers.utils.parseEther('1');
  const amountInAfterFee = amountIn.mul(oneEther.sub(feeValue)).div(oneEther);

  if (poolType === 'WeightedPool') {
    // Exact Balancer weighted pool formula:
    // outAmount = balanceOut * (1 - (balanceIn / (balanceIn + inAmount * (1 - fee)))^(weightIn/weightOut))

    // Get weights, default to 50/50 if not specified
    const wi = weightIn || 50;
    const wo = weightOut || 50;

    // Calculate new balance after input
    const newBalanceIn = balanceIn.add(amountInAfterFee);

    // Calculate the ratio: balanceIn / newBalanceIn
    const ratio = balanceIn.mul(oneEther).div(newBalanceIn);

    // Use exact power calculation for ratio^(weightIn/weightOut)
    const ratioPower = calculateExactPower(ratio, wi, wo);

    // Calculate (1 - ratioPower)
    const oneMinus = oneEther.sub(ratioPower);

    // Calculate final output
    return balanceOut.mul(oneMinus).div(oneEther);
    
  } else if (poolType === 'StablePool') {
    // Stable pool with amplification parameter
    const amp = amplificationParameter ? ethers.BigNumber.from(String(amplificationParameter)) : ethers.BigNumber.from('100');
    
    // Simplified StableSwap calculation
    // Real implementation would use iterative solving
    const sum = balanceIn.add(balanceOut);
    const prod = balanceIn.mul(balanceOut);
    
    const newBalanceIn = balanceIn.add(amountInAfterFee);
    
    // Approximate the new balance out
    // This is simplified - real stable math is more complex
    const invariant = sum.mul(amp).add(prod.mul(2).div(sum));
    const newProd = invariant.mul(newBalanceIn).div(amp.add(1));
    const newBalanceOut = newProd.div(newBalanceIn);
    
    return balanceOut.gt(newBalanceOut) ? balanceOut.sub(newBalanceOut) : ethers.BigNumber.from(0);
    
  } else {
    // Constant product (x * y = k) - default
    const product = balanceIn.mul(balanceOut);
    const newBalanceIn = balanceIn.add(amountInAfterFee);
    const newBalanceOut = product.div(newBalanceIn);
    return balanceOut.gt(newBalanceOut) ? balanceOut.sub(newBalanceOut) : ethers.BigNumber.from(0);
  }
}

function calculateTotalFees(path) {
  return path.reduce((total, hop) => {
    const fee = ethers.BigNumber.from(hop.amountIn)
      .mul(Math.floor(parseFloat(hop.swapFee) * 10000))
      .div(10000);
    return total.add(fee);
  }, ethers.BigNumber.from(0));
}

function calculatePriceImpact(amountIn, amountOut, path) {
  if (!amountOut || amountOut.isZero()) return '100'; // 100% impact if no output
  
  const inputBN = ethers.BigNumber.from(amountIn);
  const outputBN = ethers.BigNumber.from(amountOut);
  
  // Calculate expected price without slippage (using first pool's ratio)
  const firstHop = path[0];
  const spotPrice = firstHop.amountOut.mul(ethers.utils.parseEther('1')).div(firstHop.amountIn);
  
  // Calculate actual price
  const actualPrice = outputBN.mul(ethers.utils.parseEther('1')).div(inputBN);
  
  // Price impact = (spotPrice - actualPrice) / spotPrice * 100
  if (spotPrice.isZero()) return '0';
  
  const impact = spotPrice.sub(actualPrice).mul(10000).div(spotPrice);
  return impact.abs().toString();
}

function calculateMinAmountOut(amountOut, slippageTolerance) {
  const slippageFactor = Math.floor((100 - slippageTolerance) * 100);
  return amountOut.mul(slippageFactor).div(10000);
}

export default useBalancerV3;