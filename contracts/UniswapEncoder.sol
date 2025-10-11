// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title UniswapEncoder
 * @notice Encodes Uniswap V4 Universal Router swap calls dynamically
 * @dev Stateless encoder that can be deployed once and used by all WalletBundler instances
 */
contract UniswapEncoder {
    // Uniswap Universal Router address
    address private constant UNIVERSAL_ROUTER = 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af;
    uint48 private constant EXPIRATION_OFFSET = 1577836800; // 50 years from 2020

    // Command code for Universal Router V4 swaps
    uint8 private constant V4_SWAP = 0x10;

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    /**
     * @notice Encode a single swap on Uniswap V4
     * @param tokenIn Address of input token
     * @param tokenOut Address of output token
     * @param fee Pool fee tier (500, 3000, 10000 for 0.05%, 0.3%, 1%)
     * @param amountIn Amount of input tokens
     * @param minAmountOut Minimum acceptable output
     * @return target The Universal Router address
     * @return callData The encoded swap call
     * @return inputAmount The actual amount to be used (for wrap/unwrap operations)
     * @return tokenIn The tokenIn address
     */
    function encodeSingleSwap(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 minAmountOut
    ) external view returns (address target, bytes memory callData, uint256 inputAmount, address) {
        bytes memory commands = abi.encodePacked(V4_SWAP);

        ExactInputSingleParams memory params = ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            recipient: msg.sender,  // Always the calling WalletBundler
            amountIn: amountIn,
            amountOutMinimum: minAmountOut,
            sqrtPriceLimitX96: 0
        });

        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(params);

        uint256 deadline = EXPIRATION_OFFSET;

        callData = abi.encodeWithSignature(
            "execute(bytes,bytes[],uint256)",
            commands,
            inputs,
            deadline
        );

        return (UNIVERSAL_ROUTER, callData, amountIn, tokenIn);
    }

    /**
     * @notice Encode a swap using all available balance
     * @dev For intermediate hops that should use entire balance
     * @param tokenIn Address of input token (address(0) for ETH)
     * @param tokenOut Address of output token
     * @param fee Pool fee tier
     * @param minAmountOut Minimum acceptable output (can be 0)
     * @return target The Universal Router address
     * @return callData The encoded swap with actual balance
     * @return inputAmount Returns the actual balance amount
     * @return tokenIn The tokenIn address
     */
    function encodeUseAllBalanceSwap(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 minAmountOut
    ) external view returns (address target, bytes memory callData, uint256 inputAmount, address) {
        // Get the actual balance (ETH or token)
        uint256 actualBalance;
        if (tokenIn == address(0)) {
            // ETH balance
            actualBalance = msg.sender.balance;
        } else {
            // Token balance using optimized assembly
            actualBalance = _getTokenBalance(tokenIn, msg.sender);
        }

        bytes memory commands = abi.encodePacked(V4_SWAP);

        ExactInputSingleParams memory params = ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            recipient: msg.sender,  // Always the calling WalletBundler
            amountIn: actualBalance, // Use actual balance instead of max marker
            amountOutMinimum: minAmountOut,
            sqrtPriceLimitX96: 0
        });

        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(params);

        uint256 deadline = EXPIRATION_OFFSET;

        callData = abi.encodeWithSignature(
            "execute(bytes,bytes[],uint256)",
            commands,
            inputs,
            deadline
        );

        return (UNIVERSAL_ROUTER, callData, actualBalance, tokenIn);
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

            let success := staticcall(gas(), token, ptr, 0x24, ptr, 0x20)
            if iszero(success) { revert(0, 0) }

            tokenBalance := mload(ptr)
        }
    }
}