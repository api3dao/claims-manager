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

    event SetApi3ToUsdReader(address api3ToUsdReader, address sender);

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
        address beneficiary,
        address indexed claimant,
        bytes32 indexed policyHash,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string policy,
        address sender
    );

    event UpgradedPolicy(
        address beneficiary,
        address indexed claimant,
        bytes32 indexed policyHash,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string policy,
        address sender
    );

    event DowngradedPolicy(
        address beneficiary,
        address indexed claimant,
        bytes32 indexed policyHash,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string policy,
        address sender
    );

    event AnnouncedPolicyMetadata(
        string metadata,
        address indexed claimant,
        bytes32 indexed policyHash,
        address sender
    );

    event CreatedClaim(
        bytes32 indexed claimHash,
        address indexed claimant,
        bytes32 indexed policyHash,
        address beneficiary,
        uint32 claimsAllowedFrom,
        string policy,
        uint224 claimAmountInUsd,
        string evidence,
        uint32 claimCreationTime
    );

    event AcceptedClaim(
        bytes32 indexed claimHash,
        address indexed claimant,
        address beneficiary,
        uint224 clippedPayoutAmountInUsd,
        uint224 clippedPayoutAmountInApi3,
        address sender
    );

    event ProposedSettlement(
        bytes32 indexed claimHash,
        address indexed claimant,
        uint224 settlementAmountInUsd,
        address sender
    );

    event AcceptedSettlement(
        bytes32 indexed claimHash,
        address indexed claimant,
        uint224 clippedAmountInUsd,
        uint224 clippedAmountInApi3
    );

    event CreatedDispute(
        bytes32 indexed claimHash,
        address indexed claimant,
        address arbitrator
    );

    event ResolvedDisputeByRejectingClaim(
        bytes32 indexed claimHash,
        address indexed claimant,
        address arbitrator
    );

    event ResolvedDisputeByAcceptingClaim(
        bytes32 indexed claimHash,
        address indexed claimant,
        address beneficiary,
        uint224 clippedPayoutAmountInUsd,
        uint224 clippedPayoutAmountInApi3,
        address arbitrator
    );

    event ResolvedDisputeByAcceptingSettlement(
        bytes32 indexed claimHash,
        address indexed claimant,
        address beneficiary,
        uint224 clippedPayoutAmountInUsd,
        uint224 clippedPayoutAmountInApi3,
        address arbitrator
    );

    function setApi3ToUsdReader(address _api3ToUsdReader) external;

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
        address beneficiary,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string calldata policy
    ) external returns (bytes32 policyHash);

    function upgradePolicy(
        address claimant,
        address beneficiary,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string calldata policy
    ) external returns (bytes32 policyHash);

    function downgradePolicy(
        address claimant,
        address beneficiary,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string calldata policy
    ) external returns (bytes32 policyHash);

    function announcePolicyMetadata(
        address claimant,
        address beneficiary,
        uint32 claimsAllowedFrom,
        string calldata policy,
        string calldata metadata
    ) external returns (bytes32 policyHash);

    function createClaim(
        address beneficiary,
        uint32 claimsAllowedFrom,
        string calldata policy,
        uint224 claimAmountInUsd,
        string calldata evidence
    ) external returns (bytes32 claimHash);

    function acceptClaim(
        bytes32 policyHash,
        address claimant,
        address beneficiary,
        uint224 claimAmountInUsd,
        string calldata evidence
    ) external;

    function proposeSettlement(
        bytes32 policyHash,
        address claimant,
        address beneficiary,
        uint224 claimAmountInUsd,
        string calldata evidence,
        uint224 settlementAmountInUsd
    ) external;

    function acceptSettlement(
        bytes32 policyHash,
        address claimant,
        address beneficiary,
        uint224 claimAmountInUsd,
        string calldata evidence,
        uint224 minimumPayoutAmountInApi3
    ) external returns (uint224 clippedPayoutAmountInApi3);

    function createDispute(
        bytes32 policyHash,
        address claimant,
        address beneficiary,
        uint224 claimAmountInUsd,
        string calldata evidence
    ) external;

    function resolveDispute(
        bytes32 policyHash,
        address claimant,
        address beneficiary,
        uint224 claimAmountInUsd,
        string calldata evidence,
        ArbitratorDecision result
    ) external returns (uint224 clippedAmountInApi3);

    function getQuotaUsage(address account) external view returns (uint224);

    function isMediatorOrAdmin(address account) external view returns (bool);

    function policyAgentRole() external view returns (bytes32);

    function mediatorRole() external view returns (bytes32);

    function arbitratorRole() external view returns (bytes32);

    function api3ToUsdReader() external view returns (address);

    function api3Pool() external view returns (address);

    function mediatorResponsePeriod() external view returns (uint32);

    function claimantResponsePeriod() external view returns (uint32);

    function arbitratorResponsePeriod() external view returns (uint32);

    function accountToAccumulatedQuotaUsageCheckpoints(
        address account,
        uint256 checkpointIndex
    ) external view returns (uint32 fromTimestamp, uint224 value);

    function accountToQuota(address account)
        external
        view
        returns (uint32 period, uint224 amountInApi3);

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
