import { ethers } from 'ethers';

/**
 * 1inch Aggregation Protocol v6.0 Integration
 *
 * This module provides integration with the 1inch DEX aggregator API v6.0
 * to get optimal swap quotes and generate transaction calldata across multiple DEXs.
 *
 * Features:
 * - Quote function: Get expected output amount for a token swap
 * - Swap function: Generate calldata for executing the swap
 * - Support for custom slippage tolerance
 * - Protocol filtering capabilities
 * - Gas price optimization
 *
 * API Documentation: https://portal.1inch.dev/documentation/apis/swap
 *
 * IMPORTANT NOTES:
 * - API Key required: Get from https://portal.1inch.dev
 * - Rate limits: 1 RPS on basic tier (as of 2023)
 * - Set API key in environment variable: ONEINCH_API_KEY
 * - Chain ID 1 = Ethereum Mainnet
 */

// 1inch API v6.0 Configuration
const ONEINCH_API_BASE_URL = 'https://api.1inch.dev/swap/v6.0';
const DEFAULT_CHAIN_ID = 1; // Ethereum Mainnet

// Special token addresses
const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'; // 1inch uses this for ETH
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

// Common token metadata (fallback when API doesn't return info)
const KNOWN_TOKENS = {
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
 * Get token info from known tokens or API response
 */
function getTokenInfo(address, apiTokenInfo) {
  const normalizedAddress = address.toLowerCase();

  // If API provided info, use it
  if (apiTokenInfo?.symbol && apiTokenInfo?.decimals !== undefined) {
    return {
      symbol: apiTokenInfo.symbol,
      decimals: apiTokenInfo.decimals,
      name: apiTokenInfo.name || apiTokenInfo.symbol
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
 * Get 1inch API key from environment or window object
 * In Electron, this should be provided via IPC from main process for security
 */
function getApiKey() {
  // Try Node.js environment variable first
  if (typeof process !== 'undefined' && process.env && process.env.ONEINCH_API_KEY) {
    return process.env.ONEINCH_API_KEY;
  }

  // Try window object in browser/Electron renderer
  if (typeof window !== 'undefined' && window.ONEINCH_API_KEY) {
    return window.ONEINCH_API_KEY;
  }

  // Try electron API for secure key retrieval
  if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.get1inchApiKey) {
    return window.electronAPI.get1inchApiKey();
  }

  throw new Error('1inch API key not configured. Set ONEINCH_API_KEY environment variable.');
}

/**
 * Normalize token address for 1inch API
 * 1inch uses a special address for ETH instead of zero address
 */
function normalizeTokenAddress(address) {
  const normalized = address.toLowerCase();
  // Convert zero address or WETH to 1inch's ETH representation when needed
  if (normalized === ZERO_ADDRESS.toLowerCase()) {
    return ETH_ADDRESS;
  }
  return address;
}

/**
 * Make authenticated request to 1inch API
 * Handles rate limiting and error responses
 */
async function fetch1inchAPI(endpoint, params = {}) {
  const apiKey = getApiKey();

  // Build query string
  const queryParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      queryParams.append(key, value.toString());
    }
  });

  const url = `${endpoint}?${queryParams.toString()}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.description || errorJson.error || errorText;
      } catch (e) {
        errorMessage = errorText;
      }

      throw new Error(`1inch API error (${response.status}): ${errorMessage}`);
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
 * @param {number} params.chainId - Chain ID (default: 1 for Ethereum)
 * @param {string[]} params.protocols - Optional: Limit to specific protocols
 * @param {number} params.gasPrice - Optional: Gas price in wei for calculations
 * @param {number} params.complexityLevel - Optional: Limit routing complexity (0-3, default 2)
 * @param {number} params.parts - Optional: Split parts for better rates (default 10, max 100)
 * @param {number} params.mainRouteParts - Optional: Main route parts (default 10, max 50)
 * @param {number} params.gasLimit - Optional: Gas limit for swap
 *
 * @returns {Promise<Object>} Quote result with estimated output amount and route
 */
export async function get1inchQuote({
  fromToken,
  toToken,
  amount,
  chainId = DEFAULT_CHAIN_ID,
  protocols = null,
  gasPrice = null,
  complexityLevel = 2,
  parts = 10,
  mainRouteParts = 10,
  gasLimit = null
}) {
  try {
    console.log(`🔍 Requesting 1inch quote: ${fromToken.symbol} -> ${toToken.symbol}`);

    // Normalize addresses
    const src = normalizeTokenAddress(fromToken.address);
    const dst = normalizeTokenAddress(toToken.address);

    // Convert amount to string if it's a BigNumber
    const amountStr = ethers.BigNumber.isBigNumber(amount) ? amount.toString() : amount;

    const endpoint = `${ONEINCH_API_BASE_URL}/${chainId}/quote`;

    const params = {
      src,
      dst,
      amount: amountStr,
      includeTokensInfo: true,
      includeProtocols: true,
      includeGas: true
    };

    // Add optional parameters
    if (protocols && protocols.length > 0) {
      params.protocols = protocols.join(',');
    }
    if (gasPrice) {
      params.gasPrice = gasPrice.toString();
    }
    if (complexityLevel !== undefined) {
      params.complexityLevel = complexityLevel;
    }
    if (parts !== undefined) {
      params.parts = parts;
    }
    if (mainRouteParts !== undefined) {
      params.mainRouteParts = mainRouteParts;
    }
    if (gasLimit) {
      params.gasLimit = gasLimit;
    }

    const result = await fetch1inchAPI(endpoint, params);

    // Parse and normalize the response - use provided token objects
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
      fromTokenAmount: ethers.BigNumber.from(result.fromTokenAmount || amountStr),
      toTokenAmount: ethers.BigNumber.from(result.toTokenAmount || result.dstAmount || '0'),
      protocols: result.protocols || [],
      estimatedGas: result.gas ? parseInt(result.gas) : null,
      // Additional metadata
      raw: result // Keep raw response for debugging
    };

    const outputFormatted = ethers.utils.formatUnits(
      quote.toTokenAmount,
      toToken.decimals
    );

    console.log(`✅ 1inch quote: ${outputFormatted} ${toToken.symbol}`);
    console.log(`   Protocols: ${quote.protocols.length} used`);
    if (quote.estimatedGas) {
      console.log(`   Estimated gas: ${quote.estimatedGas.toLocaleString()}`);
    }

    return quote;

  } catch (error) {
    console.error('❌ Error fetching 1inch quote:', error.message);
    throw error;
  }
}

/**
 * Get swap transaction calldata from 1inch
 * This generates the data needed to execute the swap on-chain
 *
 * @param {Object} params - Swap parameters
 * @param {Object} params.fromToken - Source token object { address, symbol, decimals }
 * @param {Object} params.toToken - Destination token object { address, symbol, decimals }
 * @param {string|ethers.BigNumber} params.amount - Amount of source token (in wei)
 * @param {string} params.fromAddress - Wallet address executing the swap
 * @param {number} params.slippage - Slippage tolerance in percentage (default 1 = 1%)
 * @param {number} params.chainId - Chain ID (default: 1 for Ethereum)
 * @param {string} params.referrer - Optional: Referrer address for fee sharing
 * @param {number} params.fee - Optional: Referrer fee percentage (0-3%)
 * @param {string[]} params.protocols - Optional: Limit to specific protocols
 * @param {number} params.gasPrice - Optional: Gas price in wei
 * @param {number} params.complexityLevel - Optional: Limit routing complexity (0-3, default 2)
 * @param {number} params.parts - Optional: Split parts (default 10, max 100)
 * @param {number} params.mainRouteParts - Optional: Main route parts (default 10, max 50)
 * @param {boolean} params.disableEstimate - Optional: Disable gas estimation (default false)
 * @param {boolean} params.allowPartialFill - Optional: Allow partial fills (default false)
 * @param {string} params.receiver - Optional: Receiver address (default: fromAddress)
 *
 * @returns {Promise<Object>} Swap transaction data with calldata and routing info
 */
export async function get1inchSwap({
  fromToken,
  toToken,
  amount,
  fromAddress,
  slippage = 1,
  chainId = DEFAULT_CHAIN_ID,
  referrer = null,
  fee = null,
  protocols = null,
  gasPrice = null,
  complexityLevel = 2,
  parts = 10,
  mainRouteParts = 10,
  disableEstimate = false,
  allowPartialFill = false,
  receiver = null
}) {
  try {
    console.log(`🔄 Requesting 1inch swap calldata: ${fromToken.symbol} -> ${toToken.symbol}`);

    // Normalize addresses
    const src = normalizeTokenAddress(fromToken.address);
    const dst = normalizeTokenAddress(toToken.address);

    // Convert amount to string if it's a BigNumber
    const amountStr = ethers.BigNumber.isBigNumber(amount) ? amount.toString() : amount;

    // Validate fromAddress
    if (!ethers.utils.isAddress(fromAddress)) {
      throw new Error(`Invalid fromAddress: ${fromAddress}`);
    }

    const endpoint = `${ONEINCH_API_BASE_URL}/${chainId}/swap`;

    const params = {
      src,
      dst,
      amount: amountStr,
      from: fromAddress,
      slippage: slippage.toString(),
      includeTokensInfo: true,
      includeProtocols: true,
      includeGas: true
    };

    // Add optional parameters
    if (receiver) {
      if (!ethers.utils.isAddress(receiver)) {
        throw new Error(`Invalid receiver address: ${receiver}`);
      }
      params.receiver = receiver;
    }

    if (referrer) {
      if (!ethers.utils.isAddress(referrer)) {
        throw new Error(`Invalid referrer address: ${referrer}`);
      }
      params.referrer = referrer;
    }

    if (fee !== null) {
      if (fee < 0 || fee > 3) {
        throw new Error('Fee must be between 0 and 3%');
      }
      params.fee = fee.toString();
    }

    if (protocols && protocols.length > 0) {
      params.protocols = protocols.join(',');
    }

    if (gasPrice) {
      params.gasPrice = gasPrice.toString();
    }

    if (complexityLevel !== undefined) {
      params.complexityLevel = complexityLevel;
    }

    if (parts !== undefined) {
      params.parts = parts;
    }

    if (mainRouteParts !== undefined) {
      params.mainRouteParts = mainRouteParts;
    }

    if (disableEstimate) {
      params.disableEstimate = 'true';
    }

    if (allowPartialFill) {
      params.allowPartialFill = 'true';
    }

    const result = await fetch1inchAPI(endpoint, params);

    // Parse and normalize the response
    const swap = {
      fromToken: {
        address: result.fromToken?.address || fromTokenAddress,
        symbol: result.fromToken?.symbol || 'UNKNOWN',
        decimals: result.fromToken?.decimals || 18,
        name: result.fromToken?.name || 'Unknown Token'
      },
      toToken: {
        address: result.toToken?.address || toTokenAddress,
        symbol: result.toToken?.symbol || 'UNKNOWN',
        decimals: result.toToken?.decimals || 18,
        name: result.toToken?.name || 'Unknown Token'
      },
      fromTokenAmount: ethers.BigNumber.from(result.fromTokenAmount || amountStr),
      toTokenAmount: ethers.BigNumber.from(result.toTokenAmount || result.dstAmount || '0'),
      protocols: result.protocols || [],

      // Transaction data
      tx: result.tx ? {
        from: result.tx.from,
        to: result.tx.to,
        data: result.tx.data,
        value: result.tx.value || '0',
        gasPrice: result.tx.gasPrice,
        gas: result.tx.gas
      } : null,

      // Router address (usually the 1inch aggregation router)
      routerAddress: result.tx?.to,

      // Calldata for execution
      calldata: result.tx?.data,

      // Value to send (for ETH swaps)
      value: ethers.BigNumber.from(result.tx?.value || '0'),

      // Gas estimation
      estimatedGas: result.tx?.gas ? parseInt(result.tx.gas) : null,

      // Additional metadata
      raw: result // Keep raw response for debugging
    };

    const outputFormatted = ethers.utils.formatUnits(
      swap.toTokenAmount,
      swap.toToken.decimals
    );

    console.log(`✅ 1inch swap calldata generated`);
    console.log(`   Expected output: ${outputFormatted} ${swap.toToken.symbol}`);
    console.log(`   Router: ${swap.routerAddress}`);
    console.log(`   Protocols: ${swap.protocols.length} used`);
    if (swap.estimatedGas) {
      console.log(`   Estimated gas: ${swap.estimatedGas.toLocaleString()}`);
    }

    return swap;

  } catch (error) {
    console.error('❌ Error fetching 1inch swap:', error.message);
    throw error;
  }
}

/**
 * Get list of all protocols supported by 1inch on a specific chain
 * Useful for filtering and protocol selection
 *
 * @param {number} chainId - Chain ID (default: 1 for Ethereum)
 * @returns {Promise<Array>} List of supported protocols
 */
export async function get1inchProtocols(chainId = DEFAULT_CHAIN_ID) {
  try {
    const endpoint = `${ONEINCH_API_BASE_URL}/${chainId}/liquidity-sources`;
    const result = await fetch1inchAPI(endpoint);

    console.log(`✅ 1inch supports ${result.protocols?.length || 0} protocols on chain ${chainId}`);

    return result.protocols || [];

  } catch (error) {
    console.error('❌ Error fetching 1inch protocols:', error.message);
    throw error;
  }
}

/**
 * Get token information from 1inch
 *
 * @param {number} chainId - Chain ID (default: 1 for Ethereum)
 * @returns {Promise<Object>} Token information
 */
export async function get1inchTokens(chainId = DEFAULT_CHAIN_ID) {
  try {
    const endpoint = `${ONEINCH_API_BASE_URL}/${chainId}/tokens`;
    const result = await fetch1inchAPI(endpoint);

    const tokenCount = Object.keys(result.tokens || {}).length;
    console.log(`✅ 1inch supports ${tokenCount} tokens on chain ${chainId}`);

    return result.tokens || {};

  } catch (error) {
    console.error('❌ Error fetching 1inch tokens:', error.message);
    throw error;
  }
}

/**
 * Check if token allowance is sufficient for 1inch swap
 * If not, get approval transaction data
 *
 * @param {string} tokenAddress - Token contract address
 * @param {string} walletAddress - Wallet address
 * @param {number} chainId - Chain ID (default: 1 for Ethereum)
 * @returns {Promise<Object>} Allowance info and approval transaction if needed
 */
export async function check1inchAllowance(tokenAddress, walletAddress, chainId = DEFAULT_CHAIN_ID) {
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

    const endpoint = `${ONEINCH_API_BASE_URL}/${chainId}/approve/allowance`;
    const params = {
      tokenAddress: token,
      walletAddress: walletAddress
    };

    const result = await fetch1inchAPI(endpoint, params);

    return {
      allowance: ethers.BigNumber.from(result.allowance || '0'),
      needsApproval: result.allowance === '0',
      raw: result
    };

  } catch (error) {
    console.error('❌ Error checking 1inch allowance:', error.message);
    throw error;
  }
}

/**
 * Get approval transaction data for 1inch
 *
 * @param {string} tokenAddress - Token contract address
 * @param {string|ethers.BigNumber} amount - Optional: Amount to approve (default: infinite)
 * @param {number} chainId - Chain ID (default: 1 for Ethereum)
 * @returns {Promise<Object>} Approval transaction data
 */
export async function get1inchApprovalTx(tokenAddress, amount = null, chainId = DEFAULT_CHAIN_ID) {
  try {
    const token = normalizeTokenAddress(tokenAddress);

    const endpoint = `${ONEINCH_API_BASE_URL}/${chainId}/approve/transaction`;
    const params = {
      tokenAddress: token
    };

    if (amount) {
      const amountStr = ethers.BigNumber.isBigNumber(amount) ? amount.toString() : amount;
      params.amount = amountStr;
    }

    const result = await fetch1inchAPI(endpoint, params);

    return {
      to: result.to,
      data: result.data,
      value: result.value || '0',
      gasPrice: result.gasPrice,
      gas: result.gas,
      raw: result
    };

  } catch (error) {
    console.error('❌ Error fetching 1inch approval tx:', error.message);
    throw error;
  }
}

/**
 * Convenience wrapper that combines quote and swap for easy integration
 * This matches the pattern used by useUniswap and useBalancerV3
 *
 * @param {Object} params - Parameters
 * @param {string} params.tokenInAddress - Source token address
 * @param {string} params.tokenOutAddress - Destination token address
 * @param {ethers.BigNumber} params.amountIn - Input amount
 * @param {string} params.fromAddress - Wallet address
 * @param {number} params.slippageTolerance - Slippage in percentage (default 0.5%)
 * @param {number} params.chainId - Chain ID (default 1)
 * @returns {Promise<Object>} Combined quote and swap data
 */
export async function use1inch({
  tokenInAddress,
  tokenOutAddress,
  amountIn,
  fromAddress,
  slippageTolerance = 0.5,
  chainId = DEFAULT_CHAIN_ID
}) {
  try {
    console.log(`🔍 1inch routing: ${tokenInAddress} -> ${tokenOutAddress}`);

    // Get quote first (faster, no gas estimation)
    const quote = await get1inchQuote({
      fromTokenAddress: tokenInAddress,
      toTokenAddress: tokenOutAddress,
      amount: amountIn,
      chainId
    });

    // If quote is successful and output is reasonable, get swap data
    if (quote.toTokenAmount.gt(0)) {
      const swap = await get1inchSwap({
        fromTokenAddress: tokenInAddress,
        toTokenAddress: tokenOutAddress,
        amount: amountIn,
        fromAddress,
        slippage: slippageTolerance,
        chainId,
        disableEstimate: true  // Disable gas estimation to avoid balance checks
      });

      return {
        protocol: '1inch',
        amountOut: swap.toTokenAmount.toString(),
        minAmountOut: calculateMinAmountOut(swap.toTokenAmount, slippageTolerance).toString(),
        quote: quote,
        swap: swap,
        calldata: swap.calldata,
        routerAddress: swap.routerAddress,
        value: swap.value.toString(),
        estimatedGas: swap.estimatedGas,
        protocols: swap.protocols,
        // For compatibility with other DEX integrations
        path: `1inch aggregated (${swap.protocols.length} protocols)`,
        priceImpact: '0', // 1inch doesn't provide this directly
        fees: '0' // 1inch doesn't charge platform fees
      };
    }

    return null;

  } catch (error) {
    console.error('❌ Error in use1inch:', error.message);
    return null;
  }
}

/**
 * Calculate minimum output amount with slippage tolerance
 */
function calculateMinAmountOut(amountOut, slippageTolerance) {
  const slippageFactor = Math.floor((100 - slippageTolerance) * 100);
  return amountOut.mul(slippageFactor).div(10000);
}

// Export default for convenience
export default use1inch;
