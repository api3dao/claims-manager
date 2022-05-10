//SPDX-License-Identifier: MIT

pragma solidity >=0.8.4;

import "@api3/airnode-protocol/contracts/access-control-registry/AccessControlRegistryAdminnedWithManager.sol";

/// @title API3 Service Coverage Claims Manager
/// @notice contract manager of API3 service coverage claims process and payments, permitted to withdraw as many tokens as necessary from API3's staking pool to satisfy successful valid claims on service coverage
/// @dev the primary DAO Agent must call setClaimsManagerStatus(coverageClaimManager, true) so this contract will satisfy the onlyClaimsManager() modifier to pay out claims or mediation offers

interface IAPI3Pool {
    function payOutClaim(address recipient, uint256 amount) external;
}

contract ClaimsManager is AccessControlRegistryAdminnedWithManager {
    enum CoverageClaimStatus {
        None,
        Submitted,
        MediationOffered,
        Resolved
    }

    struct CoverageClaim {
        uint256 claimedDamagesAmount;
        uint256 mediationOfferAmount;
        uint256 timestamp;
        address claimant;
        address beneficiary;
        string evidence;
        CoverageClaimStatus status;
    }

    string public constant ARBITRATOR_ROLE_DESCRIPTION = "Arbitrator";
    string public constant MEDIATOR_ROLE_DESCRIPTION = "Mediator";

    bytes32 public immutable arbitratorRole;
    bytes32 public immutable mediatorRole;

    IAPI3Pool public immutable iAPI3Pool;

    uint256 public claimCount;
    mapping(uint256 => CoverageClaim) public claims;

    event CoverageClaimResolved(
        uint256 indexed claimCount,
        uint256 paymentAmount
    );
    event CoverageClaimSubmitted(
        uint256 indexed claimCount,
        uint256 claimedAmount,
        uint256 timestamp,
        address claimant,
        string evidence
    );
    event MediationOffer(
        uint256 indexed claimCount,
        uint256 mediationOfferAmount,
        string mediationOfferEvidence
    );

    modifier onlyArbitrator() {
        require(
            manager == msg.sender ||
                IAccessControlRegistry(accessControlRegistry).hasRole(
                    arbitratorRole,
                    msg.sender
                ),
            "Sender not arbitrator"
        );
        _;
    }

    modifier onlyMediator() {
        require(
            manager == msg.sender ||
                IAccessControlRegistry(accessControlRegistry).hasRole(
                    mediatorRole,
                    msg.sender
                ),
            "Sender not mediator"
        );
        _;
    }

    constructor(
        address _api3Pool,
        address _accessControlRegistry,
        string memory _adminRoleDescription,
        address _manager
    )
        AccessControlRegistryAdminnedWithManager(
            _accessControlRegistry,
            _adminRoleDescription,
            _manager
        )
    {
        iAPI3Pool = IAPI3Pool(_api3Pool);
        arbitratorRole = _deriveRole(adminRole, ARBITRATOR_ROLE_DESCRIPTION);
        mediatorRole = _deriveRole(adminRole, MEDIATOR_ROLE_DESCRIPTION);
    }

    /// @notice for claimant to submit a claim
    /// @param _claimedDamagesAmount amount of damages claimed by claimant in API3 tokens as of the time of claim submission
    /// @param _evidence IPFS-pinned document created by claimant containing evidence of damages, policy, and other items required by the applicable Service Coverage Terms and Conditions
    /// @return claimCount for submitted claim
    function submitClaim(
        uint256 _claimedDamagesAmount,
        string calldata _evidence
    ) external returns (uint256) {
        ++claimCount;
        CoverageClaim storage claim = claims[claimCount];
        claim.claimant = msg.sender;
        claim.beneficiary = msg.sender;
        claim.claimedDamagesAmount = _claimedDamagesAmount;
        claim.timestamp = block.timestamp;
        claim.evidence = _evidence;
        claim.status = CoverageClaimStatus.Submitted;
        emit CoverageClaimSubmitted(
            claimCount,
            _claimedDamagesAmount,
            block.timestamp,
            msg.sender,
            _evidence
        );
        return (claimCount);
    }

    /// @notice for mediator to provide a mediation offer to settle and satisfy a submitted and unresolved claim
    /// @param _amount amount of API3 tokens offered as a mediation offer to settle and satisfy the claim
    /// @param _claimCount number of applicable claim
    /// @param _mediatorEvidence IPFS-pinned document created by mediator refuting or otherwise addressing claimant's evidence, optional
    function provideMediationOffer(
        uint256 _amount,
        uint256 _claimCount,
        string calldata _mediatorEvidence
    ) external onlyMediator {
        CoverageClaim storage claim = claims[_claimCount];
        require(
            claim.status == CoverageClaimStatus.Submitted,
            "Claim not submitted"
        );
        require(
            _amount <= claim.claimedDamagesAmount,
            "Amount larger than claim"
        );
        claim.status = CoverageClaimStatus.MediationOffered;
        claim.mediationOfferAmount = _amount;
        emit MediationOffer(_claimCount, _amount, _mediatorEvidence);
    }

    /// @notice for claimant to accept mediator's offer to settle claim
    /// @param _claimCount number of applicable claim
    function acceptMediationOffer(uint256 _claimCount) external {
        CoverageClaim storage claim = claims[_claimCount];
        require(msg.sender == claim.claimant, "Only claimant can accept");
        require(
            claim.status == CoverageClaimStatus.MediationOffered,
            "No open mediation offer"
        );
        claim.status = CoverageClaimStatus.Resolved;
        iAPI3Pool.payOutClaim(claim.beneficiary, claim.mediationOfferAmount);
        emit CoverageClaimResolved(_claimCount, claim.mediationOfferAmount);
    }

    /// @notice for arbitrator to resolve a submitted and unresolved claim
    /// @param _amount amount of API3 tokens to be withdrawn from the API3 pool to satisfy the claim, discretionary amount by arbitrator but must be <= claimedDamagesAmount and unsuccessful or invalid claims should be resolved with an _amount of 0
    /// @param _claimCount number of applicable claim
    /// @dev iAPI3Pool.payOutClaim() ensures _amount will be less than the total staked amount via "require(totalStake > amount)" and can be called by this contract after whitelisting by the DAO primary agent calling setClaimsManagerStatus for this address
    function resolveClaim(uint256 _amount, uint256 _claimCount)
        external
        onlyArbitrator
    {
        CoverageClaim storage claim = claims[_claimCount];
        require(
            _amount <= claim.claimedDamagesAmount,
            "Amount larger than claim"
        );
        require(
            claim.status != CoverageClaimStatus.Resolved,
            "Claim already resolved"
        );
        iAPI3Pool.payOutClaim(claim.claimant, _amount);
        claim.status = CoverageClaimStatus.Resolved;
        emit CoverageClaimResolved(_claimCount, _amount);
    }
}
