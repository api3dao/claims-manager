//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Multicall.sol";
import "./interfaces/IPassiveArbitrator.sol";

contract PassiveArbitrator is Multicall, IPassiveArbitrator {
    IClaimsManager public immutable override claimsManager;

    constructor(address _claimsManager) {
        require(_claimsManager != address(0), "ClaimsManager address zero");
        claimsManager = IClaimsManager(_claimsManager);
    }

    function createDispute(
        bytes32 policyHash,
        address claimant,
        address beneficiary,
        uint224 claimAmountInUsd,
        string calldata evidence
    ) external override {
        // claimsManager.createDispute() will validate the arguments so we don't need to
        require(msg.sender == claimant, "Sender not claimant");
        claimsManager.createDispute(
            policyHash,
            claimant,
            beneficiary,
            claimAmountInUsd,
            evidence
        );
    }
}
