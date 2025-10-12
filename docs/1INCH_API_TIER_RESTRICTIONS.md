# 1inch API Tier Restrictions - CRITICAL INFORMATION

## Issue Summary

**The `/swap` endpoint returns 403 Forbidden on the free Dev plan.**

This is NOT a bug - it's an intentional restriction by 1inch. The free tier only provides read-only access for price discovery.

## Diagnostic Results

```
✅ /healthcheck        - 200 OK (works)
✅ /quote              - 200 OK (works)
✅ /approve/*          - 200 OK (works)
❌ /swap               - 403 FORBIDDEN (requires paid plan)
```

## Why This Happens

1inch's business model:
- **Free tier**: Quote data for price comparison (they want you to see their prices are best)
- **Paid tier**: Actual swap execution (how they monetize)

The free Dev plan ($0/month) gives you:
- ✅ Price quotes (`/quote`)
- ✅ Approval transaction data (`/approve/*`)
- ✅ Protocol lists (`/liquidity-sources`)
- ✅ Token lists (`/tokens`)
- ✅ 1 RPS rate limit
- ✅ 100,000 monthly calls
- ❌ **NO SWAP ENDPOINT ACCESS**

## Solutions

### Option 1: Upgrade to Paid Plan

**Cost**: Starting at ~$149/month (Starter tier)

**Benefits**:
- ✅ `/swap` endpoint access
- ✅ Superior multi-DEX aggregation (50+ DEXs)
- ✅ Optimal routing algorithms
- ✅ 10 RPS (vs 1 RPS on free)
- ✅ Better rate limits

**When to choose this:**
- You need the absolute best prices across ALL DEXs
- You have significant trading volume
- You can justify the monthly cost
- You want 1inch's proprietary routing

**How to upgrade:**
1. Visit https://business.1inch.com/portal/pricing
2. Select a paid tier
3. Update your API key
4. No code changes needed - swap endpoint will work

### Option 2: Use Your Existing Cross-DEX System (RECOMMENDED)

**Cost**: $0 (free)

**What you already have:**
- ✅ Uniswap V4 integration (`useUniswap.js`)
- ✅ Balancer V3 integration (`useBalancerV3.js`)
- ✅ Cross-DEX optimizer (`useMixedUniswapBalancer.js`)
- ✅ Smart split optimization
- ✅ No API keys or rate limits
- ✅ Direct on-chain execution

**Benefits**:
- ✅ Completely free
- ✅ No API dependencies
- ✅ No rate limits
- ✅ Multi-DEX routing (Uniswap + Balancer)
- ✅ Proven working code
- ✅ More control over execution

**Limitations vs 1inch**:
- ⚠️ Only 2 DEXs (vs 1inch's 50+)
- ⚠️ Your routing algorithm (vs 1inch's proprietary)
- ⚠️ May not always get absolute best price

**When to choose this:**
- You want to keep costs at $0
- 2-DEX coverage is sufficient
- You want full control
- You don't need 50+ DEX aggregation

### Option 3: Hybrid Approach

Use 1inch free quotes for price comparison, but execute through your existing system:

```javascript
// Get 1inch quote for comparison
const oneinchQuote = await get1inchQuote({
  fromToken: AAVE,
  toToken: USDC,
  amount: ethers.utils.parseEther('100')
});

// Get your own routing
const yourRoute = await useMixedUniswapBalancer({
  tokenInObject: AAVE,
  tokenOutObject: USDC,
  amountIn: ethers.utils.parseEther('100'),
  provider
});

// Compare outputs
const oneinchOutput = parseFloat(ethers.utils.formatUnits(oneinchQuote.toTokenAmount, 6));
const yourOutput = parseFloat(ethers.utils.formatUnits(yourRoute.bestRoute.totalOutput, 6));

console.log(`1inch quote: ${oneinchOutput} USDC`);
console.log(`Your route:  ${yourOutput} USDC`);
console.log(`Difference:  ${((yourOutput/oneinchOutput - 1) * 100).toFixed(2)}%`);

// Execute with your system (it's free!)
if (yourOutput >= oneinchOutput * 0.995) { // Within 0.5% is acceptable
  await executeTradeWithYourSystem(yourRoute);
} else {
  console.warn('Your route is worse than 1inch - consider upgrading');
}
```

**Benefits:**
- ✅ Free execution
- ✅ Visibility into 1inch prices
- ✅ Make informed decisions
- ✅ Only upgrade if consistently beaten

## Recommendation

**For your project: Use Option 2 (Your Existing System)**

Reasons:
1. You already have a working cross-DEX optimizer
2. It's completely free with no API dependencies
3. Uniswap + Balancer cover the majority of liquidity
4. No rate limit concerns
5. Full control over execution

**Only upgrade to 1inch paid if:**
- Testing shows you're consistently getting 1-2%+ worse prices
- You need access to long-tail DEXs
- Trading volume justifies the monthly cost

## Implementation

### Current Code (Won't Work)

```javascript
// This requires paid plan
const swap = await get1inchSwap({
  fromToken: AAVE,
  toToken: USDC,
  amount: ethers.utils.parseEther('100'),
  fromAddress: walletAddress,
  slippage: 0.5
});
// ❌ Returns 403 Forbidden
```

### Use This Instead (Free)

```javascript
import { useMixedUniswapBalancer } from './utils/useMixedUniswapBalancer.js';

const result = await useMixedUniswapBalancer({
  tokenInObject: AAVE,
  tokenOutObject: USDC,
  amountIn: ethers.utils.parseEther('100'),
  provider,
  slippageTolerance: 0.5,
  maxHops: 2,
  useUniswap: true,
  useBalancer: true
});

// Execute with WalletBundler for MEV protection
const encodedData = createEncoderExecutionPlan(
  result.executionPlan,
  AAVE,
  USDC,
  0.5
);
// ✅ Works perfectly, $0 cost
```

## Testing Comparison

Run this to see how your system compares to 1inch quotes:

```bash
node tests/node/compare1inchVsOwn.js
```

This will:
1. Get 1inch quotes (free)
2. Get your routing outputs
3. Show price comparison
4. Help decide if paid upgrade is worth it

## Summary

| Feature | Free (Your System) | 1inch Paid Plan |
|---------|-------------------|-----------------|
| Cost | $0 | $149+/month |
| DEXs | 2 (Uni + Bal) | 50+ |
| Rate Limits | None | 10 RPS |
| Swap Execution | ✅ Yes | ✅ Yes |
| MEV Protection | ✅ Yes | Partial |
| Dependencies | None | API key |
| Control | Full | Limited |

**The 403 error is not a bug - it's a business decision by 1inch. Your existing system is the right choice unless you need their 50+ DEX aggregation.**
