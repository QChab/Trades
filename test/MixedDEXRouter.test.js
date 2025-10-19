import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

// ===== DEPLOYED CONTRACT ADDRESSES =====
// Set these to deployed addresses to skip deployment
// Leave as null to deploy fresh contracts
const DEPLOYED_ADDRESSES = {
  bundlerRegistry: '0xb529eB70a7c93d07eaCe6cd6A986AF8B8A2692bC',
  uniswapEncoder: '0x11d264629b6277a6fABb2870318982CC9353fffb',
  balancerEncoder: '0x5d0927B13E2e0ecDEb20aD2c0E76e62acd36b080',
  walletBundler: '0xA41467444E65433FdA9692c0116f2236DD8Ae637'
};

const encodeAndExecuteArgs = {
  fromToken: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
  fromAmount: '0x3635c6204739d98000',
  toToken: '0x111111111117dc0aa78b770fa6a738034120c302',
  encoderTargets: [
    '0x0000000000000000000000000000000000000002',
    '0x0000000000000000000000000000000000000001',
    '0x0000000000000000000000000000000000000002',
    '0x0000000000000000000000000000000000000002',
    '0x0000000000000000000000000000000000000002'
  ],
  encoderData: [
    '0xc8369b800000000000000000000000007fc66500c84a76ad7e9c93437bfc5ac33e2ddae900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000bb80000000000000000000000000000000000000000000000010a5dd696c74be40000000000000000000000000000000000000000000000000004b4105f152c6f49',
    '0xa614b22400000000000000000000000000000000000000000000000000000000000000000000000000000000000000007fc66500c84a76ad7e9c93437bfc5ac33e2ddae9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005bd73f401b58a75',
    '0x0dfd26fe0000000000000000000000007fc66500c84a76ad7e9c93437bfc5ac33e2ddae900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000bb800000000000000000000000000000000000000000000000146df7c6dfc152c49',
    '0x0dfd26fe0000000000000000000000007fc66500c84a76ad7e9c93437bfc5ac33e2ddae9000000000000000000000000111111111117dc0aa78b770fa6a738034120c3020000000000000000000000000000000000000000000000000000000000000bb80000000000000000000000000000000000000000000000046e2e7accfacf9a81',
    '0x0dfd26fe0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000111111111117dc0aa78b770fa6a738034120c3020000000000000000000000000000000000000000000000000000000000000bb8000000000000000000000000000000000000000000005cef0baf271b3947756e'
  ],
  wrapOperations: [ 0, 4, 0, 0, 0 ],
  metadata: {
    routeType: 'optimized-multi-route-split',
    expectedOutput: '0x5d6b0d21a401d0029861',
    slippageTolerance: 0.5,
    steps: 5
  }
}


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
      walletBundler = await WalletBundler.deploy(); // No constructor parameters
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
  });

  describe("Registry Integration", function () {
    it("Should verify bundler auto-registered on deployment", async function () {
      // WalletBundler automatically registers itself in constructor
      // So we should be able to read the bundler address immediately
      const stored = await bundlerRegistry.readAddress(owner.address);
      expect(stored).to.equal(walletBundler.address);
      console.log("✓ Bundler auto-registration working");
    });
  });

  describe("Pool-Based Execution Tests", function () {
    it("Should encode split execution with sorted pools (low to high)", async function () {
      // Simulate pool-based execution structure from optimizer
      const amountIn = ethers.utils.parseUnits("1000", 18);
      const fee = 3000;

      console.log("\n📊 Testing pool-based split execution:");

      // Level 0: Split AAVE input across 3 pools (sorted lowest to highest)
      const pools = [
        { percentage: 0.012, amount: amountIn.mul(12).div(1000) },   // 1.2%
        { percentage: 0.018, amount: amountIn.mul(18).div(1000) },   // 1.8%
        { percentage: 0.970, amount: amountIn.mul(970).div(1000) }   // 97.0% (use all)
      ];

      console.log(`  Level 0 pools (sorted low → high):`);

      for (let i = 0; i < pools.length; i++) {
        const pool = pools[i];
        const isUseAll = i === pools.length - 1; // Last one uses all

        const encoded = await uniswapEncoder.encodeSingleSwap(
          ONE,
          WETH,
          fee,
          isUseAll ? ethers.constants.MaxUint256 : pool.amount,
          0
        );

        expect(encoded.target).to.equal(UNISWAP_ROUTER);
        expect(encoded.callData.length).to.be.greaterThan(2);
        expect(encoded.inputAmount).to.equal(isUseAll ? ethers.constants.MaxUint256 : pool.amount);

        console.log(`    ${i + 1}. ${(pool.percentage * 100).toFixed(1)}%${isUseAll ? ' [USE ALL]' : ''} - Amount: ${isUseAll ? 'MAX_UINT256' : ethers.utils.formatUnits(pool.amount, 18)}`);
      }

      console.log("  ✓ Pool-based execution structure validated");
    });

    it("Should handle useAllBalance marker correctly", async function () {
      // Test that encoders handle "use all balance" correctly
      // Note: When called directly from test, msg.sender is the test account (not WalletBundler)
      // So it will read the test account's WETH balance
      const result = await uniswapEncoder.encodeUseAllBalanceSwap(
        WETH,
        USDC,
        3000,
        0
      );

      // Should return the caller's actual balance (test account has some WETH on Hardhat)
      expect(result.target).to.equal(UNISWAP_ROUTER);
      expect(result.callData).to.not.equal("0x");

      console.log("✓ UseAllBalance encoder working correctly");
      console.log(`  Returned balance: ${ethers.utils.formatUnits(result.inputAmount, 18)} WETH`);
    });
  });

  describe("Token Balance Query Tests", function () {
    it("Should query token balance via encoder", async function () {
      // This tests the _getTokenBalance internal function
      // by calling encodeUseAllBalanceSwap which uses it
      // Note: When called from test, it reads test account's balance (not WalletBundler)
      const fee = 3000;

      const result = await uniswapEncoder.encodeUseAllBalanceSwap(
        WETH,
        USDC,
        fee,
        0
      );

      // Should successfully read balance (test account has WETH on Hardhat)
      expect(result.target).to.equal(UNISWAP_ROUTER);
      console.log(`✓ Balance query working (returned ${ethers.utils.formatUnits(result.inputAmount, 18)} WETH)`);
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

  describe("Precompiled Execution Plan Tests", function () {
    it("Should decode and validate encoderData from createEncoderExecutionPlan", async function () {
      console.log("\n📋 Testing precompiled execution plan:");
      console.log(`  Steps: ${encodeAndExecuteArgs.metadata.steps}`);
      console.log(`  Route type: ${encodeAndExecuteArgs.metadata.routeType}`);
      console.log(`  Expected output: ${encodeAndExecuteArgs.metadata.expectedOutput}`);

      // Replace placeholder encoder addresses with deployed ones
      const encoderTargets = encodeAndExecuteArgs.encoderTargets.map(target => {
        if (target === '0x0000000000000000000000000000000000000001') {
          return balancerEncoder.address;
        } else if (target === '0x0000000000000000000000000000000000000002') {
          return uniswapEncoder.address;
        }
        return target;
      });

      console.log(`\n  Encoder targets (${encoderTargets.length} steps):`);
      encoderTargets.forEach((target, i) => {
        const protocol = target === uniswapEncoder.address ? 'Uniswap' : 'Balancer';
        const wrapOp = encodeAndExecuteArgs.wrapOperations[i];
        const wrapNames = ['None', 'Wrap before', 'Wrap after', 'Unwrap before', 'Unwrap after'];
        console.log(`    ${i + 1}. ${protocol} - Wrap op: ${wrapNames[wrapOp]}`);
      });

      // Test each encoder call
      for (let i = 0; i < encoderTargets.length; i++) {
        const target = encoderTargets[i];
        const data = encodeAndExecuteArgs.encoderData[i];

        console.log(`\n  Testing step ${i + 1}:`);
        console.log(`    Encoder: ${target === uniswapEncoder.address ? 'Uniswap' : 'Balancer'}`);

        // Call the encoder contract to decode and validate
        const result = await ethers.provider.call({
          to: target,
          data: data
        });

        // Decode the result (target, callData, inputAmount, tokenIn)
        const decoded = ethers.utils.defaultAbiCoder.decode(
          ['address', 'bytes', 'uint256', 'address'],
          result
        );

        console.log(`    ✓ Target DEX: ${decoded[0]}`);
        console.log(`    ✓ Input amount: ${ethers.utils.formatUnits(decoded[2], 18)}`);
        console.log(`    ✓ Token in: ${decoded[3]}`);
        console.log(`    ✓ Calldata length: ${decoded[1].length} bytes`);

        expect(decoded[0]).to.not.equal(ethers.constants.AddressZero);
        expect(decoded[1].length).to.be.greaterThan(2);
      }

      console.log("\n  ✅ All encoder calls validated successfully");
    });

    it("Should verify wrap operations sequence", async function () {
      const wrapOps = encodeAndExecuteArgs.wrapOperations;

      console.log("\n🔄 Wrap operations analysis:");
      wrapOps.forEach((op, i) => {
        const opNames = {
          0: 'No operation',
          1: 'Wrap ETH→WETH before',
          2: 'Wrap ETH→WETH after',
          3: 'Unwrap WETH→ETH before',
          4: 'Unwrap WETH→ETH after'
        };
        console.log(`  Step ${i + 1}: ${opNames[op]}`);
      });

      // Verify operations are valid (0-4)
      wrapOps.forEach(op => {
        expect(op).to.be.gte(0);
        expect(op).to.be.lte(4);
      });

      console.log("  ✅ All wrap operations valid");
    });
  });
});
