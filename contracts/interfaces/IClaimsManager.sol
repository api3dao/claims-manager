//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@api3/airnode-protocol/contracts/access-control-registry/interfaces/IAccessControlRegistryAdminnedWithManager.sol";

interface IClaimsManager is IAccessControlRegistryAdminnedWithManager {
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
        uint256 amount,
        address sender
    );

    event ResetQuota(address indexed account, address sender);

    event CreatedPolicy(
        address beneficiary,
        address indexed claimant,
        bytes32 indexed policyHash,
        uint256 coverageAmount,
        uint256 startTime,
        uint256 endTime,
        string policy,
        address sender
    );

    event CreatedClaim(
        uint256 indexed claimIndex,
        address indexed claimant,
        bytes32 indexed policyHash,
        address beneficiary,
        uint256 coverageAmount,
        uint256 startTime,
        uint256 endTime,
        string policy,
        uint256 claimAmount,
        string evidence,
        uint256 claimCreationTime
    );

    event AcceptedClaim(
        uint256 indexed claimIndex,
        address indexed claimant,
        address beneficiary,
        uint256 claimAmount,
        address sender
    );

    event ProposedSettlement(
        uint256 indexed claimIndex,
        address indexed claimant,
        uint256 amount,
        address sender
    );

    event AcceptedSettlement(
        uint256 indexed claimIndex,
        address indexed claimant,
        uint256 amount
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
        uint256 amount,
        address arbitrator
    );

    event ResolvedDisputeByAcceptingSettlement(
        uint256 indexed claimIndex,
        address indexed claimant,
        address beneficiary,
        uint256 amount,
        address arbitrator
    );

    event TimedOutClaim(uint256 indexed claimIndex, address indexed claimant);
}
