// useUniswapV4.js
// A Vue 3 composable for Uniswap V4 swaps, path finding, best-route selection,
// price tracking, and swap execution in an Electron + Vue3 environment.
// Requires: ethers.js, graphql-request
// npm install ethers graphql-request

import { ref } from 'vue';
import { ethers, AbiCoder } from 'ethers';
import { request, gql } from 'graphql-request';
import provider from '@/ethersProvider';

const abiCoder = new AbiCoder();

// ----------------------------
// Configuration constants
// ----------------------------
const UNIVERSAL_ROUTER_ADDRESS   = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af';
const QUOTER_ADDRESS             = '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203';
const API_KEY                    = '85a93cb8cc32fa52390e51a09125a6fc';
const SUBGRAPH_ID                = 'DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G';
const SUBGRAPH_URL               = `https://gateway.thegraph.com/api/${API_KEY}/subgraphs/id/${SUBGRAPH_ID}`;

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

    const slicedId = ethers.dataSlice(poolIdHex, 0, 25);
    
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
      const commands = ethers.solidityPacked(['uint8'], [1]); // V4_SWAP
      const actions  = ethers.solidityPacked(['uint8','uint8','uint8'], [0,1,2]);
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
  async function findPossiblePaths(tokenIn, tokenOut) {
    const a = tokenIn.toLowerCase(), b = tokenOut.toLowerCase();
    console.log({a, b})
    const paths = [];
    // Direct pools
    const directQ = gql`
      query($a: String!, $b: String!){
        pools(
          where:{token0_in:[$a,$b],token1_in:[$a,$b]},
          first: 50
        ) {
          id
          feeTier
          hooks
          tickSpacing
          token0Price
          token1Price
          token0 {
            id
          }
          token1 {
            id
          }
        }
      }
    `;
    const { pools: direct } = await request(SUBGRAPH_URL, directQ, { a, b });
    for (const p of direct) {
      paths.push([{ poolKey: {
        currency0: p.token0?.id,
        currency1: p.token1?.id,
        fee: p.feeTier,
        tickSpacing: p.tickSpacing,
        hooks: p.hooks,
        id: p.id,
        token0Price: Number(p.token0Price),
        token1Price: Number(p.token1Price),
      }, zeroForOne: p.token0?.id.toLowerCase()===a }]);
    }
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

  async function selectBestPath(tokenIn, paths, amountIn) {
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
  async function findAndSelectBestPath(tokenIn, tokenOut, amountIn) {
    const paths = await findPossiblePaths(tokenIn, tokenOut);
    return await selectBestPath(tokenIn, paths, amountIn);
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