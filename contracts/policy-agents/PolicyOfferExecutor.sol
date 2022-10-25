//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/IClaimsManager.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract PolicyOfferExecutor {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    address public immutable claimsManager;
    address public immutable offerSigner;
    address public immutable token;
    address public immutable beneficiary;

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
        bytes[] calldata policyData,
        uint256 offerAmount,
        uint256 offerExpiration,
        bytes calldata offerSignature
    ) external returns (bytes32[] memory policyHashes) {
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
                .createPolicy(
                    claimant,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy
                );
        }
    }
}
