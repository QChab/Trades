import hre from "hardhat";
const { ethers } = hre;

/**
 * Deploy encoder contracts to mainnet with minimal gas cost
 * Uses base fee only, no priority fee
 */
async function main() {
  console.log("\n📦 Deploying Encoder System to Mainnet");
  console.log("=====================================\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer address:", deployer.address);

  // Check balance
  const balance = await deployer.getBalance();
  console.log("Deployer balance:", ethers.utils.formatEther(balance), "ETH\n");

  // Fetch current gas prices
  console.log("⛽ Fetching gas prices...");
  const feeData = await ethers.provider.getFeeData();

  const baseFee = feeData.lastBaseFeePerGas || ethers.BigNumber.from(0);
  const priorityFee = ethers.BigNumber.from(10); // Minimum priority fee (0 gwei)
  const maxFeePerGas = baseFee.mul(2).add(priorityFee); // 2x base fee buffer + 0 priority

  console.log(`  Base Fee: ${ethers.utils.formatUnits(baseFee, "gwei")} gwei`);
  console.log(`  Priority Fee: ${ethers.utils.formatUnits(priorityFee, "gwei")} gwei (minimum)`);
  console.log(`  Max Fee: ${ethers.utils.formatUnits(maxFeePerGas, "gwei")} gwei`);
  console.log(`  Suggested Max Priority: ${ethers.utils.formatUnits(feeData.maxPriorityFeePerGas || 0, "gwei")} gwei (not using)\n`);

  const gasParams = {
    maxFeePerGas: maxFeePerGas,
    maxPriorityFeePerGas: priorityFee,
    gasLimit: undefined // Let ethers estimate
  };

  // Deploy BundlerRegistry
  console.log("1️⃣  Deploying BundlerRegistry...");
  const BundlerRegistry = await ethers.getContractFactory("BundlerRegistry");
  const bundlerRegistry = await BundlerRegistry.deploy(gasParams);
  await bundlerRegistry.deployed();
  console.log(`   ✓ BundlerRegistry: ${bundlerRegistry.address}`);

  const registryReceipt = await bundlerRegistry.deployTransaction.wait();
  const registryGasCost = registryReceipt.gasUsed.mul(registryReceipt.effectiveGasPrice);
  console.log(`   Gas used: ${registryReceipt.gasUsed.toString()}`);
  console.log(`   Gas cost: ${ethers.utils.formatEther(registryGasCost)} ETH\n`);

  console.log("=====================================");
  console.log("✅ All contracts deployed successfully!");
  console.log("=====================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
