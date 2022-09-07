//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@api3/airnode-protocol-v1/contracts/access-control-registry/AccessControlRegistryAdminnedWithManager.sol";
import "@api3/api3-dao-contracts/contracts/interfaces/IApi3Pool.sol";
import "./interfaces/IApi3ToUsdReader.sol";
import "./interfaces/IClaimsManager.sol";

contract ClaimsManager is
    AccessControlRegistryAdminnedWithManager,
    IClaimsManager
{
    struct ClaimState {
        ClaimStatus status;
        uint32 updateTime;
        address arbitrator;
    }

    struct Checkpoint {
        uint32 fromTimestamp;
        uint224 value;
    }

    struct Quota {
        uint32 period;
        uint224 amountInApi3;
    }

    struct PolicyState {
        uint32 claimsAllowedUntil;
        uint224 coverageAmountInUsd;
    }

    bytes32 public immutable override policyAgentRole;
    bytes32 public immutable override mediatorRole;
    bytes32 public immutable override arbitratorRole;

    address public override api3ToUsdReader;
    address public override api3Pool;
    uint32 public override mediatorResponsePeriod;
    uint32 public override claimantResponsePeriod;
    uint32 public override arbitratorResponsePeriod;
    mapping(address => Checkpoint[])
        public
        override accountToAccumulatedQuotaUsageCheckpoints;
    mapping(address => Quota) public override accountToQuota;

    mapping(bytes32 => PolicyState) public override policyHashToState;
    mapping(bytes32 => ClaimState) public override claimHashToState;
    mapping(bytes32 => uint224)
        public
        override claimHashToProposedSettlementAmountInUsd;

    modifier onlyManagerOrAdmin() {
        require(
            manager == msg.sender ||
                IAccessControlRegistry(accessControlRegistry).hasRole(
                    adminRole,
                    msg.sender
                ),
            "Sender cannot administrate"
        );
        _;
    }

    modifier onlyManagerOrPolicyAgent() {
        require(
            manager == msg.sender ||
                IAccessControlRegistry(accessControlRegistry).hasRole(
                    policyAgentRole,
                    msg.sender
                ),
            "Sender cannot manage policy"
        );
        _;
    }

    modifier onlyManagerOrMediator() {
        require(isManagerOrMediator(msg.sender), "Sender cannot mediate");
        _;
    }

    modifier onlyManagerOrArbitrator() {
        require(
            manager == msg.sender ||
                IAccessControlRegistry(accessControlRegistry).hasRole(
                    arbitratorRole,
                    msg.sender
                ),
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

    function setApi3ToUsdReader(address _api3ToUsdReader)
        external
        override
        onlyManagerOrAdmin
    {
        require(_api3ToUsdReader != address(0), "Api3ToUsdReader address zero");
        api3ToUsdReader = _api3ToUsdReader;
        emit SetApi3ToUsdReader(_api3ToUsdReader, msg.sender);
    }

    function setApi3Pool(address _api3Pool)
        external
        override
        onlyManagerOrAdmin
    {
        _setApi3Pool(_api3Pool);
    }

    function setMediatorResponsePeriod(uint32 _mediatorResponsePeriod)
        external
        override
        onlyManagerOrAdmin
    {
        _setMediatorResponsePeriod(_mediatorResponsePeriod);
    }

    function setClaimantResponsePeriod(uint32 _claimantResponsePeriod)
        external
        override
        onlyManagerOrAdmin
    {
        _setClaimantResponsePeriod(_claimantResponsePeriod);
    }

    function setArbitratorResponsePeriod(uint32 _arbitratorResponsePeriod)
        external
        override
        onlyManagerOrAdmin
    {
        _setArbitratorResponsePeriod(_arbitratorResponsePeriod);
    }

    // Allows setting a quota that is currently exceeded
    function setQuota(
        address account,
        uint32 period,
        uint224 amountInApi3
    ) external override onlyManagerOrAdmin {
        require(account != address(0), "Account address zero");
        require(period != 0, "Quota period zero");
        require(amountInApi3 != 0, "Quota amount zero");
        accountToQuota[account] = Quota({
            period: period,
            amountInApi3: amountInApi3
        });
        emit SetQuota(account, period, amountInApi3, msg.sender);
    }

    // Means the account will not be limited
    function resetQuota(address account) external override onlyManagerOrAdmin {
        require(account != address(0), "Account address zero");
        accountToQuota[account] = Quota({period: 0, amountInApi3: 0});
        emit ResetQuota(account, msg.sender);
    }

    // block.timestamp is irrelevant, we don't validate against that on purpose
    function createPolicy(
        address claimant,
        address beneficiary,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string calldata policy,
        string calldata metadata
    ) external override onlyManagerOrPolicyAgent returns (bytes32 policyHash) {
        require(claimant != address(0), "Claimant address zero");
        require(beneficiary != address(0), "Beneficiary address zero");
        require(coverageAmountInUsd != 0, "Coverage amount zero");
        require(claimsAllowedFrom != 0, "Start time zero");
        require(
            claimsAllowedUntil > claimsAllowedFrom,
            "Start not earlier than end"
        );
        require(bytes(policy).length != 0, "Policy address empty");
        // metadata is allowed to be empty
        policyHash = keccak256(
            abi.encodePacked(
                claimant,
                beneficiary,
                claimsAllowedFrom,
                policy,
                metadata
            )
        );
        require(
            policyHashToState[policyHash].claimsAllowedUntil == 0,
            "Policy created before"
        );
        policyHashToState[policyHash] = PolicyState({
            claimsAllowedUntil: claimsAllowedUntil,
            coverageAmountInUsd: coverageAmountInUsd
        });
        emit CreatedPolicy(
            beneficiary,
            claimant,
            policyHash,
            coverageAmountInUsd,
            claimsAllowedFrom,
            claimsAllowedUntil,
            policy,
            metadata,
            msg.sender
        );
    }

    // Allowed to keep the values same
    function upgradePolicy(
        address claimant,
        address beneficiary,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string calldata policy,
        string calldata metadata
    ) external override onlyManagerOrPolicyAgent returns (bytes32 policyHash) {
        policyHash = keccak256(
            abi.encodePacked(
                claimant,
                beneficiary,
                claimsAllowedFrom,
                policy,
                metadata
            )
        );
        PolicyState storage policyState = policyHashToState[policyHash];
        uint32 policyStateClaimsAllowedUntil = policyState.claimsAllowedUntil;
        require(policyStateClaimsAllowedUntil != 0, "Policy does not exist");
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
            coverageAmountInUsd,
            claimsAllowedFrom,
            claimsAllowedUntil,
            policy,
            metadata,
            msg.sender
        );
    }

    function downgradePolicy(
        address claimant,
        address beneficiary,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string calldata policy,
        string calldata metadata
    ) external override returns (bytes32 policyHash) {
        require(
            claimant == msg.sender ||
                manager == msg.sender ||
                IAccessControlRegistry(accessControlRegistry).hasRole(
                    adminRole,
                    msg.sender
                ),
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
                claimsAllowedFrom,
                policy,
                metadata
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
            coverageAmountInUsd,
            claimsAllowedFrom,
            claimsAllowedUntil,
            policy,
            metadata,
            msg.sender
        );
    }

    function createClaim(
        address beneficiary,
        uint32 claimsAllowedFrom,
        string calldata policy,
        string calldata metadata,
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
                claimsAllowedFrom,
                policy,
                metadata
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
            claimsAllowedFrom,
            policy,
            metadata,
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
    ) external onlyManagerOrMediator {
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
            "Claim is not acceptable"
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
        uint224 clippedPayoutAmountInApi3 = convertUsdToApi3(
            clippedPayoutAmountInUsd
        );
        updateQuotaUsage(msg.sender, clippedPayoutAmountInApi3);
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
    ) external onlyManagerOrMediator {
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
        updateQuotaUsage(msg.sender, convertUsdToApi3(settlementAmountInUsd));
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
        address claimant,
        address beneficiary,
        uint224 claimAmountInUsd,
        string calldata evidence,
        uint224 minimumPayoutAmountInApi3
    ) external returns (uint224 clippedPayoutAmountInApi3) {
        require(msg.sender == claimant, "Sender not claimant");
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
        clippedPayoutAmountInApi3 = convertUsdToApi3(clippedPayoutAmountInUsd);
        require(
            clippedPayoutAmountInApi3 >= minimumPayoutAmountInApi3,
            "Payout less than minimum"
        );
        emit AcceptedSettlement(
            claimHash,
            claimant,
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
    ) public override onlyManagerOrArbitrator {
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
    )
        public
        onlyManagerOrArbitrator
        returns (uint224 clippedPayoutAmountInApi3)
    {
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
            clippedPayoutAmountInApi3 = convertUsdToApi3(
                clippedPayoutAmountInUsd
            );
            updateQuotaUsage(msg.sender, clippedPayoutAmountInApi3);
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
        } else if (result == ArbitratorDecision.PaySettlement) {
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
                clippedPayoutAmountInApi3 = convertUsdToApi3(
                    clippedPayoutAmountInUsd
                );
                updateQuotaUsage(msg.sender, clippedPayoutAmountInApi3);
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

    function getQuotaUsage(address account)
        public
        view
        override
        returns (uint224)
    {
        Checkpoint[]
            storage accumulatedQuotaUsageCheckpoints = accountToAccumulatedQuotaUsageCheckpoints[
                account
            ];
        uint224 accumulatedQuotaUsage = 0;
        if (accumulatedQuotaUsageCheckpoints.length > 0) {
            accumulatedQuotaUsage = accumulatedQuotaUsageCheckpoints[
                accumulatedQuotaUsageCheckpoints.length - 1
            ].value;
        }
        uint224 accumulatedQuotaUsageThen = getValueAt(
            accumulatedQuotaUsageCheckpoints,
            uint32(block.timestamp) - accountToQuota[account].period
        );
        return accumulatedQuotaUsage - accumulatedQuotaUsageThen;
    }

    function isManagerOrMediator(address account)
        public
        view
        override
        returns (bool)
    {
        return
            manager == account ||
            IAccessControlRegistry(accessControlRegistry).hasRole(
                mediatorRole,
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

    function updateQuotaUsage(address account, uint224 amountInApi3) private {
        Checkpoint[]
            storage accumulatedQuotaUsageCheckpoints = accountToAccumulatedQuotaUsageCheckpoints[
                account
            ];
        uint224 accumulatedQuotaUsage = amountInApi3;
        if (accumulatedQuotaUsageCheckpoints.length > 0) {
            accumulatedQuotaUsage += accumulatedQuotaUsageCheckpoints[
                accumulatedQuotaUsageCheckpoints.length - 1
            ].value;
        }
        accumulatedQuotaUsageCheckpoints.push(
            Checkpoint({
                fromTimestamp: uint32(block.timestamp),
                value: accumulatedQuotaUsage
            })
        );
        require(
            getQuotaUsage(account) <= accountToQuota[account].amountInApi3,
            "Quota exceeded"
        );
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

    // Assuming the API3/USD rate has 18 decimals
    function convertUsdToApi3(uint224 amountInUsd)
        private
        view
        returns (uint224 amountInApi3)
    {
        require(api3ToUsdReader != address(0), "Api3ToUsdReader not set");
        int224 signedApi3ToUsd = IApi3ToUsdReader(api3ToUsdReader).read();
        require(signedApi3ToUsd > 0, "Invalid API3 to USD");
        amountInApi3 = (amountInUsd * uint224(signedApi3ToUsd)) / 10**18;
    }

    function getValueAt(Checkpoint[] storage checkpoints, uint32 _timestamp)
        private
        view
        returns (uint224)
    {
        if (checkpoints.length == 0) return 0;

        // Shortcut for the actual value
        if (_timestamp >= checkpoints[checkpoints.length - 1].fromTimestamp)
            return checkpoints[checkpoints.length - 1].value;
        if (_timestamp < checkpoints[0].fromTimestamp) return 0;

        // Binary search of the value in the array
        uint256 min = 0;
        uint256 max = checkpoints.length - 1;
        while (max > min) {
            uint256 mid = (max + min + 1) / 2;
            if (checkpoints[mid].fromTimestamp <= _timestamp) {
                min = mid;
            } else {
                max = mid - 1;
            }
        }
        return checkpoints[min].value;
    }
}
