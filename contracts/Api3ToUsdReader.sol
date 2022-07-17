//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@api3/airnode-protocol-v1/contracts/dapis/DapiReader.sol";
import "./interfaces/IApi3ToUsdReader.sol";

contract Api3ToUsdReader is DapiReader, IApi3ToUsdReader {
    address public immutable reader;

    constructor(address _dapiServer, address _reader) DapiReader(_dapiServer) {
        reader = _reader;
    }

    function read() external view override returns (int224) {
        require(msg.sender == reader, "Sender not reader");
        return
            IDapiServer(dapiServer).readDataFeedValueWithDapiName("API3/USD");
    }
}
