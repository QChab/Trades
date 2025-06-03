// useBalancerV3.js
// A Vue 3 composable for Balancer V3 swaps, path finding, best-route selection,
// price tracking, and swap execution in an Electron + Vue3 environment.
// Requires: ethers.js, graphql-request, @balancer-labs/sor-core, @balancer-labs/sdk-core
// npm install @balancer-labs/sor-core @balancer-labs/sdk-core graphql-request ethers

import { ethers, BigNumber } from 'ethers';
import { request, gql } from 'graphql-request';
import {
  BalancerSdkConfig,
  Network,
  SwapTypes,
  Sor,
} from '@balancer-labs/sor-core';
import JSBI from 'jsbi';

// ------------ Configuration constants ------------
const chainId = 1; // Ethereum Mainnet
const nativeAddress = '0x0000000000000000000000000000000000000000';

// Balancer V3 Vault address on Mainnet
const BALANCER_VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';

// Subgraph URL: replace with your Balancer V3 subgraph endpoint
const BALANCER_SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-v3';

// --- SOR configuration: we use Balancer’s SOR to find optimal routes ---
const sorConfig = new BalancerSdkConfig({
  network: Network.MAINNET,
  vault: BALANCER_VAULT_ADDRESS,
  subgraphUrl: BALANCER_SUBGRAPH_URL,
  // optionally specify rpcUrl to fetch on‐chain data if needed
});

let sorInstance = null;

// Helper: instantiate SOR with an ethers Provider
async function getSor(eip1193Provider) {
  if (!sorInstance) {
    const provider = new ethers.providers.Web3Provider(eip1193Provider);
    sorInstance = new Sor(sorConfig, provider);
  }
  return sorInstance;
}

// --- 1) Fetch Balancer V3 pools that are either “direct” (contain both A & B) or “hop‐via‐stable” ---
async function findPossiblePools(tokenInObject, tokenOutObject) {
  const tokenIn = tokenInObject.address.toLowerCase();
  const tokenOut = tokenOutObject.address.toLowerCase();

  // We assume “stables” = USDC, USDT, DAI
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
  const DAI  = '0x6b175474e89094c44da98b954eedeac495271d0f';

  // Hosted-service does NOT support _or, so we issue multiple sub‐queries:
  const query = gql`
    query ($a: String!, $b: String!, $st0: String!, $st1: String!, $st2: String!) {
      direct: pools(
        where: {
          tokensList_contains: [$a,$b]
          tokensCount: 2
          totalLiquidity_gt: "0"
        }
        first: 100
      ) {
        id
        address
      }
      viaA_USDC: pools(
        where: {
          tokensList_contains: [$a,$st0]
          tokensCount: 2
          totalLiquidity_gt: "0"
        }
        first: 100
      ) {
        id
        address
      }
      viaA_USDT: pools(
        where: {
          tokensList_contains: [$a,$st1]
          tokensCount: 2
          totalLiquidity_gt: "0"
        }
        first: 100
      ) {
        id
        address
      }
      viaA_DAI: pools(
        where: {
          tokensList_contains: [$a,$st2]
          tokensCount: 2
          totalLiquidity_gt: "0"
        }
        first: 100
      ) {
        id
        address
      }
      viaB_USDC: pools(
        where: {
          tokensList_contains: [$b,$st0]
          tokensCount: 2
          totalLiquidity_gt: "0"
        }
        first: 100
      ) {
        id
        address
      }
      viaB_USDT: pools(
        where: {
          tokensList_contains: [$b,$st1]
          tokensCount: 2
          totalLiquidity_gt: "0"
        }
        first: 100
      ) {
        id
        address
      }
      viaB_DAI: pools(
        where: {
          tokensList_contains: [$b,$st2]
          tokensCount: 2
          totalLiquidity_gt: "0"
        }
        first: 100
      ) {
        id
        address
      }
    }
  `;
  const variables = {
    a: tokenIn,
    b: tokenOut,
    st0: USDC,
    st1: USDT,
    st2: DAI,
  };

  const result = await request(BALANCER_SUBGRAPH_URL, query, variables);
  const allPoolsRaw = [
    ...result.direct,
    ...result.viaA_USDC,
    ...result.viaA_USDT,
    ...result.viaA_DAI,
    ...result.viaB_USDC,
    ...result.viaB_USDT,
    ...result.viaB_DAI,
  ];

  // Combine + dedupe by pool ID (id is bytes32 poolId)
  const uniqueMap = new Map();
  allPoolsRaw.forEach((p) => uniqueMap.set(p.id, p));
  const candidatePools = Array.from(uniqueMap.values());

  // --- 2) Load on‐chain pool data into SOR ---
  const sor = await getSor(window.ethereum);
  // poolIds is the array of bytes32 IDs
  const poolIds = candidatePools.map((p) => p.id);
  // fetchPools expects { poolIds: string[], includeDeep?: boolean }
  await sor.fetchPools({ poolIds });

  // Now extract the pools from SOR’s dataService cache
  const pools = poolIds
    .map((pid) => sor.dataService.getPool(pid))
    .filter((pool) => pool !== undefined);

  return pools;
}

// --- 2b) Helper: calculate output of a single-pool swap for a given input ---
async function getSinglePoolOutput(sor, poolId, tokenIn, tokenOut, amountInBn) {
  // Clear and reload SOR with only that pool
  sor.dataService.clear();
  await sor.fetchPools({ poolIds: [poolId] });

  const swapType = SwapTypes.SwapExactIn;
  const result = await sor.getSwaps(
    tokenIn,
    tokenOut,
    amountInBn.toString(),
    swapType,
    {
      maxPools: 2,
      forceRefresh: false,
    }
  );
  if (result.swaps.length === 0) {
    return BigInt(0);
  }
  return BigInt(result.returnAmount.toString());
}

// --- 3) Find the best single‐ or split‐two‐pool path ---
async function selectBestPath(tokenInObject, tokenOutObject, pools, rawInBn) {
  if (!BigNumber.isBigNumber(rawInBn)) {
    throw new Error('[selectBestPath] rawIn must be a BigNumber');
  }
  if (rawInBn.isZero()) {
    throw new Error('[selectBestPath] rawIn cannot be zero');
  }
  if (pools.length === 0) {
    throw new Error('No Balancer V3 pools found');
  }

  // Instantiate token addresses
  const tokenA = tokenInObject.address.toLowerCase();
  const tokenB = tokenOutObject.address.toLowerCase();

  // Initialize SOR
  const sor = await getSor(window.ethereum);

  // Step 1: find best single‐pool route
  const swapType = SwapTypes.SwapExactIn;
  const singleResult = await sor.getSwaps(
    tokenA,
    tokenB,
    rawInBn.toString(),
    swapType,
    {
      maxPools: 1,
      forceRefresh: false,
    }
  );
  if (singleResult.swaps.length === 0) {
    throw new Error('No SOR route for single pool');
  }
  const bestSinglePoolId = singleResult.swaps[0][0].poolId;

  const bestSingleOutBI = JSBI.BigInt(singleResult.returnAmount.toString());
  const bestSingleInfo = {
    poolId: bestSinglePoolId,
    returnAmountBI: bestSingleOutBI,
  };

  // Step 2: find second‐best disjoint pool (highest output among the rest)
  // Gather outputs for all other pools, then pick top two disjoint.

  // Build a list of all single-pool outputs
  const outputs = [];
  for (const pool of pools) {
    const pid = pool.id;
    const outBI = await getSinglePoolOutput(sor, pid, tokenA, tokenB, rawInBn);
    outputs.push({ poolId: pid, outBI });
  }
  // Sort descending by outBI
  outputs.sort((x, y) => (JSBI.greaterThan(x.outBI, y.outBI) ? -1 : 1));

  // Now outputs[0] is the best single (should match bestSingle), outputs[1] is second
  // We want the top two distinct poolIds:
  const top1 = outputs[0];
  let top2 = null;
  for (let i = 1; i < outputs.length; i++) {
    if (outputs[i].poolId.toLowerCase() !== top1.poolId.toLowerCase()) {
      top2 = outputs[i];
      break;
    }
  }
  if (!top2) {
    // No second pool available
    return [ { poolId: top1.poolId, fraction: 1, outBI: top1.outBI } ];
  }

  // Step 3: hill‐climb to find best split between top1 and top2
  const pool0 = top1.poolId;
  const pool1 = top2.poolId;

  // Helper: compute combined output for fraction f (0 <= f <= 1)
  async function totalOutFor(fr) {
    // clamp
    const f = Math.min(1, Math.max(0, fr));
    // split amounts
    const in0 = rawInBn.mul(Math.floor(f * 1e4)).div(1e4);
    const in1 = rawInBn.sub(in0);

    // get output for pool0
    const out0BI = await getSinglePoolOutput(sor, pool0, tokenA, tokenB, in0);
    // get output for pool1
    const out1BI = await getSinglePoolOutput(sor, pool1, tokenA, tokenB, in1);

    return {
      fraction: f,
      outBI: JSBI.add(out0BI, out1BI),
      legs: [
        { poolId: pool0, amountInBn: in0, outBI: out0BI },
        { poolId: pool1, amountInBn: in1, outBI: out1BI }
      ]
    };
  }

  // hill-climbing parameters
  let frac = 0.7;
  let step = 0.1;
  const minStep = 0.01;

  let best = await totalOutFor(frac);

  while (step >= minStep) {
    const upFrac = Math.min(1, frac + step);
    const downFrac = Math.max(0, frac - step);

    const [upRes, downRes] = await Promise.all([
      totalOutFor(upFrac),
      totalOutFor(downFrac)
    ]);

    if (JSBI.greaterThan(upRes.outBI, best.outBI)) {
      best = upRes;
      frac = upFrac;
    } else if (JSBI.greaterThan(downRes.outBI, best.outBI)) {
      best = downRes;
      frac = downFrac;
    } else {
      step /= 2;
    }
  }

  // Compare best split vs best single
  if (JSBI.greaterThan(best.outBI, bestSingleOutBI)) {
    // Return two‐leg split
    return best.legs.map((leg) => ({
      poolId: leg.poolId,
      amountInBn: leg.amountInBn,
      returnAmountBI: leg.outBI
    }));
  } else {
    // Return single‐leg
    return [ { poolId: bestSinglePoolId, amountInBn: rawInBn, returnAmountBI: bestSingleOutBI } ];
  }
}

/** Combined helper: find and quote best path, returns array of { poolId, amountInBn, returnAmountBI } */
async function findAndSelectBestPath(tokenInObject, tokenOutObject, amountIn) {
  const pools = await findPossiblePools(tokenInObject, tokenOutObject);
  return await selectBestPath(tokenInObject, tokenOutObject, pools, amountIn);
}

// --- 4) Execute the swap(s) via Balancer Vault batchSwap ---
async function executeMixedSwaps(tradeLegs, tradeSummary, slippageBips = 50, gasPrice) {
  // tradeLegs: array of { poolId, amountInBn, returnAmountBI }
  // tradeSummary: { fromToken, toToken, sender: { address, balances }, ... }

  // 4a) Verify user balance
  if (tradeSummary.sender?.balances) {
    const totalIn = tradeLegs.reduce((acc, leg) => {
      return acc + BigInt(leg.amountInBn.toString());
    }, BigInt(0));
    const userBalRaw = BigInt(
      tradeSummary.sender.balances[tradeSummary.fromToken.address.toLowerCase()]
    );
    if (userBalRaw < totalIn) {
      return {
        success: false,
        error: new Error(`Insufficient balance of ${tradeSummary.fromToken.symbol}`),
      };
    }
  }

  // 4b) Build batchSwap parameters
  const swapKind = SwapTypes.SwapExactIn; // = 0
  const assetsSet = new Set();
  assetsSet.add(tradeSummary.fromToken.address);
  assetsSet.add(tradeSummary.toToken.address);

  // Each leg is a single‐pool swap (no multi-hop), so each step is one step
  for (const leg of tradeLegs) {
    // In a single‐pool swap, tokenIn→tokenOut are the only assets
    assetsSet.add(tradeSummary.fromToken.address);
    assetsSet.add(tradeSummary.toToken.address);
  }
  const assets = Array.from(assetsSet);

  const funds = {
    sender: tradeSummary.sender.address,
    fromInternalBalance: false,
    recipient: tradeSummary.sender.address,
    toInternalBalance: false,
  };

  // Build BatchSwapStep array: for each leg, exactly one step
  const swaps = [];
  for (const leg of tradeLegs) {
    swaps.push({
      poolId: leg.poolId,
      assetInIndex: assets.indexOf(tradeSummary.fromToken.address),
      assetOutIndex: assets.indexOf(tradeSummary.toToken.address),
      amount: leg.amountInBn.toString(),
      userData: '0x',
    });
  }

  // Build limits: matching assets array
  const limits = assets.map((addr) => {
    if (addr.toLowerCase() === tradeSummary.fromToken.address.toLowerCase()) {
      const totalIn = tradeLegs.reduce((acc, leg) => {
        return acc + BigInt(leg.amountInBn.toString());
      }, BigInt(0));
      return totalIn.toString();
    }
    if (addr.toLowerCase() === tradeSummary.toToken.address.toLowerCase()) {
      const totalOut = tradeLegs.reduce((acc, leg) => {
        return acc + leg.returnAmountBI;
      }, BigInt(0));
      const minOut = (totalOut * BigInt(10_000 - slippageBips)) / BigInt(10_000);
      return `-${minOut.toString()}`;
    }
    return '0';
  });

  // 4c) Encode call data for Vault.batchSwap
  const vaultInterface = new ethers.utils.Interface([
    'function batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256) payable returns (int256[])',
  ]);
  const deadline = Math.floor(Date.now() / 1_000) + 120;
  const callData = vaultInterface.encodeFunctionData('batchSwap', [
    swapKind,
    swaps,
    assets,
    funds,
    limits,
    deadline,
  ]);

  // 4d) Compute msg.value if swapping ETH
  const ethValue = tradeLegs.reduce((sumBn, leg) => {
    if (tradeSummary.fromToken.address.toLowerCase() === nativeAddress) {
      return sumBn.add(BigNumber.from(leg.amountInBn.toString()));
    }
    return sumBn;
  }, BigNumber.from(0));

  // 4e) Send transaction via electronAPI
  return window.electronAPI.sendTrade({
    tradeSummary: JSON.parse(JSON.stringify(tradeSummary)),
    args: [
      BALANCER_VAULT_ADDRESS,
      callData,
      {
        value: ethValue.toString(),
        maxFeePerGas: ethers.utils.parseUnits(
          (Number(gasPrice) * 1.65) / 1e9,
          9
        ),
        maxPriorityFeePerGas: ethers.utils.parseUnits(
          (0.02 + Math.random() * 0.05 + Number(gasPrice) / 50e9).toFixed(3),
          9
        ),
      },
    ],
  });
}

export function useBalancerV3() {
  return {
    findPossiblePools,
    selectBestPath,
    findAndSelectBestPath,
    executeMixedSwaps,
  };
}