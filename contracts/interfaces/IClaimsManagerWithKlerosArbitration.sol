//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@kleros/erc-792/contracts/erc-1497/IEvidence.sol";
import "@kleros/erc-792/contracts/IArbitrable.sol";
import "./IClaimsManager.sol";
import "@kleros/erc-792/contracts/IArbitrator.sol";

interface IClaimsManagerWithKlerosArbitration is
    IEvidence,
    IArbitrable,
    IClaimsManager
{
    event CreatedDisputeWithKlerosArbitrator(
        uint256 indexed claimIndex,
        address indexed claimant,
        uint256 indexed disputeId
    );

    event SubmittedEvidenceToKlerosArbitrator(
        uint256 indexed claimIndex,
        address indexed sender,
        string evidence
    );

    event AppealedKlerosArbitratorRuling(
        uint256 indexed claimIndex,
        address indexed sender,
        uint256 indexed disputeId
    );

    function createDisputeWithKlerosArbitrator(uint256 claimIndex)
        external
        payable;

    function submitEvidenceToKlerosArbitrator(
        uint256 claimIndex,
        uint256 disputeId,
        string calldata evidence
    ) external;

    function appealKlerosArbitratorRuling(uint256 claimIndex, uint256 disputeId)
        external
        payable;

    function klerosArbitrator() external returns (IArbitrator);

    function klerosArbitratorExtraData() external returns (bytes memory);

    function klerosArbitratorToDisputeIdToClaimIndex(
        address arbitrator,
        uint256 disputeId
    ) external returns (uint256);
}
