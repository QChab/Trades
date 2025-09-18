import OdosAPI from './OdosAPI.js';
import UniswapV4PoolQuery from './UniswapV4PoolQuery.js';
import { complexResponse } from './ComplexResponse.js';

async function testPoolQuery() {
  console.log('=== TESTING UNISWAP V4 POOL QUERY ===\n');
  
  // Step 1: Parse the Odos response
  const odosAPI = new OdosAPI();
  const parsedResult = odosAPI.parseQuoteResponse(complexResponse);
  
  console.log(`Total paths: ${parsedResult.swapPaths.length}`);
  
  // Filter only Uniswap V4 paths for analysis
  const uniV4Paths = parsedResult.swapPaths.filter(path => 
    path.protocol === 'uniswapV4' || path.protocolLabel === 'Uniswap V4'
  );
  
  console.log(`Uniswap V4 paths: ${uniV4Paths.length}`);
  
  // Step 2: Extract and query pools
  const poolQuery = new UniswapV4PoolQuery();
  const poolsWithData = await poolQuery.processOdosPaths(parsedResult.swapPaths);
  
  // Step 3: Generate summary
  console.log('\n=== SUMMARY ===\n');
  
  const totalUniV4Volume = uniV4Paths.reduce((sum, path) => sum + path.inputValue, 0);
  console.log(`Total Uniswap V4 volume: ${totalUniV4Volume.toFixed(2)}`);
  
  // Group by token pair
  const pairVolumes = {};
  uniV4Paths.forEach(path => {
    const pair = `${path.sourceToken.symbol}/${path.targetToken.symbol}`;
    if (!pairVolumes[pair]) {
      pairVolumes[pair] = {
        count: 0,
        volume: 0,
        percentages: []
      };
    }
    pairVolumes[pair].count++;
    pairVolumes[pair].volume += path.inputValue;
    pairVolumes[pair].percentages.push(path.percentage);
  });
  
  console.log('\nVolume by pair:');
  Object.entries(pairVolumes)
    .sort((a, b) => b[1].volume - a[1].volume)
    .forEach(([pair, data]) => {
      const totalPercentage = data.percentages.reduce((sum, p) => sum + p, 0);
      console.log(`  ${pair}: ${data.count} swaps, volume: ${data.volume.toFixed(2)}, ${totalPercentage.toFixed(2)}% of total`);
    });
  
  return poolsWithData;
}

// Alternative: Direct Graph query for specific pools
async function querySpecificPools() {
  const poolQuery = new UniswapV4PoolQuery();
  
  // Example: Query specific token pairs
  const poolsToQuery = [
    {
      token0: {
        address: '0x0000000000000000000000000000000000000000',
        symbol: 'ETH',
        decimals: 18
      },
      token1: {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        decimals: 6
      },
      swaps: []
    },
    {
      token0: {
        address: '0x0000000000000000000000000000000000000000',
        symbol: 'ETH',
        decimals: 18
      },
      token1: {
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        symbol: 'USDT',
        decimals: 6
      },
      swaps: []
    }
  ];
  
  console.log('\n=== QUERYING SPECIFIC POOLS ===\n');
  
  try {
    const poolData = await poolQuery.queryPoolsFromGraph(poolsToQuery);
    return poolData;
  } catch (error) {
    console.error('Failed to query pools:', error);
    return null;
  }
}

// Run tests
if (process.env.NODE_ENV !== 'production') {
  testPoolQuery()
    .then(result => {
      console.log('\nPool query completed successfully');
      return querySpecificPools();
    })
    .then(result => {
      console.log('\nSpecific pool query completed');
    })
    .catch(error => {
      console.error('Test failed:', error);
    });
}

export { testPoolQuery, querySpecificPools };