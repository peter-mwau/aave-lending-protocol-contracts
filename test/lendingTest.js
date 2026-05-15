const { ethers } = require("hardhat");
const { expect } = require("chai");
const { parseEther } = require("ethers");

let lending;
let aps;
let apsDex;
let owner;
let borrower;
let movePrice;

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

    //deploy the move price contract
    const MovePrice = await ethers.getContractFactory("MovePrice");
    movePrice = await MovePrice.deploy(apsAddress, apsDexAddress);

    await movePrice.waitForDeployment();

    // console.log("MovePrice Contract deployed at: ", movePrice.getAddress());
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

describe("Repay Loan", function () {
    it("Should revert if the user has no active loan", async function () {
        const collateral = ethers.parseEther("100");
        const initalLiquidity = ethers.parseEther("30000");
        const ethForPool = ethers.parseEther("1000");
        const lendingLiquidity = ethers.parseEther("5000");

        //allow apsdex contract to spend aps token on its behalf
        await aps.connect(owner).approve(apsDex.target, initalLiquidity);

        //mint some more aps tokens to the owner
        await aps.connect(owner).mintToken(owner.address, ethers.parseEther("10000"));

        //add the inital APS tokens to the ETH/APS pool as the inital liquidity
        await apsDex.connect(owner).initializePool(initalLiquidity);

        //add eth to the APSDEX pool(ETH/APS) so as to determine the price of APS to ETH
        await owner.sendTransaction({ to: apsDex.target, value: ethForPool });

        //add 5000 1e18 APS tokens to the lending contract to facilitate borrowing of APS token
        await aps.connect(owner).transfer(lending.target, lendingLiquidity);

        //provide collateral
        await lending.connect(borrower).addCollateral(collateral, { value: collateral });

        await expect(lending.connect(borrower).repayLoan()).to.be.revertedWith("No active loan");
    })

    it("Should revert if the user has insufficient APS to repay loan", async function () {
        const collateral = ethers.parseEther("100");
        const initalLiquidity = ethers.parseEther("30000");
        const ethForPool = ethers.parseEther("1000");
        const lendingLiquidity = ethers.parseEther("5000");
        const borrowAPSAmount = ethers.parseEther("500");

        //allow apsdex contract to spend aps token on its behalf
        await aps.connect(owner).approve(apsDex.target, initalLiquidity);

        //mint some more aps tokens to the owner
        await aps.connect(owner).mintToken(owner.address, ethers.parseEther("10000"));

        //add the inital APS tokens to the ETH/APS pool as the inital liquidity
        await apsDex.connect(owner).initializePool(initalLiquidity);

        //add eth to the APSDEX pool(ETH/APS) so as to determine the price of APS to ETH
        await owner.sendTransaction({ to: apsDex.target, value: ethForPool });

        //add 5000 1e18 APS tokens to the lending contract to facilitate borrowing of APS token
        await aps.connect(owner).transfer(lending.target, lendingLiquidity);

        //provide collateral
        await lending.connect(borrower).addCollateral(collateral, { value: collateral });

        //borror APS tokens
        await lending.connect(borrower).borrowAPS(borrowAPSAmount);

        await expect(lending.connect(borrower).repayLoan()).to.be.revertedWith("Insufficient APS");
    })

    it("Should revert if the user has not approved the contract to spend its APS tokens", async function () {
        const collateral = ethers.parseEther("100");
        const initalLiquidity = ethers.parseEther("30000");
        const ethForPool = ethers.parseEther("1000");
        const lendingLiquidity = ethers.parseEther("5000");
        const borrowAPSAmount = ethers.parseEther("500");

        //allow apsdex contract to spend aps token on its behalf
        await aps.connect(owner).approve(apsDex.target, initalLiquidity);

        //mint some more aps tokens to the owner
        await aps.connect(owner).mintToken(owner.address, ethers.parseEther("10000"));

        //add the inital APS tokens to the ETH/APS pool as the inital liquidity
        await apsDex.connect(owner).initializePool(initalLiquidity);

        //add eth to the APSDEX pool(ETH/APS) so as to determine the price of APS to ETH
        await owner.sendTransaction({ to: apsDex.target, value: ethForPool });

        //add 5000 1e18 APS tokens to the lending contract to facilitate borrowing of APS token
        await aps.connect(owner).transfer(lending.target, lendingLiquidity);

        //provide collateral
        await lending.connect(borrower).addCollateral(collateral, { value: collateral });

        //borror APS tokens
        await lending.connect(borrower).borrowAPS(borrowAPSAmount);

        //mint some APS tokens
        await aps.connect(borrower).mintToken(borrower.address, ethers.parseEther("900"));

        await expect(lending.connect(borrower).repayLoan()).to.be.revertedWith("Approve APS first");
    })

    it("Should repay loan successfully", async function () {
        const collateral = ethers.parseEther("100");
        const initalLiquidity = ethers.parseEther("30000");
        const ethForPool = ethers.parseEther("1000");
        const lendingLiquidity = ethers.parseEther("5000");
        const borrowAPSAmount = ethers.parseEther("500");
        const borrowerAPSBalance = ethers.parseEther("900");


        //allow apsdex contract to spend aps token on its behalf
        await aps.connect(owner).approve(apsDex.target, initalLiquidity);

        //mint some more aps tokens to the owner
        await aps.connect(owner).mintToken(owner.address, ethers.parseEther("10000"));

        //add the inital APS tokens to the ETH/APS pool as the inital liquidity
        await apsDex.connect(owner).initializePool(initalLiquidity);

        //add eth to the APSDEX pool(ETH/APS) so as to determine the price of APS to ETH
        await owner.sendTransaction({ to: apsDex.target, value: ethForPool });

        //add 5000 1e18 APS tokens to the lending contract to facilitate borrowing of APS token
        await aps.connect(owner).transfer(lending.target, lendingLiquidity);

        //provide collateral
        await lending.connect(borrower).addCollateral(collateral, { value: collateral });

        //borror APS tokens
        await lending.connect(borrower).borrowAPS(borrowAPSAmount);

        //mint some APS tokens
        await aps.connect(borrower).mintToken(borrower.address, borrowerAPSBalance);

        await aps.connect(borrower).approve(lending.target, borrowerAPSBalance);

        // calculate interest immediately before repayment to approximate expected repay amount
        const interest = await lending.connect(borrower).calculateInterest(borrower.address);
        const repayAmount = interest + borrowAPSAmount;

        // perform repayment and parse emitted event (use tolerance for tiny on-chain time drift)
        const tx = await lending.connect(borrower).repayLoan();
        const receipt = await tx.wait();

        const parsedEvent = receipt.logs
            .map((log) => {
                try {
                    return lending.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .find((event) => event && event.name === "Repaid");

        expect(parsedEvent).to.not.equal(undefined);
        expect(parsedEvent.args.user).to.equal(borrower.address);

        const eventAmount = parsedEvent.args.amount;

        // ensure event amount is at least the principal and within a small tolerance for accrued interest
        const tolerance = ethers.parseEther("0.00001");
        const diff = eventAmount > borrowAPSAmount ? eventAmount - borrowAPSAmount : borrowAPSAmount - eventAmount;
        expect(eventAmount >= borrowAPSAmount).to.equal(true);
        expect(diff <= tolerance).to.equal(true);

        // ensure borrower's debt was cleared
        const position = await lending.positions(borrower.address);
        expect(position.borrowedAPS).to.equal(0);
    })
})

describe("Liquidate", function () {
    it("Should revert if all the liquidtion conditions are not met", async function () {
        const collateral = ethers.parseEther("600");
        const initalLiquidity = ethers.parseEther("3000");
        const ethForPool = ethers.parseEther("1000");
        const lendingLiquidity = ethers.parseEther("5000");
        const borrowAPSAmount = ethers.parseEther("500");
        const borrowerAPSBalance = ethers.parseEther("900");
        const movePriceEthAmount = ethers.parseEther("2000");

        //add collateral
        await lending.connect(borrower).addCollateral(collateral, { value: collateral });

        //approve the lending contract to use aps tokens
        await aps.connect(owner).approve(lending.target, lendingLiquidity);

        //approve APSDEX to use aps tokens
        await aps.connect(owner).approve(apsDex.target, initalLiquidity);

        //let owner add liquidity
        await apsDex.connect(owner).initializePool(initalLiquidity);

        //add eth to the ETH/APS pool or the DEX
        await owner.sendTransaction({ to: apsDex.target, value: ethForPool });

        //add some aps tokens to the lending contract to facilitate borrowing
        await aps.connect(owner).transfer(lending.target, lendingLiquidity);

        //let the borrower take some aps loan
        await lending.connect(borrower).borrowAPS(borrowAPSAmount);

        //ensure owner has enough ETH to perform the price move
        await ethers.provider.send("hardhat_setBalance", [owner.address, '0x' + ethers.parseEther("5000").toString(16)]);
        //try to move the price by swapping in more ETH to the ETH/APS pool
        await movePrice.connect(owner).movePrice(movePriceEthAmount, { value: movePriceEthAmount });

        await expect(lending.connect(owner).liquidate(borrower.address)).to.be.revertedWith("Not liquidatable");
    })

    it("Should liquidate successfully if all the liquidtion conditions are met", async function () {
        const collateral = ethers.parseEther("100");
        const initalLiquidity = ethers.parseEther("30000");
        const ethForPool = ethers.parseEther("1000");
        const lendingLiquidity = ethers.parseEther("5000");
        const borrowAPSAmount = ethers.parseEther("100");
        const borrowerAPSBalance = ethers.parseEther("2000");
        const movePriceEthAmount = ethers.parseEther("2000");

        //approve the lending contract to use aps tokens
        await aps.connect(owner).approve(lending.target, lendingLiquidity);

        //approve APSDEX to use aps tokens
        await aps.connect(owner).approve(apsDex.target, initalLiquidity);

        //add collateral
        await lending.connect(borrower).addCollateral(collateral, { value: collateral });

        //let owner add liquidity
        await apsDex.connect(owner).initializePool(initalLiquidity);

        //add eth to the ETH/APS pool or the DEX
        await owner.sendTransaction({ to: apsDex.target, value: ethForPool });

        //add some aps tokens to the lending contract to facilitate borrowing
        await aps.connect(owner).transfer(lending.target, lendingLiquidity);

        //let the borrower take some aps loan
        await lending.connect(borrower).borrowAPS(borrowAPSAmount);

        //ensure owner has enough ETH to perform the price move
        await ethers.provider.send("hardhat_setBalance", [owner.address, '0x' + ethers.parseEther("5000").toString(16)]);
        //try to move the price by swapping in more ETH to the ETH/APS pool
        await movePrice.connect(owner).movePrice(movePriceEthAmount, { value: movePriceEthAmount });

        //simulate move the time 24hrs after
        await ethers.provider.send("evm_increaseTime", [25 * 60 * 60]);
        await ethers.provider.send("evm_mine", []);

        // calculate interest immediately before repayment to approximate expected repay amount
        const interest = await lending.connect(borrower).calculateInterest(borrower.address);
        const repayAmount = interest + borrowAPSAmount;
        const collateralReward = (repayAmount * 10) / 100;

        //mint some more aps tokens to the owner to ensure they have enough to repay the loan during liquidation
        await aps.connect(owner).mintToken(owner.address, ethers.parseEther("10000"));

        await expect(lending.connect(owner).liquidate(borrower.address)).to.emit(lending, "Liquidated").withArgs(owner.address, borrower.address, repayAmount, collateralReward);
    })
})

