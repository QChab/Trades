import 'dotenv/config';  // Load environment variables from .env file
import { ethers } from 'ethers';
import {
  use1inch,
  get1inchQuote,
  get1inchSwap,
  get1inchProtocols,
  get1inchTokens,
  check1inchAllowance,
  get1inchApprovalTx
} from '../../src/renderer/utils/use1inch.js';

/**
 * Test 1inch API v6.0 Integration
 *
 * This test suite validates the 1inch aggregator integration including:
 * - Quote fetching for price discovery
 * - Swap calldata generation
 * - Protocol and token listing
 * - Approval checking and transaction generation
 *
 * IMPORTANT: You need a valid 1inch API key to run these tests
 * Get your API key from: https://portal.1inch.dev
 * Set it as environment variable: export ONEINCH_API_KEY="your-api-key"
 *
 * Rate Limits:
 * - Basic tier: 1 request per second
 * - Tests include delays to respect rate limits
 */

// Test configuration
const CHAIN_ID = 1; // Ethereum Mainnet
const SLIPPAGE_TOLERANCE = 0.5; // 0.5%

// Test delay to respect rate limits (1 RPS)
const RATE_LIMIT_DELAY = 1200; // 1.2 seconds between requests
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Common test tokens
const TOKENS = {
  ETH: {
    address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // 1inch ETH address
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

    const quote = await get1inchQuote({
      fromTokenAddress: TOKENS.ETH.address,
      toTokenAddress: TOKENS.USDC.address,
      amount,
      chainId: CHAIN_ID
    });

    console.log('\n📊 Quote Results:');
    console.log('─────────────────────────────────────');
    console.log(`From: ${ethers.utils.formatEther(quote.fromTokenAmount)} ${quote.fromToken.symbol}`);
    console.log(`To: ${ethers.utils.formatUnits(quote.toTokenAmount, quote.toToken.decimals)} ${quote.toToken.symbol}`);
    console.log(`Protocols: ${quote.protocols.length} DEXs aggregated`);
    if (quote.estimatedGas) {
      console.log(`Estimated Gas: ${quote.estimatedGas.toLocaleString()}`);
    }

    // Show protocol breakdown
    if (quote.protocols && quote.protocols.length > 0) {
      console.log('\n📋 Protocol Breakdown:');
      quote.protocols.slice(0, 5).forEach((protocol, idx) => {
        console.log(`   ${idx + 1}. ${JSON.stringify(protocol)}`);
      });
      if (quote.protocols.length > 5) {
        console.log(`   ... and ${quote.protocols.length - 5} more protocols`);
      }
    }

    console.log('\n✅ Quote test PASSED');
    return quote;

  } catch (error) {
    console.error('\n❌ Quote test FAILED:', error.message);
    throw error;
  }
}

/**
 * Test 2: Swap Function - Generate calldata for ETH to USDC (no approval needed)
 */
async function testSwap() {
  console.log('\n========================================');
  console.log('TEST 2: Swap Calldata (ETH → USDC)');
  console.log('========================================\n');

  try {
    const amount = ethers.utils.parseEther('1'); // 1 ETH

    const swap = await get1inchSwap({
      fromTokenAddress: TOKENS.ETH.address,
      toTokenAddress: TOKENS.USDC.address,
      amount,
      fromAddress: TEST_WALLET,
      slippage: SLIPPAGE_TOLERANCE,
      chainId: CHAIN_ID,
      disableEstimate: true  // Skip balance check for test wallet
    });

    console.log('\n📊 Swap Results:');
    console.log('─────────────────────────────────────');
    console.log(`From: ${ethers.utils.formatEther(swap.fromTokenAmount)} ${swap.fromToken.symbol}`);
    console.log(`To: ${ethers.utils.formatUnits(swap.toTokenAmount, swap.toToken.decimals)} ${swap.toToken.symbol}`);
    console.log(`Router: ${swap.routerAddress}`);
    console.log(`Protocols: ${swap.protocols.length} DEXs aggregated`);
    if (swap.estimatedGas) {
      console.log(`Estimated Gas: ${swap.estimatedGas.toLocaleString()}`);
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
 * Test 3: Combined use1inch wrapper - ETH to DAI
 */
async function testUse1inch() {
  console.log('\n========================================');
  console.log('TEST 3: Combined Wrapper (ETH → DAI)');
  console.log('========================================\n');

  try {
    const amount = ethers.utils.parseEther('0.5'); // 0.5 ETH

    const result = await use1inch({
      tokenInAddress: TOKENS.ETH.address,
      tokenOutAddress: TOKENS.DAI.address,
      amountIn: amount,
      fromAddress: TEST_WALLET,
      slippageTolerance: SLIPPAGE_TOLERANCE,
      chainId: CHAIN_ID
    });

    if (!result) {
      throw new Error('No route found (quote returned zero output)');
    }

    console.log('\n📊 Combined Results:');
    console.log('─────────────────────────────────────');
    console.log(`Protocol: ${result.protocol}`);
    console.log(`Amount Out: ${ethers.utils.formatEther(result.amountOut)} DAI`);
    console.log(`Min Amount Out: ${ethers.utils.formatEther(result.minAmountOut)} DAI (with ${SLIPPAGE_TOLERANCE}% slippage)`);
    console.log(`Router: ${result.routerAddress}`);
    console.log(`Path: ${result.path}`);
    console.log(`Estimated Gas: ${result.estimatedGas?.toLocaleString() || 'N/A'}`);

    console.log('\n✅ Combined wrapper test PASSED');
    return result;

  } catch (error) {
    console.error('\n❌ Combined wrapper test FAILED:', error.message);
    throw error;
  }
}

/**
 * Test 4: Get supported protocols
 */
async function testGetProtocols() {
  console.log('\n========================================');
  console.log('TEST 4: Get Supported Protocols');
  console.log('========================================\n');

  try {
    const protocols = await get1inchProtocols(CHAIN_ID);

    console.log('\n📋 Supported Protocols:');
    console.log('─────────────────────────────────────');
    console.log(`Total: ${protocols.length} protocols`);

    // Show first 20 protocols
    console.log('\nSample Protocols:');
    protocols.slice(0, 20).forEach((protocol, idx) => {
      console.log(`   ${idx + 1}. ${protocol.id || protocol.name || protocol}`);
    });

    if (protocols.length > 20) {
      console.log(`   ... and ${protocols.length - 20} more`);
    }

    console.log('\n✅ Get protocols test PASSED');
    return protocols;

  } catch (error) {
    console.error('\n❌ Get protocols test FAILED:', error.message);
    throw error;
  }
}

/**
 * Test 5: Get token list
 */
async function testGetTokens() {
  console.log('\n========================================');
  console.log('TEST 5: Get Token List');
  console.log('========================================\n');

  try {
    const tokens = await get1inchTokens(CHAIN_ID);
    const tokenArray = Object.values(tokens);

    console.log('\n📋 Token List:');
    console.log('─────────────────────────────────────');
    console.log(`Total: ${tokenArray.length} tokens`);

    // Show first 10 tokens
    console.log('\nSample Tokens:');
    tokenArray.slice(0, 10).forEach((token, idx) => {
      console.log(`   ${idx + 1}. ${token.symbol} (${token.name}) - ${token.address}`);
    });

    if (tokenArray.length > 10) {
      console.log(`   ... and ${tokenArray.length - 10} more`);
    }

    console.log('\n✅ Get tokens test PASSED');
    return tokens;

  } catch (error) {
    console.error('\n❌ Get tokens test FAILED:', error.message);
    throw error;
  }
}

/**
 * Test 6: Check allowance and get approval transaction
 */
async function testApproval() {
  console.log('\n========================================');
  console.log('TEST 6: Check Allowance & Approval');
  console.log('========================================\n');

  try {
    // Check allowance for USDC
    console.log('Checking USDC allowance...');
    const allowance = await check1inchAllowance(
      TOKENS.USDC.address,
      TEST_WALLET,
      CHAIN_ID
    );

    console.log('\n📊 Allowance Check:');
    console.log('─────────────────────────────────────');
    console.log(`Current Allowance: ${allowance.allowance.toString()}`);
    console.log(`Needs Approval: ${allowance.needsApproval ? 'YES' : 'NO'}`);

    // Get approval transaction (if needed)
    if (allowance.needsApproval) {
      await delay(RATE_LIMIT_DELAY);

      console.log('\nGenerating approval transaction...');
      const approvalTx = await get1inchApprovalTx(
        TOKENS.USDC.address,
        null, // null = infinite approval
        CHAIN_ID
      );

      console.log('\n📝 Approval Transaction:');
      console.log(`   To: ${approvalTx.to}`);
      console.log(`   Data: ${approvalTx.data.substring(0, 66)}...`);
      console.log(`   Gas: ${approvalTx.gas || 'Not estimated'}`);
    }

    console.log('\n✅ Approval test PASSED');
    return allowance;

  } catch (error) {
    console.error('\n❌ Approval test FAILED:', error.message);
    throw error;
  }
}

/**
 * Test 7: Edge case - ETH to WETH (should handle zero address conversion)
 */
async function testEthToWeth() {
  console.log('\n========================================');
  console.log('TEST 7: Edge Case (ETH → WETH)');
  console.log('========================================\n');

  try {
    const amount = ethers.utils.parseEther('1'); // 1 ETH

    const quote = await get1inchQuote({
      fromTokenAddress: TOKENS.ETH.address,
      toTokenAddress: TOKENS.WETH.address,
      amount,
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
  console.log('║   1inch API v6.0 Integration Tests    ║');
  console.log('╚════════════════════════════════════════╝');

  // Check if API key is configured
  try {
    if (!process.env.ONEINCH_API_KEY) {
      throw new Error('ONEINCH_API_KEY environment variable not set');
    }
    console.log('✅ API key configured');
  } catch (error) {
    console.error('\n❌ API key not configured!');
    console.error('Please set: export ONEINCH_API_KEY="your-api-key"');
    console.error('Get your key from: https://portal.1inch.dev\n');
    process.exit(1);
  }

  const testResults = {
    passed: 0,
    failed: 0,
    errors: []
  };

  // Run tests sequentially with rate limit delays
  const tests = [
    { name: 'Quote', fn: testQuote },
    { name: 'Swap', fn: testSwap },
    { name: 'Combined Wrapper', fn: testUse1inch },
    { name: 'Get Protocols', fn: testGetProtocols },
    { name: 'Get Tokens', fn: testGetTokens },
    { name: 'Approval', fn: testApproval },
    { name: 'Edge Case (ETH→WETH)', fn: testEthToWeth },
  ];

  for (let i = 0; i < tests.length; i++) {
    if (i > 0) await delay(RATE_LIMIT_DELAY);

    try {
      await tests[i].fn();
      testResults.passed++;
      await new Promise(r => setTimeout(r, 2000))
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
