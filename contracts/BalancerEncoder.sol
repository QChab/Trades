// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title BalancerEncoder
 * @notice Encodes Balancer V3 swap calls via Router
 * @dev Stateless encoder that can be deployed once and used by all WalletBundler instances
 */
contract BalancerEncoder {
    // Balancer V3 Router address (simple Router, not BatchRouter)
    address private constant ROUTER = 0xAE563E3f8219521950555F5962419C8919758Ea2;
    uint256 private constant DEADLINE = type(uint256).max; // No deadline

    /**
     * @notice Encode a single swap for Balancer V3 via Router
     * @param pool The pool address to swap through
     * @param tokenIn Address of input token
     * @param tokenOut Address of output token
     * @param amountIn Amount of input tokens
     * @param minAmountOut Minimum acceptable output
     * @return target The Router contract address
     * @return callData The encoded swap call
     * @return inputAmount The actual amount to be used
     * @return tokenIn The tokenIn address
     */
    function encodeSingleSwap(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external pure returns (address target, bytes memory callData, uint256 inputAmount, address) {

        callData = abi.encodeWithSignature(
            "swapSingleTokenExactIn(address,address,address,uint256,uint256,uint256,bool,bytes)",
            pool,
            tokenIn,
            tokenOut,
            amountIn,
            minAmountOut,
            DEADLINE,
            false, // wethIsEth
            "" // empty userData
        );

        return (ROUTER, callData, amountIn, tokenIn);
    }

    /**
     * @notice Encode a swap using all available balance
     * @dev Special function for intermediate hops that use entire balance
     * @param pool The pool address to swap through
     * @param tokenIn Address of input token
     * @param tokenOut Address of output token
     * @param minAmountOut Minimum acceptable output (can be 0 for intermediate)
     * @param wrapOp Wrap operation: 0=none, 1=wrap ETH before, 3=unwrap WETH before
     * @return target The Router contract address
     * @return callData The encoded swap call with actual balance
     * @return inputAmount Returns the actual balance amount
     * @return tokenIn Returns the tokenIn
     */
    function encodeUseAllBalanceSwap(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 minAmountOut,
        uint8 wrapOp
    ) external view returns (address target, bytes memory callData, uint256 inputAmount, address) {
        // Determine which balance to query based on wrap operation
        uint256 actualBalance;
        if (wrapOp == 1) {
            // Will wrap ETH to WETH before swap, so query ETH balance
            actualBalance = msg.sender.balance;
        }

        callData = abi.encodeWithSignature(
            "swapSingleTokenExactIn(address,address,address,uint256,uint256,uint256,bool,bytes)",
            pool,
            tokenIn,
            tokenOut,
            actualBalance,
            minAmountOut,
            DEADLINE,
            false,  // wethIsEth
            "" // empty userData
        );

        return (ROUTER, callData, actualBalance, tokenIn);
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