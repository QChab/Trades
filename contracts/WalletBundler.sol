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
    uint160 private constant MAX_ALLOWANCE = type(uint160).max;
    uint48 private constant EXPIRATION_OFFSET = 1577836800; // 50 years from 2020
    
    error Unauthorized();
    error InvalidLength();
    error CallFailed();
    error TransferFailed();
    
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
     * @notice Execute trades with minimal gas overhead
     * @dev Optimized version with reduced operations and memory usage
     */
    function execute(
        address fromToken,
        uint256 fromAmount,
        address[] calldata targets,
        bytes[] calldata data,
        uint256[] calldata values,
        address[] calldata outputTokens
    ) external payable auth returns (bool[] memory results) {
        uint256 targetsLength = targets.length;
        if (targetsLength != data.length || targetsLength != values.length) revert InvalidLength();
        
        // Transfer input tokens if needed
        if (fromToken != address(0) && fromAmount != 0) {
            _transferFromToken(fromToken, owner, self, fromAmount);
        }
        
        // Execute calls with minimal memory allocation
        results = new bool[](targetsLength);
        for (uint256 i; i < targetsLength;) {
            (bool success,) = targets[i].call{value: values[i]}(data[i]);
            results[i] = success;
            unchecked { ++i; }
        }
        
        // Return tokens with optimized balance checks
        uint256 outputLength = outputTokens.length;
        for (uint256 i; i < outputLength;) {
            address token = outputTokens[i];
            if (token == address(0)) {
                // ETH transfer
                uint256 balance = self.balance;
                if (balance != 0) {
                    _sendETH(owner, balance);
                }
            } else {
                // ERC20 transfer
                uint256 balance = _getTokenBalance(token, self);
                if (balance > 0) {
                    _transferFromToken(token, self, owner, balance);
                }
            }
            unchecked { ++i; }
        }
        
        // Return remaining input token if different from outputs
        if (fromToken != address(0)) {
            uint256 balance = _getTokenBalance(fromToken, self);
            if (balance > 0) {
                _transferFromToken(fromToken, self, owner, balance);
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
        if (length != spenders.length || length != permit2Spenders.length) {
            revert InvalidLength();
        }
        
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
    function withdraw(address token, uint256 amount) external auth {
        if (token == address(0)) {
            uint256 balance = amount == 0 ? self.balance : amount;
            _sendETH(owner, balance);
        } else {
            uint256 balance = _getTokenBalance(token, self);
            uint256 withdrawAmount = amount == 0 ? balance : amount;
            if (withdrawAmount > balance) revert TransferFailed();
            
            _transferFromToken(token, self, owner, withdrawAmount);
        }
    }
    
    receive() external payable {}
}