# Odos Aggregation Protocol Integration

## Overview

Odos is a superior alternative to 1inch for DEX aggregation in the Trades application. This document provides comprehensive information about integrating with the Odos API.

## Key Advantages Over 1inch

| Feature | Odos | 1inch |
|---------|------|-------|
| **API Key Required** | ❌ NO | ✅ YES |
| **Rate Limits** | 600 req/5min (~2 RPS) | 1 req/sec (paid plan required for /swap) |
| **Setup Complexity** | None - works immediately | Requires API key registration |
| **Cost** | Free | Requires paid plan for swap endpoint |
| **Liquidity Sources** | 100+ protocols | Similar coverage |

## API Documentation

- **Official Docs**: https://docs.odos.xyz/build/api-docs
- **Quick Start**: https://docs.odos.xyz/build/quickstart/sor
- **Base URL**: https://api.odos.xyz

## API Key Requirements

**NO API KEY REQUIRED!** 🎉

Odos uses IP-based rate limiting instead of API keys:
- **Free Tier**: 600 requests per 5 minutes per IP address
- **No registration**: Works immediately without any setup
- **No authentication headers**: Simple HTTP requests

For higher rate limits, contact Odos team via Discord: https://discord.gg/odos

## API Endpoints

### 1. Quote Endpoint

**POST** `/sor/quote/v2`

Get a quote for token swaps without executing the transaction.

**Request Body:**
```json
{
  "chainId": 1,
  "inputTokens": [
    {
      "tokenAddress": "0x0000000000000000000000000000000000000000",
      "amount": "1000000000000000000"
    }
  ],
  "outputTokens": [
    {
      "tokenAddress": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "proportion": 1
    }
  ],
  "slippageLimitPercent": 0.5,
  "userAddr": "0x...",
  "referralCode": 0,
  "disableRFQs": true,
  "compact": true
}
```

**Response:**
```json
{
  "pathId": "0x...",
  "outAmounts": ["3500000000"],
  "gasEstimate": 150000,
  "priceImpact": 0.05,
  ...
}
```

**Parameters:**
- `chainId`: Network ID (1 for Ethereum mainnet)
- `inputTokens`: Array of input tokens with amounts (supports 1-6 tokens)
- `outputTokens`: Array of output tokens with proportions (supports 1-6 tokens)
- `slippageLimitPercent`: Slippage tolerance (e.g., 0.5 = 0.5%)
- `userAddr`: User wallet address (checksummed)
- `referralCode`: Optional referral code (default: 0)
- `disableRFQs`: Disable RFQs for reliability (recommended: true)
- `compact`: Use compact calldata (recommended: true)

### 2. Assemble Endpoint

**POST** `/sor/assemble`

Generate executable transaction data from a quote pathId.

**Request Body:**
```json
{
  "userAddr": "0x...",
  "pathId": "0x...",
  "simulate": true
}
```

**Response:**
```json
{
  "transaction": {
    "from": "0x...",
    "to": "0x...",
    "data": "0x...",
    "value": "0",
    "gas": 150000,
    "gasPrice": "30000000000",
    ...
  },
  "simulation": {
    "gasEstimate": 145234,
    ...
  }
}
```

**Parameters:**
- `userAddr`: User wallet address (must match quote request)
- `pathId`: Path ID from quote response
- `simulate`: Enable gas simulation (recommended: true for testing)

## Implementation Files

### useOdos.js

Location: `src/renderer/utils/useOdos.js`

**Main Functions:**

1. **getOdosQuote()** - Get price quote
   ```javascript
   const quote = await getOdosQuote({
     fromToken: { address, symbol, decimals },
     toToken: { address, symbol, decimals },
     amount: ethers.BigNumber,
     userAddr: "0x...",
     chainId: 1,
     slippageLimitPercent: 0.5
   });
   ```

2. **getOdosAssemble()** - Assemble transaction
   ```javascript
   const assembled = await getOdosAssemble({
     pathId: quote.pathId,
     userAddr: "0x...",
     simulate: true
   });
   ```

3. **getOdosSwap()** - Combined quote + assemble (convenience function)
   ```javascript
   const swap = await getOdosSwap({
     fromToken: { address, symbol, decimals },
     toToken: { address, symbol, decimals },
     amount: ethers.BigNumber,
     fromAddress: "0x...",
     slippage: 0.5,
     chainId: 1
   });
   ```

4. **checkOdosAllowance()** - Check token allowance
   ```javascript
   const allowance = await checkOdosAllowance(
     tokenAddress,
     walletAddress,
     routerAddress,
     provider
   );
   ```

5. **getOdosApprovalTx()** - Generate approval transaction
   ```javascript
   const approvalTx = getOdosApprovalTx(
     tokenAddress,
     routerAddress,
     amount // null for infinite
   );
   ```

### testOdos.js

Location: `tests/node/testOdos.js`

**Test Suite:**
- Quote function (ETH → USDC)
- Assemble function
- Swap function (combined quote + assemble)
- Protocol listing
- Token to token swaps (AAVE → USDC)
- Approval transaction generation
- Edge cases (ETH → WETH)

**Running Tests:**
```bash
node tests/node/testOdos.js
```

No environment variables or API keys needed!

## Rate Limiting

Odos enforces rate limits by IP address:
- **Limit**: 600 requests per 5 minutes
- **Effective Rate**: ~2 requests per second
- **Implementation**: Automatic delay of 550ms between requests in `useOdos.js`

If you need higher limits, contact Odos via Discord.

## Token Address Format

**ETH/Native Token:**
- Odos uses: `0x0000000000000000000000000000000000000000` (zero address)
- Automatically converted from 1inch format (`0xEeee...`)

**ERC20 Tokens:**
- Use standard checksummed addresses
- Both WETH and ETH are supported

## Best Practices

1. **Always use `disableRFQs: true`** for reliability
   - RFQs can fail unpredictably
   - Direct DEX routing is more reliable

2. **Use `compact: true`** for gas optimization
   - Reduces calldata size
   - Lower transaction costs

3. **Enable simulation during testing**
   - Set `simulate: true` in assemble requests
   - Get accurate gas estimates

4. **Don't modify calldata**
   - Use transaction data exactly as provided
   - Modifications will cause failed transactions

5. **Check router address from response**
   - Router address may vary
   - Always get from quote/assemble response for approvals

## Error Handling

Common errors and solutions:

### Rate Limit Exceeded
```
Error: Odos API error (429): Too Many Requests
```
**Solution**: Wait 5 minutes or reduce request frequency

### Invalid User Address
```
Error: Invalid userAddr: ...
```
**Solution**: Ensure address is checksummed and valid

### Insufficient Liquidity
```
Error: No route found
```
**Solution**: Check token pair availability or reduce amount

### Assembly Failed
```
Error: PathId expired
```
**Solution**: Generate new quote (pathIds expire after ~60 seconds)

## Integration with Trades Application

To integrate Odos into the existing routing system:

1. **Import useOdos.js** in routing logic
   ```javascript
   import { getOdosSwap } from './utils/useOdos.js';
   ```

2. **Add Odos to protocol comparison**
   ```javascript
   // Compare Uniswap, Balancer, and Odos
   const odosQuote = await getOdosSwap({...});
   const bestRoute = comparePrices([uniswap, balancer, odos]);
   ```

3. **Handle Odos in execution plan**
   ```javascript
   if (route.protocol === 'odos') {
     // Use Odos calldata directly
     await executeOdosSwap(route.swap);
   }
   ```

## Migration from 1inch

If replacing 1inch with Odos:

1. **Remove API key requirement**
   - Delete `ONEINCH_API_KEY` environment variable
   - Remove API key fetching logic

2. **Update function calls**
   ```javascript
   // Old (1inch)
   const swap = await get1inchSwap({...});

   // New (Odos)
   const swap = await getOdosSwap({...});
   ```

3. **Update rate limiting**
   - 1inch: 1 req/sec → Odos: 2 req/sec
   - Can make requests faster!

4. **Update error handling**
   - Remove 403/authentication errors
   - Handle 429 rate limits (less frequent)

## Support and Resources

- **Documentation**: https://docs.odos.xyz
- **Discord**: https://discord.gg/odos
- **Twitter**: @odosprotocol
- **GitHub**: https://github.com/odos-xyz

For technical assistance, join the Odos Discord community.

## Future Enhancements

Odos roadmap includes:

1. **Enterprise API** (Q1 2025)
   - Paid tier with higher rate limits
   - Dedicated support

2. **Advanced Trading Tools**
   - DCA (Dollar Cost Averaging)
   - TWAP (Time-Weighted Average Price)

3. **Cross-Chain Routing**
   - Multi-chain swaps
   - Bridge aggregation

## Conclusion

Odos is recommended over 1inch for the Trades application due to:
- ✅ No API key requirement
- ✅ Better rate limits
- ✅ Simpler integration
- ✅ No cost barriers
- ✅ Similar or better routing quality

The implementation is production-ready and can be deployed immediately.
