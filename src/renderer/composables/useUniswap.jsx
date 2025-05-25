// useUniswapV4.js
// A Vue 3 composable for Uniswap V4 swaps, path finding, best-route selection,
// price tracking, and swap execution in an Electron + Vue3 environment.
// Requires: ethers.js, graphql-request
// npm install ethers graphql-request
import JSBI from 'jsbi';
import { Token, CurrencyAmount } from '@uniswap/sdk-core';
import { Pool, Trade } from '@uniswap/v4-sdk';
import { TickMath, TickListDataProvider } from '@uniswap/v3-sdk';


import { ref } from 'vue';
import { ethers, BigNumber } from 'ethers';
import { request, gql } from 'graphql-request';
import provider from '@/ethersProvider';
const abiCoder = ethers.utils.defaultAbiCoder;

const nativeAddress = '0x0000000000000000000000000000000000000000';
const chainId = 1;

// ----------------------------
// Configuration constants
// ----------------------------
const UNIVERSAL_ROUTER_ADDRESS   = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af';
const QUOTER_ADDRESS             = '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203';
const API_KEY                    = '85a93cb8cc32fa52390e51a09125a6fc';
const SUBGRAPH_ID                = 'DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G';
const SUBGRAPH_URL               = `https://gateway.thegraph.com/api/${API_KEY}/subgraphs/id/${SUBGRAPH_ID}`;

const STATE_VIEW_ADDRESS   = '0x7ffe42c4a5deea5b0fec41c94c136cf115597227';

const POSITION_MANAGER_ADDRESS   = '0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e';
const POSITION_MANAGER_ABI       = [
  'function poolKeys(bytes25 poolId) view returns (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)'
];

const UNIVERSAL_ROUTER_ABI       = [
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) external payable returns (bytes[] memory results)'
];
const QUOTER_ABI                 = [
  'function quoteExactInput((address currencyIn, tuple(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path, uint256 exactAmount) params) external view returns (uint256 amountOut, uint256 gasEstimate)'
];

export function useUniswapV4() {
  // Reactive state
  const txHash       = ref(null);
  const error        = ref(null);
  const loading      = ref(false);
  const priceHistory = ref([]); // stores { timestamp, tokenIn, tokenOut, amountIn, amountOut }

  // Contracts
  const signer          = new ethers.Wallet('0xea837b966452b9968eb6d388d04823d85ddb4b2649d19c6e7615d133fcb76564', provider);
  const router          = new ethers.Contract(UNIVERSAL_ROUTER_ADDRESS, UNIVERSAL_ROUTER_ABI, signer);
  const quoter          = new ethers.Contract(QUOTER_ADDRESS, QUOTER_ABI, provider);
  const positionManager = new ethers.Contract(POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, provider);

  // --- Path finding ---
  async function findPossiblePaths(tokenInObject, tokenOutObject) {
    const tokenIn = tokenInObject.address.toLowerCase();
    const tokenOut = tokenOutObject.address.toLowerCase();

    const paths = [];
    // Direct pools
    const directPoolsQuery = gql`
      query($a: String!, $b: String!){
        pools(
          where:{token0_in:[$a,$b],token1_in:[$a,$b]},
          first: 50
        ) {
          id
          feeTier
          hooks
          liquidity
          sqrtPrice
          tick
          tickSpacing
          token0Price
          token1Price
          totalValueLockedUSD
          token0 {
            id
          }
          token1 {
            id
          }
          ticks(
            where: { liquidityGross_not: "0" },
            first: 100000
          ) {
            tickIdx
            liquidityNet
            liquidityGross
          }
        }
      }
    `;
    const { pools: directPools } = await request(SUBGRAPH_URL, directPoolsQuery, { a: tokenIn, b: tokenOut });
    const tokenA = new Token(chainId, tokenIn, tokenInObject.decimals, tokenInObject.symbol);
    const tokenB = new Token(chainId, tokenOut, tokenOutObject.decimals, tokenOutObject.symbol);
    const pools = [];
    for (const pool of directPools) {
      if (!pool.liquidity || pool.liquidity === "0" || Number(pool.totalValueLockedUSD) < 10000) continue // TOOD: skip if liquidity very low
      console.log(pool);

      let token0, token1;
      if (pool.token0?.id.toLowerCase() !== tokenA.address.toLowerCase()) {
        console.log('inverting')
        token0 = tokenB;
        token1 = tokenA;
      } else {
        token0 = tokenA;
        token1 = tokenB;
      }
      
      console.log('building ' + pool.id)

      const { tick: safeTick, sqrt: sqrtAligned } =
        alignTickAndPrice(pool.sqrtPrice, Number(pool.tickSpacing));
      
      const cleanedTicks  = sanitiseTicks(pool.ticks, Number(pool.tickSpacing))
      const tickProvider  = new TickListDataProvider(cleanedTicks, Number(pool.tickSpacing))

      const poolInstance = new Pool(
        token0, 
        token1, 
        Number(pool.feeTier), 
        Number(pool.tickSpacing), 
        pool.hooks,
        sqrtAligned,
        // JSBI.BigInt(pool.sqrtPrice),
        JSBI.BigInt(pool.liquidity),
        safeTick,
        // pool.tick,
        tickProvider,
      );
      console.log(poolInstance);
      console.log(pool.id + ' built')
      pools.push(poolInstance);
    }
    return pools;
  }

  function alignTickAndPrice(sqrtPriceDecStr, spacing) {
    console.log(sqrtPriceDecStr)
    const exactTick  = TickMath.getTickAtSqrtRatio(JSBI.BigInt(sqrtPriceDecStr));
    const aligned    = Math.floor(exactTick / spacing) * spacing;
    const sqrtAtTick = TickMath.getSqrtRatioAtTick(aligned);
    return {tick: aligned, sqrt: sqrtAtTick}
  }

  function sanitiseTicks(raw, spacing) {
    const seen   = new Set();
    const ticks  = [];

    for (const t of raw) {
      const idx = Number(t.tickIdx);

      // keep only multiples of spacing and within range
      if (idx % spacing !== 0) continue;
      if (idx < TickMath.MIN_TICK || idx > TickMath.MAX_TICK) continue;

      if (!seen.has(idx)) {
        ticks.push({
          index:           idx,
          liquidityNet:    JSBI.BigInt(t.liquidityNet),
          liquidityGross:  JSBI.BigInt(t.liquidityGross)
        });
        seen.add(idx);
      }
    }

    // sort ascending as the SDK expects
    return ticks.sort((a, b) => a.index - b.index);
  }

  async function selectBestPath(tokenInObject, tokenOutObject, pools, rawIn) {
    if (!BigNumber.isBigNumber(rawIn)) {
      throw new Error('[selectBestPath] rawIn must be an ethers.BigNumber');
    }
    if (rawIn.isZero()) {
      throw new Error('[selectBestPath] rawIn cannot be zero');
    }
    if (pools.length === 0) {
      throw new Error('[selectBestPath] “pools” array is empty – cannot route');
    }

    // const route = new Route(pools, tokenInObject.address, tokenOutObject.address);
    // const amountIn = CurrencyAmount.fromRawAmount(tokenInObject.address, inputAmountWei);
    console.log({rawIn, s: rawIn.toString()})

    const tokenA = new Token(chainId, tokenInObject.address, tokenInObject.decimals, tokenInObject.symbol);
    const tokenB = new Token(chainId, tokenOutObject.address, tokenOutObject.decimals, tokenOutObject.symbol);
    const amountIn = CurrencyAmount.fromRawAmount(tokenA, rawIn.toString());
    let trades;
    try {
      const sanePools = [];
      for (const p of pools) {
        if (
          p.involvesToken(tokenA) &&
          p.involvesToken(tokenB) &&
          (await isPoolUsable(p, tokenA, tokenB, amountIn))
        ) {
          sanePools.push(p);
        }
      }

      console.log(sanePools.length);
      if (!sanePools.length) return []

      trades = await Trade.bestTradeExactIn(sanePools, amountIn, tokenB, { maxHops: 1, maxNumResults: 1 });
    } catch (err) {
      /* The only error the SDK throws here is the dreaded “Invariant failed”.
      Wrap it to give the caller real insight. */
      console.error('[selectBestPath] SDK invariant blew up:', err);
    }
    console.log(trades)
    // console.log({out: trade.outputAmount, cost: trade.executionPrice});
    return trades ? trades[0] : undefined;
      // trade.minimumAmountOut(slippageTolerance)
  }

  /** Combined helper: find and quote best path, stores price */
  async function findAndSelectBestPath(tokenInObject, tokenOutObject, amountIn) {
    const pools = await findPossiblePaths(tokenInObject, tokenOutObject);
    return await selectBestPath(tokenInObject, tokenOutObject, pools, amountIn);
  }

  async function isPoolUsable(pool, tokenIn, tokenOut, amountIn) {
    try {
      // getOutputAmount throws if liquidity == 0 or if price/tick are inconsistent
      console.log({pool, tokenIn, tokenOut, amountIn})
      const [amountOut] = await pool.getOutputAmount(amountIn);
      console.log(amountOut);
      return !JSBI.equal(amountOut.quotient, JSBI.BigInt(0));
    } catch (err) {
      console.warn('⚠️  pool skipped:', pool.poolId.toString(), err.message);
      return false;
    }
  }

  return {
    txHash,
    error,
    loading,
    priceHistory,
    findPossiblePaths,
    selectBestPath,
    findAndSelectBestPath,
  };
}