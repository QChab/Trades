// useUniswapV4.js
// A Vue 3 composable for swapping ETH ↔ ERC20 tokens via Uniswap v4 using the Universal Router in an Electron + Vue.js environment.
// Requires ethers.js and Uniswap v4 periphery & universal-router packages:
// npm install ethers @uniswap/universal-router @uniswap/v4-periphery

import { ref } from 'vue';
import { ethers } from 'ethers';

// ----------------------------
// Configuration constants
// ----------------------------
// Universal Router contract address on Ethereum mainnet for Uniswap v4
const UNIVERSAL_ROUTER_ADDRESS = '0x66a9893cC07D91D95644aEDD05D03f95E1dBA8Af';

const SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v4';

// Minimal ABI for Universal Router execute function
const UNIVERSAL_ROUTER_ABI = [
  // Execute takes packed commands, inputs array, and a deadline; payable if ETH is involved
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) external payable returns (bytes[] memory results)'
];

/**
 * useUniswapV4 composable
 * Provides functions to swap ETH ↔ ERC20 tokens via Uniswap v4 pools.
 * @param {string} rpcUrl - Your Ethereum node RPC URL (Infura, Alchemy, local node, etc.)
 */
export function useUniswapV4(rpcUrl) {
  // Reactive state for UI binding
  const txHash = ref(null);
  const error = ref(null);
  const loading = ref(false);

  // Initialize provider & signer
  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const signer = provider.getSigner();

  // Initialize Universal Router contract instance
  const router = new ethers.Contract(
    UNIVERSAL_ROUTER_ADDRESS,
    UNIVERSAL_ROUTER_ABI,
    signer
  );

  /**
   * @notice Low-level helper: execute a V4 exact-input single swap
   * @param {object} poolKey - { currency0, currency1, fee, tickSpacing, hooks }
   * @param {boolean} zeroForOne - true if swapping currency0→currency1
   * @param {string|BigNumber} amountIn - Exact input amount (in smallest units)
   * @param {string|BigNumber} minAmountOut - Minimum acceptable output (slippage protection)
   * @param {string} recipient - Address to receive output tokens
   * @param {number} deadline - Unix timestamp after which tx reverts
   * @param {string|BigNumber} ethValue - ETH to send in msg.value (for ETH→token)
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
      // Build the UniversalRouter command byte for V4 swap (1 = V4_SWAP)
      const commands = ethers.utils.solidityPack(['uint8'], [1]);

      // Actions: SWAP_EXACT_IN_SINGLE (0), SETTLE_ALL (1), TAKE_ALL (2)
      const actions = ethers.utils.solidityPack(
        ['uint8', 'uint8', 'uint8'],
        [0, 1, 2]
      );

      // Encode ExactInputSingleParams struct
      const exactInParams = ethers.utils.defaultAbiCoder.encode(
        ['tuple(tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)'],
        [{ poolKey, zeroForOne, amountIn, amountOutMinimum: minAmountOut, hookData: '0x' }]
      );

      // Settlement and take parameters
      const settleParam = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint128'],
        [zeroForOne ? poolKey.currency0 : poolKey.currency1, amountIn]
      );
      const takeParam = ethers.utils.defaultAbiCoder.encode(
        ['address', 'uint128'],
        [zeroForOne ? poolKey.currency1 : poolKey.currency0, minAmountOut]
      );

      // Pack actions & params
      const inputs = [
        ethers.utils.defaultAbiCoder.encode(
          ['bytes', 'bytes[]'],
          [actions, [exactInParams, settleParam, takeParam]]
        )
      ];

      // Execute via router, forwarding ETH if needed
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

  async function findOptimalPath(tokenIn, tokenOut) {
    const a = tokenIn.toLowerCase();
    const b = tokenOut.toLowerCase();

    // Direct pool
    const directQuery = gql`
      query Direct($a: String!, $b: String!) {
        pools(where: { currency0_in: [$a,$b], currency1_in: [$a,$b] }, first: 1) {
          currency0, currency1, fee, tickSpacing, hooks
        }
      }`;
    const direct = await request(SUBGRAPH_URL, directQuery, { a, b });
    if (direct.pools.length) {
      const p = direct.pools[0];
      return [{ poolKey: p, zeroForOne: p.currency0.toLowerCase() === a }];
    }

    // Two-hop candidates
    const twoHopQuery = gql`
      query TwoHop($a: String!, $b: String!) {
        poolsA: pools(where: { or: [{ currency0: $a },{ currency1: $a }] }, first: 50) {
          currency0, currency1, fee, tickSpacing, hooks
        }
        poolsB: pools(where: { or: [{ currency0: $b },{ currency1: $b }] }, first: 50) {
          currency0, currency1, fee, tickSpacing, hooks
        }
      }`;
    const twoHop = await request(SUBGRAPH_URL, twoHopQuery, { a, b });
    const mapA = {};
    twoHop.poolsA.forEach(p => {
      const other = p.currency0.toLowerCase() === a ? p.currency1 : p.currency0;
      mapA[other.toLowerCase()] = p;
    });
    for (const p of twoHop.poolsB) {
      const other = p.currency0.toLowerCase() === b ? p.currency1 : p.currency0;
      if (mapA[other.toLowerCase()]) {
        const p1 = mapA[other.toLowerCase()];
        const p2 = p;
        return [
          { poolKey: p1, zeroForOne: p1.currency0.toLowerCase() === a },
          { poolKey: p2, zeroForOne: p2.currency0.toLowerCase() === other.toLowerCase() }
        ];
      }
    }

    // Three-hop: find paths via two intermediates
    // Fetch all pools for A
    const allPoolsA = twoHop.poolsA;
    // Build adjacency: token -> pools
    const adj = {};
    allPoolsA.forEach(p => {
      [p.currency0,p.currency1].forEach(tok => {
        const t = tok.toLowerCase();
        adj[t] = adj[t] || [];
        adj[t].push(p);
      });
    });
    // For each intermediate1 of A
    for (const inter1 in adj) {
      if (inter1 === a || inter1 === b) continue;
      const pools1 = adj[inter1];
      // Fetch pools for inter1 to any token that also connects to b
      const poolsInterQuery = gql`
        query InterPools($i: String!, $b: String!) {
          byInter: pools(where: { or: [{ currency0: $i },{ currency1: $i }] }, first: 50) {
            currency0, currency1, fee, tickSpacing, hooks
          }
          byB: pools(where: { or: [{ currency0: $b },{ currency1: $b }] }, first: 50) {
            currency0, currency1, fee, tickSpacing, hooks
          }
        }`;
      const result = await request(SUBGRAPH_URL, poolsInterQuery, { i: inter1, b });
      // Build map for second intermediate
      const mapInter = {};
      result.byInter.forEach(p => {
        const other = p.currency0.toLowerCase() === inter1 ? p.currency1 : p.currency0;
        if (other !== a && other !== b) mapInter[other.toLowerCase()] = p;
      });
      for (const p of result.byB) {
        const other2 = p.currency0.toLowerCase() === b ? p.currency1 : p.currency0;
        if (mapInter[other2.toLowerCase()]) {
          // Found chain A->inter1->inter2->B
          const p1 = pools1[0];
          const p2 = mapInter[other2.toLowerCase()];
          const p3 = p;
          return [
            { poolKey: p1, zeroForOne: p1.currency0.toLowerCase() === a },
            { poolKey: p2, zeroForOne: p2.currency0.toLowerCase() === inter1 },
            { poolKey: p3, zeroForOne: p3.currency0.toLowerCase() === other2 }
          ];
        }
      }
    }

    throw new Error('No path found up to 3 hops');
  }

  /**
   * @notice Swap exact ETH for tokens via a single v4 pool
   */
  async function swapEthForTokenV4(
    tokenOut,
    fee,
    tickSpacing,
    hooks,
    minTokensOut,
    recipient,
    ethAmount
  ) {
    const poolKey = { currency0: ethers.constants.AddressZero, currency1: tokenOut, fee, tickSpacing, hooks };
    const deadline = Math.floor(Date.now() / 1000) + 60 * 10;
    await swapExactInputSingle(poolKey, true, ethAmount, minTokensOut, recipient, deadline, ethAmount);
  }

  /**
   * @notice Swap exact ERC20 tokens for ETH via a single v4 pool
   */
  async function swapTokenForEthV4(
    tokenIn,
    fee,
    tickSpacing,
    hooks,
    amountIn,
    minEthOut,
    recipient
  ) {
    const poolKey = { currency0: tokenIn, currency1: ethers.constants.AddressZero, fee, tickSpacing, hooks };
    const deadline = Math.floor(Date.now() / 1000) + 60 * 10;
    await swapExactInputSingle(poolKey, false, amountIn, minEthOut, recipient, deadline);
  }

  /**
   * @notice Swap exact amount of any ERC20 token for another via a single v4 pool
   * @param {string} tokenIn - Address of input ERC20 token
   * @param {string} tokenOut - Address of output ERC20 token
   * @param {number} fee - Pool fee (e.g. 3000)
   * @param {number} tickSpacing - Pool tick spacing
   * @param {string} hooks - Pool hooks address
   * @param {string|BigNumber} amountIn - Exact amount of tokenIn to swap (in wei)
   * @param {string|BigNumber} minAmountOut - Minimum acceptable amount of tokenOut (slippage protection)
   * @param {string} recipient - Address to receive tokenOut
   */
  async function swapTokenForTokenV4(
    tokenIn,
    tokenOut,
    fee,
    tickSpacing,
    hooks,
    amountIn,
    minAmountOut,
    recipient
  ) {
    // Determine pool token ordering
    const [currency0, currency1] =
      tokenIn.toLowerCase() < tokenOut.toLowerCase()
        ? [tokenIn, tokenOut]
        : [tokenOut, tokenIn];
    const zeroForOne = currency0 === tokenIn;
    const poolKey = { currency0, currency1, fee, tickSpacing, hooks };
    const deadline = Math.floor(Date.now() / 1000) + 60 * 10;

    // Execute swap
    await swapExactInputSingle(
      poolKey,
      zeroForOne,
      amountIn,
      minAmountOut,
      recipient,
      deadline
    );
  }

  // Expose state and functions
  return {
    txHash,
    error,
    loading,
    swapEthForTokenV4,
    swapTokenForEthV4,
    swapTokenForTokenV4,
    findOptimalPath,
  };
}