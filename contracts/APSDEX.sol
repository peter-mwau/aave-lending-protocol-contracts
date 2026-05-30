// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { MainDiamond } from "./MainDiamond.sol";

contract APSDEX is MainDiamond {
    constructor(IERC20 tokenAddress) payable MainDiamond(tokenAddress) {}
}