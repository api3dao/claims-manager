# @api3/claims-manager

Install the dependencies

```sh
yarn
```

Build the contracts

```sh
yarn build
```

Test the contracts

```sh
yarn test
```

## Kleros notes

https://kleros.gitbook.io/docs/integrations/types-of-integrations/1.-dispute-resolution-integration-plan/smart-contract-integration

https://kleros.gitbook.io/docs/integrations/types-of-integrations/1.-dispute-resolution-integration-plan/integration-tools/centralized-arbitrator

https://github.com/kleros/kleros/blob/master/contracts/kleros/KlerosLiquid.sol

https://github.com/kleros/erc-792/blob/master/contracts/examples/CentralizedArbitratorWithAppeal.sol

Mainnet Arbitrator address: `0x988b3A538b618C7A603e1c11Ab82Cd16dbE28069`

Blockchain subcourt: `1`

Script to generate the arbitrator extra data:

```js
generateArbitratorExtraData = (subcourtID, noOfVotes) => 0x${parseInt(subcourtID, 10).toString(16).padStart(64, "0") + parseInt(noOfVotes, 10).toString(16).padStart(64, "0")};
```

It also says extra data includes

> (If appeals are allowed) Stake multipliers representing multipliers of the appeal cost that a party must pay for a new
> round (in basis points)

however, KlerosLiquid derives the appeal cost from the number of jurors.

## Reads for frontend

Mostly static data:

- `extraData`: `ClaimsManagerWithKlerosArbitration.klerosArbitratorExtraData()`
- `subCourt` and `noOfVotes`: Parse `extraData`
- `KlerosLiquid.getSubCourt(subCourt).timesPerPeriod`
  (https://github.com/kleros/kleros/blob/master/contracts/kleros/KlerosLiquid.sol#L37)
- `KlerosLiquid.arbitrationCost(extraData)`

Dispute-specific data

- `KlerosLiquid.disputeStatus(disputeId)`
  (https://github.com/kleros/kleros-interaction/blob/master/contracts/standard/arbitration/Arbitrator.sol#L23)
- `KlerosLiquid.currentRuling(disputeId)`
- `KlerosLiquid.disputes(disputeId).period`, `KlerosLiquid.disputes(disputeId).lastPeriodChange`,
  `KlerosLiquid.disputes(disputeId).ruled`
- `KlerosLiquid.appealCost(disputeId, extraData)`
- Future appeal costs can be calculated using `KlerosLiquid.courts(subCourt).feeForJuror` and
  https://github.com/kleros/kleros/blob/master/contracts/kleros/KlerosLiquid.sol#L797

## Writes for frontend

- `executeRuling(disputeId)`
