// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./WalletBundler.sol";

/**
 * @title WalletBundlerFactory
 * @notice Factory contract for deploying individual WalletBundler contracts
 * @dev Uses CREATE2 for deterministic addresses
 */
contract WalletBundlerFactory {
    // Events
    event BundlerDeployed(address indexed owner, address indexed bundler, uint256 salt);
    
    // Mapping to track deployed bundlers
    mapping(address => address[]) public ownerToBundlers;
    mapping(address => address) public bundlerToOwner;
    
    /**
     * @notice Deploy a new WalletBundler for the caller
     * @param salt Salt for CREATE2 deployment (use 0 for default)
     * @return bundler Address of the deployed bundler
     */
    function deployBundler(uint256 salt) external returns (address bundler) {
        // Deploy using CREATE2 for deterministic address
        bytes memory bytecode = type(WalletBundler).creationCode;
        bytes32 _salt = keccak256(abi.encodePacked(msg.sender, salt));
        
        assembly {
            bundler := create2(0, add(bytecode, 32), mload(bytecode), _salt)
            if iszero(bundler) {
                revert(0, 0)
            }
        }
        
        // Track deployment
        ownerToBundlers[msg.sender].push(bundler);
        bundlerToOwner[bundler] = msg.sender;
        
        emit BundlerDeployed(msg.sender, bundler, salt);
    }
    
    /**
     * @notice Calculate the address where a bundler would be deployed
     * @param owner Owner address
     * @param salt Deployment salt
     * @return Address where bundler would be deployed
     */
    function getBundlerAddress(address owner, uint256 salt) external view returns (address) {
        bytes32 _salt = keccak256(abi.encodePacked(owner, salt));
        bytes memory bytecode = type(WalletBundler).creationCode;
        
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff),
            address(this),
            _salt,
            keccak256(bytecode)
        )))));
    }
    
    /**
     * @notice Get all bundlers deployed by an owner
     * @param owner Owner address
     * @return Array of bundler addresses
     */
    function getBundlersByOwner(address owner) external view returns (address[] memory) {
        return ownerToBundlers[owner];
    }
    
    /**
     * @notice Check if an address is a bundler deployed by this factory
     * @param bundler Address to check
     * @return isValid True if deployed by this factory
     * @return owner Owner of the bundler (address(0) if not valid)
     */
    function isBundler(address bundler) external view returns (bool isValid, address owner) {
        owner = bundlerToOwner[bundler];
        isValid = owner != address(0);
    }
}