// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title UniswapEncoder
 * @notice Encodes Uniswap V4 unlock callback data directly (optimized for WalletBundler)
 * @dev Returns unlock callback format - NO Universal Router overhead
 */
contract UniswapEncoder {
    address private constant UNIVERSAL_ROUTER = 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af;
    address private constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    // Price limits for Uniswap V4
    uint160 private constant MIN_SQRT_PRICE_LIMIT = 4295128740;  // MIN_SQRT_PRICE + 1
    uint160 private constant MAX_SQRT_PRICE_LIMIT = 1461446703485210103287273052203988822378723970341;  // MAX_SQRT_PRICE - 1

    // PoolKey structure (matches PoolManager)
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    // SwapParams structure (matches PoolManager)
    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    // Swap parameters for use-all-balance swap
    struct UseAllBalanceParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint256 minAmountOut;
        uint8 wrapOp;
        address tokenIn;
    }

    /**
     * @notice Encode unlock callback data using all available balance
     * @dev For intermediate hops - calculates actual balance dynamically
     * @param swapParams Struct containing all swap parameters
     * @return target The Universal Router address (flag for WalletBundler)
     * @return callData The encoded unlock callback data
     * @return inputAmount Returns the actual balance amount
     * @return _tokenIn The tokenIn address
     */
    function encodeUseAllBalanceSwap(
        UseAllBalanceParams calldata swapParams
    ) external view returns (address target, bytes memory callData, uint256 inputAmount, address _tokenIn) {
        // Determine which balance to query based on wrap operation
        address balanceToken = swapParams.tokenIn;
        if (swapParams.wrapOp == 1) {
            // Will wrap ETH to WETH before swap, query ETH balance
            balanceToken = address(0);
        } else if (swapParams.wrapOp == 3) {
            // Will unwrap WETH to ETH before swap, query WETH balance
            balanceToken = WETH;
        }

        // Get the actual balance (ETH or token)
        uint256 actualBalance = balanceToken == address(0)
            ? msg.sender.balance
            : _getTokenBalance(balanceToken, msg.sender);

        // Determine output token
        address tokenOut = swapParams.zeroForOne
            ? swapParams.poolKey.currency1
            : swapParams.poolKey.currency0;

        // Determine price limit
        uint160 sqrtPriceLimitX96 = swapParams.zeroForOne
            ? MIN_SQRT_PRICE_LIMIT
            : MAX_SQRT_PRICE_LIMIT;

        // Encode unlock callback format with actual balance
        callData = abi.encode(
            swapParams.tokenIn,                     // tokenIn
            tokenOut,                               // tokenOut
            swapParams.poolKey,                     // poolKey
            SwapParams({
                zeroForOne: swapParams.zeroForOne,
                amountSpecified: -int256(actualBalance),  // Use actual balance!
                sqrtPriceLimitX96: sqrtPriceLimitX96
            }),
            swapParams.minAmountOut                 // minAmountOut
        );

        return (UNIVERSAL_ROUTER, callData, actualBalance, swapParams.tokenIn);
    }

    /**
     * @dev Internal assembly function to get ERC20 token balance
     * @param token Token contract address
     * @param account Account to check balance for
     * @return tokenBalance Token balance
     */
    function _getTokenBalance(address token, address account) private view returns (uint256 tokenBalance) {
        assembly {
            let ptr := mload(0x40)
            // Store balanceOf(address) selector
            mstore(ptr, 0x70a0823100000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), account)

            // Use separate memory location for output (ptr + 0x40 = 64 bytes after input)
            let outPtr := add(ptr, 0x40)
            let success := staticcall(gas(), token, ptr, 0x24, outPtr, 0x20)
            if iszero(success) { revert(0, 0) }

            // Verify we actually got return data (protects against non-existent contracts)
            if iszero(returndatasize()) { revert(0, 0) }

            tokenBalance := mload(outPtr)
        }
    }
}