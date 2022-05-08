//SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

/// @title API3 Service Coverage Claims Manager
/// @notice contract manager of API3 service coverage claims process and payments, permitted to withdraw as many tokens as necessary from API3's staking pool to satisfy successful valid claims on service coverage
/// @dev the primary DAO Agent must call setClaimsManagerStatus(coverageClaimManager, true) so this contract will satisfy the onlyClaimsManager() modifier to pay out claims or counteroffers

interface IAPI3Pool {
    function payOutClaim(address recipient, uint256 amount) external;
}

contract ClaimsManager {

    address immutable Api3Pool;
    address immutable coverageClaimManager;
    uint256 claimCount;
    IAPI3Pool iAPI3Pool;
    mapping(address => bool) isArbitrator; // arbitrator(s) of service coverage claims, i.e. Kleros
    mapping(address => bool) isCounterofferor; // counterofferor(s) of service coverage claims, i.e. multisig agent of API3
    mapping(uint256 => CoverageClaim) public claims;

    enum CoverageClaimStatus { None, Submitted, CounterOffered, Resolved }

    struct CoverageClaim {
        uint256 claimedDamagesAmount; // amount of damages claimed by claimant in API3 tokens as of the time of claim submission
        uint256 counterofferAmount; // counteroffer amount of API3 tokens by counterofferor
        uint256 timestamp; // claim submission timestamp
        address claimant; // holder of a service coverage policy making the applicable claim
        address beneficiary; // absent cryptographic proof of privity with claimant, should be same address as claimant, and currently hardcoded accordingly in submitClaim()
        string evidence; // IPFS-pinned Claim Submission document containing evidence of damages, policy, and other items required by the applicable Service Coverage Terms and Conditions
        CoverageClaimStatus status;
    }

    modifier onlyArbitrator() {
        require(isArbitrator[msg.sender], "Only API3 Service Coverage Claim Arbitrators");
        _;
    }

    modifier onlyCounterofferor() {
        require(isCounterofferor[msg.sender], "Only API3 Service Coverage Claim Counterofferors");
        _;
    }

    event Counteroffer(uint256 indexed claimCount, uint256 counterofferAmount, string counterofferEvidence);
    event CoverageClaimResolved(uint256 indexed claimCount, uint256 paymentAmount);
    event CoverageClaimSubmitted(uint256 indexed claimCount, uint256 claimedAmount, uint256 timestamp, address claimant, string evidence);
    
    /// @param _Api3Pool API3 DAO staking pool which collateralizes the service coverage, 0x6dd655f10d4b9E242aE186D9050B68F725c76d76
    /// @param _arbitrators address(es) who adjudicate and resolve claims, i.e. Kleros
    /// @param _counterofferors address(es) who may set forth counteroffers to resolve claims, i.e. multisig agent of API3
    constructor(address _Api3Pool, address[] memory _arbitrators, address[] memory _counterofferors) {
        Api3Pool = _Api3Pool;
        coverageClaimManager = address(this);
        iAPI3Pool = IAPI3Pool(_Api3Pool);
        for (uint16 i = 0; i < _arbitrators.length; ++i) {
            isArbitrator[_arbitrators[i]] = true;
        }
        for (uint16 i = 0; i < _counterofferors.length; ++i) {
            isCounterofferor[_counterofferors[i]] = true;
        }
    }
    
    /// @param _claimedDamagesAmount amount of damages claimed by claimant in API3 tokens as of the time of claim submission
    /// @param _evidence IPFS-pinned document created by claimant containing evidence of damages, policy, and other items required by the applicable Service Coverage Terms and Conditions
    /// @return claimCount for submitted claim
    function submitClaim(uint256 _claimedDamagesAmount, string calldata _evidence) external returns (uint256) {
        ++claimCount;
        CoverageClaim storage claim = claims[claimCount];
        claim.claimant = msg.sender;
        claim.beneficiary = msg.sender;
        claim.claimedDamagesAmount = _claimedDamagesAmount;
        claim.timestamp = block.timestamp;
        claim.evidence = _evidence;
        claim.status = CoverageClaimStatus.Submitted;
        emit CoverageClaimSubmitted(claimCount, _claimedDamagesAmount, block.timestamp, msg.sender, _evidence);
        return (claimCount);
    }
    
    /// @param _amount amount of API3 tokens offered as a counteroffer to satisfy the claim
    /// @param _claimCount number of applicable claim
    /// @param _counterevidence IPFS-pinned document created by counterofferor refuting or otherwise addressing claimant's evidence, optional
    function provideCounteroffer(uint256 _amount, uint256 _claimCount, string calldata _counterevidence) external onlyCounterofferor() {
        CoverageClaim storage claim = claims[_claimCount];
        require(claim.status == CoverageClaimStatus.Submitted, "Claim must be submitted and unresolved");
        require(_amount <= claim.claimedDamagesAmount, "Counteroffer must be <= claimed damages");
        claim.status = CoverageClaimStatus.CounterOffered;
        claim.counterofferAmount = _amount;
        emit Counteroffer(_claimCount, _amount, _counterevidence);
    }
    
    /// @param _claimCount number of applicable claim
    function acceptCounterOffer(uint256 _claimCount) external {
        CoverageClaim storage claim = claims[_claimCount];
        require(msg.sender == claim.claimant, "Only claimant can accept");
        require(claim.status == CoverageClaimStatus.CounterOffered, "No open counter offer");
        claim.status = CoverageClaimStatus.Resolved;
        iAPI3Pool.payOutClaim(claim.beneficiary, claim.counterofferAmount); // for counteroffer payments from the API3 collateral pool rather than the counterofferor address
        emit CoverageClaimResolved(_claimCount, claim.counterofferAmount);
    }
    
    /// @param _amount amount of API3 tokens to be withdrawn from the API3 pool to satisfy the claim, discretionary amount by arbitrator but must be <= claimedDamagesAmount
    /// @param _claimCount number of applicable claim
    /// @dev iAPI3Pool.payOutClaim() ensures _amount will be less than the total staked amount via "require(totalStake > amount)" and can be called by this contract after whitelisting by the DAO primary agent calling setClaimsManagerStatus for this address
    function resolveClaim(uint256 _amount, uint256 _claimCount) external onlyArbitrator() {
        CoverageClaim storage claim = claims[_claimCount];
        require(_amount <= claim.claimedDamagesAmount, "Claim payment must be <= claimed damages");
        require(claim.status != CoverageClaimStatus.Resolved, "Claim already resolved");
        iAPI3Pool.payOutClaim(claim.claimant, _amount); // unsuccessful or invalid claims should be resolved with an _amount of 0
        claim.status = CoverageClaimStatus.Resolved;
        emit CoverageClaimResolved(_claimCount, _amount);
    }
}
