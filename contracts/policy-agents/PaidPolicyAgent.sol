//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/IClaimsManager.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract PaidPolicyAgent {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    address public immutable claimsManager;
    address public immutable authorizedSigner;
    address public immutable token;
    address public immutable beneficiary;

    constructor(
        address _claimsManager,
        address _authorizedSigner,
        address _token,
        address _beneficiary
    ) {
        claimsManager = _claimsManager;
        authorizedSigner = _authorizedSigner;
        token = _token;
        beneficiary = _beneficiary;
    }

    function executeOffer(
        address claimant,
        uint224 coverageAmountInUsd,
        uint32 claimsAllowedFrom,
        uint32 claimsAllowedUntil,
        string calldata policy,
        uint256 offerAmount,
        uint256 offerExpiration,
        bytes calldata offerSignature
    ) external returns (bytes32 policyHash) {
        require(block.timestamp < offerExpiration, "Offer expired");
        IERC20(token).safeTransferFrom(msg.sender, beneficiary, offerAmount);
        policyHash = IClaimsManager(claimsManager).createPolicy(
            claimant,
            coverageAmountInUsd,
            claimsAllowedFrom,
            claimsAllowedUntil,
            policy
        );
        require(
            (
                keccak256(
                    abi.encodePacked(
                        block.chainid,
                        address(this),
                        policyHash,
                        offerAmount,
                        offerExpiration
                    )
                ).toEthSignedMessageHash()
            ).recover(offerSignature) == authorizedSigner,
            "Signature mismatch"
        );
    }
}
