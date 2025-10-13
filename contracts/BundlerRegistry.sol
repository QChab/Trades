// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IWalletBundler {
    function owner() external view returns (address);
}

contract BundlerRegistry {
    mapping(address => address) private walletToBundler;

    function storeAddress(address bundler) external {
        walletToBundler[msg.sender] = bundler;
    }

    /**
     * @notice Allows a bundler contract to register itself
     * @dev Verifies ownership by calling owner() on the bundler contract
     *      This prevents anyone from registering arbitrary bundlers for other users
     */
    function registerBundler() external {
        // msg.sender is the bundler contract
        address bundlerOwner = IWalletBundler(msg.sender).owner();
        walletToBundler[bundlerOwner] = msg.sender;
    }

    function readAddress(address wallet) external view returns (address) {
        return walletToBundler[wallet];
    }
}