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
     * @dev  Verifies through tx.origin, can only be set once in that way
     */
    function registerBundler() external {
        address bundlerOwner = tx.origin;
        if (walletToBundler[bundlerOwner] == address(0))
            walletToBundler[bundlerOwner] = msg.sender;
    }

    function readAddress(address wallet) external view returns (address) {
        return walletToBundler[wallet];
    }
}