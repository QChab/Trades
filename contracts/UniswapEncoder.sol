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
    address private constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2; // Gas optimization: constant WETH
    uint48 private constant EXPIRATION_OFFSET = 281474976710655; // Max uint48

    // Command code for Universal Router V4 swaps
    bytes private constant COMMANDS = hex"10";  // V4_SWAP command

    // V4 Action codes - hardcoded as constant bytes
    // [SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL] = [0x06, 0x0c, 0x0f]
    // NOTE: For pre-transfer approach, we only use SWAP and TAKE (no SETTLE needed)
    bytes private constant ACTIONS = hex"060f";  // SWAP + TAKE_ALL only
    bytes private constant ACTIONS_WITH_SETTLE = hex"060c0f";  // Legacy: SWAP + SETTLE_ALL + TAKE_ALL

    // Empty hookData (used in all swaps)
    bytes private constant EMPTY_HOOK_DATA = hex"";

    // V4 PoolKey structure
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    // Swap parameters for single swap
    struct SingleSwapParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint256 amountIn;
        uint256 minAmountOut;
        address tokenIn;
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
     * @notice Encode a single swap on Uniswap V4
     * @param swapParams Struct containing all swap parameters
     * @return target The Universal Router address
     * @return callData The encoded V4 swap call
     * @return inputAmount The actual amount to be used
     * @return _tokenIn The tokenIn address (echo back)
     */
    function encodeSingleSwap(
        SingleSwapParams calldata swapParams
    ) external view returns (address target, bytes memory callData, uint256 inputAmount, address _tokenIn) {
        // Build params array - only 2 params now (SWAP + TAKE, no SETTLE)
        bytes[] memory params = new bytes[](2);

        // Param 0: Swap parameters
        params[0] = abi.encode(
            swapParams.poolKey,
            swapParams.zeroForOne,
            uint128(swapParams.amountIn),
            uint128(swapParams.minAmountOut),
            EMPTY_HOOK_DATA
        );

        // Param 1: TAKE_ALL - currency and minAmount to send
        address currencyOut = swapParams.zeroForOne ? swapParams.poolKey.currency1 : swapParams.poolKey.currency0;
        params[1] = abi.encode(currencyOut, swapParams.minAmountOut);

        // Encode inputs as [actions, params]
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(ACTIONS, params);

        callData = abi.encodeWithSignature(
            "execute(bytes,bytes[],uint256)",
            COMMANDS,
            inputs,
            EXPIRATION_OFFSET
        );

        return (UNIVERSAL_ROUTER, callData, swapParams.amountIn, swapParams.tokenIn);
    }

    /**
     * @notice Encode a swap using all available balance (V4)
     * @dev For intermediate hops that should use entire balance
     * @param swapParams Struct containing all swap parameters
     * @return target The Universal Router address
     * @return callData The encoded swap with actual balance
     * @return inputAmount Returns the actual balance amount
     * @return _tokenIn The tokenIn address
     */
    function encodeUseAllBalanceSwap(
        UseAllBalanceParams calldata swapParams
    ) external view returns (address target, bytes memory callData, uint256 inputAmount, address _tokenIn) {
        // Determine which balance to query based on wrap operation
        address balanceToken = swapParams.tokenIn;
        if (swapParams.wrapOp == 1) {
            // Will wrap ETH to WETH before swap, so query ETH balance
            balanceToken = address(0);
        } else if (swapParams.wrapOp == 3) {
            // Will unwrap WETH to ETH before swap, so query WETH balance
            balanceToken = WETH; // Gas optimization: use constant
        }

        // Get the actual balance (ETH or token)
        uint256 actualBalance = balanceToken == address(0)
            ? msg.sender.balance
            : _getTokenBalance(balanceToken, msg.sender);

        // Build params array
        bytes[] memory params = new bytes[](3);

        // Param 0: Swap parameters
        params[0] = abi.encode(
            swapParams.poolKey,
            swapParams.zeroForOne,
            uint128(actualBalance),
            uint128(swapParams.minAmountOut),
            EMPTY_HOOK_DATA
        );

        // Param 1: SETTLE_ALL - currency and amount to pull
        params[1] = abi.encode(balanceToken, actualBalance);

        // Param 2: TAKE_ALL - currency and minAmount to send
        address currencyOut = swapParams.zeroForOne ? swapParams.poolKey.currency1 : swapParams.poolKey.currency0;
        // Gas optimization: removed redundant if check (currencyOut is already set correctly)
        params[2] = abi.encode(currencyOut, swapParams.minAmountOut);

        // Encode inputs as [actions, params]
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(ACTIONS, params);

        callData = abi.encodeWithSignature(
            "execute(bytes,bytes[],uint256)",
            COMMANDS,
            inputs,
            EXPIRATION_OFFSET
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