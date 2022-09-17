//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@api3/airnode-protocol-v1/contracts/dapis/DapiReader.sol";
import "./interfaces/ICurrencyConverterWithDapi.sol";

contract CurrencyConverterWithDapi is DapiReader, ICurrencyConverterWithDapi {
    address public immutable override reader;
    bytes32 public immutable override dapiName;
    uint8 public immutable override dapiDecimals;

    constructor(
        address _dapiServer,
        address _reader,
        bytes32 _dapiName,
        uint8 _dapiDecimals
    ) DapiReader(_dapiServer) {
        require(_reader != address(0), "Reader address zero");
        require(_dapiName != bytes32(0), "dAPI name zero");
        require(_dapiDecimals != 0, "dAPI decimals zero");
        reader = _reader;
        dapiName = _dapiName;
        dapiDecimals = _dapiDecimals;
    }

    function convertBaseToQuote(uint256 amountInBase)
        external
        view
        override
        returns (uint256 amountInQuote)
    {
        require(msg.sender == reader, "Sender not reader");
        int224 pairPrice = IDapiServer(dapiServer)
            .readDataFeedValueWithDapiName(dapiName);
        require(pairPrice > 0, "Price not positive");
        amountInQuote = (amountInBase * uint224(pairPrice)) / 10**dapiDecimals;
    }

    function convertQuoteToBase(uint256 amountInQuote)
        external
        view
        override
        returns (uint256 amountInBase)
    {
        require(msg.sender == reader, "Sender not reader");
        int224 pairPrice = IDapiServer(dapiServer)
            .readDataFeedValueWithDapiName(dapiName);
        require(pairPrice > 0, "Price not positive");
        amountInBase = (amountInQuote * 10**dapiDecimals) / uint224(pairPrice);
    }
}
