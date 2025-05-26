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

import CommandsJSON from '@uniswap/universal-router/artifacts/contracts/libraries/Commands.sol/Commands.json'
import ActionsJSON  from '@uniswap/v4-periphery/foundry-out/Actions.sol/Actions.json'

// Pull the enum‐maps out of the compiled JSON
const Commands = (CommandsJSON).values
const Actions  = (ActionsJSON).values

const nativeAddress = '0x0000000000000000000000000000000000000000';
const chainId = 1;

// ----------------------------
// Configuration constants
// ----------------------------
const QUOTER_ADDRESS             = '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203';
const API_KEY                    = '85a93cb8cc32fa52390e51a09125a6fc';
const SUBGRAPH_ID                = 'DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G';
const SUBGRAPH_URL               = `https://gateway.thegraph.com/api/${API_KEY}/subgraphs/id/${SUBGRAPH_ID}`;

const STATE_VIEW_ADDRESS   = '0x7ffe42c4a5deea5b0fec41c94c136cf115597227';

const POSITION_MANAGER_ADDRESS   = '0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e';
const POSITION_MANAGER_ABI       = [
  'function poolKeys(bytes25 poolId) view returns (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)'
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

  const quoter          = new ethers.Contract(QUOTER_ADDRESS, QUOTER_ABI, provider);
  const positionManager = new ethers.Contract(POSITION_MANAGER_ADDRESS, POSITION_MANAGER_ABI, provider);

  // --- Path finding ---
  async function findPossiblePaths(tokenInObject, tokenOutObject) {
    const tokenIn = tokenInObject.address.toLowerCase();
    const tokenOut = tokenOutObject.address.toLowerCase();

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
            first: 1000
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
      if (!pool.liquidity || pool.liquidity === "0" || Number(pool.totalValueLockedUSD) < 10) continue // TOOD: skip if liquidity very low
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
        JSBI.BigInt(pool.liquidity),
        safeTick,
        tickProvider,
      );
      console.log(poolInstance);
      console.log(pool.id + ' built')
      pools.push(poolInstance);
      // return [poolInstance]
    }
    return pools;
  }

  function alignTickAndPrice(sqrtPriceDecStr, spacing) {
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

    const tokenA = new Token(chainId, tokenInObject.address, tokenInObject.decimals, tokenInObject.symbol);
    const tokenB = new Token(chainId, tokenOutObject.address, tokenOutObject.decimals, tokenOutObject.symbol);
    const amountIn = CurrencyAmount.fromRawAmount(tokenA, rawIn.toString());
    let trades;
    try {
      const sanePools = [];
      for (const p of pools) {
        if (
          p.involvesToken(tokenA) &&
          p.involvesToken(tokenB)
          // (await isPoolUsable(p, amountIn))
        ) {
          sanePools.push(p);
        }
      }

      console.log('Sane pools: ' + sanePools.length);
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

  async function isPoolUsable(pool, amountIn) {
    try {
      // getOutputAmount throws if liquidity == 0 or if price/tick are inconsistent
      const [amountOut] = await pool.getOutputAmount(amountIn);
      return !JSBI.equal(amountOut.quotient, JSBI.BigInt(0));
    } catch (err) {
      console.warn('⚠️  pool skipped:', pool.poolId.toString(), err.message);
      return false;
    }
  }

  async function executeSwapExactInSingle(tradeDetails, fromAddress, slippageBips = 50) {
    loading.value = true
    error.value   = null

    const trade = tradeDetails.swap;

    try {
      // 1) Pull out the route and amounts from the SDK Trade
      const route       = trade.route
      const amountIn    = trade.inputAmount         // CurrencyAmount
      const amountOut   = trade.outputAmount        // CurrencyAmount

      // 2) Build the PoolKey struct to identify our v4 pool
      const poolKey = {
        currency0: route.pools[0].token0.address,      // lower-sorted token
        currency1: route.pools[0].token1.address,      // higher-sorted token
        fee:       route.pools[0].fee,                 // e.g. 3000
        tickSpacing: route.pools[0].tickSpacing,       // e.g. 60
        hooks:     route.pools[0].hooks                // usually the zero-address
      }

      // 3) Compute minimumAmountOut based on slippage tolerance
      //    (e.g. amountOut * (1 - slippageBips/10_000))
      const minAmountOut = BigNumber.from(amountOut.quotient.toString())
        .mul(BigNumber.from(10_000 - slippageBips))
        .div(BigNumber.from(10_000))

      // 4) Encode the single byte command V4_SWAP
      //    (Commands.V4_SWAP === the 5-bit command ID for v4 swaps) :contentReference[oaicite:2]{index=2}
      const commands = ethers.utils.solidityPack(
        ['uint8'],
        [Commands.V4_SWAP]
      )

      // 5) Encode the V4Router actions: SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
      //    (this tells the router exactly which steps to run) :contentReference[oaicite:3]{index=3}
      const actions = ethers.utils.solidityPack(
        ['uint8','uint8','uint8'],
        [
          Actions.SWAP_EXACT_IN_SINGLE,
          Actions.SETTLE_ALL,
          Actions.TAKE_ALL
        ]
      )

      // 6) Prepare the three sets of parameters matching those actions:
      //    0: ExactInputSingleParams, 1: settle (tokenIn, amountIn), 2: take (tokenOut, minOut)
      const params = [
        // --- 0) swap config ---
        ethers.utils.defaultAbiCoder.encode(
          [
            `(tuple(
               address currency0,
               address currency1,
               uint24 fee,
               int24 tickSpacing,
               address hooks
             ) poolKey,
             bool zeroForOne,
             uint128 amountIn,
             uint128 amountOutMinimum,
             bytes hookData)`
          ],
          [
            {
              poolKey,
              zeroForOne: route.pools[0].token0.address.toLowerCase()
                           === trade.inputAmount.currency.address.toLowerCase(),
              amountIn:    BigNumber.from(amountIn.quotient.toString()),
              amountOutMinimum: minAmountOut,
              hookData:    '0x'
            }
          ]
        ),

        // --- 1) SETTLE_ALL params: pull `amountIn` of currency0 from user via Permit2 ---
        ethers.utils.defaultAbiCoder.encode(
          ['address','uint256'],
          [ poolKey.currency0, amountIn.quotient.toString() ]
        ),

        // --- 2) TAKE_ALL params: send at least `minAmountOut` of currency1 to user ---
        ethers.utils.defaultAbiCoder.encode(
          ['address','uint256'],
          [ poolKey.currency1, minAmountOut.toString() ]
        )
      ]

      // 7) Finally, bundle actions+params into the single `inputs[0]`
      //    (the Universal Router expects inputs[i] = abi.encode(actions, params)) :contentReference[oaicite:4]{index=4}
      const inputs = [
        ethers.utils.defaultAbiCoder.encode(
          ['bytes','bytes[]'],
          [ actions, params ]
        )
      ]

      // 8) Build a tight deadline (now + 20s) to protect from stale execution
      const deadline = Math.floor(Date.now() / 1_000) + 20

      // 9) Call the router — include ETH value if swapping native token → ERC20
      const useNative = trade.inputAmount.currency.isNative
      const tx = await window.electronAPI.sendTrade({
        tradeDetails,
        args: [
          commands,
          inputs,
          deadline,
          { value: useNative ? amountIn.quotient.toString() : 0 }
        ]
      })

      // 10) Track and await confirmation
      txHash.value = tx.hash
      return tx;
    } catch (e) {
      error.value = e
    } finally {
      loading.value = false
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
    executeSwapExactInSingle,
  };
}