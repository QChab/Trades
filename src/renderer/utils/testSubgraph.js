import axios from 'axios';

async function testSubgraph() {
  const subgraphUrl = 'https://gateway.thegraph.com/api/d692082c59f956790647e889e75fa84d/subgraphs/id/4rixbLvpuBCwXTJSwyAzQgsLR8KprnyMfyCuXT8Fj5cd';
  
  const query = `
    {
      pools(first: 2) {
        id
        address
        swapFee
        totalShares
        tokens {
          address
          balance
          decimals
          symbol
        }
      }
    }
  `;
  
  try {
    console.log('Testing subgraph query to:', subgraphUrl);
    const response = await axios.post(subgraphUrl, { query });
    
    if (response.data && response.data.data) {
      console.log('✅ Subgraph query successful!');
      console.log('Found pools:', response.data.data.pools.length);
      console.log('\nFirst pool details:');
      const firstPool = response.data.data.pools[0];
      console.log('ID:', firstPool.id);
      console.log('ID length:', firstPool.id.length);
      console.log('ID is bytes32?:', firstPool.id.length === 66);
      console.log('Address:', firstPool.address);
      console.log('Tokens:', firstPool.tokens.map(t => t.address + ' (' + t.symbol + ')').join(', '));
      
      // Check if we can fetch pools with WETH and USDC
      const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
      const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const relevantPools = response.data.data.pools.filter(pool => {
        const tokenAddresses = pool.tokens.map(t => t.address.toLowerCase());
        return (tokenAddresses.includes(weth.toLowerCase()) && tokenAddresses.includes(usdc.toLowerCase()));
      });
      console.log(`\nFound ${relevantPools.length} pools with both WETH and USDC`);
    } else {
      console.log('❌ No data returned from subgraph');
      console.log('Response:', response.data);
    }
  } catch (error) {
    console.error('❌ Subgraph query failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testSubgraph();