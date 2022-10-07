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

describe('ClaimsManager', function () {
  let accessControlRegistry, api3Token, api3Pool, claimsManager, dapiServer, api3UsdAmountConverter, passiveArbitrator;
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
    const passiveArbitratorFactory = await hre.ethers.getContractFactory('PassiveArbitrator', roles.deployer);
    passiveArbitrator = await passiveArbitratorFactory.deploy(claimsManager.address);
    await accessControlRegistry
      .connect(roles.manager)
      .grantRole(await claimsManager.arbitratorRole(), passiveArbitrator.address);
  });

  describe('constructor', function () {
    context('Claims manager address is not zero', function () {
      it('constructs', async function () {
        expect(await passiveArbitrator.claimsManager()).to.equal(claimsManager.address);
      });
    });
    context('Claims manager address is zero', function () {
      it('reverts', async function () {
        const passiveArbitratorFactory = await hre.ethers.getContractFactory('PassiveArbitrator', roles.deployer);
        await expect(passiveArbitratorFactory.deploy(hre.ethers.constants.AddressZero)).to.be.revertedWith(
          'ClaimsManager address zero'
        );
      });
    });
  });

  describe('createDispute', function () {
    context('Sender is claimant', function () {
      context('PassiveArbitrator has the arbitrator role', function () {
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
                await expect(
                  passiveArbitrator
                    .connect(roles.claimant)
                    .createDispute(policyHash, claimant, claimAmountInUsd, evidence)
                )
                  .to.emit(claimsManager, 'CreatedDispute')
                  .withArgs(claimHash, claimant, passiveArbitrator.address);
                const claimState = await claimsManager.claimHashToState(claimHash);
                expect(claimState.status).to.equal(ClaimStatus.DisputeCreated);
                expect(claimState.updateTime).to.equal(disputeCreationBlockTimestamp);
                expect(claimState.arbitrator).to.equal(passiveArbitrator.address);
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
                await expect(
                  passiveArbitrator
                    .connect(roles.claimant)
                    .createDispute(policyHash, claimant, claimAmountInUsd, evidence)
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
              await expect(
                passiveArbitrator
                  .connect(roles.claimant)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence)
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
              await expect(
                passiveArbitrator
                  .connect(roles.claimant)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence)
              )
                .to.emit(claimsManager, 'CreatedDispute')
                .withArgs(claimHash, claimant, passiveArbitrator.address);
              const disputeCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const claimState = await claimsManager.claimHashToState(claimHash);
              expect(claimState.status).to.equal(ClaimStatus.DisputeCreated);
              expect(claimState.updateTime).to.equal(disputeCreationBlockTimestamp);
              expect(claimState.arbitrator).to.equal(passiveArbitrator.address);
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
              await expect(
                passiveArbitrator
                  .connect(roles.claimant)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence)
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
            const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
            const settlementAmountInApi3 = settlementAmountInUsd
              .mul(hre.ethers.utils.parseEther('1'))
              .div(api3UsdPriceWith18Decimals);
            await claimsManager
              .connect(roles.mediator)
              .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd);
            const minimumPayoutAmountInApi3 = settlementAmountInApi3;
            await claimsManager
              .connect(roles.claimant)
              .acceptSettlement(policyHash, claimAmountInUsd, evidence, minimumPayoutAmountInApi3);
            await expect(
              passiveArbitrator.connect(roles.claimant).createDispute(policyHash, claimant, claimAmountInUsd, evidence)
            ).to.be.revertedWith('Claim is not disputable');
          });
        });
      });
      context('PassiveArbitrator does not have the arbitrator role', function () {
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
            .connect(roles.manager)
            .revokeRole(await claimsManager.arbitratorRole(), passiveArbitrator.address);
          await expect(
            passiveArbitrator.connect(roles.claimant).createDispute(policyHash, claimant, claimAmountInUsd, evidence)
          ).to.be.revertedWith('Sender not arbitrator');
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
          passiveArbitrator.connect(roles.randomPerson).createDispute(policyHash, claimant, claimAmountInUsd, evidence)
        ).to.be.revertedWith('Sender not claimant');
      });
    });
  });
});
