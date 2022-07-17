//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./ClaimsManager.sol";
import "./interfaces/IExtendedKlerosArbitrator.sol";
import "./interfaces/IClaimsManagerWithKlerosArbitration.sol";

contract ClaimsManagerWithKlerosArbitration is
    ClaimsManager,
    IClaimsManagerWithKlerosArbitration
{
    struct KlerosArbitrationParameters {
        IArbitrator arbitrator;
        bytes extraData;
    }

    KlerosArbitrationParameters[] public klerosArbitrationParametersHistory;

    mapping(uint256 => uint256)
        public claimIndexToKlerosArbitrationParametersHistoryIndex;

    mapping(address => mapping(uint256 => uint256))
        public klerosArbitratorToDisputeIdToClaimIndex;

    constructor(
        address _accessControlRegistry,
        string memory _adminRoleDescription,
        address _manager,
        address _api3Pool,
        uint256 _mediatorResponsePeriod,
        uint256 _claimantResponsePeriod,
        address _klerosArbitrator,
        bytes memory _klerosArbitratorExtraData,
        string memory _klerosArbitratorMetaEvidence,
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
        _setKlerosArbitrationParameters(
            _klerosArbitrator,
            _klerosArbitratorExtraData,
            _klerosArbitratorMetaEvidence
        );
        _setArbitratorResponsePeriod(
            _klerosArbitrator,
            _klerosArbitratorResponsePeriod
        );
    }

    function setKlerosArbitrationParameters(
        address _klerosArbitrator,
        bytes memory _klerosArbitratorExtraData,
        string calldata _klerosArbitratorMetaEvidence
    ) external onlyManagerOrAdmin {
        _setKlerosArbitrationParameters(
            _klerosArbitrator,
            _klerosArbitratorExtraData,
            _klerosArbitratorMetaEvidence
        );
    }

    function createDisputeWithKlerosArbitrator(uint256 claimIndex)
        external
        payable
        override
    {
        uint256 klerosArbitrationParametersHistoryIndex = klerosArbitrationParametersHistory
                .length - 1;
        claimIndexToKlerosArbitrationParametersHistoryIndex[
            claimIndex
        ] = klerosArbitrationParametersHistoryIndex;
        KlerosArbitrationParameters
            storage klerosArbitrationParameters = klerosArbitrationParametersHistory[
                klerosArbitrationParametersHistoryIndex
            ];
        IArbitrator arbitrator = klerosArbitrationParameters.arbitrator;
        ClaimsManager.createDispute(claimIndex, address(arbitrator));
        uint256 disputeId = arbitrator.createDispute{value: msg.value}(
            uint256(type(ArbitratorDecision).max),
            klerosArbitrationParameters.extraData
        );
        klerosArbitratorToDisputeIdToClaimIndex[address(arbitrator)][
            disputeId
        ] = claimIndex;
        emit CreatedDisputeWithKlerosArbitrator(
            claimIndex,
            msg.sender,
            disputeId
        );
        emit Dispute(
            arbitrator,
            disputeId,
            klerosArbitrationParametersHistoryIndex, // metaEvidence is emitted with the arbitrationParams
            claimIndex
        );
        emit Evidence(
            arbitrator,
            claimIndex,
            msg.sender,
            claims[claimIndex].evidence
        );
    }

    function submitEvidenceToKlerosArbitrator(
        uint256 claimIndex,
        uint256 disputeId,
        string calldata evidence
    ) external override onlyManagerOrMediator {
        KlerosArbitrationParameters
            storage klerosArbitrationParameters = klerosArbitrationParametersHistory[
                claimIndexToKlerosArbitrationParametersHistoryIndex[claimIndex]
            ];
        IArbitrator arbitrator = klerosArbitrationParameters.arbitrator;
        require(
            klerosArbitratorToDisputeIdToClaimIndex[address(arbitrator)][
                disputeId
            ] == claimIndex,
            "Invalid claim-dispute pair"
        );
        emit SubmittedEvidenceToKlerosArbitrator(
            claimIndex,
            msg.sender,
            evidence
        );
        emit Evidence(arbitrator, claimIndex, msg.sender, evidence);
    }

    function appealKlerosArbitratorRuling(uint256 claimIndex, uint256 disputeId)
        external
        payable
        override
    {
        (
            IArbitrator arbitrator,
            bytes memory extraData
        ) = getKlerosArbitrationParametersForClaimDisputePair(
                claimIndex,
                disputeId
            );
        // Ruling options
        // 0: Kleros refused to arbitrate. We allow both parties to appeal to this.
        // 1: Pay the claim. Only the mediator can appeal to this.
        // 2: Pay the settlement. Only the claimant can appeal to this.
        // We don't check the dispute status (if it's appealable), as the appeal() call
        // below should revert in that case anyway.
        if (msg.sender == claims[claimIndex].claimant) {
            require(
                arbitrator.currentRuling(disputeId) != 1,
                "Ruling agrees with claimant"
            );
        } else if (
            manager == msg.sender ||
            IAccessControlRegistry(accessControlRegistry).hasRole(
                mediatorRole,
                msg.sender
            )
        ) {
            require(
                arbitrator.currentRuling(disputeId) != 2,
                "Ruling agrees with mediator"
            );
        } else {
            revert("Only parties can appeal");
        }
        emit AppealedKlerosArbitratorRuling(claimIndex, msg.sender, disputeId);
        arbitrator.appeal{value: msg.value}(
            disputeId,
            extraData // Unused in KlerosLiquid
        );
    }

    function rule(uint256 disputeId, uint256 ruling) external override {
        uint256 claimIndex = klerosArbitratorToDisputeIdToClaimIndex[
            msg.sender
        ][disputeId];
        require(claimIndex != 0, "No dispute for sender to rule");
        emit Ruling(IArbitrator(msg.sender), disputeId, ruling);
        // should revert if ruling > type(ArbitratorDecision).max
        ArbitratorDecision decision = ArbitratorDecision(ruling);
        ClaimsManager.resolveDispute(claimIndex, decision);
    }

    function createDispute(uint256 claimIndex, address arbitrator)
        public
        override(ClaimsManager, IClaimsManager)
    {
        require(
            arbitrator !=
                address(
                    klerosArbitrationParametersHistory[
                        klerosArbitrationParametersHistory.length - 1
                    ].arbitrator
                ),
            "Use Kleros arbitrator interface"
        );
        ClaimsManager.createDispute(claimIndex, arbitrator);
    }

    function resolveDispute(uint256 claimIndex, ArbitratorDecision result)
        public
        override(ClaimsManager, IClaimsManager)
    {
        require(
            msg.sender !=
                address(
                    klerosArbitrationParametersHistory[
                        claimIndexToKlerosArbitrationParametersHistoryIndex[
                            claimIndex
                        ]
                    ].arbitrator
                ),
            "Use Kleros arbitrator interface"
        );
        ClaimsManager.resolveDispute(claimIndex, result);
    }

    function executeRuling(uint256 claimIndex, uint256 disputeId) external {
        (
            IArbitrator arbitrator,

        ) = getKlerosArbitrationParametersForClaimDisputePair(
                claimIndex,
                disputeId
            );
        IExtendedKlerosArbitrator(address(arbitrator)).executeRuling(disputeId);
    }

    // two functions below are implemented to respect the interface
    function klerosArbitrator() public view returns (IArbitrator) {
        return
            klerosArbitrationParametersHistory[
                klerosArbitrationParametersHistory.length - 1
            ].arbitrator;
    }

    function klerosArbitratorExtraData() public view returns (bytes memory) {
        return
            klerosArbitrationParametersHistory[
                klerosArbitrationParametersHistory.length - 1
            ].extraData;
    }

    function getKlerosArbitrationParametersForClaimDisputePair(
        uint256 claimIndex,
        uint256 disputeId
    ) public view returns (IArbitrator arbitrator, bytes memory extraData) {
        KlerosArbitrationParameters
            storage klerosArbitrationParameters = klerosArbitrationParametersHistory[
                claimIndexToKlerosArbitrationParametersHistoryIndex[claimIndex]
            ];
        arbitrator = klerosArbitrationParameters.arbitrator;
        require(
            klerosArbitratorToDisputeIdToClaimIndex[address(arbitrator)][
                disputeId
            ] == claimIndex,
            "Invalid claim-dispute pair"
        );
        extraData = klerosArbitrationParameters.extraData;
    }

    function arbitrationCost() external view returns (uint256) {
        return klerosArbitrator().arbitrationCost(klerosArbitratorExtraData());
    }

    function appealCost(uint256 claimIndex, uint256 disputeId)
        external
        view
        returns (uint256)
    {
        (
            IArbitrator arbitrator,
            bytes memory extraData
        ) = getKlerosArbitrationParametersForClaimDisputePair(
                claimIndex,
                disputeId
            );
        return arbitrator.appealCost(disputeId, extraData);
    }

    function disputeStatus(uint256 claimIndex, uint256 disputeId)
        external
        view
        returns (IArbitrator.DisputeStatus)
    {
        (
            IArbitrator arbitrator,

        ) = getKlerosArbitrationParametersForClaimDisputePair(
                claimIndex,
                disputeId
            );
        return arbitrator.disputeStatus(disputeId);
    }

    function currentRuling(uint256 claimIndex, uint256 disputeId)
        external
        view
        returns (uint256)
    {
        (
            IArbitrator arbitrator,

        ) = getKlerosArbitrationParametersForClaimDisputePair(
                claimIndex,
                disputeId
            );
        return arbitrator.currentRuling(disputeId);
    }

    function getSubCourt(uint96 subCourtId)
        external
        view
        returns (uint256[] memory children, uint256[4] memory timesPerPeriod)
    {
        return
            IExtendedKlerosArbitrator(address(klerosArbitrator())).getSubCourt(
                subCourtId
            );
    }

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
        )
    {
        return
            IExtendedKlerosArbitrator(address(klerosArbitrator())).courts(
                subCourtId
            );
    }

    function disputes(uint256 disputeId)
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
        )
    {
        return
            IExtendedKlerosArbitrator(address(klerosArbitrator())).disputes(
                disputeId
            );
    }

    function _setKlerosArbitrationParameters(
        address _klerosArbitrator,
        bytes memory _klerosArbitratorExtraData,
        string memory _klerosArbitratorMetaEvidence
    ) private {
        require(
            _klerosArbitrator != address(0),
            "Kleros arbitrator address zero"
        );
        require(
            _klerosArbitratorExtraData.length != 0,
            "Arbitrator extra data empty"
        );
        klerosArbitrationParametersHistory.push(
            KlerosArbitrationParameters({
                arbitrator: IArbitrator(_klerosArbitrator),
                extraData: _klerosArbitratorExtraData
            })
        );
        emit MetaEvidence(
            klerosArbitrationParametersHistory.length - 1,
            _klerosArbitratorMetaEvidence
        );
    }
}
