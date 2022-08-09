//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IKlerosLiquid {
    function executeRuling(uint256 disputeId) external;

    function getSubCourt(uint96 subCourtId)
        external
        view
        returns (uint256[] memory children, uint256[4] memory timesPerPeriod);

    function courts(uint256 subCourtId)
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
            uint96 subCourtId,
            address arbitrated,
            uint256 numberOfChoices,
            uint8 period,
            uint256 lastPeriodChange,
            uint256 drawsInRound,
            uint256 commitsInRound,
            bool ruled
        );
}
