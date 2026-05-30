// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IDiamondCut } from "../DiamondInterfaces/IDiamondCut.sol";
import { EcosystemLib } from "./EcosystemLib.sol";

library LibDiamond {
    bytes32 constant DIAMOND_STORAGE_POSITION = keccak256("diamond.standard.diamond.storage");
    bytes32 constant APSDEX_STORAGE_POSITION = keccak256("apsdex.storage");
    bytes32 constant ECOSYSTEM_DATA_STORAGE_POSITION = keccak256("ecosystem.data.storage");
    bytes32 constant FLASHLOAN_STORAGE_POSITION = keccak256("flashloan.storage");
    bytes32 constant LENDING_STORAGE_POSITION = keccak256("lending.storage");
    bytes32 constant MOVEPRICE_STORAGE_POSITION = keccak256("moveprice.storage");

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event DiamondCut(IDiamondCut.FacetCut[] _diamondCut, address _init, bytes _calldata);

    struct FacetAddressAndPosition {
        address facetAddress;
        uint96 functionSelectorPosition;
    }

    struct FacetFunctionSelectors {
        bytes4[] functionSelectors;
        uint256 facetAddressPosition;
    }

    struct DiamondStorage {
        mapping(bytes4 => FacetAddressAndPosition) selectorToFacetAndPosition;
        mapping(address => FacetFunctionSelectors) facetFunctionSelectors;
        address[] facetAddresses;
        mapping(bytes4 => bool) supportedInterfaces;
        address contractOwner;
    }

    struct APSDEXStorage {
        IERC20 token;
        uint256 ethReserve;
        uint256 apsReserve;
        uint256 totalLiquidity;
        bool initialized;
        mapping(address => uint256) liquidity;
    }

    struct EcosystemDataStorage {
        EcosystemLib.Data data;
    }

    struct FlashLoanFacetStorage {
        address payable owner;
        mapping(address => uint256) userOwnedFunds;
    }

    struct LendingPosition {
        uint256 collateralETH;
        uint256 borrowedAPS;
        uint256 borrowTimestamp;
        uint256 riskTimestamp;
        uint256 stakeTimestamp;
    }

    struct LendingFacetStorage {
        address aps;
        address apsDex;
        mapping(address => LendingPosition) positions;
    }

    struct MovePriceFacetStorage {
        address aps;
        address apsDex;
    }

    function diamondStorage() internal pure returns (DiamondStorage storage ds) {
        bytes32 position = DIAMOND_STORAGE_POSITION;
        assembly {
            ds.slot := position
        }
    }

    function apsdexStorage() internal pure returns (APSDEXStorage storage ds) {
        bytes32 position = APSDEX_STORAGE_POSITION;
        assembly {
            ds.slot := position
        }
    }

    function ecosystemDataStorage() internal pure returns (EcosystemDataStorage storage eds) {
        bytes32 position = ECOSYSTEM_DATA_STORAGE_POSITION;
        assembly {
            eds.slot := position
        }
    }

    function flashLoanFacetStorage() internal pure returns (FlashLoanFacetStorage storage fs) {
        bytes32 position = FLASHLOAN_STORAGE_POSITION;
        assembly {
            fs.slot := position
        }
    }

    function lendingFacetStorage() internal pure returns (LendingFacetStorage storage ls) {
        bytes32 position = LENDING_STORAGE_POSITION;
        assembly {
            ls.slot := position
        }
    }

    function movePriceFacetStorage() internal pure returns (MovePriceFacetStorage storage ms) {
        bytes32 position = MOVEPRICE_STORAGE_POSITION;
        assembly {
            ms.slot := position
        }
    }

    function setContractOwner(address _newOwner) internal {
        DiamondStorage storage ds = diamondStorage();
        address previousOwner = ds.contractOwner;
        ds.contractOwner = _newOwner;
        emit OwnershipTransferred(previousOwner, _newOwner);
    }

    function contractOwner() internal view returns (address contractOwner_) {
        contractOwner_ = diamondStorage().contractOwner;
    }

    function enforceIsContractOwner() internal view {
        require(msg.sender == diamondStorage().contractOwner, "LibDiamond: Must be contract owner");
    }

    function diamondCut(
        IDiamondCut.FacetCut[] memory _diamondCut,
        address _init,
        bytes memory _calldata
    ) internal {
        for (uint256 facetIndex; facetIndex < _diamondCut.length; facetIndex++) {
            IDiamondCut.FacetCutAction action = _diamondCut[facetIndex].action;
            if (action == IDiamondCut.FacetCutAction.Add) {
                addFunctions(_diamondCut[facetIndex].facetAddress, _diamondCut[facetIndex].functionSelectors);
            } else if (action == IDiamondCut.FacetCutAction.Replace) {
                replaceFunctions(_diamondCut[facetIndex].facetAddress, _diamondCut[facetIndex].functionSelectors);
            } else if (action == IDiamondCut.FacetCutAction.Remove) {
                removeFunctions(_diamondCut[facetIndex].facetAddress, _diamondCut[facetIndex].functionSelectors);
            } else {
                revert("LibDiamond: Incorrect FacetCutAction");
            }
        }

        emit DiamondCut(_diamondCut, _init, _calldata);
        initializeDiamondCut(_init, _calldata);
    }

    function addFunctions(address _facetAddress, bytes4[] memory _functionSelectors) internal {
        require(_facetAddress != address(0), "LibDiamond: Add facet can't be address(0)");
        enforceHasContractCode(_facetAddress, "LibDiamond: Add facet has no code");

        DiamondStorage storage ds = diamondStorage();
        uint256 selectorCount = _functionSelectors.length;
        require(selectorCount > 0, "LibDiamond: No selectors in facet to cut");

        if (ds.facetFunctionSelectors[_facetAddress].functionSelectors.length == 0) {
            ds.facetFunctionSelectors[_facetAddress].facetAddressPosition = ds.facetAddresses.length;
            ds.facetAddresses.push(_facetAddress);
        }

        for (uint256 selectorIndex; selectorIndex < selectorCount; selectorIndex++) {
            bytes4 selector = _functionSelectors[selectorIndex];
            address oldFacetAddress = ds.selectorToFacetAndPosition[selector].facetAddress;
            require(oldFacetAddress == address(0), "LibDiamond: Can't add function that already exists");

            ds.facetFunctionSelectors[_facetAddress].functionSelectors.push(selector);
            ds.selectorToFacetAndPosition[selector] = FacetAddressAndPosition({
                facetAddress: _facetAddress,
                functionSelectorPosition: uint96(ds.facetFunctionSelectors[_facetAddress].functionSelectors.length - 1)
            });
        }
    }

    function replaceFunctions(address _facetAddress, bytes4[] memory _functionSelectors) internal {
        require(_facetAddress != address(0), "LibDiamond: Replace facet can't be address(0)");
        enforceHasContractCode(_facetAddress, "LibDiamond: Replace facet has no code");

        DiamondStorage storage ds = diamondStorage();
        uint256 selectorCount = _functionSelectors.length;
        require(selectorCount > 0, "LibDiamond: No selectors in facet to cut");

        if (ds.facetFunctionSelectors[_facetAddress].functionSelectors.length == 0) {
            ds.facetFunctionSelectors[_facetAddress].facetAddressPosition = ds.facetAddresses.length;
            ds.facetAddresses.push(_facetAddress);
        }

        for (uint256 selectorIndex; selectorIndex < selectorCount; selectorIndex++) {
            bytes4 selector = _functionSelectors[selectorIndex];
            address oldFacetAddress = ds.selectorToFacetAndPosition[selector].facetAddress;
            require(oldFacetAddress != _facetAddress, "LibDiamond: Can't replace function with same facet");
            require(oldFacetAddress != address(0), "LibDiamond: Can't replace function that doesn't exist");

            removeFunction(oldFacetAddress, selector);
            ds.facetFunctionSelectors[_facetAddress].functionSelectors.push(selector);
            ds.selectorToFacetAndPosition[selector] = FacetAddressAndPosition({
                facetAddress: _facetAddress,
                functionSelectorPosition: uint96(ds.facetFunctionSelectors[_facetAddress].functionSelectors.length - 1)
            });
        }
    }

    function removeFunctions(address _facetAddress, bytes4[] memory _functionSelectors) internal {
        require(_facetAddress == address(0), "LibDiamond: Remove facet address must be address(0)");

        uint256 selectorCount = _functionSelectors.length;
        require(selectorCount > 0, "LibDiamond: No selectors in facet to cut");

        for (uint256 selectorIndex; selectorIndex < selectorCount; selectorIndex++) {
            bytes4 selector = _functionSelectors[selectorIndex];
            address oldFacetAddress = diamondStorage().selectorToFacetAndPosition[selector].facetAddress;
            require(oldFacetAddress != address(0), "LibDiamond: Can't remove function that doesn't exist");
            removeFunction(oldFacetAddress, selector);
        }
    }

    function removeFunction(address _facetAddress, bytes4 _selector) internal {
        DiamondStorage storage ds = diamondStorage();
        FacetFunctionSelectors storage facetSelectors = ds.facetFunctionSelectors[_facetAddress];
        uint256 selectorPosition = ds.selectorToFacetAndPosition[_selector].functionSelectorPosition;
        uint256 lastSelectorPosition = facetSelectors.functionSelectors.length - 1;

        if (selectorPosition != lastSelectorPosition) {
            bytes4 lastSelector = facetSelectors.functionSelectors[lastSelectorPosition];
            facetSelectors.functionSelectors[selectorPosition] = lastSelector;
            ds.selectorToFacetAndPosition[lastSelector].functionSelectorPosition = uint96(selectorPosition);
        }

        facetSelectors.functionSelectors.pop();
        delete ds.selectorToFacetAndPosition[_selector];

        if (facetSelectors.functionSelectors.length == 0) {
            uint256 facetAddressPosition = facetSelectors.facetAddressPosition;
            uint256 lastFacetAddressPosition = ds.facetAddresses.length - 1;

            if (facetAddressPosition != lastFacetAddressPosition) {
                address lastFacetAddress = ds.facetAddresses[lastFacetAddressPosition];
                ds.facetAddresses[facetAddressPosition] = lastFacetAddress;
                ds.facetFunctionSelectors[lastFacetAddress].facetAddressPosition = facetAddressPosition;
            }

            ds.facetAddresses.pop();
            delete ds.facetFunctionSelectors[_facetAddress].facetAddressPosition;
        }
    }

    function initializeDiamondCut(address _init, bytes memory _calldata) internal {
        if (_init == address(0)) {
            require(_calldata.length == 0, "LibDiamond: _init is address(0) but _calldata is not empty");
            return;
        }

        require(_calldata.length > 0, "LibDiamond: _calldata is empty but _init is not address(0)");
        enforceHasContractCode(_init, "LibDiamond: _init address has no code");

        (bool success, bytes memory error) = _init.delegatecall(_calldata);
        if (!success) {
            if (error.length > 0) {
                revert(string(error));
            }
            revert("LibDiamond: _init function reverted");
        }
    }

    function enforceHasContractCode(address _contract, string memory _errorMessage) internal view {
        uint256 contractSize;
        assembly {
            contractSize := extcodesize(_contract)
        }
        require(contractSize > 0, _errorMessage);
    }
}
