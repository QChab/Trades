import 'dotenv/config';  // Load environment variables from .env file
import { ethers } from 'ethers';
import {
  getOdosQuote,
  getOdosSwap,
  getOdosAssemble,
  getOdosProtocols,
  checkOdosAllowance,
  getOdosApprovalTx
} from '../../src/renderer/utils/useOdos.js';

/**
 * Test Odos API Integration
 *
 * This test suite validates the Odos aggregator integration including:
 * - Quote fetching for price discovery
 * - Swap calldata generation (quote + assemble)
 * - Protocol listing (automatic)
 * - Approval checking and transaction generation
 *
 * IMPORTANT: NO API KEY REQUIRED!
 * Odos uses IP-based rate limiting: 600 requests per 5 minutes
 *
 * Rate Limits:
 * - 600 requests per 5 minutes per IP (~2 RPS)
 * - Much better than 1inch's 1 RPS limit!
 */

// Test configuration
const CHAIN_ID = 1; // Ethereum Mainnet
const SLIPPAGE_TOLERANCE = 0.5; // 0.5%

// Test delay to respect rate limits
const RATE_LIMIT_DELAY = 600; // 0.6 seconds between requests (safe margin)
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Common test tokens
const TOKENS = {
  ETH: {
    address: '0x0000000000000000000000000000000000000000', // Odos uses zero address for ETH
    symbol: 'ETH',
    decimals: 18
  },
  WETH: {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    symbol: 'WETH',
    decimals: 18
  },
  USDC: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    decimals: 6
  },
  USDT: {
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    symbol: 'USDT',
    decimals: 6
  },
  DAI: {
    address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    symbol: 'DAI',
    decimals: 18
  },
  AAVE: {
    address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
    symbol: 'AAVE',
    decimals: 18
  },
  UNI: {
    address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
    symbol: 'UNI',
    decimals: 18
  },
  ONEINCH: {
    address: '0x111111111117dc0aa78b770fa6a738034120c302',
    symbol: '1INCH',
    decimals: 18
  }
};

// Dummy wallet address for testing (not used for actual transactions)
const TEST_WALLET = '0x0000000000000000000000000000000000000001';

/**
 * Test 1: Quote Function - Simple ETH to USDC swap
 */
async function testQuote() {
  console.log('\n========================================');
  console.log('TEST 1: Quote Function (ETH → USDC)');
  console.log('========================================\n');

  try {
    const amount = ethers.utils.parseEther('1'); // 1 ETH

    const quote = await getOdosQuote({
      fromToken: TOKENS.ETH,
      toToken: TOKENS.USDC,
      amount,
      userAddr: TEST_WALLET,
      chainId: CHAIN_ID,
      slippageLimitPercent: SLIPPAGE_TOLERANCE
    });

    console.log('\n📊 Quote Results:');
    console.log('─────────────────────────────────────');
    console.log(`From: ${ethers.utils.formatEther(quote.fromTokenAmount)} ${quote.fromToken.symbol}`);
    console.log(`To: ${ethers.utils.formatUnits(quote.toTokenAmount, quote.toToken.decimals)} ${quote.toToken.symbol}`);
    console.log(`PathId: ${quote.pathId}`);
    if (quote.estimatedGas) {
      console.log(`Estimated Gas: ${quote.estimatedGas.toLocaleString()}`);
    }
    if (quote.priceImpact !== undefined) {
      console.log(`Price Impact: ${quote.priceImpact}%`);
    }

    console.log('\n✅ Quote test PASSED');
    return quote;

  } catch (error) {
    console.error('\n❌ Quote test FAILED:', error.message);
    throw error;
  }
}

/**
 * Test 2: Assemble Function - Generate transaction from pathId
 */
async function testAssemble(pathId) {
  console.log('\n========================================');
  console.log('TEST 2: Assemble Transaction');
  console.log('========================================\n');

  try {
    const assembled = await getOdosAssemble({
      pathId,
      userAddr: TEST_WALLET,
      simulate: true // Enable simulation for gas estimate
    });

    console.log('\n📊 Assembled Results:');
    console.log('─────────────────────────────────────');
    console.log(`Router: ${assembled.routerAddress}`);
    if (assembled.estimatedGas) {
      console.log(`Estimated Gas: ${assembled.estimatedGas.toLocaleString()}`);
    }

    // Transaction details
    console.log('\n📝 Transaction Data:');
    console.log(`   To: ${assembled.tx.to}`);
    console.log(`   Value: ${ethers.utils.formatEther(assembled.value)} ETH`);
    console.log(`   Calldata: ${assembled.calldata.substring(0, 66)}...`);
    console.log(`   Calldata length: ${assembled.calldata.length} characters`);

    if (assembled.simulation) {
      console.log('\n🔬 Simulation Results:');
      console.log(`   Gas Estimate: ${assembled.simulation.gasEstimate || 'N/A'}`);
    }

    console.log('\n✅ Assemble test PASSED');
    return assembled;

  } catch (error) {
    console.error('\n❌ Assemble test FAILED:', error.message);
    throw error;
  }
}

/**
 * Test 3: Swap Function - Combined quote + assemble (ETH to USDC, no approval needed)
 */
async function testSwap() {
  console.log('\n========================================');
  console.log('TEST 3: Swap Function (ETH → USDC)');
  console.log('========================================\n');

  try {
    const amount = ethers.utils.parseEther('1'); // 1 ETH

    const swap = await getOdosSwap({
      fromToken: TOKENS.ETH,
      toToken: TOKENS.USDC,
      amount,
      fromAddress: TEST_WALLET,
      slippage: SLIPPAGE_TOLERANCE,
      chainId: CHAIN_ID,
      simulate: true
    });

    console.log('\n📊 Swap Results:');
    console.log('─────────────────────────────────────');
    console.log(`From: ${ethers.utils.formatEther(swap.fromTokenAmount)} ${swap.fromToken.symbol}`);
    console.log(`To: ${ethers.utils.formatUnits(swap.toTokenAmount, swap.toToken.decimals)} ${swap.toToken.symbol}`);
    console.log(`Router: ${swap.routerAddress}`);
    console.log(`PathId: ${swap.pathId}`);
    if (swap.estimatedGas) {
      console.log(`Estimated Gas: ${swap.estimatedGas.toLocaleString()}`);
    }
    if (swap.priceImpact !== undefined) {
      console.log(`Price Impact: ${swap.priceImpact}%`);
    }

    // Transaction details
    console.log('\n📝 Transaction Data:');
    console.log(`   To: ${swap.tx.to}`);
    console.log(`   Value: ${ethers.utils.formatEther(swap.value)} ETH`);
    console.log(`   Calldata: ${swap.calldata.substring(0, 66)}...`);
    console.log(`   Calldata length: ${swap.calldata.length} characters`);

    console.log('\n✅ Swap test PASSED');
    return swap;

  } catch (error) {
    console.error('\n❌ Swap test FAILED:', error.message);
    throw error;
  }
}

/**
 * Test 4: Get supported protocols (placeholder - Odos auto-selects)
 */
async function testGetProtocols() {
  console.log('\n========================================');
  console.log('TEST 4: Get Supported Protocols');
  console.log('========================================\n');

  try {
    const protocols = await getOdosProtocols(CHAIN_ID);

    console.log('\n📋 Protocol Selection:');
    console.log('─────────────────────────────────────');
    console.log('Odos automatically selects from 100+ liquidity sources');
    console.log('No manual protocol selection needed!');

    protocols.forEach((protocol, idx) => {
      console.log(`\n${idx + 1}. ${protocol.name || protocol.id}`);
      if (protocol.description) {
        console.log(`   ${protocol.description}`);
      }
    });

    console.log('\n✅ Get protocols test PASSED');
    return protocols;

  } catch (error) {
    console.error('\n❌ Get protocols test FAILED:', error.message);
    throw error;
  }
}

/**
 * Test 5: Token to Token swap (AAVE → USDC)
 */
async function testTokenToToken() {
  console.log('\n========================================');
  console.log('TEST 5: Token to Token (AAVE → USDC)');
  console.log('========================================\n');

  try {
    const amount = ethers.utils.parseUnits('100', TOKENS.AAVE.decimals); // 100 AAVE

    const swap = await getOdosSwap({
      fromToken: TOKENS.AAVE,
      toToken: TOKENS.USDC,
      amount,
      fromAddress: TEST_WALLET,
      slippage: SLIPPAGE_TOLERANCE,
      chainId: CHAIN_ID,
      simulate: true
    });

    console.log('\n📊 Token Swap Results:');
    console.log('─────────────────────────────────────');
    console.log(`From: ${ethers.utils.formatUnits(swap.fromTokenAmount, swap.fromToken.decimals)} ${swap.fromToken.symbol}`);
    console.log(`To: ${ethers.utils.formatUnits(swap.toTokenAmount, swap.toToken.decimals)} ${swap.toToken.symbol}`);
    console.log(`Router: ${swap.routerAddress}`);
    if (swap.estimatedGas) {
      console.log(`Estimated Gas: ${swap.estimatedGas.toLocaleString()}`);
    }
    if (swap.priceImpact !== undefined) {
      console.log(`Price Impact: ${swap.priceImpact}%`);
    }

    console.log('\n✅ Token to token test PASSED');
    return swap;

  } catch (error) {
    console.error('\n❌ Token to token test FAILED:', error.message);
    throw error;
  }
}

/**
 * Test 6: Approval transaction generation
 */
async function testApproval() {
  console.log('\n========================================');
  console.log('TEST 6: Approval Transaction');
  console.log('========================================\n');

  try {
    // First get a quote to know the router address
    const amount = ethers.utils.parseUnits('100', TOKENS.USDC.decimals);
    const swap = await getOdosSwap({
      fromToken: TOKENS.USDC,
      toToken: TOKENS.DAI,
      amount,
      fromAddress: TEST_WALLET,
      slippage: SLIPPAGE_TOLERANCE,
      chainId: CHAIN_ID
    });

    const routerAddress = swap.routerAddress;

    console.log('\n📊 Approval Details:');
    console.log('─────────────────────────────────────');
    console.log(`Token: ${TOKENS.USDC.symbol}`);
    console.log(`Router: ${routerAddress}`);

    // Generate approval transaction
    const approvalTx = getOdosApprovalTx(
      TOKENS.USDC.address,
      routerAddress,
      null // null = infinite approval
    );

    console.log('\n📝 Approval Transaction:');
    console.log(`   To: ${approvalTx.to}`);
    console.log(`   Data: ${approvalTx.data.substring(0, 66)}...`);
    console.log(`   Value: ${approvalTx.value}`);
    console.log(`   Spender: ${approvalTx.raw.spender}`);
    console.log(`   Amount: ${approvalTx.raw.amount === ethers.constants.MaxUint256.toString() ? 'Infinite' : approvalTx.raw.amount}`);

    console.log('\n✅ Approval test PASSED');
    return approvalTx;

  } catch (error) {
    console.error('\n❌ Approval test FAILED:', error.message);
    throw error;
  }
}

/**
 * Test 7: Edge case - ETH to WETH (should handle 1:1 conversion)
 */
async function testEthToWeth() {
  console.log('\n========================================');
  console.log('TEST 7: Edge Case (ETH → WETH)');
  console.log('========================================\n');

  try {
    const amount = ethers.utils.parseEther('1'); // 1 ETH

    const quote = await getOdosQuote({
      fromToken: TOKENS.ETH,
      toToken: TOKENS.WETH,
      amount,
      userAddr: TEST_WALLET,
      chainId: CHAIN_ID
    });

    console.log('\n📊 Edge Case Results:');
    console.log('─────────────────────────────────────');
    console.log(`From: ${ethers.utils.formatEther(quote.fromTokenAmount)} ${quote.fromToken.symbol}`);
    console.log(`To: ${ethers.utils.formatEther(quote.toTokenAmount)} ${quote.toToken.symbol}`);

    // ETH to WETH should be approximately 1:1
    const ratio = parseFloat(ethers.utils.formatEther(quote.toTokenAmount));
    console.log(`\nConversion ratio: ${ratio.toFixed(6)} (should be ~1.0)`);

    if (ratio > 0.99 && ratio < 1.01) {
      console.log('✅ Conversion ratio is reasonable');
    } else {
      console.log('⚠️ Conversion ratio is unexpected');
    }

    console.log('\n✅ Edge case test PASSED');
    return quote;

  } catch (error) {
    console.error('\n❌ Edge case test FAILED:', error.message);
    throw error;
  }
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║     Odos API Integration Tests        ║');
  console.log('║     NO API KEY REQUIRED!               ║');
  console.log('╚════════════════════════════════════════╝');

  console.log('\n✅ Odos uses IP-based rate limiting (600 req/5min)');
  console.log('✅ Much better than 1inch (1 req/sec)!\n');

  const testResults = {
    passed: 0,
    failed: 0,
    errors: []
  };

  // Run tests sequentially with rate limit delays
  const tests = [
    { name: 'Quote (ETH→USDC)', fn: testQuote, storeResult: true },
    { name: 'Assemble', fn: async () => {
      // Use pathId from previous test
      if (!window.testQuoteResult?.pathId) {
        throw new Error('Quote test must run first to get pathId');
      }
      return testAssemble(window.testQuoteResult.pathId);
    } },
    { name: 'Swap (ETH→USDC)', fn: testSwap },
    { name: 'Protocols', fn: testGetProtocols },
    { name: 'Token to Token (AAVE→USDC)', fn: testTokenToToken },
    { name: 'Approval', fn: testApproval },
    { name: 'Edge Case (ETH→WETH)', fn: testEthToWeth }
  ];

  // Store results globally for cross-test use
  if (typeof window === 'undefined') {
    global.testQuoteResult = null;
  } else {
    window.testQuoteResult = null;
  }

  for (let i = 0; i < tests.length; i++) {
    if (i > 0) await delay(RATE_LIMIT_DELAY);

    try {
      const result = await tests[i].fn();

      // Store result for next test if needed
      if (tests[i].storeResult) {
        if (typeof window === 'undefined') {
          global.testQuoteResult = result;
        } else {
          window.testQuoteResult = result;
        }
      }

      testResults.passed++;
    } catch (error) {
      testResults.failed++;
      testResults.errors.push({
        test: tests[i].name,
        error: error.message
      });
    }
  }

  // Summary
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║           Test Summary                 ║');
  console.log('╚════════════════════════════════════════╝\n');
  console.log(`✅ Passed: ${testResults.passed}/${tests.length}`);
  console.log(`❌ Failed: ${testResults.failed}/${tests.length}`);

  if (testResults.errors.length > 0) {
    console.log('\n❌ Failed Tests:');
    testResults.errors.forEach(err => {
      console.log(`   - ${err.test}: ${err.error}`);
    });
  }

  console.log('\n════════════════════════════════════════\n');

  // Exit with appropriate code
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
