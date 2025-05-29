// useUniswapV4.js
// A Vue 3 composable for Uniswap V4 swaps, path finding, best-route selection,
// price tracking, and swap execution in an Electron + Vue3 environment.
// Requires: ethers.js, graphql-request
// npm install ethers graphql-request
import JSBI from 'jsbi';
import { Token, CurrencyAmount, Ether } from '@uniswap/sdk-core';
import { Pool, Trade } from '@uniswap/v4-sdk';
import { TickMath, TickListDataProvider } from '@uniswap/v3-sdk';


import { ref } from 'vue';
import { ethers, BigNumber } from 'ethers';
import { request, gql } from 'graphql-request';

// Pull the enum‐maps out of the compiled JSON
const Commands = {
  V3_SWAP_EXACT_IN: 0x00,
  V3_SWAP_EXACT_OUT: 0x01,
  PERMIT2_TRANSFER_FROM: 0x02,
  PERMIT2_PERMIT_BATCH: 0x03,
  SWEEP: 0x04,
  TRANSFER: 0x05,
  PAY_PORTION: 0x06,
  // COMMAND_PLACEHOLDER = 0x07;

  // Command Types where 0x08<=value<=0x0f, executed in the second nested-if block
  V2_SWAP_EXACT_IN: 0x08,
  V2_SWAP_EXACT_OUT: 0x09,
  PERMIT2_PERMIT: 0x0a,
  WRAP_ETH: 0x0b,
  UNWRAP_WETH: 0x0c,
  PERMIT2_TRANSFER_FROM_BATCH: 0x0d,
  BALANCE_CHECK_ERC20: 0x0e,
  // COMMAND_PLACEHOLDER = 0x0f;

  // Command Types where 0x10<=value<=0x20, executed in the third nested-if block
  V4_SWAP: 0x10,
  V3_POSITION_MANAGER_PERMIT: 0x11,
  V3_POSITION_MANAGER_CALL: 0x12,
  V4_INITIALIZE_POOL: 0x13,
  V4_POSITION_MANAGER_CALL: 0x14,
  // COMMAND_PLACEHOLDER = 0x15 -> 0x20

  // Command Types where 0x21<=value<=0x3f
  EXECUTE_SUB_PLAN: 0x21,
}
const Actions  = {
  INCREASE_LIQUIDITY: 0x00,
  DECREASE_LIQUIDITY: 0x01,
  MINT_POSITION: 0x02,
  BURN_POSITION: 0x03,
  INCREASE_LIQUIDITY_FROM_DELTAS: 0x04,
  MINT_POSITION_FROM_DELTAS: 0x05,

  // swapping
  SWAP_EXACT_IN_SINGLE: 0x06,
  SWAP_EXACT_IN: 0x07,
  SWAP_EXACT_OUT_SINGLE: 0x08,
  SWAP_EXACT_OUT: 0x09,

  // donate
  // note this is not supported in the position manager or router
  DONATE: 0x0a,

  // closing deltas on the pool manager
  // settling
  SETTLE: 0x0b,
  SETTLE_ALL: 0x0c,
  SETTLE_PAIR: 0x0d,
  // taking
  TAKE: 0x0e,
  TAKE_ALL: 0x0f,
  TAKE_PORTION: 0x10,
  TAKE_PAIR: 0x11,

  CLOSE_CURRENCY: 0x12,
  CLEAR_OR_TAKE: 0x13,
  SWEEP: 0x14,

  WRAP: 0x15,
  UNWRAP: 0x16,

  // minting/burning 6909s to close deltas
  // note this is not supported in the position manager or router
  MINT_6909: 0x17,
  BURN_6909: 0x18,
}

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

  const instantiateTokens = (tokenInObject, tokenOutObject) => {
    console.log(tokenInObject)
    console.log(tokenOutObject)
    const tokenIn = tokenInObject.address.toLowerCase();
    const tokenOut = tokenOutObject.address.toLowerCase();

    const tokenA = tokenIn === nativeAddress
      ? Ether.onChain(chainId)
      : new Token(chainId, tokenIn, Number(tokenInObject.decimals), tokenInObject.symbol);

    const tokenB = tokenOut === nativeAddress
      ? Ether.onChain(chainId)
      : new Token(chainId, tokenOut, Number(tokenOutObject.decimals), tokenOutObject.symbol);

    if (tokenIn === nativeAddress) {
      tokenA.address = nativeAddress;
    } else if (tokenOut === nativeAddress) {
      tokenB.address = nativeAddress;
    }

    return {tokenA, tokenB}
  }
  // --- Path finding ---
  async function findPossiblePaths(tokenInObject, tokenOutObject) {
    const tokenIn = tokenInObject.address.toLowerCase();
    const tokenOut = tokenOutObject.address.toLowerCase();
    // --- 1) Fetch all pools involving tokenIn ---
    const poolsInQuery = gql`
      query($a: String!, $b: String!){
        pools(
          where:{
            token0_in:[$a,$b],
            token1_in:[$a,$b],
            liquidity_not:"0",
          },
          first: 20
        ) {
          ...PoolFields
        }
        poolsEth: pools(
          where:{
            token0_in:[$a,$b,"0x0000000000000000000000000000000000000000"],
            token1_in:[$a,$b,"0x0000000000000000000000000000000000000000"],
            liquidity_not:"0",
          },
          first: 20
        ) {
          ...PoolFields
        }
        poolsUSDT: pools(
          where:{
            token0_in:[$a,$b,"0xdac17f958d2ee523a2206206994597c13d831ec7"],
            token1_in:[$a,$b,"0xdac17f958d2ee523a2206206994597c13d831ec7"],
            liquidity_not:"0",
          },
          first: 10
        ) {
          ...PoolFields
        }
        poolsUSDC: pools(
          where:{
            token0_in:[$a,$b,"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"],
            token1_in:[$a,$b,"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"],
            liquidity_not:"0",
          },
          first: 10
        ) {
          ...PoolFields
        }
        poolsDAI: pools(
          where:{
            token0_in:[$a,$b,"0x6b175474e89094c44da98b954eedeac495271d0f"],
            token1_in:[$a,$b,"0x6b175474e89094c44da98b954eedeac495271d0f"],
            liquidity_not:"0",
          },
          first: 10
        ) {
          ...PoolFields
        }
      }
      fragment PoolFields on Pool {
        id feeTier hooks liquidity sqrtPrice tick tickSpacing totalValueLockedUSD
        token0 { id decimals symbol } token1 { id decimals symbol }
        ticks(where: { liquidityGross_not: "0" }, first: 1000) {
          tickIdx liquidityNet liquidityGross
        }
      }
    `;
    // token0Price
    // token1Price
    // totalValueLockedUSD_gt:"10"
    // pools0: pools(
    //       where:{
    //         token0_in:[$a,$b],
    //         liquidity_not:"0",
    //       },
    //       first: 100
    //     ) {
    //       ...PoolFields
    //     }
    //     pools1: pools(
    //       where:{
    //         token1_in:[$a,$b],
    //         liquidity_not:"0",
    //       },
    //       first: 100
    //     ) {
    //       ...PoolFields
    //     }

    const { pools: directPools, poolsEth, poolsUSDT, poolsUSDC, poolsDAI } = await request(SUBGRAPH_URL, poolsInQuery, { a: tokenIn, b: tokenOut });
  
      // --- 3) Combine and dedupe ---
      // , ...pools0, ...pools1
    const rawPools = [...directPools, ...poolsEth, ...poolsUSDT, ...poolsUSDC, ...poolsDAI];
    const unique = new Map();
    rawPools.forEach(p => unique.set(p.id, p));
    const candidatePools = Array.from(unique.values());
  
    const pools = [];
    for (const pool of candidatePools) {
      if (!pool.liquidity || pool.liquidity === "0") continue

      console.log('building ' + pool.id)

      const {tokenA, tokenB} = instantiateTokens(
        {address: pool.token0?.id, symbol: pool.token0?.symbol, decimals: pool.token0?.decimals},
        {address: pool.token1?.id, symbol: pool.token1?.symbol, decimals: pool.token1?.decimals},
      );

      let token0, token1;
      if (pool.token0?.id.toLowerCase() !== tokenA.address.toLowerCase()) {
        console.log('inverting')
        token0 = tokenB;
        token1 = tokenA;
      } else {
        token0 = tokenA;
        token1 = tokenB;
      }
      
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
    }
    return pools;
  }

  function alignTickAndPrice(sqrtPriceDecStr, spacing) {
    const exactTick  = TickMath.getTickAtSqrtRatio(JSBI.BigInt(sqrtPriceDecStr));
    const aligned    = Math.ceil(exactTick / spacing) * spacing;
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
      throw new Error('No swap path found for this');
    }

    const {tokenA, tokenB } = instantiateTokens(tokenInObject, tokenOutObject);
    const amountIn = CurrencyAmount.fromRawAmount(tokenA, rawIn.toString());
    let trades;
    try {
      const sanePools = [];
      for (const p of pools) {
        if (
          (p.involvesToken(tokenA) ||
          p.involvesToken(tokenB))
          // && (await isPoolUsable(p, amountIn))
        ) {
          sanePools.push(p);
        }
      }

      console.log('Sane pools: ' + sanePools.length);
      if (!sanePools.length) return []

      trades = await Trade.bestTradeExactIn(sanePools, amountIn, tokenB, { maxHops: 2, maxNumResults: 1 });
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

  async function executeSwapExactIn(tradeDetails, senderDetails, slippageBips = 50, gasPrice) {
    const trade = tradeDetails.swap;
    if (!trade.route.pools || !trade.route.pools[0])
      return {success: false, error: new Error('Missing route pools')};

    if (senderDetails?.balances) {
      const balance = senderDetails?.balances[trade.inputAmount.currency.address.toLowerCase()];
      const inputAmount = Number(trade.inputAmount.quotient) / (10**trade.inputAmount.currency.decimals);
      if (balance < inputAmount)
        return {success: false, error: new Error('Insufficient balance of ' + trade.inputAmount.currency.symbol )}
    }

    try {
      // 1) Pull out the route and amounts from the SDK Trade
      const route       = trade.route
      const amountIn    = trade.inputAmount         // CurrencyAmount
      const amountOut   = trade.outputAmount        // CurrencyAmount

      // 2) Build the PoolKey struct to identify our v4 pool
      const poolKeys = route.pools.map(pool => ({
        currency0: pool.token0.address,      // lower-sorted token
        currency1: pool.token1.address,      // higher-sorted token
        fee:       pool.fee,                 // e.g. 3000
        tickSpacing: pool.tickSpacing,       // e.g. 60
        hooks:     pool.hooks                // usually the zero-address
      }));

      // 3) Compute minimumAmountOut based on slippage tolerance
      //    (e.g. amountOut * (1 - slippageBips/10_000))
      const minAmountOut = BigNumber.from(amountOut.quotient.toString())
        .mul(BigNumber.from(10_000 - slippageBips))
        .div(BigNumber.from(10_000))

      // 4) Encode the single byte command V4_SWAP
      //    (Commands.V4_SWAP === the 5-bit command ID for v4 swaps)
      const commands = ethers.utils.solidityPack(
        ['uint8'],
        [Commands.V4_SWAP]
      )

      // 5) Encode the V4Router actions: SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
      //    (this tells the router exactly which steps to run)
      const actions = ethers.utils.solidityPack(
        ['uint8','uint8','uint8'],
        [
          route.pools.length === 1 ? Actions.SWAP_EXACT_IN_SINGLE : Actions.SWAP_EXACT_IN,
          Actions.SETTLE_ALL,
          Actions.TAKE_ALL
        ]
      )

      const zeroForOnes = route.pools.map(p =>
        p.token0.address.toLowerCase() === trade.inputAmount.currency.address.toLowerCase()
      );

      let params = []
      if (route.pools.length === 1) {
        params.push(
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
                poolKey: poolKeys[0],
                zeroForOne: zeroForOnes[0],
                amountIn:    BigNumber.from(amountIn.quotient.toString()),
                amountOutMinimum: minAmountOut,
                hookData:    '0x'
              }
            ]
          )
        )
      } else {
        const path = route.pools.map((pool, i) => ({
          poolKey: poolKeys[i],
          intermediateCurrency: 
            // if this is not the last pool, it’s the next pool’s input token:
            i < route.pools.length - 1
              ? route.pools[i + 1].token0.address
              : trade.outputAmount.currency.address,
          hookData: '0x'
        }));

        const currencyIn = {
          isNative: trade.inputAmount.currency.isNative,
          token:    trade.inputAmount.currency.isNative 
                    ? ethers.constants.AddressZero 
                    : trade.inputAmount.currency.address
        };

        const exactInputEncoded = ethers.utils.defaultAbiCoder.encode(
          [
            `(tuple(bool isNative, address token) currencyIn,
              tuple(
                tuple(
                  address currency0,
                  address currency1,
                  uint24 fee,
                  int24 tickSpacing,
                  address hooks
                ) poolKey,
                address intermediateCurrency,
                bytes hookData
              )[] path,
              uint128 amountIn,
              uint128 amountOutMinimum)`
          ],
          [
            [
              currencyIn,
              path,
              BigNumber.from(amountIn.quotient.toString()),
              minAmountOut
            ]
          ]
        );

        params.push(exactInputEncoded)
      }

      params.push(
        // --- 1) SETTLE_ALL params: pull `amountIn` of currency0 from user via Permit2 ---
        ethers.utils.defaultAbiCoder.encode(
          ['address','uint256'],
          [ trade.inputAmount.currency.address, amountIn.quotient.toString() ]
        ),

        // --- 2) TAKE_ALL params: send at least `minAmountOut` of currency1 to user ---
        ethers.utils.defaultAbiCoder.encode(
          ['address','uint256'],
          [ trade.outputAmount.currency.address, minAmountOut.toString() ]
        )
      )

      // 7) Finally, bundle actions+params into the single `inputs[0]`
      //    (the Universal Router expects inputs[i] = abi.encode(actions, params)) :contentReference[oaicite:4]{index=4}
      const inputs = [
        ethers.utils.defaultAbiCoder.encode(
          ['bytes','bytes[]'],
          [ actions, params ]
        )
      ]

      console.log({amountIn:    BigNumber.from(amountIn.quotient.toString()),
              amountOutMinimum: minAmountOut})

      // 8) Build a tight deadline (now + 120s) to protect from stale execution
      const deadline = Math.floor(Date.now() / 1_000) + 120

      // 9) Call the router — include ETH value if swapping native token → ERC20
      console.log(trade);
      const useNative = trade.inputAmount.currency.isNative
      console.log(useNative)
      console.log('before window')
      // it then call router.execute(...args)
      return await window.electronAPI.sendTrade({
        tradeDetailsString: JSON.stringify(tradeDetails),
        args: [
          commands,
          inputs,
          deadline,
          {
            value: useNative ? amountIn.quotient.toString() : 0,
            maxFeePerGas: ethers.utils.parseUnits((Number(gasPrice) * 1.45 / 1000000000).toFixed(3), 9),
            maxPriorityFeePerGas: ethers.utils.parseUnits((0.02 + Math.random() * .05 + (Number(gasPrice) / (50 * 1000000000))).toFixed(3), 9),
          }
        ]
      })
    } catch (e) {
      console.error(e);
      return {success: false, error: e}
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
    executeSwapExactIn,
  };
}