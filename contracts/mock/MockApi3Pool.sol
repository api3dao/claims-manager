//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./MockApi3Token.sol";

/* solhint-disable */
contract MockApi3Pool {
    address public immutable api3Token;
    uint256 public immutable totalStake;

    constructor(address _api3Token, uint256 _totalStake) {
        api3Token = _api3Token;
        totalStake = _totalStake;
    }

    function payOutClaim(address recipient, uint256 amount) external {
        require(amount <= totalStake, "Pool: Amount exceeds total stake");
        MockApi3Token(api3Token).mint(recipient, amount);
    }
}
/* solhint-disable */
