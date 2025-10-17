import hre from "hardhat";
const { ethers } = hre;

async function main() {
  const txHash = "0x86a8a8d42530b542d540a934a699c66319bffeb42e789229202edc48f40ccf74";

  console.log("Fetching transaction...");
  const provider = ethers.provider;
  const tx = await provider.getTransaction(txHash);

  if (!tx) {
    console.log("Transaction not found");
    return;
  }

  console.log("\nTransaction Details:");
  console.log("From:", tx.from);
  console.log("To:", tx.to);
  console.log("Value:", ethers.utils.formatEther(tx.value), "ETH");
  console.log("Gas Limit:", tx.gasLimit.toString());

  // Get transaction receipt
  const receipt = await provider.getTransactionReceipt(txHash);

  if (receipt) {
    console.log("\nTransaction Status:", receipt.status === 1 ? "✅ SUCCESS" : "❌ FAILED");
    console.log("Gas Used:", receipt.gasUsed.toString());
    console.log("Block:", receipt.blockNumber);

    if (receipt.status === 0) {
      console.log("\n🔍 Transaction reverted. Attempting to decode error...");

      try {
        // Replay the transaction to get the revert reason
        await provider.call(tx, tx.blockNumber);
      } catch (error) {
        console.log("\n❌ Revert Reason:");
        console.log(error.message);

        // Try to decode custom error
        if (error.data) {
          console.log("\nRaw Error Data:", error.data);

          // Check for common errors
          if (error.data === "0x") {
            console.log("Empty revert (no message)");
          } else if (error.data.startsWith("0x08c379a0")) {
            // Standard revert with string message
            const reason = ethers.utils.defaultAbiCoder.decode(
              ["string"],
              "0x" + error.data.slice(10)
            );
            console.log("Decoded message:", reason[0]);
          } else {
            console.log("Custom error selector:", error.data.slice(0, 10));
          }
        }
      }
    }
  } else {
    console.log("\n⏳ Transaction still pending or not mined yet");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
