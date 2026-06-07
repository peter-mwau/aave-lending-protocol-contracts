// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IDiamondCut } from "./DiamondInterfaces/IDiamondCut.sol";
import { LibDiamond } from "./DiamondLibrary/LibDiamond.sol";
import { DiamondCutFacet } from "./facets/DiamondCutFacet.sol";
import { DiamondLoupeFacet } from "./facets/DiamondLoupeFacet.sol";
import { OwnershipFacet } from "./facets/OwnershipFacet.sol";
import { ApsdexFacet } from "./facets/ApsdexFacet.sol";
import { FlashLoanFacet } from "./facets/FlashLoanFacet.sol";
import { MovePriceFacet } from "./facets/MovePriceFacet.sol";
import { LendingFacet } from "./facets/LendingFacet.sol";
import { DiamondInit } from "./upgradeInitializers/DiamondInit.sol";

contract MainDiamond {
    constructor(IERC20 _tokenAddress) payable {
        LibDiamond.setContractOwner(msg.sender);

        DiamondCutFacet diamondCutFacet = new DiamondCutFacet();
        DiamondLoupeFacet diamondLoupeFacet = new DiamondLoupeFacet();
        OwnershipFacet ownershipFacet = new OwnershipFacet();
        ApsdexFacet apsdexFacet = new ApsdexFacet();
        DiamondInit diamondInit = new DiamondInit();

        IDiamondCut.FacetCut[] memory cut = new IDiamondCut.FacetCut[](7);

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

        bytes4[] memory apsdexSelectors = new bytes4[](13);
        apsdexSelectors[0] = ApsdexFacet.token.selector;
        apsdexSelectors[1] = ApsdexFacet.ethReserve.selector;
        apsdexSelectors[2] = ApsdexFacet.apsReserve.selector;
        apsdexSelectors[3] = ApsdexFacet.totalLiquidity.selector;
        apsdexSelectors[4] = ApsdexFacet.liquidity.selector;
        apsdexSelectors[5] = ApsdexFacet.initialized.selector;
        apsdexSelectors[6] = ApsdexFacet.initializePool.selector;
        apsdexSelectors[7] = ApsdexFacet.price.selector;
        apsdexSelectors[8] = ApsdexFacet.currentPrice.selector;
        apsdexSelectors[9] = ApsdexFacet.calculateXInput.selector;
        apsdexSelectors[10] = ApsdexFacet.swap.selector;
        apsdexSelectors[11] = ApsdexFacet.deposit.selector;
        apsdexSelectors[12] = ApsdexFacet.withdraw.selector;
        cut[3] = IDiamondCut.FacetCut({
            facetAddress: address(apsdexFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: apsdexSelectors
        });

        FlashLoanFacet flashLoanFacet = new FlashLoanFacet();
        bytes4[] memory flashLoanSelectors = new bytes4[](5);
        flashLoanSelectors[0] = FlashLoanFacet.initializeFlashLoan.selector;
        flashLoanSelectors[1] = FlashLoanFacet.executeOperation.selector;
        flashLoanSelectors[2] = FlashLoanFacet.requestFlashLoanSimple.selector;
        flashLoanSelectors[3] = FlashLoanFacet.getBalance.selector;
        flashLoanSelectors[4] = FlashLoanFacet.withdrawFunds.selector;
        cut[4] = IDiamondCut.FacetCut({
            facetAddress: address(flashLoanFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: flashLoanSelectors
        });

        MovePriceFacet movePriceFacet = new MovePriceFacet();
        bytes4[] memory movePriceSelectors = new bytes4[](2);
        movePriceSelectors[0] = MovePriceFacet.initializeMovePrice.selector;
        movePriceSelectors[1] = MovePriceFacet.movePrice.selector;
        cut[5] = IDiamondCut.FacetCut({
            facetAddress: address(movePriceFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: movePriceSelectors
        });

        LendingFacet lendingFacet = new LendingFacet();
        bytes4[] memory lendingSelectors = new bytes4[](15);
        lendingSelectors[0] = LendingFacet.initializeLending.selector;
        lendingSelectors[1] = LendingFacet.addCollateral.selector;
        lendingSelectors[2] = LendingFacet.withdrawCollateral.selector;
        lendingSelectors[3] = LendingFacet.borrowAPS.selector;
        lendingSelectors[4] = LendingFacet.repayLoan.selector;
        lendingSelectors[5] = LendingFacet.liquidate.selector;
        lendingSelectors[6] = LendingFacet.getHealthFactor.selector;
        lendingSelectors[7] = LendingFacet.canLiquidate.selector;
        lendingSelectors[8] = LendingFacet.updateRiskStatus.selector;
        lendingSelectors[9] = LendingFacet.calculateStakingYield.selector;
        lendingSelectors[10] = LendingFacet.harvestCollateralYield.selector;
        lendingSelectors[11] = LendingFacet.calculateInterest.selector;
        lendingSelectors[12] = LendingFacet.getRepayAmount.selector;
        lendingSelectors[13] = LendingFacet.getPosition.selector;
        lendingSelectors[14] = LendingFacet.apsToETHValue.selector;
        cut[6] = IDiamondCut.FacetCut({
            facetAddress: address(lendingFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: lendingSelectors
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