// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { LibDiamond } from "../DiamondLibrary/LibDiamond.sol";

contract ApsdexFacet {
    event LiquidityInitialized(address indexed provider, uint256 ETH_amount, uint256 APS_amount);
    event LiquidityProvided(address indexed provider, uint256 liquidityMinted, uint256 ethAmount, uint256 tokenAmount);
    event LiquidityRemoved(address indexed provider, uint256 liquidityBurned, uint256 ethAmount, uint256 tokenAmount);

    function token() external view returns (IERC20) {
        return LibDiamond.apsdexStorage().token;
    }

    function ethReserve() external view returns (uint256) {
        return LibDiamond.apsdexStorage().ethReserve;
    }

    function apsReserve() external view returns (uint256) {
        return LibDiamond.apsdexStorage().apsReserve;
    }

    function totalLiquidity() external view returns (uint256) {
        return LibDiamond.apsdexStorage().totalLiquidity;
    }

    function liquidity(address account) external view returns (uint256) {
        return LibDiamond.apsdexStorage().liquidity[account];
    }

    function initialized() external view returns (bool) {
        return LibDiamond.apsdexStorage().initialized;
    }

    function initializePool(uint256 apsAmount) external payable returns (bool) {
        LibDiamond.APSDEXStorage storage s = LibDiamond.apsdexStorage();
        require(!s.initialized, "Already initialized");
        require(msg.value > 0 && apsAmount > 0, "Invalid amounts");
        require(address(s.token) != address(0), "Token not set");

        require(s.token.transferFrom(msg.sender, address(this), apsAmount), "Transfer failed");

        s.ethReserve = msg.value;
        s.apsReserve = apsAmount;
        s.totalLiquidity = msg.value;
        s.liquidity[msg.sender] = msg.value;
        s.initialized = true;

        emit LiquidityInitialized(msg.sender, msg.value, apsAmount);
        return true;
    }

    function price(uint256 _xInput, uint256 _xReserves, uint256 _yReserves) public pure returns (uint256 yOutput) {
        require(_xReserves > 0 && _yReserves > 0, "Reserves must be greater than zero");
        uint256 numerator = _xInput * _yReserves;
        uint256 denominator = _xReserves + _xInput;
        return numerator / denominator;
    }

    function currentPrice() public view returns (uint256) {
        LibDiamond.APSDEXStorage storage s = LibDiamond.apsdexStorage();
        require(s.apsReserve > 0, "APS reserve is zero");
        return (s.ethReserve * 1e18) / s.apsReserve;
    }

    function calculateXInput(uint256 _yOutput, uint256 _xReserves, uint256 _yReserves) public pure returns (uint256 xInput) {
        require(_xReserves > 0 && _yReserves > 0, "Reserves must be greater than zero");
        require(_yOutput < _yReserves, "yOutput must be less than yReserves");
        uint256 numerator = _yOutput * _xReserves;
        uint256 denominator = _yReserves - _yOutput;
        return (numerator / denominator) + 1;
    }

    function ethToToken() internal returns (uint256 tokenOutput) {
        LibDiamond.APSDEXStorage storage s = LibDiamond.apsdexStorage();
        uint256 ethInput = msg.value;
        require(ethInput > 0, "Must send ETH");
        require(s.initialized, "Pool not initialized");

        tokenOutput = (ethInput * s.apsReserve) / s.ethReserve;
        s.ethReserve += ethInput;
        s.apsReserve -= tokenOutput;

        require(s.token.transfer(msg.sender, tokenOutput), "Token transfer failed");
        return tokenOutput;
    }

    function tokenToEth(uint256 tokenInput) internal returns (uint256 ethOutput) {
        LibDiamond.APSDEXStorage storage s = LibDiamond.apsdexStorage();
        require(tokenInput > 0, "Must send tokens");
        require(s.initialized, "Pool not initialized");

        require(s.token.transferFrom(msg.sender, address(this), tokenInput), "Transfer failed");
        ethOutput = (tokenInput * s.ethReserve) / s.apsReserve;

        s.apsReserve += tokenInput;
        s.ethReserve -= ethOutput;

        (bool sent, ) = payable(msg.sender).call{ value: ethOutput }("");
        require(sent, "ETH transfer failed");

        return ethOutput;
    }

    function swap(uint256 tokenInput) external payable returns (uint256 output) {
        if (msg.value > 0) {
            output = ethToToken();
        } else {
            output = tokenToEth(tokenInput);
        }
    }

    function deposit() public payable returns (uint256 tokensDeposited) {
        LibDiamond.APSDEXStorage storage s = LibDiamond.apsdexStorage();
        require(msg.value > 0, "Must send value when depositing");
        require(s.initialized, "Pool not initialized");

        uint256 ethReserveLocal = address(this).balance - msg.value;
        uint256 tokenReserveLocal = s.token.balanceOf(address(this));
        uint256 tokenDeposit = ((msg.value * tokenReserveLocal) / ethReserveLocal) + 1;

        require(s.token.balanceOf(msg.sender) >= tokenDeposit, "insufficient token balance");
        require(s.token.allowance(msg.sender, address(this)) >= tokenDeposit, "insufficient allowance");

        uint256 liquidityMinted = (msg.value * s.totalLiquidity) / ethReserveLocal;
        s.liquidity[msg.sender] += liquidityMinted;
        s.totalLiquidity += liquidityMinted;

        require(s.token.transferFrom(msg.sender, address(this), tokenDeposit));
        emit LiquidityProvided(msg.sender, liquidityMinted, msg.value, tokenDeposit);
        return tokenDeposit;
    }

    function withdraw(uint256 amount) public returns (uint256 ethAmount, uint256 tokenAmount) {
        LibDiamond.APSDEXStorage storage s = LibDiamond.apsdexStorage();
        require(s.liquidity[msg.sender] >= amount, "withdraw: sender does not have enough liquidity to withdraw.");

        uint256 ethReserveLocal = address(this).balance;
        uint256 tokenReserveLocal = s.token.balanceOf(address(this));
        uint256 ethWithdrawn = (amount * ethReserveLocal) / s.totalLiquidity;

        tokenAmount = (amount * tokenReserveLocal) / s.totalLiquidity;
        s.liquidity[msg.sender] -= amount;
        s.totalLiquidity -= amount;

        (bool sent, ) = payable(msg.sender).call{ value: ethWithdrawn }("");
        require(sent, "withdraw(): revert in transferring eth to you!");
        require(s.token.transfer(msg.sender, tokenAmount));

        emit LiquidityRemoved(msg.sender, amount, ethWithdrawn, tokenAmount);
        return (ethWithdrawn, tokenAmount);
    }
}
