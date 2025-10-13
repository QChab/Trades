// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title BalancerEncoder
 * @notice Encodes Balancer V3 swap calls via direct Vault.unlock()
 * @dev Stateless encoder that can be deployed once and used by all WalletBundler instances
 *      Bypasses Router for gas optimization (~14k gas saved per swap)
 */

contract BalancerEncoder {
    // Balancer V3 Vault address
    address private constant VAULT = 0xbA1333333333a1BA1108E8412f11850A5C319bA9;

    // Pre-computed selector for unlock(bytes) - saves ~300 gas vs abi.encodeWithSignature
    bytes4 private constant UNLOCK_SELECTOR = 0x2f9e6f5b;

    /**
     * @notice Encode a single swap for Balancer V3 via direct Vault.unlock()
     * @param pool The pool address to swap through
     * @param tokenIn Address of input token
     * @param tokenOut Address of output token
     * @param amountIn Amount of input tokens
     * @param minAmountOut Minimum acceptable output
     * @return target The Vault contract address
     * @return callData The encoded unlock call with swap data
     * @return inputAmount The actual amount to be used
     * @return _tokenIn The tokenIn address
     */
    function encodeSingleSwap(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external pure returns (address target, bytes memory callData, uint256 inputAmount, address _tokenIn) {

        // Encode swap data for unlock callback
        bytes memory unlockData = abi.encode(pool, tokenIn, tokenOut, amountIn, minAmountOut);

        // Encode Vault.unlock(bytes) call with pre-computed selector
        callData = abi.encodeWithSelector(UNLOCK_SELECTOR, unlockData);

        return (VAULT, callData, amountIn, tokenIn);
    }

    /**
     * @notice Encode a swap using all available balance via direct Vault.unlock()
     * @dev Special function for intermediate hops that use entire balance
     * @param pool The pool address to swap through
     * @param tokenIn Address of input token
     * @param tokenOut Address of output token
     * @param minAmountOut Minimum acceptable output (can be 0 for intermediate)
     * @param wrapOp Wrap operation: 0=none, 1=wrap ETH before, 3=unwrap WETH before
     * @return target The Vault contract address
     * @return callData The encoded unlock call with actual balance
     * @return inputAmount Returns the actual balance amount
     * @return _tokenIn Returns the tokenIn
     */
    function encodeUseAllBalanceSwap(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 minAmountOut,
        uint8 wrapOp
    ) external view returns (address target, bytes memory callData, uint256 inputAmount, address _tokenIn) {
        // Determine which balance to query based on wrap operation
        uint256 actualBalance;
        if (wrapOp == 1) {
            // Will wrap ETH to WETH before swap, so query ETH balance
            actualBalance = msg.sender.balance;
        } else {
            actualBalance = _getTokenBalance(tokenIn, msg.sender);
        }

        // Encode swap data for unlock callback
        bytes memory unlockData = abi.encode(pool, tokenIn, tokenOut, actualBalance, minAmountOut);

        // Encode Vault.unlock(bytes) call with pre-computed selector
        callData = abi.encodeWithSelector(UNLOCK_SELECTOR, unlockData);

        return (VAULT, callData, actualBalance, tokenIn);
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