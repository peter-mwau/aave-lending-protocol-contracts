// scripts/utils.js
const hre = require("hardhat");
const { ethers, network } = hre;
const fs = require('fs');
const path = require('path');

// Use the deployments/contract-addresses.json
const CONFIG_FILE = path.join(process.cwd(), 'deployments', 'contract-addresses.json');

/**
 * Utility functions for Diamond deployment and management
 */

function loadDeploymentConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            throw new Error(`Config file not found at ${CONFIG_FILE}`);
        }
        const configData = fs.readFileSync(CONFIG_FILE, 'utf8');
        return JSON.parse(configData);
    } catch (error) {
        console.error('Error loading deployment config:', error);
        throw error;
    }
}

function saveDeploymentConfig(config) {
    try {
        // Ensure the deployments directory exists
        const dir = path.dirname(CONFIG_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log('✅ Deployment configuration saved to deployments/contract-addresses.json');
    } catch (error) {
        console.error('Error saving deployment config:', error);
        throw error;
    }
}

function getNetworkConfig() {
    const config = loadDeploymentConfig();
    const networkName = network.name;

    // Your config has the network name as a top-level key
    if (!config[networkName]) {
        throw new Error(`Network ${networkName} not found in deployments/contract-addresses.json`);
    }

    return config[networkName];
}

function updateNetworkConfig(updates) {
    const config = loadDeploymentConfig();
    const networkName = network.name;

    if (!config[networkName]) {
        config[networkName] = {
            deployedAt: new Date().toISOString(),
            deployer: "",
            status: "upgraded",
            APS: "",
            MainDiamond: "",
            DiamondInit: "",
            Facets: {}
        };
    }

    // Deep merge the updates
    Object.keys(updates).forEach(key => {
        if (typeof updates[key] === 'object' && updates[key] !== null && !Array.isArray(updates[key])) {
            config[networkName][key] = {
                ...config[networkName][key],
                ...updates[key]
            };
        } else {
            config[networkName][key] = updates[key];
        }
    });

    // Update the deployedAt timestamp
    config[networkName].deployedAt = new Date().toISOString();
    config[networkName].status = "upgraded";

    saveDeploymentConfig(config);
    return config[networkName];
}

function isDiamondDeployed() {
    try {
        const networkConfig = getNetworkConfig();
        return networkConfig.MainDiamond && networkConfig.MainDiamond !== "";
    } catch {
        return false;
    }
}

function getFacetAddress(facetName) {
    try {
        const networkConfig = getNetworkConfig();
        // Map the facet name to match your JSON structure
        const facetMapping = {
            'DiamondCutFacet': 'DiamondCutFacet',
            'DiamondLoupeFacet': 'DiamondLoupeFacet',
            'OwnershipFacet': 'OwnershipFacet',
            'ApsdexFacet': 'ApsdexFacet',
            'FlashLoanFacet': 'FlashLoanFacet',
            'MovePriceFacet': 'MovePriceFacet',
            'LendingFacet': 'LendingFacet'
        };

        const key = facetMapping[facetName] || facetName;
        return networkConfig.Facets ? networkConfig.Facets[key] || "" : "";
    } catch {
        return "";
    }
}

function getDiamondAddress() {
    try {
        const networkConfig = getNetworkConfig();
        return networkConfig.MainDiamond || "";
    } catch {
        return "";
    }
}

function getAPSAddress() {
    try {
        const networkConfig = getNetworkConfig();
        return networkConfig.APS || "";
    } catch {
        return "";
    }
}

async function getDiamondCutContract() {
    const diamondAddress = getDiamondAddress();
    if (!diamondAddress) {
        throw new Error('Diamond not deployed on this network');
    }

    const diamondCutInterface = [
        "function diamondCut((address facetAddress, uint8 action, bytes4[] functionSelectors)[] _diamondCut, address _init, bytes calldata _calldata) external"
    ];

    const [deployer] = await ethers.getSigners();
    return new ethers.Contract(diamondAddress, diamondCutInterface, deployer);
}

async function deployContract(contractName, constructorArgs = []) {
    console.log(`\n🚀 Deploying ${contractName}...`);

    const ContractFactory = await ethers.getContractFactory(contractName);
    const contract = await ContractFactory.deploy(...constructorArgs);
    await contract.waitForDeployment();

    console.log(`✅ ${contractName} deployed to: ${contract.target}`);
    return contract;
}

async function executeDiamondCut(facetCuts, initAddress = ethers.ZeroAddress, initCalldata = "0x") {
    console.log('\n💎 Executing Diamond Cut...');
    console.log('Facet Cuts:', JSON.stringify(facetCuts, null, 2));

    const diamondCutContract = await getDiamondCutContract();

    try {
        const tx = await diamondCutContract.diamondCut(
            facetCuts,
            initAddress,
            initCalldata,
            { gasLimit: 8000000 }
        );

        console.log(`📝 Diamond cut transaction sent: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`✅ Diamond cut transaction confirmed: ${receipt.transactionHash}`);

        return receipt;
    } catch (error) {
        console.error('❌ Diamond cut failed:', {
            message: error.message,
            reason: error.reason,
            code: error.code
        });
        throw error;
    }
}

function validateNetwork() {
    const allowedNetworks = ['localhost', 'hardhat', 'sepolia', 'mainnet'];
    if (!allowedNetworks.includes(network.name)) {
        throw new Error(`Unsupported network: ${network.name}. Allowed networks: ${allowedNetworks.join(', ')}`);
    }
    console.log(`🌐 Network: ${network.name}`);
    return network.name;
}

async function verifyDeployment(address, contractName) {
    console.log(`\n🔍 Verifying ${contractName} at ${address}...`);

    try {
        const code = await ethers.provider.getCode(address);
        if (code === '0x') {
            throw new Error(`No contract found at ${address}`);
        }
        console.log(`✅ ${contractName} verified successfully`);
        return true;
    } catch (error) {
        console.error(`❌ Verification failed for ${contractName}:`, error.message);
        return false;
    }
}

function getSelectors(contract) {
    const signatures = new Set();
    const selectors = [];

    for (const fragment of contract.interface.fragments) {
        if (fragment.type === 'function') {
            const signature = fragment.format('sighash');
            const selector = contract.interface.getFunction(signature).selector;

            if (!signatures.has(selector)) {
                signatures.add(selector);
                selectors.push(selector);
                console.log(`Added selector for ${signature}: ${selector}`);
            }
        }
    }
    return selectors;
}

function removeDuplicateSelectors(selectors, previousSelectorArrays) {
    console.log("\n--- removeDuplicateSelectors ---");
    console.log("Initial Selectors:", selectors);

    const existing = new Set();
    previousSelectorArrays.forEach(arr => arr.forEach(selector => existing.add(selector)));

    const uniqueSelectors = selectors.filter(selector => !existing.has(selector));

    console.log("Existing Selectors (from previous arrays):", Array.from(existing));
    console.log("Unique Selectors:", uniqueSelectors);
    console.log("--- End of removeDuplicateSelectors ---\n");

    return uniqueSelectors;
}

// Export all functions using CommonJS
module.exports = {
    getSelectors,
    removeDuplicateSelectors,
    loadDeploymentConfig,
    saveDeploymentConfig,
    getNetworkConfig,
    updateNetworkConfig,
    isDiamondDeployed,
    getFacetAddress,
    getDiamondAddress,
    getAPSAddress,
    getDiamondCutContract,
    deployContract,
    executeDiamondCut,
    validateNetwork,
    verifyDeployment
};