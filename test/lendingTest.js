const { ethers } = require("hardhat");
const { expect } = require("chai");
const { parseEther } = require("ethers");

let lending;
let aps;
let apsDex;
let owner;
let borrower;

beforeEach(async function () {
    [owner, borrower] = await ethers.getSigners();

    //Deploy the APS contract
    const APS = await ethers.getContractFactory("APS");
    aps = await APS.deploy();

    await aps.waitForDeployment();

    const apsAddress = await aps.getAddress();

    // console.log("APS Contract Address: ", apsAddress);

    //Deploy the APSDEX contract
    const APSDEX = await ethers.getContractFactory("APSDEX");
    apsDex = await APSDEX.deploy(apsAddress);

    await apsDex.waitForDeployment();

    const apsDexAddress = await apsDex.getAddress();

    // console.log("APSDEX Contract Address: ", apsDexAddress);

    // Deploy the Lending contract
    const Lending = await ethers.getContractFactory("Lending");
    lending = await Lending.deploy(
        apsAddress,
        apsDexAddress
    );
    const lendingContract = await lending.waitForDeployment();

    // console.log("APSDEX Contract Address: ", lending.target);
});

describe("Deployment", function () {
    it("Should deploy the APS contract successfully!", async function () {
        expect(await aps.name()).to.equal("Aave Pool Share");
        expect(await aps.symbol()).to.equal("APS");
    })

    it("Should deploy the Lending contract successfully!", async function () {
        expect(await lending.owner()).to.equal(owner.address);
    })
})

describe("Add Collateral", function () {
    it("Should be able to successfully add collateral", async function () {
        const depositAmount = ethers.parseEther("200");

        const tx = await owner.sendTransaction({
            to: lending.target,
            data: lending.interface.encodeFunctionData("addCollateral", [depositAmount]),
            value: depositAmount
        });
        const receipt = await tx.wait();

        const parsedEvent = receipt.logs
            .map((log) => {
                try {
                    return lending.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .find((event) => event && event.name === "CollateralDeposited");

        expect(parsedEvent).to.not.equal(undefined);
        expect(parsedEvent.args.user).to.equal(owner.address);
        expect(parsedEvent.args.amount).to.equal(depositAmount);
    })
})

describe("Withdraw Collateral", function () {
    it("Should return an error if there is no collateral to withdraw", async function () {
        const amount = ethers.parseEther("1500");

        await expect(lending.connect(borrower).withdrawCollateral(amount)).to.be.revertedWith("Insufficient collateral");
    })

    it("Should return an error if the amount is less than the available collateral", async function () {
        const withdrawAmount = ethers.parseEther("1500");
        const collateral = ethers.parseEther("1000")

        await lending.connect(borrower).addCollateral(collateral, { value: collateral });

        await expect(lending.connect(borrower).withdrawCollateral(withdrawAmount)).to.be.revertedWith("Insufficient collateral")

    })

    it("Should successfully let user withdraw collateral if all conditions pass", async function () {
        const withdrawAmount = ethers.parseEther("800");
        const collateral = ethers.parseEther("1000")

        await lending.connect(borrower).addCollateral(collateral, { value: collateral });

        await expect(lending.connect(borrower).withdrawCollateral(withdrawAmount)).to.emit(lending, "CollateralWithdrawn").withArgs(borrower.address, withdrawAmount);
    })
})

describe("Borrow APS", function () {
    it("Should revert if a user tries to borrow APS without collateral", async function () {
        const borrowAPSAmount = 2400;

        await expect(lending.connect(borrower).borrowAPS(borrowAPSAmount)).to.be.revertedWith("No liquidity");
    })

    it("Should revert if user tries to borrow 0 APS", async function () {
        const borrowAPSAmount = 0;
        const collateral = ethers.parseEther("1000")

        await lending.connect(borrower).addCollateral(collateral, { value: collateral });

        await expect(lending.connect(borrower).borrowAPS(borrowAPSAmount)).to.be.revertedWith("Invalid amount");
    })

    it("Should allow user to borrow APS tokes against their collateral", async function () {
        const borrowAPSAmount = 400;
        const collateral = ethers.parseEther("1000")
        const initialLiquidity = ethers.parseEther("30000");
        const lendingLiquidity = ethers.parseEther("5000");
        const ethForPool = ethers.parseEther("1000");

        await lending.connect(borrower).addCollateral(collateral, { value: collateral });

        // Transfer APS tokens to Lending contract for lending liquidity
        await aps.connect(owner).transfer(lending.target, lendingLiquidity);

        // Approve APSDEX to spend APS tokens
        await aps.connect(owner).approve(apsDex.target, initialLiquidity);
        await apsDex.connect(owner).initializePool(initialLiquidity);

        // Send ETH to APSDEX to establish price
        await owner.sendTransaction({
            to: apsDex.target,
            value: ethForPool
        });

        await expect(lending.connect(borrower).borrowAPS(borrowAPSAmount)).to.emit(lending, "Borrowed").withArgs(borrower.address, borrowAPSAmount);
    })
})

