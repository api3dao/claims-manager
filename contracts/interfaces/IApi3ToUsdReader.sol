//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IApi3ToUsdReader {
    function read() external view returns (int224);
}
