// useBalancerV3.js
// A Vue 3 composable for Balancer V3 swaps, path finding, best-route selection,
// price tracking, and swap execution in an Electron + Vue3 environment.

import {
    BalancerApi,
    ChainId,
    Slippage,
    SwapKind,
    Token,
    TokenAmount,
    Swap,
} from "@balancer/sdk";

// import { SOR, SwapTypes } from '@balancer-labs/sor';

// User defined
const chainId = ChainId.MAINNET;
const swapKind = SwapKind.GivenIn;

// ------------ Configuration constants ------------
const nativeAddress = '0x0000000000000000000000000000000000000000';
const nativeAddressE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

// Balancer V3 Vault address on Mainnet
const BALANCER_VAULT_ADDRESS = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';

// Subgraph URL: replace with your Balancer V3 subgraph endpoint
const API_KEY                    = '85a93cb8cc32fa52390e51a09125a6fc';
const BALANCER_SUBGRAPH_URL = `https://gateway.thegraph.com/api/${API_KEY}/subgraphs/id/4rixbLvpuBCwXTJSwyAzQgsLR8KprnyMfyCuXT8Fj5cd`;

export function useBalancerV3() {
  async function findTradeBalancer(tokenInObject, tokenOutObject, amountIn, senderAddress) {
    const tokenIn = new Token(
      chainId,
      tokenInObject.address === nativeAddress ? nativeAddressE : tokenInObject.address,
      tokenInObject.decimals,
      tokenInObject.symbol,
    );
    const tokenOut = new Token(
      chainId,
      tokenOutObject.address === nativeAddress ? nativeAddressE : tokenOutObject.address,
      tokenOutObject.decimals,
      tokenOutObject.symbol,
    );
    const wethIsEth = true; // If true, incoming ETH will be wrapped to WETH, otherwise the Vault will pull WETH tokens
    const deadline = 999999999999999999n; // Deadline for the swap, in this case infinite
    const slippage = Slippage.fromPercentage("0.5"); // 0.1%
    const swapAmount = TokenAmount.fromHumanAmount(tokenIn, amountIn + '');

    // API is used to fetch best swap paths from available liquidity across v2 and v3
    const balancerApi = new BalancerApi(
      "https://api-v3.balancer.fi/",
      chainId
    );

    const sorPaths = await balancerApi.sorSwapPaths.fetchSorSwapPaths({
      chainId,
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      swapKind,
      swapAmount,
      maxPools: 2,
      forceRefresh: true, // Force a fresh query instead of using cached data
      filterInvalidPools: true // Filter out pools that might cause issues
    });

    // const swapAmountOut = TokenAmount.fromHumanAmount(tokenOut, (amountIn * tokenInObject.price / tokenOutObject.price).toFixed(6));
    
    // const sorPaths = await balancerApi.sorSwapPaths.fetchSorSwapPaths({
    //   chainId,
    //   tokenIn: tokenIn.address,
    //   tokenOut: tokenOut.address,
    //   swapKind: SwapKind.GivenOut,
    //   swapAmount: swapAmountOut,
    //   maxPools: 4,
    // });

    // Swap object provides useful helpers for re-querying, building call, etc
    const swap = new Swap({
      chainId,
      paths: sorPaths,
      swapKind,
    });

    console.log(
      `Amount: ${swap.outputAmount.amount}`
    );

    const rpcUrls = await window.electronAPI.getInfuraKeys();
    const updated = await swap.query(rpcUrls[0]);
    console.log(updated);
    console.log(`Updated amount: ${updated.expectedAmountOut.amount}`);

    let buildInput;
    // In v2 the sender/recipient can be set, in v3 it is always the msg.sender
    if (swap.protocolVersion === 2) {
      console.log(`Using v2 protocol version`);
      buildInput = {
        slippage,
        deadline,
        queryOutput: updated,
        wethIsEth,
        sender: senderAddress,
        recipient: senderAddress,
      };
    } else {
      console.log(`Using v3 protocol version`);
      buildInput = {
        slippage,
        deadline,
        queryOutput: updated,
        wethIsEth,
      };
    }
    const callData = swap.buildCall(buildInput);
    // console.log(
    //   `Min Amount Out: ${callData.minAmountOut.amount}\n\nTx Data:\nTo: ${callData.to}\nCallData: ${callData.callData}\nValue: ${callData.value}`
    // );
    // console.log(callData)

    return {
      ...callData,
      contractAddress: updated.to,
      expectedAmountOut: updated.expectedAmountOut.amount,
    }
  }
  
  // async function findTradeBalancerSOR(tokenInObject, tokenOutObject, amountIn, senderAddress) {
  //   try {
  //     const rpcUrls = await window.electronAPI.getInfuraKeys();
      
  //     // Initialize SOR with correct configuration structure
  //     const sor = new SOR(
  //       {
  //         chainId: chainId,
  //         provider: rpcUrls[0], // Use 'provider' instead of 'rpcUrl'
  //         subgraphUrl: BALANCER_SUBGRAPH_URL,
  //         poolsUrl: '', // Optional: URL for pools data
  //         weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH address on mainnet
  //       }
  //     );

  //     // Fetch pools data
  //     await sor.fetchPools();

  //     // Convert token addresses for Balancer (handle native ETH)
  //     const tokenInAddress = tokenInObject.address === nativeAddress ? nativeAddressE : tokenInObject.address;
  //     const tokenOutAddress = tokenOutObject.address === nativeAddress ? nativeAddressE : tokenOutObject.address;

  //     // Convert amount to wei/smallest unit
  //     const amountInWei = (BigInt(Math.floor(amountIn * Math.pow(10, tokenInObject.decimals)))).toString();

  //     // Get swap information
  //     const swapInfo = await sor.getSwaps(
  //       tokenInAddress,
  //       tokenOutAddress,
  //       SwapTypes.SwapExactIn,
  //       amountInWei
  //     );

  //     if (!swapInfo || !swapInfo.swaps || swapInfo.swaps.length === 0) {
  //       throw new Error('No swap routes found');
  //     }

  //     console.log(`SOR Amount Out: ${swapInfo.returnAmount}`);
  //     console.log(`SOR Routes: ${swapInfo.swaps.length}`);

  //     // Build transaction data
  //     const slippage = Slippage.fromPercentage("0.5"); // 0.5% slippage
  //     const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now

  //     // Calculate minimum amount out with slippage
  //     const minAmountOut = BigInt(swapInfo.returnAmount) * BigInt(995) / BigInt(1000); // 0.5% slippage

  //     return {
  //       to: BALANCER_VAULT_ADDRESS,
  //       callData: swapInfo.swaps, // This contains the swap routes
  //       value: tokenInObject.address === nativeAddress ? amountInWei : '0',
  //       expectedAmountOut: swapInfo.returnAmount,
  //       minAmountOut: minAmountOut.toString(),
  //       swapInfo: swapInfo,
  //       gasEstimate: swapInfo.gasEstimate || '300000' // Default gas estimate
  //     };

  //   } catch (error) {
  //     console.error('SOR swap error:', error);
  //     throw error;
  //   }
  // }

  return {
    findTradeBalancer,
    // findTradeBalancerSOR,
  };
}