const { ethers, network } = require("hardhat");

async function deployDiamondFixture() {
    const [owner, borrower, lender, liquidator] = await ethers.getSigners();

    // ensure test accounts have sufficient ETH for large transactions during tests
    // give the owner a large balance (10000 ETH) to cover large pool seeding in tests
    await ethers.provider.send("hardhat_setBalance", [
        owner.address,
        "0x" + ethers.parseEther("10000").toString(16)
    ]);

    const APS = await ethers.getContractFactory("APS");
    const aps = await APS.deploy();
    await aps.waitForDeployment();

    const apsAddress = await aps.getAddress();

    const APSDEX = await ethers.getContractFactory("APSDEX");
    const apsDexProxy = await APSDEX.deploy(apsAddress);
    await apsDexProxy.waitForDeployment();

    const diamondAddress = await apsDexProxy.getAddress();
    const apsDex = await ethers.getContractAt("ApsdexFacet", diamondAddress);
    const lending = await ethers.getContractAt("LendingFacet", diamondAddress);
    const movePrice = await ethers.getContractAt("MovePriceFacet", diamondAddress);
    const flashLoan = await ethers.getContractAt("FlashLoanFacet", diamondAddress);
    const ownership = await ethers.getContractAt("OwnershipFacet", diamondAddress);

    const MockPool = await ethers.getContractFactory("MockPool");
    const mockPool = await MockPool.deploy({ gasLimit: 2_000_000 });
    await mockPool.waitForDeployment();

    await lending.initializeLending(apsAddress, diamondAddress);
    await movePrice.initializeMovePrice(apsAddress, diamondAddress);
    await flashLoan.initializeFlashLoan(await mockPool.getAddress());

    return {
        owner,
        borrower,
        lender,
        liquidator,
        aps,
        apsAddress,
        apsDexProxy,
        diamondAddress,
        apsDex,
        lending,
        movePrice,
        flashLoan,
        ownership,
        mockPool,
        networkName: network.name,
    };
}

module.exports = {
    deployDiamondFixture,
};
