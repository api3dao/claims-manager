//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../interfaces/IClaimsManager.sol";

interface IPassiveArbitrator {
    function createDispute(
        bytes32 policyHash,
        address claimant,
        uint224 claimAmountInUsd,
        string calldata evidence
    ) external;

    function claimsManager() external view returns (IClaimsManager);
}
