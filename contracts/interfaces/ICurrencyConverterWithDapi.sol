//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./ICurrencyConverter.sol";

interface ICurrencyConverterWithDapi is ICurrencyConverter {
    function reader() external view returns (address);

    function dapiName() external view returns (bytes32);

    function dapiDecimals() external view returns (uint8);
}
