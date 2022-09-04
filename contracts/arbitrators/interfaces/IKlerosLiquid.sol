//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IKlerosLiquid {
    enum Period {
        evidence,
        commit,
        vote,
        appeal,
        execution
    }

    function executeRuling(uint256 disputeId) external;

    function appealPeriod(uint256 disputeId)
        external
        view
        returns (uint256 start, uint256 end);

    function getSubcourt(uint96 subcourtId)
        external
        view
        returns (uint256[] memory children, uint256[4] memory timesPerPeriod);

    function courts(uint256 subcourtId)
        external
        view
        returns (
            uint96 parent,
            bool hiddenVotes,
            uint256 minStake,
            uint256 alpha,
            uint256 feeForJuror,
            uint256 jurorsForCourtJump
        );

    function disputes(uint256 disputeId)
        external
        view
        returns (
            uint96 subcourtID,
            address arbitrated,
            uint256 numberOfChoices,
            uint8 period,
            uint256 lastPeriodChange,
            uint256 drawsInRound,
            uint256 commitsInRound,
            bool ruled
        );
}
