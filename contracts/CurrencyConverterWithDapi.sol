//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/ICurrencyConverterWithDapi.sol";
import "@api3/airnode-protocol-v1/contracts/api3-server-v1/proxies/interfaces/IProxy.sol";

contract CurrencyConverterWithDapi is ICurrencyConverterWithDapi {
    address public immutable override proxy;
    uint8 public immutable override dapiDecimals;

    constructor(address _proxy, uint8 _dapiDecimals) {
        require(_proxy != address(0), "Proxy address zero");
        require(_dapiDecimals != 0, "dAPI decimals zero");
        proxy = _proxy;
        dapiDecimals = _dapiDecimals;
    }

    function convertBaseToQuote(
        uint256 amountInBase
    ) external view override returns (uint256 amountInQuote) {
        (int224 pairPrice, ) = IProxy(proxy).read();
        require(pairPrice > 0, "Price not positive");
        amountInQuote =
            (amountInBase * uint224(pairPrice)) /
            10 ** dapiDecimals;
    }

    function convertQuoteToBase(
        uint256 amountInQuote
    ) external view override returns (uint256 amountInBase) {
        (int224 pairPrice, ) = IProxy(proxy).read();
        require(pairPrice > 0, "Price not positive");
        amountInBase =
            (amountInQuote * 10 ** dapiDecimals) /
            uint224(pairPrice);
    }
}
