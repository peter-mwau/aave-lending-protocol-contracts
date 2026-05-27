// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC165 } from "../DiamondInterfaces/IERC165.sol";
import { IDiamondCut } from "../DiamondInterfaces/IDiamondCut.sol";
import { IDiamondLoupe } from "../DiamondInterfaces/IDiamondLoupe.sol";
import { IERC173 } from "../DiamondInterfaces/IERC173.sol";
import { LibDiamond } from "../DiamondLibrary/LibDiamond.sol";

contract DiamondInit {
    function init(address tokenAddress) external {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        ds.supportedInterfaces[type(IERC165).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondCut).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondLoupe).interfaceId] = true;
        ds.supportedInterfaces[type(IERC173).interfaceId] = true;

        LibDiamond.APSDEXStorage storage apsdex = LibDiamond.apsdexStorage();
        apsdex.token = IERC20(tokenAddress);
        apsdex.ethReserve = 0;
        apsdex.apsReserve = 0;
        apsdex.totalLiquidity = 0;
        apsdex.initialized = false;
    }
}
