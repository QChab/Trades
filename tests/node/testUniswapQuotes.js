/**
 * Test file to analyze Uniswap SDK quote discrepancies
 * Compares SDK outputs with actual UI values to identify patterns
 */

import { ethers } from 'ethers';
import { useUniswapV4 } from '../composables/useUniswap.js';

// Pre-load the ESM module with JSBI fix
import { getV4SDK } from './uniswapV4ESM.js';

async function testUniswapQuotes() {
  console.log('='.repeat(80));
  console.log('UNISWAP V4 SDK QUOTE ACCURACY TEST');
  console.log('='.repeat(80));
  console.log('Testing different amounts to identify discrepancy patterns');
  console.log('');

  // Pre-load the V4 SDK to ensure JSBI is available
  const v4sdk = await getV4SDK;
  console.log('Loaded V4 SDK modules:', Object.keys(v4sdk).slice(0, 5).join(', '), '...');
  console.log('');

  const uniswap = useUniswapV4();

  // Token definitions
  const ONE = {
    address: '0x91c65c2a9a3adfe2424ecc4a4890b8334c3a8212',
    symbol: 'ONE',
    decimals: 18
  };

  const USDT = {
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    symbol: 'USDT',
    decimals: 6
  };

  const ETH = {
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    decimals: 18
  };

  const WETH = {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    symbol: 'WETH',
    decimals: 18
  };

  // Test cases structure
  const testCases = [
    // ONE -> ETH tests (small to large amounts)
    { from: ONE, to: ETH, amounts: ['0.1', '1', '10'] },
    // USDT -> ETH tests (medium to very large amounts)
    { from: USDT, to: ETH, amounts: ['100', '10000'] }
  ];

  console.log('Finding pools...\n');

  for (const testCase of testCases) {
    const { from, to, amounts } = testCase;

    console.log('─'.repeat(60));
    console.log(`${from.symbol} → ${to.symbol} Tests`);
    console.log('─'.repeat(60));

    // Find pools once for this pair
    const pools = await uniswap.findPossiblePools(from, to);
    console.log(`Found ${pools.length} pools for ${from.symbol}/${to.symbol}`);

    if (pools.length > 0) {
      // Log pool details
      const primaryPool = pools[0];
      console.log('\nPrimary Pool Details:');
      console.log(`  Fee tier: ${primaryPool.fee} (${primaryPool.fee / 10000}%)`);
      console.log(`  Liquidity: ${primaryPool.liquidity?.toString()}`);
      console.log(`  Tick: ${primaryPool.tick}`);
      console.log(`  SqrtPriceX96: ${primaryPool.sqrtPriceX96?.toString()}`);

      // Calculate current price
      if (primaryPool.sqrtPriceX96) {
        const sqrtPrice = ethers.BigNumber.from(primaryPool.sqrtPriceX96.toString());
        const Q96 = ethers.BigNumber.from(2).pow(96);
        const price = sqrtPrice.mul(sqrtPrice).div(Q96).div(Q96);
        console.log(`  Current price: 1 ${from.symbol} = ${ethers.utils.formatEther(price)} ${to.symbol}`);
      }
    }

    console.log('\n' + '='.repeat(40));
    console.log('Amount Tests:');
    console.log('='.repeat(40));

    for (const amountStr of amounts) {
      const amountIn = ethers.utils.parseUnits(amountStr, from.decimals);

      console.log(`\n${amountStr} ${from.symbol}:`);
      console.log('─'.repeat(30));

      if (pools.length === 0) {
        console.log('  No pools available');
        continue;
      }

      try {
        // Get the trade
        const trades = await uniswap.selectBestPath(from, to, pools, amountIn);

        if (trades && trades.length > 0) {
          const trade = trades[0];
          const outputAmount = ethers.utils.formatUnits(
            trade.outputAmount.quotient.toString(),
            to.decimals
          );

          // Calculate effective price
          const effectivePrice = parseFloat(outputAmount) / parseFloat(amountStr);

          // Calculate price impact (handle JSBI)
          let priceImpact = 'N/A';
          try {
            if (trade.priceImpact) {
              // Skip price impact for now to avoid JSBI errors
              priceImpact = 'Skipped (JSBI)';
            }
          } catch (e) {
            priceImpact = 'Error';
          }

          // Log results
          console.log(`  SDK Output: ${outputAmount} ${to.symbol}`);
          console.log(`  Effective Price: 1 ${from.symbol} = ${effectivePrice.toFixed(8)} ${to.symbol}`);
          console.log(`  Price Impact: ${priceImpact}%`);

          // Log route details
          if (trade.route || trade.swaps?.[0]?.route) {
            const route = trade.route || trade.swaps[0].route;
            console.log(`  Route: ${route.currencyPath.map(c => c.symbol || c.address.slice(0,6)).join(' → ')}`);
            console.log(`  Hops: ${route.pools.length}`);

            // Log each pool in the route
            route.pools.forEach((pool, i) => {
              console.log(`    Pool ${i+1}: Fee ${pool.fee} (${pool.fee/10000}%), Liquidity: ${pool.liquidity?.toString().slice(0,10)}...`);
            });
          }

          // Placeholder for UI comparison
          console.log(`  UI Output: [PENDING - Please provide]`);
          console.log(`  Difference: [TO BE CALCULATED]`);

          // Calculate some metrics that might help identify patterns
          let inputSizeRelativeToLiquidity = 0;
          try {
            if (pools[0].liquidity && typeof pools[0].liquidity.toString === 'function') {
              const liq = ethers.BigNumber.from(pools[0].liquidity.toString());
              inputSizeRelativeToLiquidity = parseFloat(ethers.utils.formatEther(amountIn)) /
                                            parseFloat(ethers.utils.formatEther(liq)) * 100;
            }
          } catch (e) {
            // Skip if liquidity calculation fails
          }

          console.log(`\n  Diagnostics:`);
          if (inputSizeRelativeToLiquidity > 0) {
            console.log(`    Input size vs liquidity: ${inputSizeRelativeToLiquidity.toFixed(6)}%`);
          }
          console.log(`    Amount in USD (approx): $${estimateUSDValue(from.symbol, amountStr)}`);

        } else {
          console.log('  No valid trades found');
        }

      } catch (error) {
        console.log(`  Error: ${error.message}`);
      }
    }

    console.log('\n');
  }

  console.log('='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
  console.log('\nPlease provide the UI values for comparison.');
  console.log('Format: [amount] [token] = [output] [token]');
  console.log('\nLooking for patterns in:');
  console.log('  1. Small vs large trade discrepancies');
  console.log('  2. Low vs high liquidity pool differences');
  console.log('  3. Stable (USDT) vs volatile (ONE) token behaviors');
  console.log('  4. Price impact correlation with discrepancy size');
}

// Helper function to estimate USD value (rough approximation)
function estimateUSDValue(token, amount) {
  const prices = {
    'ONE': 0.02,    // Approximate
    'USDT': 1.0,
    'ETH': 3500,    // Approximate
    'WETH': 3500
  };

  return (parseFloat(amount) * (prices[token] || 0)).toFixed(2);
}

// Run the test
testUniswapQuotes().catch(console.error);