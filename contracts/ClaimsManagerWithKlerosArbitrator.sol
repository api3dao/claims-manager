//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./ClaimsManager.sol";
import "./interfaces/IClaimsManagerWithKlerosArbitrator.sol";

contract ClaimsManagerWithKlerosArbitrator is
    ClaimsManager,
    IClaimsManagerWithKlerosArbitrator
{
    // Should these be immutable?
    IArbitrator public immutable override klerosArbitrator;
    bytes public override klerosArbitratorExtraData;

    mapping(uint256 => uint256)
        public
        override klerosArbitratorDisputeIdToClaimIndex;

    uint256 private constant RULING_OPTIONS = 3;

    // What is klerosArbitratorExtraData here?
    constructor(
        address _accessControlRegistry,
        string memory _adminRoleDescription,
        address _manager,
        address _api3Pool,
        uint256 _mediatorResponsePeriod,
        uint256 _claimantResponsePeriod,
        address _klerosArbitrator,
        bytes memory _klerosArbitratorExtraData,
        uint256 _klerosArbitratorResponsePeriod
    )
        ClaimsManager(
            _accessControlRegistry,
            _adminRoleDescription,
            _manager,
            _api3Pool,
            _mediatorResponsePeriod,
            _claimantResponsePeriod
        )
    {
        require(
            _klerosArbitrator != address(0),
            "Kleros arbitrator address zero"
        );
        require(
            _klerosArbitratorExtraData.length != 0,
            "Arbitrator extra data empty"
        );
        klerosArbitrator = IArbitrator(_klerosArbitrator);
        klerosArbitratorExtraData = _klerosArbitratorExtraData;
        _setArbitratorResponsePeriod(
            _klerosArbitrator,
            _klerosArbitratorResponsePeriod
        );
    }

    // Should msg.value be arbitrationCost() here?
    function createDisputeWithKlerosArbitrator(uint256 claimIndex)
        external
        payable
        override
    {
        ClaimsManager.createDispute(claimIndex, address(klerosArbitrator));
        uint256 klerosArbitratorDisputeId = klerosArbitrator.createDispute{
            value: msg.value
        }(RULING_OPTIONS, klerosArbitratorExtraData);
        klerosArbitratorDisputeIdToClaimIndex[
            klerosArbitratorDisputeId
        ] = claimIndex;
        emit CreatedDisputeWithKlerosArbitrator(
            claimIndex,
            msg.sender,
            klerosArbitratorDisputeId
        );
        emit Dispute(
            klerosArbitrator,
            klerosArbitratorDisputeId,
            0,
            claimIndex
        );
        emit Evidence(
            klerosArbitrator,
            claimIndex,
            msg.sender,
            claims[claimIndex].evidence
        );
    }

    // Can this be done anonymously? If so, how do we prevent claimant from
    // providing additional evidence after the mediation period? Is this the
    // only place this can be done?
    function submitEvidenceToKlerosArbitrator(
        uint256 claimIndex,
        string calldata evidence
    ) external override {
        // Should we check if claimIndex corresponds to an active Kleros dispute here?
        emit SubmittedEvidenceToKlerosArbitrator(
            claimIndex,
            msg.sender,
            evidence
        );
        emit Evidence(klerosArbitrator, claimIndex, msg.sender, evidence);
    }

    function appealKlerosArbitratorDecision(
        uint256 claimIndex,
        uint256 klerosArbitratorDisputeId
    ) external payable override {
        require(
            claimIndex ==
                klerosArbitratorDisputeIdToClaimIndex[
                    klerosArbitratorDisputeId
                ],
            "Claim index-dispute ID mismatch"
        );
        // Won't appeal() check for this anyway?
        require(
            msg.value >=
                klerosArbitrator.appealCost(
                    klerosArbitratorDisputeId,
                    klerosArbitratorExtraData
                ),
            "Value does not cover appeal cost"
        );
        emit AppealedKlerosArbitratorDecision(
            claimIndex,
            msg.sender,
            klerosArbitratorDisputeId
        );
        klerosArbitrator.appeal(
            klerosArbitratorDisputeId,
            klerosArbitratorExtraData // Should this not be empty
        );
    }

    function rule(uint256 disputeId, uint256 ruling) external override {
        require(
            msg.sender == address(klerosArbitrator),
            "Sender not Kleros arbitrator"
        );
        uint256 claimIndex = klerosArbitratorDisputeIdToClaimIndex[disputeId];
        ArbitratorDecision decision;
        if (ruling == 0 || ruling == 1) {
            decision = ArbitratorDecision.DoNotPay;
        } else if (ruling == 2) {
            decision = ArbitratorDecision.PayClaim;
        } else if (ruling == 3) {
            decision = ArbitratorDecision.PaySettlement;
        } else {
            revert("Invalid ruling option");
        }
        emit Ruling(klerosArbitrator, disputeId, ruling);
        ClaimsManager.resolveDispute(claimIndex, decision);
    }

    function createDispute(uint256 claimIndex, address arbitrator)
        public
        override(ClaimsManager, IClaimsManager)
    {
        require(
            arbitrator != address(klerosArbitrator),
            "Use Kleros arbitrator interface"
        );
        ClaimsManager.createDispute(claimIndex, arbitrator);
    }

    function resolveDispute(uint256 claimIndex, ArbitratorDecision result)
        public
        override(ClaimsManager, IClaimsManager)
    {
        require(
            msg.sender != address(klerosArbitrator),
            "Use Kleros arbitrator interface"
        );
        ClaimsManager.resolveDispute(claimIndex, result);
    }
}
