//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Multicall.sol";
import "./interfaces/IKlerosLiquidProxy.sol";
import "./interfaces/IKlerosLiquid.sol";

contract KlerosLiquidProxy is Multicall, IKlerosLiquidProxy {
    struct ClaimDetails {
        uint256 claimIndex;
        bytes32 policyHash;
        address claimant;
        address beneficiary;
        uint256 amountInUsd;
        string evidence;
    }

    IClaimsManager public immutable override claimsManager;

    IArbitrator public immutable override klerosArbitrator; // Kleros expects this exact name

    bytes public override klerosArbitratorExtraData; // Kleros expects this exact name

    uint256 private constant META_EVIDENCE_ID = 0;

    mapping(uint256 => uint256) public override claimIndexToDisputeId;

    mapping(uint256 => ClaimDetails) public override disputeIdToClaimDetails;

    modifier onlyDisputedClaim(uint256 claimIndex) {
        require(claimIndexToDisputeId[claimIndex] != 0, "Invalid claim index");
        _;
    }

    constructor(
        address _claimsManager,
        address _klerosArbitrator,
        bytes memory _klerosArbitratorExtraData,
        string memory _metaEvidence
    ) {
        claimsManager = IClaimsManager(_claimsManager);
        klerosArbitrator = IArbitrator(_klerosArbitrator);
        klerosArbitratorExtraData = _klerosArbitratorExtraData;
        emit MetaEvidence(META_EVIDENCE_ID, _metaEvidence);
    }

    function createDispute(
        uint256 claimIndex,
        bytes32 policyHash,
        address claimant,
        address beneficiary,
        uint256 claimAmountInUsd,
        string calldata evidence
    ) external payable override {
        // claimsManager.createDispute() will validate the arguments so we don't need to
        require(msg.sender == claimant, "Sender not claimant");
        require(
            claimIndexToDisputeId[claimIndex] == 0,
            "Dispute already created"
        );
        uint256 disputeId = klerosArbitrator.createDispute{value: msg.value}(
            uint256(type(IClaimsManager.ArbitratorDecision).max),
            klerosArbitratorExtraData
        );
        disputeIdToClaimDetails[disputeId] = ClaimDetails({
            claimIndex: claimIndex,
            policyHash: policyHash,
            claimant: claimant,
            beneficiary: beneficiary,
            amountInUsd: claimAmountInUsd,
            evidence: evidence
        });
        claimIndexToDisputeId[claimIndex] = disputeId;
        emit CreatedDispute(claimIndex, claimant, disputeId);
        emit Dispute(klerosArbitrator, disputeId, META_EVIDENCE_ID, claimIndex);
        emit Evidence(klerosArbitrator, claimIndex, claimant, evidence);
        claimsManager.createDispute(
            claimIndex,
            policyHash,
            claimant,
            beneficiary,
            claimAmountInUsd,
            evidence
        );
    }

    function submitEvidenceToKlerosArbitrator(
        uint256 claimIndex,
        string calldata evidence
    ) external override onlyDisputedClaim(claimIndex) {
        require(
            claimsManager.isManagerOrMediator(msg.sender),
            "Sender cannot mediate"
        );
        emit SubmittedEvidenceToKlerosArbitrator(
            claimIndex,
            msg.sender,
            evidence
        );
        emit Evidence(klerosArbitrator, claimIndex, msg.sender, evidence);
    }

    function appealKlerosArbitratorRuling(
        uint256 claimIndex,
        bytes32 policyHash,
        address claimant,
        address beneficiary,
        uint256 claimAmountInUsd,
        string calldata evidence
    ) external payable override onlyDisputedClaim(claimIndex) {
        (, , bytes27 claimHash) = claimsManager.claims(claimIndex);
        require(
            claimHash ==
                bytes27(
                    keccak256(
                        abi.encodePacked(
                            policyHash,
                            claimant,
                            beneficiary,
                            claimAmountInUsd,
                            evidence
                        )
                    )
                ),
            "No such claim"
        );
        // Ruling options
        // 0: Kleros refused to arbitrate or ruled that it's not appropriate to
        // pay out the claim or the settlement. We allow both parties to appeal this.
        // 1: Pay the claim. Only the mediator can appeal this.
        // 2: Pay the settlement. Only the claimant can appeal this.
        // We don't check the dispute status (if it's appealable), as the appeal() call
        // below should revert in that case anyway.
        if (msg.sender == claimant) {
            require(
                klerosArbitrator.currentRuling(
                    claimIndexToDisputeId[claimIndex]
                ) != 1,
                "Ruling agrees with claimant"
            );
        } else if (claimsManager.isManagerOrMediator(msg.sender)) {
            require(
                klerosArbitrator.currentRuling(
                    claimIndexToDisputeId[claimIndex]
                ) != 2,
                "Ruling agrees with mediator"
            );
        } else {
            revert("Only parties can appeal");
        }
        emit AppealedKlerosArbitratorRuling(
            claimIndex,
            msg.sender,
            claimIndexToDisputeId[claimIndex]
        );
        klerosArbitrator.appeal{value: msg.value}(
            claimIndexToDisputeId[claimIndex],
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
            claimDetails.claimIndex,
            claimDetails.policyHash,
            claimDetails.claimant,
            claimDetails.beneficiary,
            claimDetails.amountInUsd,
            claimDetails.evidence,
            decision
        );
    }

    function executeRuling(uint256 claimIndex)
        external
        override
        onlyDisputedClaim(claimIndex)
    {
        IKlerosLiquid(address(klerosArbitrator)).executeRuling(
            claimIndexToDisputeId[claimIndex]
        );
    }

    function arbitrationCost() external view override returns (uint256) {
        return klerosArbitrator.arbitrationCost(klerosArbitratorExtraData);
    }

    function appealCost(uint256 claimIndex)
        external
        view
        override
        onlyDisputedClaim(claimIndex)
        returns (uint256)
    {
        return
            klerosArbitrator.appealCost(
                claimIndexToDisputeId[claimIndex],
                klerosArbitratorExtraData
            );
    }

    function disputeStatus(uint256 claimIndex)
        external
        view
        override
        onlyDisputedClaim(claimIndex)
        returns (IArbitrator.DisputeStatus)
    {
        return
            klerosArbitrator.disputeStatus(claimIndexToDisputeId[claimIndex]);
    }

    function currentRuling(uint256 claimIndex)
        external
        view
        onlyDisputedClaim(claimIndex)
        returns (uint256)
    {
        return
            klerosArbitrator.currentRuling(claimIndexToDisputeId[claimIndex]);
    }

    function appealPeriod(uint256 claimIndex)
        external
        view
        override
        onlyDisputedClaim(claimIndex)
        returns (uint256 start, uint256 end)
    {
        (start, end) = IKlerosLiquid(address(klerosArbitrator)).appealPeriod(
            claimIndexToDisputeId[claimIndex]
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

    function claimIndexToDispute(uint256 claimIndex)
        external
        view
        override
        onlyDisputedClaim(claimIndex)
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
        return
            IKlerosLiquid(address(klerosArbitrator)).disputes(
                claimIndexToDisputeId[claimIndex]
            );
    }
}
