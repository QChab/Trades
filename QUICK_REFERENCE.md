# Direct V4 Swap - Quick Reference Card

## 🚀 Quick Start

### 1. Deploy/Update Contract
```bash
npx hardhat compile
npx hardhat run scripts/deployWalletBundler.js --network mainnet
```

### 2. Execute AAVE→ETH Swap (Previously Failing)

```javascript
const { ethers } = require('ethers');
const DirectV4Swap = require('./src/bundler/DirectV4Swap');

// Setup
const bundler = await ethers.getContractAt('WalletBundler', bundlerAddress);
const directSwap = new DirectV4Swap(bundler);

// Tokens
const AAVE = '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9';
const ETH = ethers.constants.AddressZero;

// Pool Key
const poolKey = DirectV4Swap.buildPoolKey(AAVE, ETH, 3000, 60);

// Execute
const result = await directSwap.executeSwap({
    fromToken: AAVE,
    fromAmount: ethers.utils.parseUnits('100', 18),
    toToken: ETH,
    poolKey: poolKey,
    zeroForOne: DirectV4Swap.getSwapDirection(AAVE, poolKey),
    minOutputAmount: ethers.utils.parseEther('2.5')
});

console.log(`Success: ${result.success}`);
console.log(`Output: ${ethers.utils.formatEther(result.outputAmount)} ETH`);
```

## 📋 Common Patterns

### Token Approval (ERC20 Only)
```javascript
const token = await ethers.getContractAt('IERC20', tokenAddress);
const tx = await token.approve(bundlerAddress, ethers.constants.MaxUint256);
await tx.wait();
```

### Build Pool Key
```javascript
const poolKey = DirectV4Swap.buildPoolKey(
    tokenA,
    tokenB,
    fee,        // 500, 3000, or 10000
    tickSpacing // Use getTickSpacing(fee) helper
);
```

### Determine Swap Direction
```javascript
// Automatically determines zeroForOne
const zeroForOne = DirectV4Swap.getSwapDirection(inputToken, poolKey);
```

### Calculate Min Output (1% Slippage)
```javascript
const expectedOutput = await getQuote(fromToken, toToken, amount);
const minOutput = expectedOutput.mul(99).div(100);
```

## 🔧 Common Fee Tiers & Tick Spacings

| Fee Tier | Percentage | Tick Spacing | Use Case |
|----------|------------|--------------|----------|
| 100 | 0.01% | 1 | Stable pairs |
| 500 | 0.05% | 10 | Stable pairs |
| 3000 | 0.3% | 60 | Most pairs (default) |
| 10000 | 1% | 200 | Exotic pairs |

## 🎯 Token Ordering Rules

**Rule**: `currency0` < `currency1` (lexicographical)

**ETH Special Case**: `address(0)` is always `currency0`

### Examples:
```
ETH/AAVE  → currency0: 0x0000..., currency1: 0x7Fc6...
ETH/USDC  → currency0: 0x0000..., currency1: 0xA0b8...
AAVE/USDC → currency0: 0x7Fc6..., currency1: 0xA0b8...
```

### Swap Directions:
```javascript
// AAVE → ETH
zeroForOne = false  // currency1 → currency0

// ETH → AAVE
zeroForOne = true   // currency0 → currency1
```

## ⚡ Gas Estimates

| Operation | Gas Cost |
|-----------|----------|
| Direct V4 Swap | 180-200k |
| Universal Router | 250-300k |
| Savings | 25-40% |

## 🛠️ Troubleshooting

### "Unauthorized"
→ Call from owner address only

### "Insufficient output"
→ Adjust `minOutputAmount` (check current price)

### "Wrong token received"
→ Check `zeroForOne` direction

### Compilation Error
→ Run `npx hardhat clean && npx hardhat compile`

## 📞 Contract ABIs

### swapDirectV4
```solidity
function swapDirectV4(
    address fromToken,          // Input token (0x0 for ETH)
    uint256 fromAmount,         // Input amount
    address toToken,            // Output token (0x0 for ETH)
    PoolKey calldata poolKey,   // Pool parameters
    bool zeroForOne,            // Swap direction
    int256 amountSpecified,     // Negative for exact input
    uint160 sqrtPriceLimitX96,  // Price limit (0 = none)
    uint256 minOutputAmount     // Minimum output
) external payable returns (uint256 outputAmount)
```

### PoolKey Struct
```solidity
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}
```

## 📊 Testing Commands

```bash
# Run test script
npx hardhat run test/testDirectV4Swap.js --network mainnet

# Run specific test with Forge
forge test --match-test testDirectV4Swap -vvvv

# Check contract size
npx hardhat size-contracts
```

## 🔍 Useful Addresses (Mainnet)

```javascript
const ADDRESSES = {
    POOL_MANAGER: '0x000000000004444c5dc75cB358380D2e3dE08A90',
    PERMIT2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    AAVE: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    ETH: ethers.constants.AddressZero
};
```

## 📖 Full Documentation

- **Complete Guide**: `DIRECT_V4_SWAP_GUIDE.md`
- **Implementation Details**: `IMPLEMENTATION_SUMMARY.md`
- **Contract Source**: `contracts/WalletBundler.sol:432-549`
- **Helper Source**: `src/bundler/DirectV4Swap.js`

## 💡 Pro Tips

1. **Always use helpers**: `buildPoolKey()` and `getSwapDirection()` prevent errors
2. **Test with small amounts first**: Verify pool parameters are correct
3. **Monitor gas prices**: Direct swaps are cheaper but still need reasonable gas
4. **Use price oracles**: Don't hardcode `minOutputAmount`
5. **Check token approvals**: ERC20 tokens need approval before swap

## ✅ Pre-Flight Checklist

- [ ] Contract deployed and verified
- [ ] Token approvals set
- [ ] Pool key correctly constructed (sorted tokens)
- [ ] Swap direction matches input token
- [ ] Min output calculated with slippage
- [ ] Sufficient balance in wallet
- [ ] Gas price acceptable

---

**Need Help?** See `DIRECT_V4_SWAP_GUIDE.md` for detailed explanations.
