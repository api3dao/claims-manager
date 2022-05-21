//SPDX-License-Identifier: MIT

pragma solidity >=0.8.4;

import "@api3/airnode-protocol/contracts/access-control-registry/AccessControlRegistryAdminnedWithManager.sol";
import "@api3/api3-dao-contracts/contracts/interfaces/IApi3Pool.sol";

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

    IApi3Pool public immutable iAPI3Pool;

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
        iAPI3Pool = IApi3Pool(_api3Pool);
        arbitratorRole = _deriveRole(adminRole, ARBITRATOR_ROLE_DESCRIPTION);
        mediatorRole = _deriveRole(adminRole, MEDIATOR_ROLE_DESCRIPTION);
    }

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
