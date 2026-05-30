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

async function deploymentOverrides(gasLimit) {
    const feeData = await ethers.provider.getFeeData();
    const overrides = { gasLimit };

    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        overrides.maxFeePerGas = feeData.maxFeePerGas;
        overrides.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    } else if (feeData.gasPrice) {
        overrides.gasPrice = feeData.gasPrice;
    }

    return overrides;
}

async function main() {
    const [deployer] = await ethers.getSigners();

    const deploymentRecord = {
        deployer: deployer.address,
        status: "starting",
    };

    try {
        const startRegistryPath = await writeRegistry(network.name, deploymentRecord);

        console.log(`Starting deployment on ${network.name} with deployer:`, deployer.address);
        console.log("Preflight address registry written to:", startRegistryPath);

        const APS = await ethers.getContractFactory("APS");
        console.log("Deploying APS token...");
        const aps = await APS.deploy(await deploymentOverrides(3_000_000));
        const apsDeployTx = aps.deploymentTransaction();
        if (apsDeployTx) {
            console.log("APS deployment tx:", apsDeployTx.hash);
        }
        const apsAddress = await aps.getAddress();
        deploymentRecord.APS = apsAddress;
        deploymentRecord.status = "aps-deployment-broadcast";
        await writeRegistry(network.name, deploymentRecord);
        console.log("APS deployed at:", apsAddress);

        const APSDEX = await ethers.getContractFactory("APSDEX");
        console.log("Deploying APSDEX diamond...");
        const apsDex = await APSDEX.deploy(apsAddress, await deploymentOverrides(8_000_000));
        const apsDexDeployTx = apsDex.deploymentTransaction();
        if (apsDexDeployTx) {
            console.log("APSDEX deployment tx:", apsDexDeployTx.hash);
        }
        const apsDexAddress = await apsDex.getAddress();
        deploymentRecord.APSDEX = apsDexAddress;
        const constructorAddresses = deriveConstructorCreateAddresses(apsDexAddress);
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
        deploymentRecord.status = "apsdex-deployment-broadcast";
        await writeRegistry(network.name, deploymentRecord);

        console.log("Predicted constructor facet addresses:", deploymentRecord.Facets);
        await apsDex.waitForDeployment();
        console.log("APSDEX deployed at:", apsDexAddress);

        deploymentRecord.status = "aps-and-apsdex-deployed";

        const registryPath = await writeRegistry(network.name, deploymentRecord);

        console.log("APS deployed to:", apsAddress);
        console.log("APSDEX diamond deployed to:", apsDexAddress);
        console.log("Diamond init deployed to:", constructorAddresses.DiamondInit);
        console.log("Facet addresses:", deploymentRecord.Facets);
        console.log("Progress written to registry:", registryPath);

        const lendingFacet = await ethers.getContractAt("LendingFacet", apsDexAddress);
        const movePriceFacet = await ethers.getContractAt("MovePriceFacet", apsDexAddress);
        const flashLoanFacet = await ethers.getContractAt("FlashLoanFacet", apsDexAddress);

        console.log("Initializing LendingFacet...");
        await lendingFacet.initializeLending(apsAddress, apsDexAddress);
        console.log("Initializing MovePriceFacet...");
        await movePriceFacet.initializeMovePrice(apsAddress, apsDexAddress);

        console.log("Resolving flash-loan pool address...");
        const flashLoanPool = await resolveFlashLoanPoolAddress();
        deploymentRecord.FlashLoanPool = flashLoanPool.poolAddress;

        if (flashLoanPool.mockPoolAddress) {
            deploymentRecord.MockPool = flashLoanPool.mockPoolAddress;
            deploymentRecord.MockPoolAddressesProvider = flashLoanPool.mockProviderAddress;
        }

        deploymentRecord.status = "flash-loan-pool-resolved";
        await writeRegistry(network.name, deploymentRecord);

        console.log("Initializing FlashLoanFacet...");
        await flashLoanFacet.initializeFlashLoan(flashLoanPool.poolAddress);

        deploymentRecord.status = "complete";

        const finalRegistryPath = await writeRegistry(network.name, deploymentRecord);

        console.log("APS deployed to:", apsAddress);
        console.log("APSDEX diamond deployed to:", apsDexAddress);
        console.log("Diamond init deployed to:", constructorAddresses.DiamondInit);
        console.log("Facet addresses:", deploymentRecord.Facets);
        console.log("Address registry written to:", finalRegistryPath);
    } catch (error) {
        deploymentRecord.status = "failed";
        deploymentRecord.error = error instanceof Error ? error.message : String(error);

        try {
            await writeRegistry(network.name, deploymentRecord);
        } catch (registryError) {
            console.error("Failed to persist deployment failure state:", registryError);
        }

        throw error;
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
