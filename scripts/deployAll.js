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

  // Deploy UniswapEncoder
  console.log("2️⃣  Deploying UniswapEncoder...");
  const UniswapEncoder = await ethers.getContractFactory("UniswapEncoder");
  const uniswapEncoder = await UniswapEncoder.deploy(gasParams);
  await uniswapEncoder.deployed();
  console.log(`   ✓ UniswapEncoder: ${uniswapEncoder.address}`);

  const uniswapReceipt = await uniswapEncoder.deployTransaction.wait();
  const uniswapGasCost = uniswapReceipt.gasUsed.mul(uniswapReceipt.effectiveGasPrice);
  console.log(`   Gas used: ${uniswapReceipt.gasUsed.toString()}`);
  console.log(`   Gas cost: ${ethers.utils.formatEther(uniswapGasCost)} ETH\n`);

  // Deploy BalancerEncoder
  console.log("3️⃣  Deploying BalancerEncoder...");
  const BalancerEncoder = await ethers.getContractFactory("BalancerEncoder");
  const balancerEncoder = await BalancerEncoder.deploy(gasParams);
  await balancerEncoder.deployed();
  console.log(`   ✓ BalancerEncoder: ${balancerEncoder.address}`);

  const balancerReceipt = await balancerEncoder.deployTransaction.wait();
  const balancerGasCost = balancerReceipt.gasUsed.mul(balancerReceipt.effectiveGasPrice);
  console.log(`   Gas used: ${balancerReceipt.gasUsed.toString()}`);
  console.log(`   Gas cost: ${ethers.utils.formatEther(balancerGasCost)} ETH\n`);

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
  const totalGasCost = registryGasCost.add(uniswapGasCost).add(balancerGasCost).add(bundlerGasCost);
  const totalGasUsed = registryReceipt.gasUsed
    .add(uniswapReceipt.gasUsed)
    .add(balancerReceipt.gasUsed)
    .add(bundlerReceipt.gasUsed);

  console.log("=====================================");
  console.log("📊 Deployment Summary");
  console.log("=====================================\n");
  console.log("Contract Addresses:");
  console.log(`  BundlerRegistry:  ${bundlerRegistry.address}`);
  console.log(`  UniswapEncoder:   ${uniswapEncoder.address}`);
  console.log(`  BalancerEncoder:  ${balancerEncoder.address}`);
  console.log(`  WalletBundler:    ${walletBundler.address}\n`);

  console.log("Gas Statistics:");
  console.log(`  Total Gas Used:   ${totalGasUsed.toString()}`);
  console.log(`  Total Gas Cost:   ${ethers.utils.formatEther(totalGasCost)} ETH`);
  console.log(`  Average Gas Price: ${ethers.utils.formatUnits(totalGasCost.mul(1e9).div(totalGasUsed), "gwei")} gwei\n`);

  // Save addresses to file
  const deploymentInfo = {
    network: "mainnet",
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    gasPrice: {
      baseFee: ethers.utils.formatUnits(baseFee, "gwei"),
      priorityFee: ethers.utils.formatUnits(priorityFee, "gwei"),
      maxFee: ethers.utils.formatUnits(maxFeePerGas, "gwei")
    },
    contracts: {
      BundlerRegistry: {
        address: bundlerRegistry.address,
        gasUsed: registryReceipt.gasUsed.toString(),
        gasCost: ethers.utils.formatEther(registryGasCost)
      },
      UniswapEncoder: {
        address: uniswapEncoder.address,
        gasUsed: uniswapReceipt.gasUsed.toString(),
        gasCost: ethers.utils.formatEther(uniswapGasCost)
      },
      BalancerEncoder: {
        address: balancerEncoder.address,
        gasUsed: balancerReceipt.gasUsed.toString(),
        gasCost: ethers.utils.formatEther(balancerGasCost)
      },
      WalletBundler: {
        address: walletBundler.address,
        gasUsed: bundlerReceipt.gasUsed.toString(),
        gasCost: ethers.utils.formatEther(bundlerGasCost)
      }
    },
    totalGasUsed: totalGasUsed.toString(),
    totalGasCost: ethers.utils.formatEther(totalGasCost)
  };

  const fs = await import('fs');
  fs.writeFileSync(
    'deployment-mainnet.json',
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("✓ Deployment info saved to deployment-mainnet.json\n");

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
