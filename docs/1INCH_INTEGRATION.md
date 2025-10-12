# 1inch API v6.0 Integration Guide

**⚠️ IMPORTANT: The swap endpoint requires a paid plan ($149+/month). The free tier only provides quotes.**

See [1INCH_API_TIER_RESTRICTIONS.md](./1INCH_API_TIER_RESTRICTIONS.md) for full details.

This document provides comprehensive guidance on using the 1inch DEX aggregator integration in the Trades application.

## Overview

The 1inch integration (`use1inch.js`) provides access to the 1inch v6.0 Swap API, which aggregates liquidity across multiple decentralized exchanges to find optimal trading routes.

**Free Tier Limitations:**
- ✅ `/quote` - Price discovery (works)
- ❌ `/swap` - Swap execution (403 Forbidden, requires paid plan)

### Key Features

- **Quote Function**: Get expected output amounts without executing trades
- **Swap Calldata Generation**: Generate transaction data for optimal swaps
- **Multi-Protocol Aggregation**: Automatically routes through multiple DEXs
- **Slippage Protection**: Configurable slippage tolerance
- **Gas Optimization**: Routes optimized for gas efficiency
- **Token & Protocol Discovery**: List supported tokens and protocols

## Getting Started

### 1. Obtain API Key

1. Visit [1inch Developer Portal](https://portal.1inch.dev)
2. Create an account or sign in
3. Navigate to API Keys section
4. Generate a new API key for the Swap API v6.0

### 2. Configure API Key

Set your API key as an environment variable:

```bash
export ONEINCH_API_KEY="your-api-key-here"
```

For production deployments, consider using secure key management:
- Environment variables in deployment configuration
- Secure vault services (AWS Secrets Manager, HashiCorp Vault)
- Electron main process key storage (for desktop app)

### 3. Rate Limits

**Important**: The basic tier has strict rate limits:
- **1 request per second (RPS)**
- Exceeding limits will result in HTTP 429 errors
- Consider implementing request queuing for production use

## API Reference

### Core Functions

#### `get1inchQuote(params)`

Get a quote for swapping tokens without executing the trade.

**Parameters:**
```javascript
{
  fromTokenAddress: string,    // Source token contract address
  toTokenAddress: string,      // Destination token contract address
  amount: string|BigNumber,    // Amount in wei
  chainId: number,             // Chain ID (default: 1 for Ethereum)
  protocols: string[],         // Optional: Filter specific protocols
  gasPrice: number,            // Optional: Gas price in wei
  complexityLevel: number,     // Optional: 0-3 (default: 2)
  parts: number,               // Optional: Split parts (default: 10, max: 100)
  mainRouteParts: number,      // Optional: Main route parts (default: 10, max: 50)
  gasLimit: number             // Optional: Gas limit
}
```

**Returns:**
```javascript
{
  fromToken: { address, symbol, decimals, name },
  toToken: { address, symbol, decimals, name },
  fromTokenAmount: BigNumber,
  toTokenAmount: BigNumber,
  protocols: Array,
  estimatedGas: number,
  raw: Object  // Full API response
}
```

**Example:**
```javascript
import { get1inchQuote } from './use1inch.js';
import { ethers } from 'ethers';

const quote = await get1inchQuote({
  fromTokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
  toTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',   // USDC
  amount: ethers.utils.parseEther('1'),
  chainId: 1
});

console.log(`Expected output: ${ethers.utils.formatUnits(quote.toTokenAmount, 6)} USDC`);
```

#### `get1inchSwap(params)`

Generate transaction calldata for executing a swap.

**Parameters:**
```javascript
{
  fromTokenAddress: string,    // Source token contract address
  toTokenAddress: string,      // Destination token contract address
  amount: string|BigNumber,    // Amount in wei
  fromAddress: string,         // Wallet address executing swap
  slippage: number,            // Slippage % (default: 1)
  chainId: number,             // Chain ID (default: 1)
  referrer: string,            // Optional: Referrer address
  fee: number,                 // Optional: Referrer fee % (0-3)
  protocols: string[],         // Optional: Filter protocols
  gasPrice: number,            // Optional: Gas price
  complexityLevel: number,     // Optional: 0-3 (default: 2)
  parts: number,               // Optional: Split parts
  mainRouteParts: number,      // Optional: Main route parts
  disableEstimate: boolean,    // Optional: Skip gas estimation
  allowPartialFill: boolean,   // Optional: Allow partial fills
  receiver: string             // Optional: Receiver address
}
```

**Returns:**
```javascript
{
  fromToken: { address, symbol, decimals, name },
  toToken: { address, symbol, decimals, name },
  fromTokenAmount: BigNumber,
  toTokenAmount: BigNumber,
  protocols: Array,
  tx: { from, to, data, value, gasPrice, gas },
  routerAddress: string,
  calldata: string,
  value: BigNumber,
  estimatedGas: number,
  raw: Object
}
```

**Example:**
```javascript
import { get1inchSwap } from './use1inch.js';

const swap = await get1inchSwap({
  fromTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
  toTokenAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',   // DAI
  amount: ethers.utils.parseUnits('1000', 6),
  fromAddress: '0xYourWalletAddress',
  slippage: 0.5,
  chainId: 1
});

// Execute the swap
const tx = await wallet.sendTransaction({
  to: swap.tx.to,
  data: swap.calldata,
  value: swap.value,
  gasLimit: swap.estimatedGas
});
```

#### `use1inch(params)`

Convenience wrapper combining quote and swap in one call. Matches the pattern used by `useUniswap` and `useBalancerV3`.

**Parameters:**
```javascript
{
  tokenInAddress: string,
  tokenOutAddress: string,
  amountIn: BigNumber,
  fromAddress: string,
  slippageTolerance: number,  // Default: 0.5%
  chainId: number             // Default: 1
}
```

**Returns:**
```javascript
{
  protocol: '1inch',
  amountOut: string,
  minAmountOut: string,
  quote: Object,
  swap: Object,
  calldata: string,
  routerAddress: string,
  value: string,
  estimatedGas: number,
  protocols: Array,
  path: string,
  priceImpact: string,
  fees: string
}
```

**Example:**
```javascript
import { use1inch } from './use1inch.js';

const result = await use1inch({
  tokenInAddress: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', // AAVE
  tokenOutAddress: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',  // UNI
  amountIn: ethers.utils.parseEther('10'),
  fromAddress: '0xYourWalletAddress',
  slippageTolerance: 0.5,
  chainId: 1
});
```

### Utility Functions

#### `get1inchProtocols(chainId)`

Get list of all supported protocols on a chain.

```javascript
const protocols = await get1inchProtocols(1);
console.log(`Supported: ${protocols.length} protocols`);
```

#### `get1inchTokens(chainId)`

Get list of all supported tokens on a chain.

```javascript
const tokens = await get1inchTokens(1);
const tokenList = Object.values(tokens);
```

#### `check1inchAllowance(tokenAddress, walletAddress, chainId)`

Check if token allowance is sufficient for 1inch router.

```javascript
const allowance = await check1inchAllowance(
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
  '0xYourWalletAddress',
  1
);

if (allowance.needsApproval) {
  console.log('Approval required');
}
```

#### `get1inchApprovalTx(tokenAddress, amount, chainId)`

Get approval transaction data.

```javascript
const approvalTx = await get1inchApprovalTx(
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
  null, // null = infinite approval
  1
);

// Execute approval
await wallet.sendTransaction({
  to: approvalTx.to,
  data: approvalTx.data,
  value: approvalTx.value
});
```

## Testing

Run the comprehensive test suite:

```bash
# Set API key
export ONEINCH_API_KEY="your-api-key"

# Run tests
node tests/node/test1inch.js
```

The test suite includes:
1. Quote Function Test (ETH → USDC)
2. Swap Calldata Test (USDC → DAI)
3. Combined Wrapper Test (AAVE → UNI)
4. Protocol List Test
5. Token List Test
6. Approval Check Test
7. Edge Case Test (ETH → WETH)
8. Multiple Amounts Test

**Note**: Tests include 1.2 second delays between requests to respect rate limits.

## Integration with Existing System

### Adding 1inch to the Router

The 1inch integration can be added to the existing multi-DEX routing system:

```javascript
import { use1inch } from './utils/use1inch.js';
import { useBalancerV3 } from './utils/useBalancerV3.js';
import { useUniswap } from './utils/useUniswap.js';

async function findBestRoute(tokenIn, tokenOut, amountIn, walletAddress) {
  const routes = await Promise.allSettled([
    use1inch({
      tokenInAddress: tokenIn,
      tokenOutAddress: tokenOut,
      amountIn,
      fromAddress: walletAddress
    }),
    useBalancerV3({
      tokenInAddress: tokenIn,
      tokenOutAddress: tokenOut,
      amountIn
    }),
    useUniswap({
      tokenInAddress: tokenIn,
      tokenOutAddress: tokenOut,
      amountIn
    })
  ]);

  // Compare outputs and select best route
  const validRoutes = routes
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);

  return validRoutes.reduce((best, route) => {
    const routeOutput = ethers.BigNumber.from(route.amountOut);
    const bestOutput = ethers.BigNumber.from(best.amountOut);
    return routeOutput.gt(bestOutput) ? route : best;
  });
}
```

### Protocol Return Value

When integrated into the `bestTrade` routing system, 1inch returns `"1inch"` as the protocol identifier, joining:
- `"Uniswap"` - Direct Uniswap V4 execution
- `"Balancer"` - Direct Balancer V3 execution
- `"Contract"` - WalletBundler contract execution
- `"1inch"` - 1inch aggregator execution

## Important Considerations

### 1. Rate Limits

The basic tier (1 RPS) is very restrictive. For production:
- Implement request queuing
- Cache quotes when possible
- Consider upgrading to paid tier
- Use 1inch sparingly (e.g., only for large trades)

### 2. No Platform Fees

1inch doesn't charge platform fees. They capture rare positive slippage (~1%). This makes them competitive with direct DEX integration.

### 3. API Key Security

Never expose API keys in:
- Client-side code
- Version control
- Browser console logs
- Error messages

Use secure key management:
- Environment variables
- Electron main process storage
- Secure vault services

### 4. Gas Costs

1inch routes are often more complex (multi-hop, split routes), which can result in higher gas costs. Always compare:
- Output amount
- Gas cost
- Net profit after gas

### 5. Slippage

1inch API expects slippage as a percentage (e.g., `1` = 1%). The integration handles conversion from the app's slippage format.

### 6. ETH vs WETH

1inch uses a special address for ETH:
- ETH: `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`
- WETH: `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`

The integration handles this automatically.

## Error Handling

Common errors and solutions:

### HTTP 401 Unauthorized
```
Solution: Check API key is correctly set
export ONEINCH_API_KEY="your-key"
```

### HTTP 429 Too Many Requests
```
Solution: You've exceeded rate limits (1 RPS)
- Add delays between requests
- Implement request queue
- Upgrade API tier
```

### HTTP 400 Bad Request
```
Solution: Invalid parameters
- Check token addresses are valid
- Ensure amount is in wei format
- Verify wallet address format
```

### Insufficient Liquidity
```
Solution: No route found for this token pair
- Try smaller amounts
- Check tokens are supported
- Use different DEX
```

## Performance Optimization

### Caching

Cache quotes for short periods (10-30 seconds):
```javascript
const quoteCache = new Map();

async function getCachedQuote(from, to, amount) {
  const key = `${from}-${to}-${amount}`;
  const cached = quoteCache.get(key);

  if (cached && Date.now() - cached.timestamp < 10000) {
    return cached.quote;
  }

  const quote = await get1inchQuote({ fromTokenAddress: from, toTokenAddress: to, amount });
  quoteCache.set(key, { quote, timestamp: Date.now() });

  return quote;
}
```

### Request Queuing

Implement a queue to respect rate limits:
```javascript
class RateLimitedQueue {
  constructor(rps = 1) {
    this.queue = [];
    this.interval = 1000 / rps;
    this.processing = false;
  }

  async add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      if (!this.processing) this.process();
    });
  }

  async process() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const { fn, resolve, reject } = this.queue.shift();

    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    }

    setTimeout(() => this.process(), this.interval);
  }
}

const queue = new RateLimitedQueue(1); // 1 RPS

// Usage
const quote = await queue.add(() => get1inchQuote({ ... }));
```

## Troubleshooting

### Issue: "fetch is not defined"
**Solution**: Use Node.js 18+ or install node-fetch polyfill

### Issue: Quotes differ significantly from other DEXs
**Reason**: 1inch aggregates multiple DEXs and may split orders
**Action**: Compare net output after gas costs

### Issue: Swap fails with "Insufficient allowance"
**Solution**: Call approval function first:
```javascript
const allowance = await check1inchAllowance(tokenAddress, walletAddress);
if (allowance.needsApproval) {
  const approvalTx = await get1inchApprovalTx(tokenAddress);
  await wallet.sendTransaction(approvalTx);
  // Wait for confirmation, then retry swap
}
```

## Resources

- [1inch Developer Portal](https://portal.1inch.dev)
- [1inch API Documentation](https://portal.1inch.dev/documentation/apis/swap)
- [1inch Swagger UI](https://portal.1inch.dev/documentation/apis/swap/swagger)
- [1inch Blog](https://blog.1inch.io)
- [GitHub Example](https://github.com/1inch)

## Support

For issues with the integration:
1. Check API key configuration
2. Verify rate limits aren't exceeded
3. Review error messages in console
4. Test with the provided test suite
5. Check 1inch API status page

For 1inch API issues:
- [1inch Support](https://help.1inch.io)
- [1inch Discord](https://discord.gg/1inch)
