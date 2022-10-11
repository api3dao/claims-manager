//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../interfaces/IClaimsManager.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";

contract PolicyOfferExecutor {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;
    using Address for address;

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
        bytes calldata policyData,
        uint256 offerAmount,
        uint256 offerExpiration,
        bytes calldata offerSignature
    ) external returns (bytes32 policyHash) {
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
        policyHash = abi.decode(
            claimsManager.functionCall(
                abi.encodePacked(
                    IClaimsManager.createPolicy.selector,
                    policyData
                )
            ),
            (bytes32)
        );
    }

    function executeOffer(
        bytes[] calldata policyData,
        uint256 offerAmount,
        uint256 offerExpiration,
        bytes calldata offerSignature
    ) external {
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
        for (uint256 indPolicy = 0; indPolicy < countPolicy; indPolicy++) {
            claimsManager.functionCall(
                abi.encodePacked(
                    IClaimsManager.createPolicy.selector,
                    policyData[indPolicy]
                )
            );
        }
    }
}
