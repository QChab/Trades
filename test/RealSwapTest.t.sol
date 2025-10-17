// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../contracts/WalletBundler.sol";

contract RealSwapTest is Test {
    WalletBundler public walletBundler;
    address public owner;

    // Token addresses
    address constant AAVE = 0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant ETH = address(0);
    address constant PAXG = 0x45804880De22913dAFE09f4980848ECE6EcbAf78;

    // Deployed contracts
    address constant BUNDLER_ADDRESS = 0x5f7Ac637c4aB52C581CA444CE4770C3e8b88B2dD;
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

    function testETHtoPAXGSwap() public {
        // This is the working case: ETH -> PAXG
        uint256 amountIn = 964; // 0.000000964 ETH in wei (for 18 decimals, this is tiny)

        console.log("\n=== Testing ETH -> PAXG Swap ===");
        console.log("Amount In:", amountIn, "wei");

        // Build encoder targets (all Uniswap for this test)
        address[] memory encoderTargets = new address[](2);
        encoderTargets[0] = UNISWAP_ENCODER;
        encoderTargets[1] = UNISWAP_ENCODER;

        // Build encoder data (you'll need to get this from your actual test output)
        bytes[] memory encoderData = new bytes[](2);
        encoderData[0] = hex"f69df74a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
        encoderData[1] = hex"f69df74a00000000000000000000000045804880de22913dafe09f4980848ece6ecbaf780000000000000000000000006b175474e89094c44da98b954eedeac495271d0f00000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000009c88c0d6bf00000000000000000000000000000000000000000000000000000000000000000000000000000000000000006b175474e89094c44da98b954eedeac495271d0f";

        // Wrap operations (0 = no wrap)
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
            PAXG,          // toToken
            encoderTargets,
            encoderData,
            wrapOps
        );

        vm.stopPrank();

        console.log("ETH -> PAXG swap succeeded!");
    }
}

interface IERC20Minimal {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
