// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
    function allowance(address owner, address token, address spender) external view returns (uint160, uint48, uint48);
}

/**
 * @title WalletBundler
 * @notice Standalone bundler contract for MEV-protected multi-DEX trading
 * @dev Deploy one instance per wallet for complete fund isolation
 */
contract WalletBundler {
    address public immutable owner;
    address private constant PERMIT2_ADDRESS = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    
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
     * @notice Execute multiple trades with automatic fund transfers
     * @dev First transfers input tokens from owner to contract, executes trades, then returns output tokens
     * @param fromToken Input token address (0x0 for ETH)
     * @param fromAmount Amount of input token to transfer from owner
     * @param targets Array of contract addresses to call (DEX routers)
     * @param data Array of encoded function calls
     * @param values Array of ETH values to send with each call
     * @param outputTokens Array of output token addresses to transfer back (0x0 for ETH)
     * @return results Array of success flags for each trade
     * @return returnData Array of return data from each call
     */
    function executeBundleWithTransfers(
        address fromToken,
        uint256 fromAmount,
        address[] calldata targets,
        bytes[] calldata data,
        uint256[] calldata values,
        address[] calldata outputTokens
    ) external payable onlyOwner returns (
        bool[] memory results,
        bytes[] memory returnData
    ) {
        // Validate input arrays
        if (targets.length != data.length || targets.length != values.length) {
            revert InvalidInput();
        }
        
        // Transfer input tokens from owner to contract
        if (fromToken != address(0) && fromAmount > 0) {
            // Transfer ERC20 tokens
            bool success = IERC20(fromToken).transferFrom(owner, address(this), fromAmount);
            if (!success) revert TransferFailed();
        }
        // If fromToken is ETH (0x0), it should be sent with msg.value
        
        results = new bool[](targets.length);
        returnData = new bytes[](targets.length);
        
        // Execute trades sequentially
        for (uint256 i = 0; i < targets.length; i++) {
            (bool success, bytes memory retData) = targets[i].call{value: values[i]}(data[i]);
            results[i] = success;
            returnData[i] = retData;
        }
        
        // Transfer all output tokens back to owner
        for (uint256 i = 0; i < outputTokens.length; i++) {
            if (outputTokens[i] == address(0)) {
                // Transfer all ETH balance
                uint256 balance = address(this).balance;
                if (balance > 0) {
                    (bool success, ) = owner.call{value: balance}("");
                    if (!success) revert TransferFailed();
                }
            } else {
                // Transfer all ERC20 balance
                uint256 balance = IERC20(outputTokens[i]).balanceOf(address(this));
                if (balance > 0) {
                    bool success = IERC20(outputTokens[i]).transfer(owner, balance);
                    if (!success) revert TransferFailed();
                }
            }
        }
        
        // Also return any remaining input token balance
        if (fromToken == address(0)) {
            // Return remaining ETH if any
            uint256 balance = address(this).balance;
            if (balance > 0) {
                (bool success, ) = owner.call{value: balance}("");
                if (!success) revert TransferFailed();
            }
        } else {
            // Return remaining ERC20 if any
            uint256 balance = IERC20(fromToken).balanceOf(address(this));
            if (balance > 0) {
                bool success = IERC20(fromToken).transfer(owner, balance);
                if (!success) revert TransferFailed();
            }
        }
    }
    
    /**
     * @notice Approve multiple tokens for DEX routers with PERMIT2 support
     * @param tokens Array of token addresses
     * @param spenders Array of spender addresses (DEX routers or PERMIT2)
     * @param amounts Array of amounts to approve
     * @param permit2Spenders Array of final spenders for PERMIT2 approvals (0x0 if not using PERMIT2)
     */
    function batchApprove(
        address[] calldata tokens,
        address[] calldata spenders,
        uint256[] calldata amounts,
        address[] calldata permit2Spenders
    ) external onlyOwner {
        if (tokens.length != spenders.length || 
            tokens.length != amounts.length ||
            tokens.length != permit2Spenders.length) {
            revert InvalidInput();
        }
        
        for (uint256 i = 0; i < tokens.length; i++) {
            // Standard ERC20 approval
            IERC20(tokens[i]).approve(spenders[i], amounts[i]);
            
            // If spender is PERMIT2 and permit2Spender is provided, also approve PERMIT2 for final spender
            if (spenders[i] == PERMIT2_ADDRESS && permit2Spenders[i] != address(0)) {
                IPermit2 permit2 = IPermit2(PERMIT2_ADDRESS);
                
                // Max approval for 50 years
                uint160 maxAmount = type(uint160).max;
                uint48 expiration = uint48(block.timestamp + 50 * 365 days);
                
                permit2.approve(tokens[i], permit2Spenders[i], maxAmount, expiration);
            }
        }
    }
    
    /**
     * @notice Emergency withdrawal of stuck tokens or ETH
     * @param token Token address (0x0 for ETH)
     * @param amount Amount to withdraw (0 for entire balance)
     */
    function withdraw(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            // Withdraw ETH
            uint256 withdrawAmount = amount == 0 ? address(this).balance : amount;
            if (withdrawAmount > address(this).balance) revert InsufficientBalance();
            
            (bool success, ) = owner.call{value: withdrawAmount}("");
            if (!success) revert TransferFailed();
        } else {
            // Withdraw ERC20
            uint256 balance = IERC20(token).balanceOf(address(this));
            uint256 withdrawAmount = amount == 0 ? balance : amount;
            if (withdrawAmount > balance) revert InsufficientBalance();
            
            bool success = IERC20(token).transfer(owner, withdrawAmount);
            if (!success) revert TransferFailed();
        }
    }
    
    // Receive ETH
    receive() external payable {}
}