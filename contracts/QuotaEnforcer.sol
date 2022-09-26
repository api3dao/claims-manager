//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./interfaces/IQuotaEnforcer.sol";

contract QuotaEnforcer is IQuotaEnforcer {
    struct Checkpoint {
        uint32 fromTimestamp;
        uint224 value;
    }
    struct Quota {
        uint32 period;
        uint224 amount;
    }

    mapping(address => Checkpoint[])
        public
        override accountToAccumulatedQuotaUsageCheckpoints;
    mapping(address => Quota) public override accountToQuota;

    function getQuotaUsage(address account)
        public
        view
        override
        returns (uint224)
    {
        Checkpoint[]
            storage accumulatedQuotaUsageCheckpoints = accountToAccumulatedQuotaUsageCheckpoints[
                account
            ];
        uint224 accumulatedQuotaUsage = 0;
        if (accumulatedQuotaUsageCheckpoints.length > 0) {
            accumulatedQuotaUsage = accumulatedQuotaUsageCheckpoints[
                accumulatedQuotaUsageCheckpoints.length - 1
            ].value;
        }
        uint224 accumulatedQuotaUsageThen = getValueAt(
            accumulatedQuotaUsageCheckpoints,
            uint32(block.timestamp) - accountToQuota[account].period
        );
        return accumulatedQuotaUsage - accumulatedQuotaUsageThen;
    }

    function _setQuota(
        address account,
        uint32 period,
        uint224 amount
    ) internal {
        require(account != address(0), "Account address zero");
        require(period != 0, "Quota period zero");
        require(amount != 0, "Quota amount zero");
        accountToQuota[account] = Quota({period: period, amount: amount});
    }

    function _resetQuota(address account) internal {
        require(account != address(0), "Account address zero");
        accountToQuota[account] = Quota({period: 0, amount: 0});
    }

    function recordUsage(address account, uint224 amount) internal {
        Checkpoint[]
            storage accumulatedQuotaUsageCheckpoints = accountToAccumulatedQuotaUsageCheckpoints[
                account
            ];
        uint224 accumulatedQuotaUsage = amount;
        if (accumulatedQuotaUsageCheckpoints.length > 0) {
            accumulatedQuotaUsage += accumulatedQuotaUsageCheckpoints[
                accumulatedQuotaUsageCheckpoints.length - 1
            ].value;
        }
        accumulatedQuotaUsageCheckpoints.push(
            Checkpoint({
                fromTimestamp: uint32(block.timestamp),
                value: accumulatedQuotaUsage
            })
        );
        require(
            getQuotaUsage(account) <= accountToQuota[account].amount,
            "Quota exceeded"
        );
    }

    function getValueAt(Checkpoint[] storage checkpoints, uint32 _timestamp)
        private
        view
        returns (uint224)
    {
        if (checkpoints.length == 0) return 0;

        // Shortcut for the actual value
        if (_timestamp >= checkpoints[checkpoints.length - 1].fromTimestamp)
            return checkpoints[checkpoints.length - 1].value;
        if (_timestamp < checkpoints[0].fromTimestamp) return 0;

        // Binary search of the value in the array
        uint256 min = 0;
        uint256 max = checkpoints.length - 1;
        while (max > min) {
            uint256 mid = (max + min + 1) / 2;
            if (checkpoints[mid].fromTimestamp <= _timestamp) {
                min = mid;
            } else {
                max = mid - 1;
            }
        }
        return checkpoints[min].value;
    }
}
