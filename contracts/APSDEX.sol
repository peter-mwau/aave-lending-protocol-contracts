//SPDX-LIcense-Identifier: MIT

pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { APS } from "./APS.sol";

contract APSDEX {
    IERC20 token;

    uint256 public ethReserve;
    uint256 public apsReserve;
    uint256 public totalLiquidity;

    mapping(address => uint256) public liquidity;

    event LiquidityInitialized(address indexed provider, uint256 ETH_amount, uint256 APS_amount);
    event LiquidityProvided(address indexed provider, uint256 liquidityMinted, uint256 ethAmount, uint256 tokenAmount);
    event LiquidityRemoved(address indexed provider, uint256 liquidityBurned, uint256 ethAmount, uint256 tokenAmount);

    constructor(IERC20 _tokenAddress) {
        token = _tokenAddress;
    }

    //function to initialize the liquidity pool
    function initializePool(uint256 apsAmount) external payable returns (bool) {
    require(ethReserve == 0 && apsReserve == 0, "Already initialized");
    require(msg.value > 0 && apsAmount > 0, "Invalid amounts");

    require(token.transferFrom(msg.sender, address(this), apsAmount), "Transfer failed");

    ethReserve = msg.value;
    apsReserve = apsAmount;

    totalLiquidity = msg.value; // simple LP init

    liquidity[msg.sender] = msg.value;

    emit LiquidityInitialized(msg.sender, msg.value, apsAmount);

    return true;
}

    //function to get the amount you should receive (xOutput) given the reserves of both tokens in the pool
    function price(uint256 _xInput, uint256 _xReserves, uint256 _yReserves) public pure returns (uint256 yOutput) {
        require(_xReserves > 0 && _yReserves > 0, "Reserves must be greater than zero");
        uint256 numerator = _xInput * _yReserves;
        uint256 denominator = _xReserves + _xInput;
        return numerator / denominator;
     }

     //function to get the current price of the shares in the pool
    function currentPrice() public view returns (uint256) {

        return (ethReserve * 1e18) / apsReserve;
    }

     //function to calculate the amount of xInput required to get a certain amount of yOutput given the reserves of both tokens in the pool
     function calculateXInput(uint256 _yOutput, uint256 _xReserves, uint256 _yReserves) public pure returns (uint256 xInput) {
        require(_xReserves > 0 && _yReserves > 0, "Reserves must be greater than zero");
        uint256 numerator = _yOutput * _xReserves;
        uint256 denominator = _yReserves - _yOutput;
        return (numerator / denominator) + 1; // Adding 1 to account for rounding errors
     }

     //function to send eth to DEX in exchange for APS tokens
     function ethToToken() internal returns (uint256 tokenOutput) {
        uint256 ethInput = msg.value;
        require(ethInput > 0, "Must send ETH");

        tokenOutput = (ethInput * apsReserve) / ethReserve;

        require(token.transfer(msg.sender, tokenOutput), "Token transfer failed");

        ethReserve += ethInput;
        apsReserve -= tokenOutput;

        return tokenOutput;
    }

    //function to send APS tokens to DEX in exchange for eth
    function tokenToEth(uint256 tokenInput) internal returns (uint256 ethOutput) {
        require(tokenInput > 0, "Must send tokens");

        require(token.transferFrom(msg.sender, address(this), tokenInput), "Transfer failed");

        ethOutput = (tokenInput * ethReserve) / apsReserve;

        payable(msg.sender).transfer(ethOutput);

        apsReserve += tokenInput;
        ethReserve -= ethOutput;

        return ethOutput;
    }

    //function to allow users to swap between eth and APS tokens
    function swap(uint256 tokenInput) external payable returns (uint256 output) {
        if (msg.value > 0) {
            output = ethToToken();
        } else {
            output = tokenToEth(tokenInput);
        }
    }

    // allows deposits of $APS and $ETH to liquidity pool
    function deposit() public payable returns (uint256 tokensDeposited) {
        require(msg.value > 0, "Must send value when depositing");
        uint256 ethReserve = address(this).balance - msg.value;
        uint256 tokenReserve = token.balanceOf(address(this));
        uint256 tokenDeposit;

        tokenDeposit = ((msg.value * tokenReserve) / ethReserve) + 1;

        require(token.balanceOf(msg.sender) >= tokenDeposit, "insufficient token balance");
        require(token.allowance(msg.sender, address(this)) >= tokenDeposit, "insufficient allowance");

        uint256 liquidityMinted = (msg.value * totalLiquidity) / ethReserve;
        liquidity[msg.sender] += liquidityMinted;
        totalLiquidity += liquidityMinted;

        require(token.transferFrom(msg.sender, address(this), tokenDeposit));
        emit LiquidityProvided(msg.sender, liquidityMinted, msg.value, tokenDeposit);
        return tokenDeposit;
    }

    // allows withdrawal of $APS and $ETH from liquidity pool
    function withdraw(uint256 amount) public returns (uint256 ethAmount, uint256 tokenAmount) {
        require(liquidity[msg.sender] >= amount, "withdraw: sender does not have enough liquidity to withdraw.");
        uint256 ethReserve = address(this).balance;
        uint256 tokenReserve = token.balanceOf(address(this));
        uint256 ethWithdrawn;

        ethWithdrawn = (amount * ethReserve) / totalLiquidity;

        tokenAmount = (amount * tokenReserve) / totalLiquidity;
        liquidity[msg.sender] -= amount;
        totalLiquidity -= amount;
        (bool sent, ) = payable(msg.sender).call{ value: ethWithdrawn }("");
        require(sent, "withdraw(): revert in transferring eth to you!");
        require(token.transfer(msg.sender, tokenAmount));
        emit LiquidityRemoved(msg.sender, amount, tokenAmount, ethWithdrawn);
        return (ethWithdrawn, tokenAmount);
    }

     receive() external payable {}
}