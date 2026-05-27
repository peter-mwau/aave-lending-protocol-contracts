// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IDiamondCut } from "./DiamondInterfaces/IDiamondCut.sol";
import { LibDiamond } from "./DiamondLibrary/LibDiamond.sol";
import { DiamondCutFacet } from "./facets/DiamondCutFacet.sol";
import { DiamondLoupeFacet } from "./facets/DiamondLoupeFacet.sol";
import { OwnershipFacet } from "./facets/OwnershipFacet.sol";
import { APSDEXFacet } from "./facets/APSDEXFacet.sol";
import { DiamondInit } from "./upgradeInitializers/DiamondInit.sol";

contract APSDEX {
    constructor(IERC20 _tokenAddress) payable {
        LibDiamond.setContractOwner(msg.sender);

        DiamondCutFacet diamondCutFacet = new DiamondCutFacet();
        DiamondLoupeFacet diamondLoupeFacet = new DiamondLoupeFacet();
        OwnershipFacet ownershipFacet = new OwnershipFacet();
        APSDEXFacet apsdexFacet = new APSDEXFacet();
        DiamondInit diamondInit = new DiamondInit();

        IDiamondCut.FacetCut[] memory cut = new IDiamondCut.FacetCut[](4);

        bytes4[] memory cutSelectors = new bytes4[](1);
        cutSelectors[0] = DiamondCutFacet.diamondCut.selector;
        cut[0] = IDiamondCut.FacetCut({
            facetAddress: address(diamondCutFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: cutSelectors
        });

        bytes4[] memory loupeSelectors = new bytes4[](5);
        loupeSelectors[0] = DiamondLoupeFacet.facets.selector;
        loupeSelectors[1] = DiamondLoupeFacet.facetFunctionSelectors.selector;
        loupeSelectors[2] = DiamondLoupeFacet.facetAddresses.selector;
        loupeSelectors[3] = DiamondLoupeFacet.facetAddress.selector;
        loupeSelectors[4] = DiamondLoupeFacet.supportsInterface.selector;
        cut[1] = IDiamondCut.FacetCut({
            facetAddress: address(diamondLoupeFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: loupeSelectors
        });

        bytes4[] memory ownershipSelectors = new bytes4[](2);
        ownershipSelectors[0] = OwnershipFacet.owner.selector;
        ownershipSelectors[1] = OwnershipFacet.transferOwnership.selector;
        cut[2] = IDiamondCut.FacetCut({
            facetAddress: address(ownershipFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: ownershipSelectors
        });

        bytes4[] memory apsdexSelectors = new bytes4[](12);
        apsdexSelectors[0] = APSDEXFacet.token.selector;
        apsdexSelectors[1] = APSDEXFacet.ethReserve.selector;
        apsdexSelectors[2] = APSDEXFacet.apsReserve.selector;
        apsdexSelectors[3] = APSDEXFacet.totalLiquidity.selector;
        apsdexSelectors[4] = APSDEXFacet.liquidity.selector;
        apsdexSelectors[5] = APSDEXFacet.initializePool.selector;
        apsdexSelectors[6] = APSDEXFacet.price.selector;
        apsdexSelectors[7] = APSDEXFacet.currentPrice.selector;
        apsdexSelectors[8] = APSDEXFacet.calculateXInput.selector;
        apsdexSelectors[9] = APSDEXFacet.swap.selector;
        apsdexSelectors[10] = APSDEXFacet.deposit.selector;
        apsdexSelectors[11] = APSDEXFacet.withdraw.selector;
        cut[3] = IDiamondCut.FacetCut({
            facetAddress: address(apsdexFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: apsdexSelectors
        });

        LibDiamond.diamondCut(cut, address(diamondInit), abi.encodeWithSelector(DiamondInit.init.selector, address(_tokenAddress)));
    }

    fallback() external payable {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        address facet = ds.selectorToFacetAndPosition[msg.sig].facetAddress;
        require(facet != address(0), "APSDEX: Function does not exist");

        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }

    receive() external payable {}
}
