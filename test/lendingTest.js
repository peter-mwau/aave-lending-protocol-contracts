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

    console.log("APS Contract Address: ", apsAddress);

    //Deploy the APSDEX contract
    const APSDEX = await ethers.getContractFactory("APSDEX");
    apsDex = await APSDEX.deploy(apsAddress);

    await apsDex.waitForDeployment();

    const apsDexAddress = await apsDex.getAddress();

    console.log("APSDEX Contract Address: ", apsDexAddress);

    // Deploy the Lending contract
    const Lending = await ethers.getContractFactory("Lending");
    lending = await Lending.deploy(
        apsAddress,
        apsDexAddress
    );
    const lendingContract = await lending.waitForDeployment();

    console.log("APSDEX Contract Address: ", lending.target);
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

