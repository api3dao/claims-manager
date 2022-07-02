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
        address claimant;
        address beneficiary;
        uint256 amountInUsd;
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
        uint256 amountInApi3;
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
    mapping(uint256 => uint256)
        public
        override claimIndexToProposedSettlementAmountInApi3;
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

    function setApi3ToUsdReader(address _api3ToUsdReader) external override {
        require(manager == msg.sender, "Sender not manager");
        require(_api3ToUsdReader != address(0), "Api3ToUsdReader address zero");
        api3ToUsdReader = _api3ToUsdReader;
        emit SetApi3ToUsdReader(_api3ToUsdReader);
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
        uint256 amountInApi3
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
        string calldata policy
    ) external override returns (bytes32 policyHash) {
        require(
            hasPolicyCreatorRoleOrIsManager(msg.sender),
            "Sender cannot create policy"
        );
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
        require(
            policyHashToRemainingCoverageAmountInUsd[policyHash] > 0,
            "Policy has no coverage"
        );
        require(claimAmountInUsd != 0, "Claim amount zero");
        require(bytes(evidence).length != 0, "Evidence address empty");
        require(
            claimAmountInUsd <= coverageAmountInUsd,
            "Claim larger than coverage"
        );
        require(block.timestamp >= claimsAllowedFrom, "Claims not allowed yet");
        require(
            block.timestamp <= claimsAllowedUntil,
            "Claims not allowed anymore"
        );
        claimIndex = claimCount++;
        claims[claimIndex] = Claim({
            policyHash: policyHash,
            claimant: msg.sender,
            beneficiary: beneficiary,
            amountInUsd: claimAmountInUsd,
            evidence: evidence,
            updateTime: block.timestamp,
            status: ClaimStatus.ClaimCreated
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

    function acceptClaim(uint256 claimIndex) external override {
        require(
            hasMediatorRoleOrIsManager(msg.sender),
            "Sender cannot accept claim"
        );
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
        uint256 amountInApi3 = convertUsdToApi3(claim.amountInUsd);
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
    {
        require(
            hasMediatorRoleOrIsManager(msg.sender),
            "Sender cannot propose settlement"
        );
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
        claim.updateTime = block.timestamp;
        uint256 amountInApi3 = convertUsdToApi3(amountInUsd);
        claimIndexToProposedSettlementAmountInUsd[claimIndex] = amountInUsd;
        claimIndexToProposedSettlementAmountInApi3[claimIndex] = amountInApi3;
        updateQuotaUsage(msg.sender, amountInApi3);
        emit ProposedSettlement(
            claimIndex,
            claim.claimant,
            amountInUsd,
            amountInApi3,
            msg.sender
        );
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
        uint256 settlementAmountInApi3 = claimIndexToProposedSettlementAmountInApi3[
                claimIndex
            ];
        emit AcceptedSettlement(claimIndex, claimant, settlementAmountInApi3);
        IApi3Pool(api3Pool).payOutClaim(
            claim.beneficiary,
            settlementAmountInApi3
        );
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
            uint256 amountInApi3 = convertUsdToApi3(claim.amountInUsd);
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
                uint256 amountInApi3 = convertUsdToApi3(settlementAmountInUsd);
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
                fromTimestamp: block.timestamp,
                value: accumulatedQuotaUsage
            })
        );
        require(
            getQuotaUsage(account) <= accountToQuota[account].amountInApi3,
            "Quota exceeded"
        );
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
