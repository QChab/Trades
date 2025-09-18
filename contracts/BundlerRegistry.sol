// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract BundlerRegistry {
    mapping(address => address) private walletToBundler;
        
    function storeAddress(address bundler) external {
        walletToBundler[msg.sender] = bundler;
    }
    
    function readAddress(address wallet) external view returns (address) {
        return walletToBundler[wallet];
    }
}