//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@api3/airnode-protocol/contracts/access-control-registry/AccessControlRegistryAdminnedWithManager.sol";
import "@api3/api3-dao-contracts/contracts/interfaces/IApi3Pool.sol";
import "./interfaces/IClaimsManager.sol";

contract ClaimsManager is
    AccessControlRegistryAdminnedWithManager,
    IClaimsManager
{
    struct Claim {
        address claimant;
        address beneficiary;
        uint256 amount;
        string evidence;
        uint256 updateTime;
        ClaimStatus status;
    }

    struct Checkpoint {
        uint256 fromTimestamp;
        uint256 value;
    }

    struct Quota {
        uint256 period;
        uint256 amount;
    }

    bytes32 public immutable override policyCreatorRole;
    bytes32 public immutable override mediatorRole;
    bytes32 public immutable override arbitratorRole;

    address public override api3Pool;
    uint256 public override mediatorResponsePeriod;
    uint256 public override claimantResponsePeriod;
    mapping(address => uint256) public override arbitratorToResponsePeriod;
    mapping(address => Checkpoint[])
        public
        override accountToAccumulatedQuotaUsageCheckpoints;
    mapping(address => Quota) public override accountToQuota;

    mapping(bytes32 => bool) public override policyWithHashExists;
    uint256 public override claimCount = 0;
    mapping(uint256 => Claim) public override claims;
    mapping(uint256 => uint256)
        public
        override claimIndexToProposedSettlementAmount;
    mapping(uint256 => address) public override claimIndexToArbitrator;

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

    modifier onlyManagerOrMediator() {
        require(
            hasMediatorRoleOrIsManager(msg.sender),
            "Sender cannot mediate"
        );
        _;
    }

    constructor(
        address _accessControlRegistry,
        string memory _adminRoleDescription,
        address _manager,
        address _api3Pool,
        uint256 _mediatorResponsePeriod,
        uint256 _claimantResponsePeriod
    )
        AccessControlRegistryAdminnedWithManager(
            _accessControlRegistry,
            _adminRoleDescription,
            _manager
        )
    {
        policyCreatorRole = _deriveRole(
            adminRole,
            keccak256(abi.encodePacked("Policy creator"))
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
    }

    function setApi3Pool(address _api3Pool) external override {
        require(manager == msg.sender, "Sender not manager");
        _setApi3Pool(_api3Pool);
    }

    function setMediatorResponsePeriod(uint256 _mediatorResponsePeriod)
        external
        override
        onlyManagerOrAdmin
    {
        _setMediatorResponsePeriod(_mediatorResponsePeriod);
    }

    function setClaimantResponsePeriod(uint256 _claimantResponsePeriod)
        external
        override
        onlyManagerOrAdmin
    {
        _setClaimantResponsePeriod(_claimantResponsePeriod);
    }

    function setArbitratorResponsePeriod(
        address arbitrator,
        uint256 arbitratorResponsePeriod
    ) external override onlyManagerOrAdmin {
        _setArbitratorResponsePeriod(arbitrator, arbitratorResponsePeriod);
    }

    // Allows setting a quota that is currently exceeded
    function setQuota(
        address account,
        uint256 period,
        uint256 amount
    ) external override onlyManagerOrAdmin {
        require(account != address(0), "Account address zero");
        require(period != 0, "Quota period zero");
        require(amount != 0, "Quota amount zero");
        accountToQuota[account] = Quota({period: period, amount: amount});
        emit SetQuota(account, period, amount, msg.sender);
    }

    // Means the account will not be limited
    function resetQuota(address account) external override onlyManagerOrAdmin {
        require(account != address(0), "Account address zero");
        accountToQuota[account] = Quota({period: 0, amount: 0});
        emit ResetQuota(account, msg.sender);
    }

    function createPolicy(
        address claimant,
        address beneficiary,
        uint256 coverageAmount,
        uint256 startTime,
        uint256 endTime,
        string calldata policy
    ) external override returns (bytes32 policyHash) {
        require(
            hasPolicyCreatorRoleOrIsManager(msg.sender),
            "Sender cannot create policy"
        );
        require(claimant != address(0), "Claimant address zero");
        require(beneficiary != address(0), "Beneficiary address zero");
        require(coverageAmount != 0, "Coverage amount zero");
        require(startTime != 0, "Start time zero");
        require(endTime > startTime, "Start not earlier than end");
        require(bytes(policy).length != 0, "Policy address empty");
        policyHash = keccak256(
            abi.encodePacked(
                claimant,
                beneficiary,
                coverageAmount,
                startTime,
                endTime,
                policy
            )
        );
        policyWithHashExists[policyHash] = true;
        emit CreatedPolicy(
            beneficiary,
            claimant,
            policyHash,
            coverageAmount,
            startTime,
            endTime,
            policy,
            msg.sender
        );
    }

    function createClaim(
        address beneficiary,
        uint256 coverageAmount,
        uint256 startTime,
        uint256 endTime,
        string calldata policy,
        uint256 claimAmount,
        string calldata evidence
    ) external override returns (uint256 claimIndex) {
        bytes32 policyHash = keccak256(
            abi.encodePacked(
                msg.sender,
                beneficiary,
                coverageAmount,
                startTime,
                endTime,
                policy
            )
        );
        require(policyWithHashExists[policyHash], "Policy does not exist");
        require(claimAmount != 0, "Claim amount zero");
        require(bytes(evidence).length != 0, "Evidence address empty");
        require(block.timestamp >= startTime, "Policy not active yet");
        require(block.timestamp <= endTime, "Policy expired");
        require(claimAmount <= coverageAmount, "Claim larger than coverage");
        claimIndex = claimCount++;
        claims[claimIndex] = Claim({
            claimant: msg.sender,
            beneficiary: beneficiary,
            amount: claimAmount,
            evidence: evidence,
            updateTime: block.timestamp,
            status: ClaimStatus.ClaimCreated
        });
        emit CreatedClaim(
            claimIndex,
            msg.sender,
            policyHash,
            beneficiary,
            coverageAmount,
            startTime,
            endTime,
            policy,
            claimAmount,
            evidence,
            block.timestamp
        );
    }

    function acceptClaim(uint256 claimIndex)
        external
        override
        onlyManagerOrMediator
    {
        Claim storage claim = claims[claimIndex];
        require(
            claim.status == ClaimStatus.ClaimCreated,
            "Claim is not acceptable"
        );
        require(
            claim.updateTime + mediatorResponsePeriod > block.timestamp,
            "Too late to accept"
        );
        claim.status = ClaimStatus.ClaimAccepted;
        updateQuotaUsage(msg.sender, claim.amount);
        address beneficiary = claim.beneficiary;
        uint256 amount = claim.amount;
        emit AcceptedClaim(
            claimIndex,
            claim.claimant,
            beneficiary,
            amount,
            msg.sender
        );
        IApi3Pool(api3Pool).payOutClaim(beneficiary, amount);
    }

    function proposeSettlement(uint256 claimIndex, uint256 amount)
        external
        override
        onlyManagerOrMediator
    {
        require(amount != 0, "Settlement amount zero");
        Claim storage claim = claims[claimIndex];
        require(
            claim.status == ClaimStatus.ClaimCreated,
            "Claim is not settleable"
        );
        require(
            claim.updateTime + mediatorResponsePeriod > block.timestamp,
            "Too late to propose settlement"
        );
        require(amount < claim.amount, "Settlement amount not smaller");
        claim.status = ClaimStatus.SettlementProposed;
        claim.updateTime = block.timestamp;
        claimIndexToProposedSettlementAmount[claimIndex] = amount;
        updateQuotaUsage(msg.sender, amount);
        emit ProposedSettlement(claimIndex, claim.claimant, amount, msg.sender);
    }

    function acceptSettlement(uint256 claimIndex) external override {
        Claim storage claim = claims[claimIndex];
        address claimant = claim.claimant;
        require(msg.sender == claimant, "Sender not claimant");
        require(
            claim.status == ClaimStatus.SettlementProposed,
            "No settlement to accept"
        );
        require(
            claim.updateTime + claimantResponsePeriod > block.timestamp,
            "Too late to accept settlement"
        );
        claim.status = ClaimStatus.SettlementAccepted;
        uint256 settlementAmount = claimIndexToProposedSettlementAmount[
            claimIndex
        ];
        emit AcceptedSettlement(claimIndex, claimant, settlementAmount);
        IApi3Pool(api3Pool).payOutClaim(claim.beneficiary, settlementAmount);
    }

    function createDispute(uint256 claimIndex, address arbitrator)
        public
        virtual
        override
    {
        Claim storage claim = claims[claimIndex];
        require(msg.sender == claim.claimant, "Sender not claimant");
        if (claim.status == ClaimStatus.ClaimCreated) {
            require(
                claim.updateTime + mediatorResponsePeriod <= block.timestamp,
                "Awaiting mediator response"
            );
            require(
                claim.updateTime +
                    mediatorResponsePeriod +
                    claimantResponsePeriod >
                    block.timestamp,
                "Too late to create dispute"
            );
        } else if (claim.status == ClaimStatus.SettlementProposed) {
            require(
                claim.updateTime + claimantResponsePeriod > block.timestamp,
                "Too late to create dispute"
            );
        } else {
            revert("Claim is not disputable");
        }

        require(hasArbitratorRole(arbitrator), "Arbitrator lacks role");
        require(
            arbitratorToResponsePeriod[arbitrator] > 0,
            "Arbitrator response period zero"
        );
        claim.status = ClaimStatus.DisputeCreated;
        claim.updateTime = block.timestamp;
        claimIndexToArbitrator[claimIndex] = arbitrator;
        emit CreatedDispute(claimIndex, msg.sender, arbitrator);
    }

    function resolveDispute(uint256 claimIndex, ArbitratorDecision result)
        public
        virtual
        override
    {
        require(hasArbitratorRole(msg.sender), "Sender lacks arbitrator role");
        require(
            msg.sender == claimIndexToArbitrator[claimIndex],
            "Sender wrong arbitrator"
        );
        Claim storage claim = claims[claimIndex];
        require(
            claim.status == ClaimStatus.DisputeCreated,
            "No dispute to be resolved"
        );
        require(
            claim.updateTime + arbitratorToResponsePeriod[msg.sender] >
                block.timestamp,
            "Too late to resolve dispute"
        );
        if (result == ArbitratorDecision.DoNotPay) {
            claim.status = ClaimStatus.DisputeResolvedWithoutPayout;
            emit ResolvedDisputeByRejectingClaim(
                claimIndex,
                claim.claimant,
                msg.sender
            );
        } else if (result == ArbitratorDecision.PayClaim) {
            claim.status = ClaimStatus.DisputeResolvedWithClaimPayout;
            uint256 claimAmount = claim.amount;
            updateQuotaUsage(msg.sender, claimAmount);
            emit ResolvedDisputeByAcceptingClaim(
                claimIndex,
                claim.claimant,
                claim.beneficiary,
                claimAmount,
                msg.sender
            );
            IApi3Pool(api3Pool).payOutClaim(claim.beneficiary, claimAmount);
        } else if (result == ArbitratorDecision.PaySettlement) {
            claim.status = ClaimStatus.DisputeResolvedWithSettlementPayout;
            uint256 settlementAmount = claimIndexToProposedSettlementAmount[
                claimIndex
            ];
            if (settlementAmount == 0) {
                emit ResolvedDisputeByRejectingClaim(
                    claimIndex,
                    claim.claimant,
                    msg.sender
                );
            } else {
                updateQuotaUsage(msg.sender, settlementAmount);
                emit ResolvedDisputeByAcceptingSettlement(
                    claimIndex,
                    claim.claimant,
                    claim.beneficiary,
                    settlementAmount,
                    msg.sender
                );
                IApi3Pool(api3Pool).payOutClaim(
                    claim.beneficiary,
                    settlementAmount
                );
            }
        }
    }

    function timeOutClaim(uint256 claimIndex) external override {
        Claim storage claim = claims[claimIndex];
        ClaimStatus status = claim.status;
        if (status == ClaimStatus.ClaimCreated) {
            require(
                claim.updateTime +
                    mediatorResponsePeriod +
                    claimantResponsePeriod <=
                    block.timestamp,
                "Awaiting claimant response"
            );
        } else if (status == ClaimStatus.SettlementProposed) {
            require(
                claim.updateTime + claimantResponsePeriod <= block.timestamp,
                "Awaiting claimant response"
            );
        } else if (status == ClaimStatus.DisputeCreated) {
            require(
                claim.updateTime +
                    arbitratorToResponsePeriod[
                        claimIndexToArbitrator[claimIndex]
                    ] <=
                    block.timestamp,
                "Awaiting arbitrator response"
            );
        } else {
            revert("Claim cannot be timed out");
        }
        claim.status = ClaimStatus.TimedOut;
        emit TimedOutClaim(claimIndex, claim.claimant);
    }

    function hasPolicyCreatorRoleOrIsManager(address account)
        public
        view
        override
        returns (bool)
    {
        return
            manager == account ||
            IAccessControlRegistry(accessControlRegistry).hasRole(
                policyCreatorRole,
                account
            );
    }

    function hasMediatorRoleOrIsManager(address account)
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

    function hasArbitratorRole(address account)
        public
        view
        override
        returns (bool)
    {
        return
            IAccessControlRegistry(accessControlRegistry).hasRole(
                arbitratorRole,
                account
            );
    }

    function getQuotaUsage(address account)
        public
        view
        override
        returns (uint256)
    {
        Checkpoint[]
            storage accumulatedQuotaUsageCheckpoints = accountToAccumulatedQuotaUsageCheckpoints[
                account
            ];
        uint256 accumulatedQuotaUsage = 0;
        if (accumulatedQuotaUsageCheckpoints.length > 0) {
            accumulatedQuotaUsage = accumulatedQuotaUsageCheckpoints[
                accumulatedQuotaUsageCheckpoints.length - 1
            ].value;
        }
        uint256 accumulatedQuotaUsageThen = getValueAt(
            accumulatedQuotaUsageCheckpoints,
            block.timestamp - accountToQuota[account].period
        );
        return accumulatedQuotaUsage - accumulatedQuotaUsageThen;
    }

    function _setApi3Pool(address _api3Pool) private {
        require(_api3Pool != address(0), "Api3Pool address zero");
        api3Pool = _api3Pool;
        emit SetApi3Pool(_api3Pool);
    }

    function _setMediatorResponsePeriod(uint256 _mediatorResponsePeriod)
        internal
    {
        require(_mediatorResponsePeriod != 0, "Mediator response period zero");
        mediatorResponsePeriod = _mediatorResponsePeriod;
        emit SetMediatorResponsePeriod(_mediatorResponsePeriod);
    }

    function _setClaimantResponsePeriod(uint256 _claimantResponsePeriod)
        internal
    {
        require(_claimantResponsePeriod != 0, "Claimant response period zero");
        claimantResponsePeriod = _claimantResponsePeriod;
        emit SetClaimantResponsePeriod(_claimantResponsePeriod);
    }

    function _setArbitratorResponsePeriod(
        address arbitrator,
        uint256 arbitratorResponsePeriod
    ) internal {
        require(arbitrator != address(0), "Arbitrator address zero");
        require(
            arbitratorResponsePeriod != 0,
            "Arbitrator response period zero"
        );
        arbitratorToResponsePeriod[arbitrator] = arbitratorResponsePeriod;
        emit SetArbitratorResponsePeriod(
            arbitrator,
            arbitratorResponsePeriod,
            msg.sender
        );
    }

    function updateQuotaUsage(address account, uint256 amount) private {
        Checkpoint[]
            storage accumulatedQuotaUsageCheckpoints = accountToAccumulatedQuotaUsageCheckpoints[
                account
            ];
        uint256 accumulatedQuotaUsage = amount;
        if (accumulatedQuotaUsageCheckpoints.length > 0) {
            accumulatedQuotaUsage += accumulatedQuotaUsageCheckpoints[
                accumulatedQuotaUsageCheckpoints.length - 1
            ].value;
        }
        accumulatedQuotaUsageCheckpoints.push(
            Checkpoint({
                fromTimestamp: block.timestamp,
                value: accumulatedQuotaUsage
            })
        );
        require(
            getQuotaUsage(account) <= accountToQuota[account].amount,
            "Quota exceeded"
        );
    }

    function getValueAt(Checkpoint[] storage checkpoints, uint256 _timestamp)
        private
        view
        returns (uint256)
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
