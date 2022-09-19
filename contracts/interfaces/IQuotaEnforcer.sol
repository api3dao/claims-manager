//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IQuotaEnforcer {
    function getQuotaUsage(address account) external view returns (uint224);

    function accountToAccumulatedQuotaUsageCheckpoints(
        address account,
        uint256 checkpointIndex
    ) external view returns (uint32 fromTimestamp, uint224 value);

    function accountToQuota(address account)
        external
        view
        returns (uint32 period, uint224 amountInApi3);
}
