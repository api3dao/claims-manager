//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@kleros/erc-792/contracts/erc-1497/IEvidence.sol";
import "@kleros/erc-792/contracts/IArbitrable.sol";
import "@kleros/erc-792/contracts/IArbitrator.sol";
import "../../interfaces/IClaimsManager.sol";

interface IKlerosLiquidProxy is IEvidence, IArbitrable {
    event CreatedDispute(
        address indexed claimant,
        uint256 indexed disputeId,
        bytes32 indexed claimHash
    );

    event SubmittedEvidenceToKlerosArbitrator(
        address indexed sender,
        uint256 indexed disputeId,
        string evidence
    );

    event AppealedKlerosArbitratorRuling(
        address indexed sender,
        uint256 indexed disputeId,
        bytes32 indexed claimHash
    );

    function createDispute(
        bytes32 policyHash,
        address claimant,
        uint224 claimAmountInUsd,
        string calldata evidence
    ) external payable returns (uint256 disputeId);

    function submitEvidenceToKlerosArbitrator(
        uint256 disputeId,
        string calldata evidence
    ) external;

    function appealKlerosArbitratorRuling(
        bytes32 policyHash,
        address claimant,
        uint224 claimAmountInUsd,
        string calldata evidence
    ) external payable;

    function executeRuling(uint256 disputeId) external;

    function arbitrationCost() external view returns (uint256);

    function appealCost(uint256 disputeId) external view returns (uint256);

    function disputeStatus(
        uint256 disputeId
    ) external view returns (IArbitrator.DisputeStatus);

    function currentRuling(uint256 disputeId) external view returns (uint256);

    function appealPeriod(
        uint256 disputeId
    ) external view returns (uint256 start, uint256 end);

    function getSubcourt(
        uint96 subcourtID
    )
        external
        view
        returns (uint256[] memory children, uint256[4] memory timesPerPeriod);

    function courts(
        uint256 subcourtID
    )
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

    function disputes(
        uint256 disputeId
    )
        external
        view
        returns (
            uint96 subcourtID,
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

    function disputeIdToClaimDetails(
        uint256 disputeId
    )
        external
        view
        returns (
            bytes32 policyHash,
            address claimant,
            uint224 amountInUsd,
            string memory evidence
        );

    function claimHashToDisputeIdPlusOne(
        bytes32 claimHash
    ) external view returns (uint256 disputeIdPlusOne);
}
