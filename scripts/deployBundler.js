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
  const priorityFee = ethers.BigNumber.from(1000); // Minimum priority fee (0 gwei)
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

  // Deploy WalletBundler
  console.log("4️⃣  Deploying WalletBundler...");
  const WalletBundler = await ethers.getContractFactory("WalletBundler");
  const walletBundler = await WalletBundler.deploy(gasParams);
  await walletBundler.deployed();
  console.log(`   ✓ WalletBundler: ${walletBundler.address}`);

  const bundlerReceipt = await walletBundler.deployTransaction.wait();
  const bundlerGasCost = bundlerReceipt.gasUsed.mul(bundlerReceipt.effectiveGasPrice);
  console.log(`   Gas used: ${bundlerReceipt.gasUsed.toString()}`);
  console.log(`   Gas cost: ${ethers.utils.formatEther(bundlerGasCost)} ETH\n`);

  // Calculate total costs
  const totalGasCost = bundlerGasCost;
  const totalGasUsed = bundlerReceipt.gasUsed;

  console.log("=====================================");
  console.log("📊 Deployment Summary");
  console.log("=====================================\n");
  console.log("Contract Addresses:");
  console.log(`  WalletBundler:    ${walletBundler.address}\n`);

  console.log("Gas Statistics:");
  console.log(`  Total Gas Used:   ${totalGasUsed.toString()}`);
  console.log(`  Total Gas Cost:   ${ethers.utils.formatEther(totalGasCost)} ETH`);
  console.log(`  Average Gas Price: ${ethers.utils.formatUnits(totalGasCost.mul(1e9).div(totalGasUsed), "gwei")} gwei\n`);

  console.log("=====================================");
  console.log("✅ Bundler contract deployed successfully!");
  console.log("=====================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
