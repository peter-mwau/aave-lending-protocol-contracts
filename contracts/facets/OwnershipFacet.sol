// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC173 } from "../DiamondInterfaces/IERC173.sol";
import { LibDiamond } from "../DiamondLibrary/LibDiamond.sol";

contract OwnershipFacet is IERC173 {
    function owner() external view override returns (address) {
        return LibDiamond.contractOwner();
    }

    function transferOwnership(address _newOwner) external override {
        LibDiamond.enforceIsContractOwner();
        require(_newOwner != address(0), "OwnershipFacet: new owner is the zero address");

        address previousOwner = LibDiamond.contractOwner();
        LibDiamond.setContractOwner(_newOwner);
        emit OwnershipTransferred(previousOwner, _newOwner);
    }
}
