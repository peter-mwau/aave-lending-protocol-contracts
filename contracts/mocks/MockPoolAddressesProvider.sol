// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockPoolAddressesProvider {
    address private immutable pool;

    constructor(address poolAddress) {
        pool = poolAddress;
    }

    function getPool() external view returns (address) {
        return pool;
    }
}
