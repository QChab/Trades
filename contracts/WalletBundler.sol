// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

/**
 * @title WalletBundler
 * @notice Individual wallet bundler contract for MEV-protected multi-DEX trading
 * @dev Each wallet deploys its own instance, ensuring complete fund isolation
 */
contract WalletBundler {
    address public immutable owner;
    
    // Events
    event TradeExecuted(address indexed target, bool success, bytes returnData);
    event FundsTransferred(address indexed token, uint256 amount, address indexed recipient);
    event EmergencyWithdrawal(address indexed token, uint256 amount);
    event ETHReceived(address indexed sender, uint256 amount);
    
    // Custom errors
    error OnlyOwner();
    error InvalidInput();
    error TransferFailed();
    error InsufficientBalance();
    
    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }
    
    constructor() {
        owner = msg.sender;
    }
    
    /**
     * @notice Execute multiple trades in sequence with automatic fund transfers
     * @param targets Array of contract addresses to call (DEX routers)
     * @param data Array of encoded function calls
     * @param values Array of ETH values to send with each call
     * @param tokens Array of token addresses to transfer back after trades (0x0 for ETH)
     * @param expectSuccess Array of booleans indicating if each trade must succeed
     * @return results Array of success flags for each trade
     * @return returnData Array of return data from each call
     */
    function executeBundleWithTransfers(
        address[] calldata targets,
        bytes[] calldata data,
        uint256[] calldata values,
        address[] calldata tokens,
        bool[] calldata expectSuccess
    ) external payable onlyOwner returns (
        bool[] memory results,
        bytes[] memory returnData
    ) {
        // Validate input arrays
        if (targets.length != data.length || 
            targets.length != values.length ||
            targets.length != expectSuccess.length) {
            revert InvalidInput();
        }
        
        results = new bool[](targets.length);
        returnData = new bytes[](targets.length);
        
        // Execute trades sequentially
        for (uint256 i = 0; i < targets.length; i++) {
            (bool success, bytes memory retData) = targets[i].call{value: values[i]}(data[i]);
            results[i] = success;
            returnData[i] = retData;
            
            emit TradeExecuted(targets[i], success, retData);
            
            // If trade must succeed but failed, revert entire transaction
            if (expectSuccess[i] && !success) {
                assembly {
                    revert(add(retData, 32), mload(retData))
                }
            }
        }
        
        // Transfer all specified tokens back to owner
        _transferAllTokens(tokens);
    }
    
    /**
     * @notice Approve multiple tokens for DEX routers
     * @param tokens Array of token addresses
     * @param spenders Array of spender addresses (DEX routers)
     * @param amounts Array of amounts to approve
     */
    function batchApprove(
        address[] calldata tokens,
        address[] calldata spenders,
        uint256[] calldata amounts
    ) external onlyOwner {
        if (tokens.length != spenders.length || tokens.length != amounts.length) {
            revert InvalidInput();
        }
        
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).approve(spenders[i], amounts[i]);
        }
    }
    
    /**
     * @notice Emergency withdrawal of specific tokens
     * @param token Token address (0x0 for ETH)
     * @param amount Amount to withdraw (0 for entire balance)
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            uint256 withdrawAmount = amount == 0 ? address(this).balance : amount;
            if (withdrawAmount > address(this).balance) revert InsufficientBalance();
            
            _transferETH(owner, withdrawAmount);
            emit EmergencyWithdrawal(address(0), withdrawAmount);
        } else {
            uint256 balance = IERC20(token).balanceOf(address(this));
            uint256 withdrawAmount = amount == 0 ? balance : amount;
            if (withdrawAmount > balance) revert InsufficientBalance();
            
            _transferToken(token, owner, withdrawAmount);
            emit EmergencyWithdrawal(token, withdrawAmount);
        }
    }
    
    /**
     * @notice Transfer all balances back to owner for specified tokens
     * @param tokens Array of token addresses to check and transfer
     */
    function sweepTokens(address[] calldata tokens) external onlyOwner {
        _transferAllTokens(tokens);
    }
    
    /**
     * @notice Transfer all specified tokens back to owner
     * @param tokens Array of token addresses to transfer
     */
    function _transferAllTokens(address[] calldata tokens) private {
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == address(0)) {
                // Transfer ETH
                uint256 balance = address(this).balance;
                if (balance > 0) {
                    _transferETH(owner, balance);
                }
            } else {
                // Transfer ERC20
                uint256 balance = IERC20(tokens[i]).balanceOf(address(this));
                if (balance > 0) {
                    _transferToken(tokens[i], owner, balance);
                }
            }
        }
    }
    
    /**
     * @notice Safe transfer of ERC20 tokens
     */
    function _transferToken(address token, address to, uint256 amount) private {
        bool success = IERC20(token).transfer(to, amount);
        if (!success) revert TransferFailed();
        
        emit FundsTransferred(token, amount, to);
    }
    
    /**
     * @notice Safe transfer of ETH
     */
    function _transferETH(address to, uint256 amount) private {
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit FundsTransferred(address(0), amount, to);
    }
    
    /**
     * @notice Get balance of a token (including ETH)
     * @param token Token address (0x0 for ETH)
     */
    function getBalance(address token) external view returns (uint256) {
        if (token == address(0)) {
            return address(this).balance;
        }
        return IERC20(token).balanceOf(address(this));
    }
    
    /**
     * @notice Get balances of multiple tokens
     * @param tokens Array of token addresses (0x0 for ETH)
     */
    function getBalances(address[] calldata tokens) external view returns (uint256[] memory balances) {
        balances = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i] == address(0)) {
                balances[i] = address(this).balance;
            } else {
                balances[i] = IERC20(tokens[i]).balanceOf(address(this));
            }
        }
    }
    
    /**
     * @notice Check if this contract has approved a spender for a token
     * @param token Token address
     * @param spender Spender address
     */
    function getAllowance(address token, address spender) external view returns (uint256) {
        return IERC20(token).allowance(address(this), spender);
    }
    
    // Receive ETH
    receive() external payable {
        emit ETHReceived(msg.sender, msg.value);
    }
}