// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPool } from "@aave/core-v3/contracts/interfaces/IPool.sol";
import { LibDiamond } from "../DiamondLibrary/LibDiamond.sol";

contract FlashLoanFacet {
    event FundsWithdrawn(address indexed owner, uint256 amount);

    function initializeFlashLoan(address aavePool) external {
        LibDiamond.enforceIsContractOwner();
        LibDiamond.EcosystemDataStorage storage ecosystem = LibDiamond.ecosystemDataStorage();
        ecosystem.data.flashLoanPool = aavePool;

        LibDiamond.FlashLoanFacetStorage storage fs = LibDiamond.flashLoanFacetStorage();
        fs.owner = payable(msg.sender);
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        initiator;
        params;

        LibDiamond.EcosystemDataStorage storage ecosystem = LibDiamond.ecosystemDataStorage();
        require(msg.sender == ecosystem.data.flashLoanPool, "FlashLoanFacet: invalid pool caller");

        LibDiamond.FlashLoanFacetStorage storage fs = LibDiamond.flashLoanFacetStorage();
        fs.userOwnedFunds[asset] += amount + premium;
        IERC20(asset).approve(ecosystem.data.flashLoanPool, fs.userOwnedFunds[asset]);
        return true;
    }

    function requestFlashLoanSimple(address asset, uint256 amount) external returns (bool) {
        LibDiamond.EcosystemDataStorage storage ecosystem = LibDiamond.ecosystemDataStorage();
        require(ecosystem.data.flashLoanPool != address(0), "FlashLoanFacet: pool not set");

        bytes memory params = "";
        uint16 referralCode = 0;
        IPool(ecosystem.data.flashLoanPool).flashLoanSimple(address(this), asset, amount, params, referralCode);
        return true;
    }

    function getBalance(address asset) external view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    function withdrawFunds(address tokenAddress) external returns (bool) {
        LibDiamond.FlashLoanFacetStorage storage fs = LibDiamond.flashLoanFacetStorage();
        require(msg.sender == fs.owner, "FlashLoanFacet: only owner");

        IERC20 token = IERC20(tokenAddress);
        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "No funds to withdraw");

        token.transfer(fs.owner, balance);
        emit FundsWithdrawn(fs.owner, balance);
        return true;
    }
}
