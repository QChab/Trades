const { ethers } = require("hardhat");
const { expect } = require("chai");

describe("Uniswap V4 SETTLE_ALL Diagnostic", function() {
  let walletBundler;
  let uniswapEncoder;
  let owner;

  // Mainnet addresses
  const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7";
  const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const ETH = "0x0000000000000000000000000000000000000000";
  const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
  const UNIVERSAL_ROUTER = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af";
  const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";

  before(async function() {
    [owner] = await ethers.getSigners();

    console.log("\n🔍 Diagnostic Setup:");
    console.log(`   Owner: ${owner.address}`);
    console.log(`   ETH Balance: ${ethers.utils.formatEther(await owner.getBalance())} ETH`);
  });

  it("Should check Permit2 allowances for Universal Router", async function() {
    const permit2 = await ethers.getContractAt(
      ["function allowance(address,address,address) view returns (uint160,uint48,uint48)"],
      PERMIT2
    );

    console.log("\n📋 Checking Permit2 Allowances:");

    // Check USDT → Universal Router
    const usdtAllowance = await permit2.allowance(owner.address, USDT, UNIVERSAL_ROUTER);
    console.log(`   USDT → Universal Router: ${usdtAllowance[0].toString()}`);

    // Check USDT → PoolManager
    const usdtPMAllowance = await permit2.allowance(owner.address, USDT, POOL_MANAGER);
    console.log(`   USDT → PoolManager: ${usdtPMAllowance[0].toString()}`);
  });

  it("Should test SETTLE_ALL parameter encoding", async function() {
    const uniswapEncoderFactory = await ethers.getContractFactory("UniswapEncoder");
    uniswapEncoder = await uniswapEncoderFactory.deploy();
    await uniswapEncoder.deployed();

    console.log("\n🔬 Testing SETTLE_ALL Encoding:");
    console.log(`   UniswapEncoder deployed at: ${uniswapEncoder.address}`);

    // Create a test swap: ETH → USDT
    const poolKey = {
      currency0: ETH,
      currency1: USDT,
      fee: 3000,
      tickSpacing: 60,
      hooks: ETH
    };

    const amountIn = ethers.utils.parseEther("0.01");
    const minAmountOut = ethers.utils.parseUnits("25", 6); // 25 USDT

    const swapParams = {
      poolKey: poolKey,
      zeroForOne: true, // ETH (currency0) → USDT (currency1)
      amountIn: amountIn,
      minAmountOut: minAmountOut,
      tokenIn: ETH // This is the key parameter
    };

    console.log("\n   Swap Parameters:");
    console.log(`     Currency0: ${poolKey.currency0}`);
    console.log(`     Currency1: ${poolKey.currency1}`);
    console.log(`     zeroForOne: ${swapParams.zeroForOne}`);
    console.log(`     tokenIn: ${swapParams.tokenIn}`);
    console.log(`     amountIn: ${amountIn.toString()}`);

    const result = await uniswapEncoder.callStatic.encodeSingleSwap(swapParams);

    console.log("\n   Encoded Result:");
    console.log(`     target: ${result[0]}`);
    console.log(`     inputAmount: ${result[2].toString()}`);
    console.log(`     tokenIn: ${result[3]}`);

    // Decode the calldata to inspect SETTLE_ALL params
    const iface = new ethers.utils.Interface([
      "function execute(bytes commands, bytes[] inputs, uint256 deadline)"
    ]);

    const decoded = iface.decodeFunctionData("execute", result[1]);
    console.log("\n   Decoded execute() call:");
    console.log(`     commands: ${decoded.commands}`);
    console.log(`     deadline: ${decoded.deadline.toString()}`);

    // Decode the inputs array
    const inputsDecoded = ethers.utils.defaultAbiCoder.decode(
      ["bytes", "bytes[]"],
      decoded.inputs[0]
    );

    console.log(`\n   Actions: ${inputsDecoded[0]}`);
    console.log(`   Params count: ${inputsDecoded[1].length}`);

    // Decode each param
    inputsDecoded[1].forEach((param, idx) => {
      console.log(`\n   Param ${idx}:`);
      console.log(`     Raw: ${param}`);

      if (idx === 1) {
        // This is SETTLE_ALL - decode as (address currency, uint256 amount)
        try {
          const settleDecoded = ethers.utils.defaultAbiCoder.decode(
            ["address", "uint256"],
            param
          );
          console.log(`     Currency: ${settleDecoded[0]}`);
          console.log(`     Amount: ${settleDecoded[1].toString()}`);
        } catch (e) {
          console.log(`     Decode error: ${e.message}`);
        }
      }
    });
  });

  it("Should test alternative SETTLE_ALL encoding (currency only)", async function() {
    console.log("\n🧪 Testing Alternative SETTLE_ALL Encoding (currency only):");

    // What if SETTLE_ALL only needs currency, not amount?
    const currencyOnly = ethers.utils.defaultAbiCoder.encode(["address"], [ETH]);
    console.log(`   Currency-only encoding: ${currencyOnly}`);

    const currencyBool = ethers.utils.defaultAbiCoder.encode(["address", "bool"], [ETH, true]);
    console.log(`   Currency + bool encoding: ${currencyBool}`);
  });

  it("Should check if tokenIn matches swap direction", async function() {
    console.log("\n🎯 Checking tokenIn Logic:");

    // Scenario 1: ETH → USDT
    console.log("\n   Scenario 1: User swaps ETH → USDT");
    console.log(`     currency0: ${ETH} (ETH)`);
    console.log(`     currency1: ${USDT} (USDT)`);
    console.log(`     zeroForOne: true`);
    console.log(`     tokenIn should be: ${ETH}`);
    console.log(`     SETTLE_ALL should settle: ${ETH}`);

    // Scenario 2: USDT → ETH
    console.log("\n   Scenario 2: User swaps USDT → ETH");
    console.log(`     currency0: ${ETH} (ETH)`);
    console.log(`     currency1: ${USDT} (USDT)`);
    console.log(`     zeroForOne: false`);
    console.log(`     tokenIn should be: ${USDT}`);
    console.log(`     SETTLE_ALL should settle: ${USDT}`);
  });
});
