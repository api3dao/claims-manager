//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./ClaimsManager.sol";
import "./interfaces/IClaimsManagerWithKlerosArbitrator.sol";

// This contract will implement wrapper functions around the Kleros arbitrator view functions
// so that the frontend will only need to interact with this contract directly.
contract ClaimsManagerWithKlerosArbitrator is
    ClaimsManager,
    IClaimsManagerWithKlerosArbitrator
{
    // metaEvidence is related, but is emitted as event
    struct ArbitrationParams {
        IArbitrator klerosArbitrator;
        bytes klerosArbitratorExtraData;
    }

    // two arbitrators could have disputeId collisions between them
    mapping(address => mapping(uint256 => uint256))
        public klerosArbitratorAndDisputeIdToClaimIndex;

    mapping(uint256 => ArbitrationParams) public arbitrationParamsChanges;
    uint256 public arbitrationParamsCount = 1; // there will be 1 upon contract construction

    mapping(uint256 => uint256) public claimIndexToArbitrationParamIndex;

    uint256 private constant RULING_OPTIONS = 2;

    constructor(
        address _accessControlRegistry,
        string memory _adminRoleDescription,
        address _manager,
        address _api3Pool,
        uint256 _mediatorResponsePeriod,
        uint256 _claimantResponsePeriod,
        address _klerosArbitrator,
        bytes memory _klerosArbitratorExtraData,
        uint256 _klerosArbitratorResponsePeriod,
        string memory _metaEvidence
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

        _setArbitratorResponsePeriod(
            _klerosArbitrator,
            _klerosArbitratorResponsePeriod
        );

        arbitrationParamsChanges[0] = ArbitrationParams(
            IArbitrator(_klerosArbitrator),
            _klerosArbitratorExtraData
        );
        emit MetaEvidence(0, _metaEvidence);
    }

    function changeArbitrationParams(
        address _klerosArbitrator,
        bytes memory _klerosArbitratorExtraData,
        string calldata _metaEvidence,
        uint256 _klerosArbitratorResponsePeriod
    ) external onlyManagerOrAdmin {
        uint256 arbitrationParamsIndex = arbitrationParamsCount++;
        arbitrationParamsChanges[arbitrationParamsIndex] = ArbitrationParams(
            IArbitrator(_klerosArbitrator),
            _klerosArbitratorExtraData
        );
        // manager is trusted to not decrease the period for ongoing
        // disputes using this arbitrator.
        _setArbitratorResponsePeriod(
            _klerosArbitrator,
            _klerosArbitratorResponsePeriod
        );
        emit MetaEvidence(arbitrationParamsIndex, _metaEvidence);
    }

    // msg.value should be arbitrationCost() here
    function createDisputeWithKlerosArbitrator(uint256 claimIndex)
        external
        payable
        override
    {
        // fix the arbitrationParams for this claim
        uint256 arbitrationParamsIndex = arbitrationParamsCount - 1;
        claimIndexToArbitrationParamIndex[claimIndex] = arbitrationParamsIndex;
        ArbitrationParams memory arbitrationParams = arbitrationParamsChanges[
            arbitrationParamsIndex
        ];

        ClaimsManager.createDispute(
            claimIndex,
            address(arbitrationParams.klerosArbitrator)
        );
        uint256 klerosArbitratorDisputeId = arbitrationParams
            .klerosArbitrator
            .createDispute{value: msg.value}(
            RULING_OPTIONS,
            arbitrationParams.klerosArbitratorExtraData
        );
        klerosArbitratorAndDisputeIdToClaimIndex[
            address(arbitrationParams.klerosArbitrator)
        ][klerosArbitratorDisputeId] = claimIndex;
        emit CreatedDisputeWithKlerosArbitrator(
            claimIndex,
            msg.sender,
            klerosArbitratorDisputeId
        );
        emit Dispute(
            arbitrationParams.klerosArbitrator,
            klerosArbitratorDisputeId,
            arbitrationParamsIndex, // metaEvidence is emitted with the arbitrationParams
            claimIndex
        );
        emit Evidence(
            arbitrationParams.klerosArbitrator,
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
        ArbitrationParams memory arbitrationParams = arbitrationParamsChanges[
            claimIndexToArbitrationParamIndex[claimIndex]
        ];
        emit SubmittedEvidenceToKlerosArbitrator(
            claimIndex,
            msg.sender,
            evidence
        );
        emit Evidence(
            arbitrationParams.klerosArbitrator,
            claimIndex,
            msg.sender,
            evidence
        );
    }

    function appealKlerosArbitratorDecision(
        uint256 claimIndex,
        uint256 klerosArbitratorDisputeId
    ) external payable override {
        ArbitrationParams memory arbitrationParams = arbitrationParamsChanges[
            claimIndexToArbitrationParamIndex[claimIndex]
        ];
        require(
            claimIndex ==
                klerosArbitratorAndDisputeIdToClaimIndex[
                    address(arbitrationParams.klerosArbitrator)
                ][klerosArbitratorDisputeId],
            "Claim index-dispute ID mismatch"
        );

        emit AppealedKlerosArbitratorDecision(
            claimIndex,
            msg.sender,
            klerosArbitratorDisputeId
        );

        // msg.value will be verified in the appeal
        arbitrationParams.klerosArbitrator.appeal(
            klerosArbitratorDisputeId,
            arbitrationParams.klerosArbitratorExtraData // Unused in KlerosLiquid
        );
    }

    function rule(uint256 disputeId, uint256 ruling) external override {
        uint256 claimIndex = klerosArbitratorAndDisputeIdToClaimIndex[
            msg.sender
        ][disputeId];
        ArbitrationParams memory arbitrationParams = arbitrationParamsChanges[
            claimIndexToArbitrationParamIndex[claimIndex]
        ];
        require(
            msg.sender == address(arbitrationParams.klerosArbitrator),
            "Sender not Kleros arbitrator"
        );
        ArbitratorDecision decision;
        if (ruling == 0 || ruling == 1) {
            decision = ArbitratorDecision.PaySettlement;
        } else if (ruling == 2) {
            decision = ArbitratorDecision.PayClaim;
        } else {
            revert("Invalid ruling option");
        }
        emit Ruling(arbitrationParams.klerosArbitrator, disputeId, ruling);
        ClaimsManager.resolveDispute(claimIndex, decision);
    }

    function createDispute(uint256 claimIndex, address arbitrator)
        public
        override(ClaimsManager, IClaimsManager)
    {
        // arbitrationParams are fixed to the claim at dispute creation.
        // there's no "general" klerosArbitrator, so just check the
        // last arbitrationParams

        ArbitrationParams memory arbitrationParams = arbitrationParamsChanges[
            arbitrationParamsCount - 1
        ];
        require(
            arbitrator != address(arbitrationParams.klerosArbitrator),
            "Use Kleros arbitrator interface"
        );
        ClaimsManager.createDispute(claimIndex, arbitrator);
    }

    function resolveDispute(uint256 claimIndex, ArbitratorDecision result)
        public
        override(ClaimsManager, IClaimsManager)
    {
        ArbitrationParams memory arbitrationParams = arbitrationParamsChanges[
            claimIndexToArbitrationParamIndex[claimIndex]
        ];
        require(
            msg.sender != address(arbitrationParams.klerosArbitrator),
            "Use Kleros arbitrator interface"
        );
        ClaimsManager.resolveDispute(claimIndex, result);
    }

    // two functions below are implemented to respect the interface
    function klerosArbitrator() external view returns (IArbitrator) {
        ArbitrationParams memory arbitrationParams = arbitrationParamsChanges[
            arbitrationParamsCount - 1
        ];
        return arbitrationParams.klerosArbitrator;
    }

    function klerosArbitratorExtraData() external view returns (bytes memory) {
        ArbitrationParams memory arbitrationParams = arbitrationParamsChanges[
            arbitrationParamsCount - 1
        ];
        return arbitrationParams.klerosArbitratorExtraData;
    }
}
