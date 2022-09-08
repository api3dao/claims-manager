//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/* solhint-disable */
contract MockApi3Token is ERC20, Ownable {
    constructor() public ERC20("API3", "API3") {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}
/* solhint-disable */
