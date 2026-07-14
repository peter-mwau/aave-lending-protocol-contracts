require("dotenv").config();
require("@nomicfoundation/hardhat-ethers");

const hre = require("hardhat");
const { ethers, network } = hre;
const { readRegistry, writeRegistry } = require("./registry");

async function getSelectors(contractFactory) {
    return contractFactory.interface.fragments
        .filter((fragment) => fragment.type === "function")
        .map((fragment) => contractFactory.interface.getFunction(fragment.format()).selector);
}

async function main() {
    const diamondAddress = process.env.DIAMOND_ADDRESS;
    const facetName = process.env.FACET_NAME;

    if (!diamondAddress) {
        throw new Error("Missing DIAMOND_ADDRESS");
    }

    if (!facetName) {
        throw new Error("Missing FACET_NAME");
    }

    const Facet = await ethers.getContractFactory(facetName);
    const facet = await Facet.deploy();
    await facet.waitForDeployment();

    const facetAddress = await facet.getAddress();
    const selectors = await getSelectors(Facet);
    const diamondCut = await ethers.getContractAt("DiamondCutFacet", diamondAddress);
    const registry = await readRegistry();
    const current = registry[network.name] || {};
    const action = current.Facets && current.Facets[facetName] ? 1 : 0;

    await diamondCut.diamondCut(
        [
            {
                facetAddress,
                action,
                functionSelectors: selectors,
            },
        ],
        ethers.ZeroAddress,
        "0x"
    );

    current.Facets = current.Facets || {};
    current.Facets[facetName] = facetAddress;
    await writeRegistry(network.name, current);

    console.log(`${facetName} deployed to:`, facetAddress);
    console.log("Diamond upgraded at:", diamondAddress);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
