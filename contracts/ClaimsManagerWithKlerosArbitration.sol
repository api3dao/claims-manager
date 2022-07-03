//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./ClaimsManager.sol";
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
    ) external override {
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
        KlerosArbitrationParameters
            storage klerosArbitrationParameters = klerosArbitrationParametersHistory[
                claimIndexToKlerosArbitrationParametersHistoryIndex[claimIndex]
            ];
        IArbitrator arbitrator = klerosArbitrationParameters.arbitrator;
        require(
            claimIndex ==
                klerosArbitratorToDisputeIdToClaimIndex[address(arbitrator)][
                    disputeId
                ],
            "Invalid claim-dispute pair"
        );
        emit AppealedKlerosArbitratorRuling(claimIndex, msg.sender, disputeId);
        arbitrator.appeal{value: msg.value}(
            disputeId,
            klerosArbitrationParameters.extraData // Unused in KlerosLiquid
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

    // two functions below are implemented to respect the interface
    function klerosArbitrator() external view returns (IArbitrator) {
        return
            klerosArbitrationParametersHistory[
                klerosArbitrationParametersHistory.length - 1
            ].arbitrator;
    }

    function klerosArbitratorExtraData() external view returns (bytes memory) {
        return
            klerosArbitrationParametersHistory[
                klerosArbitrationParametersHistory.length - 1
            ].extraData;
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
