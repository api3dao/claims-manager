const { expect } = require('chai');
const hre = require('hardhat');

const ClaimStatus = Object.freeze({
  None: 0,
  ClaimCreated: 1,
  ClaimAccepted: 2,
  SettlementProposed: 3,
  SettlementAccepted: 4,
  DisputeCreated: 5,
  DisputeResolvedWithoutPayout: 6,
  DisputeResolvedWithClaimPayout: 7,
  DisputeResolvedWithSettlementPayout: 8,
});

const ArbitratorDecision = Object.freeze({
  DoNotPay: 0,
  PayClaim: 1,
  PaySettlement: 2,
});

const Period = Object.freeze({
  evidence: 0,
  commit: 1,
  vote: 2,
  appeal: 3,
  execution: 4,
});

const DisputeStatus = Object.freeze({
  Waiting: 0,
  Appealable: 1,
  Solved: 2,
});

describe('ClaimsManager', function () {
  let accessControlRegistry,
    api3Token,
    api3Pool,
    claimsManager,
    dapiServer,
    api3UsdAmountConverter,
    klerosLiquid,
    klerosLiquidProxy;
  let roles;

  const mediatorResponsePeriod = 3 * 24 * 60 * 60,
    claimantResponsePeriod = 3 * 24 * 60 * 60,
    arbitratorResponsePeriod = 60 * 24 * 60 * 60;

  // API3 price is $2
  const api3UsdPriceWith18Decimals = hre.ethers.utils.parseEther('2');
  const dapiName = hre.ethers.utils.formatBytes32String('API3/USD');
  const dapiDecimals = 18;
  const dataFeedValue = api3UsdPriceWith18Decimals
    .mul(hre.ethers.BigNumber.from(10).pow(dapiDecimals))
    .div(hre.ethers.utils.parseEther('1'));
  // The API3 staking pool has 50 million API3 staked
  const totalStake = hre.ethers.utils.parseEther('50000000');

  const parentSubcourtID = 0;
  const subcourtID = 1;
  const minJurors = 3;
  const klerosArbitratorExtraData = hre.ethers.utils.defaultAbiCoder.encode(
    ['uint96', 'uint256'],
    [subcourtID, minJurors]
  );
  const metaEvidenceId = 0;
  const metaEvidence = '/ipfs/Qm...testhash/metaevidence.json';

  beforeEach(async () => {
    const accounts = await hre.ethers.getSigners();
    roles = {
      deployer: accounts[0],
      manager: accounts[1],
      admin: accounts[2],
      policyAgent: accounts[3],
      mediator: accounts[4],
      claimant: accounts[6],
      randomPerson: accounts[9],
    };
    const accessControlRegistryFactory = await hre.ethers.getContractFactory('AccessControlRegistry', roles.deployer);
    accessControlRegistry = await accessControlRegistryFactory.deploy();
    const api3TokenFactory = await hre.ethers.getContractFactory('MockApi3Token', roles.deployer);
    api3Token = await api3TokenFactory.deploy();
    const api3PoolFactory = await hre.ethers.getContractFactory('MockApi3Pool', roles.deployer);
    api3Pool = await api3PoolFactory.deploy(api3Token.address, totalStake);
    const claimsManagerFactory = await hre.ethers.getContractFactory('ClaimsManager', roles.deployer);
    claimsManager = await claimsManagerFactory.deploy(
      accessControlRegistry.address,
      'ClaimsManager admin',
      roles.manager.address,
      api3Pool.address,
      mediatorResponsePeriod,
      claimantResponsePeriod,
      arbitratorResponsePeriod
    );
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(
        await accessControlRegistry.deriveRootRole(roles.manager.address),
        'ClaimsManager admin'
      );
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(await claimsManager.adminRole(), 'Policy agent');
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(await claimsManager.adminRole(), 'Mediator');
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(await claimsManager.adminRole(), 'Arbitrator');
    await accessControlRegistry.connect(roles.manager).grantRole(await claimsManager.adminRole(), roles.admin.address);
    await accessControlRegistry
      .connect(roles.manager)
      .grantRole(await claimsManager.policyAgentRole(), roles.policyAgent.address);
    await accessControlRegistry
      .connect(roles.manager)
      .grantRole(await claimsManager.mediatorRole(), roles.mediator.address);
    const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
    dapiServer = await dapiServerFactory.deploy();
    const dataFeedId = hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(32));
    const dataFeedTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
    await dapiServer.mockDataFeed(dataFeedId, dataFeedValue, dataFeedTimestamp);
    await dapiServer.mockDapiName(dapiName, dataFeedId);
    const currencyConverterWithDapiFactory = await hre.ethers.getContractFactory(
      'CurrencyConverterWithDapi',
      roles.deployer
    );
    api3UsdAmountConverter = await currencyConverterWithDapiFactory.deploy(
      dapiServer.address,
      claimsManager.address,
      dapiName,
      dapiDecimals
    );
    await claimsManager.connect(roles.admin).setApi3UsdAmountConverter(api3UsdAmountConverter.address);
    const klerosLiquidFactory = await hre.ethers.getContractFactory('MockKlerosLiquid', roles.deployer);
    klerosLiquid = await klerosLiquidFactory.deploy();
    const klerosLiquidProxyFactory = await hre.ethers.getContractFactory('KlerosLiquidProxy', roles.deployer);
    klerosLiquidProxy = await klerosLiquidProxyFactory.deploy(
      claimsManager.address,
      klerosLiquid.address,
      klerosArbitratorExtraData,
      metaEvidence
    );
    await accessControlRegistry
      .connect(roles.manager)
      .grantRole(await claimsManager.arbitratorRole(), klerosLiquidProxy.address);
  });

  describe('constructor', function () {
    context('Claims manager address is not zero', function () {
      context('Kleros arbitrator address is not zero', function () {
        context('Kleros arbitrator extra data is empty', function () {
          context('Meta evidence is not empty', function () {
            it('constructs and emits the meta evidence', async function () {
              // It's a bit awkward to test events in the constructor with hardhat
              const constructorLogs = (
                await hre.ethers.provider.getTransactionReceipt(klerosLiquidProxy.deployTransaction.hash)
              ).logs;
              expect(constructorLogs.length).to.equal(1);
              const parsedLog = klerosLiquidProxy.interface.parseLog(constructorLogs[0]);
              expect(parsedLog.signature).to.equal('MetaEvidence(uint256,string)');
              expect(parsedLog.args._metaEvidenceID).to.equal(metaEvidenceId);
              expect(parsedLog.args._evidence).to.equal(metaEvidence);
              expect(await klerosLiquidProxy.claimsManager()).to.equal(claimsManager.address);
              expect(await klerosLiquidProxy.klerosArbitrator()).to.equal(klerosLiquid.address);
              expect(await klerosLiquidProxy.klerosArbitratorExtraData()).to.equal(klerosArbitratorExtraData);
              const subcourtIDAndMinJurors = await klerosLiquid.extraDataToSubcourtIDAndMinJurors(
                klerosArbitratorExtraData
              );
              expect(subcourtIDAndMinJurors.subcourtID).to.equal(subcourtID);
              expect(subcourtIDAndMinJurors.minJurors).to.equal(minJurors);
              const parentCourt = await klerosLiquidProxy.courts(parentSubcourtID);
              expect(parentCourt.parent).to.equal(parentSubcourtID);
              expect(parentCourt.hiddenVotes).to.equal(false);
              expect(parentCourt.feeForJuror).to.equal(hre.ethers.utils.parseEther('0.025'));
              expect(parentCourt.jurorsForCourtJump).to.equal(511);
              expect((await klerosLiquidProxy.getSubcourt(parentSubcourtID)).timesPerPeriod).to.deep.equal([
                hre.ethers.BigNumber.from(280800),
                hre.ethers.BigNumber.from(583200),
                hre.ethers.BigNumber.from(583200),
                hre.ethers.BigNumber.from(388800),
              ]);
              const childCourt = await klerosLiquidProxy.courts(subcourtID);
              expect(childCourt.parent).to.equal(parentSubcourtID);
              expect(childCourt.hiddenVotes).to.equal(false);
              expect(childCourt.feeForJuror).to.equal(hre.ethers.utils.parseEther('0.025'));
              expect(childCourt.jurorsForCourtJump).to.equal(63);
              expect((await klerosLiquidProxy.getSubcourt(subcourtID)).timesPerPeriod).to.deep.equal([
                hre.ethers.BigNumber.from(280800),
                hre.ethers.BigNumber.from(583200),
                hre.ethers.BigNumber.from(583200),
                hre.ethers.BigNumber.from(388800),
              ]);
            });
          });
          context('Meta evidence is not empty', function () {
            it('reverts', async function () {
              const klerosLiquidProxyFactory = await hre.ethers.getContractFactory('KlerosLiquidProxy', roles.deployer);
              await expect(
                klerosLiquidProxyFactory.deploy(
                  claimsManager.address,
                  klerosLiquid.address,
                  klerosArbitratorExtraData,
                  ''
                )
              ).to.be.revertedWith('Meta evidence empty');
            });
          });
        });
        context('Kleros arbitrator extra data is not empty', function () {
          it('reverts', async function () {
            const klerosLiquidProxyFactory = await hre.ethers.getContractFactory('KlerosLiquidProxy', roles.deployer);
            await expect(
              klerosLiquidProxyFactory.deploy(claimsManager.address, klerosLiquid.address, '0x', metaEvidence)
            ).to.be.revertedWith('KlerosArbitrator extraData empty');
          });
        });
      });
      context('Kleros arbitrator address is zero', function () {
        it('reverts', async function () {
          const klerosLiquidProxyFactory = await hre.ethers.getContractFactory('KlerosLiquidProxy', roles.deployer);
          await expect(
            klerosLiquidProxyFactory.deploy(
              claimsManager.address,
              hre.ethers.constants.AddressZero,
              klerosArbitratorExtraData,
              metaEvidence
            )
          ).to.be.revertedWith('KlerosArbitrator address zero');
        });
      });
    });
    context('Claims manager address is zero', function () {
      it('reverts', async function () {
        const klerosLiquidProxyFactory = await hre.ethers.getContractFactory('KlerosLiquidProxy', roles.deployer);
        await expect(
          klerosLiquidProxyFactory.deploy(
            hre.ethers.constants.AddressZero,
            klerosLiquid.address,
            klerosArbitratorExtraData,
            metaEvidence
          )
        ).to.be.revertedWith('ClaimsManager address zero');
      });
    });
  });

  describe('createDispute', function () {
    context('Sender is claimant', function () {
      context('Transaction covers the arbitration cost', function () {
        context('KlerosLiquidProxy has the arbitrator role', function () {
          context('Last action was claim creation', function () {
            context('Mediator was given enough time to propose a settlement', function () {
              context('It is not too late to create a dispute', function () {
                it('creates dispute', async function () {
                  const claimant = roles.claimant.address;
                  const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                  const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                  const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                  const policy = '/ipfs/Qm...testaddress';
                  const policyHash = hre.ethers.utils.solidityKeccak256(
                    ['address', 'uint32', 'string'],
                    [claimant, claimsAllowedFrom, policy]
                  );
                  await claimsManager
                    .connect(roles.policyAgent)
                    .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                  const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                  const evidence = '/ipfs/Qm...testaddress';
                  await claimsManager
                    .connect(roles.claimant)
                    .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                  const claimHash = hre.ethers.utils.solidityKeccak256(
                    ['bytes32', 'address', 'uint224', 'string'],
                    [policyHash, claimant, claimAmountInUsd, evidence]
                  );
                  const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                  const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
                  await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                  const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
                  const expectedDisputeId = 0;
                  await expect(
                    klerosLiquidProxy
                      .connect(roles.claimant)
                      .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost })
                  )
                    .to.emit(claimsManager, 'CreatedDispute')
                    .withArgs(claimant, policyHash, claimHash, klerosLiquidProxy.address)
                    .and.emit(klerosLiquidProxy, 'CreatedDispute')
                    .withArgs(claimant, expectedDisputeId, claimHash)
                    .and.emit(klerosLiquidProxy, 'Dispute')
                    .withArgs(klerosLiquid.address, expectedDisputeId, metaEvidenceId, expectedDisputeId)
                    .and.emit(klerosLiquidProxy, 'Evidence')
                    .withArgs(klerosLiquid.address, expectedDisputeId, claimant, evidence);
                  const claimState = await claimsManager.claimHashToState(claimHash);
                  expect(claimState.status).to.equal(ClaimStatus.DisputeCreated);
                  expect(claimState.updateTime).to.equal(disputeCreationBlockTimestamp);
                  expect(claimState.arbitrator).to.equal(klerosLiquidProxy.address);
                  const dispute = await klerosLiquidProxy.disputes(expectedDisputeId);
                  expect(dispute.subcourtID).to.equal(subcourtID);
                  expect(dispute.arbitrated).to.equal(klerosLiquidProxy.address);
                  expect(dispute.numberOfChoices).to.equal(Object.keys(ArbitratorDecision).length - 1);
                  expect(dispute.period).to.equal(Period.evidence);
                  expect(dispute.lastPeriodChange).to.equal(disputeCreationBlockTimestamp);
                  expect(dispute.ruled).to.equal(false);
                });
              });
              context('It is too late to create a dispute', function () {
                it('reverts', async function () {
                  const claimant = roles.claimant.address;
                  const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                  const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                  const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                  const policy = '/ipfs/Qm...testaddress';
                  const policyHash = hre.ethers.utils.solidityKeccak256(
                    ['address', 'uint32', 'string'],
                    [claimant, claimsAllowedFrom, policy]
                  );
                  await claimsManager
                    .connect(roles.policyAgent)
                    .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                  const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                  const evidence = '/ipfs/Qm...testaddress';
                  await claimsManager
                    .connect(roles.claimant)
                    .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                  const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                  const disputeCreationBlockTimestamp =
                    claimCreationBlockTimestamp + mediatorResponsePeriod + claimantResponsePeriod;
                  await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                  const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
                  await expect(
                    klerosLiquidProxy
                      .connect(roles.claimant)
                      .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost })
                  ).to.be.revertedWith('Too late to create dispute');
                });
              });
            });
            context('Mediator was not given enough time to propose a settlement', function () {
              it('reverts', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'uint32', 'string'],
                  [claimant, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                const evidence = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
                await expect(
                  klerosLiquidProxy
                    .connect(roles.claimant)
                    .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost })
                ).to.be.revertedWith('Awaiting mediator response');
              });
            });
          });
          context('Last action was settlement proposal', function () {
            context('It is not too late to create a dispute', function () {
              it('creates dispute', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'uint32', 'string'],
                  [claimant, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                const evidence = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                const claimHash = hre.ethers.utils.solidityKeccak256(
                  ['bytes32', 'address', 'uint224', 'string'],
                  [policyHash, claimant, claimAmountInUsd, evidence]
                );
                const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
                await claimsManager
                  .connect(roles.mediator)
                  .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd);
                const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
                const expectedDisputeId = 0;
                await expect(
                  klerosLiquidProxy
                    .connect(roles.claimant)
                    .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost })
                )
                  .to.emit(claimsManager, 'CreatedDispute')
                  .withArgs(claimant, policyHash, claimHash, klerosLiquidProxy.address)
                  .and.emit(klerosLiquidProxy, 'CreatedDispute')
                  .withArgs(claimant, expectedDisputeId, claimHash)
                  .and.emit(klerosLiquidProxy, 'Dispute')
                  .withArgs(klerosLiquid.address, expectedDisputeId, metaEvidenceId, expectedDisputeId)
                  .and.emit(klerosLiquidProxy, 'Evidence')
                  .withArgs(klerosLiquid.address, expectedDisputeId, claimant, evidence);
                const disputeCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                const claimState = await claimsManager.claimHashToState(claimHash);
                expect(claimState.status).to.equal(ClaimStatus.DisputeCreated);
                expect(claimState.updateTime).to.equal(disputeCreationBlockTimestamp);
                expect(claimState.arbitrator).to.equal(klerosLiquidProxy.address);
                const dispute = await klerosLiquidProxy.disputes(expectedDisputeId);
                expect(dispute.subcourtID).to.equal(subcourtID);
                expect(dispute.arbitrated).to.equal(klerosLiquidProxy.address);
                expect(dispute.numberOfChoices).to.equal(Object.keys(ArbitratorDecision).length - 1);
                expect(dispute.period).to.equal(Period.evidence);
                expect(dispute.lastPeriodChange).to.equal(disputeCreationBlockTimestamp);
                expect(dispute.ruled).to.equal(false);
              });
            });
            context('It is too late to create a dispute', function () {
              it('reverts', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'uint32', 'string'],
                  [claimant, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                const evidence = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
                await claimsManager
                  .connect(roles.mediator)
                  .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd);
                const settlementProposalBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                const disputeCreationBlockTimestamp = settlementProposalBlockTimestamp + claimantResponsePeriod;
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
                await expect(
                  klerosLiquidProxy
                    .connect(roles.claimant)
                    .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost })
                ).to.be.revertedWith('Too late to create dispute');
              });
            });
          });
          context('Last action was not claim creation or settlement proposal', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'uint32', 'string'],
                [claimant, claimsAllowedFrom, policy]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              const evidence = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.claimant)
                .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
              const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
              await klerosLiquidProxy
                .connect(roles.claimant)
                .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
              await expect(
                klerosLiquidProxy
                  .connect(roles.claimant)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost })
              ).to.be.revertedWith('Claim is not disputable');
            });
          });
        });
        context('KlerosLiquidProxy does not have the arbitrator role', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            const policyHash = hre.ethers.utils.solidityKeccak256(
              ['address', 'uint32', 'string'],
              [claimant, claimsAllowedFrom, policy]
            );
            await claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
            const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
            const evidence = '/ipfs/Qm...testaddress';
            await claimsManager
              .connect(roles.claimant)
              .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
            await accessControlRegistry
              .connect(roles.admin)
              .revokeRole(await claimsManager.arbitratorRole(), klerosLiquidProxy.address);
            const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
            await expect(
              klerosLiquidProxy
                .connect(roles.claimant)
                .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost })
            ).to.be.revertedWith('Sender not arbitrator');
          });
        });
      });
      context('Transaction does not cover the arbitration cost', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          const policyHash = hre.ethers.utils.solidityKeccak256(
            ['address', 'uint32', 'string'],
            [claimant, claimsAllowedFrom, policy]
          );
          await claimsManager
            .connect(roles.policyAgent)
            .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
          const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
          const evidence = '/ipfs/Qm...testaddress';
          await claimsManager
            .connect(roles.claimant)
            .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
          const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
          await expect(
            klerosLiquidProxy
              .connect(roles.claimant)
              .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost.sub(1) })
          ).to.be.revertedWith('Not enough ETH to cover arbitration costs.');
        });
      });
    });
    context('Sender is not claimant', function () {
      it('reverts', async function () {
        const claimant = roles.claimant.address;
        const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
        const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
        const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
        const policy = '/ipfs/Qm...testaddress';
        const policyHash = hre.ethers.utils.solidityKeccak256(
          ['address', 'uint32', 'string'],
          [claimant, claimsAllowedFrom, policy]
        );
        await claimsManager
          .connect(roles.policyAgent)
          .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
        const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
        const evidence = '/ipfs/Qm...testaddress';
        await claimsManager.connect(roles.claimant).createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
        await expect(
          klerosLiquidProxy.connect(roles.randomPerson).createDispute(policyHash, claimant, claimAmountInUsd, evidence)
        ).to.be.revertedWith('Sender not claimant');
      });
    });
  });

  describe('submitEvidenceToKlerosArbitrator', function () {
    context('Evidence is not empty', function () {
      context('Sender is manager', function () {
        context('Dispute of KlerosLiquidProxy with ID is being arbitrated by KlerosLiquid', function () {
          context('Dispute is in evidence period', function () {
            it('submits evidence', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'uint32', 'string'],
                [claimant, claimsAllowedFrom, policy]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              const evidence = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.claimant)
                .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
              const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
              const expectedDisputeId = 0;
              const newEvidence = '/ipfs/Qm...anothertestaddress';
              await klerosLiquidProxy
                .connect(roles.claimant)
                .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
              await expect(
                klerosLiquidProxy
                  .connect(roles.manager)
                  .submitEvidenceToKlerosArbitrator(expectedDisputeId, newEvidence)
              )
                .to.emit(klerosLiquidProxy, 'SubmittedEvidenceToKlerosArbitrator')
                .withArgs(roles.manager.address, expectedDisputeId, newEvidence)
                .and.emit(klerosLiquidProxy, 'Evidence')
                .withArgs(klerosLiquid.address, expectedDisputeId, roles.manager.address, newEvidence);
            });
          });
          context('Dispute is not in evidence period', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'uint32', 'string'],
                [claimant, claimsAllowedFrom, policy]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              const evidence = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.claimant)
                .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
              const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
              const expectedDisputeId = 0;
              const newEvidence = '/ipfs/Qm...anothertestaddress';
              await klerosLiquidProxy
                .connect(roles.claimant)
                .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
              const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
              ]);
              await klerosLiquid.passPeriod(expectedDisputeId);
              await expect(
                klerosLiquidProxy
                  .connect(roles.manager)
                  .submitEvidenceToKlerosArbitrator(expectedDisputeId, newEvidence)
              ).to.be.revertedWith('Dispute not in evidence period');
            });
          });
        });
        context('Dispute of KlerosLiquidProxy with ID is not being arbitrated by KlerosLiquid', function () {
          it('reverts', async function () {
            const madeUpDisputeId = 0;
            const newEvidence = '/ipfs/Qm...anothertestaddress';
            await expect(
              klerosLiquidProxy.connect(roles.manager).submitEvidenceToKlerosArbitrator(madeUpDisputeId, newEvidence)
            ).to.be.revertedWith('Invalid dispute ID');
          });
        });
      });
      context('Sender is admin', function () {
        context('Dispute of KlerosLiquidProxy with ID is being arbitrated by KlerosLiquid', function () {
          context('Dispute is in evidence period', function () {
            it('submits evidence', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'uint32', 'string'],
                [claimant, claimsAllowedFrom, policy]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              const evidence = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.claimant)
                .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
              const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
              const expectedDisputeId = 0;
              const newEvidence = '/ipfs/Qm...anothertestaddress';
              await klerosLiquidProxy
                .connect(roles.claimant)
                .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
              await expect(
                klerosLiquidProxy.connect(roles.admin).submitEvidenceToKlerosArbitrator(expectedDisputeId, newEvidence)
              )
                .to.emit(klerosLiquidProxy, 'SubmittedEvidenceToKlerosArbitrator')
                .withArgs(roles.admin.address, expectedDisputeId, newEvidence)
                .and.emit(klerosLiquidProxy, 'Evidence')
                .withArgs(klerosLiquid.address, expectedDisputeId, roles.admin.address, newEvidence);
            });
          });
          context('Dispute is not in evidence period', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'uint32', 'string'],
                [claimant, claimsAllowedFrom, policy]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              const evidence = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.claimant)
                .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
              const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
              const expectedDisputeId = 0;
              const newEvidence = '/ipfs/Qm...anothertestaddress';
              await klerosLiquidProxy
                .connect(roles.claimant)
                .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
              const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
              ]);
              await klerosLiquid.passPeriod(expectedDisputeId);
              await expect(
                klerosLiquidProxy.connect(roles.admin).submitEvidenceToKlerosArbitrator(expectedDisputeId, newEvidence)
              ).to.be.revertedWith('Dispute not in evidence period');
            });
          });
        });
        context('Dispute of KlerosLiquidProxy with ID is not being arbitrated by KlerosLiquid', function () {
          it('reverts', async function () {
            const madeUpDisputeId = 0;
            const newEvidence = '/ipfs/Qm...anothertestaddress';
            await expect(
              klerosLiquidProxy.connect(roles.admin).submitEvidenceToKlerosArbitrator(madeUpDisputeId, newEvidence)
            ).to.be.revertedWith('Invalid dispute ID');
          });
        });
      });
      context('Sender is mediator', function () {
        context('Dispute of KlerosLiquidProxy with ID is being arbitrated by KlerosLiquid', function () {
          context('Dispute is in evidence period', function () {
            it('submits evidence', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'uint32', 'string'],
                [claimant, claimsAllowedFrom, policy]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              const evidence = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.claimant)
                .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
              const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
              const expectedDisputeId = 0;
              const newEvidence = '/ipfs/Qm...anothertestaddress';
              await klerosLiquidProxy
                .connect(roles.claimant)
                .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
              await expect(
                klerosLiquidProxy
                  .connect(roles.mediator)
                  .submitEvidenceToKlerosArbitrator(expectedDisputeId, newEvidence)
              )
                .to.emit(klerosLiquidProxy, 'SubmittedEvidenceToKlerosArbitrator')
                .withArgs(roles.mediator.address, expectedDisputeId, newEvidence)
                .and.emit(klerosLiquidProxy, 'Evidence')
                .withArgs(klerosLiquid.address, expectedDisputeId, roles.mediator.address, newEvidence);
            });
          });
          context('Dispute is not in evidence period', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'uint32', 'string'],
                [claimant, claimsAllowedFrom, policy]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              const evidence = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.claimant)
                .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
              const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
              const expectedDisputeId = 0;
              const newEvidence = '/ipfs/Qm...anothertestaddress';
              await klerosLiquidProxy
                .connect(roles.claimant)
                .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
              const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
              ]);
              await klerosLiquid.passPeriod(expectedDisputeId);
              await expect(
                klerosLiquidProxy
                  .connect(roles.mediator)
                  .submitEvidenceToKlerosArbitrator(expectedDisputeId, newEvidence)
              ).to.be.revertedWith('Dispute not in evidence period');
            });
          });
        });
        context('Dispute of KlerosLiquidProxy with ID is not being arbitrated by KlerosLiquid', function () {
          it('reverts', async function () {
            const madeUpDisputeId = 0;
            const newEvidence = '/ipfs/Qm...anothertestaddress';
            await expect(
              klerosLiquidProxy.connect(roles.mediator).submitEvidenceToKlerosArbitrator(madeUpDisputeId, newEvidence)
            ).to.be.revertedWith('Invalid dispute ID');
          });
        });
      });
      context('Sender is not manager, admin or mediator', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          const policyHash = hre.ethers.utils.solidityKeccak256(
            ['address', 'uint32', 'string'],
            [claimant, claimsAllowedFrom, policy]
          );
          await claimsManager
            .connect(roles.policyAgent)
            .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
          const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
          const evidence = '/ipfs/Qm...testaddress';
          await claimsManager
            .connect(roles.claimant)
            .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
          const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
          const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
          await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
          const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
          const expectedDisputeId = 0;
          const newEvidence = '/ipfs/Qm...anothertestaddress';
          await klerosLiquidProxy
            .connect(roles.claimant)
            .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
          await expect(
            klerosLiquidProxy
              .connect(roles.randomPerson)
              .submitEvidenceToKlerosArbitrator(expectedDisputeId, newEvidence)
          ).to.be.revertedWith('Sender cannot mediate');
        });
      });
    });
    context('Evidence is empty', function () {
      it('reverts', async function () {
        const claimant = roles.claimant.address;
        const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
        const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
        const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
        const policy = '/ipfs/Qm...testaddress';
        const policyHash = hre.ethers.utils.solidityKeccak256(
          ['address', 'uint32', 'string'],
          [claimant, claimsAllowedFrom, policy]
        );
        await claimsManager
          .connect(roles.policyAgent)
          .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
        const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
        const evidence = '/ipfs/Qm...testaddress';
        await claimsManager.connect(roles.claimant).createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
        const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
        const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
        await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
        const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
        const expectedDisputeId = 0;
        const newEvidence = '';
        await klerosLiquidProxy
          .connect(roles.claimant)
          .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
        await expect(
          klerosLiquidProxy.connect(roles.mediator).submitEvidenceToKlerosArbitrator(expectedDisputeId, newEvidence)
        ).to.be.revertedWith('Evidence empty');
      });
    });
  });

  describe('appealKlerosArbitratorRuling', function () {
    context('A dispute has been created with KlerosLiquidProxy for the claim being referred to', function () {
      context('Sender is claimant', function () {
        context('Current ruling disagrees with the claimant', function () {
          context('Transaction covers the appeal cost', function () {
            context('Dispute is in appeal period', function () {
              it('appeals Kleros arbitrator ruling', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'uint32', 'string'],
                  [claimant, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                const evidence = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                const claimHash = hre.ethers.utils.solidityKeccak256(
                  ['bytes32', 'address', 'uint224', 'string'],
                  [policyHash, claimant, claimAmountInUsd, evidence]
                );
                const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
                const expectedDisputeId = 0;
                await klerosLiquidProxy
                  .connect(roles.claimant)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
                const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
                ]);
                await klerosLiquid.passPeriod(expectedDisputeId);
                const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
                ]);
                await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(
                  expectedDisputeId,
                  ArbitratorDecision.PaySettlement
                );
                const appealCost = await klerosLiquidProxy.appealCost(expectedDisputeId);
                await expect(
                  klerosLiquidProxy
                    .connect(roles.claimant)
                    .appealKlerosArbitratorRuling(policyHash, claimant, claimAmountInUsd, evidence, {
                      value: appealCost,
                    })
                )
                  .to.emit(klerosLiquidProxy, 'AppealedKlerosArbitratorRuling')
                  .withArgs(claimant, expectedDisputeId, claimHash);
              });
            });
            context('Dispute is not in appeal period', function () {
              it('reverts', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'uint32', 'string'],
                  [claimant, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                const evidence = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
                const expectedDisputeId = 0;
                await klerosLiquidProxy
                  .connect(roles.claimant)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
                const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
                ]);
                await klerosLiquid.passPeriod(expectedDisputeId);
                const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
                ]);
                await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(
                  expectedDisputeId,
                  ArbitratorDecision.PaySettlement
                );
                const appealPeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.appeal];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp +
                    evidencePeriodTime.toNumber() +
                    votePeriodTime.toNumber() +
                    appealPeriodTime.toNumber(),
                ]);
                await klerosLiquid.passPeriod(expectedDisputeId);
                const appealCost = await klerosLiquidProxy.appealCost(expectedDisputeId);
                await expect(
                  klerosLiquidProxy
                    .connect(roles.claimant)
                    .appealKlerosArbitratorRuling(policyHash, claimant, claimAmountInUsd, evidence, {
                      value: appealCost,
                    })
                ).to.be.reverted;
              });
            });
          });
          context('Transaction does not cover the appeal cost', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'uint32', 'string'],
                [claimant, claimsAllowedFrom, policy]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              const evidence = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.claimant)
                .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
              const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
              const expectedDisputeId = 0;
              await klerosLiquidProxy
                .connect(roles.claimant)
                .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
              const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
              ]);
              await klerosLiquid.passPeriod(expectedDisputeId);
              const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
              ]);
              await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(
                expectedDisputeId,
                ArbitratorDecision.PaySettlement
              );
              const appealCost = await klerosLiquidProxy.appealCost(expectedDisputeId);
              await expect(
                klerosLiquidProxy
                  .connect(roles.claimant)
                  .appealKlerosArbitratorRuling(policyHash, claimant, claimAmountInUsd, evidence, {
                    value: appealCost.sub(1),
                  })
              ).to.be.revertedWith('Not enough ETH to cover appeal costs.');
            });
          });
        });
        context('Current ruling agrees with the claimant', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            const policyHash = hre.ethers.utils.solidityKeccak256(
              ['address', 'uint32', 'string'],
              [claimant, claimsAllowedFrom, policy]
            );
            await claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
            const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
            const evidence = '/ipfs/Qm...testaddress';
            await claimsManager
              .connect(roles.claimant)
              .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
            const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
            const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
            await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
            const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
            const expectedDisputeId = 0;
            await klerosLiquidProxy
              .connect(roles.claimant)
              .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
            const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
            await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
              disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
            ]);
            await klerosLiquid.passPeriod(expectedDisputeId);
            const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
            await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
              disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
            ]);
            await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(
              expectedDisputeId,
              ArbitratorDecision.PayClaim
            );
            const appealCost = await klerosLiquidProxy.appealCost(expectedDisputeId);
            await expect(
              klerosLiquidProxy
                .connect(roles.claimant)
                .appealKlerosArbitratorRuling(policyHash, claimant, claimAmountInUsd, evidence, { value: appealCost })
            ).to.be.revertedWith('Ruling agrees with claimant');
          });
        });
      });
      context('Sender is manager', function () {
        context('Current ruling agrees with the claimant', function () {
          context('Transaction covers the appeal cost', function () {
            context('Dispute is in appeal period', function () {
              it('appeals Kleros arbitrator ruling', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'uint32', 'string'],
                  [claimant, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                const evidence = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                const claimHash = hre.ethers.utils.solidityKeccak256(
                  ['bytes32', 'address', 'uint224', 'string'],
                  [policyHash, claimant, claimAmountInUsd, evidence]
                );
                const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
                const expectedDisputeId = 0;
                await klerosLiquidProxy
                  .connect(roles.claimant)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
                const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
                ]);
                await klerosLiquid.passPeriod(expectedDisputeId);
                const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
                ]);
                await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(
                  expectedDisputeId,
                  ArbitratorDecision.PayClaim
                );
                const appealCost = await klerosLiquidProxy.appealCost(expectedDisputeId);
                await expect(
                  klerosLiquidProxy
                    .connect(roles.manager)
                    .appealKlerosArbitratorRuling(policyHash, claimant, claimAmountInUsd, evidence, {
                      value: appealCost,
                    })
                )
                  .to.emit(klerosLiquidProxy, 'AppealedKlerosArbitratorRuling')
                  .withArgs(roles.manager.address, expectedDisputeId, claimHash);
              });
            });
            context('Dispute is not in appeal period', function () {
              it('reverts', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'uint32', 'string'],
                  [claimant, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                const evidence = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
                const expectedDisputeId = 0;
                await klerosLiquidProxy
                  .connect(roles.claimant)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
                const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
                ]);
                await klerosLiquid.passPeriod(expectedDisputeId);
                const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
                ]);
                await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(
                  expectedDisputeId,
                  ArbitratorDecision.PayClaim
                );
                const appealPeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.appeal];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp +
                    evidencePeriodTime.toNumber() +
                    votePeriodTime.toNumber() +
                    appealPeriodTime.toNumber(),
                ]);
                await klerosLiquid.passPeriod(expectedDisputeId);
                const appealCost = await klerosLiquidProxy.appealCost(expectedDisputeId);
                await expect(
                  klerosLiquidProxy
                    .connect(roles.manager)
                    .appealKlerosArbitratorRuling(policyHash, claimant, claimAmountInUsd, evidence, {
                      value: appealCost,
                    })
                ).to.be.reverted;
              });
            });
          });
          context('Transaction does not cover the appeal cost', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'uint32', 'string'],
                [claimant, claimsAllowedFrom, policy]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              const evidence = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.claimant)
                .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
              const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
              const expectedDisputeId = 0;
              await klerosLiquidProxy
                .connect(roles.claimant)
                .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
              const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
              ]);
              await klerosLiquid.passPeriod(expectedDisputeId);
              const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
              ]);
              await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(
                expectedDisputeId,
                ArbitratorDecision.PayClaim
              );
              const appealCost = await klerosLiquidProxy.appealCost(expectedDisputeId);
              await expect(
                klerosLiquidProxy
                  .connect(roles.manager)
                  .appealKlerosArbitratorRuling(policyHash, claimant, claimAmountInUsd, evidence, {
                    value: appealCost.sub(1),
                  })
              ).to.be.revertedWith('Not enough ETH to cover appeal costs.');
            });
          });
        });
        context('Current ruling disagrees with the claimant', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            const policyHash = hre.ethers.utils.solidityKeccak256(
              ['address', 'uint32', 'string'],
              [claimant, claimsAllowedFrom, policy]
            );
            await claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
            const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
            const evidence = '/ipfs/Qm...testaddress';
            await claimsManager
              .connect(roles.claimant)
              .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
            const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
            const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
            await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
            const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
            const expectedDisputeId = 0;
            await klerosLiquidProxy
              .connect(roles.claimant)
              .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
            const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
            await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
              disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
            ]);
            await klerosLiquid.passPeriod(expectedDisputeId);
            const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
            await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
              disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
            ]);
            await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(
              expectedDisputeId,
              ArbitratorDecision.PaySettlement
            );
            const appealCost = await klerosLiquidProxy.appealCost(expectedDisputeId);
            await expect(
              klerosLiquidProxy
                .connect(roles.manager)
                .appealKlerosArbitratorRuling(policyHash, claimant, claimAmountInUsd, evidence, { value: appealCost })
            ).to.be.revertedWith('Ruling disagrees with claimant');
          });
        });
      });
      context('Sender is admin', function () {
        context('Current ruling agrees with the claimant', function () {
          context('Transaction covers the appeal cost', function () {
            context('Dispute is in appeal period', function () {
              it('appeals Kleros arbitrator ruling', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'uint32', 'string'],
                  [claimant, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                const evidence = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                const claimHash = hre.ethers.utils.solidityKeccak256(
                  ['bytes32', 'address', 'uint224', 'string'],
                  [policyHash, claimant, claimAmountInUsd, evidence]
                );
                const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
                const expectedDisputeId = 0;
                await klerosLiquidProxy
                  .connect(roles.claimant)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
                const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
                ]);
                await klerosLiquid.passPeriod(expectedDisputeId);
                const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
                ]);
                await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(
                  expectedDisputeId,
                  ArbitratorDecision.PayClaim
                );
                const appealCost = await klerosLiquidProxy.appealCost(expectedDisputeId);
                await expect(
                  klerosLiquidProxy
                    .connect(roles.admin)
                    .appealKlerosArbitratorRuling(policyHash, claimant, claimAmountInUsd, evidence, {
                      value: appealCost,
                    })
                )
                  .to.emit(klerosLiquidProxy, 'AppealedKlerosArbitratorRuling')
                  .withArgs(roles.admin.address, expectedDisputeId, claimHash);
              });
            });
            context('Dispute is not in appeal period', function () {
              it('reverts', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'uint32', 'string'],
                  [claimant, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                const evidence = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
                const expectedDisputeId = 0;
                await klerosLiquidProxy
                  .connect(roles.claimant)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
                const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
                ]);
                await klerosLiquid.passPeriod(expectedDisputeId);
                const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
                ]);
                await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(
                  expectedDisputeId,
                  ArbitratorDecision.PayClaim
                );
                const appealPeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.appeal];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp +
                    evidencePeriodTime.toNumber() +
                    votePeriodTime.toNumber() +
                    appealPeriodTime.toNumber(),
                ]);
                await klerosLiquid.passPeriod(expectedDisputeId);
                const appealCost = await klerosLiquidProxy.appealCost(expectedDisputeId);
                await expect(
                  klerosLiquidProxy
                    .connect(roles.admin)
                    .appealKlerosArbitratorRuling(policyHash, claimant, claimAmountInUsd, evidence, {
                      value: appealCost,
                    })
                ).to.be.reverted;
              });
            });
          });
          context('Transaction does not cover the appeal cost', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'uint32', 'string'],
                [claimant, claimsAllowedFrom, policy]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              const evidence = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.claimant)
                .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
              const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
              const expectedDisputeId = 0;
              await klerosLiquidProxy
                .connect(roles.claimant)
                .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
              const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
              ]);
              await klerosLiquid.passPeriod(expectedDisputeId);
              const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
              ]);
              await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(
                expectedDisputeId,
                ArbitratorDecision.PayClaim
              );
              const appealCost = await klerosLiquidProxy.appealCost(expectedDisputeId);
              await expect(
                klerosLiquidProxy
                  .connect(roles.admin)
                  .appealKlerosArbitratorRuling(policyHash, claimant, claimAmountInUsd, evidence, {
                    value: appealCost.sub(1),
                  })
              ).to.be.revertedWith('Not enough ETH to cover appeal costs.');
            });
          });
        });
        context('Current ruling disagrees with the claimant', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            const policyHash = hre.ethers.utils.solidityKeccak256(
              ['address', 'uint32', 'string'],
              [claimant, claimsAllowedFrom, policy]
            );
            await claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
            const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
            const evidence = '/ipfs/Qm...testaddress';
            await claimsManager
              .connect(roles.claimant)
              .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
            const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
            const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
            await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
            const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
            const expectedDisputeId = 0;
            await klerosLiquidProxy
              .connect(roles.claimant)
              .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
            const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
            await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
              disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
            ]);
            await klerosLiquid.passPeriod(expectedDisputeId);
            const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
            await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
              disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
            ]);
            await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(
              expectedDisputeId,
              ArbitratorDecision.PaySettlement
            );
            const appealCost = await klerosLiquidProxy.appealCost(expectedDisputeId);
            await expect(
              klerosLiquidProxy
                .connect(roles.admin)
                .appealKlerosArbitratorRuling(policyHash, claimant, claimAmountInUsd, evidence, { value: appealCost })
            ).to.be.revertedWith('Ruling disagrees with claimant');
          });
        });
      });
      context('Sender is mediator', function () {
        context('Current ruling agrees with the claimant', function () {
          context('Transaction covers the appeal cost', function () {
            context('Dispute is in appeal period', function () {
              it('appeals Kleros arbitrator ruling', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'uint32', 'string'],
                  [claimant, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                const evidence = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                const claimHash = hre.ethers.utils.solidityKeccak256(
                  ['bytes32', 'address', 'uint224', 'string'],
                  [policyHash, claimant, claimAmountInUsd, evidence]
                );
                const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
                const expectedDisputeId = 0;
                await klerosLiquidProxy
                  .connect(roles.claimant)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
                const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
                ]);
                await klerosLiquid.passPeriod(expectedDisputeId);
                const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
                ]);
                await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(
                  expectedDisputeId,
                  ArbitratorDecision.PayClaim
                );
                const appealCost = await klerosLiquidProxy.appealCost(expectedDisputeId);
                await expect(
                  klerosLiquidProxy
                    .connect(roles.mediator)
                    .appealKlerosArbitratorRuling(policyHash, claimant, claimAmountInUsd, evidence, {
                      value: appealCost,
                    })
                )
                  .to.emit(klerosLiquidProxy, 'AppealedKlerosArbitratorRuling')
                  .withArgs(roles.mediator.address, expectedDisputeId, claimHash);
              });
            });
            context('Dispute is not in appeal period', function () {
              it('reverts', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'uint32', 'string'],
                  [claimant, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                const evidence = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
                const expectedDisputeId = 0;
                await klerosLiquidProxy
                  .connect(roles.claimant)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
                const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
                ]);
                await klerosLiquid.passPeriod(expectedDisputeId);
                const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
                ]);
                await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(
                  expectedDisputeId,
                  ArbitratorDecision.PayClaim
                );
                const appealPeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.appeal];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp +
                    evidencePeriodTime.toNumber() +
                    votePeriodTime.toNumber() +
                    appealPeriodTime.toNumber(),
                ]);
                await klerosLiquid.passPeriod(expectedDisputeId);
                const appealCost = await klerosLiquidProxy.appealCost(expectedDisputeId);
                await expect(
                  klerosLiquidProxy
                    .connect(roles.mediator)
                    .appealKlerosArbitratorRuling(policyHash, claimant, claimAmountInUsd, evidence, {
                      value: appealCost,
                    })
                ).to.be.reverted;
              });
            });
          });
          context('Transaction does not cover the appeal cost', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'uint32', 'string'],
                [claimant, claimsAllowedFrom, policy]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              const evidence = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.claimant)
                .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
              const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
              const expectedDisputeId = 0;
              await klerosLiquidProxy
                .connect(roles.claimant)
                .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
              const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
              ]);
              await klerosLiquid.passPeriod(expectedDisputeId);
              const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
              ]);
              await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(
                expectedDisputeId,
                ArbitratorDecision.PayClaim
              );
              const appealCost = await klerosLiquidProxy.appealCost(expectedDisputeId);
              await expect(
                klerosLiquidProxy
                  .connect(roles.mediator)
                  .appealKlerosArbitratorRuling(policyHash, claimant, claimAmountInUsd, evidence, {
                    value: appealCost.sub(1),
                  })
              ).to.be.revertedWith('Not enough ETH to cover appeal costs.');
            });
          });
        });
        context('Current ruling disagrees with the claimant', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            const policyHash = hre.ethers.utils.solidityKeccak256(
              ['address', 'uint32', 'string'],
              [claimant, claimsAllowedFrom, policy]
            );
            await claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
            const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
            const evidence = '/ipfs/Qm...testaddress';
            await claimsManager
              .connect(roles.claimant)
              .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
            const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
            const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
            await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
            const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
            const expectedDisputeId = 0;
            await klerosLiquidProxy
              .connect(roles.claimant)
              .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
            const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
            await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
              disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
            ]);
            await klerosLiquid.passPeriod(expectedDisputeId);
            const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
            await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
              disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
            ]);
            await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(
              expectedDisputeId,
              ArbitratorDecision.PaySettlement
            );
            const appealCost = await klerosLiquidProxy.appealCost(expectedDisputeId);
            await expect(
              klerosLiquidProxy
                .connect(roles.mediator)
                .appealKlerosArbitratorRuling(policyHash, claimant, claimAmountInUsd, evidence, { value: appealCost })
            ).to.be.revertedWith('Ruling disagrees with claimant');
          });
        });
      });
      context('Sender is not claimant, manager, admin or mediator', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          const policyHash = hre.ethers.utils.solidityKeccak256(
            ['address', 'uint32', 'string'],
            [claimant, claimsAllowedFrom, policy]
          );
          await claimsManager
            .connect(roles.policyAgent)
            .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
          const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
          const evidence = '/ipfs/Qm...testaddress';
          await claimsManager
            .connect(roles.claimant)
            .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
          const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
          const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
          await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
          const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
          const expectedDisputeId = 0;
          await klerosLiquidProxy
            .connect(roles.claimant)
            .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
          const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
          await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
            disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
          ]);
          await klerosLiquid.passPeriod(expectedDisputeId);
          const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
          await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
            disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
          ]);
          await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(
            expectedDisputeId,
            ArbitratorDecision.PayClaim
          );
          const appealCost = await klerosLiquidProxy.appealCost(expectedDisputeId);
          await expect(
            klerosLiquidProxy
              .connect(roles.randomPerson)
              .appealKlerosArbitratorRuling(policyHash, claimant, claimAmountInUsd, evidence, { value: appealCost })
          ).to.be.revertedWith('Only parties can appeal');
        });
      });
    });
    context('A dispute has not been created with KlerosLiquidProxy for the claim being referred to', function () {
      it('reverts', async function () {
        const claimant = roles.claimant.address;
        const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
        const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
        const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
        const policy = '/ipfs/Qm...testaddress';
        const policyHash = hre.ethers.utils.solidityKeccak256(
          ['address', 'uint32', 'string'],
          [claimant, claimsAllowedFrom, policy]
        );
        await claimsManager
          .connect(roles.policyAgent)
          .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
        const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
        const evidence = '/ipfs/Qm...testaddress';
        await claimsManager.connect(roles.claimant).createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
        await expect(
          klerosLiquidProxy
            .connect(roles.claimant)
            .appealKlerosArbitratorRuling(policyHash, claimant, claimAmountInUsd, evidence)
        ).to.be.revertedWith('No dispute related to claim');
      });
    });
  });

  describe('rule', function () {
    context('Dispute is in execution period', function () {
      context('Sender is KlerosLiquid', function () {
        context('KlerosLiquidProxy is still arbitrator', function () {
          context('Dispute is not resolved yet', function () {
            context('It is not too late to resolve the dispute', function () {
              it('executes ruling', async function () {
                const quotaPeriod = 7 * 24 * 60 * 60;
                const quotaAmount = hre.ethers.utils.parseEther('1000000');
                await claimsManager.connect(roles.admin).setQuota(klerosLiquidProxy.address, quotaPeriod, quotaAmount);
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'uint32', 'string'],
                  [claimant, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                const evidence = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                const claimHash = hre.ethers.utils.solidityKeccak256(
                  ['bytes32', 'address', 'uint224', 'string'],
                  [policyHash, claimant, claimAmountInUsd, evidence]
                );
                const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
                const expectedDisputeId = 0;
                await klerosLiquidProxy
                  .connect(roles.claimant)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
                const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
                ]);
                await klerosLiquid.passPeriod(expectedDisputeId);
                const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
                ]);
                expect(await klerosLiquidProxy.disputeStatus(expectedDisputeId)).to.equal(DisputeStatus.Waiting);
                const ruling = ArbitratorDecision.PayClaim;
                await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(expectedDisputeId, ruling);
                expect(await klerosLiquidProxy.disputeStatus(expectedDisputeId)).to.equal(DisputeStatus.Appealable);
                const appealPeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.appeal];
                const appealPeriod = await klerosLiquidProxy.appealPeriod(expectedDisputeId);
                expect(appealPeriod.start).to.equal(
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber()
                );
                expect(appealPeriod.end).to.equal(
                  disputeCreationBlockTimestamp +
                    evidencePeriodTime.toNumber() +
                    votePeriodTime.toNumber() +
                    appealPeriodTime.toNumber()
                );
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [appealPeriod.end.toNumber()]);
                await klerosLiquid.passPeriod(expectedDisputeId);
                expect(await klerosLiquidProxy.currentRuling(expectedDisputeId)).to.equal(ruling);
                await expect(klerosLiquidProxy.executeRuling(expectedDisputeId))
                  .to.emit(klerosLiquidProxy, 'Ruling')
                  .withArgs(klerosLiquid.address, expectedDisputeId, ruling);
                expect(await klerosLiquidProxy.disputeStatus(expectedDisputeId)).to.equal(DisputeStatus.Solved);
                const payoutAmountInUsd = claimAmountInUsd;
                const payoutAmountInApi3 = claimAmountInUsd
                  .mul(hre.ethers.utils.parseEther('1'))
                  .div(api3UsdPriceWith18Decimals);
                expect(await api3Token.balanceOf(claimant)).to.equal(payoutAmountInApi3);
                const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                const claimState = await claimsManager.claimHashToState(claimHash);
                expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithClaimPayout);
                expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
                expect(claimState.arbitrator).to.equal(klerosLiquidProxy.address);
                const policyState = await claimsManager.policyHashToState(policyHash);
                expect(policyState.coverageAmountInUsd).to.equal(coverageAmountInUsd.sub(payoutAmountInUsd));
                expect(await claimsManager.getQuotaUsage(klerosLiquidProxy.address)).to.equal(payoutAmountInApi3);
              });
            });
            context('It is too late to resolve the dispute', function () {
              it('reverts', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'uint32', 'string'],
                  [claimant, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                const evidence = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
                const expectedDisputeId = 0;
                await klerosLiquidProxy
                  .connect(roles.claimant)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
                const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
                ]);
                await klerosLiquid.passPeriod(expectedDisputeId);
                const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
                ]);
                const ruling = ArbitratorDecision.PayClaim;
                await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(expectedDisputeId, ruling);
                const appealPeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.appeal];
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp +
                    evidencePeriodTime.toNumber() +
                    votePeriodTime.toNumber() +
                    appealPeriodTime.toNumber(),
                ]);
                await klerosLiquid.passPeriod(expectedDisputeId);
                await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                  disputeCreationBlockTimestamp + (await claimsManager.arbitratorResponsePeriod()),
                ]);
                await expect(klerosLiquidProxy.executeRuling(expectedDisputeId)).to.be.revertedWith(
                  '__Ruling execution reverted'
                );
              });
            });
          });
          context('Dispute is already resolved', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'uint32', 'string'],
                [claimant, claimsAllowedFrom, policy]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              const evidence = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.claimant)
                .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
              const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
              const expectedDisputeId = 0;
              await klerosLiquidProxy
                .connect(roles.claimant)
                .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
              const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
              ]);
              await klerosLiquid.passPeriod(expectedDisputeId);
              const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
              ]);
              const ruling = ArbitratorDecision.PayClaim;
              await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(expectedDisputeId, ruling);
              const appealPeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.appeal];
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                disputeCreationBlockTimestamp +
                  evidencePeriodTime.toNumber() +
                  votePeriodTime.toNumber() +
                  appealPeriodTime.toNumber(),
              ]);
              await klerosLiquid.passPeriod(expectedDisputeId);
              await claimsManager
                .connect(roles.admin)
                .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, ArbitratorDecision.PayClaim);
              await expect(klerosLiquidProxy.executeRuling(expectedDisputeId)).to.be.revertedWith(
                '__Ruling execution reverted'
              );
            });
          });
        });
        context('KlerosLiquidProxy is no longer arbitrator', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            const policyHash = hre.ethers.utils.solidityKeccak256(
              ['address', 'uint32', 'string'],
              [claimant, claimsAllowedFrom, policy]
            );
            await claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
            const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
            const evidence = '/ipfs/Qm...testaddress';
            await claimsManager
              .connect(roles.claimant)
              .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
            const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
            const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
            await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
            const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
            const expectedDisputeId = 0;
            await klerosLiquidProxy
              .connect(roles.claimant)
              .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
            const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
            await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
              disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
            ]);
            await klerosLiquid.passPeriod(expectedDisputeId);
            const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
            await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
              disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
            ]);
            const ruling = ArbitratorDecision.PayClaim;
            await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(expectedDisputeId, ruling);
            const appealPeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.appeal];
            await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
              disputeCreationBlockTimestamp +
                evidencePeriodTime.toNumber() +
                votePeriodTime.toNumber() +
                appealPeriodTime.toNumber(),
            ]);
            await klerosLiquid.passPeriod(expectedDisputeId);
            await accessControlRegistry
              .connect(roles.admin)
              .revokeRole(await claimsManager.arbitratorRole(), klerosLiquidProxy.address);
            await expect(klerosLiquidProxy.executeRuling(expectedDisputeId)).to.be.revertedWith(
              '__Ruling execution reverted'
            );
          });
        });
      });
      context('Sender is not KlerosLiquid', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          const policyHash = hre.ethers.utils.solidityKeccak256(
            ['address', 'uint32', 'string'],
            [claimant, claimsAllowedFrom, policy]
          );
          await claimsManager
            .connect(roles.policyAgent)
            .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
          const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
          const evidence = '/ipfs/Qm...testaddress';
          await claimsManager
            .connect(roles.claimant)
            .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
          const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
          const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
          await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
          const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
          const expectedDisputeId = 0;
          await klerosLiquidProxy
            .connect(roles.claimant)
            .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
          const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
          await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
            disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
          ]);
          await klerosLiquid.passPeriod(expectedDisputeId);
          const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
          await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
            disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
          ]);
          const ruling = ArbitratorDecision.PayClaim;
          await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(expectedDisputeId, ruling);
          const appealPeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.appeal];
          await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
            disputeCreationBlockTimestamp +
              evidencePeriodTime.toNumber() +
              votePeriodTime.toNumber() +
              appealPeriodTime.toNumber(),
          ]);
          await klerosLiquid.passPeriod(expectedDisputeId);
          await expect(
            klerosLiquidProxy.connect(roles.randomPerson).rule(expectedDisputeId, ruling)
          ).to.be.revertedWith('Sender not KlerosLiquid');
        });
      });
    });
    context('Dispute is not in execution period', function () {
      it('reverts', async function () {
        const claimant = roles.claimant.address;
        const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
        const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
        const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
        const policy = '/ipfs/Qm...testaddress';
        const policyHash = hre.ethers.utils.solidityKeccak256(
          ['address', 'uint32', 'string'],
          [claimant, claimsAllowedFrom, policy]
        );
        await claimsManager
          .connect(roles.policyAgent)
          .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
        const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
        const evidence = '/ipfs/Qm...testaddress';
        await claimsManager.connect(roles.claimant).createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
        const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
        const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
        await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
        const arbitrationCost = await klerosLiquidProxy.arbitrationCost();
        const expectedDisputeId = 0;
        await klerosLiquidProxy
          .connect(roles.claimant)
          .createDispute(policyHash, claimant, claimAmountInUsd, evidence, { value: arbitrationCost });
        const evidencePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.evidence];
        await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
          disputeCreationBlockTimestamp + evidencePeriodTime.toNumber(),
        ]);
        await klerosLiquid.passPeriod(expectedDisputeId);
        const votePeriodTime = (await klerosLiquid.getSubcourt(subcourtID)).timesPerPeriod[Period.vote];
        await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
          disputeCreationBlockTimestamp + evidencePeriodTime.toNumber() + votePeriodTime.toNumber(),
        ]);
        const ruling = ArbitratorDecision.PayClaim;
        await klerosLiquid.__setCurrentRulingAndPassPeriodFromVoteToAppeal(expectedDisputeId, ruling);
        await expect(klerosLiquidProxy.executeRuling(expectedDisputeId)).to.be.reverted;
      });
    });
  });
});
