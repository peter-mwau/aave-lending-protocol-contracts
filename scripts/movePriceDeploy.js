require("dotenv").config();
require("@nomicfoundation/hardhat-ethers");
const hre = require("hardhat");
const { ethers, network } = hre;

async function main() {
    const MovePrice = await ethers.getContractFactory("MovePrice");
    const movePrice = await MovePrice.deploy();
    await movePrice.waitForDeployment();

    console.log("MovePrice deployed to:", await movePrice.getAddress());
}
main().catch(console.error);