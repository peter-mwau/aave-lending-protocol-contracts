const hre = require("hardhat");
const { ethers, network } = hre;
const {
    deployContract,
    getSelectors,
    updateNetworkConfig,
    isDiamondDeployed,
    getDiamondAddress,
    getFacetAddress,
    getDiamondCutContract,
    executeDiamondCut,
    validateNetwork
} = require("./utils.js");

/**
 * Upgrade a single facet in the Diamond
 * This script can be used to update any individual facet
 */

const FACET_NAMES = {
    'apsdex': 'ApsdexFacet',
    'diamondcut': 'DiamondCutFacet',
    'diamondloupe': 'DiamondLoupeFacet',
    'ownership': 'OwnershipFacet',
    'flashLoan': 'FlashLoanFacet',
    'lending': 'LendingFacet',
    'movePrice': 'MovePriceFacet',
};

async function upgradeFacet(facetKey) {
    console.log(`🔄 Upgrading ${facetKey} Facet...\n`);

    // Validate inputs
    validateNetwork();

    if (!FACET_NAMES[facetKey]) {
        console.log('❌ Invalid facet name!');
        console.log('Available facets:', Object.keys(FACET_NAMES).join(', '));
        process.exit(1);
    }

    if (!isDiamondDeployed()) {
        console.log('❌ Diamond not deployed on this network!');
        console.log('Run: npm run deploy:diamond first');
        process.exit(1);
    }

    const contractName = FACET_NAMES[facetKey];
    const diamondAddress = getDiamondAddress();
    const currentFacetAddress = getFacetAddress(contractName);

    const [deployer] = await ethers.getSigners();

    console.log("💼 Upgrading with account:", deployer.address);
    console.log("💎 Diamond address:", diamondAddress);
    console.log("📦 Contract name:", contractName);
    console.log("🔗 Current facet address:", currentFacetAddress || 'Not deployed');

    // Deploy new version of the facet
    console.log(`\n🚀 Deploying new ${contractName}...`);
    console.log(`⏳ This may take a moment...`);

    // Add timeout handling
    const deployPromise = deployContract(contractName);
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Deployment timed out after 60 seconds')), 80000);
    });

    let newFacet;
    try {
        newFacet = await Promise.race([deployPromise, timeoutPromise]);
        console.log(`✅ ${contractName} deployed successfully!`);
        console.log(`📄 New address: ${await newFacet.getAddress()}`);
    } catch (error) {
        console.error('❌ Deployment failed or timed out:', error.message);
        throw error;
    }

    // Get function selectors from the new facet
    console.log('\n🔍 Extracting Function Selectors...');
    const selectors = getSelectors(newFacet);

    if (selectors.length === 0) {
        console.log('⚠️  No function selectors found in facet');
        process.exit(1);
    }

    // Determine the action type
    const isNewFacet = !currentFacetAddress || currentFacetAddress === "";
    const action = isNewFacet ? 0 : 1; // 0 = Add, 1 = Replace
    const actionName = isNewFacet ? 'Adding' : 'Replacing';

    console.log(`\n⚙️  ${actionName} ${selectors.length} functions...`);

    // Prepare facet cut
    // Prepare facet cuts by classifying selectors against on-chain state
    const loupe = await ethers.getContractAt("DiamondLoupeFacet", diamondAddress);
    const newFacetAddr = await newFacet.getAddress();

    const toAdd = [];
    const toReplace = [];
    const toSkip = [];

    for (const sel of selectors) {
        const currentImpl = await loupe.facetAddress(sel);
        // gather diagnostics about current implementation
        let implCode = '0x';
        try {
            implCode = await ethers.provider.getCode(currentImpl);
        } catch (e) {
            implCode = '0x';
        }
        let facetSelectors = [];
        try {
            facetSelectors = await loupe.facetFunctionSelectors(currentImpl);
        } catch (e) {
            facetSelectors = [];
        }
        console.log(`Selector ${sel} -> impl: ${currentImpl} codeSize: ${implCode.length} selectorsOnImpl: ${facetSelectors.length}`);
        const cur = currentImpl ? currentImpl.toLowerCase() : ethers.ZeroAddress;
        if (!currentImpl || currentImpl === ethers.ZeroAddress) {
            toAdd.push(sel);
        } else if (cur === newFacetAddr.toLowerCase()) {
            toSkip.push(sel); // already implemented by this facet
        } else if (cur === diamondAddress.toLowerCase()) {
            // selector implemented in diamond core (immutable) - cannot replace
            console.warn(`⚠️  Selector ${sel} is implemented in the diamond core - skipping`);
            toSkip.push(sel);
        } else {
            toReplace.push(sel);
        }
    }

    // Decide upgrade mode. If UPGRADE_ADD_ONLY is set, force add-only behavior.
    const UPGRADE_ADD_ONLY = (process.env.UPGRADE_ADD_ONLY === 'true' || process.env.UPGRADE_ADD_ONLY === '1');

    // Best-effort: attempt to Replace selectors individually if their Replace simulation succeeds.
    // If Replace simulation fails for a selector, try Add. If Add succeeds, switch it to Add.
    // If both fail, skip the selector and report it; do not try to Replace entire groups blindly.
    const finalToAdd = [...toAdd];
    const finalToReplace = [];
    const skippedSelectors = [];

    const diamondCutContract = await getDiamondCutContract();

    if (!UPGRADE_ADD_ONLY && toReplace.length > 0) {
        console.log('\n🔧 Attempting per-selector Replace where safe...');
        for (const sel of toReplace) {
            // Try Replace for this selector
            try {
                const testReplace = [{ facetAddress: newFacetAddr, action: 1, functionSelectors: [sel] }];
                const replaceCalldata = diamondCutContract.interface.encodeFunctionData('diamondCut', [testReplace, ethers.ZeroAddress, '0x']);
                await ethers.provider.call({ to: diamondAddress, data: replaceCalldata, from: deployer.address });
                console.log(`  ✅ Replace simulation OK for selector ${sel}`);
                finalToReplace.push(sel);
                continue;
            } catch (replaceErr) {
                // Replace failed, try Add fallback
                try {
                    const testAdd = [{ facetAddress: newFacetAddr, action: 0, functionSelectors: [sel] }];
                    const addCalldata = diamondCutContract.interface.encodeFunctionData('diamondCut', [testAdd, ethers.ZeroAddress, '0x']);
                    await ethers.provider.call({ to: diamondAddress, data: addCalldata, from: deployer.address });
                    console.log(`  ℹ️  Replace failed; Add simulation OK for selector ${sel} — switching to Add`);
                    finalToAdd.push(sel);
                    continue;
                } catch (addErr) {
                    console.warn(`  ❌ Both Replace and Add simulation failed for selector ${sel}; skipping`);
                    skippedSelectors.push(sel);
                }
            }
        }
    } else if (UPGRADE_ADD_ONLY && toReplace.length > 0) {
        console.log(`\n🔧 UPGRADE_ADD_ONLY set — not attempting Replace for ${toReplace.length} selectors; they will be skipped.`);
        skippedSelectors.push(...toReplace);
    }

    // Build the final facetCuts from successful Adds/Replaces
    const facetCuts = [];
    if (finalToAdd.length > 0) facetCuts.push({ facetAddress: newFacetAddr, action: 0, functionSelectors: finalToAdd });
    if (finalToReplace.length > 0) facetCuts.push({ facetAddress: newFacetAddr, action: 1, functionSelectors: finalToReplace });

    if (skippedSelectors.length > 0) {
        console.warn(`\n⚠️  Skipped selectors count: ${skippedSelectors.length}`);
        console.log('  Skipped selectors:', skippedSelectors);
    }

    console.log('\nSelector classification:');
    console.log('  toAdd:', toAdd.length);
    console.log('  toReplace:', toReplace.length);
    console.log('  toSkip:', toSkip.length);

    // Print selector lists for debugging
    console.log('\nSelectors (hex):');
    console.log('  toAdd:', toAdd);
    console.log('  toReplace:', toReplace);
    console.log('  toSkip:', toSkip);

    if (facetCuts.length === 0) {
        console.log('ℹ️  No selectors to add or replace — nothing to do.');
        return {
            facetName: contractName,
            newAddress: newFacetAddr,
            oldAddress: currentFacetAddress,
            action: 'NoOp',
            diamond: diamondAddress
        };
    }

    // Simulate the diamondCut using callStatic to get a better revert reason without spending gas
    try {
        console.log('\n🔬 Simulating diamondCut via provider.call...');
        const calldata = diamondCutContract.interface.encodeFunctionData('diamondCut', [facetCuts, ethers.ZeroAddress, '0x']);
        // run the simulation as the deployer (same account that will send the real tx)
        await ethers.provider.call({ to: diamondAddress, data: calldata, from: deployer.address });
        console.log('✅ Simulation succeeded — proceeding to execute diamondCut');
    } catch (simErr) {
        console.error('❌ Simulation failed. Diamond cut would revert.');
        // Try per-cut and per-selector simulation to find failing selector(s)
        for (const cut of facetCuts) {
            const { facetAddress, action, functionSelectors } = cut;
            console.log(`\n🔎 Testing cut action=${action} facet=${facetAddress} selectors=${functionSelectors.length}`);
            // try simulating this entire cut alone
            try {
                const singleCalldata = diamondCutContract.interface.encodeFunctionData('diamondCut', [[cut], ethers.ZeroAddress, '0x']);
                await ethers.provider.call({ to: diamondAddress, data: singleCalldata, from: deployer.address });
                console.log('  ✅ This cut as a whole would succeed');
                continue;
            } catch (cutErr) {
                console.warn('  ⚠️ This cut alone reverts; testing selectors individually...');
            }

            // Test selectors one by one to isolate problematic selectors
            for (const sel of functionSelectors) {
                try {
                    const testCut = { facetAddress, action, functionSelectors: [sel] };
                    const testCalldata = diamondCutContract.interface.encodeFunctionData('diamondCut', [[testCut], ethers.ZeroAddress, '0x']);
                    await ethers.provider.call({ to: diamondAddress, data: testCalldata, from: deployer.address });
                    console.log(`    ✅ Selector ${sel} OK`);
                } catch (selErr) {
                    // try to extract revert data for better diagnosis
                    let revertData = null;
                    if (selErr && selErr.error && selErr.error.data) revertData = selErr.error.data;
                    else if (selErr && selErr.data) revertData = selErr.data;
                    console.error(`    ❌ Selector ${sel} causes revert when tested alone`);
                    if (revertData) {
                        console.error(`      Revert data: ${revertData}`);
                    } else {
                        console.error(selErr);
                    }

                    // As a fallback, try adding the selector instead of replacing it.
                    try {
                        const addTestCut = { facetAddress: newFacetAddr, action: 0, functionSelectors: [sel] };
                        const addCalldata = diamondCutContract.interface.encodeFunctionData('diamondCut', [[addTestCut], ethers.ZeroAddress, '0x']);
                        await ethers.provider.call({ to: diamondAddress, data: addCalldata, from: deployer.address });
                        console.log(`    ℹ️  Add simulation succeeded for selector ${sel} — switching to Add`);
                        // move selector from replace to add
                        toAdd.push(sel);
                        // remove from toReplace if present
                        const idx = toReplace.indexOf(sel);
                        if (idx >= 0) toReplace.splice(idx, 1);
                        continue;
                    } catch (addErr) {
                        let addRevert = null;
                        if (addErr && addErr.error && addErr.error.data) addRevert = addErr.error.data;
                        else if (addErr && addErr.data) addRevert = addErr.data;
                        console.warn(`    ⚠️  Add simulation also failed for selector ${sel}`);
                        if (addRevert) console.warn(`      Add revert data: ${addRevert}`);
                        // leave selector in toReplace for now; higher-level logic will decide to skip if necessary
                    }
                }
            }
        }

        // After diagnostics and possible reclassification, re-build facetCuts and try simulation again
        const recomputedCuts = [];
        if (toAdd.length > 0) recomputedCuts.push({ facetAddress: newFacetAddr, action: 0, functionSelectors: toAdd });
        if (toReplace.length > 0) recomputedCuts.push({ facetAddress: newFacetAddr, action: 1, functionSelectors: toReplace });

        try {
            const retryCalldata = diamondCutContract.interface.encodeFunctionData('diamondCut', [recomputedCuts, ethers.ZeroAddress, '0x']);
            await ethers.provider.call({ to: diamondAddress, data: retryCalldata, from: deployer.address });
            console.log('✅ Re-simulation after reclassification succeeded — proceeding to execute diamondCut');
            facetCuts.length = 0;
            facetCuts.push(...recomputedCuts);
        } catch (retryErr) {
            console.error('❌ Re-simulation after diagnostics still failed. Aborting upgrade.');
            throw simErr;
        }
    }

    // Execute diamond cut
    const DRY_RUN = (process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true');
    if (DRY_RUN) {
        console.log('\n🧪 DRY_RUN is enabled — not executing diamondCut on-chain.');
        console.log('Proposed facetCuts:');
        console.log(JSON.stringify(facetCuts, null, 2));
    } else {
        await executeDiamondCut(facetCuts);
    }

    // Update configuration
    console.log('\n💾 Updating Configuration...');

    const configUpdate = {
        facets: {
            [contractName]: await newFacet.getAddress()
        }
    };

    // Add upgrade timestamp
    configUpdate[`${facetKey}LastUpgrade`] = new Date().toISOString();

    updateNetworkConfig(configUpdate);

    // Display summary
    console.log('\n🎉 Facet Upgrade Complete!');
    console.log('📋 Upgrade Summary:');
    console.log('═'.repeat(50));
    console.log(`📦 Facet: ${contractName}`);
    console.log(`🔗 New Address: ${await newFacet.getAddress()}`);
    console.log(`🔗 Old Address: ${currentFacetAddress || 'N/A'}`);
    console.log(`⚡ Action: ${actionName}`);
    console.log(`🔧 Functions: ${selectors.length}`);
    console.log(`💎 Diamond: ${diamondAddress}`);
    console.log(`🌐 Network: ${network.name}`);
    console.log('═'.repeat(50));

    if (!isNewFacet) {
        console.log('⚠️  NOTE: Old facet contract is now unused but still exists on blockchain');
        console.log('💡 TIP: You can verify the upgrade by calling Diamond functions');
    }

    return {
        facetName: contractName,
        newAddress: await newFacet.getAddress(),
        oldAddress: currentFacetAddress,
        action: actionName,
        diamond: diamondAddress
    };
}

async function main() {
    // Get facet name from environment variable or command line arguments
    // Prefer explicit FACET env var (safe for Hardhat/npm), fallback to positional arg if present
    let facetKey = process.env.FACET;
    if (!facetKey) {
        // find first non-flag positional arg
        const args = process.argv.slice(2).filter(a => !a.startsWith('-'));
        facetKey = args[0];
    }

    if (!facetKey) {
        console.log('❌ Please specify a facet to upgrade!');
        console.log('\nUsage: npm run upgrade:facet <facetName>');
        console.log('\nAvailable facets:');
        Object.keys(FACET_NAMES).forEach(key => {
            console.log(`  - ${key} (${FACET_NAMES[key]})`);
        });
        process.exit(1);
    }

    try {
        await upgradeFacet(facetKey.toLowerCase());
        process.exit(0);
    } catch (error) {
        console.error(`❌ ${facetKey} Facet Upgrade failed:`, error);
        process.exit(1);
    }
}

// Only run if this script is called directly
// if (import.meta.url === `file://${process.argv[1]}`) {
//     main();
// }

if (require.main === module) {
    main();
}

// export { upgradeFacet, FACET_NAMES };

module.exports = { upgradeFacet, FACET_NAMES };