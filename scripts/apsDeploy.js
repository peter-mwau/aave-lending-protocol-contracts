require("dotenv").config();
require("@nomicfoundation/hardhat-ethers");
const hre = require("hardhat");
const { ethers, network } = hre;

async function main() {
    const APS = await ethers.getContractFactory("APS");
    const aps = await APS.deploy();
    await aps.waitForDeployment();

    console.log("APS deployed to:", await aps.getAddress());
}
main().catch(console.error);