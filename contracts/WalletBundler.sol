// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
    function allowance(address owner, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce);
}

interface IBundlerRegistry {
    function registerBundler() external;
}

/**
 * @title WalletBundler
 * @notice Gas-optimized standalone bundler contract for MEV-protected multi-DEX trading
 * @dev Deploy one instance per wallet for complete fund isolation
 */
contract WalletBundler {
    address public immutable owner;
    address private immutable self;

    // Pack constants to save deployment gas
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address private constant UNISWAP_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90; // Uniswap V4
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
     * @dev Transfer ERC20 tokens from sender using standard Solidity with detailed errors
     * @param token Token contract address
     * @param from Sender address
     * @param to Recipient address
     * @param amount Amount to transfer
     */
    function _transferFromToken(address token, address from, address to, uint256 amount) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
        );
        require(success, "TransferFrom call failed");
        if (data.length > 0) {
            require(abi.decode(data, (bool)), "TransferFrom returned false");
        }
    }

    /**
     * @dev Transfer ERC20 tokens (contract's own tokens) with safe handling for non-standard tokens
     * @param token Token contract address
     * @param to Recipient address
     * @param amount Amount to transfer
     */
    function _transferToken(address token, address to, uint256 amount) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        require(success, "Transfer call failed");
        if (data.length > 0) {
            require(abi.decode(data, (bool)), "Transfer returned false");
        }
    }
    
    /**
     * @dev Get ERC20 token balance using standard Solidity
     * @param token Token contract address
     * @param account Account to check balance for
     * @return Token balance
     */
    function _getTokenBalance(address token, address account) private view returns (uint256) {
        return IERC20(token).balanceOf(account);
    }
    
    /**
     * @dev Send ETH using standard Solidity
     * @param to Recipient address
     * @param amount Amount to send
     */
    function _sendETH(address to, uint256 amount) private {
        (bool success, ) = to.call{value: amount}("");
        require(success, "ETH transfer failed");
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
     * @dev Wrap specific amount of ETH to WETH using standard Solidity
     * @param amount Amount of ETH to wrap
     */
    function _wrapETH(uint256 amount) private {
        IWETH(WETH).deposit{value: amount}();
    }

    /**
     * @dev Unwrap specific amount of WETH to ETH using standard Solidity
     * @param amount Amount of WETH to unwrap
     */
    function _unwrapWETH(uint256 amount) private {
        IWETH(WETH).withdraw(amount);
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

                // Two-step approval process:
                // Step 1: Token → Permit2 (standard ERC20 approval)
                // Step 2: Permit2 → Protocol (Permit2's internal approval)
                address permit2Spender = target;
                //  == BALANCER_ROUTER ? BALANCER_VAULT : UNISWAP_POOL_MANAGER;

                // Check if Token is approved to Permit2
                uint256 tokenAllowance = _getAllowance(tokenIn, PERMIT2);
                if (tokenAllowance < APPROVAL_THRESHOLD) {
                    _approve(tokenIn, PERMIT2);  // Token → Permit2 (max uint256)
                }

                // Check if Permit2 has approved the protocol
                (uint160 permit2Allowance, , ) = IPermit2(PERMIT2).allowance(self, tokenIn, permit2Spender);
                if (permit2Allowance < APPROVAL_THRESHOLD) {
                    _approvePermit2(tokenIn, permit2Spender);  // Permit2 → Protocol (max uint160)
                }
            }

            // ----------------
            // Execute the swap and capture return value
            // ----------------
            uint256 callValue = tokenIn == address(0) ? inputAmount : 0;
            (bool success, bytes memory returnData) = target.call{value: callValue}(callData);

            if (!success) {
                // Decode revert reason if available
                if (returnData.length > 0) {
                    assembly {
                        let returndata_size := mload(returnData)
                        revert(add(32, returnData), returndata_size)
                    }
                } else {
                    revert CallFailed();
                }
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
        (bool success, bytes memory result) = encoder.staticcall(data);
        if (!success) revert CallFailed();
        (target, callData, inputAmount, tokenIn) = abi.decode(result, (address, bytes, uint256, address));
    }

    /**
     * @dev Check ERC20 allowance using standard Solidity
     */
    function _getAllowance(address token, address spender) private view returns (uint256) {
        return IERC20(token).allowance(self, spender);
    }

    /**
     * @dev Approve ERC20 spending with safe handling for non-standard tokens (USDC, USDT)
     */
    function _approve(address token, address spender) private {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.approve.selector, spender, type(uint256).max)
        );
        require(success, "Approve call failed");
        if (data.length > 0) {
            require(abi.decode(data, (bool)), "Approve returned false");
        }
    }

    /**
     * @dev Approve Permit2 spending using standard Solidity interface
     * @param token Token to approve
     * @param spender Spender address (Vault for Balancer, Router for Uniswap)
     */
    function _approvePermit2(address token, address spender) private {
        IPermit2(PERMIT2).approve(token, spender, type(uint160).max, EXPIRATION_OFFSET);
    }

    receive() external payable {}
}