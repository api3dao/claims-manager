//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@api3/airnode-protocol-v1/contracts/access-control-registry/AccessControlRegistryAdminnedWithManager.sol";
import "./QuotaEnforcer.sol";
import "@api3/api3-dao-contracts/contracts/interfaces/IApi3Pool.sol";
import "./interfaces/ICurrencyConverter.sol";
import "./interfaces/IClaimsManager.sol";

contract ClaimsManager is
    AccessControlRegistryAdminnedWithManager,
    QuotaEnforcer,
    IClaimsManager
{
    struct ClaimState {
        ClaimStatus status;
        uint32 updateTime;
        address arbitrator;
    }

    struct PolicyState {
        uint32 claimsAllowedUntil;
        uint224 coverageAmountInUsd;
    }

    bytes32 public immutable override policyAgentRole;
    bytes32 public immutable override mediatorRole;
    bytes32 public immutable override arbitratorRole;

    address public override api3UsdAmountConverter;
    address public override api3Pool;
    uint32 public override mediatorResponsePeriod;
    uint32 public override claimantResponsePeriod;
    uint32 public override arbitratorResponsePeriod;

    mapping(bytes32 => PolicyState) public override policyHashToState;
    mapping(bytes32 => ClaimState) public override claimHashToState;
    mapping(bytes32 => uint224)
        public
        override claimHashToProposedSettlementAmountInUsd;

    modifier onlyAdmin() {
        require(isAdmin(msg.sender), "Sender cannot administrate");
        _;
    }

    modifier onlyPolicyAgentOrAdmin() {
        require(
            IAccessControlRegistry(accessControlRegistry).hasRole(
                policyAgentRole,
                msg.sender
            ) || isAdmin(msg.sender),
            "Sender cannot manage policy"
        );
        _;
    }

    modifier onlyMediatorOrAdmin() {
        require(isMediatorOrAdmin(msg.sender), "Sender cannot mediate");
        _;
    }

    modifier onlyArbitratorOrAdmin() {
        require(
            IAccessControlRegistry(accessControlRegistry).hasRole(
                arbitratorRole,
                msg.sender
            ) || isAdmin(msg.sender),
            "Sender cannot arbitrate"
        );
        _;
    }

    constructor(
        address _accessControlRegistry,
        string memory _adminRoleDescription,
        address _manager,
        address _api3Pool,
        uint32 _mediatorResponsePeriod,
        uint32 _claimantResponsePeriod,
        uint32 _arbitratorResponsePeriod
    )
        AccessControlRegistryAdminnedWithManager(
            _accessControlRegistry,
            _adminRoleDescription,
            _manager
        )
    {
        policyAgentRole = _deriveRole(
            adminRole,
            keccak256(abi.encodePacked("Policy agent"))
        );
        mediatorRole = _deriveRole(
            adminRole,
            keccak256(abi.encodePacked("Mediator"))
        );
        arbitratorRole = _deriveRole(
            adminRole,
            keccak256(abi.encodePacked("Arbitrator"))
        );
        _setApi3Pool(_api3Pool);
        _setMediatorResponsePeriod(_mediatorResponsePeriod);
        _setClaimantResponsePeriod(_claimantResponsePeriod);
        _setArbitratorResponsePeriod(_arbitratorResponsePeriod);
    }

    function setApi3UsdAmountConverter(address _api3UsdAmountConverter)
        external
        override
        onlyAdmin
    {
        require(
            _api3UsdAmountConverter != address(0),
            "Api3UsdAmountConverter zero"
        );
        api3UsdAmountConverter = _api3UsdAmountConverter;
        emit SetApi3UsdAmountConverter(_api3UsdAmountConverter, msg.sender);
    }

    function setApi3Pool(address _api3Pool) external override onlyAdmin {
        _setApi3Pool(_api3Pool);
    }

    function setMediatorResponsePeriod(uint32 _mediatorResponsePeriod)
        external
        override
        onlyAdmin
    {
        _setMediatorResponsePeriod(_mediatorResponsePeriod);
    }

    function setClaimantResponsePeriod(uint32 _claimantResponsePeriod)
        external
        override
        onlyAdmin
    {
        _setClaimantResponsePeriod(_claimantResponsePeriod);
    }

    function setArbitratorResponsePeriod(uint32 _arbitratorResponsePeriod)
        external
        override
        onlyAdmin
    {
        _setArbitratorResponsePeriod(_arbitratorResponsePeriod);
    }

    // Allows setting a quota that is currently exceeded
    function setQuota(
        address account,
        uint32 period,
        uint224 amount
    ) external override onlyAdmin {
        _setQuota(account, period, amount);
        emit SetQuota(account, period, amount, msg.sender);
    }

    // Means the account will not be limited
    function resetQuota(address account) external override onlyAdmin {
        _resetQuota(account);
        emit ResetQuota(account, msg.sender);
    }

    // block.timestamp is irrelevant, we don't validate against that on purpose
    function createPolicy(
        address claimant,
        address beneficiary,
        uint224 maxCoverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string calldata policy
    ) external override onlyPolicyAgentOrAdmin returns (bytes32 policyHash) {
        require(claimant != address(0), "Claimant address zero");
        require(beneficiary != address(0), "Beneficiary address zero");
        require(maxCoverageAmountInUsd != 0, "Max coverage amount zero");
        require(claimsAllowedFrom != 0, "Start time zero");
        require(
            claimsAllowedUntil > claimsAllowedFrom,
            "Start not earlier than end"
        );
        require(bytes(policy).length != 0, "Policy address empty");
        policyHash = keccak256(
            abi.encodePacked(
                claimant,
                beneficiary,
                maxCoverageAmountInUsd,
                claimsAllowedFrom,
                policy
            )
        );
        require(
            policyHashToState[policyHash].claimsAllowedUntil == 0,
            "Policy created before"
        );
        policyHashToState[policyHash] = PolicyState({
            claimsAllowedUntil: claimsAllowedUntil,
            coverageAmountInUsd: maxCoverageAmountInUsd
        });
        emit CreatedPolicy(
            beneficiary,
            claimant,
            policyHash,
            maxCoverageAmountInUsd,
            claimsAllowedFrom,
            claimsAllowedUntil,
            policy,
            msg.sender
        );
    }

    // Allowed to keep the values same
    function upgradePolicy(
        address claimant,
        address beneficiary,
        uint224 maxCoverageAmountInUsd,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string calldata policy
    ) external override onlyPolicyAgentOrAdmin returns (bytes32 policyHash) {
        policyHash = keccak256(
            abi.encodePacked(
                claimant,
                beneficiary,
                maxCoverageAmountInUsd,
                claimsAllowedFrom,
                policy
            )
        );
        PolicyState storage policyState = policyHashToState[policyHash];
        uint32 policyStateClaimsAllowedUntil = policyState.claimsAllowedUntil;
        require(policyStateClaimsAllowedUntil != 0, "Policy does not exist");
        require(
            coverageAmountInUsd <= maxCoverageAmountInUsd,
            "Exceeds max coverage amount"
        );
        require(
            policyState.coverageAmountInUsd <= coverageAmountInUsd,
            "Reduces coverage amount"
        );
        require(
            policyStateClaimsAllowedUntil <= claimsAllowedUntil,
            "Reduces claim period"
        );
        policyHashToState[policyHash] = PolicyState({
            claimsAllowedUntil: claimsAllowedUntil,
            coverageAmountInUsd: coverageAmountInUsd
        });
        emit UpgradedPolicy(
            beneficiary,
            claimant,
            policyHash,
            maxCoverageAmountInUsd,
            coverageAmountInUsd,
            claimsAllowedFrom,
            claimsAllowedUntil,
            policy,
            msg.sender
        );
    }

    function downgradePolicy(
        address claimant,
        address beneficiary,
        uint224 maxCoverageAmountInUsd,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string calldata policy
    ) external override returns (bytes32 policyHash) {
        require(
            claimant == msg.sender || isAdmin(msg.sender),
            "Sender cannot downgrade policies"
        );
        require(
            claimsAllowedUntil > claimsAllowedFrom,
            "Start not earlier than end"
        );
        policyHash = keccak256(
            abi.encodePacked(
                claimant,
                beneficiary,
                maxCoverageAmountInUsd,
                claimsAllowedFrom,
                policy
            )
        );
        PolicyState storage policyState = policyHashToState[policyHash];
        uint32 policyStateClaimsAllowedUntil = policyState.claimsAllowedUntil;
        require(policyStateClaimsAllowedUntil != 0, "Policy does not exist");
        require(
            policyState.coverageAmountInUsd >= coverageAmountInUsd,
            "Increases coverage amount"
        );
        require(
            policyStateClaimsAllowedUntil >= claimsAllowedUntil,
            "Increases claim period"
        );
        policyHashToState[policyHash] = PolicyState({
            claimsAllowedUntil: claimsAllowedUntil,
            coverageAmountInUsd: coverageAmountInUsd
        });
        emit DowngradedPolicy(
            beneficiary,
            claimant,
            policyHash,
            maxCoverageAmountInUsd,
            coverageAmountInUsd,
            claimsAllowedFrom,
            claimsAllowedUntil,
            policy,
            msg.sender
        );
    }

    function announcePolicyMetadata(
        address claimant,
        address beneficiary,
        uint224 maxCoverageAmountInUsd,
        uint32 claimsAllowedFrom,
        string calldata policy,
        string calldata metadata
    ) external override onlyPolicyAgentOrAdmin returns (bytes32 policyHash) {
        policyHash = keccak256(
            abi.encodePacked(
                claimant,
                beneficiary,
                maxCoverageAmountInUsd,
                claimsAllowedFrom,
                policy
            )
        );
        require(
            policyHashToState[policyHash].claimsAllowedUntil != 0,
            "Policy does not exist"
        );
        emit AnnouncedPolicyMetadata(
            metadata,
            claimant,
            policyHash,
            msg.sender
        );
    }

    function createClaim(
        address beneficiary,
        uint224 maxCoverageAmountInUsd,
        uint32 claimsAllowedFrom,
        string calldata policy,
        uint224 claimAmountInUsd,
        string calldata evidence
    ) external override returns (bytes32 claimHash) {
        require(claimAmountInUsd != 0, "Claim amount zero");
        require(block.timestamp >= claimsAllowedFrom, "Claims not allowed yet");
        require(bytes(evidence).length != 0, "Evidence address empty");
        bytes32 policyHash = keccak256(
            abi.encodePacked(
                msg.sender,
                beneficiary,
                maxCoverageAmountInUsd,
                claimsAllowedFrom,
                policy
            )
        );
        PolicyState storage policyState = policyHashToState[policyHash];
        require(
            claimAmountInUsd <= policyState.coverageAmountInUsd,
            "Claim larger than coverage"
        );
        require(
            block.timestamp <= policyState.claimsAllowedUntil,
            "Claims not allowed anymore"
        );
        claimHash = keccak256(
            abi.encodePacked(
                policyHash,
                msg.sender,
                beneficiary,
                claimAmountInUsd,
                evidence
            )
        );
        require(
            claimHashToState[claimHash].updateTime == 0,
            "Claim already exists"
        );
        claimHashToState[claimHash] = ClaimState({
            status: ClaimStatus.ClaimCreated,
            updateTime: uint32(block.timestamp),
            arbitrator: address(0)
        });
        emit CreatedClaim(
            claimHash,
            msg.sender,
            policyHash,
            beneficiary,
            maxCoverageAmountInUsd,
            claimsAllowedFrom,
            policy,
            claimAmountInUsd,
            evidence,
            uint32(block.timestamp)
        );
    }

    function acceptClaim(
        bytes32 policyHash,
        address claimant,
        address beneficiary,
        uint224 claimAmountInUsd,
        string calldata evidence
    ) external onlyMediatorOrAdmin {
        bytes32 claimHash = keccak256(
            abi.encodePacked(
                policyHash,
                claimant,
                beneficiary,
                claimAmountInUsd,
                evidence
            )
        );
        ClaimState storage claimState = claimHashToState[claimHash];
        require(
            claimState.status == ClaimStatus.ClaimCreated,
            "Claim not acceptable"
        );
        require(
            claimState.updateTime + mediatorResponsePeriod > block.timestamp,
            "Too late to accept claim"
        );
        claimState.status = ClaimStatus.ClaimAccepted;
        uint224 clippedPayoutAmountInUsd = updatePolicyCoverage(
            policyHash,
            claimAmountInUsd
        );
        uint224 clippedPayoutAmountInApi3 = uint224(
            ICurrencyConverter(api3UsdAmountConverter).convertQuoteToBase(
                clippedPayoutAmountInUsd
            )
        );
        recordUsage(msg.sender, clippedPayoutAmountInApi3);
        emit AcceptedClaim(
            claimHash,
            claimant,
            beneficiary,
            clippedPayoutAmountInUsd,
            clippedPayoutAmountInApi3,
            msg.sender
        );
        IApi3Pool(api3Pool).payOutClaim(beneficiary, clippedPayoutAmountInApi3);
    }

    function proposeSettlement(
        bytes32 policyHash,
        address claimant,
        address beneficiary,
        uint224 claimAmountInUsd,
        string calldata evidence,
        uint224 settlementAmountInUsd
    ) external onlyMediatorOrAdmin {
        require(settlementAmountInUsd != 0, "Settlement amount zero");
        bytes32 claimHash = keccak256(
            abi.encodePacked(
                policyHash,
                claimant,
                beneficiary,
                claimAmountInUsd,
                evidence
            )
        );
        ClaimState storage claimState = claimHashToState[claimHash];
        require(
            claimState.status == ClaimStatus.ClaimCreated,
            "Claim is not settleable"
        );
        require(
            claimState.updateTime + mediatorResponsePeriod > block.timestamp,
            "Too late to propose settlement"
        );
        require(
            settlementAmountInUsd < claimAmountInUsd,
            "Settlement amount not smaller"
        );
        claimHashToState[claimHash] = ClaimState({
            status: ClaimStatus.SettlementProposed,
            updateTime: uint32(block.timestamp),
            arbitrator: address(0)
        });
        // The mediator quota in API3 has to be updated here
        // We're pessimistically using the unclipped amount
        // Current price has to be used as an approximation
        recordUsage(
            msg.sender,
            uint224(
                ICurrencyConverter(api3UsdAmountConverter).convertQuoteToBase(
                    settlementAmountInUsd
                )
            )
        );
        claimHashToProposedSettlementAmountInUsd[
            claimHash
        ] = settlementAmountInUsd;
        emit ProposedSettlement(
            claimHash,
            claimant,
            settlementAmountInUsd,
            msg.sender
        );
    }

    // The user can do a static call to this function to see how much API3 they will receive
    function acceptSettlement(
        bytes32 policyHash,
        address beneficiary,
        uint224 claimAmountInUsd,
        string calldata evidence,
        uint224 minimumPayoutAmountInApi3
    ) external returns (uint224 clippedPayoutAmountInApi3) {
        bytes32 claimHash = keccak256(
            abi.encodePacked(
                policyHash,
                msg.sender,
                beneficiary,
                claimAmountInUsd,
                evidence
            )
        );
        ClaimState storage claimState = claimHashToState[claimHash];
        require(
            claimState.status == ClaimStatus.SettlementProposed,
            "No settlement to accept"
        );
        require(
            claimState.updateTime + claimantResponsePeriod > block.timestamp,
            "Too late to accept settlement"
        );
        claimState.status = ClaimStatus.SettlementAccepted;
        // If settlement amount in USD causes the policy coverage to be exceeded, clip the API3 amount being paid out
        uint224 clippedPayoutAmountInUsd = updatePolicyCoverage(
            policyHash,
            claimHashToProposedSettlementAmountInUsd[claimHash]
        );
        clippedPayoutAmountInApi3 = uint224(
            ICurrencyConverter(api3UsdAmountConverter).convertQuoteToBase(
                clippedPayoutAmountInUsd
            )
        );
        require(
            clippedPayoutAmountInApi3 >= minimumPayoutAmountInApi3,
            "Payout less than minimum"
        );
        emit AcceptedSettlement(
            claimHash,
            msg.sender,
            clippedPayoutAmountInUsd,
            clippedPayoutAmountInApi3
        );
        IApi3Pool(api3Pool).payOutClaim(beneficiary, clippedPayoutAmountInApi3);
    }

    function createDispute(
        bytes32 policyHash,
        address claimant,
        address beneficiary,
        uint224 claimAmountInUsd,
        string calldata evidence
    ) public override onlyArbitratorOrAdmin {
        bytes32 claimHash = keccak256(
            abi.encodePacked(
                policyHash,
                claimant,
                beneficiary,
                claimAmountInUsd,
                evidence
            )
        );
        ClaimState storage claimState = claimHashToState[claimHash];
        if (claimState.status == ClaimStatus.ClaimCreated) {
            require(
                claimState.updateTime + mediatorResponsePeriod <=
                    block.timestamp,
                "Awaiting mediator response"
            );
            require(
                claimState.updateTime +
                    mediatorResponsePeriod +
                    claimantResponsePeriod >
                    block.timestamp,
                "Too late to create dispute"
            );
        } else if (claimState.status == ClaimStatus.SettlementProposed) {
            require(
                claimState.updateTime + claimantResponsePeriod >
                    block.timestamp,
                "Too late to create dispute"
            );
        } else {
            revert("Claim is not disputable");
        }
        claimHashToState[claimHash] = ClaimState({
            status: ClaimStatus.DisputeCreated,
            updateTime: uint32(block.timestamp),
            arbitrator: msg.sender
        });
        emit CreatedDispute(claimHash, claimant, msg.sender);
    }

    function resolveDispute(
        bytes32 policyHash,
        address claimant,
        address beneficiary,
        uint224 claimAmountInUsd,
        string calldata evidence,
        ArbitratorDecision result
    ) public onlyArbitratorOrAdmin returns (uint224 clippedPayoutAmountInApi3) {
        bytes32 claimHash = keccak256(
            abi.encodePacked(
                policyHash,
                claimant,
                beneficiary,
                claimAmountInUsd,
                evidence
            )
        );
        ClaimState storage claimState = claimHashToState[claimHash];
        require(msg.sender == claimState.arbitrator, "Sender wrong arbitrator");
        require(
            claimState.status == ClaimStatus.DisputeCreated,
            "No dispute to be resolved"
        );
        require(
            claimState.updateTime + arbitratorResponsePeriod > block.timestamp,
            "Too late to resolve dispute"
        );
        if (result == ArbitratorDecision.DoNotPay) {
            claimState.status = ClaimStatus.DisputeResolvedWithoutPayout;
            emit ResolvedDisputeByRejectingClaim(
                claimHash,
                claimant,
                msg.sender
            );
        } else if (result == ArbitratorDecision.PayClaim) {
            claimState.status = ClaimStatus.DisputeResolvedWithClaimPayout;
            uint224 clippedPayoutAmountInUsd = updatePolicyCoverage(
                policyHash,
                claimAmountInUsd
            );
            clippedPayoutAmountInApi3 = uint224(
                ICurrencyConverter(api3UsdAmountConverter).convertQuoteToBase(
                    clippedPayoutAmountInUsd
                )
            );
            recordUsage(msg.sender, clippedPayoutAmountInApi3);
            emit ResolvedDisputeByAcceptingClaim(
                claimHash,
                claimant,
                beneficiary,
                clippedPayoutAmountInUsd,
                clippedPayoutAmountInApi3,
                msg.sender
            );
            IApi3Pool(api3Pool).payOutClaim(
                beneficiary,
                clippedPayoutAmountInApi3
            );
        } else {
            uint224 settlementAmountInUsd = claimHashToProposedSettlementAmountInUsd[
                    claimHash
                ];
            if (settlementAmountInUsd == 0) {
                claimState.status = ClaimStatus.DisputeResolvedWithoutPayout;
                emit ResolvedDisputeByRejectingClaim(
                    claimHash,
                    claimant,
                    msg.sender
                );
            } else {
                claimState.status = ClaimStatus
                    .DisputeResolvedWithSettlementPayout;
                uint224 clippedPayoutAmountInUsd = updatePolicyCoverage(
                    policyHash,
                    settlementAmountInUsd
                );
                clippedPayoutAmountInApi3 = uint224(
                    ICurrencyConverter(api3UsdAmountConverter)
                        .convertQuoteToBase(clippedPayoutAmountInUsd)
                );
                recordUsage(msg.sender, clippedPayoutAmountInApi3);
                emit ResolvedDisputeByAcceptingSettlement(
                    claimHash,
                    claimant,
                    beneficiary,
                    clippedPayoutAmountInUsd,
                    clippedPayoutAmountInApi3,
                    msg.sender
                );
                IApi3Pool(api3Pool).payOutClaim(
                    beneficiary,
                    clippedPayoutAmountInApi3
                );
            }
        }
    }

    function isMediatorOrAdmin(address account)
        public
        view
        override
        returns (bool)
    {
        return
            IAccessControlRegistry(accessControlRegistry).hasRole(
                mediatorRole,
                account
            ) || isAdmin(account);
    }

    function isAdmin(address account) private view returns (bool) {
        return
            manager == account ||
            IAccessControlRegistry(accessControlRegistry).hasRole(
                adminRole,
                account
            );
    }

    function _setApi3Pool(address _api3Pool) private {
        require(_api3Pool != address(0), "Api3Pool address zero");
        api3Pool = _api3Pool;
        emit SetApi3Pool(_api3Pool, msg.sender);
    }

    function _setMediatorResponsePeriod(uint32 _mediatorResponsePeriod)
        internal
    {
        require(_mediatorResponsePeriod != 0, "Mediator response period zero");
        mediatorResponsePeriod = _mediatorResponsePeriod;
        emit SetMediatorResponsePeriod(_mediatorResponsePeriod, msg.sender);
    }

    function _setClaimantResponsePeriod(uint32 _claimantResponsePeriod)
        internal
    {
        require(_claimantResponsePeriod != 0, "Claimant response period zero");
        claimantResponsePeriod = _claimantResponsePeriod;
        emit SetClaimantResponsePeriod(_claimantResponsePeriod, msg.sender);
    }

    function _setArbitratorResponsePeriod(uint32 _arbitratorResponsePeriod)
        internal
    {
        require(
            _arbitratorResponsePeriod != 0,
            "Arbitrator response period zero"
        );
        arbitratorResponsePeriod = _arbitratorResponsePeriod;
        emit SetArbitratorResponsePeriod(_arbitratorResponsePeriod, msg.sender);
    }

    function updatePolicyCoverage(bytes32 policyHash, uint224 payoutAmountInUsd)
        private
        returns (uint224 clippedPayoutAmountInUsd)
    {
        uint224 remainingCoverageAmountInUsd = policyHashToState[policyHash]
            .coverageAmountInUsd;
        clippedPayoutAmountInUsd = payoutAmountInUsd >
            remainingCoverageAmountInUsd
            ? remainingCoverageAmountInUsd
            : payoutAmountInUsd;
        policyHashToState[policyHash]
            .coverageAmountInUsd -= clippedPayoutAmountInUsd;
    }
}
