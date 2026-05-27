//SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

library EcosystemLib {
    struct Data {
        // Token addresses
        address apsToken;
        address apsDex;
        address flashLoanPool;
        address apsdexToken;
        bool apsdexEnabled;

        //nextPurchaseId
        bool paused;
    }   

    function initialize(Data storage self) internal {

    }
}