//SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

import { ERC20 } from "@aave/core-v3/contracts/dependencies/openzeppelin/contracts/ERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
// import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract APS is ERC20, ReentrancyGuard {
    uint256 public constant MAX_SUPPLY = 1000000 * 10 ** 18; // Maximum supply of APS tokens
    uint256 public constant INITIAL_SUPPLY = 100000 * 10 ** 18; // Initial supply of APS tokens

    address public owner;

    event MintSuccessful(address indexed to, uint256 amount);
    event BurnSuccessful(address indexed from, uint256 amount);

    constructor() ERC20("Aave Pool Share", "APS") {
        owner = msg.sender;
        _mint(owner, INITIAL_SUPPLY);
    }

    function mintToken(address to, uint256 amount) external returns(bool){
        _mint(to, amount);
        emit MintSuccessful(to, amount);
        return true;
    }

    function burnToken(address from, uint256 amount) external returns(bool){
        _burn(from, amount);
        emit BurnSuccessful(from, amount);
        return true;

    }

}