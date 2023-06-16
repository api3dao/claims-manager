//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@api3/airnode-protocol-v1/contracts/access-control-registry/interfaces/IAccessControlRegistryAdminnedWithManager.sol";

interface IClaimsManager is IAccessControlRegistryAdminnedWithManager {
    enum ClaimStatus {
        None,
        ClaimCreated,
        ClaimAccepted,
        SettlementProposed,
        SettlementAccepted,
        DisputeCreated,
        DisputeResolvedWithoutPayout,
        DisputeResolvedWithClaimPayout,
        DisputeResolvedWithSettlementPayout
    }

    enum ArbitratorDecision {
        DoNotPay,
        PayClaim,
        PaySettlement
    }

    event SetApi3UsdAmountConverter(
        address api3UsdAmountConverter,
        address sender
    );

    event SetApi3Pool(address api3Pool, address sender);

    event SetMediatorResponsePeriod(
        uint32 mediatorResponsePeriod,
        address sender
    );

    event SetClaimantResponsePeriod(
        uint32 claimantResponsePeriod,
        address sender
    );

    event SetArbitratorResponsePeriod(
        uint32 arbitratorResponsePeriod,
        address sender
    );

    event SetQuota(
        address indexed account,
        uint32 period,
        uint224 amountInApi3,
        address sender
    );

    event ResetQuota(address indexed account, address sender);

    event CreatedPolicy(
        address indexed claimant,
        bytes32 indexed policyHash,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string policy,
        address sender
    );

    event UpgradedPolicy(
        address indexed claimant,
        bytes32 indexed policyHash,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string policy,
        address sender
    );

    event DowngradedPolicy(
        address indexed claimant,
        bytes32 indexed policyHash,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string policy,
        address sender
    );

    event UpdatedPolicy(
        address indexed claimant,
        bytes32 indexed policyHash,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string policy,
        address sender
    );

    event AnnouncedPolicyMetadata(
        address indexed claimant,
        bytes32 indexed policyHash,
        string metadata,
        address sender
    );

    event CreatedClaim(
        address indexed claimant,
        bytes32 indexed policyHash,
        bytes32 indexed claimHash,
        uint32 claimsAllowedFrom,
        string policy,
        uint224 claimAmountInUsd,
        string evidence,
        uint32 claimCreationTime
    );

    event AcceptedClaim(
        address indexed claimant,
        bytes32 indexed policyHash,
        bytes32 indexed claimHash,
        uint224 clippedPayoutAmountInUsd,
        uint224 clippedPayoutAmountInApi3,
        address sender
    );

    event ProposedSettlement(
        address indexed claimant,
        bytes32 indexed policyHash,
        bytes32 indexed claimHash,
        uint224 settlementAmountInUsd,
        address sender
    );

    event AcceptedSettlement(
        address indexed claimant,
        bytes32 indexed policyHash,
        bytes32 indexed claimHash,
        uint224 clippedAmountInUsd,
        uint224 clippedAmountInApi3
    );

    event CreatedDispute(
        address indexed claimant,
        bytes32 indexed policyHash,
        bytes32 indexed claimHash,
        address arbitrator
    );

    event ResolvedDisputeByRejectingClaim(
        address indexed claimant,
        bytes32 indexed policyHash,
        bytes32 indexed claimHash,
        address arbitrator
    );

    event ResolvedDisputeByAcceptingClaim(
        address indexed claimant,
        bytes32 indexed policyHash,
        bytes32 indexed claimHash,
        uint224 clippedPayoutAmountInUsd,
        uint224 clippedPayoutAmountInApi3,
        address arbitrator
    );

    event ResolvedDisputeByAcceptingSettlement(
        address indexed claimant,
        bytes32 indexed policyHash,
        bytes32 indexed claimHash,
        uint224 clippedPayoutAmountInUsd,
        uint224 clippedPayoutAmountInApi3,
        address arbitrator
    );

    function setApi3UsdAmountConverter(address _api3UsdAmountConverter)
        external;

    function setApi3Pool(address _api3Pool) external;

    function setMediatorResponsePeriod(uint32 _mediatorResponsePeriod) external;

    function setClaimantResponsePeriod(uint32 _claimantResponsePeriod) external;

    function setArbitratorResponsePeriod(uint32 _arbitratorResponsePeriod)
        external;

    function setQuota(
        address account,
        uint32 period,
        uint224 amountInApi3
    ) external;

    function resetQuota(address account) external;

    function createPolicy(
        address claimant,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string calldata policy
    ) external returns (bytes32 policyHash);

    function upgradePolicy(
        address claimant,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string calldata policy
    ) external returns (bytes32 policyHash);

    function downgradePolicy(
        address claimant,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string calldata policy
    ) external returns (bytes32 policyHash);

    function updatePolicy(
        address claimant,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string calldata policy
    ) external returns (bytes32 policyHash);

    function announcePolicyMetadata(
        address claimant,
        uint32 claimsAllowedFrom,
        string calldata policy,
        string calldata metadata
    ) external returns (bytes32 policyHash);

    function createClaim(
        uint32 claimsAllowedFrom,
        string calldata policy,
        uint224 claimAmountInUsd,
        string calldata evidence
    ) external returns (bytes32 claimHash);

    function acceptClaim(
        bytes32 policyHash,
        address claimant,
        uint224 claimAmountInUsd,
        string calldata evidence
    ) external;

    function proposeSettlement(
        bytes32 policyHash,
        address claimant,
        uint224 claimAmountInUsd,
        string calldata evidence,
        uint224 settlementAmountInUsd
    ) external;

    function acceptSettlement(
        bytes32 policyHash,
        uint224 claimAmountInUsd,
        string calldata evidence,
        uint224 minimumPayoutAmountInApi3
    ) external returns (uint224 clippedPayoutAmountInApi3);

    function createDispute(
        bytes32 policyHash,
        address claimant,
        uint224 claimAmountInUsd,
        string calldata evidence
    ) external;

    function resolveDispute(
        bytes32 policyHash,
        address claimant,
        uint224 claimAmountInUsd,
        string calldata evidence,
        ArbitratorDecision result
    ) external returns (uint224 clippedAmountInApi3);

    function isMediatorOrAdmin(address account) external view returns (bool);

    function policyAgentRole() external view returns (bytes32);

    function mediatorRole() external view returns (bytes32);

    function arbitratorRole() external view returns (bytes32);

    function api3UsdAmountConverter() external view returns (address);

    function api3Pool() external view returns (address);

    function mediatorResponsePeriod() external view returns (uint32);

    function claimantResponsePeriod() external view returns (uint32);

    function arbitratorResponsePeriod() external view returns (uint32);

    function policyHashToState(bytes32 policyHash)
        external
        view
        returns (uint32 claimsAllowedUntil, uint224 coverageAmountInUsd);

    function claimHashToState(bytes32 claimHash)
        external
        view
        returns (
            ClaimStatus status,
            uint32 updateTime,
            address arbitrator
        );

    function claimHashToProposedSettlementAmountInUsd(bytes32 claimHash)
        external
        view
        returns (uint224);
}
