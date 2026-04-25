const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

let flashLoan;
let owner;
let addr1;

beforeEach(async function () {
  [owner, addr1] = await ethers.getSigners();

  const MockPool = await ethers.getContractFactory("MockPool");
  const mockPool = await MockPool.deploy({ gasLimit: 2_000_000 });
  await mockPool.waitForDeployment();

  const MockPoolAddressesProvider = await ethers.getContractFactory("MockPoolAddressesProvider");
  const mockProvider = await MockPoolAddressesProvider.deploy(await mockPool.getAddress(), {
    gasLimit: 2_000_000
  });
  await mockProvider.waitForDeployment();

  const FlashLoan = await ethers.getContractFactory("FlashLoan");
  flashLoan = await FlashLoan.deploy(
    await mockProvider.getAddress(),
    {
      gasLimit: 16_000_000
    }
  );
  await flashLoan.waitForDeployment();
});

describe("Deployment", function () {
  it("Should set the right owner", async function () {
    assert.equal(await flashLoan.owner(), owner.address);
  })
})

describe("Flash Loan", function () {
  it("Should execute a flash loan and repay it", async function () {
    const asset = ethers.Wallet.createRandom().address;
    const amount = ethers.parseEther("1");

    // Fund the mock pool with the asset
    await flashLoan.mockPool().fundPool(asset, amount);

    // Execute the flash loan
    await flashLoan.executeFlashLoan(asset, amount);

    // Check that the loan was repaid
    const poolBalance = await flashLoan.mockPool().getPoolBalance(asset);
    assert.equal(poolBalance.toString(), amount.toString(), "The loan was not repaid correctly");
  });
});


