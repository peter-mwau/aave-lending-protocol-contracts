const { expect } = require("chai");
const { ethers } = require("hardhat");

let APS;
let aps;
let owner;
let addr1;

async function getEvent(tx, contract, eventName) {
    const receipt = await tx.wait();
    return receipt.logs
        .map((log) => {
            try {
                return contract.interface.parseLog(log);
            } catch {
                return null;
            }
        })
        .find((parsedEvent) => parsedEvent && parsedEvent.name === eventName);
}

beforeEach(async function() {
    [owner, addr1] = await ethers.getSigners();
    APS = await ethers.getContractFactory("APS");
    aps = await APS.deploy();
    await aps.waitForDeployment();
})

describe("Deployment", function(){
    it("Should deploy the APS successfully", async function(){
        expect(await aps.owner()).to.equal(owner.address);
    })

    it("Should have the correct name and symbol", async function(){
        expect(await aps.name()).to.equal("Aave Pool Share");
        expect(await aps.symbol()).to.equal("APS");
    })

    it("Should have the correct initial supply", async function(){
        const totalSupply = await aps.totalSupply();
        expect(totalSupply).to.equal(ethers.parseEther("100000"));
    })

    it("Should set the balance of the owner to the initial supply", async function(){
        const ownerBalance = await aps.balanceOf(owner.address);
        expect(ownerBalance).to.equal(ethers.parseEther("100000"));
    })
})

describe("Minting", async function(){
    it("Should mint aps tokens correctly", async function(){
        const amount = ethers.parseEther("1000");
        await aps.connect(owner).mintToken(owner.address, amount);
        const ownerBalance = await aps.balanceOf(owner.address);
        expect(ownerBalance).to.equal(ethers.parseEther("101000"));
    })

    it("Should return the correct event on minting", async function(){
        const amount = ethers.parseEther("500");
        const tx = await aps.connect(owner).mintToken(owner.address, amount);
        const mintEvent = await getEvent(tx, aps, "MintSuccessful");

        expect(mintEvent).to.not.equal(undefined);
        expect(mintEvent.args[0]).to.equal(owner.address);
        expect(mintEvent.args[1]).to.equal(amount);
    })
})

describe("Burning", async function(){
    it("Should burn aps tokens correctly", async function(){
        const amount = ethers.parseEther("1000");
        await aps.connect(owner).mintToken(owner.address, amount);
        await aps.connect(owner).burnToken(owner.address, amount);
        const ownerBalance = await aps.balanceOf(owner.address);
        expect(ownerBalance).to.equal(ethers.parseEther("100000"));
    })

    it("Should return the correct event on burning", async function(){
        const amount = ethers.parseEther("500");
        await aps.connect(owner).mintToken(owner.address, amount);
        const tx = await aps.connect(owner).burnToken(owner.address, amount);
        const burnEvent = await getEvent(tx, aps, "BurnSuccessful");

        expect(burnEvent).to.not.equal(undefined);
        expect(burnEvent.args[0]).to.equal(owner.address);
        expect(burnEvent.args[1]).to.equal(amount);
    })
})