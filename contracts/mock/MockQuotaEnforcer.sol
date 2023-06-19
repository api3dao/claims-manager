//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../QuotaEnforcer.sol";

contract MockQuotaEnforcer is QuotaEnforcer {
    function setQuota(address account, uint32 period, uint224 amount) external {
        _setQuota(account, period, amount);
    }

    function resetQuota(address account) external {
        _resetQuota(account);
    }

    function externalRecordUsage(address account, uint224 amount) external {
        recordUsage(account, amount);
    }
}
