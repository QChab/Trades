import hre from "hardhat";
const { ethers } = hre;

/**
 * DEPRECATED: This script is no longer needed!
 *
 * WalletBundler now automatically registers itself in the BundlerRegistry
 * during deployment (in its constructor). This script can be used only if
 * you need to manually re-register for some reason.
 *
 * To deploy a new WalletBundler that auto-registers:
 *   npx hardhat run scripts/deployBundler.js --network mainnet
 */
async function main() {
  console.log("\n⚠️  WARNING: This script is DEPRECATED!");
  console.log("WalletBundler now auto-registers on deployment.");
  console.log("Use this only if you need to manually update registration.\n");

  console.log("📝 Manually Registering WalletBundler in BundlerRegistry");
  console.log("===============================================\n");

  const [deployer] = await ethers.getSigners();
  console.log("Wallet address:", deployer.address);

  // Contract addresses (from deployment)
  const BUNDLER_REGISTRY_ADDRESS = '0x4df4B688d6F7954F6F53787B2e2778720BaB5d28';
  const WALLET_BUNDLER_ADDRESS = '0x5EA02971E1e0d02FA6fbb106D3076414e071f4eE';

  console.log("BundlerRegistry:", BUNDLER_REGISTRY_ADDRESS);
  console.log("WalletBundler:", WALLET_BUNDLER_ADDRESS);

  // Get registry contract
  const registryArtifact = await hre.artifacts.readArtifact("BundlerRegistry");
  const registry = new ethers.Contract(
    BUNDLER_REGISTRY_ADDRESS,
    registryArtifact.abi,
    deployer
  );

  // Check if already registered
  console.log("\nChecking current registration...");
  const currentBundler = await registry.readAddress(deployer.address);

  if (currentBundler !== ethers.constants.AddressZero) {
    console.log(`⚠️  Wallet already has registered bundler: ${currentBundler}`);
    if (currentBundler === WALLET_BUNDLER_ADDRESS) {
      console.log("✅ Already registered correctly!\n");
      return;
    } else {
      console.log("⚠️  Overwriting with new bundler address...");
    }
  } else {
    console.log("✓ No bundler registered yet");
  }

  // Fetch gas prices for minimal cost
  console.log("\n⛽ Fetching gas prices...");
  const feeData = await ethers.provider.getFeeData();
  const baseFee = feeData.lastBaseFeePerGas || ethers.BigNumber.from(0);
  const priorityFee = ethers.BigNumber.from(10);
  const maxFeePerGas = baseFee.mul(2).add(priorityFee);

  console.log(`  Base Fee: ${ethers.utils.formatUnits(baseFee, "gwei")} gwei`);
  console.log(`  Max Fee: ${ethers.utils.formatUnits(maxFeePerGas, "gwei")} gwei`);

  // Store the bundler address (manual override - usually not needed)
  console.log("\n📤 Manually storing bundler address...");
  const tx = await registry.storeAddress(WALLET_BUNDLER_ADDRESS, {
    maxFeePerGas: maxFeePerGas,
    maxPriorityFeePerGas: priorityFee
  });

  console.log(`  Transaction hash: ${tx.hash}`);
  console.log("  Waiting for confirmation...");

  const receipt = await tx.wait();

  console.log(`  ✅ Confirmed in block ${receipt.blockNumber}`);
  console.log(`  Gas used: ${receipt.gasUsed.toString()}`);
  console.log(`  Gas cost: ${ethers.utils.formatEther(receipt.gasUsed.mul(receipt.effectiveGasPrice))} ETH`);

  // Verify storage
  console.log("\n🔍 Verifying registration...");
  const storedBundler = await registry.readAddress(deployer.address);

  if (storedBundler === WALLET_BUNDLER_ADDRESS) {
    console.log("✅ Registration verified!");
    console.log(`   Wallet: ${deployer.address}`);
    console.log(`   Bundler: ${storedBundler}`);
  } else {
    console.log("❌ Registration failed!");
    console.log(`   Expected: ${WALLET_BUNDLER_ADDRESS}`);
    console.log(`   Got: ${storedBundler}`);
  }

  console.log("\n===============================================");
  console.log("✅ Registration complete!\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
