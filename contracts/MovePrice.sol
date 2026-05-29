// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { APSDEX } from "./APSDEX.sol";
interface IAPSDEX {
    function swap(uint256 amount) external payable;
}
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MovePrice {
    IERC20 public i_aps;
    APSDEX public i_apsDex;
    IAPSDEX public i_apsDexIface;

    constructor(address _token, address _apsDex) {
        i_aps = IERC20(_token);
        i_apsDex = APSDEX(payable(_apsDex));
        i_apsDexIface = IAPSDEX(payable(_apsDex));

        i_aps.approve(address(i_apsDex), type(uint256).max);
    }

    function movePrice(int256 size) public payable {
        uint256 amt = size > 0 ? uint256(size) : uint256(-size);
        if (size > 0) {
            i_apsDexIface.swap{value: amt}(amt);
        } else {
            i_apsDexIface.swap(amt);
        }
    }

    receive() external payable {}

    fallback() external payable {}
}