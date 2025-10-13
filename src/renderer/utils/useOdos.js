import { ethers } from 'ethers';

/**
 * Odos Aggregation Protocol Integration
 *
 * This module provides integration with the Odos DEX aggregator API
 * to get optimal swap quotes and generate transaction calldata across multiple DEXs.
 *
 * Features:
 * - Quote function: Get expected output amount for a token swap
 * - Assemble function: Generate calldata for executing the swap
 * - Support for custom slippage tolerance
 * - Multi-asset swaps (1-6 input tokens, 1-6 output tokens)
 * - NO API KEY REQUIRED (IP-based rate limiting)
 *
 * API Documentation: https://docs.odos.xyz/build/api-docs
 *
 * IMPORTANT NOTES:
 * - NO API Key required (unlike 1inch)
 * - Rate limits: 600 requests per 5 minutes per IP address
 * - Much better than 1inch's 1 RPS limit
 * - Chain ID 1 = Ethereum Mainnet
 * - Do NOT modify the calldata returned by the API
 */

// Odos API Configuration
const ODOS_API_BASE_URL = 'https://api.odos.xyz';
const DEFAULT_CHAIN_ID = 1; // Ethereum Mainnet

// Rate limiting for Odos (600 requests per 5 minutes = ~2 RPS)
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 550; // 0.55 seconds between requests (conservative)

// Special token addresses
const ETH_ADDRESS = '0x0000000000000000000000000000000000000000'; // Odos uses zero address for ETH
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

// Common token metadata (fallback when needed)
const KNOWN_TOKENS = {
  '0x0000000000000000000000000000000000000000': { symbol: 'ETH', decimals: 18, name: 'Ethereum' },
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': { symbol: 'ETH', decimals: 18, name: 'Ethereum' },
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'WETH', decimals: 18, name: 'Wrapped Ether' },
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', decimals: 6, name: 'USD Coin' },
  '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', decimals: 6, name: 'Tether USD' },
  '0x6b175474e89094c44da98b954eedeac495271d0f': { symbol: 'DAI', decimals: 18, name: 'Dai Stablecoin' },
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { symbol: 'WBTC', decimals: 8, name: 'Wrapped BTC' },
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': { symbol: 'AAVE', decimals: 18, name: 'Aave Token' },
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': { symbol: 'UNI', decimals: 18, name: 'Uniswap' },
  '0x111111111117dc0aa78b770fa6a738034120c302': { symbol: '1INCH', decimals: 18, name: '1inch Token' },
  '0x514910771af9ca656af840dff83e8264ecf986ca': { symbol: 'LINK', decimals: 18, name: 'ChainLink Token' },
  '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0': { symbol: 'MATIC', decimals: 18, name: 'Matic Token' }
};

/**
 * Get token info from known tokens
 */
function getTokenInfo(address, tokenObj) {
  const normalizedAddress = address.toLowerCase();

  // If token object provided with info, use it
  if (tokenObj?.symbol && tokenObj?.decimals !== undefined) {
    return {
      symbol: tokenObj.symbol,
      decimals: tokenObj.decimals,
      name: tokenObj.name || tokenObj.symbol
    };
  }

  // Check known tokens
  if (KNOWN_TOKENS[normalizedAddress]) {
    return KNOWN_TOKENS[normalizedAddress];
  }

  // Fallback
  return {
    symbol: 'UNKNOWN',
    decimals: 18,
    name: 'Unknown Token'
  };
}

/**
 * Normalize token address for Odos API
 * Odos uses zero address for ETH
 */
function normalizeTokenAddress(address) {
  const normalized = address.toLowerCase();
  // Keep zero address as is (Odos uses it for ETH)
  if (normalized === ETH_ADDRESS.toLowerCase()) {
    return ETH_ADDRESS;
  }
  // Convert 1inch's ETH address to zero address
  if (normalized === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
    return ETH_ADDRESS;
  }
  return address;
}

/**
 * Make request to Odos API
 * Handles rate limiting and error responses
 * NO API KEY REQUIRED!
 */
async function fetchOdosAPI(endpoint, method = 'GET', body = null) {
  // Enforce rate limit (600 per 5 minutes = ~2 RPS)
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
    console.log(`⏳ Rate limit: waiting ${waitTime}ms before request...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  lastRequestTime = Date.now();

  const url = `${ODOS_API_BASE_URL}${endpoint}`;

  try {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    if (body && method === 'POST') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.description || errorJson.error || errorJson.message || errorText;

        // Log detailed error for debugging
        console.error(`Odos API Error Details:`, {
          status: response.status,
          endpoint: url,
          error: errorJson
        });
      } catch (e) {
        errorMessage = errorText;
      }

      throw new Error(`Odos API error (${response.status}): ${errorMessage}`);
    }

    const data = await response.json();
    return data;

  } catch (error) {
    if (error.message.includes('fetch is not defined')) {
      throw new Error('Fetch API not available. Please use Node.js 18+ or add node-fetch polyfill.');
    }
    throw error;
  }
}

/**
 * Get a quote for swapping tokens without executing the swap
 * This is useful for price discovery and comparison with other DEXs
 *
 * @param {Object} params - Quote parameters
 * @param {Object} params.fromToken - Source token object { address, symbol, decimals }
 * @param {Object} params.toToken - Destination token object { address, symbol, decimals }
 * @param {string|ethers.BigNumber} params.amount - Amount of source token (in wei)
 * @param {string} params.userAddr - User wallet address (required for pathId generation)
 * @param {number} params.chainId - Chain ID (default: 1 for Ethereum)
 * @param {number} params.slippageLimitPercent - Slippage tolerance (default 0.5 = 0.5%)
 * @param {boolean} params.disableRFQs - Disable RFQs for reliability (default true)
 * @param {boolean} params.compact - Use compact calldata (default true)
 * @param {number} params.referralCode - Optional referral code (default 0)
 *
 * @returns {Promise<Object>} Quote result with estimated output amount, route, and pathId
 */
export async function getOdosQuote({
  fromToken,
  toToken,
  amount,
  userAddr,
  chainId = DEFAULT_CHAIN_ID,
  slippageLimitPercent = 0.5,
  disableRFQs = true,
  compact = true,
  referralCode = 0
}) {
  try {
    console.log(`🔍 Requesting Odos quote: ${fromToken.symbol} -> ${toToken.symbol}`);

    // Validate userAddr
    if (!userAddr || !ethers.utils.isAddress(userAddr)) {
      throw new Error(`Invalid userAddr: ${userAddr}`);
    }

    // Normalize addresses
    const srcAddress = normalizeTokenAddress(fromToken.address);
    const dstAddress = normalizeTokenAddress(toToken.address);

    // Convert amount to raw token units (wei) if needed
    let amountStr;
    if (ethers.BigNumber.isBigNumber(amount)) {
      // Already a BigNumber in wei
      amountStr = amount.toString();
    } else if (typeof amount === 'string' && amount.includes('.')) {
      // Decimal string - convert to raw units
      amountStr = ethers.utils.parseUnits(amount, fromToken.decimals).toString();
    } else if (typeof amount === 'number' || (typeof amount === 'string' && parseFloat(amount) < 1)) {
      // Decimal number - convert to raw units
      amountStr = ethers.utils.parseUnits(amount.toString(), fromToken.decimals).toString();
    } else {
      // Already a string in raw units
      amountStr = amount.toString();
    }

    const endpoint = '/sor/quote/v2';

    const requestBody = {
      chainId,
      inputTokens: [
        {
          tokenAddress: srcAddress,
          amount: amountStr
        }
      ],
      outputTokens: [
        {
          tokenAddress: dstAddress,
          proportion: 1
        }
      ],
      slippageLimitPercent,
      userAddr,
      referralCode,
      disableRFQs,
      compact
    };

    const result = await fetchOdosAPI(endpoint, 'POST', requestBody);

    // Parse and normalize the response
    const quote = {
      fromToken: {
        address: fromToken.address,
        symbol: fromToken.symbol,
        decimals: fromToken.decimals,
        name: fromToken.name || fromToken.symbol
      },
      toToken: {
        address: toToken.address,
        symbol: toToken.symbol,
        decimals: toToken.decimals,
        name: toToken.name || toToken.symbol
      },
      fromTokenAmount: ethers.BigNumber.from(amountStr),
      toTokenAmount: ethers.BigNumber.from(result.outAmounts?.[0] || '0'),
      pathId: result.pathId, // Required for assembly
      estimatedGas: result.gasEstimate ? parseInt(result.gasEstimate) : null,
      priceImpact: result.priceImpact,
      raw: result // Keep raw response for debugging
    };

    const outputFormatted = ethers.utils.formatUnits(
      quote.toTokenAmount,
      toToken.decimals
    );

    console.log(`✅ Odos quote: ${outputFormatted} ${toToken.symbol}`);

    return quote;

  } catch (error) {
    console.error('❌ Error fetching Odos quote:', error.message);
    throw error;
  }
}

/**
 * Assemble swap transaction from Odos quote
 * This generates the data needed to execute the swap on-chain
 *
 * @param {Object} params - Assemble parameters
 * @param {string} params.pathId - Path ID from quote response
 * @param {string} params.userAddr - Wallet address executing the swap
 * @param {boolean} params.simulate - Enable gas simulation (default false)
 *
 * @returns {Promise<Object>} Assembled transaction data ready for execution
 */
export async function getOdosAssemble({
  pathId,
  userAddr,
  simulate = false
}) {
  try {
    console.log(`🔄 Assembling Odos transaction for pathId: ${pathId}`);

    // Validate userAddr
    if (!ethers.utils.isAddress(userAddr)) {
      throw new Error(`Invalid userAddr: ${userAddr}`);
    }

    const endpoint = '/sor/assemble';

    const requestBody = {
      userAddr,
      pathId,
      simulate
    };

    const result = await fetchOdosAPI(endpoint, 'POST', requestBody);

    // console.log('Raw Odos assemble response:', JSON.stringify(result, null, 2));

    // Validate critical fields
    if (!result.transaction) {
      console.error('Missing transaction in Odos response:', result);
      throw new Error('Odos API returned invalid response - no transaction field');
    }

    if (!result.transaction.to) {
      console.error('Missing "to" address in Odos transaction:', result.transaction);
      throw new Error('Odos API returned invalid transaction - no "to" address');
    }

    if (!result.transaction.data) {
      console.error('Missing calldata in Odos transaction:', result.transaction);
      throw new Error('Odos API returned invalid transaction - no calldata');
    }

    // Parse and normalize the response
    const assembled = {
      // Transaction data
      tx: result.transaction ? {
        from: result.transaction.from,
        to: result.transaction.to,
        data: result.transaction.data,
        value: result.transaction.value || '0',
        gasPrice: result.transaction.gasPrice,
        gas: result.transaction.gas,
        gasLimit: result.transaction.gasLimit,
        nonce: result.transaction.nonce,
        chainId: result.transaction.chainId
      } : null,

      // Router address
      routerAddress: result.transaction?.to,

      // Calldata for execution
      calldata: result.transaction?.data,

      // Value to send (for ETH swaps)
      value: ethers.BigNumber.from(result.transaction?.value || '0'),

      // Gas estimation
      estimatedGas: result.simulation?.gasEstimate
        ? parseInt(result.simulation.gasEstimate)
        : (result.transaction?.gas ? parseInt(result.transaction.gas) : null),

      // Simulation results (if enabled)
      simulation: result.simulation,

      // Additional metadata
      raw: result // Keep raw response for debugging
    };

    console.log(`✅ Odos transaction assembled`);
    console.log(`   Router: ${assembled.routerAddress}`);
    if (assembled.estimatedGas) {
      console.log(`   Estimated gas: ${assembled.estimatedGas.toLocaleString()}`);
    }

    return assembled;

  } catch (error) {
    console.error('❌ Error assembling Odos transaction:', error.message);
    throw error;
  }
}

/**
 * Get swap transaction calldata from Odos (combines quote + assemble)
 * This is a convenience function that matches the 1inch API pattern
 *
 * @param {Object} params - Swap parameters
 * @param {Object} params.fromToken - Source token object { address, symbol, decimals }
 * @param {Object} params.toToken - Destination token object { address, symbol, decimals }
 * @param {string|ethers.BigNumber} params.amount - Amount of source token (in wei)
 * @param {string} params.fromAddress - Wallet address executing the swap
 * @param {number} params.slippage - Slippage tolerance in percentage (default 0.5 = 0.5%)
 * @param {number} params.chainId - Chain ID (default: 1 for Ethereum)
 * @param {boolean} params.simulate - Enable gas simulation (default false)
 * @param {boolean} params.disableRFQs - Disable RFQs for reliability (default true)
 * @param {boolean} params.compact - Use compact calldata (default true)
 * @param {number} params.referralCode - Optional referral code (default 0)
 *
 * @returns {Promise<Object>} Swap transaction data with calldata and routing info
 */
export async function getOdosSwap({
  fromToken,
  toToken,
  amount,
  fromAddress,
  slippage = 0.5,
  chainId = DEFAULT_CHAIN_ID,
  simulate = false,
  disableRFQs = true,
  compact = true,
  referralCode = 0
}) {
  try {
    console.log(`🔄 Requesting Odos swap: ${fromToken.symbol} -> ${toToken.symbol}`);

    // Step 1: Get quote
    const quote = await getOdosQuote({
      fromToken,
      toToken,
      amount,
      userAddr: fromAddress,
      chainId,
      slippageLimitPercent: slippage,
      disableRFQs,
      compact,
      referralCode
    });

    // Step 2: Assemble transaction
    const assembled = await getOdosAssemble({
      pathId: quote.pathId,
      userAddr: fromAddress,
      simulate
    });

    // Combine results into format matching 1inch API
    const swap = {
      fromToken: quote.fromToken,
      toToken: quote.toToken,
      fromTokenAmount: quote.fromTokenAmount,
      toTokenAmount: quote.toTokenAmount,

      // Transaction data
      tx: assembled.tx,

      // Router address
      routerAddress: assembled.routerAddress,

      // Calldata for execution
      calldata: assembled.calldata,

      // Value to send (for ETH swaps)
      value: assembled.value,

      // Gas estimation
      estimatedGas: assembled.estimatedGas || quote.estimatedGas,

      // Additional metadata
      pathId: quote.pathId,
      priceImpact: quote.priceImpact,
      simulation: assembled.simulation,
      raw: {
        quote: quote.raw,
        assembled: assembled.raw
      }
    };

    const outputFormatted = ethers.utils.formatUnits(
      swap.toTokenAmount,
      swap.toToken.decimals
    );

    console.log(`✅ Odos swap ready for execution`);
    console.log(`   Expected output: ${outputFormatted} ${swap.toToken.symbol}`);
    console.log(`   Router: ${swap.routerAddress}`);
    if (swap.estimatedGas) {
      console.log(`   Estimated gas: ${swap.estimatedGas.toLocaleString()}`);
    }

    return swap;

  } catch (error) {
    console.error('❌ Error fetching Odos swap:', error.message);
    throw error;
  }
}

/**
 * Get supported liquidity sources on Odos
 * Note: Odos doesn't have a direct endpoint for this, but we can infer from quotes
 *
 * @param {number} chainId - Chain ID (default: 1 for Ethereum)
 * @returns {Promise<Array>} List of supported protocols (placeholder)
 */
export async function getOdosProtocols(chainId = DEFAULT_CHAIN_ID) {
  console.log(`ℹ️ Odos protocol list not available via API`);
  console.log(`   Odos aggregates across 100+ liquidity sources automatically`);

  // Return placeholder - Odos handles protocol selection automatically
  return [
    { id: 'auto', name: 'Automatic Protocol Selection', description: 'Odos optimizes across 100+ liquidity sources' }
  ];
}

/**
 * Check if token allowance is sufficient for Odos swap
 * Note: Odos router address may vary, recommend using infinite approval or checking via quote
 *
 * @param {string} tokenAddress - Token contract address
 * @param {string} walletAddress - Wallet address
 * @param {string} routerAddress - Odos router address (from quote/assemble response)
 * @param {Object} provider - Ethers provider
 * @returns {Promise<Object>} Allowance info
 */
export async function checkOdosAllowance(tokenAddress, walletAddress, routerAddress, provider) {
  try {
    // Normalize addresses
    const token = normalizeTokenAddress(tokenAddress);

    // ETH doesn't need approval
    if (token === ETH_ADDRESS) {
      return {
        allowance: ethers.constants.MaxUint256,
        needsApproval: false
      };
    }

    if (!routerAddress) {
      throw new Error('Router address required for allowance check. Get it from quote/assemble response.');
    }

    // Create ERC20 contract instance
    const erc20ABI = [
      'function allowance(address owner, address spender) view returns (uint256)'
    ];
    const tokenContract = new ethers.Contract(token, erc20ABI, provider);

    const allowance = await tokenContract.allowance(walletAddress, routerAddress);

    return {
      allowance,
      needsApproval: allowance.eq(0),
      raw: { allowance: allowance.toString() }
    };

  } catch (error) {
    console.error('❌ Error checking Odos allowance:', error.message);
    throw error;
  }
}

/**
 * Generate approval transaction for Odos
 *
 * @param {string} tokenAddress - Token contract address
 * @param {string} routerAddress - Odos router address (from quote/assemble response)
 * @param {string|ethers.BigNumber} amount - Optional: Amount to approve (default: infinite)
 * @returns {Object} Approval transaction data
 */
export function getOdosApprovalTx(tokenAddress, routerAddress, amount = null) {
  try {
    const token = normalizeTokenAddress(tokenAddress);

    if (!routerAddress) {
      throw new Error('Router address required for approval. Get it from quote/assemble response.');
    }

    // Use infinite approval if amount not specified
    const approvalAmount = amount
      ? (ethers.BigNumber.isBigNumber(amount) ? amount : ethers.BigNumber.from(amount))
      : ethers.constants.MaxUint256;

    // Generate approval calldata
    const erc20Interface = new ethers.utils.Interface([
      'function approve(address spender, uint256 amount) returns (bool)'
    ]);

    const data = erc20Interface.encodeFunctionData('approve', [
      routerAddress,
      approvalAmount
    ]);

    return {
      to: token,
      data,
      value: '0',
      raw: {
        spender: routerAddress,
        amount: approvalAmount.toString()
      }
    };

  } catch (error) {
    console.error('❌ Error generating Odos approval tx:', error.message);
    throw error;
  }
}

// Export all functions
export default {
  getOdosQuote,
  getOdosAssemble,
  getOdosSwap,
  getOdosProtocols,
  checkOdosAllowance,
  getOdosApprovalTx
};
