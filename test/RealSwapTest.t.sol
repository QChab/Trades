// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/WalletBundler.sol";

contract RealSwapTest is Test {
    WalletBundler public walletBundler;
    address public owner;

    // Token addresses
    address constant ETH = address(0);
    address constant AAVE = 0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9;

    // Deployed contracts
    address constant BUNDLER_ADDRESS = 0xA41467444E65433FdA9692c0116f2236DD8Ae637;
    address constant UNISWAP_ENCODER = 0xbB9417Cfd94383cA8EF2e323aE2e244CC58aF010;
    address constant BALANCER_ENCODER = 0xc9BC3dd2AAF14992Bf987dFEf1E9592151E8e1C4;

    // Test parameters
    address constant WALLET = 0x297Ed7F67f77ff6be9bf6341f8FB31cD10f4d3Ea;

    function setUp() public {
        // Fork mainnet at current block
        vm.createSelectFork(vm.rpcUrl("mainnet"));

        // Connect to existing bundler
        walletBundler = WalletBundler(payable(BUNDLER_ADDRESS));
        owner = walletBundler.owner();

        console.log("Test wallet:", WALLET);
        console.log("Bundler owner:", owner);
        console.log("Bundler address:", address(walletBundler));
    }

    function testETHtoAAVESwap() public {
        // ETH -> AAVE swap
        uint256 amountIn = 96400000000000; // 0.0000964 ETH in wei

        console.log("\n=== Testing ETH -> AAVE Swap ===");
        console.log("Amount In:", amountIn, "wei");

        // Build encoder targets
        address[] memory encoderTargets = new address[](2);
        encoderTargets[0] = 0x11d264629b6277a6fABb2870318982CC9353fffb;
        encoderTargets[1] = 0x11d264629b6277a6fABb2870318982CC9353fffb;

        // Build encoder data
        bytes[] memory encoderData = new bytes[](2);
        encoderData[0] = hex"5247a61e00000000000000000000000000000000000000000000000000000000000000000000000000000000000000007fc66500c84a76ad7e9c93437bfc5ac33e2ddae90000000000000000000000000000000000000000000000000000000000000abe000000000000000000000000000000000000000000000000000000000000003700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000265bb8e080000000000000000000000000000000000000000000000000000002155281e75d0000000000000000000000000000000000000000000000000000000000000000";
        encoderData[1] = hex"f69df74a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000007fc66500c84a76ad7e9c93437bfc5ac33e2ddae90000000000000000000000000000000000000000000000000000000000000bb8000000000000000000000000000000000000000000000000000000000000003c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000004c6931e363fea00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

        // Wrap operations
        uint8[] memory wrapOps = new uint8[](2);
        wrapOps[0] = 0;
        wrapOps[1] = 0;

        // Impersonate the owner to call the function
        vm.startPrank(owner);
        vm.deal(owner, 1 ether); // Give owner some ETH

        // Call with ETH value
        walletBundler.encodeAndExecuteaaaaaYops{value: amountIn}(
            ETH,           // fromToken
            amountIn,      // fromAmount
            0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9,          // toToken
            encoderTargets,
            encoderData,
            wrapOps
        );

        vm.stopPrank();

        console.log("ETH -> AAVE swap succeeded!");
    }
}

interface IERC20Minimal {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
