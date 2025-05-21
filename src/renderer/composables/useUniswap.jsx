// useUniswapV4.js
// A Vue 3 composable for Uniswap v4 swaps, path finding, and best-route selection via the Universal Router and Quoter in an Electron + Vue.js environment.
// Requires ethers.js, @uniswap/universal-router, @uniswap/v4-periphery, graphql-request:
// npm install ethers @uniswap/universal-router @uniswap/v4-periphery graphql-request

import { ref } from 'vue';
import { ethers } from 'ethers';
import { request, gql } from 'graphql-request';
import provider from '@/ethersProvider';

// ----------------------------
// Configuration constants
// ----------------------------
const UNIVERSAL_ROUTER_ADDRESS = '0x66a9893cC07D91D95644aEDD05D03f95E1dBA8Af';
const QUOTER_ADDRESS          = '0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203';
const SUBGRAPH_URL            = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v4';

// Minimal ABIs
const UNIVERSAL_ROUTER_ABI = [
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) external payable returns (bytes[] memory results)'
];
const QUOTER_ABI = [
  'function quoteExactInput((address currencyIn, tuple(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path, uint256 exactAmount) params) external returns (uint256 amountOut, uint256 gasEstimate)'
];

/**
 * useUniswapV4 composable
 * Provides swap, path finding (up to 2 hops), and best-route selection for Uniswap v4.
 */
export function useUniswapV4() {
  const txHash  = ref(null);
  const error   = ref(null);
  const loading = ref(false);

  // const signer   = provider.getSigner();
  const signer = new ethers.Wallet('0xea837b966452b9968eb6d388d04823d85ddb4b2649d19c6e7615d133fcb76564', provider);
  const router   = new ethers.Contract(UNIVERSAL_ROUTER_ADDRESS, UNIVERSAL_ROUTER_ABI, signer);
  const quoter   = new ethers.Contract(QUOTER_ADDRESS, QUOTER_ABI, provider);

  /**
   * Low-level helper: execute a V4 exact-input single swap
   */
  async function swapExactInputSingle(
    poolKey,
    zeroForOne,
    amountIn,
    minAmountOut,
    recipient,
    deadline,
    ethValue = 0
  ) {
    loading.value = true;
    error.value = null;
    try {
      // 1) Command byte for V4 swap (1 = V4_SWAP)
      const commands = ethers.utils.solidityPack(['uint8'], [1]);

      // 2) Actions sequence: SWAP_EXACT_IN_SINGLE (0), SETTLE_ALL (1), TAKE_ALL (2)
      const actions = ethers.utils.solidityPack(
        ['uint8','uint8','uint8'],
        [0,1,2]
      );

      // 3) ExactInputSingleParams struct
      const exactInParams = ethers.utils.defaultAbiCoder.encode(
        ['tuple(tuple(address,address,uint24,int24,address) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)'],
        [{ poolKey, zeroForOne, amountIn, amountOutMinimum: minAmountOut, hookData: '0x' }]
      );

      // 4) Settlement & take parameters
      const settleParam = ethers.utils.defaultAbiCoder.encode(
        ['address','uint128'],
        [zeroForOne ? poolKey.currency0 : poolKey.currency1, amountIn]
      );
      const takeParam = ethers.utils.defaultAbiCoder.encode(
        ['address','uint128'],
        [zeroForOne ? poolKey.currency1 : poolKey.currency0, minAmountOut]
      );

      // 5) Pack actions + params
      const inputs = [
        ethers.utils.defaultAbiCoder.encode(
          ['bytes','bytes[]'],
          [actions, [exactInParams, settleParam, takeParam]]
        )
      ];

      // 6) Execute via Universal Router
      const tx = await router.execute(commands, inputs, deadline, { value: ethValue });
      txHash.value = tx.hash;
      await tx.wait();
    } catch (err) {
      console.error('swapExactInputSingle error:', err);
      error.value = err;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Find optimal pool path (up to 2 hops) between tokenIn and tokenOut
   */
  async function findOptimalPath(tokenIn, tokenOut) {
    const a = tokenIn.toLowerCase();
    const b = tokenOut.toLowerCase();

    const paths = [];

    // 1-hop (direct) query
    const directQuery = gql`
      query Direct($a:String!,$b:String!){
        pools(where:{currency0_in:[$a,$b],currency1_in:[$a,$b]}, first:10) {
          currency0,currency1,fee,tickSpacing,hooks
        }
      }`;
    const direct = await request(SUBGRAPH_URL, directQuery, { a, b });
    // Add all direct pools as single-hop paths
    direct.pools.forEach(p => {
      paths.push([
        {
          poolKey: p,
          zeroForOne: p.currency0.toLowerCase() === a
        }
      ]);
    });

    // 2-hop query: poolsA + poolsB
    const twoHopQuery = gql`
      query TwoHop($a:String!,$b:String!){
        poolsA:pools(where:{or:[{currency0:$a},{currency1:$a}]}, first:20){ currency0,currency1,fee,tickSpacing,hooks }
        poolsB:pools(where:{or:[{currency0:$b},{currency1:$b}]}, first:20){ currency0,currency1,fee,tickSpacing,hooks }
      }`;
    const { poolsA, poolsB } = await request(SUBGRAPH_URL, twoHopQuery, { a, b });
    const mapA = {};
    poolsA.forEach(p => {
      const other = p.currency0.toLowerCase() === a ? p.currency1 : p.currency0;
      mapA[other.toLowerCase()] = p;
    });
    poolsB.forEach(p => {
      const other = p.currency0.toLowerCase() === b ? p.currency1 : p.currency0;
      const p1 = mapA[other.toLowerCase()];
      if (p1) {
        paths.push([
          { poolKey: p1, zeroForOne: p1.currency0.toLowerCase() === a },
          { poolKey: p, zeroForOne: p.currency0.toLowerCase() === other.toLowerCase() }
        ]);
      }
    });

    if (paths.length === 0) {
      throw new Error('No path found up to 2 hops');
    }
    return paths;
  }

  /**
   * Select the best route (highest output) among possible paths using V4Quoter
   */
  async function selectBestPath(paths, amountIn, tokenIn) {
    let best = { path: null, amountOut: ethers.BigNumber.from(0) };
    for (const steps of paths) {
      const pathKeys = steps.map(({ poolKey, zeroForOne }) => ({
        intermediateCurrency: zeroForOne?poolKey.currency1:poolKey.currency0,
        fee: poolKey.fee,
        tickSpacing: poolKey.tickSpacing,
        hooks: poolKey.hooks,
        hookData: '0x'
      }));
      const params = { currencyIn: tokenIn, path: pathKeys, exactAmount: ethers.BigNumber.from(amountIn) };
      try {
        const [amountOut] = await quoter.callStatic.quoteExactInput(params);
        if (amountOut.gt(best.amountOut)) best = { path:steps, amountOut };
      } catch (e) {
        console.error('quoteExactInput failed',e);
      }
    }
    if (!best.path) throw new Error('No valid path quoted');
    return best;
  }

  /**
   * Swap exact ETH for tokens via a single v4 pool
   */
  async function swapEthForTokenV4(tokenOut, fee, tickSpacing, hooks, minTokensOut, recipient, ethAmount) {
    const poolKey = { currency0:ethers.constants.AddressZero, currency1:tokenOut, fee, tickSpacing, hooks };
    const deadline = Math.floor(Date.now()/1000)+600;
    await swapExactInputSingle(poolKey, true, ethAmount, minTokensOut, recipient, deadline, ethAmount);
  }

  /**
   * Swap exact ERC20 tokens for ETH via a single v4 pool
   */
  async function swapTokenForEthV4(tokenIn, fee, tickSpacing, hooks, amountIn, minEthOut, recipient) {
    const poolKey = { currency0:tokenIn, currency1:ethers.constants.AddressZero, fee, tickSpacing, hooks };
    const deadline = Math.floor(Date.now()/1000)+600;
    await swapExactInputSingle(poolKey, false, amountIn, minEthOut, recipient, deadline);
  }

  /**
   * Swap exact amount of any ERC20 token for another via a single v4 pool
   */
  async function swapTokenForTokenV4(tokenIn, tokenOut, fee, tickSpacing, hooks, amountIn, minAmountOut, recipient) {
    const [currency0,currency1] = tokenIn.toLowerCase()<tokenOut.toLowerCase()
      ? [tokenIn,tokenOut] : [tokenOut,tokenIn];
    const zeroForOne = currency0===tokenIn;
    const poolKey = { currency0,currency1, fee, tickSpacing, hooks };
    const deadline = Math.floor(Date.now()/1000)+600;
    await swapExactInputSingle(poolKey, zeroForOne, amountIn, minAmountOut, recipient, deadline);
  }

  async function findAndSelectBestPath(tokenIn, tokenOut, amountIn) {
    const paths = await findOptimalPath(tokenIn, tokenOut);
    console.log(paths);
    return await selectBestPath(paths, amountIn, tokenIn);
  }  

  // Expose state & methods
  return {
    txHash,
    error,
    loading,
    findOptimalPath,
    selectBestPath,
    swapEthForTokenV4,
    swapTokenForEthV4,
    swapTokenForTokenV4,
    findAndSelectBestPath,
  };
}