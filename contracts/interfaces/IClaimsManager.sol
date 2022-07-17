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
        DisputeResolvedWithSettlementPayout,
        TimedOut
    }

    enum ArbitratorDecision {
        DoNotPay,
        PayClaim,
        PaySettlement
    }

    event SetApi3ToUsdReader(address api3ToUsdReader);

    event SetApi3Pool(address api3Pool);

    event SetMediatorResponsePeriod(uint256 mediatorResponsePeriod);

    event SetClaimantResponsePeriod(uint256 claimantResponsePeriod);

    event SetArbitratorResponsePeriod(
        address indexed arbitrator,
        uint256 arbitratorResponsePeriod,
        address sender
    );

    event SetQuota(
        address indexed account,
        uint256 period,
        uint256 amountInApi3,
        address sender
    );

    event ResetQuota(address indexed account, address sender);

    event CreatedPolicy(
        address beneficiary,
        address indexed claimant,
        bytes32 indexed policyHash,
        uint256 coverageAmountInUsd,
        uint256 claimsAllowedFrom,
        uint256 claimsAllowedUntil,
        string policy,
        address sender
    );

    event CreatedClaim(
        uint256 indexed claimIndex,
        address indexed claimant,
        bytes32 indexed policyHash,
        address beneficiary,
        uint256 coverageAmountInUsd,
        uint256 claimsAllowedFrom,
        uint256 claimsAllowedUntil,
        string policy,
        uint256 claimAmountInUsd,
        string evidence,
        uint256 claimCreationTime
    );

    event AcceptedClaim(
        uint256 indexed claimIndex,
        address indexed claimant,
        address beneficiary,
        uint256 amountInApi3,
        address sender
    );

    event ProposedSettlement(
        uint256 indexed claimIndex,
        address indexed claimant,
        uint256 amountInUsd,
        uint256 amountInApi3,
        address sender
    );

    event AcceptedSettlement(
        uint256 indexed claimIndex,
        address indexed claimant,
        uint256 amountInApi3
    );

    event CreatedDispute(
        uint256 indexed claimIndex,
        address indexed claimant,
        address arbitrator
    );

    event ResolvedDisputeByRejectingClaim(
        uint256 indexed claimIndex,
        address indexed claimant,
        address arbitrator
    );

    event ResolvedDisputeByAcceptingClaim(
        uint256 indexed claimIndex,
        address indexed claimant,
        address beneficiary,
        uint256 amountInApi3,
        address arbitrator
    );

    event ResolvedDisputeByAcceptingSettlement(
        uint256 indexed claimIndex,
        address indexed claimant,
        address beneficiary,
        uint256 amountInApi3,
        address arbitrator
    );

    event TimedOutClaim(uint256 indexed claimIndex, address indexed claimant);

    function setApi3ToUsdReader(address _api3ToUsdReader) external;

    function setApi3Pool(address _api3Pool) external;

    function setMediatorResponsePeriod(uint256 _mediatorResponsePeriod)
        external;

    function setClaimantResponsePeriod(uint256 _claimantResponsePeriod)
        external;

    function setArbitratorResponsePeriod(
        address arbitrator,
        uint256 arbitratorResponsePeriod
    ) external;

    function setQuota(
        address account,
        uint256 period,
        uint256 amountInApi3
    ) external;

    function resetQuota(address account) external;

    function createPolicy(
        address claimant,
        address beneficiary,
        uint256 coverageAmountInUsd,
        uint256 claimsAllowedFrom,
        uint256 claimsAllowedUntil,
        string calldata policy
    ) external returns (bytes32 policyHash);

    function createClaim(
        address beneficiary,
        uint256 coverageAmountInUsd,
        uint256 claimsAllowedFrom,
        uint256 claimsAllowedUntil,
        string calldata policy,
        uint256 claimAmountInUsd,
        string calldata evidence
    ) external returns (uint256 claimIndex);

    function acceptClaim(uint256 claimIndex) external;

    function proposeSettlement(uint256 claimIndex, uint256 amountInUsd)
        external;

    function acceptSettlement(uint256 claimIndex) external;

    function createDispute(uint256 claimIndex, address arbitrator) external;

    function resolveDispute(uint256 claimIndex, ArbitratorDecision result)
        external;

    function timeOutClaim(uint256 claimIndex) external;

    function getQuotaUsage(address account) external view returns (uint256);

    function policyCreatorRole() external view returns (bytes32);

    function mediatorRole() external view returns (bytes32);

    function arbitratorRole() external view returns (bytes32);

    function api3ToUsdReader() external view returns (address);

    function api3Pool() external view returns (address);

    function mediatorResponsePeriod() external view returns (uint256);

    function claimantResponsePeriod() external view returns (uint256);

    function arbitratorToResponsePeriod(address arbitrator)
        external
        view
        returns (uint256);

    function accountToAccumulatedQuotaUsageCheckpoints(
        address account,
        uint256 checkpointIndex
    ) external view returns (uint256 fromTimestamp, uint256 value);

    function accountToQuota(address account)
        external
        view
        returns (uint256 period, uint256 amountInApi3);

    function policyWithHashExists(bytes32 policyHash)
        external
        view
        returns (bool);

    function claimCount() external view returns (uint256);

    function claims(uint256 claimIndex)
        external
        view
        returns (
            address claimant,
            address beneficiary,
            uint256 amountInUsd,
            string memory evidence,
            uint256 updateTime,
            ClaimStatus status
        );

    function claimIndexToProposedSettlementAmountInUsd(uint256 claimIndex)
        external
        view
        returns (uint256);

    function claimIndexToProposedSettlementAmountInApi3(uint256 claimIndex)
        external
        view
        returns (uint256);

    function claimIndexToArbitrator(uint256 claimIndex)
        external
        view
        returns (address);
}
