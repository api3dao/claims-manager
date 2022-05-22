//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./IClaimsManager.sol";

interface IClaimsManagerWithKlerosArbitrator is IClaimsManager {
    event CreatedDisputeWithKlerosArbitrator(
        uint256 indexed claimIndex,
        address indexed claimant,
        uint256 indexed klerosArbitratorDisputeId
    );

    event SubmittedEvidenceToKlerosArbitrator(
        uint256 indexed claimIndex,
        address indexed sender,
        string evidence
    );

    event AppealedKlerosArbitratorDecision(
        uint256 indexed claimIndex,
        address indexed sender,
        uint256 indexed klerosArbitratorDisputeId
    );
}
