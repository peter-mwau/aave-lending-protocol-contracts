// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { IERC20 } from "@aave/core-v3/contracts/dependencies/openzeppelin/contracts/IERC20.sol";
import { FlashLoanSimpleReceiverBase } from "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import { IPoolAddressesProvider } from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";

contract FlashLoan is FlashLoanSimpleReceiverBase {
  address payable public owner;
  mapping(address => uint256) public userOwnedFunds;

  event FundsWithdrawn(address indexed owner, uint256 amount);

  modifier onlyOwner() {
    require(msg.sender == owner, "Only the contract owner can call this function");
    _;
  }

  constructor(address _addressProvider)
    FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_addressProvider))
  {
    owner = payable(msg.sender);
  }

  function executeOperation(
    address asset,
    uint256 amount,
    uint256 premium,
    address initiator,
    bytes calldata params
  ) external override returns (bool) {
    initiator;
    params;

    userOwnedFunds[asset] += amount + premium;
    IERC20(asset).approve(address(POOL), userOwnedFunds[asset]);
    return true;
  }

  function requestFlashLoanSimple(address _asset, uint256 _amount) external returns (bool) {
    bytes memory params = "";
    uint16 referralCode = 0;

    POOL.flashLoanSimple(address(this), _asset, _amount, params, referralCode);
    return true;
  }

  function getBalance(address _asset) external view returns (uint256) {
    return IERC20(_asset).balanceOf(address(this));
  }

  function withdrawFunds(address _tokenAddress) external onlyOwner returns (bool) {
    IERC20 token = IERC20(_tokenAddress);
    uint256 balance = token.balanceOf(address(this));
    require(balance > 0, "No funds to withdraw");

    token.transfer(owner, balance);

    emit FundsWithdrawn(owner, balance);
    return true;
  }

  receive() external payable {}
}