require("dotenv").config();
require("@nomicfoundation/hardhat-ethers");

const hre = require("hardhat");
const { ethers, network } = hre;
const { writeRegistry } = require("./registry");

async function deployMockPool() {
    const MockPool = await ethers.getContractFactory("MockPool");
    const mockPool = await MockPool.deploy({ gasLimit: 2_000_000 });
    await mockPool.waitForDeployment();

    const MockPoolAddressesProvider = await ethers.getContractFactory("MockPoolAddressesProvider");
    const mockProvider = await MockPoolAddressesProvider.deploy(await mockPool.getAddress(), {
        gasLimit: 2_000_000,
    });
    await mockProvider.waitForDeployment();

    return {
        poolAddress: await mockPool.getAddress(),
        providerAddress: await mockProvider.getAddress(),
        mockPoolAddress: await mockPool.getAddress(),
        mockProviderAddress: await mockProvider.getAddress(),
    };
}

async function resolveFlashLoanPoolAddress() {
    if (process.env.FLASH_LOAN_POOL_ADDRESS) {
        return { poolAddress: ethers.getAddress(process.env.FLASH_LOAN_POOL_ADDRESS) };
    }

    if (network.name === "localhost" || network.name === "hardhat") {
        return deployMockPool();
    }

    throw new Error("Missing FLASH_LOAN_POOL_ADDRESS for this network");
}

function deriveConstructorCreateAddresses(diamondAddress) {
    // APSDEX constructor uses CREATE in this order.
    return {
        DiamondCutFacet: ethers.getCreateAddress({ from: diamondAddress, nonce: 1 }),
        DiamondLoupeFacet: ethers.getCreateAddress({ from: diamondAddress, nonce: 2 }),
        OwnershipFacet: ethers.getCreateAddress({ from: diamondAddress, nonce: 3 }),
        ApsdexFacet: ethers.getCreateAddress({ from: diamondAddress, nonce: 4 }),
        DiamondInit: ethers.getCreateAddress({ from: diamondAddress, nonce: 5 }),
        FlashLoanFacet: ethers.getCreateAddress({ from: diamondAddress, nonce: 6 }),
        MovePriceFacet: ethers.getCreateAddress({ from: diamondAddress, nonce: 7 }),
        LendingFacet: ethers.getCreateAddress({ from: diamondAddress, nonce: 8 }),
    };
}

async function main() {
    const [deployer] = await ethers.getSigners();

    const APS = await ethers.getContractFactory("APS");
    const aps = await APS.deploy();
    await aps.waitForDeployment();
    const apsAddress = await aps.getAddress();

    const APSDEX = await ethers.getContractFactory("APSDEX");
    const apsDex = await APSDEX.deploy(apsAddress);
    await apsDex.waitForDeployment();
    const apsDexAddress = await apsDex.getAddress();

    const lendingFacet = await ethers.getContractAt("LendingFacet", apsDexAddress);
    const movePriceFacet = await ethers.getContractAt("MovePriceFacet", apsDexAddress);
    const flashLoanFacet = await ethers.getContractAt("FlashLoanFacet", apsDexAddress);

    await lendingFacet.initializeLending(apsAddress, apsDexAddress);
    await movePriceFacet.initializeMovePrice(apsAddress, apsDexAddress);

    const flashLoanPool = await resolveFlashLoanPoolAddress();
    await flashLoanFacet.initializeFlashLoan(flashLoanPool.poolAddress);

    const constructorAddresses = deriveConstructorCreateAddresses(apsDexAddress);

    const deploymentRecord = {
        deployer: deployer.address,
        APS: apsAddress,
        APSDEX: apsDexAddress,
        DiamondInit: constructorAddresses.DiamondInit,
        DiamondCutFacet: constructorAddresses.DiamondCutFacet,
        DiamondLoupeFacet: constructorAddresses.DiamondLoupeFacet,
        OwnershipFacet: constructorAddresses.OwnershipFacet,
        ApsdexFacet: constructorAddresses.ApsdexFacet,
        FlashLoanFacet: constructorAddresses.FlashLoanFacet,
        MovePriceFacet: constructorAddresses.MovePriceFacet,
        LendingFacet: constructorAddresses.LendingFacet,
        FlashLoanPool: flashLoanPool.poolAddress,
        Facets: {
            DiamondCutFacet: constructorAddresses.DiamondCutFacet,
            DiamondLoupeFacet: constructorAddresses.DiamondLoupeFacet,
            OwnershipFacet: constructorAddresses.OwnershipFacet,
            ApsdexFacet: constructorAddresses.ApsdexFacet,
            FlashLoanFacet: constructorAddresses.FlashLoanFacet,
            MovePriceFacet: constructorAddresses.MovePriceFacet,
            LendingFacet: constructorAddresses.LendingFacet,
        },
    };

    if (flashLoanPool.mockPoolAddress) {
        deploymentRecord.MockPool = flashLoanPool.mockPoolAddress;
        deploymentRecord.MockPoolAddressesProvider = flashLoanPool.mockProviderAddress;
    }

    const registryPath = await writeRegistry(network.name, deploymentRecord);

    console.log("APS deployed to:", apsAddress);
    console.log("APSDEX diamond deployed to:", apsDexAddress);
    console.log("Diamond init deployed to:", constructorAddresses.DiamondInit);
    console.log("Facet addresses:", deploymentRecord.Facets);
    console.log("Address registry written to:", registryPath);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
