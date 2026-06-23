// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { LibDiamond } from "../DiamondLibrary/LibDiamond.sol";

interface IAPSDEXPriceFacet {
    function currentPrice() external view returns (uint256);
}

contract LendingFacet {
    uint256 public constant COLLATERAL_RATIO = 120;
    uint256 public constant LIQUIDATION_BONUS = 10;
    uint256 public constant PRECISION = 1e18;
    uint256 public constant INTEREST_RATE = 10;
    uint256 public constant YEAR = 365 days;
    uint256 public constant STAKING_APR = 15;
    uint256 public constant LIQUIDATION_GRACE_PERIOD = 24 hours;

    struct Position {
        uint256 collateralETH;
        uint256 borrowedAPS;
        uint256 borrowTimestamp;
        uint256 riskTimestamp;
        uint256 stakeTimestamp;
    }

    event CollateralDeposited(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event Liquidated(address indexed liquidator, address indexed borrower, uint256 debtRepaid, uint256 collateralSeized);
    event StakeSuccess(address indexed user, uint256 amount);
    event DebtReduced(address indexed user, uint256 amount);

    function initializeLending(address apsToken, address apsDex) external {
        LibDiamond.enforceIsContractOwner();

        LibDiamond.EcosystemDataStorage storage ecosystem = LibDiamond.ecosystemDataStorage();
        ecosystem.data.apsToken = apsToken;
        ecosystem.data.apsDex = apsDex;

        LibDiamond.LendingFacetStorage storage ls = LibDiamond.lendingFacetStorage();
        ls.aps = apsToken;
        ls.apsDex = apsDex;
        // Initialize totalBorrowed to 0
        ls.totalBorrowed = 0;
    }

    function addCollateral(uint256 amount) external payable {
        require(msg.value == amount, "Must deposit ETH");
        LibDiamond.LendingFacetStorage storage ls = LibDiamond.lendingFacetStorage();
        LibDiamond.LendingPosition storage user = ls.positions[msg.sender];
        user.collateralETH += msg.value;
        emit CollateralDeposited(msg.sender, msg.value);
        _stake(msg.sender);
    }

    function withdrawCollateral(uint256 amount) external {
        LibDiamond.LendingFacetStorage storage ls = LibDiamond.lendingFacetStorage();
        LibDiamond.LendingPosition storage user = ls.positions[msg.sender];

        require(user.collateralETH >= amount, "Insufficient collateral");
        user.collateralETH -= amount;

        require(getHealthFactor(msg.sender) >= PRECISION || user.borrowedAPS == 0, "Withdrawal breaks health factor");

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "ETH transfer failed");

        emit CollateralWithdrawn(msg.sender, amount);
        updateRiskStatus(msg.sender);
    }

    // UPDATED: borrowAPS with proper totalBorrowed tracking
    function borrowAPS(uint256 amount) external {
        require(amount > 0, "Invalid amount");

        LibDiamond.LendingFacetStorage storage ls = LibDiamond.lendingFacetStorage();
        LibDiamond.LendingPosition storage user = ls.positions[msg.sender];

        // ensure the caller has posted collateral before performing price lookups
        require(user.collateralETH > 0, "Insufficient collateral");

        uint256 newBorrowedAmount = user.borrowedAPS + amount;
        uint256 borrowedValueETH = apsToETHValue(newBorrowedAmount);
        uint256 collateralRatio = (user.collateralETH * 100) / borrowedValueETH;

        require(collateralRatio >= COLLATERAL_RATIO, "Insufficient collateral");

        IERC20 aps = IERC20(LibDiamond.ecosystemDataStorage().data.apsToken);
        
        // Calculate available lending liquidity
        uint256 totalDiamondBalance = aps.balanceOf(address(this));
        uint256 totalBorrowed = ls.totalBorrowed;
        uint256 availableLending = totalDiamondBalance - totalBorrowed;
        
        require(availableLending >= amount, "Protocol lacks liquidity");

        user.borrowedAPS = newBorrowedAmount;
        if (user.borrowTimestamp == 0) {
            user.borrowTimestamp = block.timestamp;
        }
        
        // Update global total borrowed
        ls.totalBorrowed += amount;

        require(aps.transfer(msg.sender, amount), "APS transfer failed");

        emit Borrowed(msg.sender, amount);
        harvestCollateralYield(msg.sender);
        updateRiskStatus(msg.sender);
    }

    // UPDATED: repayLoan with totalBorrowed tracking
    function repayLoan() external {
        LibDiamond.LendingFacetStorage storage ls = LibDiamond.lendingFacetStorage();
        LibDiamond.LendingPosition storage user = ls.positions[msg.sender];

        require(user.borrowedAPS > 0, "No active loan");

        harvestCollateralYield(msg.sender);

        uint256 repayAmount = getRepayAmount(msg.sender);
        IERC20 aps = IERC20(LibDiamond.ecosystemDataStorage().data.apsToken);

        require(aps.balanceOf(msg.sender) >= repayAmount, "Insufficient APS");
        require(aps.allowance(msg.sender, address(this)) >= repayAmount, "Approve APS first");

        require(aps.transferFrom(msg.sender, address(this), repayAmount), "Repayment failed");

        // Reduce global total borrowed
        ls.totalBorrowed -= user.borrowedAPS;

        user.borrowedAPS = 0;
        user.borrowTimestamp = 0;
        user.riskTimestamp = 0;

        emit Repaid(msg.sender, repayAmount);
    }

    // UPDATED: liquidate with totalBorrowed tracking
    function liquidate(address borrower) external {
        require(canLiquidate(borrower), "Not liquidatable");

        LibDiamond.LendingFacetStorage storage ls = LibDiamond.lendingFacetStorage();
        LibDiamond.LendingPosition storage user = ls.positions[borrower];

        harvestCollateralYield(borrower);

        uint256 debt = getRepayAmount(borrower);
        IERC20 aps = IERC20(LibDiamond.ecosystemDataStorage().data.apsToken);

        require(aps.balanceOf(msg.sender) >= debt, "Insufficient APS");
        require(aps.allowance(msg.sender, address(this)) >= debt, "Approve APS first");

        require(aps.transferFrom(msg.sender, address(this), debt), "APS transfer failed");

        uint256 debtValueETH = apsToETHValue(debt);
        uint256 collateralReward = (debtValueETH * (100 + LIQUIDATION_BONUS)) / 100;

        require(collateralReward <= user.collateralETH, "Insufficient collateral");

        user.collateralETH -= collateralReward;
        
        // Reduce global total borrowed
        ls.totalBorrowed -= user.borrowedAPS;
        
        user.borrowedAPS = 0;
        user.borrowTimestamp = 0;
        user.riskTimestamp = 0;

        (bool ethSuccess, ) = payable(msg.sender).call{value: collateralReward}("");
        require(ethSuccess, "ETH transfer failed");

        emit Liquidated(msg.sender, borrower, debt, collateralReward);
    }

    function getHealthFactor(address userAddress) public view returns (uint256) {
        Position memory user = _getPosition(userAddress);
        if (user.borrowedAPS == 0) {
            return type(uint256).max;
        }

        uint256 borrowedValueETH = apsToETHValue(user.borrowedAPS);
        return (user.collateralETH * PRECISION * 100) / (borrowedValueETH * COLLATERAL_RATIO);
    }

    function canLiquidate(address userAddress) public view returns (bool) {
        Position memory user = _getPosition(userAddress);
        if (getHealthFactor(userAddress) >= PRECISION) {
            return false;
        }
        if (user.riskTimestamp == 0) {
            return false;
        }
        return block.timestamp >= user.riskTimestamp + LIQUIDATION_GRACE_PERIOD;
    }

    function updateRiskStatus(address userAddress) public {
        uint256 hf = getHealthFactor(userAddress);
        LibDiamond.LendingFacetStorage storage ls = LibDiamond.lendingFacetStorage();
        LibDiamond.LendingPosition storage user = ls.positions[userAddress];

        if (hf < PRECISION) {
            if (user.riskTimestamp == 0) {
                user.riskTimestamp = block.timestamp;
            }
        } else {
            user.riskTimestamp = 0;
        }
    }

    function calculateStakingYield(address userAddress) public view returns (uint256) {
        Position memory position = _getPosition(userAddress);
        if (position.collateralETH == 0 || position.stakeTimestamp == 0) {
            return 0;
        }

        uint256 elapsedTime = block.timestamp - position.stakeTimestamp;
        return (position.collateralETH * STAKING_APR * elapsedTime) / (100 * YEAR);
    }

    function harvestCollateralYield(address userAddress) public returns (uint256) {
        Position memory position = _getPosition(userAddress);
        require(position.collateralETH != 0, "No collateral!");

        uint256 yield = calculateStakingYield(userAddress);
        uint256 price = IAPSDEXPriceFacet(LibDiamond.ecosystemDataStorage().data.apsDex).currentPrice();
        uint256 yieldInAPS = (yield * 1e18) / price;
        uint256 debt = getRepayAmount(userAddress);

        if (yieldInAPS > 0) {
            require(yieldInAPS <= debt, "Yield exceeds debt");
            reduceDebt(userAddress, yieldInAPS);
        }

        emit DebtReduced(userAddress, yieldInAPS);
        return yieldInAPS;
    }

    function calculateInterest(address userAddress) public view returns (uint256) {
        Position memory user = _getPosition(userAddress);
        if (user.borrowedAPS == 0 || user.borrowTimestamp == 0) {
            return 0;
        }

        uint256 timeElapsed = block.timestamp - user.borrowTimestamp;
        return (user.borrowedAPS * INTEREST_RATE * timeElapsed) / (100 * YEAR);
    }

    function getRepayAmount(address userAddress) public view returns (uint256) {
        Position memory user = _getPosition(userAddress);
        return user.borrowedAPS + calculateInterest(userAddress);
    }

    function getPosition(address userAddress) public view returns (Position memory) {
        return _getPosition(userAddress);
    }

    function apsToETHValue(uint256 apsAmount) public view returns (uint256) {
        uint256 apsPrice = IAPSDEXPriceFacet(LibDiamond.ecosystemDataStorage().data.apsDex).currentPrice();
        return (apsAmount * apsPrice) / 1e18;
    }

    // NEW: View function to get lending pool stats (doesn't affect existing frontend)
    function getLendingPoolStats() external view returns (
        uint256 totalBalance,
        uint256 totalBorrowed,
        uint256 availableLending
    ) {
        LibDiamond.LendingFacetStorage storage ls = LibDiamond.lendingFacetStorage();
        IERC20 aps = IERC20(LibDiamond.ecosystemDataStorage().data.apsToken);
        
        totalBalance = aps.balanceOf(address(this));
        totalBorrowed = ls.totalBorrowed;
        availableLending = totalBalance - totalBorrowed;
    }

    // NEW: View function to get available lending APS
    function getAvailableLendingAPS() external view returns (uint256) {
        LibDiamond.LendingFacetStorage storage ls = LibDiamond.lendingFacetStorage();
        IERC20 aps = IERC20(LibDiamond.ecosystemDataStorage().data.apsToken);
        
        uint256 totalBalance = aps.balanceOf(address(this));
        uint256 totalBorrowed = ls.totalBorrowed;
        
        return totalBalance - totalBorrowed;
    }

    function _stake(address user) internal returns (bool) {
        LibDiamond.LendingFacetStorage storage ls = LibDiamond.lendingFacetStorage();
        LibDiamond.LendingPosition storage position = ls.positions[user];
        require(position.collateralETH != 0, "No collateral to stake!");

        if (position.stakeTimestamp == 0) {
            position.stakeTimestamp = block.timestamp;
        }

        emit StakeSuccess(user, position.collateralETH);
        return true;
    }

    // UPDATED: reduceDebt with totalBorrowed tracking
    function reduceDebt(address user, uint256 amount) internal {
        LibDiamond.LendingFacetStorage storage ls = LibDiamond.lendingFacetStorage();
        LibDiamond.LendingPosition storage position = ls.positions[user];
        require(position.borrowedAPS >= amount, "Amount exceeds debt");

        // Reduce global total borrowed
        ls.totalBorrowed -= amount;

        position.borrowedAPS -= amount;
        position.stakeTimestamp = block.timestamp;
        position.borrowTimestamp = block.timestamp;
        updateRiskStatus(user);
    }

    function _getPosition(address user) internal view returns (Position memory position) {
        LibDiamond.LendingFacetStorage storage ls = LibDiamond.lendingFacetStorage();
        LibDiamond.LendingPosition storage stored = ls.positions[user];
        position = Position({
            collateralETH: stored.collateralETH,
            borrowedAPS: stored.borrowedAPS,
            borrowTimestamp: stored.borrowTimestamp,
            riskTimestamp: stored.riskTimestamp,
            stakeTimestamp: stored.stakeTimestamp
        });
    }

    function debugPosition(address userAddress) external view returns (
        uint256 collateral,
        uint256 borrowed,
        uint256 borrowTime,
        uint256 riskTime,
        uint256 stakeTime
    ) {
        LibDiamond.LendingFacetStorage storage ls = LibDiamond.lendingFacetStorage();
        LibDiamond.LendingPosition storage user = ls.positions[userAddress];
        return (
            user.collateralETH,
            user.borrowedAPS,
            user.borrowTimestamp,
            user.riskTimestamp,
            user.stakeTimestamp
        );
    }
}