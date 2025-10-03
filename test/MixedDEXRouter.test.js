const { expect } = require("chai");
const { ethers } = require("hardhat");

// ===== DEPLOYED CONTRACT ADDRESSES =====
// Set these to deployed addresses to skip deployment
// Leave as null to deploy fresh contracts
const DEPLOYED_ADDRESSES = {
  bundlerRegistry: null,  // "0x..." or null
  uniswapEncoder: null,   // "0x..." or null
  balancerEncoder: null,  // "0x..." or null
  walletBundler: null     // "0x..." or null
};

describe("Mixed DEX Router Integration Test", function () {
  let bundlerRegistry;
  let uniswapEncoder;
  let balancerEncoder;
  let walletBundler;
  let owner;

  // Token addresses on mainnet
  const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const ONE = "0x91c65c2a9a3adfe2424ecc4a4890b8334c3a8212";
  const SEV = "0x965b64ae2c04cff248e6502c10cf3a4931e1f1d9";

  // DEX addresses
  const UNISWAP_ROUTER = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af";
  const BALANCER_VAULT = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

  before(async function () {
    [owner] = await ethers.getSigners();

    console.log("\n📦 Setting up contracts...");

    // BundlerRegistry - deploy or use existing
    if (DEPLOYED_ADDRESSES.bundlerRegistry) {
      console.log(`✓ Using existing BundlerRegistry: ${DEPLOYED_ADDRESSES.bundlerRegistry}`);
      bundlerRegistry = await ethers.getContractAt("BundlerRegistry", DEPLOYED_ADDRESSES.bundlerRegistry);
    } else {
      console.log("  Deploying BundlerRegistry...");
      const BundlerRegistry = await ethers.getContractFactory("BundlerRegistry");
      bundlerRegistry = await BundlerRegistry.deploy();
      await bundlerRegistry.deployed();
      console.log(`✓ BundlerRegistry deployed: ${bundlerRegistry.address}`);
    }

    // UniswapEncoder - deploy or use existing
    if (DEPLOYED_ADDRESSES.uniswapEncoder) {
      console.log(`✓ Using existing UniswapEncoder: ${DEPLOYED_ADDRESSES.uniswapEncoder}`);
      uniswapEncoder = await ethers.getContractAt("UniswapEncoder", DEPLOYED_ADDRESSES.uniswapEncoder);
    } else {
      console.log("  Deploying UniswapEncoder...");
      const UniswapEncoder = await ethers.getContractFactory("UniswapEncoder");
      uniswapEncoder = await UniswapEncoder.deploy();
      await uniswapEncoder.deployed();
      console.log(`✓ UniswapEncoder deployed: ${uniswapEncoder.address}`);
    }

    // BalancerEncoder - deploy or use existing
    if (DEPLOYED_ADDRESSES.balancerEncoder) {
      console.log(`✓ Using existing BalancerEncoder: ${DEPLOYED_ADDRESSES.balancerEncoder}`);
      balancerEncoder = await ethers.getContractAt("BalancerEncoder", DEPLOYED_ADDRESSES.balancerEncoder);
    } else {
      console.log("  Deploying BalancerEncoder...");
      const BalancerEncoder = await ethers.getContractFactory("BalancerEncoder");
      balancerEncoder = await BalancerEncoder.deploy();
      await balancerEncoder.deployed();
      console.log(`✓ BalancerEncoder deployed: ${balancerEncoder.address}`);
    }

    // WalletBundler - deploy or use existing
    if (DEPLOYED_ADDRESSES.walletBundler) {
      console.log(`✓ Using existing WalletBundler: ${DEPLOYED_ADDRESSES.walletBundler}`);
      walletBundler = await ethers.getContractAt("WalletBundler", DEPLOYED_ADDRESSES.walletBundler);
    } else {
      console.log("  Deploying WalletBundler...");
      const WalletBundler = await ethers.getContractFactory("WalletBundler");
      walletBundler = await WalletBundler.deploy(owner.address);
      await walletBundler.deployed();
      console.log(`✓ WalletBundler deployed: ${walletBundler.address}`);
    }

    console.log("");
  });

  describe("Encoder Contract Tests", function () {
    it("Should encode Uniswap single swap correctly", async function () {
      const amountIn = ethers.utils.parseUnits("1", 18);
      const minAmountOut = ethers.utils.parseUnits("3000", 6); // USDC has 6 decimals
      const fee = 3000; // 0.3%

      const result = await uniswapEncoder.encodeSingleSwap(
        WETH,
        USDC,
        fee,
        amountIn,
        minAmountOut
      );

      expect(result.target).to.equal(UNISWAP_ROUTER);
      expect(result.callData).to.not.equal("0x");
      expect(result.inputAmount).to.equal(amountIn);
      expect(result[3]).to.equal(WETH); // tokenIn
      console.log("✓ Uniswap encoder working");
    });

    it("Should encode Balancer single swap correctly", async function () {
      // Example pool: WETH-USDC
      const poolId = "0x96646936b91d6b9d7d0c47c496afbf3d6ec7b6f8000200000000000000000019";
      const amountIn = ethers.utils.parseUnits("1", 18);
      const minAmountOut = ethers.utils.parseUnits("3000", 6);

      const result = await balancerEncoder.encodeSingleSwap(
        poolId,
        WETH,
        USDC,
        amountIn,
        minAmountOut
      );

      expect(result.target).to.equal(BALANCER_VAULT);
      expect(result.callData).to.not.equal("0x");
      expect(result.inputAmount).to.equal(amountIn);
      expect(result[3]).to.equal(WETH); // tokenIn
      console.log("✓ Balancer encoder working");
    });

    it("Should build Uniswap multi-hop path correctly", async function () {
      const tokens = [WETH, USDC, ONE];
      const fees = [3000, 10000]; // 0.3% and 1%

      const path = await uniswapEncoder.buildPath(tokens, fees);

      expect(path).to.not.equal("0x");
      // Path should be: token0 + fee0 + token1 + fee1 + token2
      // = 20 bytes + 3 bytes + 20 bytes + 3 bytes + 20 bytes = 66 bytes
      expect(path.length).to.equal(2 + 66 * 2); // "0x" + hex string
      console.log("✓ Uniswap path builder working");
    });
  });

  describe("Registry Integration", function () {
    it("Should store and read bundler address", async function () {
      await bundlerRegistry.storeAddress(walletBundler.address);

      const stored = await bundlerRegistry.readAddress(owner.address);
      expect(stored).to.equal(walletBundler.address);
      console.log("✓ Registry storage working");
    });
  });

  describe("Execution Plan Tests", function () {
    it("Should create valid execution plan structure", async function () {
      // Simulate what useMixedUniswapBalancer.js creates
      const amountIn = ethers.utils.parseUnits("10", 18);
      const fee = 3000;

      // Get encoded calldata for first leg (Uniswap)
      const uniswapLeg = await uniswapEncoder.encodeSingleSwap(
        ONE,
        WETH,
        fee,
        amountIn.mul(60).div(100), // 60% split
        0
      );

      // Get encoded calldata for second leg (Balancer)
      const poolId = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const balancerLeg = await balancerEncoder.encodeSingleSwap(
        poolId,
        ONE,
        WETH,
        amountIn.mul(40).div(100), // 40% split
        0
      );

      // Verify structure matches what WalletBundler.encodeAndExecute expects
      expect(uniswapLeg.target).to.not.equal(ethers.constants.AddressZero);
      expect(balancerLeg.target).to.not.equal(ethers.constants.AddressZero);
      expect(uniswapLeg.callData.length).to.be.greaterThan(2);
      expect(balancerLeg.callData.length).to.be.greaterThan(2);

      console.log("✓ Execution plan structure valid");
      console.log(`  Uniswap target: ${uniswapLeg.target}`);
      console.log(`  Balancer target: ${balancerLeg.target}`);
    });
  });

  describe("Token Balance Query Tests", function () {
    it("Should query token balance via encoder", async function () {
      // This tests the _getTokenBalance internal function
      // by calling encodeUseAllBalanceSwap which uses it
      const fee = 3000;

      const result = await uniswapEncoder.encodeUseAllBalanceSwap(
        WETH,
        USDC,
        fee,
        0
      );

      // Should return 0 balance since WalletBundler has no WETH
      expect(result.inputAmount).to.equal(0);
      console.log("✓ Balance query working (returned 0 as expected)");
    });
  });

  describe("Integration with JavaScript Router", function () {
    it("Should validate execution plan from useMixedUniswapBalancer", async function () {
      // This is a structure test - we're validating that the encoders
      // produce output compatible with what useMixedUniswapBalancer expects

      const mockExecutionPlan = {
        legs: [
          {
            protocol: "uniswap",
            percentage: 0.60,
            token: { address: ONE, symbol: "ONE" }
          },
          {
            protocol: "balancer",
            percentage: 0.40,
            token: { address: ONE, symbol: "ONE" }
          }
        ],
        fromToken: { address: ONE, symbol: "ONE", decimals: 18 },
        toToken: { address: WETH, symbol: "WETH", decimals: 18 },
        totalInput: ethers.utils.parseUnits("10", 18)
      };

      // Validate that we can encode both legs
      const amountIn = mockExecutionPlan.totalInput;
      const uniswapAmount = amountIn.mul(60).div(100);
      const balancerAmount = amountIn.mul(40).div(100);

      const uniswapCall = await uniswapEncoder.encodeSingleSwap(
        ONE,
        WETH,
        3000,
        uniswapAmount,
        0
      );

      const poolId = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const balancerCall = await balancerEncoder.encodeSingleSwap(
        poolId,
        ONE,
        WETH,
        balancerAmount,
        0
      );

      expect(uniswapCall.inputAmount).to.equal(uniswapAmount);
      expect(balancerCall.inputAmount).to.equal(balancerAmount);

      console.log("✓ JavaScript router integration compatible");
      console.log(`  Uniswap amount: ${ethers.utils.formatUnits(uniswapAmount, 18)}`);
      console.log(`  Balancer amount: ${ethers.utils.formatUnits(balancerAmount, 18)}`);
    });
  });
});
