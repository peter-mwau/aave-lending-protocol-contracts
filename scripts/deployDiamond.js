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
    const flashLoanPoolAddress = process.env.FLASH_LOAN_POOL_ADDRESS || process.env.AAVE_POOLSEPOLIA_ADDRESS;

    if (flashLoanPoolAddress) {
        return { poolAddress: ethers.getAddress(flashLoanPoolAddress) };
    }

    if (network.name === "localhost" || network.name === "hardhat") {
        return deployMockPool();
    }

    throw new Error(
        `Missing FLASH_LOAN_POOL_ADDRESS for network ${network.name}. Set FLASH_LOAN_POOL_ADDRESS to the Aave pool address before running this deployment.`
    );
}

async function main() {
    const [deployer] = await ethers.getSigners();

    const deploymentRecord = {
        deployer: deployer.address,
        status: "starting",
    };

    const startRegistryPath = await writeRegistry(network.name, deploymentRecord);

    console.log(`Starting deployment on ${network.name} with deployer:`, deployer.address);
    console.log("Preflight address registry written to:", startRegistryPath);

    const APS = await ethers.getContractFactory("APS");
    const aps = await APS.deploy();
    await aps.waitForDeployment();

    const apsAddress = await aps.getAddress();

    const APSDEX = await ethers.getContractFactory("APSDEX");
    const apsDex = await APSDEX.deploy(apsAddress);
    await apsDex.waitForDeployment();

    const apsDexAddress = await apsDex.getAddress();
    deploymentRecord.APS = apsAddress;
    deploymentRecord.APSDEX = apsDexAddress;
    deploymentRecord.status = "aps-and-apsdex-deployed";

    const constructorAddresses = {
        DiamondCutFacet: ethers.getCreateAddress({ from: apsDexAddress, nonce: 1 }),
        DiamondLoupeFacet: ethers.getCreateAddress({ from: apsDexAddress, nonce: 2 }),
        OwnershipFacet: ethers.getCreateAddress({ from: apsDexAddress, nonce: 3 }),
        ApsdexFacet: ethers.getCreateAddress({ from: apsDexAddress, nonce: 4 }),
        DiamondInit: ethers.getCreateAddress({ from: apsDexAddress, nonce: 5 }),
        FlashLoanFacet: ethers.getCreateAddress({ from: apsDexAddress, nonce: 6 }),
        MovePriceFacet: ethers.getCreateAddress({ from: apsDexAddress, nonce: 7 }),
        LendingFacet: ethers.getCreateAddress({ from: apsDexAddress, nonce: 8 }),
    };

    deploymentRecord.DiamondInit = constructorAddresses.DiamondInit;
    deploymentRecord.Facets = {
        DiamondCutFacet: constructorAddresses.DiamondCutFacet,
        DiamondLoupeFacet: constructorAddresses.DiamondLoupeFacet,
        OwnershipFacet: constructorAddresses.OwnershipFacet,
        ApsdexFacet: constructorAddresses.ApsdexFacet,
        FlashLoanFacet: constructorAddresses.FlashLoanFacet,
        MovePriceFacet: constructorAddresses.MovePriceFacet,
        LendingFacet: constructorAddresses.LendingFacet,
    };

    const registryPath = await writeRegistry(network.name, deploymentRecord);

    console.log("APS deployed to:", apsAddress);
    console.log("APSDEX diamond deployed to:", apsDexAddress);
    console.log("Diamond init deployed to:", constructorAddresses.DiamondInit);
    console.log("Facet addresses:", deploymentRecord.Facets);
    console.log("Progress written to registry:", registryPath);

    const apsDexFacet = await ethers.getContractAt("ApsdexFacet", apsDexAddress);
    const lendingFacet = await ethers.getContractAt("LendingFacet", apsDexAddress);
    const movePriceFacet = await ethers.getContractAt("MovePriceFacet", apsDexAddress);
    const flashLoanFacet = await ethers.getContractAt("FlashLoanFacet", apsDexAddress);

    await lendingFacet.initializeLending(apsAddress, apsDexAddress);
    await movePriceFacet.initializeMovePrice(apsAddress, apsDexAddress);

    const flashLoanPool = await resolveFlashLoanPoolAddress();
    await flashLoanFacet.initializeFlashLoan(flashLoanPool.poolAddress);

    deploymentRecord.FlashLoanPool = flashLoanPool.poolAddress;
    deploymentRecord.status = "complete";

    if (flashLoanPool.mockPoolAddress) {
        deploymentRecord.MockPool = flashLoanPool.mockPoolAddress;
        deploymentRecord.MockPoolAddressesProvider = flashLoanPool.mockProviderAddress;
    }

    // Attempt to discover facet addresses via the DiamondLoupeFacet
    try {
        const diamondLoupe = await ethers.getContractAt("DiamondLoupeFacet", apsDexAddress);
        const facetAddrs = await diamondLoupe.facetAddresses();

        const facetNames = [
            "DiamondCutFacet",
            "DiamondLoupeFacet",
            "OwnershipFacet",
            "ApsdexFacet",
            "FlashLoanFacet",
            "MovePriceFacet",
            "LendingFacet",
        ];

        const repSelector = {
            DiamondCutFacet: "diamondCut",
            DiamondLoupeFacet: "facets",
            OwnershipFacet: "owner",
            ApsdexFacet: "token",
            FlashLoanFacet: "initializeFlashLoan",
            MovePriceFacet: "initializeMovePrice",
            LendingFacet: "initializeLending",
        };

        const facets = {};
        for (const name of facetNames) {
            try {
                const factory = await ethers.getContractFactory(name);
                const selector = factory.interface.getSighash(repSelector[name]);
                const addr = await diamondLoupe.facetAddress(selector);
                if (addr && addr !== ethers.ZeroAddress) {
                    facets[name] = addr;
                }
            } catch (e) {
                // ignore missing facet contract in local workspace
            }
        }

        if (Object.keys(facets).length > 0) {
            deploymentRecord.Facets = facets;
            deploymentRecord.FacetAddresses = facetAddrs;
        }
    } catch (err) {
        // non-fatal: if loupe not present or call fails, skip
    }

    const finalRegistryPath = await writeRegistry(network.name, deploymentRecord);

    console.log("APS deployed to:", apsAddress);
    console.log("APSDEX diamond deployed to:", apsDexAddress);
    console.log("Address registry written to:", finalRegistryPath);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
