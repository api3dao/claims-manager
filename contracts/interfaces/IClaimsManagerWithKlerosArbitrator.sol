//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@kleros/erc-792/contracts/erc-1497/IEvidence.sol";
import "@kleros/erc-792/contracts/IArbitrable.sol";
import "./IClaimsManager.sol";
import "@kleros/erc-792/contracts/IArbitrator.sol";

interface IClaimsManagerWithKlerosArbitrator is
    IEvidence,
    IArbitrable,
    IClaimsManager
{
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

    function createDisputeWithKlerosArbitrator(uint256 claimIndex)
        external
        payable;

    function submitEvidenceToKlerosArbitrator(
        uint256 claimIndex,
        string calldata evidence
    ) external;

    function appealKlerosArbitratorDecision(
        uint256 claimIndex,
        uint256 klerosArbitratorDisputeId
    ) external payable;

    function klerosArbitrator() external returns (IArbitrator);

    function klerosArbitratorExtraData() external returns (bytes memory);

    function klerosArbitratorDisputeIdToClaimIndex(uint256 disputeId)
        external
        returns (uint256);
}
