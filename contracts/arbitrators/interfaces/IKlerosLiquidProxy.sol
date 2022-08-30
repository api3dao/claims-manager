//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@kleros/erc-792/contracts/erc-1497/IEvidence.sol";
import "@kleros/erc-792/contracts/IArbitrable.sol";
import "@kleros/erc-792/contracts/IArbitrator.sol";
import "../../interfaces/IClaimsManager.sol";

interface IKlerosLiquidProxy is IEvidence, IArbitrable {
    event CreatedDispute(
        bytes32 indexed claimHash,
        address indexed claimant,
        uint256 indexed disputeId
    );

    event SubmittedEvidenceToKlerosArbitrator(
        bytes32 indexed claimHash,
        address indexed sender,
        string evidence
    );

    event AppealedKlerosArbitratorRuling(
        bytes32 indexed claimHash,
        address indexed sender,
        uint256 indexed disputeId
    );

    function createDispute(
        bytes32 policyHash,
        address claimant,
        address beneficiary,
        uint256 claimAmountInUsd,
        string calldata evidence
    ) external payable;

    function submitEvidenceToKlerosArbitrator(
        bytes32 claimHash,
        string calldata evidence
    ) external;

    function appealKlerosArbitratorRuling(
        bytes32 policyHash,
        address claimant,
        address beneficiary,
        uint256 claimAmountInUsd,
        string calldata evidence
    ) external payable;

    function executeRuling(uint256 disputeId) external;

    function arbitrationCost() external view returns (uint256);

    function appealCost(uint256 disputeId) external view returns (uint256);

    function disputeStatus(uint256 disputeId)
        external
        view
        returns (IArbitrator.DisputeStatus);

    function currentRuling(uint256 disputeId) external view returns (uint256);

    function appealPeriod(uint256 disputeId)
        external
        view
        returns (uint256 start, uint256 end);

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

    function claimHashToDispute(bytes32 claimHash)
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

    function disputeIdToClaimDetails(uint256 disputeId)
        external
        view
        returns (
            bytes32 policyHash,
            address claimant,
            address beneficiary,
            uint256 amountInUsd,
            string memory evidence
        );

    function claimHashToDisputeId(bytes32 claimHash)
        external
        view
        returns (uint256 disputeId);
}
