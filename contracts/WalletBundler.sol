// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
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
    address private constant UNIVERSAL_ROUTER = 0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af; // Uniswap V4
    address private constant BALANCER_VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8; // Balancer V3
    uint48 private constant EXPIRATION_OFFSET = 1577836800; // 50 years from 2020

    error Unauthorized();
    error CallFailed();

    modifier auth() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }
    
    constructor() {
        owner = msg.sender;
        self = address(this);
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
            _transferFromToken(token, self, owner, _getTokenBalance(token, self));
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
    function encodeAndExecute(
        address fromToken,
        uint256 fromAmount,
        address toToken,
        address[] calldata encoderTargets,
        bytes[] calldata encoderData,
        uint8[] calldata wrapOperations
    ) external payable auth returns (bool[] memory results) {
        uint256 stepsLength = encoderTargets.length;

        // Transfer input tokens if needed
        if (fromToken != address(0) && fromAmount != 0) {
            _transferFromToken(fromToken, owner, self, fromAmount);
        }
        // Note: If fromToken is address(0), ETH is already received via msg.value

        results = new bool[](stepsLength);
        uint256 i;

        for (; i < stepsLength;) {
            uint8 wrapOp = wrapOperations[i];

            // Call encoder to get target, calldata, input amount, and input token
            (address target, bytes memory callData, uint256 inputAmount, address tokenIn) = _callEncoder(encoderTargets[i], encoderData[i]);

            // Handle wrap/unwrap before
            if (wrapOp == 1) {
                // Wrap ETH to WETH before - use exact amount from encoder
                _wrapETH(inputAmount);
            } else if (wrapOp == 3) {
                // Unwrap WETH to ETH before - use exact amount from encoder
                _unwrapWETH(inputAmount);
            }

            // ----------------------------------------------------------
            // Ensure approval for the input token to the target protocol
            // ----------------------------------------------------------
            if (tokenIn != address(0)) {
                if (target == UNIVERSAL_ROUTER) {
                    // Uniswap uses Permit2: Need two approvals
                    // Step 1: Check if token is approved to Permit2
                    uint256 tokenToPermit2Allowance = _getAllowance(tokenIn, PERMIT2);
                    if (tokenToPermit2Allowance < 1000000000000000000000000000000000000000000000) {
                        _approve(tokenIn, PERMIT2);  // Token → Permit2
                    }

                    // Step 2: Check if Permit2 has approved Universal Router (inline for gas savings)
                    uint256 permit2Allowance;
                    assembly {
                        let ptr := mload(0x40)
                        // Store allowance(address,address,address) selector
                        mstore(ptr, 0x927da10500000000000000000000000000000000000000000000000000000000)
                        mstore(add(ptr, 0x04), address()) // owner (this contract)
                        mstore(add(ptr, 0x24), tokenIn)     // tokenIn
                        mstore(add(ptr, 0x44), UNIVERSAL_ROUTER) // spender

                        let success := staticcall(gas(), PERMIT2, ptr, 0x64, ptr, 0x60)
                        if success {
                            permit2Allowance := mload(ptr) // First return value is uint160 amount
                        }
                    }

                    if (permit2Allowance < 1000000000000000000000000000000000000000000000) {
                        // Approve via Permit2
                        assembly {
                            let ptr := mload(0x40)
                            // Store approve(address,address,uint160,uint48) selector
                            mstore(ptr, 0x87517c4500000000000000000000000000000000000000000000000000000000)
                            mstore(add(ptr, 0x04), tokenIn)                // tokenIn
                            mstore(add(ptr, 0x24), UNIVERSAL_ROUTER)     // spender
                            mstore(add(ptr, 0x44), 0xffffffffffffffffffffffffffffffff) // max uint160
                            mstore(add(ptr, 0x64), add(timestamp(), EXPIRATION_OFFSET)) // expiration

                            let success := call(gas(), PERMIT2, 0, ptr, 0x84, 0, 0)
                            if iszero(success) { revert(0, 0) }
                        }
                    }
                } else if (target == BALANCER_VAULT) {
                    // Balancer: Check direct allowance
                    uint256 directAllowance = _getAllowance(tokenIn, BALANCER_VAULT);
                    if (directAllowance < 1000000000000000000000000000000000000000000000) {
                        _approve(tokenIn, BALANCER_VAULT);
                    }
                }
            }

            // ----------------
            // Execute the swap and capture return value
            // ----------------
            (bool success, bytes memory returnData) = target.call{value: 0}(callData);
            results[i] = success;
            if (!success) revert CallFailed();

            // Decode the output amount from return data
            uint256 outputAmount;
            if (returnData.length >= 32) {
                assembly {
                    outputAmount := mload(add(returnData, 0x20))
                }
            }

            // Handle wrap/unwrap after based on actual output amount
            if (wrapOp == 2 && outputAmount > 0) {
                // Wrap after - wrap the exact ETH output amount
                _wrapETH(outputAmount);
            } else if (wrapOp == 4 && outputAmount > 0) {
                // Unwrap after - unwrap the exact WETH output amount
                _unwrapWETH(outputAmount);
            }

            unchecked { ++i; }
        }

        // Send the toToken back to owner
        if (toToken == address(0)) {
            _sendETH(owner, self.balance);
        } else {
            _transferFromToken(toToken, self, owner, _getTokenBalance(toToken, self));
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
     * @dev Check ERC20 allowance
     */
    function _getAllowance(address token, address spender) private view returns (uint256 allowance) {
        assembly {
            let ptr := mload(0x40)
            // Store allowance(address,address) selector
            mstore(ptr, 0xdd62ed3e00000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), address()) // owner (this contract)
            mstore(add(ptr, 0x24), spender)   // spender

            let success := staticcall(gas(), token, ptr, 0x44, ptr, 0x20)
            if success {
                allowance := mload(ptr)
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

    receive() external payable {}
}