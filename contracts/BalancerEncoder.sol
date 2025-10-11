// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title BalancerEncoder
 * @notice Encodes Balancer V3 swap calls dynamically based on actual amounts
 * @dev Stateless encoder that can be deployed once and used by all WalletBundler instances
 */
contract BalancerEncoder {
    // Balancer Vault address
    address private constant VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;

    enum SwapKind { GIVEN_IN, GIVEN_OUT }

    struct SingleSwap {
        bytes32 poolId;
        SwapKind kind;
        address assetIn;
        address assetOut;
        uint256 amount;
        bytes userData;
    }

    struct FundManagement {
        address sender;
        bool fromInternalBalance;
        address payable recipient;
        bool toInternalBalance;
    }

    /**
     * @notice Encode a single swap for Balancer
     * @param poolId The pool to swap through
     * @param tokenIn Address of input token
     * @param tokenOut Address of output token
     * @param amountIn Amount of input tokens (or type(uint256).max for "use all")
     * @param minAmountOut Minimum acceptable output
     * @return target The Vault contract address
     * @return callData The encoded swap call
     * @return inputAmount The actual amount to be used (for wrap/unwrap operations)
     * @return tokenIn The tokenIn address
     */
    function encodeSingleSwap(
        bytes32 poolId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external view returns (address target, bytes memory callData, uint256 inputAmount, address) {
        SingleSwap memory singleSwap = SingleSwap({
            poolId: poolId,
            kind: SwapKind.GIVEN_IN,
            assetIn: tokenIn,
            assetOut: tokenOut,
            amount: amountIn,
            userData: ""
        });

        FundManagement memory funds = FundManagement({
            sender: msg.sender,  // Always the calling WalletBundler
            fromInternalBalance: false,
            recipient: payable(msg.sender),  // Always the calling WalletBundler
            toInternalBalance: false
        });

        uint256 deadline = block.timestamp + 1200; // 20 minutes

        callData = abi.encodeWithSignature(
            "swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)",
            singleSwap,
            funds,
            minAmountOut,
            deadline
        );

        return (VAULT, callData, amountIn, tokenIn);
    }

    /**
     * @notice Encode a swap using all available balance
     * @dev Special function for intermediate hops that use entire balance
     * @param poolId The pool to swap through
     * @param tokenIn Address of input token
     * @param tokenOut Address of output token
     * @param minAmountOut Minimum acceptable output (can be 0 for intermediate)
     * @return target The Vault contract address
     * @return callData The encoded swap call with actual balance
     * @return inputAmount Returns the actual balance amount
     * @return tokenIn Returns the tokenIn
     */
    function encodeUseAllBalanceSwap(
        bytes32 poolId,
        address tokenIn,
        address tokenOut,
        uint256 minAmountOut
    ) external view returns (address target, bytes memory callData, uint256 inputAmount, address) {
        // Get the actual token balance using optimized assembly
        uint256 actualBalance = _getTokenBalance(tokenIn, msg.sender);

        SingleSwap memory singleSwap = SingleSwap({
            poolId: poolId,
            kind: SwapKind.GIVEN_IN,
            assetIn: tokenIn,
            assetOut: tokenOut,
            amount: actualBalance, // Use actual balance instead of max marker
            userData: ""
        });

        FundManagement memory funds = FundManagement({
            sender: msg.sender,  // Always the calling WalletBundler
            fromInternalBalance: false,
            recipient: payable(msg.sender),  // Always the calling WalletBundler
            toInternalBalance: false
        });

        uint256 deadline = block.timestamp + 1200;

        callData = abi.encodeWithSignature(
            "swap((bytes32,uint8,address,address,uint256,bytes),(address,bool,address,bool),uint256,uint256)",
            singleSwap,
            funds,
            minAmountOut,
            deadline
        );

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