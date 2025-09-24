// Uniswap V4 Pool Query Utility
// Extracts pool information from Odos paths and queries The Graph

class UniswapV4PoolQuery {
  constructor() {
    // Uniswap V4 subgraph endpoint (example - may need to be updated)
    this.graphEndpoint = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v4';
    
    // Pool manager address for Uniswap V4
    this.poolManagerAddress = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af';
  }

  // Extract Uniswap V4 pools from parsed Odos paths
  extractUniswapV4Pools(swapPaths) {
    const uniV4Pools = new Map(); // Use Map to avoid duplicates
    
    swapPaths.forEach(path => {
      // Check if this is a Uniswap V4 swap
      if (path.protocol === 'uniswapV4' || path.protocolLabel === 'Uniswap V4') {
        // Get token addresses
        const tokenA = path.sourceToken.address || this.getTokenAddress(path.sourceToken.symbol);
        const tokenB = path.targetToken.address || this.getTokenAddress(path.targetToken.symbol);
        
        if (tokenA && tokenB) {
          // Create a unique key for the pool (sort addresses for consistency)
          const [token0, token1] = this.sortTokens(tokenA, tokenB);
          const poolKey = `${token0}-${token1}`;
          
          // Store pool info
          if (!uniV4Pools.has(poolKey)) {
            uniV4Pools.set(poolKey, {
              token0: {
                address: token0,
                symbol: token0 === tokenA ? path.sourceToken.symbol : path.targetToken.symbol,
                decimals: token0 === tokenA ? path.sourceToken.decimals : path.targetToken.decimals
              },
              token1: {
                address: token1,
                symbol: token1 === tokenA ? path.sourceToken.symbol : path.targetToken.symbol,
                decimals: token1 === tokenA ? path.sourceToken.decimals : path.targetToken.decimals
              },
              swaps: []
            });
          }
          
          // Add this swap to the pool's swaps
          uniV4Pools.get(poolKey).swaps.push({
            inputAmount: path.inputValue,
            outputAmount: path.outputValue,
            percentage: path.percentage,
            hopIndex: path.hopIndex
          });
        }
      }
    });
    
    return Array.from(uniV4Pools.values());
  }

  // Sort tokens by address (lowercase) for consistent ordering
  sortTokens(tokenA, tokenB) {
    const a = tokenA.toLowerCase();
    const b = tokenB.toLowerCase();
    return a < b ? [tokenA, tokenB] : [tokenB, tokenA];
  }

  // Get token address from symbol (helper function)
  getTokenAddress(symbol) {
    const addresses = {
      'ETH': '0x0000000000000000000000000000000000000000',
      'WETH': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      'USDC': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      'USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      'DAI': '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      'WBTC': '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
    };
    return addresses[symbol] || null;
  }

  // Build GraphQL query for Uniswap V4 pools
  buildPoolQuery(pools) {
    // Note: The exact query structure depends on the V4 subgraph schema
    // This is an example based on typical pool queries
    const poolQueries = pools.map((pool, index) => {
      const token0 = pool.token0.address.toLowerCase();
      const token1 = pool.token1.address.toLowerCase();
      
      return `
        pool${index}: pools(
          where: {
            token0: "${token0}"
            token1: "${token1}"
          }
          first: 5
          orderBy: liquidity
          orderDirection: desc
        ) {
          id
          token0 {
            id
            symbol
            decimals
          }
          token1 {
            id
            symbol
            decimals
          }
          fee
          liquidity
          sqrtPrice
          tick
          tickSpacing
          hooks
          volumeUSD
          txCount
        }
      `;
    });

    return `
      query GetUniswapV4Pools {
        ${poolQueries.join('\n')}
      }
    `;
  }

  // Query The Graph for pool information
  async queryPoolsFromGraph(pools) {
    try {
      const query = this.buildPoolQuery(pools);
      
      console.log('Querying The Graph for Uniswap V4 pools...');
      console.log('Pools to query:', pools.map(p => `${p.token0.symbol}/${p.token1.symbol}`).join(', '));
      
      const response = await fetch(this.graphEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query
        })
      });

      if (!response.ok) {
        throw new Error(`Graph query failed: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.errors) {
        console.error('Graph query errors:', data.errors);
        throw new Error('Graph query returned errors');
      }

      return this.parseGraphResponse(data.data, pools);
    } catch (error) {
      console.error('Error querying The Graph:', error);
      throw error;
    }
  }

  // Parse the Graph response and match with our pools
  parseGraphResponse(graphData, requestedPools) {
    const poolsWithGraphData = [];
    
    requestedPools.forEach((requestedPool, index) => {
      const graphPools = graphData[`pool${index}`] || [];
      
      if (graphPools.length > 0) {
        // Use the most liquid pool (first one, as we ordered by liquidity)
        const bestPool = graphPools[0];
        
        poolsWithGraphData.push({
          ...requestedPool,
          poolId: bestPool.id,
          fee: parseInt(bestPool.fee),
          liquidity: bestPool.liquidity,
          sqrtPrice: bestPool.sqrtPrice,
          tick: parseInt(bestPool.tick),
          tickSpacing: parseInt(bestPool.tickSpacing),
          hooks: bestPool.hooks,
          volumeUSD: parseFloat(bestPool.volumeUSD),
          txCount: parseInt(bestPool.txCount),
          // Include alternative pools if they exist
          alternativePools: graphPools.slice(1).map(p => ({
            id: p.id,
            fee: parseInt(p.fee),
            liquidity: p.liquidity
          }))
        });
      } else {
        // No pool found in Graph
        poolsWithGraphData.push({
          ...requestedPool,
          error: 'No pool found in Graph'
        });
      }
    });
    
    return poolsWithGraphData;
  }

  // Main function to process Odos paths and get pool data
  async processOdosPaths(swapPaths) {
    console.log('\n=== UNISWAP V4 POOL EXTRACTION ===\n');
    
    // Step 1: Extract Uniswap V4 pools from paths
    const uniV4Pools = this.extractUniswapV4Pools(swapPaths);
    
    console.log(`Found ${uniV4Pools.length} unique Uniswap V4 pools:`);
    uniV4Pools.forEach(pool => {
      const totalVolume = pool.swaps.reduce((sum, swap) => sum + swap.inputValue, 0);
      console.log(`  ${pool.token0.symbol}/${pool.token1.symbol}: ${pool.swaps.length} swaps, total volume: ${totalVolume.toFixed(2)}`);
    });
    
    // Step 2: Query The Graph for pool details
    console.log('\nQuerying The Graph for pool details...');
    try {
      const poolsWithData = await this.queryPoolsFromGraph(uniV4Pools);
      
      console.log('\n=== POOL DETAILS FROM GRAPH ===\n');
      poolsWithData.forEach(pool => {
        if (pool.error) {
          console.log(`${pool.token0.symbol}/${pool.token1.symbol}: ${pool.error}`);
        } else {
          console.log(`${pool.token0.symbol}/${pool.token1.symbol}:`);
          console.log(`  Pool ID: ${pool.poolId}`);
          console.log(`  Fee: ${pool.fee / 10000}%`);
          console.log(`  Liquidity: ${pool.liquidity}`);
          console.log(`  Volume (USD): $${pool.volumeUSD}`);
          console.log(`  TX Count: ${pool.txCount}`);
          if (pool.alternativePools.length > 0) {
            console.log(`  Alternative pools: ${pool.alternativePools.length}`);
          }
        }
      });
      
      return poolsWithData;
    } catch (error) {
      console.error('Failed to query The Graph:', error.message);
      // Return pools without Graph data
      return uniV4Pools.map(pool => ({
        ...pool,
        error: 'Graph query failed'
      }));
    }
  }

  // Generate pool IDs for Uniswap V4 (may differ from V3)
  generatePoolId(token0, token1, fee, tickSpacing, hooks = '0x0000000000000000000000000000000000000000') {
    // Uniswap V4 uses a different pool key structure
    // This is a simplified version - actual implementation may vary
    const poolKey = {
      currency0: token0,
      currency1: token1,
      fee: fee,
      tickSpacing: tickSpacing,
      hooks: hooks
    };
    
    // In V4, pool IDs are computed differently
    // This would need to match the actual V4 implementation
    return `${token0}-${token1}-${fee}-${tickSpacing}-${hooks}`.toLowerCase();
  }
}

export default UniswapV4PoolQuery;