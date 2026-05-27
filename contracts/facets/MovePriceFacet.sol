// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { LibDiamond } from "../DiamondLibrary/LibDiamond.sol";

interface IAPSDEXPrice {
    function swap(uint256 tokenInput) external payable returns (uint256 output);
}

contract MovePriceFacet {
    function initializeMovePrice(address apsToken, address apsDex) external {
        LibDiamond.enforceIsContractOwner();

        LibDiamond.EcosystemDataStorage storage ecosystem = LibDiamond.ecosystemDataStorage();
        ecosystem.data.apsToken = apsToken;
        ecosystem.data.apsDex = apsDex;

        LibDiamond.MovePriceFacetStorage storage ms = LibDiamond.movePriceFacetStorage();
        ms.aps = apsToken;
        ms.apsDex = apsDex;

        IERC20(apsToken).approve(apsDex, type(uint256).max);
    }

    function movePrice(int256 size) external payable {
        LibDiamond.EcosystemDataStorage storage ecosystem = LibDiamond.ecosystemDataStorage();
        address apsDex = ecosystem.data.apsDex;
        require(apsDex != address(0), "MovePriceFacet: APSDEX not set");

        if (size > 0) {
            IAPSDEXPrice(payable(apsDex)).swap{value: uint256(size)}(uint256(size));
        } else {
            IAPSDEXPrice(payable(apsDex)).swap(uint256(-size));
        }
    }
}
