const hre = require("hardhat");
const { ethers } = hre;
const fs = require('fs');
const path = require('path');

async function main() {
    console.log("🚀 Deploying LendingFacet manually...");

    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);

    // Check balance
    const balance = await ethers.provider.getBalance(deployer.address);
    console.log("Balance:", ethers.formatEther(balance), "ETH");

    if (balance < ethers.parseEther("0.005")) {
        console.error("❌ Insufficient balance! Need at least 0.005 ETH");
        console.log("Get test ETH from faucet:");
        console.log("- https://sepolia-faucet.pk910.de/");
        console.log("- https://www.alchemy.com/faucets/ethereum-sepolia");
        process.exit(1);
    }

    try {
        console.log("\n📦 Loading contract factory...");
        const LendingFacet = await ethers.getContractFactory("LendingFacet");
        console.log("✅ Factory loaded");

        // Get current gas price
        const feeData = await ethers.provider.getFeeData();
        const gasPrice = feeData.gasPrice || ethers.parseUnits("1.5", "gwei");
        console.log("Current gas price:", ethers.formatUnits(gasPrice, "gwei"), "gwei");

        console.log("\n⏳ Deploying...");
        console.log("  Gas limit: 3,000,000");
        console.log("  Gas price:", ethers.formatUnits(gasPrice, "gwei"), "gwei");

        // Deploy with explicit gas settings
        const deployTx = await LendingFacet.deploy({
            gasLimit: 3000000,
            gasPrice: gasPrice
        });

        const txHash = deployTx.deploymentTransaction()?.hash;
        console.log("\n📋 Transaction sent!");
        console.log("  Hash:", txHash || 'Unknown');
        console.log("  View on Etherscan: https://sepolia.etherscan.io/tx/" + txHash);

        console.log("\n⏳ Waiting for deployment (90 second timeout)...");

        // Wait with timeout
        const contract = await Promise.race([
            deployTx.waitForDeployment(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Deployment timeout after 90s')), 90000)
            )
        ]);

        const address = await contract.getAddress();
        console.log("\n✅ LendingFacet deployed successfully!");
        console.log("📍 Address:", address);
        console.log("🔗 View on Etherscan: https://sepolia.etherscan.io/address/" + address);

        // Update config file
        const configPath = path.join(process.cwd(), 'deployments', 'contract-addresses.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config.sepolia && config.sepolia.Facets) {
                // Store the new address
                const newAddress = address;
                const oldAddress = config.sepolia.Facets.LendingFacet;

                console.log("\n📝 Found existing config:");
                console.log("  Old LendingFacet address:", oldAddress);
                console.log("  New LendingFacet address:", newAddress);

                // Update the config
                config.sepolia.Facets.LendingFacet = newAddress;
                config.sepolia.deployedAt = new Date().toISOString();
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                console.log("\n✅ Updated deployments/contract-addresses.json");
            }
        }

        console.log("\n💡 Next steps:");
        console.log("  1. Run the diamond cut to replace the facet:");
        console.log(`  USE_EXISTING_ADDRESS=${address} FACET=lending npx hardhat run scripts/upgradeFacets.js --network sepolia`);
        console.log("\n  OR update the config manually and run:");
        console.log("  npm run upgrade:lending");

        return address;

    } catch (error) {
        console.error("\n❌ Deployment failed:", error.message);
        if (error.code === 'ACTION_REJECTED') {
            console.error("  Transaction was rejected. Check your wallet.");
        } else if (error.code === 'INSUFFICIENT_FUNDS') {
            console.error("  Insufficient ETH for gas. Need at least 0.005 ETH.");
        }
        console.error("  Full error:", error);
        throw error;
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Deployment failed:", error);
        process.exit(1);
    });