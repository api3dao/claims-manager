//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Multicall.sol";
import "./interfaces/IKlerosLiquidProxy.sol";
import "./interfaces/IKlerosLiquid.sol";

contract KlerosLiquidProxy is Multicall, IKlerosLiquidProxy {
    struct ClaimDetails {
        bytes32 policyHash;
        address claimant;
        address beneficiary;
        uint224 amountInUsd;
        string evidence;
    }

    IClaimsManager public immutable override claimsManager;

    IArbitrator public immutable override klerosArbitrator; // Kleros expects this exact name

    bytes public override klerosArbitratorExtraData; // Kleros expects this exact name

    uint256 private constant META_EVIDENCE_ID = 0;

    mapping(bytes32 => uint256) public override claimHashToDisputeIdPlusOne;

    mapping(uint256 => ClaimDetails) public override disputeIdToClaimDetails;

    constructor(
        address _claimsManager,
        address _klerosArbitrator,
        bytes memory _klerosArbitratorExtraData,
        string memory _metaEvidence
    ) {
        require(_claimsManager != address(0), "ClaimsManager address zero");
        require(
            _klerosArbitrator != address(0),
            "KlerosArbitrator address zero"
        );
        require(
            _klerosArbitratorExtraData.length != 0,
            "KlerosArbitrator extraData empty"
        );
        require(bytes(_metaEvidence).length != 0, "Meta evidence empty");
        claimsManager = IClaimsManager(_claimsManager);
        klerosArbitrator = IArbitrator(_klerosArbitrator);
        klerosArbitratorExtraData = _klerosArbitratorExtraData;
        emit MetaEvidence(META_EVIDENCE_ID, _metaEvidence);
    }

    function createDispute(
        bytes32 policyHash,
        address claimant,
        address beneficiary,
        uint224 claimAmountInUsd,
        string calldata evidence
    ) external payable override {
        // claimsManager.createDispute() will validate the arguments so we don't need to
        require(msg.sender == claimant, "Sender not claimant");
        bytes32 claimHash = keccak256(
            abi.encodePacked(
                policyHash,
                msg.sender,
                beneficiary,
                claimAmountInUsd,
                evidence
            )
        );
        require(
            claimHashToDisputeIdPlusOne[claimHash] == 0,
            "Dispute already created"
        );
        uint256 disputeId = klerosArbitrator.createDispute{value: msg.value}(
            uint256(type(IClaimsManager.ArbitratorDecision).max),
            klerosArbitratorExtraData
        );
        disputeIdToClaimDetails[disputeId] = ClaimDetails({
            policyHash: policyHash,
            claimant: claimant,
            beneficiary: beneficiary,
            amountInUsd: claimAmountInUsd,
            evidence: evidence
        });
        claimHashToDisputeIdPlusOne[claimHash] = disputeId + 1;
        emit CreatedDispute(claimHash, claimant, disputeId);
        emit Dispute(klerosArbitrator, disputeId, META_EVIDENCE_ID, disputeId);
        emit Evidence(klerosArbitrator, disputeId, claimant, evidence);
        claimsManager.createDispute(
            policyHash,
            claimant,
            beneficiary,
            claimAmountInUsd,
            evidence
        );
    }

    function submitEvidenceToKlerosArbitrator(
        uint256 disputeId,
        string calldata evidence
    ) external override {
        require(bytes(evidence).length != 0, "Evidence empty");
        require(
            claimsManager.isManagerOrMediator(msg.sender),
            "Sender cannot mediate"
        );
        (, address arbitrated, , uint8 period, , , , ) = IKlerosLiquid(
            address(klerosArbitrator)
        ).disputes(disputeId);
        require(arbitrated == address(this), "Invalid dispute ID");
        require(
            period == uint8(IKlerosLiquid.Period.evidence),
            "Dispute not in evidence period"
        );
        emit SubmittedEvidenceToKlerosArbitrator(
            evidence,
            msg.sender,
            disputeId
        );
        emit Evidence(klerosArbitrator, disputeId, msg.sender, evidence);
    }

    function appealKlerosArbitratorRuling(
        bytes32 policyHash,
        address claimant,
        address beneficiary,
        uint224 claimAmountInUsd,
        string calldata evidence
    ) external payable override {
        bytes32 claimHash = keccak256(
            abi.encodePacked(
                policyHash,
                msg.sender,
                beneficiary,
                claimAmountInUsd,
                evidence
            )
        );
        uint256 disputeIdPlusOne = claimHashToDisputeIdPlusOne[claimHash];
        require(disputeIdPlusOne != 0, "No dispute related to claim");
        uint256 disputeId = disputeIdPlusOne - 1;
        // Ruling options
        // 0: Kleros refused to arbitrate or ruled that it's not appropriate to
        // pay out the claim or the settlement. We allow both parties to appeal this.
        // 1: Pay the claim. Only the mediator can appeal this.
        // 2: Pay the settlement. Only the claimant can appeal this.
        // We don't check the dispute status (if it's appealable), as the appeal() call
        // below should revert in that case anyway.
        if (msg.sender == claimant) {
            require(
                klerosArbitrator.currentRuling(disputeId) != 1,
                "Ruling agrees with claimant"
            );
        } else if (claimsManager.isManagerOrMediator(msg.sender)) {
            require(
                klerosArbitrator.currentRuling(disputeId) != 2,
                "Ruling agrees with mediator"
            );
        } else {
            revert("Only parties can appeal");
        }
        emit AppealedKlerosArbitratorRuling(claimHash, msg.sender, disputeId);
        klerosArbitrator.appeal{value: msg.value}(
            disputeId,
            klerosArbitratorExtraData // Unused in KlerosLiquid
        );
    }

    function rule(uint256 disputeId, uint256 ruling) external override {
        require(
            msg.sender == address(klerosArbitrator),
            "Sender not KlerosLiquid"
        );
        emit Ruling(IArbitrator(msg.sender), disputeId, ruling);
        // should revert if ruling > type(ArbitratorDecision).max
        IClaimsManager.ArbitratorDecision decision = IClaimsManager
            .ArbitratorDecision(ruling);
        ClaimDetails storage claimDetails = disputeIdToClaimDetails[disputeId];
        claimsManager.resolveDispute(
            claimDetails.policyHash,
            claimDetails.claimant,
            claimDetails.beneficiary,
            claimDetails.amountInUsd,
            claimDetails.evidence,
            decision
        );
    }

    function executeRuling(uint256 disputeId) external override {
        IKlerosLiquid(address(klerosArbitrator)).executeRuling(disputeId);
    }

    function arbitrationCost() external view override returns (uint256) {
        return klerosArbitrator.arbitrationCost(klerosArbitratorExtraData);
    }

    function appealCost(uint256 disputeId)
        external
        view
        override
        returns (uint256)
    {
        return
            klerosArbitrator.appealCost(disputeId, klerosArbitratorExtraData);
    }

    function disputeStatus(uint256 disputeId)
        external
        view
        override
        returns (IArbitrator.DisputeStatus)
    {
        return klerosArbitrator.disputeStatus(disputeId);
    }

    function currentRuling(uint256 disputeId) external view returns (uint256) {
        return klerosArbitrator.currentRuling(disputeId);
    }

    function appealPeriod(uint256 disputeId)
        external
        view
        override
        returns (uint256 start, uint256 end)
    {
        (start, end) = IKlerosLiquid(address(klerosArbitrator)).appealPeriod(
            disputeId
        );
    }

    function getSubCourt(uint96 subCourtId)
        external
        view
        override
        returns (uint256[] memory children, uint256[4] memory timesPerPeriod)
    {
        return IKlerosLiquid(address(klerosArbitrator)).getSubCourt(subCourtId);
    }

    function courts(uint256 subCourtId)
        external
        view
        override
        returns (
            uint96 parent,
            bool hiddenVotes,
            uint256 minStake,
            uint256 alpha,
            uint256 feeForJuror,
            uint256 jurorsForCourtJump
        )
    {
        return IKlerosLiquid(address(klerosArbitrator)).courts(subCourtId);
    }

    function disputes(uint256 disputeId)
        external
        view
        override
        returns (
            uint96 subCourtId,
            address arbitrated,
            uint256 numberOfChoices,
            uint8 period,
            uint256 lastPeriodChange,
            uint256 drawsInRound,
            uint256 commitsInRound,
            bool ruled
        )
    {
        return IKlerosLiquid(address(klerosArbitrator)).disputes(disputeId);
    }
}
