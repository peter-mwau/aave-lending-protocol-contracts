// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract APS is ERC20 {
    uint256 public constant INITIAL_SUPPLY = 100000 * 10 ** 18;

    event MintSuccessful(address indexed to, uint256 amount);
    event BurnSuccessful(address indexed from, uint256 amount);

    constructor() ERC20("Aave Pool Share", "APS") {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    function mintToken(address to, uint256 amount) external returns (bool) {
        _mint(to, amount);
        emit MintSuccessful(to, amount);
        return true;
    }

    function burnToken(address from, uint256 amount) external returns (bool) {
        _burn(from, amount);
        emit BurnSuccessful(from, amount);
        return true;
    }
}