//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/IClaimsManager.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// This contract needs to have the admin role for the ClaimsManager contract.
// It can only call updatePolicy() with the permission of the claimant, which
// effectively makes this contract a policy agent.
contract PolicyOfferExecutor {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    address public immutable claimsManager;
    address public immutable offerSigner;
    address public immutable token;
    address public immutable beneficiary;
    mapping(bytes32 => bool) public offerWithIdIsExecuted;

    constructor(
        address _claimsManager,
        address _offerSigner,
        address _token,
        address _beneficiary
    ) {
        claimsManager = _claimsManager;
        offerSigner = _offerSigner;
        token = _token;
        beneficiary = _beneficiary;
    }

    function executeOffer(
        bytes32 offerId,
        bytes[] calldata policyData,
        uint256 offerAmount,
        uint256 offerExpiration,
        bytes calldata offerSignature
    ) external returns (bytes32[] memory policyHashes) {
        require(
            offerId ==
                keccak256(abi.encode(policyData, offerAmount, offerExpiration)),
            "Invalid offer ID"
        );
        require(!offerWithIdIsExecuted[offerId], "Offer already executed");
        require(block.timestamp < offerExpiration, "Offer expired");
        require(
            (
                keccak256(
                    abi.encode(
                        block.chainid,
                        address(this),
                        policyData,
                        offerAmount,
                        offerExpiration
                    )
                ).toEthSignedMessageHash()
            ).recover(offerSignature) == offerSigner,
            "Signature mismatch"
        );
        offerWithIdIsExecuted[offerId] = true;
        IERC20(token).safeTransferFrom(msg.sender, beneficiary, offerAmount);
        uint256 countPolicy = policyData.length;
        policyHashes = new bytes32[](countPolicy);
        for (uint256 indPolicy = 0; indPolicy < countPolicy; indPolicy++) {
            (
                address claimant,
                uint224 coverageAmountInUsd,
                uint32 claimsAllowedFrom,
                uint32 claimsAllowedUntil,
                string memory policy
            ) = abi.decode(
                    policyData[indPolicy],
                    (address, uint224, uint32, uint32, string)
                );
            require(msg.sender == claimant, "Sender not claimant");
            policyHashes[indPolicy] = IClaimsManager(claimsManager)
                .updatePolicy(
                    claimant,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy
                );
        }
    }
}
