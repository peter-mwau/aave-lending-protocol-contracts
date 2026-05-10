//SPDX-LIcense-Identifier: MIT

pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { APS } from "./APS.sol";

contract APSDEX {
    IERC20 token;
    uint256 public pricePerShare = 1 ether; // Initial price per share
    uint256 public totalLiquidity;

    mapping(address => uint256) public liquidity;

    event LiquidityInitialized(address indexed provider, uint256 amount);
    event LiquidityProvided(address indexed provider, uint256 liquidityMinted, uint256 ethAmount, uint256 tokenAmount);
    event LiquidityRemoved(address indexed provider, uint256 liquidityBurned, uint256 ethAmount, uint256 tokenAmount);

    constructor(IERC20 _tokenAddress) {
        token = _tokenAddress;
    }

    //function to initialize the liquidity pool
    function initializePool(uint256 _initialLiquidity) external returns (bool) {
        require(totalLiquidity == 0, "Pool already initialized");
        require(token.transferFrom(msg.sender, address(this), _initialLiquidity), "Transfer failed");
        totalLiquidity = _initialLiquidity;
        liquidity[msg.sender] = _initialLiquidity;

        emit LiquidityInitialized(msg.sender, _initialLiquidity);

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
        uint256 ethReserve = address(this).balance;
        uint256 tokenReserve = token.balanceOf(address(this));

        require(tokenReserve > 0, "No liquidity");

        return (ethReserve * 1e18) / tokenReserve;
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
        require(ethInput > 0, "Must send ETH to swap for tokens");
        uint256 xReserves = address(this).balance - ethInput; // Exclude the current transaction's ETH
        uint256 yReserves = totalLiquidity;
        tokenOutput = price(ethInput, xReserves, yReserves);
        require(token.transfer(msg.sender, tokenOutput), "Token transfer failed");
        return tokenOutput;
     }

    //function to send APS tokens to DEX in exchange for eth
    function tokenToEth(uint256 _tokenInput) internal returns (uint256 ethOutput) {
        require(_tokenInput > 0, "Must send tokens to swap for ETH");
        require(token.balanceOf(msg.sender) >= _tokenInput, "Insufficient token balance");
        require(token.allowance(msg.sender, address(this)) >= _tokenInput, "Token allowance too low");
        uint256 xReserves = address(this).balance;
        uint256 yReserves = totalLiquidity;
        ethOutput = price(_tokenInput, yReserves, xReserves);
        require(token.transferFrom(msg.sender, address(this), _tokenInput), "Token transfer failed");
        (bool success, ) = msg.sender.call{value: ethOutput}("");
        require(success, "ETH transfer failed");

        return ethOutput;

    }

    //function to allow users to swap between eth and APS tokens
    function swap(uint256 _tokenInput) external payable returns (uint256 outputAmount) {
        if (msg.value > 0 && _tokenInput == msg.value) {
            // User is sending ETH to swap for tokens
            outputAmount = ethToToken();
        } else if (_tokenInput > 0) {
            // User is sending tokens to swap for ETH
            outputAmount = tokenToEth(_tokenInput);
        } else {
            revert("Must send either ETH or tokens to swap");
        }
    }

    // allows deposits of $CORN and $ETH to liquidity pool
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

    // allows withdrawal of $CORN and $ETH from liquidity pool
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