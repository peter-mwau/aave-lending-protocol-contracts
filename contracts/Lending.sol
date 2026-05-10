// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { APS } from "./APS.sol";
import { APSDEX } from "./APSDEX.sol";

contract Lending is Ownable {

    // =============================================================
    //                           STATE
    // =============================================================

    APS public immutable aps;
    APSDEX public immutable apsDex;

    uint256 public constant COLLATERAL_RATIO = 120; // 120%
    uint256 public constant LIQUIDATION_BONUS = 10; // 10%
    uint256 public constant PRECISION = 1e18;

    uint256 public constant INTEREST_RATE = 10; // 10% APR
    uint256 public constant YEAR = 365 days;

    uint256 public constant LIQUIDATION_GRACE_PERIOD = 24 hours;

    // =============================================================
    //                          STRUCTS
    // =============================================================

    struct Position {
        uint256 collateralETH;
        uint256 borrowedAPS;
        uint256 borrowTimestamp;
        uint256 riskTimestamp;
    }

    mapping(address => Position) public positions;

    // =============================================================
    //                           EVENTS
    // =============================================================

    event CollateralDeposited(
        address indexed user,
        uint256 amount
    );

    event Borrowed(
        address indexed user,
        uint256 amount
    );

    event Repaid(
        address indexed user,
        uint256 amount
    );

    event CollateralWithdrawn(
        address indexed user,
        uint256 amount
    );

    event Liquidated(
        address indexed liquidator,
        address indexed borrower,
        uint256 debtRepaid,
        uint256 collateralSeized
    );

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    constructor(
        address _aps,
        address _apsDex
    ) Ownable(msg.sender) {
        aps = APS(_aps);
        apsDex = APSDEX(payable(_apsDex));
    }

    // =============================================================
    //                   COLLATERAL FUNCTIONS
    // =============================================================

    function addCollateral(uint256 _amount) external payable {
        require(msg.value == _amount, "Must deposit ETH");

        positions[msg.sender].collateralETH += msg.value;

        emit CollateralDeposited(msg.sender, msg.value);
    }

    function withdrawCollateral(
        uint256 amount
    ) external {

        Position storage user = positions[msg.sender];

        require(
            user.collateralETH >= amount,
            "Insufficient collateral"
        );

        // simulate withdrawal first
        user.collateralETH -= amount;

        require(
            getHealthFactor(msg.sender) >= PRECISION ||
            user.borrowedAPS == 0,
            "Withdrawal breaks health factor"
        );

        (bool success, ) = payable(msg.sender).call{
            value: amount
        }("");

        require(success, "ETH transfer failed");

        emit CollateralWithdrawn(msg.sender, amount);
    }

    // =============================================================
    //                        BORROW LOGIC
    // =============================================================

    function borrowAPS(
        uint256 amount
    ) external {

        require(amount > 0, "Invalid amount");

        Position storage user = positions[msg.sender];

        uint256 newBorrowedAmount =
            user.borrowedAPS + amount;

        uint256 borrowedValueETH =
            apsToETHValue(newBorrowedAmount);

        uint256 collateralRatio =
            (user.collateralETH * 100)
            / borrowedValueETH;

        require(
            collateralRatio >= COLLATERAL_RATIO,
            "Insufficient collateral"
        );

        require(
            aps.balanceOf(address(this)) >= amount,
            "Protocol lacks liquidity"
        );

        user.borrowedAPS = newBorrowedAmount;

        if (user.borrowTimestamp == 0) {
            user.borrowTimestamp = block.timestamp;
        }

        bool success = aps.transfer(msg.sender, amount);

        require(success, "APS transfer failed");

        emit Borrowed(msg.sender, amount);
    }

    // =============================================================
    //                       REPAY LOGIC
    // =============================================================

    function repayLoan() external {

        Position storage user = positions[msg.sender];

        require(
            user.borrowedAPS > 0,
            "No active loan"
        );

        uint256 repayAmount =
            getRepayAmount(msg.sender);

        require(
            aps.balanceOf(msg.sender) >= repayAmount,
            "Insufficient APS"
        );

        require(
            aps.allowance(msg.sender, address(this))
            >= repayAmount,
            "Approve APS first"
        );

        bool success = aps.transferFrom(
            msg.sender,
            address(this),
            repayAmount
        );

        require(success, "Repayment failed");

        user.borrowedAPS = 0;
        user.borrowTimestamp = 0;
        user.riskTimestamp = 0;

        emit Repaid(msg.sender, repayAmount);
    }

    // =============================================================
    //                      LIQUIDATION LOGIC
    // =============================================================

    function liquidate(
        address borrower
    ) external {

        require(
            canLiquidate(borrower),
            "Not liquidatable"
        );

        Position storage user =
            positions[borrower];

        uint256 debt =
            getRepayAmount(borrower);

        require(
            aps.balanceOf(msg.sender) >= debt,
            "Insufficient APS"
        );

        require(
            aps.allowance(msg.sender, address(this))
            >= debt,
            "Approve APS first"
        );

        bool success = aps.transferFrom(
            msg.sender,
            address(this),
            debt
        );

        require(success, "APS transfer failed");

        uint256 debtValueETH =
            apsToETHValue(debt);

        uint256 collateralReward =
            (debtValueETH *
            (100 + LIQUIDATION_BONUS))
            / 100;

        require(
            collateralReward <=
            user.collateralETH,
            "Insufficient collateral"
        );

        user.collateralETH -= collateralReward;

        user.borrowedAPS = 0;
        user.borrowTimestamp = 0;
        user.riskTimestamp = 0;

        (bool ethSuccess, ) =
            payable(msg.sender).call{
                value: collateralReward
            }("");

        require(
            ethSuccess,
            "ETH transfer failed"
        );

        emit Liquidated(
            msg.sender,
            borrower,
            debt,
            collateralReward
        );
    }

    // =============================================================
    //                    HEALTH FACTOR LOGIC
    // =============================================================

    function getHealthFactor(
        address userAddress
    ) public view returns (uint256) {

        Position memory user =
            positions[userAddress];

        if (user.borrowedAPS == 0) {
            return type(uint256).max;
        }

        uint256 borrowedValueETH =
            apsToETHValue(user.borrowedAPS);

        return (
            user.collateralETH *
            PRECISION *
            100
        ) /
        (
            borrowedValueETH *
            COLLATERAL_RATIO
        );
    }

    function canLiquidate(
        address userAddress
    ) public view returns (bool) {

        Position memory user =
            positions[userAddress];

        if (
            getHealthFactor(userAddress)
            >= PRECISION
        ) {
            return false;
        }

        if (user.riskTimestamp == 0) {
            return false;
        }

        return (
            block.timestamp >=
            user.riskTimestamp +
            LIQUIDATION_GRACE_PERIOD
        );
    }

    function updateRiskStatus(
        address userAddress
    ) public {

        uint256 hf =
            getHealthFactor(userAddress);

        Position storage user =
            positions[userAddress];

        if (hf < PRECISION) {

            if (user.riskTimestamp == 0) {
                user.riskTimestamp =
                    block.timestamp;
            }

        } else {
            user.riskTimestamp = 0;
        }
    }

    // =============================================================
    //                     INTEREST FUNCTIONS
    // =============================================================

    function calculateInterest(
        address userAddress
    ) public view returns (uint256) {

        Position memory user =
            positions[userAddress];

        if (user.borrowedAPS == 0) {
            return 0;
        }

        uint256 timeElapsed =
            block.timestamp -
            user.borrowTimestamp;

        return (
            user.borrowedAPS *
            INTEREST_RATE *
            timeElapsed
        ) /
        (100 * YEAR);
    }

    function getRepayAmount(
        address userAddress
    ) public view returns (uint256) {

        Position memory user =
            positions[userAddress];

        return
            user.borrowedAPS +
            calculateInterest(userAddress);
    }

    // =============================================================
    //                      PRICE UTILITIES
    // =============================================================

    function apsToETHValue(
        uint256 apsAmount
    ) public view returns (uint256) {

        uint256 apsPrice =
            apsDex.currentPrice();

        return
            (apsAmount * apsPrice)
            / 1e18;
    }

    // =============================================================
    //                         RECEIVE
    // =============================================================

    receive() external payable {}
}