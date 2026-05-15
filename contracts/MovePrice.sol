//SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { APS } from "./APS.sol";
import { APSDEX } from "./APSDEX.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MovePrice{
    IERC20 i_aps;
    APSDEX i_apsDex;

    constructor(address _token, address _apsDex) {
        i_aps = IERC20(_token);
        i_apsDex = APSDEX(payable(_apsDex));

        //approve this apsDex to use aps tokens
        i_aps.approve(address(i_apsDex), type(uint256).max);

    }

    //function to move the price by swapping in APS tokens into the ETH/APS pool
    function movePrice(int256 size) public payable {

        if(size > 0){
            i_apsDex.swap{ value : uint256(size) }(uint256(size));
        } else {
            i_apsDex.swap(uint256(-size));
        }
    }

    receive() external payable {}

    fallback() external payable {}
}