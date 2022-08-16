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
    struct Claim {
        bytes32 policyHash;
        ClaimStatus status;
        address claimant;
        address beneficiary;
        uint32 updateTime;
        uint256 amountInUsd;
        string evidence;
    }

    struct Checkpoint {
        uint32 fromTimestamp;
        uint224 value;
    }

    struct Quota {
        uint32 period;
        uint224 amountInApi3;
    }

    bytes32 public immutable override policyCreatorRole;
    bytes32 public immutable override mediatorRole;
    bytes32 public immutable override arbitratorRole;

    address public override api3ToUsdReader;
    address public override api3Pool;
    uint256 public override mediatorResponsePeriod;
    uint256 public override claimantResponsePeriod;
    mapping(address => uint256) public override arbitratorToResponsePeriod;
    mapping(address => Checkpoint[])
        public
        override accountToAccumulatedQuotaUsageCheckpoints;
    mapping(address => Quota) public override accountToQuota;

    mapping(bytes32 => uint256)
        public
        override policyHashToRemainingCoverageAmountInUsd;
    uint256 public override claimCount = 0;
    mapping(uint256 => Claim) public override claims;
    mapping(uint256 => uint256)
        public
        override claimIndexToProposedSettlementAmountInUsd;
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

    modifier onlyManagerOrPolicyCreator() {
        require(
            manager == msg.sender ||
                IAccessControlRegistry(accessControlRegistry).hasRole(
                    policyCreatorRole,
                    msg.sender
                ),
            "Sender cannot create policy"
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

    function setApi3ToUsdReader(address _api3ToUsdReader)
        external
        override
        onlyManagerOrAdmin
    {
        require(_api3ToUsdReader != address(0), "Api3ToUsdReader address zero");
        api3ToUsdReader = _api3ToUsdReader;
        emit SetApi3ToUsdReader(_api3ToUsdReader);
    }

    function setApi3Pool(address _api3Pool)
        external
        override
        onlyManagerOrAdmin
    {
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

    function createPolicy(
        address claimant,
        address beneficiary,
        uint256 coverageAmountInUsd,
        uint256 claimsAllowedFrom,
        uint256 claimsAllowedUntil,
        string calldata policy,
        string calldata metadata
    )
        external
        override
        onlyManagerOrPolicyCreator
        returns (bytes32 policyHash)
    {
        require(claimant != address(0), "Claimant address zero");
        require(beneficiary != address(0), "Beneficiary address zero");
        require(coverageAmountInUsd != 0, "Coverage amount zero");
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
                coverageAmountInUsd,
                claimsAllowedFrom,
                claimsAllowedUntil,
                policy
            )
        );
        policyHashToRemainingCoverageAmountInUsd[
            policyHash
        ] = coverageAmountInUsd;
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

    function createClaim(
        address beneficiary,
        uint256 coverageAmountInUsd,
        uint256 claimsAllowedFrom,
        uint256 claimsAllowedUntil,
        string calldata policy,
        uint256 claimAmountInUsd,
        string calldata evidence
    ) external override returns (uint256 claimIndex) {
        bytes32 policyHash = keccak256(
            abi.encodePacked(
                msg.sender,
                beneficiary,
                coverageAmountInUsd,
                claimsAllowedFrom,
                claimsAllowedUntil,
                policy
            )
        );
        require(claimAmountInUsd != 0, "Claim amount zero");
        require(bytes(evidence).length != 0, "Evidence address empty");
        require(
            claimAmountInUsd <=
                policyHashToRemainingCoverageAmountInUsd[policyHash],
            "Claim larger than coverage"
        );
        require(block.timestamp >= claimsAllowedFrom, "Claims not allowed yet");
        require(
            block.timestamp <= claimsAllowedUntil,
            "Claims not allowed anymore"
        );
        claimIndex = ++claimCount;
        claims[claimIndex] = Claim({
            policyHash: policyHash,
            status: ClaimStatus.ClaimCreated,
            claimant: msg.sender,
            beneficiary: beneficiary,
            updateTime: uint32(block.timestamp),
            amountInUsd: claimAmountInUsd,
            evidence: evidence
        });
        emit CreatedClaim(
            claimIndex,
            msg.sender,
            policyHash,
            beneficiary,
            coverageAmountInUsd,
            claimsAllowedFrom,
            claimsAllowedUntil,
            policy,
            claimAmountInUsd,
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
            "Too late to accept claim"
        );
        claim.status = ClaimStatus.ClaimAccepted;
        uint256 clippedAmountInUsd = updatePolicyCoverage(
            claim.policyHash,
            claim.amountInUsd
        );
        uint256 amountInApi3 = convertUsdToApi3(clippedAmountInUsd);
        updateQuotaUsage(msg.sender, amountInApi3);
        address beneficiary = claim.beneficiary;
        emit AcceptedClaim(
            claimIndex,
            claim.claimant,
            beneficiary,
            amountInApi3,
            msg.sender
        );
        IApi3Pool(api3Pool).payOutClaim(beneficiary, amountInApi3);
    }

    function proposeSettlement(uint256 claimIndex, uint256 amountInUsd)
        external
        override
        onlyManagerOrMediator
    {
        require(amountInUsd != 0, "Settlement amount zero");
        Claim storage claim = claims[claimIndex];
        require(
            claim.status == ClaimStatus.ClaimCreated,
            "Claim is not settleable"
        );
        require(
            claim.updateTime + mediatorResponsePeriod > block.timestamp,
            "Too late to propose settlement"
        );
        require(
            amountInUsd < claim.amountInUsd,
            "Settlement amount not smaller"
        );
        claim.status = ClaimStatus.SettlementProposed;
        claim.updateTime = uint32(block.timestamp);
        // The mediator quota in API3 has to be updated here
        // We're pessimistically using the unclipped amount
        // Current price has to be used as an approximation
        updateQuotaUsage(msg.sender, convertUsdToApi3(amountInUsd));
        claimIndexToProposedSettlementAmountInUsd[claimIndex] = amountInUsd;
        emit ProposedSettlement(
            claimIndex,
            claim.claimant,
            amountInUsd,
            msg.sender
        );
    }

    // The user can do a static call to this function to see how much API3 they will receive
    function acceptSettlement(uint256 claimIndex)
        external
        override
        returns (uint256 clippedAmountInApi3)
    {
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
        // If settlement amount in USD causes the policy coverage to be exceeded, clip the API3 amount being paid out
        uint256 settlementAmountInUsd = claimIndexToProposedSettlementAmountInUsd[
                claimIndex
            ];
        uint256 clippedAmountInUsd = updatePolicyCoverage(
            claim.policyHash,
            settlementAmountInUsd
        );
        clippedAmountInApi3 = convertUsdToApi3(clippedAmountInUsd);
        emit AcceptedSettlement(claimIndex, claimant, clippedAmountInApi3);
        IApi3Pool(api3Pool).payOutClaim(claim.beneficiary, clippedAmountInApi3);
    }

    function createDispute(uint256 claimIndex)
        public
        virtual
        override
        onlyManagerOrArbitrator
    {
        require(
            arbitratorToResponsePeriod[msg.sender] > 0,
            "Arbitrator response period zero"
        );
        Claim storage claim = claims[claimIndex];
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
        claim.status = ClaimStatus.DisputeCreated;
        claim.updateTime = uint32(block.timestamp);
        claimIndexToArbitrator[claimIndex] = msg.sender;
        emit CreatedDispute(claimIndex, claim.claimant, msg.sender);
    }

    function resolveDispute(uint256 claimIndex, ArbitratorDecision result)
        public
        virtual
        override
        onlyManagerOrArbitrator
    {
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
            uint256 clippedAmountInUsd = updatePolicyCoverage(
                claim.policyHash,
                claim.amountInUsd
            );
            uint256 amountInApi3 = convertUsdToApi3(clippedAmountInUsd);
            updateQuotaUsage(msg.sender, amountInApi3);
            emit ResolvedDisputeByAcceptingClaim(
                claimIndex,
                claim.claimant,
                claim.beneficiary,
                amountInApi3,
                msg.sender
            );
            IApi3Pool(api3Pool).payOutClaim(claim.beneficiary, amountInApi3);
        } else if (result == ArbitratorDecision.PaySettlement) {
            uint256 settlementAmountInUsd = claimIndexToProposedSettlementAmountInUsd[
                    claimIndex
                ];
            if (settlementAmountInUsd == 0) {
                claim.status = ClaimStatus.DisputeResolvedWithoutPayout;
                emit ResolvedDisputeByRejectingClaim(
                    claimIndex,
                    claim.claimant,
                    msg.sender
                );
            } else {
                claim.status = ClaimStatus.DisputeResolvedWithSettlementPayout;
                uint256 clippedAmountInUsd = updatePolicyCoverage(
                    claim.policyHash,
                    settlementAmountInUsd
                );
                uint256 amountInApi3 = convertUsdToApi3(clippedAmountInUsd);
                updateQuotaUsage(msg.sender, amountInApi3);
                emit ResolvedDisputeByAcceptingSettlement(
                    claimIndex,
                    claim.claimant,
                    claim.beneficiary,
                    amountInApi3,
                    msg.sender
                );
                IApi3Pool(api3Pool).payOutClaim(
                    claim.beneficiary,
                    amountInApi3
                );
            }
        }
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

    function updateQuotaUsage(address account, uint256 amountInApi3) private {
        Checkpoint[]
            storage accumulatedQuotaUsageCheckpoints = accountToAccumulatedQuotaUsageCheckpoints[
                account
            ];
        uint256 accumulatedQuotaUsage = amountInApi3;
        if (accumulatedQuotaUsageCheckpoints.length > 0) {
            accumulatedQuotaUsage += accumulatedQuotaUsageCheckpoints[
                accumulatedQuotaUsageCheckpoints.length - 1
            ].value;
        }
        accumulatedQuotaUsageCheckpoints.push(
            Checkpoint({
                fromTimestamp: uint32(block.timestamp),
                value: uint224(accumulatedQuotaUsage)
            })
        );
        require(
            getQuotaUsage(account) <= accountToQuota[account].amountInApi3,
            "Quota exceeded"
        );
    }

    function updatePolicyCoverage(bytes32 policyHash, uint256 amountInUsd)
        private
        returns (uint256 clippedAmountInUsd)
    {
        uint256 remainingCoverageAmountInUsd = policyHashToRemainingCoverageAmountInUsd[
                policyHash
            ];
        clippedAmountInUsd = amountInUsd > remainingCoverageAmountInUsd
            ? remainingCoverageAmountInUsd
            : amountInUsd;
        policyHashToRemainingCoverageAmountInUsd[
            policyHash
        ] -= clippedAmountInUsd;
    }

    // Assuming the API3/USD rate has 18 decimals
    function convertUsdToApi3(uint256 amountInUsd)
        private
        view
        returns (uint256 amountInApi3)
    {
        require(api3ToUsdReader != address(0), "Api3ToUsdReader not set");
        int224 signedApi3ToUsd = IApi3ToUsdReader(api3ToUsdReader).read();
        require(signedApi3ToUsd > 0, "Invalid API3 to USD");
        amountInApi3 = (amountInUsd * uint224(signedApi3ToUsd)) / 10**18;
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
