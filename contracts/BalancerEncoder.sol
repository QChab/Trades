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

    struct BatchSwapStep {
        bytes32 poolId;
        uint256 assetInIndex;
        uint256 assetOutIndex;
        uint256 amount;
        bytes userData;
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
     * @notice Encode a batch swap for multiple pools
     * @param poolIds Array of pool IDs to route through
     * @param assets Array of token addresses involved in the swap
     * @param amountIn Amount of first asset to swap
     * @param minAmountOut Minimum acceptable output of last asset
     * @return target The Vault contract address
     * @return callData The encoded batchSwap call
     */
    function encodeBatchSwap(
        bytes32[] calldata poolIds,
        address[] calldata assets,
        uint256 amountIn,
        uint256 minAmountOut
    ) external view returns (address target, bytes memory callData) {
        require(poolIds.length > 0 && poolIds.length == assets.length - 1, "Invalid path");

        // Build swap steps
        BatchSwapStep[] memory swaps = new BatchSwapStep[](poolIds.length);

        // First swap uses the actual input amount
        swaps[0] = BatchSwapStep({
            poolId: poolIds[0],
            assetInIndex: 0,
            assetOutIndex: 1,
            amount: amountIn,
            userData: ""
        });

        // Subsequent swaps use 0 amount (use all received from previous)
        for (uint256 i = 1; i < poolIds.length; i++) {
            swaps[i] = BatchSwapStep({
                poolId: poolIds[i],
                assetInIndex: i,
                assetOutIndex: i + 1,
                amount: 0, // 0 means use all balance from previous swap
                userData: ""
            });
        }

        // Set limits for each asset
        int256[] memory limits = new int256[](assets.length);
        limits[0] = int256(amountIn); // Maximum we'll send
        for (uint256 i = 1; i < assets.length - 1; i++) {
            limits[i] = type(int256).max; // No limit on intermediate tokens
        }
        limits[assets.length - 1] = -int256(minAmountOut); // Minimum we'll receive (negative)

        FundManagement memory funds = FundManagement({
            sender: msg.sender,  // Always the calling WalletBundler
            fromInternalBalance: false,
            recipient: payable(msg.sender),  // Always the calling WalletBundler
            toInternalBalance: false
        });

        uint256 deadline = block.timestamp + 1200;

        callData = abi.encodeWithSignature(
            "batchSwap(uint8,(bytes32,uint256,uint256,uint256,bytes)[],address[],(address,bool,address,bool),int256[],uint256)",
            SwapKind.GIVEN_IN,
            swaps,
            assets,
            funds,
            limits,
            deadline
        );

        return (VAULT, callData);
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