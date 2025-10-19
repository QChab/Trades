// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IBundlerRegistry {
    function registerBundler() external;
}

interface IUnlockCallback {
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}

interface IPoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(
        PoolKey memory key,
        SwapParams memory params,
        bytes calldata hookData
    ) external returns (int256); // Returns BalanceDelta (packed int256)
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
}

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

/**
 * @title WalletBundler
 * @notice Gas-optimized standalone bundler contract for MEV-protected multi-DEX trading
 * @dev Deploy one instance per wallet for complete fund isolation
 */
contract WalletBundler is IUnlockCallback {
    address public immutable owner;
    address private immutable self;

    // Pack constants to save deployment gas
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address private constant POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90; // Uniswap V4
    address private constant UNIVERSAL_ROUTER = 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af; // Uniswap V4
    address private constant BALANCER_ROUTER = 0xAE563E3f8219521950555F5962419C8919758Ea2; // Balancer V3 Router
    address private constant BALANCER_VAULT = 0xbA1333333333a1BA1108E8412f11850A5C319bA9; // Balancer V3 Vault
    address private constant BUNDLER_REGISTRY = 0x4df4B688d6F7954F6F53787B2e2778720BaB5d28; // Well-known registry
    uint48 private constant EXPIRATION_OFFSET = 281474976710655; // MAx uint48
    uint256 private constant APPROVAL_THRESHOLD = 1e45; // Gas-optimized approval check threshold

    error Unauthorized();
    error CallFailed();

    modifier auth() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
        self = address(this);

        // Register this bundler in the registry, only works if no bundler registered for the user
        IBundlerRegistry(BUNDLER_REGISTRY).registerBundler();
    }
    
    /**
     * @dev Internal assembly function to transfer ERC20 tokens from sender
     * @param token Token contract address
     * @param from Sender address
     * @param to Recipient address
     * @param amount Amount to transfer
     */
    function _transferFromToken(address token, address from, address to, uint256 amount) private {
        assembly {
            let ptr := mload(0x40)
            // Store transferFrom(address,address,uint256) selector
            mstore(ptr, 0x23b872dd00000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), from)   // sender
            mstore(add(ptr, 0x24), to)     // recipient
            mstore(add(ptr, 0x44), amount) // amount

            let success := call(gas(), token, 0, ptr, 0x64, ptr, 0x20)
            if iszero(success) { revert(0, 0) }

            // Check return value (some tokens return false instead of reverting)
            let returnValue := mload(ptr)
            if iszero(returnValue) { revert(0, 0) }
        }
    }

    /**
     * @dev Internal assembly function to transfer ERC20 tokens (contract's own tokens)
     * @param token Token contract address
     * @param to Recipient address
     * @param amount Amount to transfer
     */
    function _transferToken(address token, address to, uint256 amount) private {
        assembly {
            let ptr := mload(0x40)
            // Store transfer(address,uint256) selector
            mstore(ptr, 0xa9059cbb00000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), to)     // recipient
            mstore(add(ptr, 0x24), amount) // amount

            let success := call(gas(), token, 0, ptr, 0x44, ptr, 0x20)
            if iszero(success) { revert(0, 0) }

            // Check return value (some tokens return false instead of reverting)
            let returnValue := mload(ptr)
            if iszero(returnValue) { revert(0, 0) }
        }
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
    
    /**
     * @dev Internal assembly function to send ETH
     * @param to Recipient address
     * @param amount Amount to send
     */
    function _sendETH(address to, uint256 amount) private {
        assembly {
            let success := call(gas(), to, amount, 0, 0, 0, 0)
            if iszero(success) { revert(0, 0) }
        }
    }
    
    /**
     * @notice Emergency withdraw - minimal implementation
     */
    function withdraw(address token) external auth {
        if (token == address(0)) {
            _sendETH(owner, self.balance);
        } else {
            _transferToken(token, owner, _getTokenBalance(token, self));
        }
    }
    
    /**
     * @dev Wrap specific amount of ETH to WETH
     * @param amount Amount of ETH to wrap (0 means wrap all)
     */
    function _wrapETH(uint256 amount) private {
        assembly {
            let ptr := mload(0x40)
            // Store deposit() selector
            mstore(ptr, 0xd0e30db000000000000000000000000000000000000000000000000000000000)
            let success := call(gas(), WETH, amount, ptr, 0x04, 0, 0)
            if iszero(success) { revert(0, 0) }
        }
    }

    /**
     * @dev Unwrap specific amount of WETH to ETH
     * @param amount Amount of WETH to unwrap (0 means unwrap all)
     */
    function _unwrapWETH(uint256 amount) private {
        assembly {
            let ptr := mload(0x40)
            // Store withdraw(uint256) selector
            mstore(ptr, 0x2e1a7d4d00000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), amount)
            let success := call(gas(), WETH, 0, ptr, 0x24, 0, 0)
            if iszero(success) { revert(0, 0) }
        }
    }

    /**
     * @notice Execute trades with dynamic encoding for slippage handling
     * @dev Uses encoder contracts to build calldata based on actual amounts
     * @param fromToken Input token address (0x0 for ETH)
     * @param fromAmount Input amount
     * @param toToken Expected output token address (0x0 for ETH)
     * @param encoderTargets Array of encoder contract addresses
     * @param encoderData Array of calldata for encoder contracts
     * @param wrapOperations Array of wrap/unwrap operations
     */
    function encodeAndExecuteaaaaaYops(
        address fromToken,
        uint256 fromAmount,
        address toToken,
        address[] calldata encoderTargets,
        bytes[] calldata encoderData,
        uint8[] calldata wrapOperations
    ) external payable auth returns (bool[] memory results) {
        uint256 stepsLength = encoderTargets.length;

        // Transfer input tokens if needed
        if (fromToken != address(0)) {
            _transferFromToken(fromToken, owner, self, fromAmount);
        }
        // Note: If fromToken is address(0), ETH is already received via msg.value

        results = new bool[](stepsLength);
        uint256 i;

        for (; i < stepsLength;) {
            uint8 wrapOp = wrapOperations[i];

            // Call encoder to get target, calldata, input amount, and input token
            (address target, bytes memory callData, uint256 inputAmount, address tokenIn) = _callEncoder(encoderTargets[i], encoderData[i]);


            // Handle wrap/unwrap before (for output token conversions)
            if (wrapOp == 1) {
                // Wrap ETH to WETH before - use exact amount from encoder
                _wrapETH(inputAmount);
            } else if (wrapOp == 3) {
                // Unwrap WETH to ETH before - use exact amount from encoder
                _unwrapWETH(inputAmount);
            }

            // Ensure we have enough tokenIn by converting ETH<->WETH if needed
            if (tokenIn == address(0)) {
                // Step needs ETH - check if we have enough
                uint256 ethBalance = self.balance;
                if (ethBalance < inputAmount) {
                    // Not enough ETH, unwrap the shortfall from WETH
                    uint256 shortfall;
                    unchecked {
                        shortfall = inputAmount - ethBalance;
                    }
                    _unwrapWETH(shortfall);
                }
            } else if (tokenIn == WETH) {
                // Step needs WETH - check if we have enough
                uint256 wethBalance = _getTokenBalance(WETH, self);
                if (wethBalance < inputAmount) {
                    // Not enough WETH, wrap the shortfall from ETH
                    uint256 shortfall;
                    unchecked {
                        shortfall = inputAmount - wethBalance;
                    }
                    _wrapETH(shortfall);
                }
            }
            
            // ---------------------------------------
            // Ensure approval for the input token to the target protocol
            // ----------------------------------------------------------
            if (tokenIn != address(0)) {
                // Both Uniswap V4 and Balancer V3 use Permit2 approval system
                // Smart contracts can call approve() but cannot sign permit messages

                // Uniswap: Universal Router pulls tokens via Permit2
                // Balancer: Vault pulls tokens via Permit2 (not Router!)
                address permit2Spender = target == UNIVERSAL_ROUTER ? POOL_MANAGER : target;

                uint256 permit2Allowance;
                address contractAddr = self;
                assembly {
                    let ptr := mload(0x40)
                    // Store allowance(address,address,address) selector
                    mstore(ptr, 0x927da10500000000000000000000000000000000000000000000000000000000)
                    mstore(add(ptr, 0x04), contractAddr)  // owner (this contract)
                    mstore(add(ptr, 0x24), tokenIn)       // tokenIn
                    mstore(add(ptr, 0x44), permit2Spender) // spender

                    // Use separate memory location for output (ptr + 0x80 = 128 bytes after input)
                    let outPtr := add(ptr, 0x80)
                    let success := staticcall(gas(), PERMIT2, ptr, 0x64, outPtr, 0x60)
                    if success {
                        permit2Allowance := mload(outPtr) // First return value is uint160 amount
                    }
                }

                if (permit2Allowance < APPROVAL_THRESHOLD) {
                    // Approve both Token→Permit2 and Permit2→Spender
                    if (_getAllowance(tokenIn, PERMIT2) < APPROVAL_THRESHOLD)
                        _approve(tokenIn, PERMIT2);  // Token → Permit2 (max uint256, never decrements)

                    // Approve Permit2 → Spender (uint160 max, does decrement)
                    assembly {
                        let ptr := mload(0x40)
                        // Store approve(address,address,uint160,uint48) selector
                        mstore(ptr, 0x87517c4500000000000000000000000000000000000000000000000000000000)
                        mstore(add(ptr, 0x04), tokenIn)                // tokenIn
                        mstore(add(ptr, 0x24), permit2Spender)         // spender (Vault for Balancer, Router for Uniswap)
                        mstore(add(ptr, 0x44), 0xffffffffffffffffffffffffffffffff) // max uint160
                        mstore(add(ptr, 0x64), EXPIRATION_OFFSET) // expiration

                        let success := call(gas(), PERMIT2, 0, ptr, 0x84, 0, 0)
                        if iszero(success) { revert(0, 0) }
                    }
                }
            }

            // ----------------
            // Execute the swap - route through PoolManager if Universal Router
            // ----------------
            bool success;
            bytes memory returnData;

            if (target == UNIVERSAL_ROUTER) {
                // For Uniswap V4, callData is already in unlock callback format
                // JS encodes it directly - just pass through to unlock!
                // UniswapEncoder.sol handles useAllBalance internally
                // Zero decode/re-encode overhead = maximum gas savings

                bytes memory result = IPoolManager(POOL_MANAGER).unlock(callData);
                uint256 swapOutput = abi.decode(result, (uint256));

                returnData = abi.encode(swapOutput);
                success = true;
            } else {
                // For other targets (Balancer, etc.), use direct call
                uint256 callValue = tokenIn == address(0) ? inputAmount : 0;
                (success, returnData) = target.call{value: callValue}(callData);
                if (!success) revert CallFailed();
            }

            results[i] = success;

            // Decode the output amount from return data
            uint256 outputAmount;
            if (returnData.length >= 32) {
                assembly {
                    outputAmount := mload(add(returnData, 0x20))
                }
            }

            // Handle wrap/unwrap after based on actual output amount
            if (wrapOp == 2) {
                // Wrap after - wrap the exact ETH output amount
                _wrapETH(outputAmount);
            } else if (wrapOp == 4) {
                // Unwrap after - unwrap the exact WETH output amount
                _unwrapWETH(outputAmount);
            }

            unchecked { ++i; }
        }

        // Send the toToken back to owner
        if (toToken == address(0)) {
            _sendETH(owner, self.balance);
        } else {
            _transferToken(toToken, owner, _getTokenBalance(toToken, self));
        }
    }

    /**
     * @dev Call encoder contract to get target, calldata, and input amount
     */
    function _callEncoder(address encoder, bytes calldata data) private view returns (address target, bytes memory callData, uint256 inputAmount, address tokenIn) {
        if (encoder == address(0)) {
            // For Uniswap exact amount: data is already unlock callback format (encoded in JS)
            // Format: (tokenIn, tokenOut, poolKey, swapParams, minAmountOut)
            // Extract tokenIn and inputAmount from the encoded data

            // Decode to extract needed info
            (address _tokenIn, , , SwapParams memory swapParams, ) = abi.decode(
                data,
                (address, address, PoolKey, SwapParams, uint256)
            );

            tokenIn = _tokenIn;
            inputAmount = uint256(-swapParams.amountSpecified);  // Convert back to positive
            target = UNIVERSAL_ROUTER;  // Flag for Uniswap
            callData = data;  // Use data as-is for unlock
        } else {
            // For USE_ALL or other encoders: call encoder contract
            (bool success, bytes memory result) = encoder.staticcall(data);
            if (!success) revert CallFailed();
            (target, callData, inputAmount, tokenIn) = abi.decode(result, (address, bytes, uint256, address));
        }
    }

    /**
     * @dev Check ERC20 allowance
     */
    function _getAllowance(address token, address spender) private view returns (uint256 allowance) {
        address contractAddr = self;
        assembly {
            let ptr := mload(0x40)
            // Store allowance(address,address) selector
            mstore(ptr, 0xdd62ed3e00000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), contractAddr) // owner (this contract)
            mstore(add(ptr, 0x24), spender)   // spender

            // Use separate memory location for output
            let outPtr := add(ptr, 0x60)
            let success := staticcall(gas(), token, ptr, 0x44, outPtr, 0x20)
            if success {
                allowance := mload(outPtr)
            }
        }
    }

    /**
     * @dev Approve ERC20 spending
     */
    function _approve(address token, address spender) private {
        assembly {
            let ptr := mload(0x40)
            // Store approve(address,uint256) selector
            mstore(ptr, 0x095ea7b300000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), spender)
            mstore(add(ptr, 0x24), 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff) // max uint256

            let success := call(gas(), token, 0, ptr, 0x44, 0, 0)
            if iszero(success) { revert(0, 0) }
        }
    }

    /**
     * @notice Unlock callback implementation for direct PoolManager swaps
     * @dev Only callable by PoolManager during unlock flow
     * @param data Encoded swap parameters from swapDirectV4
     */
        /**
     * @notice Unlock callback - CORRECT FLOW
     */
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == POOL_MANAGER, "Only PoolManager");

        (
            address tokenIn,
            address tokenOut,
            PoolKey memory poolKey,
            SwapParams memory swapParams,
            uint256 minAmountOut
        ) = abi.decode(data, (address, address, PoolKey, SwapParams, uint256));

        // STEP 1: Execute swap (this creates deltas)
        // swap() returns a single BalanceDelta (int256) where:
        // - upper 128 bits = delta0 (currency0 delta)
        // - lower 128 bits = delta1 (currency1 delta)
        int256 balanceDelta = IPoolManager(POOL_MANAGER).swap(
            poolKey,
            swapParams,
            "" // no hook data
        );

        // Unpack the BalanceDelta
        int128 delta0 = int128(balanceDelta >> 128);
        int128 delta1 = int128(balanceDelta);

        // STEP 2: Settle input token (pay our debt)
        uint256 amountToSettle = swapParams.zeroForOne ? uint256(int256(-delta0)) : uint256(int256(-delta1));

        if (tokenIn == address(0)) {
            // For native ETH
            IPoolManager(POOL_MANAGER).settle{value: amountToSettle}();
        } else {
            // For ERC20:
            // a) Sync to establish the "before" balance baseline
            IPoolManager(POOL_MANAGER).sync(tokenIn);

            // b) Transfer tokens to PoolManager (changes the balance)
            _transferToken(tokenIn, POOL_MANAGER, amountToSettle);

            // c) Settle - compares current balance vs baseline from sync
            IPoolManager(POOL_MANAGER).settle();
        }

        // STEP 3: Take output tokens (collect our credit)
        uint256 amountOut = swapParams.zeroForOne ? uint256(int256(delta1)) : uint256(int256(delta0));

        IPoolManager(POOL_MANAGER).take(tokenOut, self, amountOut);

        // Validate minimum output
        require(amountOut >= minAmountOut, "Insufficient output");

        // Return output amount
        return abi.encode(amountOut);
    }

    receive() external payable {}
}