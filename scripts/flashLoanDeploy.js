require("dotenv").config();
require("@nomicfoundation/hardhat-ethers");
const hre = require("hardhat");
const { ethers, network } = hre;

async function resolveAddressProvider() {
    if (process.env.AAVE_PROVIDER_ADDRESS) {
        return process.env.AAVE_PROVIDER_ADDRESS;
    }

    if (network.name === "localhost" || network.name === "hardhat") {
        const MockPool = await ethers.getContractFactory("MockPool");
        const mockPool = await MockPool.deploy({ gasLimit: 2_000_000 });
        await mockPool.waitForDeployment();

        const MockPoolAddressesProvider = await ethers.getContractFactory("MockPoolAddressesProvider");
        const mockProvider = await MockPoolAddressesProvider.deploy(await mockPool.getAddress(), {
            gasLimit: 2_000_000
        });
        await mockProvider.waitForDeployment();

        const providerAddress = await mockProvider.getAddress();
        console.log("Using local mock Aave provider:", providerAddress);
        return providerAddress;
    }

    throw new Error("Missing AAVE_PROVIDER_ADDRESS for this network");
}

async function main() {
    const addressProviderInput = await resolveAddressProvider();
    const addressProvider = ethers.getAddress(addressProviderInput);
    const FlashLoan = await ethers.getContractFactory("FlashLoan");

    const flashLoan = await FlashLoan.deploy(
        addressProvider,
        {
            gasLimit: 16_000_000
        }
    );

    await flashLoan.waitForDeployment();

    console.log("FlashLoan deployed to:", await flashLoan.getAddress());
}

main().catch(console.error);