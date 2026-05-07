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


    address private owner;

    //mappings
    mapping(address => uint256) public userBorrowedValue;
    mapping(address => uint256) public userDepositedValue;
    mapping(address => bool) public isUserVaiableForLiquidation;
    mapping(address => uint256) public userRiskTimestampStart;

    //Events
    event DepositSuccess(address indexed _sender, uint256 _amount);
    event BorrowSuccess(address indexed _borrower, uint256 _borrowAmount);
    event WithrdrawalSuccess(uint256 indexed _withdrawalAmount);
    event Liquidation_Success(address indexed _liquidator, address borrower, uint256 indexed _amount);


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

        (bool success, ) = payable(i_apsDex).transferFrom(address(this), msg.sender, _amount);
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
        require(token.balanceOf(msg.sender) >= userBorrowedValue(_user), "Insufficient funds!");

        uint256 liquidatorValue = userDepositedValue[_user] + (10 * userBorrowedValue[_user]) / 100;

        (bool success, ) = token(msg.sender).transferFrom(msg.sender, address(this), userBorrowedValue[_user]);

        require(success, "Token transfer failed!");

        (bool successs, ) = payable(address(this)).transfer(msg.sender).call{ value : liquidatorValue}(" ");

        require(successs, "Transfer Failed!");

        userBorrowedValue[_user] = 0;

        userDepositedValue[_user] = 0;

        emit Liquidation_Success(msg.sender, _user, userBorrowedValue);

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

}