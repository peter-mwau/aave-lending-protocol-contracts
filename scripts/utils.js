const hre = require("hardhat");
const { ethers, network } = hre;
const fs = require('fs');
const path = require('path');
// import fs from 'fs';
// import path from 'path';

/**
 * Utility functions for Diamond deployment and management
 */

export function getSelectors(contract) {
    const signatures = new Set();
    const selectors = [];

    for (const fragment of contract.interface.fragments) {
        if (fragment.type === 'function') {
            // Use the full signature to handle overloaded functions
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

export function removeDuplicateSelectors(selectors, previousSelectorArrays) {
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

export function loadDeploymentConfig() {
    const configPath = path.join(process.cwd(), 'scripts/deployment/deploymentConfig.json');
    try {
        const configData = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(configData);
    } catch (error) {
        console.error('Error loading deployment config:', error);
        throw error;
    }
}

export function saveDeploymentConfig(config) {
    const configPath = path.join(process.cwd(), 'scripts/deployment/deploymentConfig.json');
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log('✅ Deployment configuration saved');
    } catch (error) {
        console.error('Error saving deployment config:', error);
        throw error;
    }
}

export function getNetworkConfig() {
    const config = loadDeploymentConfig();
    const networkName = network.name;

    if (!config.networks[networkName]) {
        throw new Error(`Network ${networkName} not found in deployment config`);
    }

    return config.networks[networkName];
}

export function updateNetworkConfig(updates) {
    const config = loadDeploymentConfig();
    const networkName = network.name;

    if (!config.networks[networkName]) {
        config.networks[networkName] = { diamond: "", facets: {}, init: {} };
    }

    // Deep merge the updates
    Object.keys(updates).forEach(key => {
        if (typeof updates[key] === 'object' && updates[key] !== null) {
            config.networks[networkName][key] = {
                ...config.networks[networkName][key],
                ...updates[key]
            };
        } else {
            config.networks[networkName][key] = updates[key];
        }
    });

    saveDeploymentConfig(config);
    return config.networks[networkName];
}

export function isDiamondDeployed() {
    try {
        const networkConfig = getNetworkConfig();
        return networkConfig.diamond && networkConfig.diamond !== "";
    } catch {
        return false;
    }
}

export function getFacetAddress(facetName) {
    try {
        const networkConfig = getNetworkConfig();
        return networkConfig.facets[facetName] || "";
    } catch {
        return "";
    }
}

export function getDiamondAddress() {
    try {
        const networkConfig = getNetworkConfig();
        return networkConfig.diamond || "";
    } catch {
        return "";
    }
}

export async function getDiamondCutContract() {
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

export async function deployContract(contractName, constructorArgs = []) {
    console.log(`\n🚀 Deploying ${contractName}...`);

    const ContractFactory = await ethers.getContractFactory(contractName);
    const contract = await ContractFactory.deploy(...constructorArgs);
    await contract.waitForDeployment();

    console.log(`✅ ${contractName} deployed to: ${contract.target}`);
    return contract;
}

export async function executeDiamondCut(facetCuts, initAddress = ethers.ZeroAddress, initCalldata = "0x") {
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

export function validateNetwork() {
    const allowedNetworks = ['localhost', 'hardhat', 'sepolia', 'mainnet'];
    if (!allowedNetworks.includes(network.name)) {
        throw new Error(`Unsupported network: ${network.name}. Allowed networks: ${allowedNetworks.join(', ')}`);
    }
}

export async function verifyDeployment(address, contractName) {
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