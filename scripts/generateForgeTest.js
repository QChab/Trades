#!/usr/bin/env node

/**
 * Generate Forge test data from routing optimizer
 * This script:
 * 1. Finds optimal route for token swap
 * 2. Generates encoder execution plan
 * 3. Updates RealSwapTest.t.sol with the generated data
 */

import hre from "hardhat";
const { ethers } = hre;
import { useMixedUniswapBalancer } from '../src/renderer/utils/useMixedUniswapBalancer.js';
import { createExecutionPlan, createEncoderExecutionPlan } from '../src/renderer/utils/executionPlan.js';
import fs from 'fs';
import path from 'path';

// ===== CONFIGURATION =====
const CONFIG = {
  // Token addresses - modify these to test different swaps
  tokenIn: {
    address: '0x0000000000000000000000000000000000000000', // ETH (use 0x0 for ETH)
    symbol: 'ETH',
    decimals: 18
  },
  // tokenOut: {
  //   address: '0x45804880De22913dAFE09f4980848ECE6EcbAf78', // PAXG
  //   symbol: 'PAXG',
  //   decimals: 18
  // },
  tokenOut: {
    address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', // AAVE
    symbol: 'AAVE',
    decimals: 18
  },
  amountIn: '0.0000964', // In human-readable format
  slippageTolerance: 20, // 20%

  // Contract addresses
  bundlerAddress: '0x8B9Af27381b9a12cB20b2b09ae005dC7f0c2eac8',
  uniswapEncoder: '0x11d264629b6277a6fABb2870318982CC9353fffb',
  balancerEncoder: '0x9fAb0aEaA4B54C2Ab94d1a2414CF96B4102eFc4B',

  // File paths
  testFilePath: './test/RealSwapTest.t.sol'
};

// Common token addresses for easy reference
const TOKENS = {
  ETH: { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 },
  WETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: 18 },
  USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
  USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
  DAI: { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', decimals: 18 },
  AAVE: { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', symbol: 'AAVE', decimals: 18 },
  PAXG: { address: '0x45804880De22913dAFE09f4980848ECE6EcbAf78', symbol: 'PAXG', decimals: 18 },
  ONE: { address: '0x91c65c2a9a3adfe2424ecc4a4890b8334c3a8212', symbol: 'ONE', decimals: 18 }
};

/**
 * Generate encoder execution plan for given token pair
 */
async function generateEncoderPlan(tokenIn, tokenOut, amountIn, slippageTolerance, provider) {
  console.log('\n🔍 Finding optimal route...');
  console.log(`   From: ${amountIn} ${tokenIn.symbol} (${tokenIn.address})`);
  console.log(`   To: ${tokenOut.symbol} (${tokenOut.address})`);
  console.log(`   Slippage: ${slippageTolerance}%\n`);

  // Convert amountIn to wei
  const amountInWei = ethers.utils.parseUnits(amountIn, tokenIn.decimals);
  console.log(`   Amount in wei: ${amountInWei.toString()}\n`);

  // Find best route
  const routeResult = await useMixedUniswapBalancer({
    tokenInObject: tokenIn,
    tokenOutObject: tokenOut,
    amountIn: amountInWei,
    provider: provider,
    slippageTolerance: slippageTolerance,
    useUniswap: true,
    useBalancer: true
  });

  if (!routeResult || !routeResult.bestRoute) {
    throw new Error('No route found');
  }

  console.log('✅ Route found:');
  console.log(`   Type: ${routeResult.bestRoute.type}`);
  console.log(`   Expected Output: ${ethers.utils.formatUnits(
    routeResult.bestRoute.totalOutput,
    tokenOut.decimals
  )} ${tokenOut.symbol}`);

  if (routeResult.bestRoute.splits) {
    console.log('\n   Split Details:');
    routeResult.bestRoute.splits.forEach((split, i) => {
      console.log(`      ${i + 1}. ${split.protocol}: ${(split.percentage * 100).toFixed(2)}%`);
    });
  }

  // Create execution plan
  console.log('\n📋 Creating execution plan...');
  const executionPlan = await createExecutionPlan(
    routeResult.bestRoute,
    tokenIn,
    tokenOut,
    slippageTolerance,
    amountInWei
  );

  console.log(`   Total Steps: ${executionPlan.executionSteps.length}`);
  console.log(`   Protocols: ${executionPlan.summary.protocols.join(', ')}`);

  // Generate encoder execution plan
  console.log('\n🔧 Generating encoder execution plan...');
  const encoderPlan = createEncoderExecutionPlan(
    executionPlan,
    tokenIn,
    tokenOut,
    slippageTolerance
  );

  console.log('\n📦 Encoder Plan Details:');
  console.log(`   Steps: ${encoderPlan.encoderTargets.length}`);
  console.log(`   From Token: ${encoderPlan.fromToken}`);
  console.log(`   From Amount: ${encoderPlan.fromAmount.toString()}`);
  console.log(`   To Token: ${encoderPlan.toToken}`);

  const wrapOpNames = ['None', 'Wrap before', 'Wrap after', 'Unwrap before', 'Unwrap after'];
  console.log('\n   Encoder Targets:');
  encoderPlan.encoderTargets.forEach((target, i) => {
    const protocol = target === CONFIG.uniswapEncoder ? 'Uniswap' : 'Balancer';
    console.log(`      ${i + 1}. ${protocol} (Wrap: ${wrapOpNames[encoderPlan.wrapOperations[i]]})`);
  });

  return encoderPlan;
}

/**
 * Convert bytes to hex string for Solidity
 */
function bytesToHex(bytes) {
  return '0x' + Buffer.from(bytes.slice(2), 'hex').toString('hex');
}

/**
 * Generate Solidity array initialization code
 */
function generateSolidityArrays(encoderPlan) {
  // Encoder targets
  const encoderTargetsCode = encoderPlan.encoderTargets
    .map((target, i) => `        encoderTargets[${i}] = ${target};`)
    .join('\n');

  // Encoder data (as hex strings)
  const encoderDataCode = encoderPlan.encoderData
    .map((data, i) => `        encoderData[${i}] = hex"${data.slice(2)}";`)
    .join('\n');

  // Wrap operations
  const wrapOpsCode = encoderPlan.wrapOperations
    .map((op, i) => `        wrapOps[${i}] = ${op};`)
    .join('\n');

  return {
    length: encoderPlan.encoderTargets.length,
    encoderTargetsCode,
    encoderDataCode,
    wrapOpsCode
  };
}

/**
 * Update RealSwapTest.t.sol with new test data
 */
function updateTestFile(tokenIn, tokenOut, amountInWei, encoderPlan, bundlerAddress) {
  const testFilePath = path.resolve(CONFIG.testFilePath);
  let content = fs.readFileSync(testFilePath, 'utf8');

  // Generate array initialization code
  const arrays = generateSolidityArrays(encoderPlan);

  // Prepare replacement values
  const fromToken = tokenIn.address === ethers.constants.AddressZero ? 'ETH' : tokenIn.symbol.toUpperCase();
  const toToken = tokenOut.symbol.toUpperCase();
  const testName = `test${fromToken}to${toToken}Swap`;

  // Update token constants
  content = content.replace(
    /address constant ETH = address\(0\);/,
    `address constant ETH = address(0);`
  );

  // Create new test function
  const newTestFunction = `
    function ${testName}() public {
        // ${fromToken} -> ${toToken} swap
        uint256 amountIn = ${amountInWei.toString()}; // ${ethers.utils.formatUnits(amountInWei, tokenIn.decimals)} ${tokenIn.symbol} in wei

        console.log("\\n=== Testing ${fromToken} -> ${toToken} Swap ===");
        console.log("Amount In:", amountIn, "wei");

        // Build encoder targets
        address[] memory encoderTargets = new address[](${arrays.length});
${arrays.encoderTargetsCode}

        // Build encoder data
        bytes[] memory encoderData = new bytes[](${arrays.length});
${arrays.encoderDataCode}

        // Wrap operations
        uint8[] memory wrapOps = new uint8[](${arrays.length});
${arrays.wrapOpsCode}

        // Impersonate the owner to call the function
        vm.startPrank(owner);
        vm.deal(owner, 1 ether); // Give owner some ETH

        // Call with ETH value
        walletBundler.encodeAndExecuteaaaaaYops{value: amountIn}(
            ${tokenIn.address === ethers.constants.AddressZero ? 'ETH' : `0x${tokenIn.address.slice(2)}`},           // fromToken
            amountIn,      // fromAmount
            0x${tokenOut.address.slice(2)},          // toToken
            encoderTargets,
            encoderData,
            wrapOps
        );

        vm.stopPrank();

        console.log("${fromToken} -> ${toToken} swap succeeded!");
    }
`;

  // Replace the test function (find testETHtoPAXGSwap and replace)
  const testFunctionRegex = /function test\w+Swap\(\) public \{[\s\S]*?\n    \}/;
  if (testFunctionRegex.test(content)) {
    content = content.replace(testFunctionRegex, newTestFunction.trim());
  } else {
    // If no test function found, insert before the closing brace of the contract
    const insertPosition = content.lastIndexOf('}');
    content = content.slice(0, insertPosition) + '\n' + newTestFunction + '\n}';
  }

  // Update token constants if needed
  const tokenConstantsRegex = /\/\/ Token addresses[\s\S]*?\/\/ Deployed contracts/;
  // address constant AAVE = 0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9;
  //   address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
  //   address constant ETH = address(0);
  //   address constant PAXG = 0x45804880De22913dAFE09f4980848ECE6EcbAf78;
  const newTokenConstants = `// Token addresses
    address constant ${tokenIn.symbol.toUpperCase()} = ${tokenIn.address === ethers.constants.AddressZero ? 'address(0)' : `0x${tokenIn.address.slice(2)}`};
    address constant ${tokenOut.symbol.toUpperCase()} = 0x${tokenOut.address.slice(2)};

    // Deployed contracts`;

  content = content.replace(tokenConstantsRegex, newTokenConstants);

  // Write back to file
  fs.writeFileSync(testFilePath, content, 'utf8');
  console.log(`\n✅ Updated ${testFilePath}`);
  console.log(`   Test function: ${testName}()`);
}

/**
 * Main execution
 */
async function main() {
  console.log('\n🚀 Generating Forge test data...\n');

  // Get provider
  const provider = ethers.provider;

  // Generate encoder plan
  const encoderPlan = await generateEncoderPlan(
    CONFIG.tokenIn,
    CONFIG.tokenOut,
    CONFIG.amountIn,
    CONFIG.slippageTolerance,
    provider
  );

  // Convert amountIn to wei for test file
  const amountInWei = ethers.utils.parseUnits(CONFIG.amountIn, CONFIG.tokenIn.decimals);

  // Update test file
  updateTestFile(
    CONFIG.tokenIn,
    CONFIG.tokenOut,
    amountInWei,
    encoderPlan,
    CONFIG.bundlerAddress
  );

  console.log('\n✅ Test generation complete!\n');
  console.log('Run with: forge test --match-test test -vv\n');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { generateEncoderPlan, updateTestFile, TOKENS, CONFIG };
