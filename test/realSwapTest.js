import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;
import { useMixedUniswapBalancer } from '../src/renderer/utils/useMixedUniswapBalancer.js';
import { createExecutionPlan, createEncoderExecutionPlan } from '../src/renderer/utils/executionPlan.js';
import { BundlerManager } from '../src/bundler/BundlerManager.js';

// ===== TEST PARAMETERS =====
const TEST_PARAMS = {
  // tokenInObject: {
  //   address: '0x91c65c2a9a3adfe2424ecc4a4890b8334c3a8212', // ETH
  //   symbol: 'ONE',
  //   decimals: 18
  // },
  tokenOutObject: {
    address: '0x0000000000000000000000000000000000000000', // osETH
    symbol: 'ETH',
    decimals: 18
  },
  // tokenOutObject: {
  //   address: '0x45804880De22913dAFE09f4980848ECE6EcbAf78', // AAVE
  //   symbol: 'PAXG',
  //   decimals: 18
  // },
  tokenInObject: {
    address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', // AAVE
    symbol: 'AAVE',
    decimals: 18
  },
  amountIn: '0.000964', // In human-readable format, not wei
  slippageTolerance: 20 // 0.5%
};

// ===== DEPLOYED CONTRACT ADDRESSES =====
const DEPLOYED_ADDRESSES = {
  bundlerRegistry: '0x4df4B688d6F7954F6F53787B2e2778720BaB5d28',
  uniswapEncoder: '0xC4C550daC072f5A9cf68aaafb98a7A573805061c',  // V4 with correct action codes
  balancerEncoder: '0x5d0927B13E2e0ecDEb20aD2c0E76e62acd36b080'
};

describe("Real Swap Integration Test", function () {
  let wallet;
  let provider;
  let bundlerManager;
  let bundlerAddress;
  let walletBundler;

  before(async function () {
    console.log("\n🔧 Setting up test environment...\n");

    // Get signer (the wallet that will execute the trade)
    [wallet] = await ethers.getSigners();
    provider = ethers.provider;

    console.log("Test Wallet:", wallet.address);

    // Check balance for input token
    // let balance;
    // const amountInWei = ethers.utils.parseUnits(
    //   TEST_PARAMS.amountIn,
    //   TEST_PARAMS.tokenInObject.decimals
    // );

    // if (TEST_PARAMS.tokenInObject.address === ethers.constants.AddressZero) {
    //   // ETH balance
    //   balance = await wallet.getBalance();
    //   console.log(`${TEST_PARAMS.tokenInObject.symbol} Balance:`, ethers.utils.formatEther(balance), TEST_PARAMS.tokenInObject.symbol);

    //   if (balance.lt(amountInWei)) {
    //     throw new Error(
    //       `Insufficient ${TEST_PARAMS.tokenInObject.symbol} balance. ` +
    //       `Need ${TEST_PARAMS.amountIn} ${TEST_PARAMS.tokenInObject.symbol}, ` +
    //       `have ${ethers.utils.formatEther(balance)} ${TEST_PARAMS.tokenInObject.symbol}`
    //     );
    //   }
    // } else {
    //   // ERC20 token balance
    //   const tokenContract = new ethers.Contract(
    //     TEST_PARAMS.tokenInObject.address,
    //     ["function balanceOf(address) view returns (uint256)"],
    //     provider
    //   );
    //   balance = await tokenContract.balanceOf(wallet.address);
    //   console.log(
    //     `${TEST_PARAMS.tokenInObject.symbol} Balance:`,
    //     ethers.utils.formatUnits(balance, TEST_PARAMS.tokenInObject.decimals),
    //     TEST_PARAMS.tokenInObject.symbol
    //   );

    //   if (balance.lt(amountInWei)) {
    //     throw new Error(
    //       `Insufficient ${TEST_PARAMS.tokenInObject.symbol} balance. ` +
    //       `Need ${TEST_PARAMS.amountIn} ${TEST_PARAMS.tokenInObject.symbol}, ` +
    //       `have ${ethers.utils.formatUnits(balance, TEST_PARAMS.tokenInObject.decimals)} ${TEST_PARAMS.tokenInObject.symbol}`
    //     );
    //   }
    // }

    // Initialize BundlerManager
    console.log("\n📦 Initializing BundlerManager...");
    bundlerManager = new BundlerManager(
      provider,
      wallet,
      DEPLOYED_ADDRESSES.bundlerRegistry
    );

    // Get bundler address for this wallet
    console.log("Querying BundlerRegistry for wallet's bundler...");
    bundlerAddress = await bundlerManager.getBundlerAddress(wallet.address);

    if (!bundlerAddress || bundlerAddress === ethers.constants.AddressZero) {
      throw new Error(
        `No bundler found for wallet ${wallet.address}.\n` +
        `Please run: npx hardhat run scripts/registerBundler.js --network mainnet`
      );
    }

    console.log("✓ Found existing bundler:", bundlerAddress);

    // Get WalletBundler contract instance
    const WalletBundlerArtifact = await hre.artifacts.readArtifact("WalletBundler");
    walletBundler = new ethers.Contract(bundlerAddress, WalletBundlerArtifact.abi, wallet);

    console.log("\n✅ Setup complete\n");
  });

  it("Should find optimal route and generate execution plan", async function () {
    this.timeout(120000); // 2 minutes for routing

    console.log("\n🔍 Finding optimal route...");
    console.log(`   From: ${TEST_PARAMS.amountIn} ${TEST_PARAMS.tokenInObject.symbol}`);
    console.log(`   To: ${TEST_PARAMS.tokenOutObject.symbol}`);
    console.log(`   Slippage: ${TEST_PARAMS.slippageTolerance}%\n`);

    // Convert amountIn to wei
    const amountInWei = ethers.utils.parseUnits(
      TEST_PARAMS.amountIn,
      TEST_PARAMS.tokenInObject.decimals
    );

    // Find best route using the routing optimizer
    const routeResult = await useMixedUniswapBalancer({
      tokenInObject: TEST_PARAMS.tokenInObject,
      tokenOutObject: TEST_PARAMS.tokenOutObject,
      amountIn: amountInWei,
      provider: provider,
      slippageTolerance: TEST_PARAMS.slippageTolerance,
      useUniswap: true,
      useBalancer: true
    });

    expect(routeResult).to.not.be.null;
    expect(routeResult.bestRoute).to.not.be.null;
    expect(routeResult.bestRoute.totalOutput).to.not.equal(0);

    console.log("\n✅ Route found:");
    console.log(`   Type: ${routeResult.bestRoute.type}`);
    console.log(`   Expected Output: ${ethers.utils.formatUnits(
      routeResult.bestRoute.totalOutput,
      TEST_PARAMS.tokenOutObject.decimals
    )} ${TEST_PARAMS.tokenOutObject.symbol}`);

    if (routeResult.bestRoute.splits) {
      console.log("\n   Split Details:");
      routeResult.bestRoute.splits.forEach((split, i) => {
        console.log(`      ${i + 1}. ${split.protocol}: ${(split.percentage * 100).toFixed(2)}%`);
      });
    }

    // Create execution plan
    console.log("\n📋 Creating execution plan...");
    console.log(`   Passing amountInWei: ${amountInWei.toString()} wei`);
    const executionPlan = await createExecutionPlan(
      routeResult.bestRoute,
      TEST_PARAMS.tokenInObject,
      TEST_PARAMS.tokenOutObject,
      TEST_PARAMS.slippageTolerance,
      amountInWei  // Pass the input amount for normalization
    );

    expect(executionPlan).to.not.be.null;
    expect(executionPlan.executionSteps.length).to.be.greaterThan(0);

    console.log(`   Total Steps: ${executionPlan.executionSteps.length}`);
    console.log(`   Protocols: ${executionPlan.summary.protocols.join(', ')}`);
    console.log(`   Min Output: ${executionPlan.summary.minOutput} ${TEST_PARAMS.tokenOutObject.symbol}`);

    // Generate encoder execution plan
    console.log("\n🔧 Generating encoder execution plan...");
    const encoderPlan = createEncoderExecutionPlan(
      executionPlan,
      TEST_PARAMS.tokenInObject,
      TEST_PARAMS.tokenOutObject,
      TEST_PARAMS.slippageTolerance
    );

    expect(encoderPlan).to.not.be.null;
    expect(encoderPlan.encoderTargets.length).to.equal(encoderPlan.encoderData.length);
    expect(encoderPlan.encoderTargets.length).to.equal(encoderPlan.wrapOperations.length);

    console.log("\n📦 Encoder Plan Details:");
    console.log(`   Steps: ${encoderPlan.encoderTargets.length}`);
    console.log(`   From Token: ${encoderPlan.fromToken}`);
    console.log(`   From Amount: ${ethers.utils.formatUnits(encoderPlan.fromAmount, TEST_PARAMS.tokenInObject.decimals)} ${TEST_PARAMS.tokenInObject.symbol}`);
    console.log(`   To Token: ${encoderPlan.toToken}`);
    console.log(`   Expected Output: ${ethers.utils.formatUnits(encoderPlan.metadata.expectedOutput, TEST_PARAMS.tokenOutObject.decimals)} ${TEST_PARAMS.tokenOutObject.symbol}`);

    console.log("\n   Encoder Targets:");
    encoderPlan.encoderTargets.forEach((target, i) => {
      const protocol = target === DEPLOYED_ADDRESSES.uniswapEncoder ? 'Uniswap' : 'Balancer';
      const wrapOpNames = ['None', 'Wrap before', 'Wrap after', 'Unwrap before', 'Unwrap after'];
      console.log(`      ${i + 1}. ${protocol} (Wrap: ${wrapOpNames[encoderPlan.wrapOperations[i]]})`);
    });

    // Prepare contract call arguments
    const contractCallArgs = {
      fromToken: encoderPlan.fromToken,
      fromAmount: encoderPlan.fromAmount,
      toToken: encoderPlan.toToken,
      encoderTargets: encoderPlan.encoderTargets,
      encoderData: encoderPlan.encoderData,
      wrapOperations: encoderPlan.wrapOperations
    };

    console.log("\n📝 Contract Call Arguments:");
    console.log(JSON.stringify({
      fromToken: contractCallArgs.fromToken,
      fromAmount: contractCallArgs.fromAmount.toString(),
      toToken: contractCallArgs.toToken,
      encoderTargets: contractCallArgs.encoderTargets,
      wrapOperations: contractCallArgs.wrapOperations,
      encoderDataLengths: contractCallArgs.encoderData.map(d => d.length)
    }, null, 2));

    // ========================================
    // COMMENTED OUT: Actual swap execution
    // ========================================
    console.log("\n🚀 Executing swap on WalletBundler...");
    console.log(`   Bundler Address: ${bundlerAddress}`);

    // Check if we're sending ETH
    const msgValue = contractCallArgs.fromToken === ethers.constants.AddressZero
      ? contractCallArgs.fromAmount
      : 0;

    console.log(`   ETH Value: ${ethers.utils.formatEther(msgValue)} ETH`);

    // Get current gas price and set custom gas parameters
    const currentGasPrice = await provider.getGasPrice();
    const maxFeePerGas = currentGasPrice.mul(2); // 2x base gas price
    const maxPriorityFeePerGas = ethers.BigNumber.from(1000000); // 10 wei

    console.log(`   Base Gas Price: ${ethers.utils.formatUnits(currentGasPrice, 'gwei')} gwei`);
    console.log(`   Max Fee Per Gas: ${ethers.utils.formatUnits(maxFeePerGas, 'gwei')} gwei`);
    console.log(`   Max Priority Fee: ${maxPriorityFeePerGas.toString()} wei`);

    console.log(contractCallArgs.encoderData)

    if (contractCallArgs.encoderTargets.length <= 1) return console.log('not interesting tx to try')
    // Execute the swap
    const tx = await walletBundler.encodeAndExecuteaaaaaYops(
      contractCallArgs.fromToken,
      contractCallArgs.fromAmount,
      contractCallArgs.toToken,
      contractCallArgs.encoderTargets,
      contractCallArgs.encoderData,
      contractCallArgs.wrapOperations,
      {
        value: msgValue,
        maxFeePerGas: maxFeePerGas,
        maxPriorityFeePerGas: maxPriorityFeePerGas,
        gasLimit: 1500000  // Fixed gas limit to skip estimation and see actual error
      }
    );

    console.log(`   Transaction Hash: ${tx.hash}`);
    console.log("   Waiting for confirmation...");

    const receipt = await tx.wait();

    console.log(`   ✅ Transaction confirmed in block ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);
    console.log(`   Gas Cost: ${ethers.utils.formatEther(receipt.gasUsed.mul(receipt.effectiveGasPrice))} ETH`);

    // Check final balance
    if (contractCallArgs.toToken === ethers.constants.AddressZero) {
      const finalBalance = await wallet.getBalance();
      console.log(`   Final ETH Balance: ${ethers.utils.formatEther(finalBalance)} ETH`);
    } else {
      const tokenContract = await ethers.getContractAt(
        ["function balanceOf(address) view returns (uint256)"],
        contractCallArgs.toToken
      );
      const finalBalance = await tokenContract.balanceOf(wallet.address);
      console.log(`   Final ${TEST_PARAMS.tokenOutObject.symbol} Balance: ${ethers.utils.formatUnits(finalBalance, TEST_PARAMS.tokenOutObject.decimals)} ${TEST_PARAMS.tokenOutObject.symbol}`);
    }
  });
});
