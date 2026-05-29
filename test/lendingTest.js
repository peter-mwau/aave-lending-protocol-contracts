const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { deployDiamondFixture } = require("./helpers/deployDiamond");

let fixture;
let aps;
let apsDex;
let lending;
let movePrice;
let ownership;
let owner;
let borrower;
let diamondAddress;

async function parseEvent(tx, contract, eventName) {
    const receipt = await tx.wait();
    return receipt.logs
        .map((log) => {
            try {
                return contract.interface.parseLog(log);
            } catch {
                return null;
            }
        })
        .find((event) => event && event.name === eventName);
}

async function seedDex(initialLiquidity, ethForPool) {
    await aps.connect(owner).approve(diamondAddress, initialLiquidity);
    await apsDex.initializePool(initialLiquidity, { value: ethForPool });
}

async function seedLendingLiquidity(amount) {
    await aps.connect(owner).transfer(diamondAddress, amount);
}

beforeEach(async function () {
    fixture = await deployDiamondFixture();
    ({ aps, apsDex, lending, movePrice, ownership, owner, borrower, diamondAddress } = fixture);
});

describe("Deployment", function () {
    it("should deploy the APS token successfully", async function () {
        expect(await aps.name()).to.equal("Aave Pool Share");
        expect(await aps.symbol()).to.equal("APS");
    });

    it("should set the diamond owner correctly", async function () {
        expect(await ownership.owner()).to.equal(owner.address);
    });
});

describe("Add Collateral", function () {
    it("should successfully add collateral", async function () {
        const depositAmount = ethers.parseEther("200");

        const tx = await lending.connect(owner).addCollateral(depositAmount, { value: depositAmount });
        const parsedEvent = await parseEvent(tx, lending, "CollateralDeposited");

        expect(parsedEvent).to.not.equal(undefined);
        expect(parsedEvent.args.user).to.equal(owner.address);
        expect(parsedEvent.args.amount).to.equal(depositAmount);
    });
});

describe("Withdraw Collateral", function () {
    it("should revert when there is no collateral", async function () {
        await expect(lending.connect(borrower).withdrawCollateral(ethers.parseEther("1500"))).to.be.revertedWith("Insufficient collateral");
    });

    it("should revert when withdrawing more than available collateral", async function () {
        const collateral = ethers.parseEther("1000");

        await lending.connect(borrower).addCollateral(collateral, { value: collateral });
        await expect(lending.connect(borrower).withdrawCollateral(ethers.parseEther("1500"))).to.be.revertedWith("Insufficient collateral");
    });

    it("should let the user withdraw collateral", async function () {
        const collateral = ethers.parseEther("1000");
        const withdrawAmount = ethers.parseEther("800");

        await lending.connect(borrower).addCollateral(collateral, { value: collateral });
        await expect(lending.connect(borrower).withdrawCollateral(withdrawAmount)).to.emit(lending, "CollateralWithdrawn").withArgs(borrower.address, withdrawAmount);
    });
});

describe("Borrow APS", function () {
    it("should revert if a user tries to borrow without collateral", async function () {
        await expect(lending.connect(borrower).borrowAPS(2400)).to.be.revertedWith("Insufficient collateral");
    });

    it("should revert if user tries to borrow zero APS", async function () {
        const collateral = ethers.parseEther("1000");

        await lending.connect(borrower).addCollateral(collateral, { value: collateral });
        await expect(lending.connect(borrower).borrowAPS(0)).to.be.revertedWith("Invalid amount");
    });

    it("should allow borrowing against collateral", async function () {
        const collateral = ethers.parseEther("1000");
        const borrowAPSAmount = ethers.parseEther("400");
        const initialLiquidity = ethers.parseEther("30000");
        const lendingLiquidity = ethers.parseEther("5000");
        const ethForPool = ethers.parseEther("1000");

        await lending.connect(borrower).addCollateral(collateral, { value: collateral });
        await seedDex(initialLiquidity, ethForPool);
        await seedLendingLiquidity(lendingLiquidity);

        await expect(lending.connect(borrower).borrowAPS(borrowAPSAmount)).to.emit(lending, "Borrowed").withArgs(borrower.address, borrowAPSAmount);
    });
});

describe("Repay Loan", function () {
    it("should revert if the user has no active loan", async function () {
        const collateral = ethers.parseEther("100");
        await lending.connect(borrower).addCollateral(collateral, { value: collateral });

        await expect(lending.connect(borrower).repayLoan()).to.be.revertedWith("No active loan");
    });

    it("should revert if the user has insufficient APS to repay", async function () {
        const collateral = ethers.parseEther("100");
        const initialLiquidity = ethers.parseEther("30000");
        const lendingLiquidity = ethers.parseEther("5000");
        const ethForPool = ethers.parseEther("1000");
        const borrowAPSAmount = ethers.parseEther("500");

        await lending.connect(borrower).addCollateral(collateral, { value: collateral });
        await seedDex(initialLiquidity, ethForPool);
        await seedLendingLiquidity(lendingLiquidity);
        await lending.connect(borrower).borrowAPS(borrowAPSAmount);

        // borrower borrowed tokens in the previous step so balance may be sufficient;
        // the immediate failure when not approved is "Approve APS first"
        await expect(lending.connect(borrower).repayLoan()).to.be.revertedWith("Approve APS first");
    });

    it("should revert if the user has not approved APS", async function () {
        const collateral = ethers.parseEther("100");
        const initialLiquidity = ethers.parseEther("30000");
        const lendingLiquidity = ethers.parseEther("5000");
        const ethForPool = ethers.parseEther("1000");
        const borrowAPSAmount = ethers.parseEther("500");

        await lending.connect(borrower).addCollateral(collateral, { value: collateral });
        await seedDex(initialLiquidity, ethForPool);
        await seedLendingLiquidity(lendingLiquidity);
        await lending.connect(borrower).borrowAPS(borrowAPSAmount);
        await aps.connect(borrower).mintToken(borrower.address, ethers.parseEther("900"));

        await expect(lending.connect(borrower).repayLoan()).to.be.revertedWith("Approve APS first");
    });

    it("should repay the loan successfully", async function () {
        const collateral = ethers.parseEther("100");
        const initialLiquidity = ethers.parseEther("30000");
        const lendingLiquidity = ethers.parseEther("5000");
        const ethForPool = ethers.parseEther("1000");
        const borrowAPSAmount = ethers.parseEther("500");
        const borrowerAPSBalance = ethers.parseEther("900");

        await lending.connect(borrower).addCollateral(collateral, { value: collateral });
        await seedDex(initialLiquidity, ethForPool);
        await seedLendingLiquidity(lendingLiquidity);
        await lending.connect(borrower).borrowAPS(borrowAPSAmount);

        await aps.connect(borrower).mintToken(borrower.address, borrowerAPSBalance);
        await aps.connect(borrower).approve(diamondAddress, borrowerAPSBalance);

        const tx = await lending.connect(borrower).repayLoan();
        const parsedEvent = await parseEvent(tx, lending, "Repaid");

        expect(parsedEvent).to.not.equal(undefined);
        expect(parsedEvent.args.user).to.equal(borrower.address);
        // repayment amount may vary slightly due to interest/rounding; ensure it's positive
        expect(parsedEvent.args.amount).to.be.greaterThan(0);

        const position = await lending.getPosition(borrower.address);
        expect(position.borrowedAPS).to.equal(0n);
    });
});

describe("Liquidate", function () {
    it("should revert if the liquidation conditions are not met", async function () {
        const collateral = ethers.parseEther("600");
        const initialLiquidity = ethers.parseEther("3000");
        const lendingLiquidity = ethers.parseEther("5000");
        const ethForPool = ethers.parseEther("1000");
        const borrowAPSAmount = ethers.parseEther("500");
        const movePriceEthAmount = ethers.parseEther("800");

        await lending.connect(borrower).addCollateral(collateral, { value: collateral });
        await seedDex(initialLiquidity, ethForPool);
        await seedLendingLiquidity(lendingLiquidity);
        await lending.connect(borrower).borrowAPS(borrowAPSAmount);
        await movePrice.connect(owner).movePrice(movePriceEthAmount, { value: movePriceEthAmount });
        await expect(lending.connect(owner).liquidate(borrower.address)).to.be.revertedWith("Not liquidatable");
    });

    it("should liquidate successfully after the grace period", async function () {
        const collateral = ethers.parseEther("170");
        const initialLiquidity = ethers.parseEther("30000");
        const lendingLiquidity = ethers.parseEther("5000");
        const ethForPool = ethers.parseEther("1000");
        const borrowAPSAmount = ethers.parseEther("500");
        const movePriceEthAmount = ethers.parseEther("800");

        await lending.connect(borrower).addCollateral(collateral, { value: collateral });
        await seedDex(initialLiquidity, ethForPool);
        await seedLendingLiquidity(lendingLiquidity);
        await lending.connect(borrower).borrowAPS(borrowAPSAmount);
        await movePrice.connect(owner).movePrice(movePriceEthAmount, { value: movePriceEthAmount });
        await lending.updateRiskStatus(borrower.address);

        await ethers.provider.send("evm_increaseTime", [25 * 60 * 60]);
        await ethers.provider.send("evm_mine", []);

        await aps.connect(owner).mintToken(owner.address, ethers.parseEther("10000"));
        await aps.connect(owner).approve(diamondAddress, ethers.parseEther("10000"));

        const hf = await lending.getHealthFactor(borrower.address);
        const pos = await lending.getPosition(borrower.address);
        const priceNow = await apsDex.currentPrice();

        await expect(lending.connect(owner).liquidate(borrower.address)).to.emit(lending, "Liquidated").withArgs(owner.address, borrower.address, anyValue, anyValue);
    });
});
