//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ICurrencyConverter {
    function convertBaseToQuote(
        uint256 amountInBase
    ) external view returns (uint256 amountInQuote);

    function convertQuoteToBase(
        uint256 amountInQuote
    ) external view returns (uint256 amountInBase);
}
