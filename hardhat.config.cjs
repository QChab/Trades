require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 1
    },
    mainnet: {
      url: process.env.RPC_URL || "https://eth.llamarpc.com",
      accounts: [process.env.PRIVATE_KEY + 'da03e15f59e36a5b66852b5442c72a' + 'a3d']
    }
  }
};