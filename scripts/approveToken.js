import hre from "hardhat";
const { ethers } = hre;

/**
 * Script to approve ERC20 token spending for WalletBundler
 *
 * Usage:
 *   npx hardhat run scripts/approveToken.js --network mainnet
 *
 * Configuration:
 *   Edit the PARAMS object below to set token address and bundler address
 */

// ===== CONFIGURATION =====
const PARAMS = {
  // Token to approve (change this to the token you want to trade)
  tokenAddress: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', // ONE token example
  tokenSymbol: 'AAVE', // For display purposes only

  // Your WalletBundler address
  bundlerAddress: '0x8B9Af27381b9a12cB20b2b09ae005dC7f0c2eac8',

  // Amount to approve (leave as 'max' for unlimited, or specify a number like '1000')
  approvalAmount: 'max'
};

// ===== SCRIPT =====
async function main() {
  console.log("\n🔓 Approving Token for WalletBundler\n");

  // Get signer (your wallet)
  const [signer] = await ethers.getSigners();
  console.log(`Wallet Address: ${signer.address}`);

  // Validate addresses
  if (!ethers.utils.isAddress(PARAMS.tokenAddress)) {
    throw new Error(`Invalid token address: ${PARAMS.tokenAddress}`);
  }
  if (!ethers.utils.isAddress(PARAMS.bundlerAddress)) {
    throw new Error(`Invalid bundler address: ${PARAMS.bundlerAddress}`);
  }

  // Create token contract instance
  const tokenContract = await ethers.getContractAt(
    [
      "function approve(address spender, uint256 amount) external returns (bool)",
      "function allowance(address owner, address spender) external view returns (uint256)",
      "function balanceOf(address account) external view returns (uint256)",
      "function decimals() external view returns (uint8)",
      "function symbol() external view returns (string)"
    ],
    PARAMS.tokenAddress,
    signer
  );

  // Get token info
  let tokenSymbol, tokenDecimals;
  try {
    tokenSymbol = await tokenContract.symbol();
    tokenDecimals = await tokenContract.decimals();
    console.log(`Token: ${tokenSymbol} (${PARAMS.tokenAddress})`);
    console.log(`Decimals: ${tokenDecimals}`);
  } catch (error) {
    console.warn(`Could not fetch token info, using defaults`);
    tokenSymbol = PARAMS.tokenSymbol;
    tokenDecimals = 18;
  }

  // Check current balance
  try {
    const balance = await tokenContract.balanceOf(signer.address);
    console.log(`Your Balance: ${ethers.utils.formatUnits(balance, tokenDecimals)} ${tokenSymbol}`);
  } catch (error) {
    console.warn(`Could not fetch balance: ${error.message}`);
  }

  // Check current allowance
  console.log(`\nChecking current allowance...`);
  let currentAllowance;
  try {
    currentAllowance = await tokenContract.allowance(signer.address, PARAMS.bundlerAddress);
    console.log(`Current Allowance: ${ethers.utils.formatUnits(currentAllowance, tokenDecimals)} ${tokenSymbol}`);
  } catch (error) {
    console.warn(`Could not check allowance: ${error.message}`);
    currentAllowance = ethers.BigNumber.from(0);
  }

  // Determine approval amount
  let approvalAmount;
  if (PARAMS.approvalAmount === 'max') {
    approvalAmount = ethers.constants.MaxUint256;
    console.log(`Approval Amount: MAX (unlimited)`);
  } else {
    approvalAmount = ethers.utils.parseUnits(PARAMS.approvalAmount, tokenDecimals);
    console.log(`Approval Amount: ${PARAMS.approvalAmount} ${tokenSymbol}`);
  }

  // Skip if already approved for enough
  if (currentAllowance.gte(approvalAmount) && !approvalAmount.eq(ethers.constants.MaxUint256)) {
    console.log(`\n✅ Already approved for sufficient amount. No action needed.`);
    return;
  }

  // Execute approval
  console.log(`\n📝 Executing approval transaction...`);
  console.log(`   Spender: ${PARAMS.bundlerAddress}`);
  console.log(`   Amount: ${PARAMS.approvalAmount === 'max' ? 'MAX' : `${PARAMS.approvalAmount} ${tokenSymbol}`}`);

  // Get gas price
  const gasPrice = await ethers.provider.getGasPrice();
  console.log(`   Gas Price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei`);

  try {
    const tx = await tokenContract.approve(PARAMS.bundlerAddress, approvalAmount, {
      gasPrice: gasPrice.mul(140).div(100) // 10% buffer
    });

    console.log(`\n🚀 Transaction sent: ${tx.hash}`);
    console.log(`   Waiting for confirmation...`);

    const receipt = await tx.wait();

    console.log(`\n✅ Approval successful!`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);
    console.log(`   Gas Cost: ${ethers.utils.formatEther(receipt.gasUsed.mul(receipt.effectiveGasPrice))} ETH`);

    // Verify new allowance
    const newAllowance = await tokenContract.allowance(signer.address, PARAMS.bundlerAddress);
    if (newAllowance.eq(ethers.constants.MaxUint256)) {
      console.log(`   New Allowance: MAX (unlimited)`);
    } else {
      console.log(`   New Allowance: ${ethers.utils.formatUnits(newAllowance, tokenDecimals)} ${tokenSymbol}`);
    }

  } catch (error) {
    console.error(`\n❌ Approval failed:`);
    console.error(`   ${error.message}`);

    if (error.code === 'UNPREDICTABLE_GAS_LIMIT') {
      console.error(`\n   This might be due to:`);
      console.error(`   - Insufficient token balance`);
      console.error(`   - Invalid token contract`);
      console.error(`   - Token has special approval requirements`);
    }

    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
