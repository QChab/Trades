import hre from "hardhat";
const { ethers } = hre;

/**
 * Deploy ONLY the encoder contracts (UniswapEncoder and BalancerEncoder)
 * Used for redeployment after contract updates
 */
async function main() {
  console.log("\n📦 Deploying Encoder Contracts to Mainnet");
  console.log("=========================================\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer address:", deployer.address);

  // Check balance
  const balance = await deployer.getBalance();
  console.log("Deployer balance:", ethers.utils.formatEther(balance), "ETH\n");

  if (balance.lt(ethers.utils.parseEther("0.0001"))) {
    throw new Error("Insufficient balance. Need at least 0.01 ETH for deployment.");
  }

  // Fetch current gas prices
  console.log("⛽ Fetching gas prices...");
  const feeData = await ethers.provider.getFeeData();

  const baseFee = feeData.lastBaseFeePerGas || ethers.BigNumber.from(0);
  const priorityFee = ethers.BigNumber.from(10000000); // Minimum priority fee
  const maxFeePerGas = baseFee.mul(2).add(priorityFee); // 2x base fee buffer + minimal priority

  console.log(`  Base Fee: ${ethers.utils.formatUnits(baseFee, "gwei")} gwei`);
  console.log(`  Priority Fee: ${ethers.utils.formatUnits(priorityFee, "gwei")} gwei (minimum)`);
  console.log(`  Max Fee: ${ethers.utils.formatUnits(maxFeePerGas, "gwei")} gwei\n`);

  const gasParams = {
    maxFeePerGas: maxFeePerGas,
    maxPriorityFeePerGas: priorityFee,
    gasLimit: undefined // Let ethers estimate
  };

  // Deploy UniswapEncoder
  console.log("1️⃣  Deploying UniswapEncoder...");
  const UniswapEncoder = await ethers.getContractFactory("UniswapEncoder");
  const uniswapEncoder = await UniswapEncoder.deploy(gasParams);
  await uniswapEncoder.deployed();
  console.log(`   ✓ UniswapEncoder deployed: ${uniswapEncoder.address}`);

  const uniswapReceipt = await uniswapEncoder.deployTransaction.wait();
  const uniswapGasCost = uniswapReceipt.gasUsed.mul(uniswapReceipt.effectiveGasPrice);
  console.log(`   Gas used: ${uniswapReceipt.gasUsed.toString()}`);
  console.log(`   Gas cost: ${ethers.utils.formatEther(uniswapGasCost)} ETH\n`);

  // Deploy BalancerEncoder
  // console.log("2️⃣  Deploying BalancerEncoder...");
  // const BalancerEncoder = await ethers.getContractFactory("BalancerEncoder");
  // const balancerEncoder = await BalancerEncoder.deploy(gasParams);
  // await balancerEncoder.deployed();
  // console.log(`   ✓ BalancerEncoder deployed: ${balancerEncoder.address}`);

  // const balancerReceipt = await balancerEncoder.deployTransaction.wait();
  // const balancerGasCost = balancerReceipt.gasUsed.mul(balancerReceipt.effectiveGasPrice);
  // console.log(`   Gas used: ${balancerReceipt.gasUsed.toString()}`);
  // console.log(`   Gas cost: ${ethers.utils.formatEther(balancerGasCost)} ETH\n`);

  console.log("=========================================");
  console.log("✅ Encoders deployed successfully!");
  console.log("=========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
