require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

const infuraValue = process.env.INFURA_RPC_URL;

const sepoliaUrl = infuraValue
  ? (infuraValue.startsWith("http")
    ? infuraValue
    : `https://sepolia.infura.io/v3/${infuraValue}`)
  : null;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.24",
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      accounts: [process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000"]
    },
    monad: {
      url: "https://rpc.monad.xyz",
      accounts
    },
    ...(sepoliaUrl
      ? {
        sepolia: {
          url: sepoliaUrl,
          accounts
        }
      }
      : {})
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY
  }
};