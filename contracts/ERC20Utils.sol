// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title ERC20Utils
 * @notice Shared library contract with optimized ERC20 operations
 * @dev Deploy once, use across multiple WalletBundler contracts
 */
contract ERC20Utils {
    
    error TransferFailed();
    error CallFailed();
    
    /**
     * @notice Transfer ERC20 tokens
     * @param token Token contract address
     * @param to Recipient address
     * @param amount Amount to transfer
     */
    function transferToken(address token, address to, uint256 amount) external {
        assembly {
            let ptr := mload(0x40)
            // Store transfer(address,uint256) selector
            mstore(ptr, 0xa9059cbb00000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), to)     // recipient
            mstore(add(ptr, 0x24), amount) // amount
            
            let success := call(gas(), token, 0, ptr, 0x44, 0, 0)
            if iszero(success) { 
                // Revert with TransferFailed()
                mstore(0, 0x90b8ec1800000000000000000000000000000000000000000000000000000000)
                revert(0, 4)
            }
        }
    }
    
    /**
     * @notice Transfer ERC20 tokens from sender
     * @param token Token contract address
     * @param from Sender address
     * @param to Recipient address
     * @param amount Amount to transfer
     */
    function transferFromToken(address token, address from, address to, uint256 amount) external {
        assembly {
            let ptr := mload(0x40)
            // Store transferFrom(address,address,uint256) selector
            mstore(ptr, 0x23b872dd00000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), from)   // sender
            mstore(add(ptr, 0x24), to)     // recipient
            mstore(add(ptr, 0x44), amount) // amount
            
            let success := call(gas(), token, 0, ptr, 0x64, 0, 0)
            if iszero(success) { 
                mstore(0, 0x90b8ec1800000000000000000000000000000000000000000000000000000000)
                revert(0, 4)
            }
        }
    }
    
    /**
     * @notice Get ERC20 token balance
     * @param token Token contract address
     * @param account Account to check balance for
     * @return balance Token balance
     */
    function getTokenBalance(address token, address account) external view returns (uint256 balance) {
        assembly {
            let ptr := mload(0x40)
            // Store balanceOf(address) selector
            mstore(ptr, 0x70a0823100000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), account)
            
            let success := staticcall(gas(), token, ptr, 0x24, ptr, 0x20)
            if iszero(success) { 
                mstore(0, 0x6f9a29d800000000000000000000000000000000000000000000000000000000)
                revert(0, 4)
            }
            
            balance := mload(ptr)
        }
    }
    
    /**
     * @notice Approve ERC20 token spending
     * @param token Token contract address
     * @param spender Spender address
     * @param amount Amount to approve
     */
    function approveToken(address token, address spender, uint256 amount) external {
        assembly {
            let ptr := mload(0x40)
            // Store approve(address,uint256) selector
            mstore(ptr, 0x095ea7b300000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), spender) // spender
            mstore(add(ptr, 0x24), amount)  // amount
            
            let success := call(gas(), token, 0, ptr, 0x44, 0, 0)
            if iszero(success) { 
                mstore(0, 0x90b8ec1800000000000000000000000000000000000000000000000000000000)
                revert(0, 4)
            }
        }
    }
    
    /**
     * @notice Send ETH to address
     * @param to Recipient address
     * @param amount Amount to send
     */
    function sendETH(address to, uint256 amount) external {
        assembly {
            let success := call(gas(), to, amount, 0, 0, 0, 0)
            if iszero(success) { 
                mstore(0, 0x90b8ec1800000000000000000000000000000000000000000000000000000000)
                revert(0, 4)
            }
        }
    }
    
    /**
     * @notice Batch transfer multiple tokens to same recipient
     * @param tokens Array of token addresses
     * @param to Recipient address
     * @param amounts Array of amounts to transfer
     */
    function batchTransfer(
        address[] calldata tokens,
        address to,
        uint256[] calldata amounts
    ) external {
        uint256 length = tokens.length;
        if (length != amounts.length) revert CallFailed();
        
        for (uint256 i; i < length;) {
            if (tokens[i] == address(0)) {
                // ETH transfer
                if (amounts[i] > 0) {
                    assembly {
                        let success := call(gas(), to, mload(add(add(amounts, 0x20), mul(i, 0x20))), 0, 0, 0, 0)
                        if iszero(success) { revert(0, 0) }
                    }
                }
            } else {
                // ERC20 transfer
                assembly {
                    let ptr := mload(0x40)
                    let token := mload(add(add(tokens, 0x20), mul(i, 0x20)))
                    let amount := mload(add(add(amounts, 0x20), mul(i, 0x20)))
                    
                    mstore(ptr, 0xa9059cbb00000000000000000000000000000000000000000000000000000000)
                    mstore(add(ptr, 0x04), to)
                    mstore(add(ptr, 0x24), amount)
                    
                    let success := call(gas(), token, 0, ptr, 0x44, 0, 0)
                    if iszero(success) { revert(0, 0) }
                }
            }
            unchecked { ++i; }
        }
    }
}