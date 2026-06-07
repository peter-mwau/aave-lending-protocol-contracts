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

async function tryInitializeApsDexPool(aps, apsDexFacet, deployer, deploymentRecord) {
    if (await apsDexFacet.initialized()) {
        deploymentRecord.APSDEXPool = {
            attempted: false,
            initialized: true,
            reason: "Pool was already initialized.",
        };
        console.log("APSDEX pool initialization status:", deploymentRecord.APSDEXPool);
        console.log("APSDEX pool is already initialized.");
        return;
    }

    const initialEth = process.env.APSDEX_INITIAL_ETH;
    const initialAps = process.env.APSDEX_INITIAL_APS;

    if (!initialEth || !initialAps) {
        deploymentRecord.APSDEXPool = {
            attempted: false,
            initialized: false,
            reason: "Set APSDEX_INITIAL_ETH and APSDEX_INITIAL_APS to auto-initialize the pool after deployment.",
        };
        console.log("APSDEX pool initialization status:", deploymentRecord.APSDEXPool);
        console.log("Skipping APSDEX pool initialization; frontend can initialize it later.");
        return;
    }

    const ethValue = ethers.parseEther(initialEth);
    const apsAmount = ethers.parseEther(initialAps);

    try {
        console.log(`Initializing APSDEX pool with ${initialEth} ETH and ${initialAps} APS...`);
        await aps.connect(deployer).approve(await apsDexFacet.getAddress(), apsAmount);
        const tx = await apsDexFacet.initializePool(apsAmount, { value: ethValue });
        await tx.wait();

        deploymentRecord.APSDEXPool = {
            attempted: true,
            initialized: true,
            ethAmount: initialEth,
            apsAmount: initialAps,
        };
        console.log("APSDEX pool initialization status:", deploymentRecord.APSDEXPool);
        console.log("APSDEX pool initialized during deployment.");
    } catch (error) {
        deploymentRecord.APSDEXPool = {
            attempted: true,
            initialized: false,
            ethAmount: initialEth,
            apsAmount: initialAps,
            error: error instanceof Error ? error.message : String(error),
        };
        console.log("APSDEX pool initialization status:", deploymentRecord.APSDEXPool);
        console.warn("APSDEX pool initialization failed; deployment continues so it can be initialized from the frontend.");
    }
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
        const aps = await APS.deploy();
        await aps.waitForDeployment();
        const apsAddress = await aps.getAddress();

        deploymentRecord.APS = apsAddress;
        deploymentRecord.status = "aps-deployed";
        await writeRegistry(network.name, deploymentRecord);

        console.log("Deploying APSDEX diamond...");
        const APSDEX = await ethers.getContractFactory("APSDEX");
        const apsDex = await APSDEX.deploy(apsAddress);
        await apsDex.waitForDeployment();
        const apsDexAddress = await apsDex.getAddress();

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

        await tryInitializeApsDexPool(aps, apsDexFacet, deployer, deploymentRecord);

        deploymentRecord.FlashLoanPool = flashLoanPool.poolAddress;

        if (flashLoanPool.mockPoolAddress) {
            deploymentRecord.MockPool = flashLoanPool.mockPoolAddress;
            deploymentRecord.MockPoolAddressesProvider = flashLoanPool.mockProviderAddress;
        }

        deploymentRecord.status = "complete";

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