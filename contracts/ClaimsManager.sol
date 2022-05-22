//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@api3/airnode-protocol/contracts/access-control-registry/AccessControlRegistryAdminnedWithManager.sol";
import "@api3/api3-dao-contracts/contracts/interfaces/IApi3Pool.sol";
import "./interfaces/IClaimsManager.sol";

contract ClaimsManager is
    AccessControlRegistryAdminnedWithManager,
    IClaimsManager
{
    enum ClaimStatus {
        None,
        ClaimCreated,
        ClaimAccepted,
        SettlementProposed,
        SettlementAccepted,
        DisputeCreated,
        DisputeResolved,
        TimedOut
    }

    enum ArbitratorDecision {
        DoNotPay,
        PayClaim,
        PaySettlement
    }

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

    bytes32 public immutable policyCreatorRole;
    bytes32 public immutable mediatorRole;
    bytes32 public immutable arbitratorRole;

    address public api3Pool;
    uint256 public mediatorResponsePeriod;
    uint256 public claimantResponsePeriod;
    mapping(address => uint256) public arbitratorToResponsePeriod;

    mapping(bytes32 => bool) public policyWithHashExists;
    mapping(uint256 => Claim) public claims;
    mapping(uint256 => uint256) public claimIndexToProposedSettlementAmount;
    mapping(address => Checkpoint[])
        public accountToAccumulatedInitiativeCheckpoints;
    mapping(address => Quota) public accountToQuota;
    mapping(uint256 => address) public claimIndexToArbitrator;
    uint256 public claimCount = 0;

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
            manager == msg.sender ||
                IAccessControlRegistry(accessControlRegistry).hasRole(
                    mediatorRole,
                    msg.sender
                ),
            "Sender cannot mediate"
        );
        _;
    }

    modifier onlyMediatableClaim(uint256 claimIndex) {
        Claim storage claim = claims[claimIndex];
        require(
            claim.status == ClaimStatus.ClaimCreated,
            "Claim is not mediatable"
        );
        require(
            claim.updateTime + mediatorResponsePeriod > block.timestamp,
            "Mediator response too late"
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

    function setApi3Pool(address _api3Pool) external {
        require(manager == msg.sender, "Sender not manager");
        _setApi3Pool(_api3Pool);
    }

    function setMediatorResponsePeriod(uint256 _mediatorResponsePeriod)
        external
        onlyManagerOrAdmin
    {
        _setMediatorResponsePeriod(_mediatorResponsePeriod);
    }

    function setClaimantResponsePeriod(uint256 _claimantResponsePeriod)
        external
        onlyManagerOrAdmin
    {
        _setClaimantResponsePeriod(_claimantResponsePeriod);
    }

    function setArbitratorResponsePeriod(
        address arbitrator,
        uint256 arbitratorResponsePeriod
    ) external onlyManagerOrAdmin {
        _setArbitratorResponsePeriod(arbitrator, arbitratorResponsePeriod);
    }

    // Allows setting a quota that is currently exceeded
    function setQuota(
        address account,
        uint256 period,
        uint256 amount
    ) external onlyManagerOrAdmin {
        require(account != address(0), "Account address zero");
        require(period != 0, "Initiative limit period zero");
        require(amount != 0, "Initiative limit amount zero");
        accountToQuota[account] = Quota({period: period, amount: amount});
        emit SetQuota(account, period, amount, msg.sender);
    }

    function resetQuota(address account) external onlyManagerOrAdmin {
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
    ) external returns (bytes32 policyHash) {
        require(
            manager == msg.sender ||
                IAccessControlRegistry(accessControlRegistry).hasRole(
                    policyCreatorRole,
                    msg.sender
                ),
            "Sender cannot create policy"
        );
        require(claimant != address(0), "Claimant address zero");
        require(beneficiary != address(0), "Beneficiary address zero");
        require(coverageAmount != 0, "Coverage amount zero");
        require(startTime != 0, "Start time zero");
        require(endTime > startTime, "Does not start earlier than end");
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
            policyHash,
            claimant,
            beneficiary,
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
    ) external returns (uint256 claimIndex) {
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
        onlyManagerOrMediator
        onlyMediatableClaim(claimIndex)
    {
        Claim storage claim = claims[claimIndex];
        claim.status = ClaimStatus.ClaimAccepted;
        updateAccumulatedInitiative(msg.sender, claim.amount);
        emit AcceptedClaim(
            claimIndex,
            claim.claimant,
            claim.beneficiary,
            claim.amount,
            msg.sender
        );
        IApi3Pool(api3Pool).payOutClaim(claim.beneficiary, claim.amount);
    }

    function proposeSettlement(uint256 claimIndex, uint256 amount)
        external
        onlyManagerOrMediator
        onlyMediatableClaim(claimIndex)
    {
        require(amount != 0, "Settlement amount zero");
        Claim storage claim = claims[claimIndex];
        require(amount < claim.amount, "Settlement amount not smaller");
        claim.status = ClaimStatus.SettlementProposed;
        claim.updateTime = block.timestamp;
        claimIndexToProposedSettlementAmount[claimIndex] = amount;
        updateAccumulatedInitiative(msg.sender, amount);
        emit ProposedSettlement(claimIndex, claim.claimant, amount, msg.sender);
    }

    function acceptSettlement(uint256 claimIndex) external {
        Claim storage claim = claims[claimIndex];
        require(msg.sender == claim.claimant, "Sender not claimant");
        require(
            claim.status == ClaimStatus.SettlementProposed,
            "No settlement to accept"
        );
        require(
            claim.updateTime + claimantResponsePeriod > block.timestamp,
            "Claimant too late"
        );
        claim.status = ClaimStatus.SettlementAccepted;
        uint256 settlementAmount = claimIndexToProposedSettlementAmount[
            claimIndex
        ];
        emit AcceptedSettlement(claimIndex, claim.claimant, settlementAmount);
        IApi3Pool(api3Pool).payOutClaim(claim.beneficiary, settlementAmount);
    }

    function createDispute(uint256 claimIndex, address arbitrator) public {
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
                "Claimant response too late"
            );
        } else if (claim.status == ClaimStatus.SettlementProposed) {
            require(
                claim.updateTime + claimantResponsePeriod > block.timestamp,
                "Claimant response too late"
            );
        } else {
            revert("Claim is not disputable");
        }
        require(
            IAccessControlRegistry(accessControlRegistry).hasRole(
                arbitratorRole,
                arbitrator
            ),
            "Arbitrator does not have role"
        );
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
    {
        require(
            IAccessControlRegistry(accessControlRegistry).hasRole(
                arbitratorRole,
                msg.sender
            ),
            "Sender not arbitrator"
        );
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
            "Arbitrator response too late"
        );
        claim.status = ClaimStatus.DisputeResolved;
        if (result == ArbitratorDecision.DoNotPay) {
            emit ResolvedDisputeByRejectingClaim(
                claimIndex,
                claim.claimant,
                msg.sender
            );
        } else if (result == ArbitratorDecision.PayClaim) {
            uint256 claimAmount = claim.amount;
            updateAccumulatedInitiative(msg.sender, claimAmount);
            emit ResolvedDisputeByAcceptingClaim(
                claimIndex,
                claim.claimant,
                claim.beneficiary,
                claimAmount,
                msg.sender
            );
            IApi3Pool(api3Pool).payOutClaim(claim.beneficiary, claimAmount);
        } else if (result == ArbitratorDecision.PaySettlement) {
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
                updateAccumulatedInitiative(msg.sender, settlementAmount);
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

    function timeOutClaim(uint256 claimIndex) external {
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

    function updateAccumulatedInitiative(address account, uint256 amount)
        private
    {
        Checkpoint[]
            storage accumulatedInitiativeCheckpoints = accountToAccumulatedInitiativeCheckpoints[
                account
            ];
        uint256 accumulatedInitiative = amount;
        if (accumulatedInitiativeCheckpoints.length > 0) {
            accumulatedInitiative += accumulatedInitiativeCheckpoints[
                accumulatedInitiativeCheckpoints.length - 1
            ].value;
        }
        accumulatedInitiativeCheckpoints.push(
            Checkpoint({
                fromTimestamp: block.timestamp,
                value: accumulatedInitiative
            })
        );
        Quota storage initiativeLimit = accountToQuota[account];
        uint256 accumulatedInitiativeThen = getValueAt(
            accumulatedInitiativeCheckpoints,
            block.timestamp - initiativeLimit.period
        );
        require(
            accumulatedInitiative - accumulatedInitiativeThen <=
                initiativeLimit.amount,
            "Initiative limit amount exceeded"
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
