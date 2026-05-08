//SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { APS } from "../contracts/APS.sol";
import { APSDEX } from "../contracts/APSDEX.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Lending is Ownable {
    IERC20 token;
    APS private i_aps;
    APSDEX private i_apsDex;

    address public immutable dex;
    uint256 public constant COLLATERAL_RATIO= 120;
    uint256 public LIQUIDATION_REWARD = 10;
    uint256 public constant PRECISION = 1e18;
    uint256 public constant LIQUIDATION_GRACE_PERIOD = 24 hours;
    uint256 public constant INTEREST_RATE = 10;
    uint256 public constant YEAR = 365 days;


    address private owner;

    //mappings
    mapping(address => uint256) public userBorrowedValue;
    mapping(address => uint256) public userDepositedValue;
    mapping(address => bool) public isUserVaiableForLiquidation;
    mapping(address => uint256) public userRiskTimestampStart;
    mapping(address => uint256) public borrowTimestamp;

    //Events
    event DepositSuccess(address indexed _sender, uint256 _amount);
    event BorrowSuccess(address indexed _borrower, uint256 _borrowAmount);
    event WithrdrawalSuccess(uint256 indexed _withdrawalAmount);
    event Liquidation_Success(address indexed _liquidator, address borrower, uint256 indexed _amount);
    event Loan_Repayment_Success(address indexed _user, uint256 _amount);


    constructor(address _APS, address _APSDEX) Ownable(msg.sender){
        owner = msg.sender;
        i_aps = APS(_APS);
        i_apsDex = APSDEX(_APSDEX);

        i_aps.approve(address(this), type(uint256).max);
    }

    //function to deposit collateral
    function addCollateral(uint256 _amount) external payable returns(bool) {
        require(msg.value >= _amount, "Insufficient balance");

        (bool success, ) = msg.sender.call{ value : _amount} ("");
        require(success, "Deposit failed");

        userDepositedValue[msg.sender] += _amount;

        emit DepositSuccess(msg.sender, _amount);

        return true;
    }

    //function to borrow
    function borrowAPS(uint256 _amount) external returns(bool) {
        uint256 colletirizedPercentage = (userDepositedValue[msg.sender] / i_apsDex.currentPrice() * _amount) * 100;
        bool _OvercollaterizationPass;
        if(colletirizedPercentage >= COLLATERAL_RATIO) {
            _OvercollaterizationPass = true;
        } else {
            _OvercollaterizationPass = false;
        }
        
        require(_OvercollaterizationPass, "Over collaterization check failed!");

        bool success = i_aps.transferFrom(address(this), msg.sender, _amount);

        require(success, "Borrow Failed!");

        userBorrowedValue[msg.sender] += _amount;

        borrowTimestamp[msg.sender] = block.timestamp;

        emit BorrowSuccess(msg.sender, _amount);

        return true;
    }

    //function to calculate the collateral value
    function calculateCollateralValue(address _user) public returns(uint256) {
        require(userDepositedValue[_user] > 0, "Insufficient collateral!");

        uint256 collateralAmount = userDepositedValue[_user];
        
        return (i_apsDex.currentPrice() * collateralAmount) / 1e18;
    }

    //function to withdraw collateral
    function withdrawCollateral(uint256 _amount) external returns (uint256) {
        require(userDepositedValue[msg.sender] > _amount, "Insufficient funds!");
        require(userBorrowedValue[msg.sender] <= 0, "You can't withdraw collateral due to an existing loan!");

        (bool success, ) = payable(address(this)).transfer(msg.sender).call{ value : _amount}(" ");
        // (bool success, ) = payable(msg.sender).transfer(_amount);

        require(success, "Withdrawal Failed!");

        userDepositedValue[msg.sender] -= _amount;

        emit WithrdrawalSuccess(_amount);

        return _amount;
    }

    //function to get the health factor of a user
    function getHealthFactor(address user) public view returns (uint256) {
        uint256 collateralValue = calculateCollateralValue(user);
        uint256 borrowedValue = userBorrowedValue[user];

        if (borrowedValue == 0) {
            return type(uint256).max;
        }

    return (collateralValue * PRECISION * 100) / (borrowedValue * COLLATERAL_RATIO);

    }

    //function to liquidate
    function liquidate(address _user) external returns (bool) {
        require(getHealthFactor(_user) < 1e18, "Not liquidatable!");
        require(i_aps.balanceOf(msg.sender) >= userBorrowedValue(_user), "Insufficient funds!");

        uint256 liquidatorValue = userDepositedValue[_user] + (10 * userBorrowedValue[_user]) / 100;

        (bool success, ) = i_aps(msg.sender).transferFrom(msg.sender, address(this), userBorrowedValue[_user]);

        require(success, "Token transfer failed!");

        (bool successs, ) = payable(address(this)).transfer(msg.sender).call{ value : liquidatorValue}(" ");

        require(successs, "Transfer Failed!");

        userBorrowedValue[_user] = 0;

        userDepositedValue[_user] = 0;

        borrowTimestamp[_user] = 0;

        emit Liquidation_Success(msg.sender, _user, userBorrowedValue);

        //call the internal function to update the startrisktimestamp
        _updateStartRiskTimestamp(_user);

        return true;
    }

    //internal function to update the startrisktimestamp
    function _updateStartRiskTimestamp(address _user) internal {
        uint256 healthFactor = getHealthFactor(_user);

        // User unhealthy
        if (healthFactor < 1e18) {

            // Start timer if not already started
            if (userRiskTimestampStart[_user] == 0) {
                userRiskTimestampStart[_user] = block.timestamp;
            }

            // Check if grace period passed
            uint256 liquidationTime = userRiskTimestampStart[_user] + LIQUIDATION_GRACE_PERIOD;

            if (block.timestamp >= liquidationTime) {
                isUserVaiableForLiquidation[_user] = true;
            }

        } else {
            
            // User recovered
            userRiskTimestampStart[_user] = 0;
            isUserVaiableForLiquidation[_user] = false;
        }
    }

    //function to calculate the interest on a loan
    function calculateInterest(address user) public view returns (uint256) {
        uint256 principal = userBorrowedValue[user];

        uint256 timeElapsed = block.timestamp - borrowTimestamp[user];

        return (principal * INTEREST_RATE * timeElapsed) / (100 * 365 days);
    }

    //function to get the total repay amount including interest
    function getRepayAmount(address user) public view returns (uint256)
    {   
        return userBorrowedValue[user] + calculateInterest(user);
    }

    //function to repay borrowed loan
    function repayLoan(address _user) payable external returns (bool) {
        //call the updateRiskStartTimestamp internal function
        _updateStartRiskTimestamp(_user);

        //calculate the amount to repay
        uint256 amount = getRepayAmount(_user);

        //require that the user has enough balance to repay their loan
        require(i_aps.balanceOf(_user) >= amount, "Insufficient funds!");

        //require that the user is not viable for liquidation
        require(!isUserVaiableForLiquidation, "User is already viable for liquidation!");

        //require that the user actually has borrowed a loan
        require(userBorrowedValue[_user] != 0, "User doesn't have an existing loan!");

        //transfer the APS tokens to the contract from the user
        (bool success, ) = i_aps.transferFrom(_user, address(this), amount);

        require(success, "Debt repayment failed!");

        uint256 collateralAmount = userDepositedValue[_user];

        //get back the collataral
        (bool successs, ) = payable(address(this)).transfer(_user).call{ value : collateralAmount }("");

        require(successs, "Transfer of callateral back to borrower failed!");

        //reset the user borrowed mapping
        userBorrowedValue[_user] = 0;

        //reset the user collateral mapping
        userDepositedValue[_user] = 0;

        //reset the user borrow timestamp
        borrowTimestamp[_user] = 0;

        emit Loan_Repayment_Success(_user, amount);

        return true;

    }

}