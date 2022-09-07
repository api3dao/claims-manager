//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/* solhint-disable */
// A standalone contract that mocks below
// https://github.com/kleros/kleros/blob/master/contracts/kleros/KlerosLiquid.sol
// Names starting with __ do not exist in KlerosLiquid and added for convenience here.
// Events are omitted for brevity.
// Set the metadata to start with subcourt 1 with 3 minimum number of jurors.
// All staking/voting functionality is stripped, use __setCurrentRuling() instead.
// Use __setSubcourtTimesPerPeriod() if you need to speed up the flow.
contract MockKlerosLiquid {
    enum DisputeStatus {
        Waiting,
        Appealable,
        Solved
    }

    enum Period {
        evidence, // Evidence can be submitted. This is also when drawing has to take place.
        commit, // Jurors commit a hashed vote. This is skipped for courts without hidden votes.
        vote, // Jurors reveal/cast their vote depending on whether the court has hidden votes or not.
        appeal, // The dispute can be appealed.
        execution // Tokens are redistributed and the ruling is executed.
    }

    struct Court {
        uint96 parent; // The parent court.
        bool hiddenVotes; // Whether to use commit and reveal or not.
        uint256 feeForJuror; // Arbitration fee paid per juror.
        // The appeal after the one that reaches this number of jurors will go to the parent court if any, otherwise, no more appeals are possible.
        uint256 jurorsForCourtJump;
        uint256[4] timesPerPeriod; // The time allotted to each dispute period in the form `timesPerPeriod[period]`.
    }

    struct Dispute {
        // Note that appeal `0` is equivalent to the first round of the dispute.
        uint96 subcourtID; // The ID of the subcourt the dispute is in.
        address arbitrated; // The arbitrated arbitrable contract.
        // The number of choices jurors have when voting. This does not include choice `0` which is reserved for "refuse to arbitrate"/"no ruling".
        uint256 numberOfChoices;
        Period period; // The current period of the dispute.
        uint256 lastPeriodChange; // The last time the period was changed.
        bool ruled; // True if the ruling has been executed, false otherwise.
        uint256 __appealCount;
        mapping(uint256 => uint256) __appealToJurorCount;
    }

    uint256 public constant MIN_JURORS = 3; // The global default minimum number of jurors in a dispute.

    uint256 public constant NON_PAYABLE_AMOUNT = (2**256 - 2) / 2; // An amount higher than the supply of ETH.

    Court[] private __courts;

    uint256 private __disputeCount;

    mapping(uint256 => Dispute) private __disputeIdToDispute;

    mapping(uint256 => uint256) public currentRuling; // Mocks currentRuling() from KlerosLiquid

    modifier requireArbitrationFee(bytes calldata _extraData) {
        require(
            msg.value >= arbitrationCost(_extraData),
            "Not enough ETH to cover arbitration costs."
        );
        _;
    }

    modifier requireAppealFee(uint256 _disputeID, bytes calldata _extraData) {
        require(
            msg.value >= appealCost(_disputeID, _extraData),
            "Not enough ETH to cover appeal costs."
        );
        _;
    }

    modifier onlyDuringPeriod(uint256 _disputeID, Period _period) {
        require(__disputeIdToDispute[_disputeID].period == _period);
        _;
    }

    constructor() {
        // https://etherscan.io/address/0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069#readContract
        // General court
        __courts.push(
            Court({
                parent: 0,
                hiddenVotes: false,
                feeForJuror: 25000000000000000,
                jurorsForCourtJump: 511,
                timesPerPeriod: [
                    uint256(280800),
                    uint256(583200),
                    uint256(583200),
                    uint256(388800)
                ]
            })
        );
        // Blockchain court
        __courts.push(
            Court({
                parent: 0,
                hiddenVotes: false,
                feeForJuror: 25000000000000000,
                jurorsForCourtJump: 63,
                timesPerPeriod: [
                    uint256(280800),
                    uint256(583200),
                    uint256(583200),
                    uint256(388800)
                ]
            })
        );
    }

    function __setSubcourtTimesPerPeriod(
        uint96 _subcourtID,
        uint256[4] calldata _timesPerPeriod
    ) external {
        __courts[_subcourtID].timesPerPeriod = _timesPerPeriod;
    }

    function __setCurrentRuling(uint256 disputeId, uint256 ruling) external {
        currentRuling[disputeId] = ruling;
    }

    function passPeriod(uint256 _disputeID) external {
        Dispute storage dispute = __disputeIdToDispute[_disputeID];
        if (dispute.period == Period.evidence) {
            require(
                block.timestamp - dispute.lastPeriodChange >=
                    __courts[dispute.subcourtID].timesPerPeriod[
                        uint256(dispute.period)
                    ],
                "The evidence period time has not passed yet and it is not an appeal."
            );
            dispute.period = __courts[dispute.subcourtID].hiddenVotes
                ? Period.commit
                : Period.vote;
        } else if (dispute.period == Period.commit) {
            require(
                block.timestamp - dispute.lastPeriodChange >=
                    __courts[dispute.subcourtID].timesPerPeriod[
                        uint256(dispute.period)
                    ],
                "The commit period time has not passed yet and not every juror has committed yet."
            );
            dispute.period = Period.vote;
        } else if (dispute.period == Period.vote) {
            require(
                block.timestamp - dispute.lastPeriodChange >=
                    __courts[dispute.subcourtID].timesPerPeriod[
                        uint256(dispute.period)
                    ],
                "The vote period time has not passed yet and not every juror has voted yet."
            );
            dispute.period = Period.appeal;
        } else if (dispute.period == Period.appeal) {
            require(
                block.timestamp - dispute.lastPeriodChange >=
                    __courts[dispute.subcourtID].timesPerPeriod[
                        uint256(dispute.period)
                    ],
                "The appeal period time has not passed yet."
            );
            dispute.period = Period.execution;
        } else if (dispute.period == Period.execution) {
            revert("The dispute is already in the last period.");
        }
        dispute.lastPeriodChange = block.timestamp;
    }

    function createDispute(uint256 _numberOfChoices, bytes calldata _extraData)
        public
        payable
        requireArbitrationFee(_extraData)
        returns (uint256 disputeID)
    {
        (uint96 subcourtID, ) = extraDataToSubcourtIDAndMinJurors(_extraData);
        disputeID = __disputeCount++;
        Dispute storage dispute = __disputeIdToDispute[disputeID];
        dispute.subcourtID = subcourtID;
        dispute.arbitrated = msg.sender;
        dispute.numberOfChoices = _numberOfChoices;
        dispute.period = Period.evidence;
        dispute.lastPeriodChange = block.timestamp;
        dispute.ruled = false;
        dispute.__appealCount = 0;
        dispute.__appealToJurorCount[0] =
            msg.value /
            __courts[subcourtID].feeForJuror;
    }

    function appeal(uint256 _disputeID, bytes calldata _extraData)
        public
        payable
        requireAppealFee(_disputeID, _extraData)
        onlyDuringPeriod(_disputeID, Period.appeal)
    {
        Dispute storage dispute = __disputeIdToDispute[_disputeID];
        require(
            msg.sender == address(dispute.arbitrated),
            "Can only be called by the arbitrable contract."
        );
        if (
            dispute.__appealToJurorCount[dispute.__appealCount] >=
            __courts[dispute.subcourtID].jurorsForCourtJump
        )
            // Jump to parent subcourt.
            dispute.subcourtID = __courts[dispute.subcourtID].parent;
        dispute.period = Period.evidence;
        dispute.lastPeriodChange = block.timestamp;
        // As many votes that can be afforded by the provided funds.
        dispute.__appealCount++;
        dispute.__appealToJurorCount[dispute.__appealCount] =
            msg.value /
            __courts[dispute.subcourtID].feeForJuror;
    }

    function executeRuling(uint256 _disputeID)
        external
        onlyDuringPeriod(_disputeID, Period.execution)
    {
        Dispute storage dispute = __disputeIdToDispute[_disputeID];
        require(!dispute.ruled, "Ruling already executed.");
        dispute.ruled = true;
        uint256 winningChoice = currentRuling[_disputeID];
        (bool success, ) = dispute.arbitrated.call(
            abi.encodeWithSignature(
                "rule(uint256,uint256)",
                _disputeID,
                winningChoice
            )
        );
        require(success, "__Ruling execution reverted");
    }

    function arbitrationCost(bytes calldata _extraData)
        public
        view
        returns (uint256 cost)
    {
        (
            uint96 subcourtID,
            uint256 minJurors
        ) = extraDataToSubcourtIDAndMinJurors(_extraData);
        cost = __courts[subcourtID].feeForJuror * minJurors;
    }

    function appealCost(uint256 _disputeID, bytes calldata _extraData)
        public
        view
        returns (uint256 cost)
    {
        Dispute storage dispute = __disputeIdToDispute[_disputeID];
        uint256 lastNumberOfJurors = dispute.__appealToJurorCount[
            dispute.__appealCount
        ];
        if (
            lastNumberOfJurors >=
            __courts[dispute.subcourtID].jurorsForCourtJump
        ) {
            // Jump to parent subcourt.
            if (dispute.subcourtID == 0)
                // Already in the general court.
                cost = NON_PAYABLE_AMOUNT; // Get the cost of the parent subcourt.
            else
                cost =
                    __courts[__courts[dispute.subcourtID].parent].feeForJuror *
                    ((lastNumberOfJurors * 2) + 1);
        }
        // Stay in current subcourt.
        else
            cost =
                __courts[dispute.subcourtID].feeForJuror *
                ((lastNumberOfJurors * 2) + 1);
    }

    function disputeStatus(uint256 _disputeID)
        public
        view
        returns (DisputeStatus status)
    {
        Dispute storage dispute = __disputeIdToDispute[_disputeID];
        if (dispute.period < Period.appeal) status = DisputeStatus.Waiting;
        else if (dispute.period < Period.execution)
            status = DisputeStatus.Appealable;
        else status = DisputeStatus.Solved;
    }

    function appealPeriod(uint256 _disputeID)
        public
        view
        returns (uint256 start, uint256 end)
    {
        Dispute storage dispute = __disputeIdToDispute[_disputeID];
        if (dispute.period == Period.appeal) {
            start = dispute.lastPeriodChange;
            end =
                dispute.lastPeriodChange +
                __courts[dispute.subcourtID].timesPerPeriod[
                    uint256(Period.appeal)
                ];
        } else {
            start = 0;
            end = 0;
        }
    }

    function courts(uint256 subcourtId)
        public
        view
        returns (
            uint96 parent,
            bool hiddenVotes,
            uint256 minStake,
            uint256 alpha,
            uint256 feeForJuror,
            uint256 jurorsForCourtJump
        )
    {
        Court storage court = __courts[subcourtId];
        parent = court.parent;
        hiddenVotes = court.hiddenVotes;
        minStake = 0; // Dummy data
        alpha = 0; // Dummy data
        feeForJuror = court.feeForJuror;
        jurorsForCourtJump = court.jurorsForCourtJump;
    }

    function disputes(uint256 disputeId)
        public
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
        )
    {
        Dispute storage dispute = __disputeIdToDispute[disputeId];
        subcourtID = dispute.subcourtID;
        arbitrated = address(dispute.arbitrated);
        numberOfChoices = dispute.numberOfChoices;
        period = uint8(dispute.period);
        lastPeriodChange = dispute.lastPeriodChange;
        drawsInRound = 0; // Dummy data
        commitsInRound = 0; // Dummy data
        ruled = dispute.ruled;
    }

    function getSubcourt(uint96 _subcourtID)
        external
        view
        returns (uint256[] memory children, uint256[4] memory timesPerPeriod)
    {
        Court storage subcourt = __courts[_subcourtID];
        children = new uint256[](0); // Dummy data
        timesPerPeriod = subcourt.timesPerPeriod;
    }

    function extraDataToSubcourtIDAndMinJurors(bytes memory _extraData)
        internal
        view
        returns (uint96 subcourtID, uint256 minJurors)
    {
        if (_extraData.length >= 64) {
            assembly {
                // solium-disable-line security/no-inline-assembly
                subcourtID := mload(add(_extraData, 0x20))
                minJurors := mload(add(_extraData, 0x40))
            }
            if (subcourtID >= __courts.length) subcourtID = 0;
            if (minJurors == 0) minJurors = MIN_JURORS;
        } else {
            subcourtID = 0;
            minJurors = MIN_JURORS;
        }
    }
}
/* solhint-disable */
