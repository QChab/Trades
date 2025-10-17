# Memory Corruption Fix - Assembly returndatacopy Pattern

## Problem

Assembly functions using `staticcall` or `call` with direct output pointer writing were causing **memory corruption** by overwriting calldata regions containing function parameters.

### Root Cause

```solidity
// ❌ VULNERABLE PATTERN
let success := staticcall(gas(), token, ptr, 0x24, outPtr, 0x20)
// This writes return data directly to outPtr, which can corrupt calldata!
```

When the EVM writes return data to a memory location during the call, it can corrupt:
- Calldata parameters stored in memory
- Other function variables
- Struct fields passed as calldata

### Example Bug

In `UniswapEncoder.encodeUseAllBalanceSwap()`:
1. Step 0 called with `swapParams.tokenIn = PAXG`
2. `_getTokenBalance()` writes balance to memory, corrupting calldata
3. Step 1 called with `swapParams.tokenIn = DAI`
4. `_getTokenBalance()` corrupts calldata again
5. **Result**: Step 1 returns PAXG address instead of DAI!

This caused the WalletBundler to approve PAXG for the second swap instead of DAI, causing transaction failures.

## Solution

Use `returndatacopy` to **explicitly** copy return data AFTER the call completes:

```solidity
// ✅ SAFE PATTERN
let success := staticcall(gas(), token, ptr, 0x24, 0, 0)
if iszero(success) { revert(0, 0) }

// Explicitly copy return data AFTER the call
if gt(returndatasize(), 0) {
    let outPtr := add(ptr, 0x40)
    returndatacopy(outPtr, 0, 0x20)
    tokenBalance := mload(outPtr)
}
```

### Benefits

1. **No memory corruption**: Return data isn't written during the call
2. **Explicit control**: We choose when and where to copy data
3. **Safe memory regions**: Can verify memory layout before copying
4. **Calldata protection**: Calldata regions remain untouched during external calls

## Fixed Functions

### UniswapEncoder.sol
- ✅ `_getTokenBalance()` - Line 168-188

### BalancerEncoder.sol
- ✅ `_getTokenBalance()` - Line 99-118

### WalletBundler.sol
- ✅ `_transferFromToken()` - Line 54-75 (ERC20 transferFrom)
- ✅ `_transferToken()` - Line 83-103 (ERC20 transfer)
- ✅ `_getTokenBalance()` - Line 111-130 (ERC20 balanceOf)
- ✅ `_getAllowance()` - Line 355-375 (ERC20 allowance)
- ✅ Permit2 allowance check - Line 265-285 (Permit2 allowance query)

### Functions NOT Modified (No Return Data)

These functions don't read return data, so they're safe:
- `_sendETH()` - Transfers ETH (no return value)
- `_wrapETH()` - Calls WETH.deposit() (no return value checked)
- `_unwrapWETH()` - Calls WETH.withdraw() (no return value checked)
- `_approve()` - Calls ERC20.approve() (no return value checked)
- Permit2 approve call - Calls Permit2.approve() (no return value checked)

## Testing

All contracts compiled successfully with the fixes applied:
```
Compiled 2 Solidity files successfully (evm target: paris)
```

## Deployment

Updated encoder addresses:
- **UniswapEncoder**: `0xbB9417Cfd94383cA8EF2e323aE2e244CC58aF010`
- **BalancerEncoder**: `0xc9BC3dd2AAF14992Bf987dFEf1E9592151E8e1C4`

WalletBundler contracts should be redeployed or upgraded to include these fixes.

## Best Practices

### Always Use returndatacopy For:
- ✅ `staticcall` that returns data (view functions)
- ✅ `call` that returns data (state-changing functions with return values)
- ✅ Any external call where you need the return value

### Pattern Template

```solidity
function _externalViewCall(address target, bytes memory data) private view returns (bytes memory) {
    assembly {
        let ptr := mload(0x40)

        // Prepare call data
        // ... (store function selector and parameters)

        // Call without writing output
        let success := staticcall(gas(), target, ptr, inputSize, 0, 0)
        if iszero(success) { revert(0, 0) }

        // Copy return data explicitly
        if gt(returndatasize(), 0) {
            let outPtr := add(ptr, 0x80)  // Safe offset
            returndatacopy(outPtr, 0, returndatasize())
            // Process return data from outPtr
        }
    }
}
```

## References

- Solidity Assembly Documentation: `returndatacopy`
- EVM Opcodes: RETURNDATACOPY (0x3e)
- Memory Safety in Solidity Assembly