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

  /**
   * The Graph returns pool.id as a 32-byte hex, but Uniswap V4’s poolKeys()
   * wants a 25-byte ID (the last 25 bytes of that 32-byte blob).
   *
   * @param {string} poolIdHex  – 0x-prefixed 32-byte hex from the Subgraph
   * @returns {Promise<{
   *   currency0: string,
   *   currency1: string,
   *   fee: number,
   *   tickSpacing: number,
   *   hooks: string
   * }>}
   */
  async function getPoolKey(poolIdHex) {
    // 1) Sanity: must be a 0x-prefixed string
    if (typeof poolIdHex !== 'string' || !poolIdHex.startsWith('0x')) {
      throw new Error(`getPoolKey: expected hex string, got ${poolIdHex}`);
    }

    // 2) Must be exactly 32 bytes (64 hex chars + '0x')
    const hexLen = poolIdHex.length - 2;
    if (hexLen !== 64) {
      throw new Error(`getPoolKey: expected 32-byte hex (64 chars), got ${hexLen} chars`);
    }

    const slicedId = ethers.utils.hexDataSlice(poolIdHex, 0, 25);
    
    // 4) Verify we now have 25 bytes (50 hex chars + '0x')
    const slicedLen = (slicedId.length - 2) / 2;
    if (slicedLen !== 25) {
      throw new Error(
        `getPoolKey: sliced length is ${slicedLen} bytes (expected 25): ${slicedId}`
      );
    }

    // 5) Debug-log so you can copy/paste this into Etherscan’s "read" UI
    // console.log('getPoolKey → calling poolKeys with ID:', slicedId);

    // 6) Do the on-chain view call
    const [currency0, currency1, feeBN, tickSpacingBN, hooks] =
      await positionManager.poolKeys(slicedId);

    if (!currency0 || !currency1)
      return {}

    // 7) Return plain JS types
    return {
      currency0,
      currency1,
      fee:         Number(feeBN),        // uint24 → number
      tickSpacing: Number(tickSpacingBN),// int24 → number
      hooks,
      fullId: poolIdHex,
      id: slicedId,
    };
  }

  // --- Low-level V4 swap ---
  async function swapExactInputSingle(poolKey, zeroForOne, amountIn, minAmountOut, recipient, deadline, ethValue = 0) {
    loading.value = true;
    error.value   = null;
    try {
      // Build commands and inputs
      const commands = ethers.utils.solidityPack(['uint8'], [1]); // V4_SWAP
      const actions  = ethers.utils.solidityPack(['uint8','uint8','uint8'], [0,1,2]);
      const exactIn  = abiCoder.encode(
        ['tuple(tuple(address,address,uint24,int24,address) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)'],
        [{ poolKey: [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks], zeroForOne, amountIn, amountOutMinimum: minAmountOut, hookData: '0x' }]
      );
      const settle   = abiCoder.encode(['address','uint128'], [ zeroForOne ? poolKey.currency0 : poolKey.currency1, amountIn ]);
      const take     = abiCoder.encode(['address','uint128'], [ zeroForOne ? poolKey.currency1 : poolKey.currency0, minAmountOut ]);
      const inputs   = [abiCoder.encode(['bytes','bytes[]'], [actions, [exactIn, settle, take]])];

      // Execute swap
      const tx = await router.execute(commands, inputs, deadline, { value: ethValue });
      txHash.value = tx.hash;
      await tx.wait();
    } catch (e) {
      console.error('swapExactInputSingle error:', e);
      error.value = e;
    } finally {
      loading.value = false;
    }
  }

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
          ticks(where: { liquidityGross_not: "0" }) {
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

      paths.push([{ poolKey: {
        currency0: pool.token0?.id,
        currency1: pool.token1?.id,
        fee: pool.feeTier,
        tickSpacing: pool.tickSpacing,
        hooks: pool.hooks,
        id: pool.id,
        token0Price: Number(pool.token0Price),
        token1Price: Number(pool.token1Price),
      }, zeroForOne: pool.token0?.id.toLowerCase() === tokenIn }]);

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

      // console.log(token0, 
      //   token1, 
      //   Number(pool.feeTier), 
      //   Number(pool.tickSpacing), 
      //   pool.hooks,
      //   sqrtAligned,
      //   JSBI.BigInt(pool.liquidity),
      //   safeTick,
      //   sanitiseTicks(pool.ticks, Number(pool.tickSpacing)),
      // )
      /**  true ⇢ value is a JSBI bigint  */
      const JSBI_PROTO = Object.getPrototypeOf(JSBI.BigInt(0))

      /** true ⇢ v is the boxed BigInt created by JSBI.BigInt(..)  */
      function isJSBI(v) {
        return Object.getPrototypeOf(v) === JSBI_PROTO;
      }

      function assertJSBI(label, v) {
        if (!isJSBI(v)) console.warn(`⚠️  ${label} is **NOT** JSBI →`, v);
      }

      // assertJSBI('sqrtRatioX96', sqrtAligned);            // must warn = string
      // assertJSBI('liquidity',    JSBI.BigInt(pool.liquidity));
      // sanitiseTicks(pool.ticks, Number(pool.tickSpacing)).forEach((t, i) => {
      //   assertJSBI(`ticks[${i}].liquidityGross`, t.liquidityGross);
      //   assertJSBI(`ticks[${i}].liquidityNet`,   t.liquidityNet);
      // });
      const cleanedTicks  = sanitiseTicks(pool.ticks, Number(pool.tickSpacing))
      const tickProvider  = new TickListDataProvider(cleanedTicks, Number(pool.tickSpacing))

      const poolInstance = new Pool(
        token0, 
        token1, 
        Number(pool.feeTier), 
        Number(pool.tickSpacing), 
        pool.hooks,
        sqrtAligned,
        JSBI.BigInt(pool.liquidity),
        safeTick,
        tickProvider,
      );
      console.log(poolInstance);
      console.log(pool.id + ' built')
      pools.push(poolInstance);
      return [poolInstance]
    }
    console.log(pools);
    return pools;
    // Two-hop pools
    // const twoQ = gql`query($a:String!,$b:String!){ poolsA:pools(where:{or:[{token0:$a},{token1:$a}]},first:20){ id } poolsB:pools(where:{or:[{token0:$b},{token1:$b}]},first:20){ id }}`;
    // const { poolsA, poolsB } = await request(SUBGRAPH_URL, twoQ, { a, b });
    // const mapA = {};
    // for (const p of poolsA) {
    //   const keyA = await getPoolKey(p.id);
    //   if (!keyA.currency0 || !keyA.currency1) continue;
    //   const other = keyA.currency0.toLowerCase()===a ? keyA.currency1 : keyA.currency0;
    //   mapA[other.toLowerCase()] = keyA;
    // }
    // for (const p of poolsB) {
    //   const keyB = await getPoolKey(p.id);
    //   if (!keyB.currency0 || !keyB.currency1) continue;

    //   const other = keyB.currency0.toLowerCase()===b ? keyB.currency1 : keyB.currency0;
    //   const keyA = mapA[other.toLowerCase()];
    //   if (keyA) {
    //     paths.push([
    //       { poolKey: keyA, zeroForOne: keyA.currency0.toLowerCase()===a },
    //       { poolKey: keyB, zeroForOne: keyB.currency0.toLowerCase()===other.toLowerCase() }
    //     ]);
    //   }
    // }
    console.log({paths});
    if (!paths.length) throw new Error('No path found up to 2 hops');
    return paths;
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
      // if (idx < MIN_TICK60 || idx > MAX_TICK60) continue;

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
  async function basic_selectBestPath(tokenIn, paths, amountIn) {
    let best = { path: null, amountOut: 0 }

    for (const steps of paths) {
      // start with the user's raw amountIn
      let runningAmount = Number(amountIn)

      // for each hop, multiply by the appropriate tokenPrice
      for (const { poolKey, zeroForOne } of steps) {
        const price = zeroForOne
          ? poolKey.token0Price   // converting token0→token1
          : poolKey.token1Price   // converting token1→token0
        runningAmount = runningAmount * price
      }

      // compare to find the max
      if (runningAmount > best.amountOut) {
        best = { path: steps, amountOut: runningAmount }
      }
    }

    if (!best.path) throw new Error('No valid path quoted')

    // track it
    priceHistory.value.push({
      timestamp: Date.now(),
      tokenIn,
      // tokenOut,
      amountIn:  amountIn.toString(),
      amountOut: best.amountOut.toString(),
    })

    return best
  }

  // --- Best route + price tracking ---
  async function former_selectBestPath(tokenIn, paths, amountIn) {
    let best = { path:null, amountOut: 0n };
    for (const steps of paths) {
      console.log({steps});
      const paramPath = steps.map(({ poolKey, zeroForOne }) => ({
        intermediateCurrency: zeroForOne ? poolKey.currency1 : poolKey.currency0,
        fee: poolKey.fee,
        tickSpacing: poolKey.tickSpacing,
        hooks: poolKey.hooks,
        hookData: '0x'
      }));
      try {
        // ethers v6 style: call .staticCall on the method itself
        //
        // quoteExactInput returns (uint256 amountOut, uint256 gasEstimate)
        // so staticCall gives us a Result‐like array
        console.log({currencyIn:  tokenIn,
            path:        paramPath,
            exactAmount: amountIn})
        const result = await quoter
          .quoteExactInput        // <–– the read‐only method
          .staticCall({           // <–– simulate the call
            currencyIn:  tokenIn,
            path:        paramPath,
            exactAmount: amountIn
          });

        // destructure the tuple: [ amountOut, gasEstimate ]
        const [ amountOut /* , gasEstimate */ ] = result;
        console.log({ amountOut });
        if (amountOut > best.amountOut) {
          best = { path: steps, amountOut };
        }
      } catch (err) {
        console.log('quoteExactInput.staticCall failed for path', steps, err);
      }
    }
    if (!best.path) throw new Error('No valid path quoted');
    // Track price: amountOut per amountIn
    priceHistory.value.push({
      timestamp: Date.now(),
      tokenIn,
      tokenOut: best.path[best.path.length-1].poolKey.currency1,
      amountIn: amountIn.toString(),
      amountOut: best.amountOut.toString()
    });
    return best;
  }

  /** Combined helper: find and quote best path, stores price */
  async function findAndSelectBestPath(tokenInObject, tokenOutObject, amountIn) {
    const pools = await findPossiblePaths(tokenInObject, tokenOutObject);
    return await selectBestPath(tokenInObject, tokenOutObject, pools, amountIn);
  }

  // --- Convenience swap methods ---
  async function swapEthForTokenV4(poolId, minTokensOut, recipient, ethAmount) {
    const key = await getPoolKey(poolId);
    const zeroForOne = true;
    const deadline    = Math.floor(Date.now()/1000) + 600;
    await swapExactInputSingle(key, zeroForOne, ethAmount, minTokensOut, recipient, deadline, ethAmount);
  }
  async function swapTokenForEthV4(poolId, minEthOut, recipient, amountIn) {
    const key = await getPoolKey(poolId);
    const zeroForOne = false;
    const deadline    = Math.floor(Date.now()/1000) + 600;
    await swapExactInputSingle(key, zeroForOne, amountIn, minEthOut, recipient, deadline);
  }
  async function swapTokenForTokenV4(poolId, amountIn, minAmountOut, recipient) {
    const key = await getPoolKey(poolId);
    const zeroForOne = key.currency0.toLowerCase() < key.currency1.toLowerCase();
    const deadline    = Math.floor(Date.now()/1000) + 600;
    await swapExactInputSingle(key, zeroForOne, amountIn, minAmountOut, recipient, deadline);
  }

  async function isPoolUsable(pool, tokenIn, tokenOut, amountIn) {
    try {
      // getOutputAmount throws if liquidity == 0 or if price/tick are inconsistent
      const [amountOut] = await pool.getOutputAmount(amountIn);
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
    swapExactInputSingle,
    swapEthForTokenV4,
    swapTokenForEthV4,
    swapTokenForTokenV4
  };
}