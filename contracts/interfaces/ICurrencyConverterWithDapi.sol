//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./ICurrencyConverter.sol";

interface ICurrencyConverterWithDapi is ICurrencyConverter {
    function proxy() external view returns (address);

    function dapiDecimals() external view returns (uint8);
}
