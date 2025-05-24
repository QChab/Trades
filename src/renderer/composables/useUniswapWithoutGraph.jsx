// fetchV4Quote.js
// Multi‐pool single‐hop quote on Uniswap V4 using @uniswap/v4-sdk + ethers v5
// npm install @uniswap/v4-sdk @uniswap/sdk-core ethers@^5.0.0

// -- 1. Ethers v5 imports:
import { Contract, constants, utils } from 'ethers';
import provider from './../ethersProvider'; // your configured JsonRpcProvider

// -- 2. Uniswap v4 SDK imports:
//    - Pool: V4 pool abstraction
//    - Trade: Trade entity with static helper bestTradeExactIn
//    - TradeType: EXACT_INPUT vs EXACT_OUTPUT
import {
  Pool,
  Trade,
  TradeType
} from '@uniswap/v4-sdk';

const FACTORY_ADDRESS = '0x000000000004444c5dc75cB358380D2e3dE08A90';
const FeeAmount = {
  LOWEST: 100,
  LOW:    500,
  MEDIUM: 3000,
  HIGH:   10000
}
// -- 4. Core SDK imports:
//    - ChainId, Token: wrap raw addresses into SDK tokens
//    - CurrencyAmount: wrap raw BigNumber into SDK amounts
import {
  ChainId,
  Token,
  CurrencyAmount
} from '@uniswap/sdk-core';

// -- 5. Minimal ABI for Uniswap V4 pool interactions
const IUniswapV4PoolABI = [
  // core pool parameters
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function tickSpacing() view returns (int24)',
  'function hooks() view returns (address)',
  // liquidity & price
  'function liquidity() view returns (uint128)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)'
];

// -- 6. Minimal ABI for the V4 factory's getPool call
const IUniswapV4FactoryABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)'
];

// -- 7. Destructure ethers constants & utils we still need:
const { AddressZero } = constants;
const { parseUnits }     = utils;

/**
 * fetchV4Quote
 * -------------
 * Fetches the best single‐hop swap quote on Uniswap V4 for a given token pair and input amount,
 * automatically aggregating across all available fee tiers by calling getPool on‐chain.
 *
 * @param {string} tokenInAddress    - ERC20 token address to swap from
 * @param {string} tokenOutAddress   - ERC20 token address to swap to
 * @param {string|number} amountInRaw- Human-readable input amount (e.g. "1.5" or 2)
 *
 * @returns {Trade}                  - Best Trade object from @uniswap/v4-sdk
 * @throws {Error}                   - If no pool with liquidity is found
 */
export async function fetchV4Quote(tokenInAddress, tokenOutAddress, amountInRaw) {
  console.log({tokenInAddress, tokenOutAddress, amountInRaw})
  // A) Wrap raw addresses as SDK Token instances on Mainnet
  const chainId  = ChainId.MAINNET;
  const tokenIn  = new Token(chainId, tokenInAddress, 18);
  const tokenOut = new Token(chainId, tokenOutAddress, 18);

  // B) Fee tiers to probe, from lowest to highest
  const feesToTry = [
    FeeAmount.LOWEST,  // 0.01%
    FeeAmount.LOW,     // 0.05%
    FeeAmount.MEDIUM,  // 0.30%
    FeeAmount.HIGH     // 1.00%
  ];

  // C) Instantiate the factory contract once
  const factoryContract = new Contract(
    FACTORY_ADDRESS,
    IUniswapV4FactoryABI,
    provider
  );

  // D) Collect all on‐chain pools that actually exist and have liquidity
  const pools = [];
  for (const fee of feesToTry) {
    // 1) Ensure token order matches Uniswap's pool key conventions
    const [tokenA, tokenB] = tokenIn.sortsBefore(tokenOut)
      ? [tokenIn, tokenOut]
      : [tokenOut, tokenIn];

    // 2) Ask the factory for this fee tier's pool address
    let poolAddress;
    try {
      poolAddress = await factoryContract.getPool(
        tokenA.address,
        tokenB.address,
        fee
      );
      console.log(poolAddress);
    } catch (err) {
      console.error(err);
      // If the factory call reverts or fails, skip this tier
      continue;
    }

    // 3) If no pool deployed for this tier, skip
    if (!poolAddress || poolAddress === AddressZero) continue;

    // 4) Instantiate a minimal ethers Contract for the pool
    const pc = new Contract(poolAddress, IUniswapV4PoolABI, provider);

    try {
      // 5) Read immutables & state in parallel
      const [t0, t1, f, spacing, hooks] = await Promise.all([
        pc.token0(),
        pc.token1(),
        pc.fee(),
        pc.tickSpacing(),
        pc.hooks()
      ]);
      const [liquidity, slot0] = await Promise.all([
        pc.liquidity(),
        pc.slot0()
      ]);

      // 6) Build the SDK Pool object
      const pool = new Pool({
        token0:       new Token(chainId, t0, 18),
        token1:       new Token(chainId, t1, 18),
        fee:          Number(f),
        tickSpacing:  Number(spacing),
        hooks,
        sqrtPriceX96: slot0.sqrtPriceX96,
        liquidity,
        tick:         slot0.tick
      });

      // 7) Only include pools with non-zero liquidity
      if (pool.liquidity.gt(0)) {
        pools.push(pool);
      }
    } catch (err) {
      console.error(err);
      // on-chain read failed → assume no usable pool
      continue;
    }
  }

  // E) If we found no pools at all, bail out
  if (pools.length === 0) {
    throw new Error('No V4 pools with liquidity found for provided tokens.');
  }

  // F) Convert human input into a CurrencyAmount
  const rawAmountInBn = parseUnits(amountInRaw.toString(), tokenIn.decimals);
  const amountIn = CurrencyAmount.fromRawAmount(
    tokenIn,
    rawAmountInBn.toString()
  );

  // G) Use Uniswap's built-in bestTradeExactIn to pick the top single-hop quote
  const [bestTrade] = Trade.bestTradeExactIn(
    pools,
    amountIn,
    tokenOut,
    {
      maxNumResults: 1, // only top result
      maxHops:       1  // single-hop only
    }
  );

  if (!bestTrade) {
    throw new Error('No route could be constructed for an exact-in swap.');
  }

  // H) Debug logging
  console.log(`→ Best fee tier: ${bestTrade.swaps[0].route.pools[0].fee / 10000}%`);
  console.log(`→ Expected output: ${bestTrade.outputAmount.toExact()}`);

  return bestTrade;
}

export default fetchV4Quote;