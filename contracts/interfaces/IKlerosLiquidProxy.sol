//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@kleros/erc-792/contracts/erc-1497/IEvidence.sol";
import "@kleros/erc-792/contracts/IArbitrable.sol";
import "@kleros/erc-792/contracts/IArbitrator.sol";
import "./IClaimsManager.sol";

interface IKlerosLiquidProxy is IEvidence, IArbitrable {
    event CreatedDispute(
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

    function createDispute(uint256 claimIndex) external payable;

    function submitEvidenceToKlerosArbitrator(
        uint256 claimIndex,
        string calldata evidence
    ) external;

    function appealKlerosArbitratorRuling(uint256 claimIndex) external payable;

    function executeRuling(uint256 disputeId) external;

    function arbitrationCost() external view returns (uint256);

    function appealCost(uint256 claimIndex) external view returns (uint256);

    function disputeStatus(uint256 claimIndex)
        external
        view
        returns (IArbitrator.DisputeStatus);

    function currentRuling(uint256 claimIndex) external view returns (uint256);

    function getSubCourt(uint96 subCourtId)
        external
        view
        returns (uint256[] memory children, uint256[4] memory timesPerPeriod);

    function courts(uint256 subCourtId)
        external
        view
        returns (
            uint96 parent,
            bool hiddenVotes,
            uint256 minStake,
            uint256 alpha,
            uint256 feeForJuror,
            uint256 jurorsForCourtJump
        );

    function claimIndexToDispute(uint256 claimIndex)
        external
        view
        returns (
            uint96 subCourtId,
            address arbitrated,
            uint256 numberOfChoices,
            uint8 period,
            uint256 lastPeriodChange,
            uint256 drawsInRound,
            uint256 commitsInRound,
            bool ruled
        );

    function claimsManager() external view returns (IClaimsManager);

    function klerosArbitrator() external view returns (IArbitrator);

    function klerosArbitratorExtraData() external view returns (bytes memory);

    function disputeIdToClaimIndex(uint256 disputeId)
        external
        view
        returns (uint256 claimIndex);

    function claimIndexToDisputeId(uint256 claimIndex)
        external
        view
        returns (uint256 disputeId);
}
