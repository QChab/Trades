const hre = require("hardhat");

async function main() {
  console.log("Starting deployment...\n");

  // Deploy BundlerRegistry
  console.log("Deploying BundlerRegistry...");
  const BundlerRegistry = await hre.ethers.getContractFactory("BundlerRegistry");
  const registry = await BundlerRegistry.deploy();
  await registry.deployed();
  console.log(`✓ BundlerRegistry deployed to: ${registry.address}\n`);

  // Deploy UniswapEncoder
  console.log("Deploying UniswapEncoder...");
  const UniswapEncoder = await hre.ethers.getContractFactory("UniswapEncoder");
  const uniswapEncoder = await UniswapEncoder.deploy();
  await uniswapEncoder.deployed();
  console.log(`✓ UniswapEncoder deployed to: ${uniswapEncoder.address}\n`);

  // Deploy BalancerEncoder
  console.log("Deploying BalancerEncoder...");
  const BalancerEncoder = await hre.ethers.getContractFactory("BalancerEncoder");
  const balancerEncoder = await BalancerEncoder.deploy();
  await balancerEncoder.deployed();
  console.log(`✓ BalancerEncoder deployed to: ${balancerEncoder.address}\n`);

  // Summary
  console.log("=".repeat(60));
  console.log("Deployment Summary:");
  console.log("=".repeat(60));
  console.log(`BundlerRegistry:  ${registry.address}`);
  console.log(`UniswapEncoder:   ${uniswapEncoder.address}`);
  console.log(`BalancerEncoder:  ${balancerEncoder.address}`);
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
