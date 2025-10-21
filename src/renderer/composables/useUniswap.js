// useUniswapV4.js
// A Vue 3 composable for Uniswap V4 swaps, path finding, best-route selection,
// price tracking, and swap execution in an Electron + Vue3 environment.

import JSBI from 'jsbi';
import { Token, CurrencyAmount, Ether } from '@uniswap/sdk-core';
import { Pool, Trade } from '@uniswap/v4-sdk';
import { TickMath, TickListDataProvider } from '@uniswap/v3-sdk';
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
const VITE_AP1='d692082c59f9567'
const VITE_AP2='90647e88'
const VITE_AP3='9e75fa84d'

const SUBGRAPH_ID                = 'DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G';
const SUBGRAPH_URL               = `https://gateway.thegraph.com/api/${VITE_AP1 + VITE_AP2 + VITE_AP3}/subgraphs/id/${SUBGRAPH_ID}`;

const STATE_VIEW_ADDRESS   = '0x7ffe42c4a5deea5b0fec41c94c136cf115597227';
const STATE_VIEW_ABI = [
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)'
]
const POSITION_MANAGER_ADDRESS   = '0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e';
const POSITION_MANAGER_ABI       = [
  'function poolKeys(bytes25 poolId) view returns (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)'
];

const QUOTER_ABI                 = [
  'function quoteExactInput((address currencyIn, tuple(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path, uint256 exactAmount) params) external view returns (uint256 amountOut, uint256 gasEstimate)'
];

/**
 * Bulk fetch all Uniswap V4 pools for multiple tokens at once
 * This is much more efficient than querying for each token pair individually
 * @param {Array<string>} tokenAddresses - Array of token addresses to fetch pools for
 * @returns {Promise<Array>} Array of Pool instances from @uniswap/v4-sdk
 */
export async function fetchAllUniswapPools(tokenAddresses) {
  try {
    console.log(`🔍 Bulk fetching Uniswap pools for ${tokenAddresses.length} tokens...`);

    // Normalize addresses
    const normalizedTokens = tokenAddresses.map(addr =>
      addr.toLowerCase() === '0x0000000000000000000000000000000000000000'
        ? '0x0000000000000000000000000000000000000000'
        : addr.toLowerCase()
    );

    // Add common intermediates for better routing
    const intermediates = [
      '0x0000000000000000000000000000000000000000', // ETH
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
      '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
      '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
    ];

    const allTokens = [...new Set([...normalizedTokens, ...intermediates])];

    // Query for all pools containing any of these tokens
    const query = gql`
      query {
        pools(
          where: {
            or: [
              { token0_in: ${JSON.stringify(allTokens)}, liquidity_not: "0" },
              { token1_in: ${JSON.stringify(allTokens)}, liquidity_not: "0" }
            ]
          },
          first: 200
        ) {
          id
          feeTier
          sqrtPrice
          hooks
          tick
          tickSpacing
          liquidity
          totalValueLockedUSD
          token0 { id decimals symbol }
          token1 { id decimals symbol }
          ticks(where: { liquidityGross_not: "0" }, first: 1000) {
            tickIdx
            liquidityNet
            liquidityGross
          }
        }
      }
    `;

    const response = await request(SUBGRAPH_URL, query);
    const rawPools = response.pools || [];

    // Filter by liquidity and hooks
    const candidatePools = rawPools.filter(pool =>
      pool.hooks === '0x0000000000000000000000000000000000000000' &&
      pool.liquidity > 100000
    );

    console.log(`✅ Found ${candidatePools.length} Uniswap pools with sufficient liquidity`);

    // Instantiate Pool objects
    const pools = [];
    for (const pool of candidatePools) {
      try {
        const token0 = pool.token0.id === '0x0000000000000000000000000000000000000000'
          ? Ether.onChain(chainId)
          : new Token(chainId, pool.token0.id, Number(pool.token0.decimals), pool.token0.symbol);

        const token1 = pool.token1.id === '0x0000000000000000000000000000000000000000'
          ? Ether.onChain(chainId)
          : new Token(chainId, pool.token1.id, Number(pool.token1.decimals), pool.token1.symbol);

        if (token0.isNative) token0.address = '0x0000000000000000000000000000000000000000';
        if (token1.isNative) token1.address = '0x0000000000000000000000000000000000000000';

        const cleanedTicks = sanitiseTicksStatic(pool.ticks, Number(pool.tickSpacing));
        const tickProvider = new TickListDataProvider(cleanedTicks, Number(pool.tickSpacing));

        const poolInstance = new Pool(
          token0,
          token1,
          Number(pool.feeTier),
          Number(pool.tickSpacing),
          pool.hooks,
          pool.sqrtPrice,
          JSBI.BigInt(pool.liquidity),
          Number(pool.tick),
          tickProvider
        );

        pools.push(poolInstance);
      } catch (error) {
        console.error(`Failed to instantiate pool ${pool.id}:`, error.message);
      }
    }

    return pools;
  } catch (error) {
    console.error('❌ Error bulk fetching Uniswap pools:', error);
    return [];
  }
}

/**
 * Static version of sanitiseTicks for use outside of useUniswapV4 composable
 */
function sanitiseTicksStatic(raw, spacing) {
  const seen = new Set();
  const ticks = [];

  for (const t of raw) {
    const idx = Number(t.tickIdx);

    if (idx % spacing !== 0) continue;
    if (idx < TickMath.MIN_TICK || idx > TickMath.MAX_TICK) continue;

    if (!seen.has(idx)) {
      ticks.push({
        index: idx,
        liquidityNet: JSBI.BigInt(t.liquidityNet),
        liquidityGross: JSBI.BigInt(t.liquidityGross)
      });
      seen.add(idx);
    }
  }

  return ticks.sort((a, b) => a.index - b.index);
}

export function useUniswapV4() {
  const instantiateTokens = (tokenInObject, tokenOutObject) => {
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
  async function findPossiblePools(tokenInObject, tokenOutObject) {
    const tokenIn = tokenInObject.address.toLowerCase();
    const tokenOut = tokenOutObject.address.toLowerCase();
    
    // --- 1) Fetch all pools involving tokens and trusted intermediates ---
    const firstAddressAlphabet = tokenIn < tokenOut ? tokenIn : tokenOut;
    const lastAddressAlphabet = tokenIn < tokenOut ? tokenOut : tokenIn;
    // console.log({firstAddressAlphabet, lastAddressAlphabet})
    const poolsInQuery = gql`
      query($a: String!, $b: String!){
        poolsDirect: pools(
          where:{
            token0_in: [$a, $b],
            token1_in: [
              ${tokenIn < tokenOut ? '$b' : '$a'},
              ${firstAddressAlphabet >= "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" ? '' : '"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",'}
              ${firstAddressAlphabet >= "0xdac17f958d2ee523a2206206994597c13d831ec7" ? '' : '"0xdac17f958d2ee523a2206206994597c13d831ec7",'}
              ${firstAddressAlphabet >= "0x6b175474e89094c44da98b954eedeac495271d0f" ? '' : '"0x6b175474e89094c44da98b954eedeac495271d0f",'}
            ],
            liquidity_not:"0",
          },
          first: 100
        ) {
          id feeTier sqrtPrice hooks tick tickSpacing liquidity totalValueLockedUSD
          token0 { id decimals symbol } token1 { id decimals symbol }
          ticks(where: { liquidityGross_not: "0" }, first: 1000) {
            tickIdx liquidityNet liquidityGross
          }
        }
      }
    `;
    const poolsOutQuery = gql`
      query($a: String!, $b: String!){
        poolsOut: pools(
          where:{
            token0_in: [
              "0x0000000000000000000000000000000000000000",
              ${lastAddressAlphabet <= "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" ? '' : '"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",'}
              ${lastAddressAlphabet <= "0xdac17f958d2ee523a2206206994597c13d831ec7" ? '' : '"0xdac17f958d2ee523a2206206994597c13d831ec7",'}
              ${lastAddressAlphabet <= "0x6b175474e89094c44da98b954eedeac495271d0f" ? '' : '"0x6b175474e89094c44da98b954eedeac495271d0f",'}
            ],
            token1_in: [$a, $b],
            liquidity_not:"0",
          },
          first: 100
        ) {
          id feeTier sqrtPrice hooks tick tickSpacing liquidity totalValueLockedUSD
          token0 { id decimals symbol } token1 { id decimals symbol }
          ticks(where: { liquidityGross_not: "0" }, first: 1000) {
            tickIdx liquidityNet liquidityGross
          }
        }
      }
    `;
    const poolsInBetweenQuery = gql`
      query($a: String!, $b: String!) {
        poolsInBetween: pools(
          where: {
            or: [
              {
                token0_in: [
                  $a,
                  $b,
                  "0x0000000000000000000000000000000000000000",
                  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                  "0xdac17f958d2ee523a2206206994597c13d831ec7",
                  "0x6b175474e89094c44da98b954eedeac495271d0f"
                ],
                liquidity_not: "0"
              }, {
                token1_in: [
                  $a,
                  $b,
                  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
                  "0xdac17f958d2ee523a2206206994597c13d831ec7",
                  "0x6b175474e89094c44da98b954eedeac495271d0f"
                ],
                liquidity_not: "0"
              }
            ]
          },
          first: 1000
        ) {
          id feeTier sqrtPrice hooks tick tickSpacing liquidity totalValueLockedUSD
          token0 { id decimals symbol } token1 { id decimals symbol }
          ticks(where: { liquidityGross_not: "0" }, first: 1000) {
            tickIdx liquidityNet liquidityGross
          }
        }
      }
    `;
    
    const [{ poolsDirect }, {poolsOut}, {poolsInBetween}] = await Promise.all([
      request(SUBGRAPH_URL, poolsInQuery, { a: tokenIn, b: tokenOut }),
      request(SUBGRAPH_URL, poolsOutQuery, { a: tokenIn, b: tokenOut }),
      request(SUBGRAPH_URL, poolsInBetweenQuery, { a: tokenIn, b: tokenOut })
    ])
  
      // --- 3) Combine and dedupe ---
    const rawPools = [...poolsDirect, ...poolsOut, ...poolsInBetween];
    const unique = new Map();
    rawPools.forEach(p => unique.set(p.id, p));
    let candidatePools = Array.from(unique.values()).filter((pool) => (
      pool.hooks === '0x0000000000000000000000000000000000000000' && pool.liquidity > 1000 && pool.totalValueLockedUSD && Number(pool.totalValueLockedUSD) >= 1000
    ))
  
    if (candidatePools.length <= 6)
      candidatePools = Array.from(unique.values()).filter((pool) => (
        pool.hooks === '0x0000000000000000000000000000000000000000' && pool.liquidity > 1000
      ))

      const pools = [];
    for (const pool of candidatePools) {
      const {tokenA, tokenB} = instantiateTokens(
        {address: pool.token0?.id, symbol: pool.token0?.symbol, decimals: pool.token0?.decimals},
        {address: pool.token1?.id, symbol: pool.token1?.symbol, decimals: pool.token1?.decimals},
      );
      
      const cleanedTicks  = sanitiseTicks(pool.ticks, Number(pool.tickSpacing))
      const tickProvider  = new TickListDataProvider(cleanedTicks, Number(pool.tickSpacing))

      const poolInstance = new Pool(
        tokenA,
        tokenB,
        Number(pool.feeTier),
        Number(pool.tickSpacing),
        '0x0000000000000000000000000000000000000000', // pool.hooks
        pool.sqrtPrice,
        // JSBI.BigInt(pool.sqrtPrice),
        JSBI.BigInt(pool.liquidity),
        Number(pool.tick),
        tickProvider,
      );

      pools.push(poolInstance);
    }

    console.log('Sane pools: ' + pools.length);

    return pools;
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

  async function selectBestPath(tokenInObject, tokenOutObject, pools, rawIn, simpleMultiRoute = false) {
    if (!BigNumber.isBigNumber(rawIn)) {
      throw new Error('[selectBestPath] rawIn must be an ethers.BigNumber');
    }
    if (rawIn.isZero()) {
      throw new Error('[selectBestPath] rawIn cannot be zero');
    }
    if (pools.length === 0) {
      throw new Error('No swap path found for this');
    }

    let trades;

    const {tokenA, tokenB } = instantiateTokens(tokenInObject, tokenOutObject);
    const amountIn = CurrencyAmount.fromRawAmount(tokenA, rawIn.toString());

    try {
      if (!pools.length) return []

      // Simple multi-route mode: Return multiple 1-hop routes for external optimization
      if (simpleMultiRoute) {
        trades = await Trade.bestTradeExactIn(pools, amountIn, tokenB, { maxHops: 1, maxNumResults: 8 });

        // Sort trades by output amount (descending) to get best routes first
        trades.sort((a, b) => {
          const aOut = JSBI.BigInt(a.outputAmount.quotient.toString());
          const bOut = JSBI.BigInt(b.outputAmount.quotient.toString());
          return JSBI.greaterThan(bOut, aOut) ? 1 : JSBI.lessThan(bOut, aOut) ? -1 : 0;
        });

        // Return ALL non-conflicting trades for multi-route optimization
        const knownPools = {};
        const nonConflictingTrades = [];
        for (const trade of trades) {
          // Allow up to 4 non-conflicting routes for better splitting
          if (nonConflictingTrades.length >= 4) break;

          let canAddTrade = true;
          for (const pool of trade.swaps[0].route.pools) {
            if (knownPools[pool.poolId]) {
              canAddTrade = false;
              break;
            }
          }

          if (canAddTrade) {
            for (const pool of trade.swaps[0].route.pools) {
              knownPools[pool.poolId] = true;
            }
            nonConflictingTrades.push(trade);
          }
        }

        // Return all non-conflicting trades for multi-route optimization
        if (nonConflictingTrades.length > 1) {
          return nonConflictingTrades;
        }

        // Only single best route found
        return [trades[0]];
      }

      // Complex mode: Multi-hop paths with internal split optimization
      trades = await Trade.bestTradeExactIn(pools, amountIn, tokenB, { maxHops: 2, maxNumResults: 8 });

      if (trades.length < 2)
        return [trades[0]];

      const knownPools = {};
      const bestTwoTradesWithoutPoolConflict = [];
      for (const trade of trades) {
        if (bestTwoTradesWithoutPoolConflict.length === 2) break;
        let canAddTrade = true;
        for (const pool of trade.swaps[0].route.pools) {
          if (knownPools[pool.poolId]) canAddTrade = false;
        }
        if (canAddTrade) {
          for (const pool of trade.swaps[0].route.pools) {
            knownPools[pool.poolId] = true;
          }
          bestTwoTradesWithoutPoolConflict.push(trade);
        }
      }

      if (bestTwoTradesWithoutPoolConflict.length < 2)
        return [trades[0]];

      const bestSplit = await findBestSplitHillClimb(
        bestTwoTradesWithoutPoolConflict[0].swaps[0].route.pools,
        bestTwoTradesWithoutPoolConflict[1].swaps[0].route.pools,
        rawIn,
        tokenA,
        tokenB
      );

      if (!bestSplit.fraction || bestSplit.fraction > .951)
        return [trades[0]];

      const splitOutRaw = bestSplit.output.toString();

      const singleOutRaw = trades[0]
        ? BigNumber.from(trades[0].outputAmount.quotient.toString()).toString()
        : '0';
      if (BigNumber.from(splitOutRaw).gt(BigNumber.from(singleOutRaw))) {
        return bestSplit.trades;
      }

    } catch (err) {
      /* The only error the SDK throws here is the dreaded "Invariant failed".
      Wrap it to give the caller real insight. */
      console.error('[selectBestPath] SDK invariant blew up:', err);
      return [];
    }

    // Return the best trade if available
    return trades && trades.length > 0 ? [trades[0]] : [];
  }

  /** Combined helper: find and quote best path, stores price */
  async function findAndSelectBestPath(tokenInObject, tokenOutObject, amountIn, simpleMultiRoute = false) {
    const pools = await findPossiblePools(tokenInObject, tokenOutObject);
    return await selectBestPath(tokenInObject, tokenOutObject, pools, amountIn, simpleMultiRoute);
  }

  /**
   * Find the optimal split between pool0 and pool1 via hill‐climbing.
   *
   * @param pool0   First Pool instance (A→B)
   * @param pool1   Second Pool instance (A→B)
   * @param rawIn   ethers.BigNumber total amount of A to swap
   * @param tokenA  SDK Token/Ether for input
   * @param tokenB  SDK Token/Ether for output
   * @param {
   *   initialFrac = 0.7,  // start at 70%
   *   initialStep = 0.1,  // probe ±10%
   *   minStep     = 0.01, // stop when step < 1%
   * } options
   *
   * @returns { fraction, output }
   *   fraction: number in [0,1] to send to pool0
   *   output:   JSBI best total output quotient
   */
  async function findBestSplitHillClimb(
    pools0, pools1, rawIn, tokenA, tokenB,
    { initialFrac = 0.8, initialStep = 0.1, minStep = 0.0001 } = {}
  ) {
    let frac   = initialFrac;
    let step   = initialStep;

    // helper to compute total output for a given frac
    async function totalOutFor(fr) {
      // clamp
      const f = Math.min(1, Math.max(0, fr));
      // split amounts
      const in0 = rawIn.mul(Math.floor(f * 1e4)).div(1e4);
      const in1 = rawIn.sub(in0);

      const amt0 = CurrencyAmount.fromRawAmount(tokenA, in0.toString());
      const amt1 = CurrencyAmount.fromRawAmount(tokenA, in1.toString());

      const [[trade0], [trade1]] = await Promise.all([
        Trade.bestTradeExactIn(pools0, amt0, tokenB, {maxHops: 2, maxNumResults: 1}),
        Trade.bestTradeExactIn(pools1, amt1, tokenB, {maxHops: 3, maxNumResults: 1}),
      ])

      const out0 = trade0.swaps[0].outputAmount;
      const out1 = trade1.swaps[0].outputAmount;

      return {trades: [trade0, trade1], out: JSBI.add(out0.quotient, out1.quotient)};
    }

    // get initial value
    let resultInitial = await totalOutFor(frac);
    let bestOutput = resultInitial.out;
    let bestTrades = resultInitial.trades;

    let totalOutForFrac1;

    while (step >= minStep) {
      // probe up/down
      const upFrac   = Math.min(1, frac + step);
      const downFrac = Math.max(0, frac - step);

      const [resultUp, resultDown] = await Promise.all([
        upFrac === 1 && totalOutForFrac1 ? totalOutForFrac1 : totalOutFor(upFrac),
        totalOutFor(downFrac)
      ]);

      if (upFrac === 1) totalOutForFrac1 = resultUp;

      const outUp = resultUp.out;
      const outDown = resultDown.out;

      // compare
      if (JSBI.greaterThan(outUp, bestOutput)) {
        // going up helps
        frac = upFrac;
        bestOutput = outUp;
        bestTrades = resultUp.trades;
      } else if (JSBI.greaterThan(outDown, bestOutput)) {
        // going down helps
        frac = downFrac;
        bestOutput = outDown;
        bestTrades = resultDown.trades;
      } else {
        // neither neighbor is better → shrink step
        step /= 2;
      }
    }

    return { fraction: frac, output: bestOutput, trades: bestTrades };
  }

  async function executeMixedSwaps(trades, tradeSummary, slippageBips = 70, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce) {
    const totalBigIn = trades.reduce(
      (acc, t) => {
        const legInBN = BigNumber.from(t.inputAmount.quotient.toString());
        return acc.add(legInBN);
      },
      BigNumber.from(0)
    );
    const totalBigOut = trades.reduce(
      (acc, t) => {
        const legInBN = BigNumber.from(t.outputAmount.quotient.toString());
        return acc.add(legInBN);
      },
      BigNumber.from(0)
    );
    console.log(trades);
    if (tradeSummary.sender?.balances) {
      let totalInBN = BigNumber.from(0);
      for (const t of trades) {
        const legInBN = BigNumber.from(t.inputAmount.quotient.toString());
        totalInBN = totalInBN.add(legInBN);
      }

      const balance = tradeSummary.sender?.balances[trades[0].inputAmount.currency.address.toLowerCase()];
      const decimals = trades[0].inputAmount.currency.decimals;
      const balanceBN = ethers.utils.parseUnits(
        (balance).toFixed(decimals),
        decimals,
      );
      if (balanceBN.lt(totalInBN))
        return {success: false, error: new Error('Insufficient balance of ' + trades[0].inputAmount.currency.symbol )}
    }
    
    const commands = ethers.utils.solidityPack(
      ['uint8'],
      [Commands.V4_SWAP]
    )

    // 3) Build flat actions array:
    //    for each leg choose SWAP_EXACT_IN_SINGLE or SWAP_EXACT_IN, then SETTLE_ALL, TAKE_ALL
    const flatActions = trades.flatMap(trade => {
      const swapA = trade.route.pools.length === 1
        ? Actions.SWAP_EXACT_IN_SINGLE
        : Actions.SWAP_EXACT_IN;
      return [ swapA ];
    });
    flatActions.push(Actions.SETTLE_ALL, Actions.TAKE_ALL);
    const actions = ethers.utils.solidityPack(
      Array(flatActions.length).fill('uint8'),
      flatActions
    );

    // 4) Encode each leg’s params
    const params = [];
    for (const trade of trades) {
      const amountInBn  = BigNumber.from(trade.inputAmount.quotient.toString());
      const minOutBn    = BigNumber.from(
        trade.outputAmount.quotient.toString()
      )
        .mul(10_000 - slippageBips)
        .div(10_000);

      // a) exact-input encoding
      if (trade.route.pools.length === 1) {
        const zeroForOne = trade.route.pools[0].token0.address.toLowerCase() === trade.inputAmount.currency.address.toLowerCase();

        params.push(
          ethers.utils.defaultAbiCoder.encode(
            ['(tuple(address, address, uint24, int24, address),bool,uint128,uint128,bytes)'],
            [
              [
                [
                  trade.route.pools[0].poolKey.currency0,
                  trade.route.pools[0].poolKey.currency1,
                  trade.route.pools[0].poolKey.fee,
                  trade.route.pools[0].poolKey.tickSpacing,
                  trade.route.pools[0].poolKey.hooks,
                ],
                zeroForOne,
                amountInBn,
                minOutBn,
                '0x'
              ]
            ]
          )
        );
      } else {
        // MULTI‐HOP (2 pools)
        const currencyIn = trade.inputAmount.currency.isNative
          ? ethers.constants.AddressZero
          : trade.inputAmount.currency.address;

        // build PathKey tuple array
        const path = trade.route.pools.map((pool,i) => ({
          intermediateCurrency: trade.route.currencyPath[i+1]?.address ?? ethers.constants.AddressZero,
          fee: pool.fee,
          tickSpacing: pool.tickSpacing,
          hooks: pool.hooks,
          hookData: '0x'
        }));
        console.log('before encode 2')
        params.push(
          ethers.utils.defaultAbiCoder.encode(
            ['tuple(address,(address,uint24,int24,address,bytes)[],uint128,uint128)'],
            [[
              currencyIn,
              path.map(p => [
                p.intermediateCurrency,
                p.fee,
                p.tickSpacing,
                p.hooks,
                p.hookData
              ]),
              amountInBn,
              minOutBn
            ]]
          )
        );
      }
    }

    // b) settle: pull `amountIn` of the input token
    params.push(
      ethers.utils.defaultAbiCoder.encode(
        ['address','uint256'],
        [ tradeSummary.fromToken.address, totalBigIn ]
      )
    );

    // c) take: send `minOut` of the output token
    params.push(
      ethers.utils.defaultAbiCoder.encode(
        ['address','uint256'],
        [ tradeSummary.toToken.address, totalBigOut ]
      )
    );
    
    // 5) Final bundle
    const inputs = [
      ethers.utils.defaultAbiCoder.encode(['bytes','bytes[]'], [ actions, params ])
    ];

    // deadline + call
    const deadline = Math.floor(Date.now()/1e3) + 120;
    const txArgs = {
      value: trades
        .filter(t => t.inputAmount.currency.isNative)
        .reduce((sum,t) => sum.add(t.inputAmount.quotient.toString()), BigNumber.from(0)),
      maxFeePerGas: maxFeePerGas || ethers.utils.parseUnits(
        (Number(gasPrice) * 1.85 / 1e9).toFixed(3), 9
      ),
      maxPriorityFeePerGas: maxPriorityFeePerGas || ethers.utils.parseUnits(
        (0.02 + Math.random()*0.05 + Number(gasPrice)/(40e9)).toFixed(3), 9
      ),
    }
    if (nonce) {
      txArgs.nonce = nonce;
    }
    return window.electronAPI.sendTrade({
      tradeSummary: JSON.parse(JSON.stringify(tradeSummary)),
      args: [
        commands,
        inputs,
        deadline,
        txArgs,
      ]
    });
  }

  return {
    findPossiblePools,
    selectBestPath,
    findAndSelectBestPath,
    findBestSplitHillClimb,
    executeMixedSwaps,
    fetchAllUniswapPools,
  };
}