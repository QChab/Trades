// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/**
 * @title WalletBundlerOptimized
 * @notice Gas-optimized standalone bundler contract for MEV-protected multi-DEX trading
 * @dev Deploy one instance per wallet for complete fund isolation
 */
contract WalletBundlerOptimized {
    address public immutable owner;
    address private immutable self;

    // Pack constants to save deployment gas
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address private constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    uint160 private constant MAX_ALLOWANCE = type(uint160).max;
    uint48 private constant EXPIRATION_OFFSET = 1577836800; // 50 years from 2020

    error Unauthorized();
    error InsufficientOutput();
    
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
     * @notice Execute trades with minimal gas overhead and wrap/unwrap support
     * @dev Optimized version with reduced operations and memory usage
     * @param inputAmounts Array of input amounts for wrap/unwrap operations
     * @param outputTokens Array of output tokens for each step (same length as targets)
     * @param wrapOperations Array indicating wrap/unwrap operations for each call:
     *        0 = no operation, 1 = wrap before, 2 = wrap after, 3 = unwrap before, 4 = unwrap after
     * @param minOutputAmount Minimum acceptable output amount for the final output
     */
    function execute(
        address fromToken,
        uint256 fromAmount,
        address[] calldata targets,
        bytes[] calldata data,
        uint256[] calldata values,
        uint256[] calldata inputAmounts,
        address[] calldata outputTokens,
        uint8[] calldata wrapOperations,
        uint256 minOutputAmount
    ) external payable auth returns (bool[] memory results) {
        uint256 targetsLength = targets.length;
        // Same length as data, values, inputAmounts, outputTokens, wrapOperations

        // Transfer input tokens if needed
        if (fromToken != address(0) && fromAmount != 0) {
            _transferFromToken(fromToken, owner, self, fromAmount);
        }
        // Note: If fromToken is address(0), ETH is already received via msg.value
        
        // Execute calls with minimal memory allocation and wrap/unwrap support
        results = new bool[](targetsLength);
        address finalOutputToken = outputTokens[targetsLength - 1];

        for (uint256 i; i < targetsLength;) {
            uint8 wrapOp = wrapOperations[i];
            uint256 inputAmount = inputAmounts[i];
            address stepOutputToken = outputTokens[i];

            // Handle unwrap before (3)
            if (wrapOp == 3) {
                _unwrapWETH(inputAmount);
            }
            // Handle wrap before (1)
            else if (wrapOp == 1) {
                _wrapETH(inputAmount);
            }

            // Track balance before for wrap/unwrap after operations
            uint256 balanceBefore;
            if (wrapOp == 2 || wrapOp == 4) {
                if (stepOutputToken == address(0)) {
                    balanceBefore = self.balance;
                } else if (stepOutputToken == WETH) {
                    balanceBefore = _getTokenBalance(WETH, self);
                }
            }

            (bool success,) = targets[i].call{value: values[i]}(data[i]);
            results[i] = success;

            // Handle wrap/unwrap after based on output amount
            if (wrapOp == 2 || wrapOp == 4) {
                uint256 outputAmount;

                if (wrapOp == 2) {
                    // Wrap after - calculate ETH output from trade
                    uint256 balanceAfter = self.balance;
                    if (balanceAfter > balanceBefore) {
                        outputAmount = balanceAfter - balanceBefore;
                        _wrapETH(outputAmount);
                    }
                } else if (wrapOp == 4) {
                    // Unwrap after - calculate WETH output from trade
                    uint256 balanceAfter = _getTokenBalance(WETH, self);
                    if (balanceAfter > balanceBefore) {
                        outputAmount = balanceAfter - balanceBefore;
                        _unwrapWETH(outputAmount);
                    }
                }
            }

            unchecked { ++i; }
        }

        // Check minimum output and transfer final output token
        if (finalOutputToken == address(0)) {
            // ETH transfer
            uint256 ethBalance = self.balance;
            if (ethBalance < minOutputAmount) revert InsufficientOutput();
            if (ethBalance > 0) {
                _sendETH(owner, ethBalance);
            }
        } else {
            // ERC20 transfer
            uint256 tokenBalance = _getTokenBalance(finalOutputToken, self);
            if (tokenBalance < minOutputAmount) revert InsufficientOutput();
            if (tokenBalance > 0) {
                _transferFromToken(finalOutputToken, self, owner, tokenBalance);
            }
        }

        // Return any remaining balances from intermediate output tokens
        for (uint256 i; i < targetsLength - 1;) {
            address token = outputTokens[i];
            // Skip if same as final output (already handled)
            if (token != finalOutputToken) {
                if (token == address(0)) {
                    // ETH - only if not already returned as final output
                    if (finalOutputToken != address(0)) {
                        uint256 ethBalance = self.balance;
                        if (ethBalance > 0) {
                            _sendETH(owner, ethBalance);
                        }
                    }
                } else {
                    // ERC20 token
                    uint256 balance = _getTokenBalance(token, self);
                    if (balance > 0) {
                        _transferFromToken(token, self, owner, balance);
                    }
                }
            }
            unchecked { ++i; }
        }

        // Return remaining input token
        if (fromToken == address(0)) {
            uint256 remainingEth = self.balance;
            if (remainingEth > 0) {
                _sendETH(owner, remainingEth);
            }
        } else {
            uint256 remainingBalance = _getTokenBalance(fromToken, self);
            if (remainingBalance > 0) {
                _transferFromToken(fromToken, self, owner, remainingBalance);
            }
        }
    }
    
    /**
     * @notice Batch approve with PERMIT2 support - gas optimized
     */
    function approve(
        address[] calldata tokens,
        address[] calldata spenders,
        address[] calldata permit2Spenders
    ) external auth {
        uint256 length = tokens.length;

        for (uint256 i; i < length;) {
            // Standard approval
            address token = tokens[i];
            address spender = spenders[i];
            assembly {
                let ptr := mload(0x40)
                // Store approve(address,uint256) selector
                mstore(ptr, 0x095ea7b300000000000000000000000000000000000000000000000000000000)
                mstore(add(ptr, 0x04), spender) // spender
                mstore(add(ptr, 0x24), 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff)  // amount
                
                let success := call(gas(), token, 0, ptr, 0x44, 0, 0)
                if iszero(success) { revert(0, 0) }
            }
            
            // PERMIT2 approval if needed
            address permit2Spender = permit2Spenders[i];
            if (spenders[i] == PERMIT2 && permit2Spender != address(0)) {
                // Use assembly for PERMIT2 approval with packed parameters
                assembly {
                    let ptr := mload(0x40)
                    mstore(ptr, 0x87517c4500000000000000000000000000000000000000000000000000000000) // approve selector
                    mstore(add(ptr, 0x04), token) // token
                    mstore(add(ptr, 0x24), permit2Spender) // spender
                    mstore(add(ptr, 0x44), 0xffffffffffffffffffffffffffffffffffffffff) // MAX_ALLOWANCE                    
                    mstore(add(ptr, 0x64), add(timestamp(), 1577836800)) // EXPIRATION_OFFSET
                    
                    let success := call(gas(), PERMIT2, 0, ptr, 0x84, 0, 0)
                    if iszero(success) { revert(0, 0) }
                }
            }
            
            unchecked { ++i; }
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

    receive() external payable {}
}