// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IERC20Utils {
    function transferToken(address token, address to, uint256 amount) external;
    function transferFromToken(address token, address from, address to, uint256 amount) external;
    function getTokenBalance(address token, address account) external view returns (uint256);
    function approveToken(address token, address spender, uint256 amount) external;
    function sendETH(address to, uint256 amount) external payable;
    function batchTransfer(address[] calldata tokens, address to, uint256[] calldata amounts) external payable;
}

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/**
 * @title WalletBundlerWithLibrary
 * @notice WalletBundler that uses external ERC20Utils library
 * @dev Trades deployment cost for execution cost
 */
contract WalletBundlerWithLibrary {
    address public immutable owner;
    address public immutable erc20Utils;
    
    // Constants
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint160 private constant MAX_ALLOWANCE = type(uint160).max;
    uint48 private constant EXPIRATION_OFFSET = 1577836800; // 50 years from 2020
    
    error Unauthorized();
    error InvalidLength();
    error InsufficientBalance();
    
    modifier auth() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }
    
    constructor(address _erc20Utils) {
        owner = msg.sender;
        erc20Utils = _erc20Utils;
    }
    
    /**
     * @notice Execute trades using external library
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
            IERC20Utils(erc20Utils).transferFromToken(fromToken, owner, address(this), fromAmount);
        }
        
        // Execute trades
        results = new bool[](targetsLength);
        for (uint256 i; i < targetsLength;) {
            (bool success,) = targets[i].call{value: values[i]}(data[i]);
            results[i] = success;
            unchecked { ++i; }
        }
        
        // Return tokens using library
        uint256 outputLength = outputTokens.length;
        address[] memory returnTokens = new address[](outputLength + 1);
        uint256[] memory returnAmounts = new uint256[](outputLength + 1);
        uint256 returnCount = 0;
        
        // Collect output tokens
        for (uint256 i; i < outputLength;) {
            address token = outputTokens[i];
            uint256 balance;
            
            if (token == address(0)) {
                balance = address(this).balance;
            } else {
                balance = IERC20Utils(erc20Utils).getTokenBalance(token, address(this));
            }
            
            if (balance > 0) {
                returnTokens[returnCount] = token;
                returnAmounts[returnCount] = balance;
                returnCount++;
            }
            unchecked { ++i; }
        }
        
        // Return remaining input token if different
        if (fromToken != address(0)) {
            bool alreadyIncluded = false;
            for (uint256 i; i < returnCount;) {
                if (returnTokens[i] == fromToken) {
                    alreadyIncluded = true;
                    break;
                }
                unchecked { ++i; }
            }
            
            if (!alreadyIncluded) {
                uint256 balance = IERC20Utils(erc20Utils).getTokenBalance(fromToken, address(this));
                if (balance > 0) {
                    returnTokens[returnCount] = fromToken;
                    returnAmounts[returnCount] = balance;
                    returnCount++;
                }
            }
        }
        
        // Batch transfer all tokens back
        if (returnCount > 0) {
            // Resize arrays to actual count
            address[] memory finalTokens = new address[](returnCount);
            uint256[] memory finalAmounts = new uint256[](returnCount);
            for (uint256 i; i < returnCount;) {
                finalTokens[i] = returnTokens[i];
                finalAmounts[i] = returnAmounts[i];
                unchecked { ++i; }
            }
            
            IERC20Utils(erc20Utils).batchTransfer{value: address(this).balance}(
                finalTokens,
                owner,
                finalAmounts
            );
        }
    }
    
    /**
     * @notice Batch approve using library
     */
    function approve(
        address[] calldata tokens,
        address[] calldata spenders,
        uint256[] calldata amounts,
        address[] calldata permit2Spenders
    ) external auth {
        uint256 length = tokens.length;
        if (length != spenders.length || length != amounts.length || length != permit2Spenders.length) {
            revert InvalidLength();
        }
        
        for (uint256 i; i < length;) {
            // Standard approval via library
            IERC20Utils(erc20Utils).approveToken(tokens[i], spenders[i], amounts[i]);
            
            // PERMIT2 approval if needed (direct call to save gas)
            address permit2Spender = permit2Spenders[i];
            if (spenders[i] == PERMIT2 && permit2Spender != address(0)) {
                IPermit2(PERMIT2).approve(
                    tokens[i],
                    permit2Spender,
                    MAX_ALLOWANCE,
                    uint48(block.timestamp + EXPIRATION_OFFSET)
                );
            }
            
            unchecked { ++i; }
        }
    }
    
    /**
     * @notice Emergency withdraw using library
     */
    function withdraw(address token, uint256 amount) external auth {
        if (token == address(0)) {
            uint256 balance = amount == 0 ? address(this).balance : amount;
            IERC20Utils(erc20Utils).sendETH{value: balance}(owner, balance);
        } else {
            uint256 balance = IERC20Utils(erc20Utils).getTokenBalance(token, address(this));
            uint256 withdrawAmount = amount == 0 ? balance : amount;
            if (withdrawAmount > balance) revert InsufficientBalance();
            
            IERC20Utils(erc20Utils).transferToken(token, owner, withdrawAmount);
        }
    }
    
    receive() external payable {}
}