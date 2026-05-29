require("dotenv").config();
require("@nomicfoundation/hardhat-ethers");

const hre = require("hardhat");
const { ethers, network } = hre;
const { readRegistry, writeRegistry } = require("./registry");

async function main() {
    const registry = await readRegistry();
    const current = registry[network.name] || {};
    const diamondAddress = process.env.DIAMOND_ADDRESS || current.APSDEX;

    if (!diamondAddress) {
        throw new Error("Missing DIAMOND_ADDRESS and no APSDEX address in registry");
    }

    const diamondLoupe = await ethers.getContractAt("DiamondLoupeFacet", diamondAddress);
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

    const out = {
        ...current,
        APSDEX: diamondAddress,
        Facets: facets,
        FacetAddresses: facetAddrs,
    };

    await writeRegistry(network.name, out);
    console.log("Wrote facet snapshot for", network.name, "to registry");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
