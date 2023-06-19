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

describe('ClaimsManager', function () {
  let accessControlRegistry, api3Token, api3Pool, claimsManager, dapiServer, api3UsdAmountConverter;
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
      arbitrator: accounts[5],
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
    await accessControlRegistry
      .connect(roles.manager)
      .grantRole(await claimsManager.arbitratorRole(), roles.arbitrator.address);
    await accessControlRegistry
      .connect(roles.manager)
      .renounceRole(await claimsManager.adminRole(), roles.manager.address);
    await accessControlRegistry
      .connect(roles.manager)
      .renounceRole(await claimsManager.policyAgentRole(), roles.manager.address);
    await accessControlRegistry
      .connect(roles.manager)
      .renounceRole(await claimsManager.mediatorRole(), roles.manager.address);
    await accessControlRegistry
      .connect(roles.manager)
      .renounceRole(await claimsManager.arbitratorRole(), roles.manager.address);
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
  });

  describe('constructor', function () {
    context('API3 pool address is not zero', function () {
      context('Mediator response period is not zero', function () {
        context('Claimant response period is not zero', function () {
          context('Arbitrator response period is not zero', function () {
            it('constructs', async function () {
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
              expect(await claimsManager.accessControlRegistry()).to.equal(accessControlRegistry.address);
              expect(await claimsManager.adminRoleDescription()).to.equal('ClaimsManager admin');
              expect(await claimsManager.manager()).to.equal(roles.manager.address);
              const rootRole = hre.ethers.utils.solidityKeccak256(['address'], [roles.manager.address]);
              const adminRole = hre.ethers.utils.solidityKeccak256(
                ['bytes32', 'bytes32'],
                [rootRole, hre.ethers.utils.solidityKeccak256(['string'], ['ClaimsManager admin'])]
              );
              expect(await claimsManager.adminRole()).to.equal(adminRole);
              const policyAgentRole = hre.ethers.utils.solidityKeccak256(
                ['bytes32', 'bytes32'],
                [adminRole, hre.ethers.utils.solidityKeccak256(['string'], ['Policy agent'])]
              );
              expect(await claimsManager.policyAgentRole()).to.equal(policyAgentRole);
              const mediatorRole = hre.ethers.utils.solidityKeccak256(
                ['bytes32', 'bytes32'],
                [adminRole, hre.ethers.utils.solidityKeccak256(['string'], ['Mediator'])]
              );
              expect(await claimsManager.mediatorRole()).to.equal(mediatorRole);
              const arbitratorRole = hre.ethers.utils.solidityKeccak256(
                ['bytes32', 'bytes32'],
                [adminRole, hre.ethers.utils.solidityKeccak256(['string'], ['Arbitrator'])]
              );
              expect(await claimsManager.arbitratorRole()).to.equal(arbitratorRole);
              expect(await claimsManager.api3Pool()).to.equal(api3Pool.address);
              expect(await claimsManager.mediatorResponsePeriod()).to.equal(mediatorResponsePeriod);
              expect(await claimsManager.claimantResponsePeriod()).to.equal(claimantResponsePeriod);
              expect(await claimsManager.arbitratorResponsePeriod()).to.equal(arbitratorResponsePeriod);
            });
          });
          context('Arbitrator response period is zero', function () {
            it('reverts', async function () {
              const claimsManagerFactory = await hre.ethers.getContractFactory('ClaimsManager', roles.deployer);
              await expect(
                claimsManagerFactory.deploy(
                  accessControlRegistry.address,
                  'ClaimsManager admin',
                  roles.manager.address,
                  api3Pool.address,
                  mediatorResponsePeriod,
                  claimantResponsePeriod,
                  0
                )
              ).to.be.revertedWith('Arbitrator response period zero');
            });
          });
        });
        context('Claimant response period is zero', function () {
          it('reverts', async function () {
            const claimsManagerFactory = await hre.ethers.getContractFactory('ClaimsManager', roles.deployer);
            await expect(
              claimsManagerFactory.deploy(
                accessControlRegistry.address,
                'ClaimsManager admin',
                roles.manager.address,
                api3Pool.address,
                mediatorResponsePeriod,
                0,
                arbitratorResponsePeriod
              )
            ).to.be.revertedWith('Claimant response period zero');
          });
        });
      });
      context('Mediator response period is zero', function () {
        it('reverts', async function () {
          const claimsManagerFactory = await hre.ethers.getContractFactory('ClaimsManager', roles.deployer);
          await expect(
            claimsManagerFactory.deploy(
              accessControlRegistry.address,
              'ClaimsManager admin',
              roles.manager.address,
              api3Pool.address,
              0,
              claimantResponsePeriod,
              arbitratorResponsePeriod
            )
          ).to.be.revertedWith('Mediator response period zero');
        });
      });
    });
    context('API3 pool address is zero', function () {
      it('reverts', async function () {
        const claimsManagerFactory = await hre.ethers.getContractFactory('ClaimsManager', roles.deployer);
        await expect(
          claimsManagerFactory.deploy(
            accessControlRegistry.address,
            'ClaimsManager admin',
            roles.manager.address,
            hre.ethers.constants.AddressZero,
            mediatorResponsePeriod,
            claimantResponsePeriod,
            arbitratorResponsePeriod
          )
        ).to.be.revertedWith('Api3Pool address zero');
      });
    });
  });

  describe('setApi3UsdAmountConverter', function () {
    context('Sender is manager', function () {
      context('Api3UsdAmountConverter address is not zero', function () {
        it('sets Api3UsdAmountConverter', async function () {
          const newApi3UsdAmountConverter = hre.ethers.utils.getAddress(
            hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20))
          );
          await expect(claimsManager.connect(roles.manager).setApi3UsdAmountConverter(newApi3UsdAmountConverter))
            .to.emit(claimsManager, 'SetApi3UsdAmountConverter')
            .withArgs(newApi3UsdAmountConverter, roles.manager.address);
          expect(await claimsManager.api3UsdAmountConverter()).to.equal(newApi3UsdAmountConverter);
        });
      });
      context('Api3UsdAmountConverter address is zero', function () {
        it('reverts', async function () {
          await expect(
            claimsManager.connect(roles.manager).setApi3UsdAmountConverter(hre.ethers.constants.AddressZero)
          ).to.be.revertedWith('Api3UsdAmountConverter zero');
        });
      });
    });
    context('Sender is admin', function () {
      context('Api3UsdAmountConverter address is not zero', function () {
        it('sets Api3UsdAmountConverter', async function () {
          const newApi3UsdAmountConverter = hre.ethers.utils.getAddress(
            hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20))
          );
          await expect(claimsManager.connect(roles.admin).setApi3UsdAmountConverter(newApi3UsdAmountConverter))
            .to.emit(claimsManager, 'SetApi3UsdAmountConverter')
            .withArgs(newApi3UsdAmountConverter, roles.admin.address);
          expect(await claimsManager.api3UsdAmountConverter()).to.equal(newApi3UsdAmountConverter);
        });
      });
      context('Api3UsdAmountConverter address is zero', function () {
        it('reverts', async function () {
          await expect(
            claimsManager.connect(roles.admin).setApi3UsdAmountConverter(hre.ethers.constants.AddressZero)
          ).to.be.revertedWith('Api3UsdAmountConverter zero');
        });
      });
    });
    context('Sender is not manager or admin', function () {
      it('reverts', async function () {
        await expect(
          claimsManager.connect(roles.randomPerson).setApi3UsdAmountConverter(api3UsdAmountConverter.address)
        ).to.be.revertedWith('Sender cannot administrate');
      });
    });
  });

  describe('setApi3Pool', function () {
    context('Sender is manager', function () {
      context('Api3Pool address is not zero', function () {
        it('sets Api3Pool', async function () {
          const newApi3Pool = hre.ethers.utils.getAddress(hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20)));
          await expect(claimsManager.connect(roles.manager).setApi3Pool(newApi3Pool))
            .to.emit(claimsManager, 'SetApi3Pool')
            .withArgs(newApi3Pool, roles.manager.address);
          expect(await claimsManager.api3Pool()).to.equal(newApi3Pool);
        });
      });
      context('Api3Pool address is zero', function () {
        it('reverts', async function () {
          await expect(
            claimsManager.connect(roles.manager).setApi3Pool(hre.ethers.constants.AddressZero)
          ).to.be.revertedWith('Api3Pool address zero');
        });
      });
    });
    context('Sender is admin', function () {
      context('Api3Pool address is not zero', function () {
        it('sets Api3Pool', async function () {
          const newApi3Pool = hre.ethers.utils.getAddress(hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20)));
          await expect(claimsManager.connect(roles.admin).setApi3Pool(newApi3Pool))
            .to.emit(claimsManager, 'SetApi3Pool')
            .withArgs(newApi3Pool, roles.admin.address);
          expect(await claimsManager.api3Pool()).to.equal(newApi3Pool);
        });
      });
      context('Api3Pool address is zero', function () {
        it('reverts', async function () {
          await expect(
            claimsManager.connect(roles.admin).setApi3Pool(hre.ethers.constants.AddressZero)
          ).to.be.revertedWith('Api3Pool address zero');
        });
      });
    });
    context('Sender is not manager or admin', function () {
      it('reverts', async function () {
        await expect(
          claimsManager.connect(roles.randomPerson).setApi3Pool(api3UsdAmountConverter.address)
        ).to.be.revertedWith('Sender cannot administrate');
      });
    });
  });

  describe('setMediatorResponsePeriod', function () {
    context('Sender is manager', function () {
      context('Mediator response period is not zero', function () {
        it('sets mediator response period', async function () {
          const mediatorResponsePeriod = 1 * 24 * 60 * 60;
          await expect(claimsManager.connect(roles.manager).setMediatorResponsePeriod(mediatorResponsePeriod))
            .to.emit(claimsManager, 'SetMediatorResponsePeriod')
            .withArgs(mediatorResponsePeriod, roles.manager.address);
          expect(await claimsManager.mediatorResponsePeriod()).to.equal(mediatorResponsePeriod);
        });
      });
      context('Mediator response period is zero', function () {
        it('reverts', async function () {
          await expect(claimsManager.connect(roles.manager).setMediatorResponsePeriod(0)).to.be.revertedWith(
            'Mediator response period zero'
          );
        });
      });
    });
    context('Sender is admin', function () {
      context('Mediator response period is not zero', function () {
        it('sets mediator response period', async function () {
          const mediatorResponsePeriod = 1 * 24 * 60 * 60;
          await expect(claimsManager.connect(roles.admin).setMediatorResponsePeriod(mediatorResponsePeriod))
            .to.emit(claimsManager, 'SetMediatorResponsePeriod')
            .withArgs(mediatorResponsePeriod, roles.admin.address);
          expect(await claimsManager.mediatorResponsePeriod()).to.equal(mediatorResponsePeriod);
        });
      });
      context('Mediator response period is zero', function () {
        it('reverts', async function () {
          await expect(claimsManager.connect(roles.admin).setMediatorResponsePeriod(0)).to.be.revertedWith(
            'Mediator response period zero'
          );
        });
      });
    });
    context('Sender is not manager or admin', function () {
      it('reverts', async function () {
        await expect(claimsManager.connect(roles.randomPerson).setMediatorResponsePeriod(0)).to.be.revertedWith(
          'Sender cannot administrate'
        );
      });
    });
  });

  describe('setClaimantResponsePeriod', function () {
    context('Sender is manager', function () {
      context('Claimant response period is not zero', function () {
        it('sets claimant response period', async function () {
          const claimantResponsePeriod = 1 * 24 * 60 * 60;
          await expect(claimsManager.connect(roles.manager).setClaimantResponsePeriod(claimantResponsePeriod))
            .to.emit(claimsManager, 'SetClaimantResponsePeriod')
            .withArgs(claimantResponsePeriod, roles.manager.address);
          expect(await claimsManager.claimantResponsePeriod()).to.equal(claimantResponsePeriod);
        });
      });
      context('Claimant response period is zero', function () {
        it('reverts', async function () {
          await expect(claimsManager.connect(roles.manager).setClaimantResponsePeriod(0)).to.be.revertedWith(
            'Claimant response period zero'
          );
        });
      });
    });
    context('Sender is admin', function () {
      context('Claimant response period is not zero', function () {
        it('sets claimant response period', async function () {
          const claimantResponsePeriod = 1 * 24 * 60 * 60;
          await expect(claimsManager.connect(roles.admin).setClaimantResponsePeriod(claimantResponsePeriod))
            .to.emit(claimsManager, 'SetClaimantResponsePeriod')
            .withArgs(claimantResponsePeriod, roles.admin.address);
          expect(await claimsManager.claimantResponsePeriod()).to.equal(claimantResponsePeriod);
        });
      });
      context('Claimant response period is zero', function () {
        it('reverts', async function () {
          await expect(claimsManager.connect(roles.admin).setClaimantResponsePeriod(0)).to.be.revertedWith(
            'Claimant response period zero'
          );
        });
      });
    });
    context('Sender is not manager or admin', function () {
      it('reverts', async function () {
        await expect(claimsManager.connect(roles.randomPerson).setClaimantResponsePeriod(0)).to.be.revertedWith(
          'Sender cannot administrate'
        );
      });
    });
  });

  describe('setArbitratorResponsePeriod', function () {
    context('Sender is manager', function () {
      context('Arbitrator response period is not zero', function () {
        it('sets arbitrator response period', async function () {
          const arbitratorResponsePeriod = 1 * 24 * 60 * 60;
          await expect(claimsManager.connect(roles.manager).setArbitratorResponsePeriod(arbitratorResponsePeriod))
            .to.emit(claimsManager, 'SetArbitratorResponsePeriod')
            .withArgs(arbitratorResponsePeriod, roles.manager.address);
          expect(await claimsManager.arbitratorResponsePeriod()).to.equal(arbitratorResponsePeriod);
        });
      });
      context('Arbitrator response period is zero', function () {
        it('reverts', async function () {
          await expect(claimsManager.connect(roles.manager).setArbitratorResponsePeriod(0)).to.be.revertedWith(
            'Arbitrator response period zero'
          );
        });
      });
    });
    context('Sender is admin', function () {
      context('Arbitrator response period is not zero', function () {
        it('sets arbitrator response period', async function () {
          const arbitratorResponsePeriod = 1 * 24 * 60 * 60;
          await expect(claimsManager.connect(roles.admin).setArbitratorResponsePeriod(arbitratorResponsePeriod))
            .to.emit(claimsManager, 'SetArbitratorResponsePeriod')
            .withArgs(arbitratorResponsePeriod, roles.admin.address);
          expect(await claimsManager.arbitratorResponsePeriod()).to.equal(arbitratorResponsePeriod);
        });
      });
      context('Arbitrator response period is zero', function () {
        it('reverts', async function () {
          await expect(claimsManager.connect(roles.admin).setArbitratorResponsePeriod(0)).to.be.revertedWith(
            'Arbitrator response period zero'
          );
        });
      });
    });
    context('Sender is not manager or admin', function () {
      it('reverts', async function () {
        await expect(claimsManager.connect(roles.randomPerson).setArbitratorResponsePeriod(0)).to.be.revertedWith(
          'Sender cannot administrate'
        );
      });
    });
  });

  describe('setQuota', function () {
    context('Sender is manager', function () {
      it('sets quota', async function () {
        const account = hre.ethers.utils.getAddress(hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20)));
        const period = 7 * 24 * 60 * 60;
        const amountInApi3 = hre.ethers.utils.parseEther('1000000');
        await expect(claimsManager.connect(roles.manager).setQuota(account, period, amountInApi3))
          .to.emit(claimsManager, 'SetQuota')
          .withArgs(account, period, amountInApi3, roles.manager.address);
        const quota = await claimsManager.accountToQuota(account);
        expect(quota.period).is.equal(period);
        expect(quota.amount).is.equal(amountInApi3);
      });
    });
    context('Sender is admin', function () {
      it('sets quota', async function () {
        const account = hre.ethers.utils.getAddress(hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20)));
        const period = 7 * 24 * 60 * 60;
        const amountInApi3 = hre.ethers.utils.parseEther('1000000');
        await expect(claimsManager.connect(roles.admin).setQuota(account, period, amountInApi3))
          .to.emit(claimsManager, 'SetQuota')
          .withArgs(account, period, amountInApi3, roles.admin.address);
        const quota = await claimsManager.accountToQuota(account);
        expect(quota.period).is.equal(period);
        expect(quota.amount).is.equal(amountInApi3);
      });
    });
    context('Sender is not manager or admin', function () {
      it('reverts', async function () {
        await expect(
          claimsManager.connect(roles.randomPerson).setQuota(hre.ethers.constants.AddressZero, 0, 0)
        ).to.be.revertedWith('Sender cannot administrate');
      });
    });
  });

  describe('resetQuota', function () {
    context('Sender is manager', function () {
      it('resets quota', async function () {
        const account = hre.ethers.utils.getAddress(hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20)));
        const period = 7 * 24 * 60 * 60;
        const amountInApi3 = hre.ethers.utils.parseEther('1000000');
        await claimsManager.connect(roles.manager).setQuota(account, period, amountInApi3);
        await expect(claimsManager.connect(roles.manager).resetQuota(account))
          .to.emit(claimsManager, 'ResetQuota')
          .withArgs(account, roles.manager.address);
        const quota = await claimsManager.accountToQuota(account);
        expect(quota.period).is.equal(0);
        expect(quota.amount).is.equal(0);
      });
    });
    context('Sender is admin', function () {
      it('resets quota', async function () {
        const account = hre.ethers.utils.getAddress(hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20)));
        const period = 7 * 24 * 60 * 60;
        const amountInApi3 = hre.ethers.utils.parseEther('1000000');
        await claimsManager.connect(roles.admin).setQuota(account, period, amountInApi3);
        await expect(claimsManager.connect(roles.admin).resetQuota(account))
          .to.emit(claimsManager, 'ResetQuota')
          .withArgs(account, roles.admin.address);
        const quota = await claimsManager.accountToQuota(account);
        expect(quota.period).is.equal(0);
        expect(quota.amount).is.equal(0);
      });
    });
    context('Sender is not manager or admin', function () {
      it('reverts', async function () {
        await expect(
          claimsManager.connect(roles.randomPerson).resetQuota(hre.ethers.constants.AddressZero)
        ).to.be.revertedWith('Sender cannot administrate');
      });
    });
  });

  describe('createPolicy', function () {
    context('Sender is manager', function () {
      context('Claimant address is not zero', function () {
        context('Coverage amount is not zero', function () {
          context('Claim period does not start from timestamp-zero', function () {
            context('Claim period ends later than it starts', function () {
              context('Policy address is not empty', function () {
                context('Policy has not been created before', function () {
                  it('creates policy', async function () {
                    const claimant = roles.claimant.address;
                    const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                    // claimsAllowedFrom can be from the past
                    const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                    const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                    const policy = '/ipfs/Qm...testaddress';
                    const policyHash = hre.ethers.utils.solidityKeccak256(
                      ['address', 'uint32', 'string'],
                      [claimant, claimsAllowedFrom, policy]
                    );
                    await expect(
                      claimsManager
                        .connect(roles.manager)
                        .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
                    )
                      .to.emit(claimsManager, 'CreatedPolicy')
                      .withArgs(
                        claimant,
                        policyHash,
                        coverageAmountInUsd,
                        claimsAllowedFrom,
                        claimsAllowedUntil,
                        policy,
                        roles.manager.address
                      );
                    const policyState = await claimsManager.policyHashToState(policyHash);
                    expect(policyState.claimsAllowedUntil).to.equal(claimsAllowedUntil);
                    expect(policyState.coverageAmountInUsd).to.equal(coverageAmountInUsd);
                  });
                });
                context('Policy has been created before', function () {
                  it('reverts', async function () {
                    const claimant = roles.claimant.address;
                    const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                    const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                    const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                    const policy = '/ipfs/Qm...testaddress';
                    await claimsManager
                      .connect(roles.manager)
                      .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                    await expect(
                      claimsManager
                        .connect(roles.manager)
                        .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
                    ).to.be.revertedWith('Policy created before');
                  });
                });
              });
              context('Policy address is empty', function () {
                it('reverts', async function () {
                  const claimant = roles.claimant.address;
                  const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                  const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                  const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                  const policy = '';
                  await expect(
                    claimsManager
                      .connect(roles.manager)
                      .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
                  ).to.be.revertedWith('Policy address empty');
                });
              });
            });
            context('Claim period does not end later than it starts', function () {
              it('reverts', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom;
                const policy = '/ipfs/Qm...testaddress';
                await expect(
                  claimsManager
                    .connect(roles.manager)
                    .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
                ).to.be.revertedWith('Start not earlier than end');
              });
            });
          });
          context('Claim period starts from timestamp-zero', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = 0;
              const claimsAllowedUntil = (await hre.ethers.provider.getBlock()).timestamp + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              await expect(
                claimsManager
                  .connect(roles.manager)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
              ).to.be.revertedWith('Start time zero');
            });
          });
        });
        context('Coverage amount is zero', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const coverageAmountInUsd = 0;
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await expect(
              claimsManager
                .connect(roles.manager)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
            ).to.be.revertedWith('Coverage amount zero');
          });
        });
      });
      context('Claimant address is zero', function () {
        it('reverts', async function () {
          const claimant = hre.ethers.constants.AddressZero;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.manager)
              .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
          ).to.be.revertedWith('Claimant address zero');
        });
      });
    });
    context('Sender is admin', function () {
      context('Claimant address is not zero', function () {
        context('Coverage amount is not zero', function () {
          context('Claim period does not start from timestamp-zero', function () {
            context('Claim period ends later than it starts', function () {
              context('Policy address is not empty', function () {
                context('Policy has not been created before', function () {
                  it('creates policy', async function () {
                    const claimant = roles.claimant.address;
                    const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                    // claimsAllowedFrom can be from the past
                    const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                    const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                    const policy = '/ipfs/Qm...testaddress';
                    const policyHash = hre.ethers.utils.solidityKeccak256(
                      ['address', 'uint32', 'string'],
                      [claimant, claimsAllowedFrom, policy]
                    );
                    await expect(
                      claimsManager
                        .connect(roles.admin)
                        .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
                    )
                      .to.emit(claimsManager, 'CreatedPolicy')
                      .withArgs(
                        claimant,
                        policyHash,
                        coverageAmountInUsd,
                        claimsAllowedFrom,
                        claimsAllowedUntil,
                        policy,
                        roles.admin.address
                      );
                    const policyState = await claimsManager.policyHashToState(policyHash);
                    expect(policyState.claimsAllowedUntil).to.equal(claimsAllowedUntil);
                    expect(policyState.coverageAmountInUsd).to.equal(coverageAmountInUsd);
                  });
                });
                context('Policy has been created before', function () {
                  it('reverts', async function () {
                    const claimant = roles.claimant.address;
                    const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                    const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                    const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                    const policy = '/ipfs/Qm...testaddress';
                    await claimsManager
                      .connect(roles.admin)
                      .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                    await expect(
                      claimsManager
                        .connect(roles.admin)
                        .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
                    ).to.be.revertedWith('Policy created before');
                  });
                });
              });
              context('Policy address is empty', function () {
                it('reverts', async function () {
                  const claimant = roles.claimant.address;
                  const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                  const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                  const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                  const policy = '';
                  await expect(
                    claimsManager
                      .connect(roles.admin)
                      .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
                  ).to.be.revertedWith('Policy address empty');
                });
              });
            });
            context('Claim period does not end later than it starts', function () {
              it('reverts', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom;
                const policy = '/ipfs/Qm...testaddress';
                await expect(
                  claimsManager
                    .connect(roles.admin)
                    .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
                ).to.be.revertedWith('Start not earlier than end');
              });
            });
          });
          context('Claim period starts from timestamp-zero', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = 0;
              const claimsAllowedUntil = (await hre.ethers.provider.getBlock()).timestamp + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              await expect(
                claimsManager
                  .connect(roles.admin)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
              ).to.be.revertedWith('Start time zero');
            });
          });
        });
        context('Coverage amount is zero', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const coverageAmountInUsd = 0;
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await expect(
              claimsManager
                .connect(roles.admin)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
            ).to.be.revertedWith('Coverage amount zero');
          });
        });
      });
      context('Claimant address is zero', function () {
        it('reverts', async function () {
          const claimant = hre.ethers.constants.AddressZero;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.admin)
              .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
          ).to.be.revertedWith('Claimant address zero');
        });
      });
    });
    context('Sender is policy agent', function () {
      context('Claimant address is not zero', function () {
        context('Coverage amount is not zero', function () {
          context('Claim period does not start from timestamp-zero', function () {
            context('Claim period ends later than it starts', function () {
              context('Policy address is not empty', function () {
                context('Policy has not been created before', function () {
                  it('creates policy', async function () {
                    const claimant = roles.claimant.address;
                    const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                    // claimsAllowedFrom can be from the past
                    const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                    const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                    const policy = '/ipfs/Qm...testaddress';
                    const policyHash = hre.ethers.utils.solidityKeccak256(
                      ['address', 'uint32', 'string'],
                      [claimant, claimsAllowedFrom, policy]
                    );
                    await expect(
                      claimsManager
                        .connect(roles.policyAgent)
                        .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
                    )
                      .to.emit(claimsManager, 'CreatedPolicy')
                      .withArgs(
                        claimant,
                        policyHash,
                        coverageAmountInUsd,
                        claimsAllowedFrom,
                        claimsAllowedUntil,
                        policy,
                        roles.policyAgent.address
                      );
                    const policyState = await claimsManager.policyHashToState(policyHash);
                    expect(policyState.claimsAllowedUntil).to.equal(claimsAllowedUntil);
                    expect(policyState.coverageAmountInUsd).to.equal(coverageAmountInUsd);
                  });
                });
                context('Policy has been created before', function () {
                  it('reverts', async function () {
                    const claimant = roles.claimant.address;
                    const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                    const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                    const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                    const policy = '/ipfs/Qm...testaddress';
                    await claimsManager
                      .connect(roles.policyAgent)
                      .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                    await expect(
                      claimsManager
                        .connect(roles.policyAgent)
                        .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
                    ).to.be.revertedWith('Policy created before');
                  });
                });
              });
              context('Policy address is empty', function () {
                it('reverts', async function () {
                  const claimant = roles.claimant.address;
                  const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                  const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                  const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                  const policy = '';
                  await expect(
                    claimsManager
                      .connect(roles.policyAgent)
                      .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
                  ).to.be.revertedWith('Policy address empty');
                });
              });
            });
            context('Claim period does not end later than it starts', function () {
              it('reverts', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom;
                const policy = '/ipfs/Qm...testaddress';
                await expect(
                  claimsManager
                    .connect(roles.policyAgent)
                    .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
                ).to.be.revertedWith('Start not earlier than end');
              });
            });
          });
          context('Claim period starts from timestamp-zero', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = 0;
              const claimsAllowedUntil = (await hre.ethers.provider.getBlock()).timestamp + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              await expect(
                claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
              ).to.be.revertedWith('Start time zero');
            });
          });
        });
        context('Coverage amount is zero', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const coverageAmountInUsd = 0;
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await expect(
              claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
            ).to.be.revertedWith('Coverage amount zero');
          });
        });
      });
      context('Claimant address is zero', function () {
        it('reverts', async function () {
          const claimant = hre.ethers.constants.AddressZero;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
          ).to.be.revertedWith('Claimant address zero');
        });
      });
    });
    context('Sender is not manager, admin or policy agent', function () {
      it('reverts', async function () {
        await expect(
          claimsManager.connect(roles.randomPerson).createPolicy(hre.ethers.constants.AddressZero, 0, 0, 0, '')
        ).to.be.revertedWith('Sender cannot manage policy');
      });
    });
  });

  describe('upgradePolicy', function () {
    context('Sender is manager', function () {
      context('Policy exists', function () {
        context('Upgrade does not reduce coverage amount', function () {
          context('Upgrade does not reduce claim period', function () {
            it('upgrades policy', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              // claimsAllowedFrom can be from the past
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
              const newCoverageAmountInUsd = coverageAmountInUsd.add(hre.ethers.utils.parseEther('50000'));
              const newClaimsAllowedUntil = claimsAllowedUntil + 365 * 24 * 60 * 60;
              await expect(
                claimsManager
                  .connect(roles.manager)
                  .upgradePolicy(claimant, newCoverageAmountInUsd, claimsAllowedFrom, newClaimsAllowedUntil, policy)
              )
                .to.emit(claimsManager, 'UpgradedPolicy')
                .withArgs(
                  claimant,
                  policyHash,
                  newCoverageAmountInUsd,
                  claimsAllowedFrom,
                  newClaimsAllowedUntil,
                  policy,
                  roles.manager.address
                );
              const policyState = await claimsManager.policyHashToState(policyHash);
              expect(policyState.claimsAllowedUntil).to.equal(newClaimsAllowedUntil);
              expect(policyState.coverageAmountInUsd).to.equal(newCoverageAmountInUsd);
            });
          });
          context('Upgrade reduces claim period', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
              const newCoverageAmountInUsd = coverageAmountInUsd.add(hre.ethers.utils.parseEther('50000'));
              const newClaimsAllowedUntil = claimsAllowedUntil - 1;
              await expect(
                claimsManager
                  .connect(roles.manager)
                  .upgradePolicy(claimant, newCoverageAmountInUsd, claimsAllowedFrom, newClaimsAllowedUntil, policy)
              ).to.be.revertedWith('Reduces claim period');
            });
          });
        });
        context('Upgrade reduces coverage amount', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
            const newCoverageAmountInUsd = coverageAmountInUsd.sub(1);
            const newClaimsAllowedUntil = claimsAllowedUntil + 365 * 24 * 60 * 60;
            await expect(
              claimsManager
                .connect(roles.manager)
                .upgradePolicy(claimant, newCoverageAmountInUsd, claimsAllowedFrom, newClaimsAllowedUntil, policy)
            ).to.be.revertedWith('Reduces coverage amount');
          });
        });
      });
      context('Policy does not exist', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.manager)
              .upgradePolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
          ).to.be.revertedWith('Policy does not exist');
        });
      });
    });
    context('Sender is admin', function () {
      context('Policy exists', function () {
        context('Upgrade does not reduce coverage amount', function () {
          context('Upgrade does not reduce claim period', function () {
            it('upgrades policy', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              // claimsAllowedFrom can be from the past
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
              const newCoverageAmountInUsd = coverageAmountInUsd.add(hre.ethers.utils.parseEther('50000'));
              const newClaimsAllowedUntil = claimsAllowedUntil + 365 * 24 * 60 * 60;
              await expect(
                claimsManager
                  .connect(roles.admin)
                  .upgradePolicy(claimant, newCoverageAmountInUsd, claimsAllowedFrom, newClaimsAllowedUntil, policy)
              )
                .to.emit(claimsManager, 'UpgradedPolicy')
                .withArgs(
                  claimant,
                  policyHash,
                  newCoverageAmountInUsd,
                  claimsAllowedFrom,
                  newClaimsAllowedUntil,
                  policy,
                  roles.admin.address
                );
              const policyState = await claimsManager.policyHashToState(policyHash);
              expect(policyState.claimsAllowedUntil).to.equal(newClaimsAllowedUntil);
              expect(policyState.coverageAmountInUsd).to.equal(newCoverageAmountInUsd);
            });
          });
          context('Upgrade reduces claim period', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
              const newCoverageAmountInUsd = coverageAmountInUsd.add(hre.ethers.utils.parseEther('50000'));
              const newClaimsAllowedUntil = claimsAllowedUntil - 1;
              await expect(
                claimsManager
                  .connect(roles.admin)
                  .upgradePolicy(claimant, newCoverageAmountInUsd, claimsAllowedFrom, newClaimsAllowedUntil, policy)
              ).to.be.revertedWith('Reduces claim period');
            });
          });
        });
        context('Upgrade reduces coverage amount', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
            const newCoverageAmountInUsd = coverageAmountInUsd.sub(1);
            const newClaimsAllowedUntil = claimsAllowedUntil + 365 * 24 * 60 * 60;
            await expect(
              claimsManager
                .connect(roles.admin)
                .upgradePolicy(claimant, newCoverageAmountInUsd, claimsAllowedFrom, newClaimsAllowedUntil, policy)
            ).to.be.revertedWith('Reduces coverage amount');
          });
        });
      });
      context('Policy does not exist', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.admin)
              .upgradePolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
          ).to.be.revertedWith('Policy does not exist');
        });
      });
    });
    context('Sender is policy agent', function () {
      context('Policy exists', function () {
        context('Upgrade does not reduce coverage amount', function () {
          context('Upgrade does not reduce claim period', function () {
            it('upgrades policy', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              // claimsAllowedFrom can be from the past
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
              const newCoverageAmountInUsd = coverageAmountInUsd.add(hre.ethers.utils.parseEther('50000'));
              const newClaimsAllowedUntil = claimsAllowedUntil + 365 * 24 * 60 * 60;
              await expect(
                claimsManager
                  .connect(roles.policyAgent)
                  .upgradePolicy(claimant, newCoverageAmountInUsd, claimsAllowedFrom, newClaimsAllowedUntil, policy)
              )
                .to.emit(claimsManager, 'UpgradedPolicy')
                .withArgs(
                  claimant,
                  policyHash,
                  newCoverageAmountInUsd,
                  claimsAllowedFrom,
                  newClaimsAllowedUntil,
                  policy,
                  roles.policyAgent.address
                );
              const policyState = await claimsManager.policyHashToState(policyHash);
              expect(policyState.claimsAllowedUntil).to.equal(newClaimsAllowedUntil);
              expect(policyState.coverageAmountInUsd).to.equal(newCoverageAmountInUsd);
            });
          });
          context('Upgrade reduces claim period', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
              const newCoverageAmountInUsd = coverageAmountInUsd.add(hre.ethers.utils.parseEther('50000'));
              const newClaimsAllowedUntil = claimsAllowedUntil - 1;
              await expect(
                claimsManager
                  .connect(roles.policyAgent)
                  .upgradePolicy(claimant, newCoverageAmountInUsd, claimsAllowedFrom, newClaimsAllowedUntil, policy)
              ).to.be.revertedWith('Reduces claim period');
            });
          });
        });
        context('Upgrade reduces coverage amount', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
            const newCoverageAmountInUsd = coverageAmountInUsd.sub(1);
            const newClaimsAllowedUntil = claimsAllowedUntil + 365 * 24 * 60 * 60;
            await expect(
              claimsManager
                .connect(roles.policyAgent)
                .upgradePolicy(claimant, newCoverageAmountInUsd, claimsAllowedFrom, newClaimsAllowedUntil, policy)
            ).to.be.revertedWith('Reduces coverage amount');
          });
        });
      });
      context('Policy does not exist', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.policyAgent)
              .upgradePolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
          ).to.be.revertedWith('Policy does not exist');
        });
      });
    });
    context('Sender is not manager, admin or policy agent', function () {
      it('reverts', async function () {
        await expect(
          claimsManager.connect(roles.randomPerson).upgradePolicy(hre.ethers.constants.AddressZero, 0, 0, 0, '')
        ).to.be.revertedWith('Sender cannot manage policy');
      });
    });
  });

  describe('downgradePolicy', function () {
    context('Sender is manager', function () {
      context('Claim period ends later than it starts', function () {
        context('Policy exists', function () {
          context('Downgrade does not increase coverage amount', function () {
            context('Downgrade does not increase claim period', function () {
              it('downgrades policy', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                // claimsAllowedFrom can be from the past
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
                const newCoverageAmountInUsd = coverageAmountInUsd.sub(hre.ethers.utils.parseEther('10000'));
                const newClaimsAllowedUntil = claimsAllowedUntil - 30 * 24 * 60 * 60;
                await expect(
                  claimsManager
                    .connect(roles.manager)
                    .downgradePolicy(claimant, newCoverageAmountInUsd, claimsAllowedFrom, newClaimsAllowedUntil, policy)
                )
                  .to.emit(claimsManager, 'DowngradedPolicy')
                  .withArgs(
                    claimant,
                    policyHash,
                    newCoverageAmountInUsd,
                    claimsAllowedFrom,
                    newClaimsAllowedUntil,
                    policy,
                    roles.manager.address
                  );
                const policyState = await claimsManager.policyHashToState(policyHash);
                expect(policyState.claimsAllowedUntil).to.equal(newClaimsAllowedUntil);
                expect(policyState.coverageAmountInUsd).to.equal(newCoverageAmountInUsd);
              });
            });
            context('Downgrade increases claim period', function () {
              it('reverts', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                const newCoverageAmountInUsd = coverageAmountInUsd.sub(hre.ethers.utils.parseEther('10000'));
                const newClaimsAllowedUntil = claimsAllowedUntil + 1;
                await expect(
                  claimsManager
                    .connect(roles.manager)
                    .downgradePolicy(claimant, newCoverageAmountInUsd, claimsAllowedFrom, newClaimsAllowedUntil, policy)
                ).to.be.revertedWith('Increases claim period');
              });
            });
          });
          context('Downgrade increases coverage amount', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
              const newCoverageAmountInUsd = coverageAmountInUsd.add(1);
              const newClaimsAllowedUntil = claimsAllowedUntil - 30 * 24 * 60 * 60;
              await expect(
                claimsManager
                  .connect(roles.manager)
                  .downgradePolicy(claimant, newCoverageAmountInUsd, claimsAllowedFrom, newClaimsAllowedUntil, policy)
              ).to.be.revertedWith('Increases coverage amount');
            });
          });
        });
        context('Policy does not exist', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await expect(
              claimsManager
                .connect(roles.manager)
                .downgradePolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
            ).to.be.revertedWith('Policy does not exist');
          });
        });
      });
      context('Claim period does not end later than it starts', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom;
          const policy = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.manager)
              .downgradePolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
          ).to.be.revertedWith('Start not earlier than end');
        });
      });
    });
    context('Sender is admin', function () {
      context('Claim period ends later than it starts', function () {
        context('Policy exists', function () {
          context('Downgrade does not increase coverage amount', function () {
            context('Downgrade does not increase claim period', function () {
              it('downgrades policy', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                // claimsAllowedFrom can be from the past
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
                const newCoverageAmountInUsd = coverageAmountInUsd.sub(hre.ethers.utils.parseEther('10000'));
                const newClaimsAllowedUntil = claimsAllowedUntil - 30 * 24 * 60 * 60;
                await expect(
                  claimsManager
                    .connect(roles.admin)
                    .downgradePolicy(claimant, newCoverageAmountInUsd, claimsAllowedFrom, newClaimsAllowedUntil, policy)
                )
                  .to.emit(claimsManager, 'DowngradedPolicy')
                  .withArgs(
                    claimant,
                    policyHash,
                    newCoverageAmountInUsd,
                    claimsAllowedFrom,
                    newClaimsAllowedUntil,
                    policy,
                    roles.admin.address
                  );
                const policyState = await claimsManager.policyHashToState(policyHash);
                expect(policyState.claimsAllowedUntil).to.equal(newClaimsAllowedUntil);
                expect(policyState.coverageAmountInUsd).to.equal(newCoverageAmountInUsd);
              });
            });
            context('Downgrade increases claim period', function () {
              it('reverts', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                const newCoverageAmountInUsd = coverageAmountInUsd.sub(hre.ethers.utils.parseEther('10000'));
                const newClaimsAllowedUntil = claimsAllowedUntil + 1;
                await expect(
                  claimsManager
                    .connect(roles.admin)
                    .downgradePolicy(claimant, newCoverageAmountInUsd, claimsAllowedFrom, newClaimsAllowedUntil, policy)
                ).to.be.revertedWith('Increases claim period');
              });
            });
          });
          context('Downgrade increases coverage amount', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
              const newCoverageAmountInUsd = coverageAmountInUsd.add(1);
              const newClaimsAllowedUntil = claimsAllowedUntil - 30 * 24 * 60 * 60;
              await expect(
                claimsManager
                  .connect(roles.admin)
                  .downgradePolicy(claimant, newCoverageAmountInUsd, claimsAllowedFrom, newClaimsAllowedUntil, policy)
              ).to.be.revertedWith('Increases coverage amount');
            });
          });
        });
        context('Policy does not exist', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await expect(
              claimsManager
                .connect(roles.admin)
                .downgradePolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
            ).to.be.revertedWith('Policy does not exist');
          });
        });
      });
      context('Claim period does not end later than it starts', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom;
          const policy = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.admin)
              .downgradePolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
          ).to.be.revertedWith('Start not earlier than end');
        });
      });
    });
    context('Sender is claimant', function () {
      context('Claim period ends later than it starts', function () {
        context('Policy exists', function () {
          context('Downgrade does not increase coverage amount', function () {
            context('Downgrade does not increase claim period', function () {
              it('downgrades policy', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                // claimsAllowedFrom can be from the past
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
                const newCoverageAmountInUsd = coverageAmountInUsd.sub(hre.ethers.utils.parseEther('10000'));
                const newClaimsAllowedUntil = claimsAllowedUntil - 30 * 24 * 60 * 60;
                await expect(
                  claimsManager
                    .connect(roles.claimant)
                    .downgradePolicy(claimant, newCoverageAmountInUsd, claimsAllowedFrom, newClaimsAllowedUntil, policy)
                )
                  .to.emit(claimsManager, 'DowngradedPolicy')
                  .withArgs(
                    claimant,
                    policyHash,
                    newCoverageAmountInUsd,
                    claimsAllowedFrom,
                    newClaimsAllowedUntil,
                    policy,
                    claimant
                  );
                const policyState = await claimsManager.policyHashToState(policyHash);
                expect(policyState.claimsAllowedUntil).to.equal(newClaimsAllowedUntil);
                expect(policyState.coverageAmountInUsd).to.equal(newCoverageAmountInUsd);
              });
            });
            context('Downgrade increases claim period', function () {
              it('reverts', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                const newCoverageAmountInUsd = coverageAmountInUsd.sub(hre.ethers.utils.parseEther('10000'));
                const newClaimsAllowedUntil = claimsAllowedUntil + 1;
                await expect(
                  claimsManager
                    .connect(roles.claimant)
                    .downgradePolicy(claimant, newCoverageAmountInUsd, claimsAllowedFrom, newClaimsAllowedUntil, policy)
                ).to.be.revertedWith('Increases claim period');
              });
            });
          });
          context('Downgrade increases coverage amount', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
              const newCoverageAmountInUsd = coverageAmountInUsd.add(1);
              const newClaimsAllowedUntil = claimsAllowedUntil - 30 * 24 * 60 * 60;
              await expect(
                claimsManager
                  .connect(roles.claimant)
                  .downgradePolicy(claimant, newCoverageAmountInUsd, claimsAllowedFrom, newClaimsAllowedUntil, policy)
              ).to.be.revertedWith('Increases coverage amount');
            });
          });
        });
        context('Policy does not exist', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await expect(
              claimsManager
                .connect(roles.claimant)
                .downgradePolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
            ).to.be.revertedWith('Policy does not exist');
          });
        });
      });
      context('Claim period does not end later than it starts', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom;
          const policy = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.claimant)
              .downgradePolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
          ).to.be.revertedWith('Start not earlier than end');
        });
      });
    });
    context('Sender is not manager, admin or claimant', function () {
      it('reverts', async function () {
        const claimant = roles.claimant.address;
        const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
        const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
        const claimsAllowedUntil = claimsAllowedFrom;
        const policy = '/ipfs/Qm...testaddress';
        await expect(
          claimsManager
            .connect(roles.randomPerson)
            .downgradePolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
        ).to.be.revertedWith('Sender cannot downgrade policies');
      });
    });
  });

  describe('announcePolicyMetadata', function () {
    context('Sender is manager', function () {
      context('Policy exists', function () {
        it('announces policy metadata', async function () {
          const claimant = roles.claimant.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          // claimsAllowedFrom can be from the past
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          const policyHash = hre.ethers.utils.solidityKeccak256(
            ['address', 'uint32', 'string'],
            [claimant, claimsAllowedFrom, policy]
          );
          const metadata = 'dAPI:ETH/USD...testmetadata';
          await claimsManager
            .connect(roles.policyAgent)
            .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
          await expect(
            claimsManager.connect(roles.manager).announcePolicyMetadata(claimant, claimsAllowedFrom, policy, metadata)
          )
            .to.emit(claimsManager, 'AnnouncedPolicyMetadata')
            .withArgs(claimant, policyHash, metadata, roles.manager.address);
        });
      });
      context('Policy does not exist', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const policy = '/ipfs/Qm...testaddress';
          const metadata = 'dAPI:ETH/USD...testmetadata';
          await expect(
            claimsManager.connect(roles.manager).announcePolicyMetadata(claimant, claimsAllowedFrom, policy, metadata)
          ).to.be.revertedWith('Policy does not exist');
        });
      });
    });
    context('Sender is admin', function () {
      context('Policy exists', function () {
        it('announces policy metadata', async function () {
          const claimant = roles.claimant.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          // claimsAllowedFrom can be from the past
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          const policyHash = hre.ethers.utils.solidityKeccak256(
            ['address', 'uint32', 'string'],
            [claimant, claimsAllowedFrom, policy]
          );
          const metadata = 'dAPI:ETH/USD...testmetadata';
          await claimsManager
            .connect(roles.policyAgent)
            .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
          await expect(
            claimsManager.connect(roles.admin).announcePolicyMetadata(claimant, claimsAllowedFrom, policy, metadata)
          )
            .to.emit(claimsManager, 'AnnouncedPolicyMetadata')
            .withArgs(claimant, policyHash, metadata, roles.admin.address);
        });
      });
      context('Policy does not exist', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const policy = '/ipfs/Qm...testaddress';
          const metadata = 'dAPI:ETH/USD...testmetadata';
          await expect(
            claimsManager.connect(roles.admin).announcePolicyMetadata(claimant, claimsAllowedFrom, policy, metadata)
          ).to.be.revertedWith('Policy does not exist');
        });
      });
    });
    context('Sender is policy agent', function () {
      context('Policy exists', function () {
        it('announces policy metadata', async function () {
          const claimant = roles.claimant.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          // claimsAllowedFrom can be from the past
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          const policyHash = hre.ethers.utils.solidityKeccak256(
            ['address', 'uint32', 'string'],
            [claimant, claimsAllowedFrom, policy]
          );
          const metadata = 'dAPI:ETH/USD...testmetadata';
          await claimsManager
            .connect(roles.policyAgent)
            .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
          await expect(
            claimsManager
              .connect(roles.policyAgent)
              .announcePolicyMetadata(claimant, claimsAllowedFrom, policy, metadata)
          )
            .to.emit(claimsManager, 'AnnouncedPolicyMetadata')
            .withArgs(claimant, policyHash, metadata, roles.policyAgent.address);
        });
      });
      context('Policy does not exist', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const policy = '/ipfs/Qm...testaddress';
          const metadata = 'dAPI:ETH/USD...testmetadata';
          await expect(
            claimsManager
              .connect(roles.policyAgent)
              .announcePolicyMetadata(claimant, claimsAllowedFrom, policy, metadata)
          ).to.be.revertedWith('Policy does not exist');
        });
      });
    });
    context('Sender is not manager, admin or policy agent', function () {
      it('reverts', async function () {
        const claimant = roles.claimant.address;
        const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
        const policy = '/ipfs/Qm...testaddress';
        const metadata = 'dAPI:ETH/USD...testmetadata';
        await expect(
          claimsManager
            .connect(roles.randomPerson)
            .announcePolicyMetadata(claimant, claimsAllowedFrom, policy, metadata)
        ).to.be.revertedWith('Sender cannot manage policy');
      });
    });
  });

  describe('createClaim', function () {
    context('Claim amount is not zero', function () {
      context('Claim period has started', function () {
        context('Evidence address is not empty', function () {
          context('Policy exists', function () {
            context('Claim amount is not larger than coverage', function () {
              context('Claim period has not ended', function () {
                context('Claim has not been created before', function () {
                  it('creates claim', async function () {
                    const claimant = roles.claimant.address;
                    const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                    // claimsAllowedFrom can be from the past
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
                    const claimHash = hre.ethers.utils.solidityKeccak256(
                      ['bytes32', 'address', 'uint224', 'string'],
                      [policyHash, claimant, claimAmountInUsd, evidence]
                    );
                    const currentBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                    const claimCreationBlockTimestamp = currentBlockTimestamp + 1;
                    await hre.ethers.provider.send('evm_setNextBlockTimestamp', [claimCreationBlockTimestamp]);
                    await expect(
                      claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence)
                    )
                      .to.emit(claimsManager, 'CreatedClaim')
                      .withArgs(
                        claimant,
                        policyHash,
                        claimHash,
                        claimsAllowedFrom,
                        policy,
                        claimAmountInUsd,
                        evidence,
                        claimCreationBlockTimestamp
                      );
                    const claimState = await claimsManager.claimHashToState(claimHash);
                    expect(claimState.status).to.equal(ClaimStatus.ClaimCreated);
                    expect(claimState.updateTime).to.equal(claimCreationBlockTimestamp);
                    expect(claimState.arbitrator).to.equal(hre.ethers.constants.AddressZero);
                  });
                });
                context('Claim has been created before', function () {
                  it('reverts', async function () {
                    const claimant = roles.claimant.address;
                    const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                    const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                    const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                    const policy = '/ipfs/Qm...testaddress';
                    await claimsManager
                      .connect(roles.policyAgent)
                      .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                    const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                    const evidence = '/ipfs/Qm...testaddress';
                    await claimsManager
                      .connect(roles.claimant)
                      .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                    await expect(
                      claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence)
                    ).to.be.revertedWith('Claim already exists');
                  });
                });
              });
              context('Claim period has ended', function () {
                it('reverts', async function () {
                  const claimant = roles.claimant.address;
                  const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                  const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                  const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                  const policy = '/ipfs/Qm...testaddress';
                  await claimsManager
                    .connect(roles.policyAgent)
                    .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                  const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                  const evidence = '/ipfs/Qm...testaddress';
                  const claimCreationBlockTimestamp = claimsAllowedUntil + 1;
                  await hre.ethers.provider.send('evm_setNextBlockTimestamp', [claimCreationBlockTimestamp]);
                  await expect(
                    claimsManager
                      .connect(roles.claimant)
                      .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence)
                  ).to.be.revertedWith('Claims not allowed anymore');
                });
              });
            });
            context('Claim amount is larger than coverage', function () {
              it('reverts', async function () {
                const claimant = roles.claimant.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
                const claimAmountInUsd = coverageAmountInUsd.add(1);
                const evidence = '/ipfs/Qm...testaddress';
                await expect(
                  claimsManager
                    .connect(roles.claimant)
                    .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence)
                ).to.be.revertedWith('Claim larger than coverage');
              });
            });
          });
          context('Policy does not exist', function () {
            it('reverts', async function () {
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const policy = '/ipfs/Qm...testaddress';
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              const evidence = '/ipfs/Qm...testaddress';
              await expect(
                claimsManager.connect(roles.claimant).createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence)
              ).to.be.revertedWith('Claim larger than coverage');
            });
          });
        });
        context('Evidence address is empty', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
            const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
            const evidence = '';
            await expect(
              claimsManager.connect(roles.claimant).createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence)
            ).to.be.revertedWith('Evidence address empty');
          });
        });
      });
      context('Claim period has not started', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp + 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          await claimsManager
            .connect(roles.policyAgent)
            .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
          const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
          const evidence = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager.connect(roles.claimant).createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence)
          ).to.be.revertedWith('Claims not allowed yet');
        });
      });
    });
    context('Claim amount is zero', function () {
      it('reverts', async function () {
        const claimant = roles.claimant.address;
        const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
        const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
        const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
        const policy = '/ipfs/Qm...testaddress';
        await claimsManager
          .connect(roles.policyAgent)
          .createPolicy(claimant, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
        const claimAmountInUsd = 0;
        const evidence = '/ipfs/Qm...testaddress';
        await expect(
          claimsManager.connect(roles.claimant).createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence)
        ).to.be.revertedWith('Claim amount zero');
      });
    });
  });

  describe('acceptClaim', function () {
    context('Sender is manager', function () {
      context('Claim exists', function () {
        context('Claim is acceptable', function () {
          context('It is not too late to accept the claim', function () {
            context('Api3UsdAmountConverter is valid', function () {
              context('Payout does not cause the sender quota to be exceeded', function () {
                context('Coverage covers the entire payout', function () {
                  context('Pool has enough funds', function () {
                    it('accepts and pays out the claim fully, updates coverage and records usage', async function () {
                      const quotaPeriod = 7 * 24 * 60 * 60;
                      const quotaAmount = hre.ethers.utils.parseEther('1000000');
                      await claimsManager
                        .connect(roles.admin)
                        .setQuota(roles.manager.address, quotaPeriod, quotaAmount);
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
                      const payoutAmountInUsd = claimAmountInUsd;
                      const payoutAmountInApi3 = claimAmountInUsd
                        .mul(hre.ethers.utils.parseEther('1'))
                        .div(api3UsdPriceWith18Decimals);
                      await expect(
                        claimsManager
                          .connect(roles.manager)
                          .acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
                      )
                        .to.emit(claimsManager, 'AcceptedClaim')
                        .withArgs(
                          claimant,
                          policyHash,
                          claimHash,
                          payoutAmountInUsd,
                          payoutAmountInApi3,
                          roles.manager.address
                        );
                      const claimAcceptanceTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                      const claimState = await claimsManager.claimHashToState(claimHash);
                      expect(claimState.status).to.equal(ClaimStatus.ClaimAccepted);
                      expect(claimState.updateTime).to.equal(claimAcceptanceTimestamp);
                      expect(claimState.arbitrator).to.equal(hre.ethers.constants.AddressZero);
                      expect(await api3Token.balanceOf(claimant)).to.equal(payoutAmountInApi3);
                      const policyState = await claimsManager.policyHashToState(policyHash);
                      expect(policyState.coverageAmountInUsd).to.equal(coverageAmountInUsd.sub(payoutAmountInUsd));
                      expect(await claimsManager.getQuotaUsage(roles.manager.address)).to.equal(payoutAmountInApi3);
                    });
                  });
                  context('Pool does not have enough funds', function () {
                    it('reverts', async function () {
                      const usdAmountThatExceedsTotalStake = api3UsdPriceWith18Decimals.gt(
                        hre.ethers.utils.parseEther('1')
                      )
                        ? totalStake
                            .mul(api3UsdPriceWith18Decimals)
                            .div(hre.ethers.utils.parseEther('1'))
                            .add(api3UsdPriceWith18Decimals.div(hre.ethers.utils.parseEther('1')))
                        : totalStake.mul(api3UsdPriceWith18Decimals).div(hre.ethers.utils.parseEther('1')).add(1);
                      const claimant = roles.claimant.address;
                      const coverageAmountInUsd = usdAmountThatExceedsTotalStake;
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
                      const claimAmountInUsd = usdAmountThatExceedsTotalStake;
                      const evidence = '/ipfs/Qm...testaddress';
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                      await expect(
                        claimsManager
                          .connect(roles.manager)
                          .acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
                      ).to.be.revertedWith('Pool: Amount exceeds total stake');
                    });
                  });
                });
                context('Coverage does not cover the entire payout', function () {
                  context('Pool has enough funds', function () {
                    it('accepts and pays out the remaining coverage, updates coverage and records usage', async function () {
                      const quotaPeriod = 7 * 24 * 60 * 60;
                      const quotaAmount = hre.ethers.utils.parseEther('1000000');
                      await claimsManager
                        .connect(roles.admin)
                        .setQuota(roles.manager.address, quotaPeriod, quotaAmount);
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
                      const evidence = '/ipfs/Qm...testaddress';
                      const claimAmountInUsd1 = hre.ethers.utils.parseEther('40000');
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                      const claimAmountInUsd2 = hre.ethers.utils.parseEther('25000');
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                      const claimHash2 = hre.ethers.utils.solidityKeccak256(
                        ['bytes32', 'address', 'uint224', 'string'],
                        [policyHash, claimant, claimAmountInUsd2, evidence]
                      );
                      await claimsManager
                        .connect(roles.mediator)
                        .acceptClaim(policyHash, claimant, claimAmountInUsd1, evidence);
                      const payoutAmountInUsd = coverageAmountInUsd.sub(claimAmountInUsd1).lt(claimAmountInUsd2)
                        ? coverageAmountInUsd.sub(claimAmountInUsd1)
                        : claimAmountInUsd2;
                      const payoutAmountInApi3 = payoutAmountInUsd
                        .mul(hre.ethers.utils.parseEther('1'))
                        .div(api3UsdPriceWith18Decimals);
                      const claimantBalance = await api3Token.balanceOf(claimant);
                      const coverageAmount = (await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd;
                      const quotaUsage = await claimsManager.getQuotaUsage(roles.manager.address);
                      await expect(
                        claimsManager
                          .connect(roles.manager)
                          .acceptClaim(policyHash, claimant, claimAmountInUsd2, evidence)
                      )
                        .to.emit(claimsManager, 'AcceptedClaim')
                        .withArgs(
                          claimant,
                          policyHash,
                          claimHash2,
                          payoutAmountInUsd,
                          payoutAmountInApi3,
                          roles.manager.address
                        );
                      const claimAcceptanceTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                      const claimState = await claimsManager.claimHashToState(claimHash2);
                      expect(claimState.status).to.equal(ClaimStatus.ClaimAccepted);
                      expect(claimState.updateTime).to.equal(claimAcceptanceTimestamp);
                      expect(claimState.arbitrator).to.equal(hre.ethers.constants.AddressZero);
                      expect((await api3Token.balanceOf(claimant)).sub(claimantBalance)).to.equal(payoutAmountInApi3);
                      expect(
                        coverageAmount.sub((await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd)
                      ).to.equal(payoutAmountInUsd);
                      expect((await claimsManager.getQuotaUsage(roles.manager.address)).sub(quotaUsage)).to.equal(
                        payoutAmountInApi3
                      );
                    });
                  });
                  context('Pool does not have enough funds', function () {
                    it('reverts', async function () {
                      const usdAmountThatExceedsTotalStake = api3UsdPriceWith18Decimals.gt(
                        hre.ethers.utils.parseEther('1')
                      )
                        ? totalStake
                            .mul(api3UsdPriceWith18Decimals)
                            .div(hre.ethers.utils.parseEther('1'))
                            .add(api3UsdPriceWith18Decimals.div(hre.ethers.utils.parseEther('1')))
                        : totalStake.mul(api3UsdPriceWith18Decimals).div(hre.ethers.utils.parseEther('1')).add(1);
                      const claimant = roles.claimant.address;
                      const coverageAmountInUsd = usdAmountThatExceedsTotalStake.mul(2);
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
                      const evidence = '/ipfs/Qm...testaddress';
                      const claimAmountInUsd1 = 1;
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                      const claimAmountInUsd2 = coverageAmountInUsd;
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                      await claimsManager
                        .connect(roles.mediator)
                        .acceptClaim(policyHash, claimant, claimAmountInUsd1, evidence);
                      await expect(
                        claimsManager
                          .connect(roles.manager)
                          .acceptClaim(policyHash, claimant, claimAmountInUsd2, evidence)
                      ).to.be.revertedWith('Pool: Amount exceeds total stake');
                    });
                  });
                });
              });
              context('Payout causes the sender quota to be exceeded', function () {
                it('reverts', async function () {
                  const quotaPeriod = 7 * 24 * 60 * 60;
                  const quotaAmount = hre.ethers.utils.parseEther('1000');
                  await claimsManager.connect(roles.admin).setQuota(roles.manager.address, quotaPeriod, quotaAmount);
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
                  const evidence = '/ipfs/Qm...testaddress';
                  const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                  await claimsManager
                    .connect(roles.claimant)
                    .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                  await expect(
                    claimsManager.connect(roles.manager).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
                  ).to.be.revertedWith('Quota exceeded');
                });
              });
            });
            context('Api3UsdAmountConverter is not valid', function () {
              it('reverts', async function () {
                const invalidApi3UsdAmountConverter = '0x00000000000000000000000000000000DeaDBeef';
                await claimsManager.connect(roles.admin).setApi3UsdAmountConverter(invalidApi3UsdAmountConverter);

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
                const evidence = '/ipfs/Qm...testaddress';
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                await expect(
                  claimsManager.connect(roles.manager).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
                ).to.be.revertedWithoutReason;
              });
            });
          });
          context('It is too late to accept the claim', function () {
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
              const evidence = '/ipfs/Qm...testaddress';
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              await claimsManager
                .connect(roles.claimant)
                .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                claimCreationBlockTimestamp + mediatorResponsePeriod,
              ]);
              await expect(
                claimsManager.connect(roles.manager).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
              ).to.be.revertedWith('Too late to accept claim');
            });
          });
        });
        context('Claim is not acceptable', function () {
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
            const evidence = '/ipfs/Qm...testaddress';
            const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
            await claimsManager
              .connect(roles.claimant)
              .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
            await claimsManager.connect(roles.mediator).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence);
            await expect(
              claimsManager.connect(roles.manager).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
            ).to.be.revertedWith('Claim not acceptable');
          });
        });
      });
      context('Claim does not exist', function () {
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
          const evidence = '/ipfs/Qm...testaddress';
          const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
          await expect(
            claimsManager.connect(roles.manager).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
          ).to.be.revertedWith('Claim not acceptable');
        });
      });
    });
    context('Sender is admin', function () {
      context('Claim exists', function () {
        context('Claim is acceptable', function () {
          context('It is not too late to accept the claim', function () {
            context('Api3UsdAmountConverter is valid', function () {
              context('Payout does not cause the sender quota to be exceeded', function () {
                context('Coverage covers the entire payout', function () {
                  context('Pool has enough funds', function () {
                    it('accepts and pays out the claim fully, updates coverage and records usage', async function () {
                      const quotaPeriod = 7 * 24 * 60 * 60;
                      const quotaAmount = hre.ethers.utils.parseEther('1000000');
                      await claimsManager.connect(roles.admin).setQuota(roles.admin.address, quotaPeriod, quotaAmount);
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
                      const payoutAmountInUsd = claimAmountInUsd;
                      const payoutAmountInApi3 = claimAmountInUsd
                        .mul(hre.ethers.utils.parseEther('1'))
                        .div(api3UsdPriceWith18Decimals);
                      await expect(
                        claimsManager.connect(roles.admin).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
                      )
                        .to.emit(claimsManager, 'AcceptedClaim')
                        .withArgs(
                          claimant,
                          policyHash,
                          claimHash,
                          payoutAmountInUsd,
                          payoutAmountInApi3,
                          roles.admin.address
                        );
                      const claimAcceptanceTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                      const claimState = await claimsManager.claimHashToState(claimHash);
                      expect(claimState.status).to.equal(ClaimStatus.ClaimAccepted);
                      expect(claimState.updateTime).to.equal(claimAcceptanceTimestamp);
                      expect(claimState.arbitrator).to.equal(hre.ethers.constants.AddressZero);
                      expect(await api3Token.balanceOf(claimant)).to.equal(payoutAmountInApi3);
                      const policyState = await claimsManager.policyHashToState(policyHash);
                      expect(policyState.coverageAmountInUsd).to.equal(coverageAmountInUsd.sub(payoutAmountInUsd));
                      expect(await claimsManager.getQuotaUsage(roles.admin.address)).to.equal(payoutAmountInApi3);
                    });
                  });
                  context('Pool does not have enough funds', function () {
                    it('reverts', async function () {
                      const usdAmountThatExceedsTotalStake = api3UsdPriceWith18Decimals.gt(
                        hre.ethers.utils.parseEther('1')
                      )
                        ? totalStake
                            .mul(api3UsdPriceWith18Decimals)
                            .div(hre.ethers.utils.parseEther('1'))
                            .add(api3UsdPriceWith18Decimals.div(hre.ethers.utils.parseEther('1')))
                        : totalStake.mul(api3UsdPriceWith18Decimals).div(hre.ethers.utils.parseEther('1')).add(1);
                      const claimant = roles.claimant.address;
                      const coverageAmountInUsd = usdAmountThatExceedsTotalStake;
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
                      const claimAmountInUsd = usdAmountThatExceedsTotalStake;
                      const evidence = '/ipfs/Qm...testaddress';
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                      await expect(
                        claimsManager.connect(roles.admin).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
                      ).to.be.revertedWith('Pool: Amount exceeds total stake');
                    });
                  });
                });
                context('Coverage does not cover the entire payout', function () {
                  context('Pool has enough funds', function () {
                    it('accepts and pays out the remaining coverage, updates coverage and records usage', async function () {
                      const quotaPeriod = 7 * 24 * 60 * 60;
                      const quotaAmount = hre.ethers.utils.parseEther('1000000');
                      await claimsManager.connect(roles.admin).setQuota(roles.admin.address, quotaPeriod, quotaAmount);
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
                      const evidence = '/ipfs/Qm...testaddress';
                      const claimAmountInUsd1 = hre.ethers.utils.parseEther('40000');
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                      const claimAmountInUsd2 = hre.ethers.utils.parseEther('25000');
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                      const claimHash2 = hre.ethers.utils.solidityKeccak256(
                        ['bytes32', 'address', 'uint224', 'string'],
                        [policyHash, claimant, claimAmountInUsd2, evidence]
                      );
                      await claimsManager
                        .connect(roles.mediator)
                        .acceptClaim(policyHash, claimant, claimAmountInUsd1, evidence);
                      const payoutAmountInUsd = coverageAmountInUsd.sub(claimAmountInUsd1).lt(claimAmountInUsd2)
                        ? coverageAmountInUsd.sub(claimAmountInUsd1)
                        : claimAmountInUsd2;
                      const payoutAmountInApi3 = payoutAmountInUsd
                        .mul(hre.ethers.utils.parseEther('1'))
                        .div(api3UsdPriceWith18Decimals);
                      const claimantBalance = await api3Token.balanceOf(claimant);
                      const coverageAmount = (await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd;
                      const quotaUsage = await claimsManager.getQuotaUsage(roles.admin.address);
                      await expect(
                        claimsManager
                          .connect(roles.admin)
                          .acceptClaim(policyHash, claimant, claimAmountInUsd2, evidence)
                      )
                        .to.emit(claimsManager, 'AcceptedClaim')
                        .withArgs(
                          claimant,
                          policyHash,
                          claimHash2,
                          payoutAmountInUsd,
                          payoutAmountInApi3,
                          roles.admin.address
                        );
                      const claimAcceptanceTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                      const claimState = await claimsManager.claimHashToState(claimHash2);
                      expect(claimState.status).to.equal(ClaimStatus.ClaimAccepted);
                      expect(claimState.updateTime).to.equal(claimAcceptanceTimestamp);
                      expect(claimState.arbitrator).to.equal(hre.ethers.constants.AddressZero);
                      expect((await api3Token.balanceOf(claimant)).sub(claimantBalance)).to.equal(payoutAmountInApi3);
                      expect(
                        coverageAmount.sub((await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd)
                      ).to.equal(payoutAmountInUsd);
                      expect((await claimsManager.getQuotaUsage(roles.admin.address)).sub(quotaUsage)).to.equal(
                        payoutAmountInApi3
                      );
                    });
                  });
                  context('Pool does not have enough funds', function () {
                    it('reverts', async function () {
                      const usdAmountThatExceedsTotalStake = api3UsdPriceWith18Decimals.gt(
                        hre.ethers.utils.parseEther('1')
                      )
                        ? totalStake
                            .mul(api3UsdPriceWith18Decimals)
                            .div(hre.ethers.utils.parseEther('1'))
                            .add(api3UsdPriceWith18Decimals.div(hre.ethers.utils.parseEther('1')))
                        : totalStake.mul(api3UsdPriceWith18Decimals).div(hre.ethers.utils.parseEther('1')).add(1);
                      const claimant = roles.claimant.address;
                      const coverageAmountInUsd = usdAmountThatExceedsTotalStake.mul(2);
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
                      const evidence = '/ipfs/Qm...testaddress';
                      const claimAmountInUsd1 = 1;
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                      const claimAmountInUsd2 = coverageAmountInUsd;
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                      await claimsManager
                        .connect(roles.mediator)
                        .acceptClaim(policyHash, claimant, claimAmountInUsd1, evidence);
                      await expect(
                        claimsManager
                          .connect(roles.admin)
                          .acceptClaim(policyHash, claimant, claimAmountInUsd2, evidence)
                      ).to.be.revertedWith('Pool: Amount exceeds total stake');
                    });
                  });
                });
              });
              context('Payout causes the sender quota to be exceeded', function () {
                it('reverts', async function () {
                  const quotaPeriod = 7 * 24 * 60 * 60;
                  const quotaAmount = hre.ethers.utils.parseEther('1000');
                  await claimsManager.connect(roles.admin).setQuota(roles.admin.address, quotaPeriod, quotaAmount);
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
                  const evidence = '/ipfs/Qm...testaddress';
                  const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                  await claimsManager
                    .connect(roles.claimant)
                    .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                  await expect(
                    claimsManager.connect(roles.admin).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
                  ).to.be.revertedWith('Quota exceeded');
                });
              });
            });
            context('Api3UsdAmountConverter is not valid', function () {
              it('reverts', async function () {
                const invalidApi3UsdAmountConverter = '0x00000000000000000000000000000000DeaDBeef';
                await claimsManager.connect(roles.admin).setApi3UsdAmountConverter(invalidApi3UsdAmountConverter);

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
                const evidence = '/ipfs/Qm...testaddress';
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                await expect(
                  claimsManager.connect(roles.admin).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
                ).to.be.revertedWithoutReason;
              });
            });
          });
          context('It is too late to accept the claim', function () {
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
              const evidence = '/ipfs/Qm...testaddress';
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              await claimsManager
                .connect(roles.claimant)
                .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                claimCreationBlockTimestamp + mediatorResponsePeriod,
              ]);
              await expect(
                claimsManager.connect(roles.admin).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
              ).to.be.revertedWith('Too late to accept claim');
            });
          });
        });
        context('Claim is not acceptable', function () {
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
            const evidence = '/ipfs/Qm...testaddress';
            const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
            await claimsManager
              .connect(roles.claimant)
              .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
            await claimsManager.connect(roles.mediator).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence);
            await expect(
              claimsManager.connect(roles.admin).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
            ).to.be.revertedWith('Claim not acceptable');
          });
        });
      });
      context('Claim does not exist', function () {
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
          const evidence = '/ipfs/Qm...testaddress';
          const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
          await expect(
            claimsManager.connect(roles.admin).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
          ).to.be.revertedWith('Claim not acceptable');
        });
      });
    });
    context('Sender is mediator', function () {
      context('Claim exists', function () {
        context('Claim is acceptable', function () {
          context('It is not too late to accept the claim', function () {
            context('Api3UsdAmountConverter is valid', function () {
              context('Payout does not cause the sender quota to be exceeded', function () {
                context('Coverage covers the entire payout', function () {
                  context('Pool has enough funds', function () {
                    it('accepts and pays out the claim fully, updates coverage and records usage', async function () {
                      const quotaPeriod = 7 * 24 * 60 * 60;
                      const quotaAmount = hre.ethers.utils.parseEther('1000000');
                      await claimsManager
                        .connect(roles.admin)
                        .setQuota(roles.mediator.address, quotaPeriod, quotaAmount);
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
                      const payoutAmountInUsd = claimAmountInUsd;
                      const payoutAmountInApi3 = claimAmountInUsd
                        .mul(hre.ethers.utils.parseEther('1'))
                        .div(api3UsdPriceWith18Decimals);
                      await expect(
                        claimsManager
                          .connect(roles.mediator)
                          .acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
                      )
                        .to.emit(claimsManager, 'AcceptedClaim')
                        .withArgs(
                          claimant,
                          policyHash,
                          claimHash,
                          payoutAmountInUsd,
                          payoutAmountInApi3,
                          roles.mediator.address
                        );
                      const claimAcceptanceTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                      const claimState = await claimsManager.claimHashToState(claimHash);
                      expect(claimState.status).to.equal(ClaimStatus.ClaimAccepted);
                      expect(claimState.updateTime).to.equal(claimAcceptanceTimestamp);
                      expect(claimState.arbitrator).to.equal(hre.ethers.constants.AddressZero);
                      expect(await api3Token.balanceOf(claimant)).to.equal(payoutAmountInApi3);
                      const policyState = await claimsManager.policyHashToState(policyHash);
                      expect(policyState.coverageAmountInUsd).to.equal(coverageAmountInUsd.sub(payoutAmountInUsd));
                      expect(await claimsManager.getQuotaUsage(roles.mediator.address)).to.equal(payoutAmountInApi3);
                    });
                  });
                  context('Pool does not have enough funds', function () {
                    it('reverts', async function () {
                      const usdAmountThatExceedsTotalStake = api3UsdPriceWith18Decimals.gt(
                        hre.ethers.utils.parseEther('1')
                      )
                        ? totalStake
                            .mul(api3UsdPriceWith18Decimals)
                            .div(hre.ethers.utils.parseEther('1'))
                            .add(api3UsdPriceWith18Decimals.div(hre.ethers.utils.parseEther('1')))
                        : totalStake.mul(api3UsdPriceWith18Decimals).div(hre.ethers.utils.parseEther('1')).add(1);
                      const claimant = roles.claimant.address;
                      const coverageAmountInUsd = usdAmountThatExceedsTotalStake;
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
                      const claimAmountInUsd = usdAmountThatExceedsTotalStake;
                      const evidence = '/ipfs/Qm...testaddress';
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                      await expect(
                        claimsManager
                          .connect(roles.mediator)
                          .acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
                      ).to.be.revertedWith('Pool: Amount exceeds total stake');
                    });
                  });
                });
                context('Coverage does not cover the entire payout', function () {
                  context('Pool has enough funds', function () {
                    it('accepts and pays out the remaining coverage, updates coverage and records usage', async function () {
                      const quotaPeriod = 7 * 24 * 60 * 60;
                      const quotaAmount = hre.ethers.utils.parseEther('1000000');
                      await claimsManager
                        .connect(roles.admin)
                        .setQuota(roles.mediator.address, quotaPeriod, quotaAmount);
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
                      const evidence = '/ipfs/Qm...testaddress';
                      const claimAmountInUsd1 = hre.ethers.utils.parseEther('40000');
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                      const claimAmountInUsd2 = hre.ethers.utils.parseEther('25000');
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                      const claimHash2 = hre.ethers.utils.solidityKeccak256(
                        ['bytes32', 'address', 'uint224', 'string'],
                        [policyHash, claimant, claimAmountInUsd2, evidence]
                      );
                      await claimsManager
                        .connect(roles.mediator)
                        .acceptClaim(policyHash, claimant, claimAmountInUsd1, evidence);
                      const payoutAmountInUsd = coverageAmountInUsd.sub(claimAmountInUsd1).lt(claimAmountInUsd2)
                        ? coverageAmountInUsd.sub(claimAmountInUsd1)
                        : claimAmountInUsd2;
                      const payoutAmountInApi3 = payoutAmountInUsd
                        .mul(hre.ethers.utils.parseEther('1'))
                        .div(api3UsdPriceWith18Decimals);
                      const claimantBalance = await api3Token.balanceOf(claimant);
                      const coverageAmount = (await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd;
                      const quotaUsage = await claimsManager.getQuotaUsage(roles.mediator.address);
                      await expect(
                        claimsManager
                          .connect(roles.mediator)
                          .acceptClaim(policyHash, claimant, claimAmountInUsd2, evidence)
                      )
                        .to.emit(claimsManager, 'AcceptedClaim')
                        .withArgs(
                          claimant,
                          policyHash,
                          claimHash2,
                          payoutAmountInUsd,
                          payoutAmountInApi3,
                          roles.mediator.address
                        );
                      const claimAcceptanceTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                      const claimState = await claimsManager.claimHashToState(claimHash2);
                      expect(claimState.status).to.equal(ClaimStatus.ClaimAccepted);
                      expect(claimState.updateTime).to.equal(claimAcceptanceTimestamp);
                      expect(claimState.arbitrator).to.equal(hre.ethers.constants.AddressZero);
                      expect((await api3Token.balanceOf(claimant)).sub(claimantBalance)).to.equal(payoutAmountInApi3);
                      expect(
                        coverageAmount.sub((await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd)
                      ).to.equal(payoutAmountInUsd);
                      expect((await claimsManager.getQuotaUsage(roles.mediator.address)).sub(quotaUsage)).to.equal(
                        payoutAmountInApi3
                      );
                    });
                  });
                  context('Pool does not have enough funds', function () {
                    it('reverts', async function () {
                      const usdAmountThatExceedsTotalStake = api3UsdPriceWith18Decimals.gt(
                        hre.ethers.utils.parseEther('1')
                      )
                        ? totalStake
                            .mul(api3UsdPriceWith18Decimals)
                            .div(hre.ethers.utils.parseEther('1'))
                            .add(api3UsdPriceWith18Decimals.div(hre.ethers.utils.parseEther('1')))
                        : totalStake.mul(api3UsdPriceWith18Decimals).div(hre.ethers.utils.parseEther('1')).add(1);
                      const claimant = roles.claimant.address;
                      const coverageAmountInUsd = usdAmountThatExceedsTotalStake.mul(2);
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
                      const evidence = '/ipfs/Qm...testaddress';
                      const claimAmountInUsd1 = 1;
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                      const claimAmountInUsd2 = coverageAmountInUsd;
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                      await claimsManager
                        .connect(roles.mediator)
                        .acceptClaim(policyHash, claimant, claimAmountInUsd1, evidence);
                      await expect(
                        claimsManager
                          .connect(roles.mediator)
                          .acceptClaim(policyHash, claimant, claimAmountInUsd2, evidence)
                      ).to.be.revertedWith('Pool: Amount exceeds total stake');
                    });
                  });
                });
              });
              context('Payout causes the sender quota to be exceeded', function () {
                it('reverts', async function () {
                  const quotaPeriod = 7 * 24 * 60 * 60;
                  const quotaAmount = hre.ethers.utils.parseEther('1000');
                  await claimsManager.connect(roles.admin).setQuota(roles.mediator.address, quotaPeriod, quotaAmount);
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
                  const evidence = '/ipfs/Qm...testaddress';
                  const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                  await claimsManager
                    .connect(roles.claimant)
                    .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                  await expect(
                    claimsManager.connect(roles.mediator).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
                  ).to.be.revertedWith('Quota exceeded');
                });
              });
            });
            context('Api3UsdAmountConverter is not valid', function () {
              it('reverts', async function () {
                const invalidApi3UsdAmountConverter = '0x00000000000000000000000000000000DeaDBeef';
                await claimsManager.connect(roles.admin).setApi3UsdAmountConverter(invalidApi3UsdAmountConverter);

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
                const evidence = '/ipfs/Qm...testaddress';
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                await expect(
                  claimsManager.connect(roles.mediator).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
                ).to.be.revertedWithoutReason;
              });
            });
          });
          context('It is too late to accept the claim', function () {
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
              const evidence = '/ipfs/Qm...testaddress';
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              await claimsManager
                .connect(roles.claimant)
                .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                claimCreationBlockTimestamp + mediatorResponsePeriod,
              ]);
              await expect(
                claimsManager.connect(roles.mediator).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
              ).to.be.revertedWith('Too late to accept claim');
            });
          });
        });
        context('Claim is not acceptable', function () {
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
            const evidence = '/ipfs/Qm...testaddress';
            const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
            await claimsManager
              .connect(roles.claimant)
              .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
            await claimsManager.connect(roles.mediator).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence);
            await expect(
              claimsManager.connect(roles.mediator).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
            ).to.be.revertedWith('Claim not acceptable');
          });
        });
      });
      context('Claim does not exist', function () {
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
          const evidence = '/ipfs/Qm...testaddress';
          const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
          await expect(
            claimsManager.connect(roles.mediator).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
          ).to.be.revertedWith('Claim not acceptable');
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
        const evidence = '/ipfs/Qm...testaddress';
        const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
        await claimsManager.connect(roles.claimant).createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
        await expect(
          claimsManager.connect(roles.randomPerson).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence)
        ).to.be.revertedWith('Sender cannot mediate');
      });
    });
  });

  describe('proposeSettlement', function () {
    context('Sender is manager', function () {
      context('Settlement amount is not zero', function () {
        context('Claim is settleable', function () {
          context('It is not too late to propose a settlement', function () {
            context('Settlement amount is smaller than the claim amount', function () {
              context('Api3UsdAmountConverter is valid', function () {
                context('Potential payout does not cause the sender quota to be exceeded', function () {
                  it('proposes settlement and updates records usage', async function () {
                    const quotaPeriod = 7 * 24 * 60 * 60;
                    const quotaAmount = hre.ethers.utils.parseEther('1000000');
                    await claimsManager.connect(roles.admin).setQuota(roles.manager.address, quotaPeriod, quotaAmount);
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
                    const settlementAmountInApi3 = settlementAmountInUsd
                      .mul(hre.ethers.utils.parseEther('1'))
                      .div(api3UsdPriceWith18Decimals);
                    await expect(
                      claimsManager
                        .connect(roles.manager)
                        .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
                    )
                      .to.emit(claimsManager, 'ProposedSettlement')
                      .withArgs(claimant, policyHash, claimHash, settlementAmountInUsd, roles.manager.address);
                    const settlementProposalTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                    const claimState = await claimsManager.claimHashToState(claimHash);
                    expect(claimState.status).to.equal(ClaimStatus.SettlementProposed);
                    expect(claimState.updateTime).to.equal(settlementProposalTimestamp);
                    expect(claimState.arbitrator).to.equal(hre.ethers.constants.AddressZero);
                    expect(await claimsManager.claimHashToProposedSettlementAmountInUsd(claimHash)).to.equal(
                      settlementAmountInUsd
                    );
                    expect(await claimsManager.getQuotaUsage(roles.manager.address)).to.equal(settlementAmountInApi3);
                  });
                });
                context('Potential payout causes the sender quota to be exceeded', function () {
                  it('reverts', async function () {
                    const quotaPeriod = 7 * 24 * 60 * 60;
                    const quotaAmount = hre.ethers.utils.parseEther('1000000');
                    const usdAmountThatExceedsQuota = api3UsdPriceWith18Decimals.gt(hre.ethers.utils.parseEther('1'))
                      ? quotaAmount
                          .mul(api3UsdPriceWith18Decimals)
                          .div(hre.ethers.utils.parseEther('1'))
                          .add(api3UsdPriceWith18Decimals.div(hre.ethers.utils.parseEther('1')))
                      : quotaAmount.mul(api3UsdPriceWith18Decimals).div(hre.ethers.utils.parseEther('1')).add(1);
                    await claimsManager.connect(roles.admin).setQuota(roles.manager.address, quotaPeriod, quotaAmount);
                    const claimant = roles.claimant.address;
                    const coverageAmountInUsd = usdAmountThatExceedsQuota.add(1);
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
                    const evidence = '/ipfs/Qm...testaddress';
                    const claimAmountInUsd = usdAmountThatExceedsQuota.add(1);
                    await claimsManager
                      .connect(roles.claimant)
                      .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                    const settlementAmountInUsd = usdAmountThatExceedsQuota;
                    await expect(
                      claimsManager
                        .connect(roles.manager)
                        .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
                    ).to.be.revertedWith('Quota exceeded');
                  });
                });
              });
              context('Api3UsdAmountConverter is not valid', function () {
                it('reverts', async function () {
                  const invalidApi3UsdAmountConverter = '0x00000000000000000000000000000000DeaDBeef';
                  await claimsManager.connect(roles.admin).setApi3UsdAmountConverter(invalidApi3UsdAmountConverter);

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
                  const evidence = '/ipfs/Qm...testaddress';
                  const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                  await claimsManager
                    .connect(roles.claimant)
                    .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                  const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
                  await expect(
                    claimsManager
                      .connect(roles.manager)
                      .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
                  ).to.be.revertedWithoutReason;
                });
              });
            });
            context('Settlement amount is not smaller than the claim amount', function () {
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
                const evidence = '/ipfs/Qm...testaddress';
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                const settlementAmountInUsd = claimAmountInUsd;
                await expect(
                  claimsManager
                    .connect(roles.manager)
                    .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
                ).to.be.revertedWith('Settlement amount not smaller');
              });
            });
          });
          context('It is too late to propose a settlement', function () {
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
              const evidence = '/ipfs/Qm...testaddress';
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              await claimsManager
                .connect(roles.claimant)
                .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              const claimHash = hre.ethers.utils.solidityKeccak256(
                ['bytes32', 'address', 'uint224', 'string'],
                [policyHash, claimant, claimAmountInUsd, evidence]
              );
              const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
              const claimCreationTimestamp = (await claimsManager.claimHashToState(claimHash)).updateTime;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                claimCreationTimestamp + mediatorResponsePeriod,
              ]);
              await expect(
                claimsManager
                  .connect(roles.manager)
                  .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
              ).to.be.revertedWith('Too late to propose settlement');
            });
          });
        });
        context('Claim is not settleable', function () {
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
            const evidence = '/ipfs/Qm...testaddress';
            const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
            await claimsManager
              .connect(roles.claimant)
              .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
            await claimsManager.connect(roles.mediator).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence);
            const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
            await expect(
              claimsManager
                .connect(roles.manager)
                .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
            ).to.be.revertedWith('Claim is not settleable');
          });
        });
      });
      context('Settlement amount is zero', function () {
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
          const evidence = '/ipfs/Qm...testaddress';
          const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
          await claimsManager
            .connect(roles.claimant)
            .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
          const settlementAmountInUsd = 0;
          await expect(
            claimsManager
              .connect(roles.manager)
              .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
          ).to.be.revertedWith('Settlement amount zero');
        });
      });
    });
    context('Sender is admin', function () {
      context('Settlement amount is not zero', function () {
        context('Claim is settleable', function () {
          context('It is not too late to propose a settlement', function () {
            context('Settlement amount is smaller than the claim amount', function () {
              context('Api3UsdAmountConverter is valid', function () {
                context('Potential payout does not cause the sender quota to be exceeded', function () {
                  it('proposes settlement and updates records usage', async function () {
                    const quotaPeriod = 7 * 24 * 60 * 60;
                    const quotaAmount = hre.ethers.utils.parseEther('1000000');
                    await claimsManager.connect(roles.admin).setQuota(roles.admin.address, quotaPeriod, quotaAmount);
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
                    const settlementAmountInApi3 = settlementAmountInUsd
                      .mul(hre.ethers.utils.parseEther('1'))
                      .div(api3UsdPriceWith18Decimals);
                    await expect(
                      claimsManager
                        .connect(roles.admin)
                        .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
                    )
                      .to.emit(claimsManager, 'ProposedSettlement')
                      .withArgs(claimant, policyHash, claimHash, settlementAmountInUsd, roles.admin.address);
                    const settlementProposalTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                    const claimState = await claimsManager.claimHashToState(claimHash);
                    expect(claimState.status).to.equal(ClaimStatus.SettlementProposed);
                    expect(claimState.updateTime).to.equal(settlementProposalTimestamp);
                    expect(claimState.arbitrator).to.equal(hre.ethers.constants.AddressZero);
                    expect(await claimsManager.claimHashToProposedSettlementAmountInUsd(claimHash)).to.equal(
                      settlementAmountInUsd
                    );
                    expect(await claimsManager.getQuotaUsage(roles.admin.address)).to.equal(settlementAmountInApi3);
                  });
                });
                context('Potential payout causes the sender quota to be exceeded', function () {
                  it('reverts', async function () {
                    const quotaPeriod = 7 * 24 * 60 * 60;
                    const quotaAmount = hre.ethers.utils.parseEther('1000000');
                    const usdAmountThatExceedsQuota = api3UsdPriceWith18Decimals.gt(hre.ethers.utils.parseEther('1'))
                      ? quotaAmount
                          .mul(api3UsdPriceWith18Decimals)
                          .div(hre.ethers.utils.parseEther('1'))
                          .add(api3UsdPriceWith18Decimals.div(hre.ethers.utils.parseEther('1')))
                      : quotaAmount.mul(api3UsdPriceWith18Decimals).div(hre.ethers.utils.parseEther('1')).add(1);
                    await claimsManager.connect(roles.admin).setQuota(roles.admin.address, quotaPeriod, quotaAmount);
                    const claimant = roles.claimant.address;
                    const coverageAmountInUsd = usdAmountThatExceedsQuota.add(1);
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
                    const evidence = '/ipfs/Qm...testaddress';
                    const claimAmountInUsd = usdAmountThatExceedsQuota.add(1);
                    await claimsManager
                      .connect(roles.claimant)
                      .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                    const settlementAmountInUsd = usdAmountThatExceedsQuota;
                    await expect(
                      claimsManager
                        .connect(roles.admin)
                        .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
                    ).to.be.revertedWith('Quota exceeded');
                  });
                });
              });
              context('Api3UsdAmountConverter is not valid', function () {
                it('reverts', async function () {
                  const invalidApi3UsdAmountConverter = '0x00000000000000000000000000000000DeaDBeef';
                  await claimsManager.connect(roles.admin).setApi3UsdAmountConverter(invalidApi3UsdAmountConverter);

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
                  const evidence = '/ipfs/Qm...testaddress';
                  const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                  await claimsManager
                    .connect(roles.claimant)
                    .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                  const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
                  await expect(
                    claimsManager
                      .connect(roles.admin)
                      .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
                  ).to.be.revertedWithoutReason;
                });
              });
            });
            context('Settlement amount is not smaller than the claim amount', function () {
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
                const evidence = '/ipfs/Qm...testaddress';
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                const settlementAmountInUsd = claimAmountInUsd;
                await expect(
                  claimsManager
                    .connect(roles.admin)
                    .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
                ).to.be.revertedWith('Settlement amount not smaller');
              });
            });
          });
          context('It is too late to propose a settlement', function () {
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
              const evidence = '/ipfs/Qm...testaddress';
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              await claimsManager
                .connect(roles.claimant)
                .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              const claimHash = hre.ethers.utils.solidityKeccak256(
                ['bytes32', 'address', 'uint224', 'string'],
                [policyHash, claimant, claimAmountInUsd, evidence]
              );
              const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
              const claimCreationTimestamp = (await claimsManager.claimHashToState(claimHash)).updateTime;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                claimCreationTimestamp + mediatorResponsePeriod,
              ]);
              await expect(
                claimsManager
                  .connect(roles.admin)
                  .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
              ).to.be.revertedWith('Too late to propose settlement');
            });
          });
        });
        context('Claim is not settleable', function () {
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
            const evidence = '/ipfs/Qm...testaddress';
            const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
            await claimsManager
              .connect(roles.claimant)
              .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
            await claimsManager.connect(roles.mediator).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence);
            const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
            await expect(
              claimsManager
                .connect(roles.admin)
                .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
            ).to.be.revertedWith('Claim is not settleable');
          });
        });
      });
      context('Settlement amount is zero', function () {
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
          const evidence = '/ipfs/Qm...testaddress';
          const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
          await claimsManager
            .connect(roles.claimant)
            .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
          const settlementAmountInUsd = 0;
          await expect(
            claimsManager
              .connect(roles.admin)
              .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
          ).to.be.revertedWith('Settlement amount zero');
        });
      });
    });
    context('Sender is mediator', function () {
      context('Settlement amount is not zero', function () {
        context('Claim is settleable', function () {
          context('It is not too late to propose a settlement', function () {
            context('Settlement amount is smaller than the claim amount', function () {
              context('Api3UsdAmountConverter is valid', function () {
                context('Potential payout does not cause the sender quota to be exceeded', function () {
                  it('proposes settlement and updates records usage', async function () {
                    const quotaPeriod = 7 * 24 * 60 * 60;
                    const quotaAmount = hre.ethers.utils.parseEther('1000000');
                    await claimsManager.connect(roles.admin).setQuota(roles.mediator.address, quotaPeriod, quotaAmount);
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
                    const settlementAmountInApi3 = settlementAmountInUsd
                      .mul(hre.ethers.utils.parseEther('1'))
                      .div(api3UsdPriceWith18Decimals);
                    await expect(
                      claimsManager
                        .connect(roles.mediator)
                        .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
                    )
                      .to.emit(claimsManager, 'ProposedSettlement')
                      .withArgs(claimant, policyHash, claimHash, settlementAmountInUsd, roles.mediator.address);
                    const settlementProposalTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                    const claimState = await claimsManager.claimHashToState(claimHash);
                    expect(claimState.status).to.equal(ClaimStatus.SettlementProposed);
                    expect(claimState.updateTime).to.equal(settlementProposalTimestamp);
                    expect(claimState.arbitrator).to.equal(hre.ethers.constants.AddressZero);
                    expect(await claimsManager.claimHashToProposedSettlementAmountInUsd(claimHash)).to.equal(
                      settlementAmountInUsd
                    );
                    expect(await claimsManager.getQuotaUsage(roles.mediator.address)).to.equal(settlementAmountInApi3);
                  });
                });
                context('Potential payout causes the sender quota to be exceeded', function () {
                  it('reverts', async function () {
                    const quotaPeriod = 7 * 24 * 60 * 60;
                    const quotaAmount = hre.ethers.utils.parseEther('1000000');
                    const usdAmountThatExceedsQuota = api3UsdPriceWith18Decimals.gt(hre.ethers.utils.parseEther('1'))
                      ? quotaAmount
                          .mul(api3UsdPriceWith18Decimals)
                          .div(hre.ethers.utils.parseEther('1'))
                          .add(api3UsdPriceWith18Decimals.div(hre.ethers.utils.parseEther('1')))
                      : quotaAmount.mul(api3UsdPriceWith18Decimals).div(hre.ethers.utils.parseEther('1')).add(1);
                    await claimsManager.connect(roles.admin).setQuota(roles.mediator.address, quotaPeriod, quotaAmount);
                    const claimant = roles.claimant.address;
                    const coverageAmountInUsd = usdAmountThatExceedsQuota.add(1);
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
                    const evidence = '/ipfs/Qm...testaddress';
                    const claimAmountInUsd = usdAmountThatExceedsQuota.add(1);
                    await claimsManager
                      .connect(roles.claimant)
                      .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                    const settlementAmountInUsd = usdAmountThatExceedsQuota;
                    await expect(
                      claimsManager
                        .connect(roles.mediator)
                        .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
                    ).to.be.revertedWith('Quota exceeded');
                  });
                });
              });
              context('Api3UsdAmountConverter is not valid', function () {
                it('reverts', async function () {
                  const invalidApi3UsdAmountConverter = '0x00000000000000000000000000000000DeaDBeef';
                  await claimsManager.connect(roles.admin).setApi3UsdAmountConverter(invalidApi3UsdAmountConverter);

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
                  const evidence = '/ipfs/Qm...testaddress';
                  const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                  await claimsManager
                    .connect(roles.claimant)
                    .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                  const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
                  await expect(
                    claimsManager
                      .connect(roles.mediator)
                      .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
                  ).to.be.revertedWithoutReason;
                });
              });
            });
            context('Settlement amount is not smaller than the claim amount', function () {
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
                const evidence = '/ipfs/Qm...testaddress';
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                const settlementAmountInUsd = claimAmountInUsd;
                await expect(
                  claimsManager
                    .connect(roles.mediator)
                    .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
                ).to.be.revertedWith('Settlement amount not smaller');
              });
            });
          });
          context('It is too late to propose a settlement', function () {
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
              const evidence = '/ipfs/Qm...testaddress';
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              await claimsManager
                .connect(roles.claimant)
                .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              const claimHash = hre.ethers.utils.solidityKeccak256(
                ['bytes32', 'address', 'uint224', 'string'],
                [policyHash, claimant, claimAmountInUsd, evidence]
              );
              const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
              const claimCreationTimestamp = (await claimsManager.claimHashToState(claimHash)).updateTime;
              const currentBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const settlementProposalTimestamp = currentBlockTimestamp + claimCreationTimestamp;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [settlementProposalTimestamp]);
              await expect(
                claimsManager
                  .connect(roles.mediator)
                  .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
              ).to.be.revertedWith('Too late to propose settlement');
            });
          });
        });
        context('Claim is not settleable', function () {
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
            const evidence = '/ipfs/Qm...testaddress';
            const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
            await claimsManager
              .connect(roles.claimant)
              .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
            await claimsManager.connect(roles.mediator).acceptClaim(policyHash, claimant, claimAmountInUsd, evidence);
            const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
            await expect(
              claimsManager
                .connect(roles.mediator)
                .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
            ).to.be.revertedWith('Claim is not settleable');
          });
        });
      });
      context('Settlement amount is zero', function () {
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
          const evidence = '/ipfs/Qm...testaddress';
          const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
          await claimsManager
            .connect(roles.claimant)
            .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
          const settlementAmountInUsd = 0;
          await expect(
            claimsManager
              .connect(roles.mediator)
              .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
          ).to.be.revertedWith('Settlement amount zero');
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
        const evidence = '/ipfs/Qm...testaddress';
        const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
        await claimsManager.connect(roles.claimant).createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
        const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
        await expect(
          claimsManager
            .connect(roles.randomPerson)
            .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd)
        ).to.be.revertedWith('Sender cannot mediate');
      });
    });
  });

  describe('acceptSettlement', function () {
    context('There is a settlement to accept', function () {
      context('It is not too late to accept the settlement', function () {
        context('Api3UsdAmountConverter is valid', function () {
          context('Coverage covers the entire payout', function () {
            context('Payout is not smaller than minimum', function () {
              context('Pool has enough funds', function () {
                it('accepts and pays out the claim fully and updates coverage', async function () {
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
                  const settlementAmountInApi3 = settlementAmountInUsd
                    .mul(hre.ethers.utils.parseEther('1'))
                    .div(api3UsdPriceWith18Decimals);
                  await claimsManager
                    .connect(roles.mediator)
                    .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd);
                  const minimumPayoutAmountInApi3 = settlementAmountInApi3;
                  const claimantBalance = await api3Token.balanceOf(claimant);
                  await expect(
                    claimsManager
                      .connect(roles.claimant)
                      .acceptSettlement(policyHash, claimAmountInUsd, evidence, minimumPayoutAmountInApi3)
                  )
                    .to.emit(claimsManager, 'AcceptedSettlement')
                    .withArgs(claimant, policyHash, claimHash, settlementAmountInUsd, settlementAmountInApi3);
                  const settlementAcceptanceTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                  const claimState = await claimsManager.claimHashToState(claimHash);
                  expect(claimState.status).to.equal(ClaimStatus.SettlementAccepted);
                  expect(claimState.updateTime).to.equal(settlementAcceptanceTimestamp);
                  expect(claimState.arbitrator).to.equal(hre.ethers.constants.AddressZero);
                  expect((await api3Token.balanceOf(claimant)).sub(claimantBalance)).to.equal(settlementAmountInApi3);
                  expect(
                    coverageAmountInUsd.sub((await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd)
                  ).to.equal(settlementAmountInUsd);
                });
              });
              context('Pool does not have enough funds', function () {
                it('reverts', async function () {
                  const usdAmountThatExceedsTotalStake = api3UsdPriceWith18Decimals.gt(hre.ethers.utils.parseEther('1'))
                    ? totalStake
                        .mul(api3UsdPriceWith18Decimals)
                        .div(hre.ethers.utils.parseEther('1'))
                        .add(api3UsdPriceWith18Decimals.div(hre.ethers.utils.parseEther('1')))
                    : totalStake.mul(api3UsdPriceWith18Decimals).div(hre.ethers.utils.parseEther('1')).add(1);
                  const claimant = roles.claimant.address;
                  const coverageAmountInUsd = usdAmountThatExceedsTotalStake.mul(2);
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
                  const claimAmountInUsd = coverageAmountInUsd;
                  const evidence = '/ipfs/Qm...testaddress';
                  await claimsManager
                    .connect(roles.claimant)
                    .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                  const settlementAmountInUsd = usdAmountThatExceedsTotalStake;
                  const settlementAmountInApi3 = settlementAmountInUsd
                    .mul(hre.ethers.utils.parseEther('1'))
                    .div(api3UsdPriceWith18Decimals);
                  await claimsManager
                    .connect(roles.mediator)
                    .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd);
                  const minimumPayoutAmountInApi3 = settlementAmountInApi3;
                  await expect(
                    claimsManager
                      .connect(roles.claimant)
                      .acceptSettlement(policyHash, claimAmountInUsd, evidence, minimumPayoutAmountInApi3)
                  ).to.be.revertedWith('Pool: Amount exceeds total stake');
                });
              });
            });
            context('Payout is smaller than minimum', function () {
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
                const minimumPayoutAmountInApi3 = settlementAmountInApi3.add(1);
                await expect(
                  claimsManager
                    .connect(roles.claimant)
                    .acceptSettlement(policyHash, claimAmountInUsd, evidence, minimumPayoutAmountInApi3)
                ).to.be.revertedWith('Payout less than minimum');
              });
            });
          });
          context('Coverage does not cover the entire payout', function () {
            context('Payout is not smaller than minimum', function () {
              context('Pool has enough funds', function () {
                it('accepts and pays out the remaining coverage and updates coverage', async function () {
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
                  const evidence = '/ipfs/Qm...testaddress';
                  const claimAmountInUsd1 = hre.ethers.utils.parseEther('40000');
                  await claimsManager
                    .connect(roles.claimant)
                    .createClaim(claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                  const claimAmountInUsd2 = hre.ethers.utils.parseEther('25000');
                  await claimsManager
                    .connect(roles.claimant)
                    .createClaim(claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                  const claimHash2 = hre.ethers.utils.solidityKeccak256(
                    ['bytes32', 'address', 'uint224', 'string'],
                    [policyHash, claimant, claimAmountInUsd2, evidence]
                  );
                  await claimsManager
                    .connect(roles.mediator)
                    .acceptClaim(policyHash, claimant, claimAmountInUsd1, evidence);
                  const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
                  await claimsManager
                    .connect(roles.mediator)
                    .proposeSettlement(policyHash, claimant, claimAmountInUsd2, evidence, settlementAmountInUsd);
                  const payoutAmountInUsd = coverageAmountInUsd.sub(claimAmountInUsd1).lt(settlementAmountInUsd)
                    ? coverageAmountInUsd.sub(claimAmountInUsd1)
                    : settlementAmountInUsd;
                  const payoutAmountInApi3 = payoutAmountInUsd
                    .mul(hre.ethers.utils.parseEther('1'))
                    .div(api3UsdPriceWith18Decimals);
                  const minimumPayoutAmountInApi3 = payoutAmountInApi3;
                  const claimantBalance = await api3Token.balanceOf(claimant);
                  const coverageAmount = (await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd;
                  await expect(
                    claimsManager
                      .connect(roles.claimant)
                      .acceptSettlement(policyHash, claimAmountInUsd2, evidence, minimumPayoutAmountInApi3)
                  )
                    .to.emit(claimsManager, 'AcceptedSettlement')
                    .withArgs(claimant, policyHash, claimHash2, payoutAmountInUsd, payoutAmountInApi3);
                  const settlementAcceptanceTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                  const claimState = await claimsManager.claimHashToState(claimHash2);
                  expect(claimState.status).to.equal(ClaimStatus.SettlementAccepted);
                  expect(claimState.updateTime).to.equal(settlementAcceptanceTimestamp);
                  expect(claimState.arbitrator).to.equal(hre.ethers.constants.AddressZero);
                  expect((await api3Token.balanceOf(claimant)).sub(claimantBalance)).to.equal(payoutAmountInApi3);
                  expect(
                    coverageAmount.sub((await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd)
                  ).to.equal(payoutAmountInUsd);
                });
              });
              context('Pool does not have enough funds', function () {
                it('reverts', async function () {
                  const usdAmountThatExceedsTotalStake = api3UsdPriceWith18Decimals.gt(hre.ethers.utils.parseEther('1'))
                    ? totalStake
                        .mul(api3UsdPriceWith18Decimals)
                        .div(hre.ethers.utils.parseEther('1'))
                        .add(api3UsdPriceWith18Decimals.div(hre.ethers.utils.parseEther('1')))
                    : totalStake.mul(api3UsdPriceWith18Decimals).div(hre.ethers.utils.parseEther('1')).add(1);
                  const claimant = roles.claimant.address;
                  const coverageAmountInUsd = usdAmountThatExceedsTotalStake.mul(2);
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
                  const evidence = '/ipfs/Qm...testaddress';
                  const claimAmountInUsd1 = hre.ethers.utils.parseEther('40000');
                  await claimsManager
                    .connect(roles.claimant)
                    .createClaim(claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                  const claimAmountInUsd2 = coverageAmountInUsd;
                  await claimsManager
                    .connect(roles.claimant)
                    .createClaim(claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                  await claimsManager
                    .connect(roles.mediator)
                    .acceptClaim(policyHash, claimant, claimAmountInUsd1, evidence);
                  const settlementAmountInUsd = usdAmountThatExceedsTotalStake;
                  await claimsManager
                    .connect(roles.mediator)
                    .proposeSettlement(policyHash, claimant, claimAmountInUsd2, evidence, settlementAmountInUsd);
                  const payoutAmountInUsd = coverageAmountInUsd.sub(claimAmountInUsd1).lt(settlementAmountInUsd)
                    ? coverageAmountInUsd.sub(claimAmountInUsd1)
                    : settlementAmountInUsd;
                  const payoutAmountInApi3 = payoutAmountInUsd
                    .mul(hre.ethers.utils.parseEther('1'))
                    .div(api3UsdPriceWith18Decimals);
                  const minimumPayoutAmountInApi3 = payoutAmountInApi3;
                  await expect(
                    claimsManager
                      .connect(roles.claimant)
                      .acceptSettlement(policyHash, claimAmountInUsd2, evidence, minimumPayoutAmountInApi3)
                  ).to.be.revertedWith('Pool: Amount exceeds total stake');
                });
              });
            });
            context('Payout is smaller than minimum', function () {
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
                const evidence = '/ipfs/Qm...testaddress';
                const claimAmountInUsd1 = hre.ethers.utils.parseEther('40000');
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                const claimAmountInUsd2 = hre.ethers.utils.parseEther('25000');
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                await claimsManager
                  .connect(roles.mediator)
                  .acceptClaim(policyHash, claimant, claimAmountInUsd1, evidence);
                const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
                await claimsManager
                  .connect(roles.mediator)
                  .proposeSettlement(policyHash, claimant, claimAmountInUsd2, evidence, settlementAmountInUsd);
                const payoutAmountInUsd = coverageAmountInUsd.sub(claimAmountInUsd1).lt(settlementAmountInUsd)
                  ? coverageAmountInUsd.sub(claimAmountInUsd1)
                  : settlementAmountInUsd;
                const payoutAmountInApi3 = payoutAmountInUsd
                  .mul(hre.ethers.utils.parseEther('1'))
                  .div(api3UsdPriceWith18Decimals);
                const minimumPayoutAmountInApi3 = payoutAmountInApi3.add(1);
                await expect(
                  claimsManager
                    .connect(roles.claimant)
                    .acceptSettlement(policyHash, claimAmountInUsd2, evidence, minimumPayoutAmountInApi3)
                ).to.be.revertedWith('Payout less than minimum');
              });
            });
          });
        });
        context('Api3UsdAmountConverter is not valid', function () {
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
            const invalidApi3UsdAmountConverter = '0x00000000000000000000000000000000DeaDBeef';
            await claimsManager.connect(roles.admin).setApi3UsdAmountConverter(invalidApi3UsdAmountConverter);
            await expect(
              claimsManager
                .connect(roles.claimant)
                .acceptSettlement(policyHash, claimAmountInUsd, evidence, minimumPayoutAmountInApi3)
            ).to.be.revertedWithoutReason;
          });
        });
      });
      context('It is too late to accept the settlement', function () {
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
          const settlementProposalTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
          const settlementAcceptanceTimestamp = settlementProposalTimestamp + claimantResponsePeriod;
          await hre.ethers.provider.send('evm_setNextBlockTimestamp', [settlementAcceptanceTimestamp]);
          await expect(
            claimsManager
              .connect(roles.claimant)
              .acceptSettlement(policyHash, claimAmountInUsd, evidence, minimumPayoutAmountInApi3)
          ).to.be.revertedWith('Too late to accept settlement');
        });
      });
    });
    context('There is no settlement to accept', function () {
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
        const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
        const settlementAmountInApi3 = settlementAmountInUsd
          .mul(hre.ethers.utils.parseEther('1'))
          .div(api3UsdPriceWith18Decimals);
        const minimumPayoutAmountInApi3 = settlementAmountInApi3;
        await expect(
          claimsManager
            .connect(roles.claimant)
            .acceptSettlement(policyHash, claimAmountInUsd, evidence, minimumPayoutAmountInApi3)
        ).to.be.revertedWith('No settlement to accept');
      });
    });
  });

  describe('createDispute', function () {
    context('Sender is arbitrator', function () {
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
                claimsManager.connect(roles.arbitrator).createDispute(policyHash, claimant, claimAmountInUsd, evidence)
              )
                .to.emit(claimsManager, 'CreatedDispute')
                .withArgs(claimant, policyHash, claimHash, roles.arbitrator.address);
              const claimState = await claimsManager.claimHashToState(claimHash);
              expect(claimState.status).to.equal(ClaimStatus.DisputeCreated);
              expect(claimState.updateTime).to.equal(disputeCreationBlockTimestamp);
              expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
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
                claimsManager.connect(roles.arbitrator).createDispute(policyHash, claimant, claimAmountInUsd, evidence)
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
              claimsManager.connect(roles.arbitrator).createDispute(policyHash, claimant, claimAmountInUsd, evidence)
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
              claimsManager.connect(roles.arbitrator).createDispute(policyHash, claimant, claimAmountInUsd, evidence)
            )
              .to.emit(claimsManager, 'CreatedDispute')
              .withArgs(claimant, policyHash, claimHash, roles.arbitrator.address);
            const disputeCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
            const claimState = await claimsManager.claimHashToState(claimHash);
            expect(claimState.status).to.equal(ClaimStatus.DisputeCreated);
            expect(claimState.updateTime).to.equal(disputeCreationBlockTimestamp);
            expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
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
              claimsManager.connect(roles.arbitrator).createDispute(policyHash, claimant, claimAmountInUsd, evidence)
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
            claimsManager.connect(roles.arbitrator).createDispute(policyHash, claimant, claimAmountInUsd, evidence)
          ).to.be.revertedWith('Claim is not disputable');
        });
      });
    });
    context('Sender is not arbitrator', function () {
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
        await expect(
          claimsManager.connect(roles.manager).createDispute(policyHash, claimant, claimAmountInUsd, evidence)
        ).to.be.revertedWith('Sender not arbitrator');
        await expect(
          claimsManager.connect(roles.admin).createDispute(policyHash, claimant, claimAmountInUsd, evidence)
        ).to.be.revertedWith('Sender not arbitrator');
        await expect(
          claimsManager.connect(roles.randomPerson).createDispute(policyHash, claimant, claimAmountInUsd, evidence)
        ).to.be.revertedWith('Sender not arbitrator');
      });
    });
  });

  describe('resolveDispute', function () {
    context('Sender is manager', function () {
      context('Last action was dispute creation', function () {
        context('It is not too late to resolve the dispute', function () {
          context('Arbitrator decision is to not pay out', function () {
            it('resolves dispute by not paying out', async function () {
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
              await claimsManager
                .connect(roles.arbitrator)
                .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
              const arbitratorDecision = ArbitratorDecision.DoNotPay;
              await expect(
                claimsManager
                  .connect(roles.manager)
                  .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
              )
                .to.emit(claimsManager, 'ResolvedDisputeByRejectingClaim')
                .withArgs(claimant, policyHash, claimHash, roles.manager.address);
              expect(await api3Token.balanceOf(claimant)).to.equal(0);
              const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const claimState = await claimsManager.claimHashToState(claimHash);
              expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithoutPayout);
              expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
              expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
            });
          });
          context('Arbitrator decision is to pay out the claim', function () {
            context('Api3UsdAmountConverter is valid', function () {
              context('Payout does not cause the sender quota to be exceeded', function () {
                context('Coverage covers the entire payout', function () {
                  context('Pool has enough funds', function () {
                    it('resolves dispute by paying out the claim, updates coverage and records usage', async function () {
                      const quotaPeriod = 7 * 24 * 60 * 60;
                      const quotaAmount = hre.ethers.utils.parseEther('1000000');
                      await claimsManager
                        .connect(roles.admin)
                        .setQuota(roles.manager.address, quotaPeriod, quotaAmount);
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
                      await claimsManager
                        .connect(roles.arbitrator)
                        .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                      const payoutAmountInUsd = claimAmountInUsd;
                      const payoutAmountInApi3 = claimAmountInUsd
                        .mul(hre.ethers.utils.parseEther('1'))
                        .div(api3UsdPriceWith18Decimals);
                      const arbitratorDecision = ArbitratorDecision.PayClaim;
                      await expect(
                        claimsManager
                          .connect(roles.manager)
                          .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                      )
                        .to.emit(claimsManager, 'ResolvedDisputeByAcceptingClaim')
                        .withArgs(
                          claimant,
                          policyHash,
                          claimHash,
                          payoutAmountInUsd,
                          payoutAmountInApi3,
                          roles.manager.address
                        );
                      expect(await api3Token.balanceOf(claimant)).to.equal(payoutAmountInApi3);
                      const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                      const claimState = await claimsManager.claimHashToState(claimHash);
                      expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithClaimPayout);
                      expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
                      expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
                      const policyState = await claimsManager.policyHashToState(policyHash);
                      expect(policyState.coverageAmountInUsd).to.equal(coverageAmountInUsd.sub(payoutAmountInUsd));
                      expect(await claimsManager.getQuotaUsage(roles.manager.address)).to.equal(payoutAmountInApi3);
                    });
                  });
                  context('Pool does not have enough funds', function () {
                    it('reverts', async function () {
                      const usdAmountThatExceedsTotalStake = api3UsdPriceWith18Decimals.gt(
                        hre.ethers.utils.parseEther('1')
                      )
                        ? totalStake
                            .mul(api3UsdPriceWith18Decimals)
                            .div(hre.ethers.utils.parseEther('1'))
                            .add(api3UsdPriceWith18Decimals.div(hre.ethers.utils.parseEther('1')))
                        : totalStake.mul(api3UsdPriceWith18Decimals).div(hre.ethers.utils.parseEther('1')).add(1);
                      const claimant = roles.claimant.address;
                      const coverageAmountInUsd = usdAmountThatExceedsTotalStake;
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
                      const claimAmountInUsd = usdAmountThatExceedsTotalStake;
                      const evidence = '/ipfs/Qm...testaddress';
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                      const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                      const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
                      await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                      await claimsManager
                        .connect(roles.arbitrator)
                        .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                      const arbitratorDecision = ArbitratorDecision.PayClaim;
                      await expect(
                        claimsManager
                          .connect(roles.manager)
                          .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                      ).to.be.revertedWith('Pool: Amount exceeds total stake');
                    });
                  });
                });
                context('Coverage does not cover the entire payout', function () {
                  it('resolves dispute by paying out the remaining coverage, updates coverage and records usage', async function () {
                    const quotaPeriod = 7 * 24 * 60 * 60;
                    const quotaAmount = hre.ethers.utils.parseEther('1000000');
                    await claimsManager.connect(roles.admin).setQuota(roles.manager.address, quotaPeriod, quotaAmount);
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
                    const evidence = '/ipfs/Qm...testaddress';
                    const claimAmountInUsd1 = hre.ethers.utils.parseEther('40000');
                    await claimsManager
                      .connect(roles.claimant)
                      .createClaim(claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                    const claimAmountInUsd2 = hre.ethers.utils.parseEther('25000');
                    await claimsManager
                      .connect(roles.claimant)
                      .createClaim(claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                    const claimHash2 = hre.ethers.utils.solidityKeccak256(
                      ['bytes32', 'address', 'uint224', 'string'],
                      [policyHash, claimant, claimAmountInUsd2, evidence]
                    );
                    await claimsManager
                      .connect(roles.mediator)
                      .acceptClaim(policyHash, claimant, claimAmountInUsd1, evidence);
                    const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                    const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
                    await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                    await claimsManager
                      .connect(roles.arbitrator)
                      .createDispute(policyHash, claimant, claimAmountInUsd2, evidence);
                    const payoutAmountInUsd = coverageAmountInUsd.sub(claimAmountInUsd1).lt(claimAmountInUsd2)
                      ? coverageAmountInUsd.sub(claimAmountInUsd1)
                      : claimAmountInUsd2;
                    const payoutAmountInApi3 = payoutAmountInUsd
                      .mul(hre.ethers.utils.parseEther('1'))
                      .div(api3UsdPriceWith18Decimals);
                    const arbitratorDecision = ArbitratorDecision.PayClaim;
                    const claimantBalance = await api3Token.balanceOf(claimant);
                    const coverageAmount = (await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd;
                    const quotaUsage = await claimsManager.getQuotaUsage(roles.manager.address);
                    await expect(
                      claimsManager
                        .connect(roles.manager)
                        .resolveDispute(policyHash, claimant, claimAmountInUsd2, evidence, arbitratorDecision)
                    )
                      .to.emit(claimsManager, 'ResolvedDisputeByAcceptingClaim')
                      .withArgs(
                        claimant,
                        policyHash,
                        claimHash2,
                        payoutAmountInUsd,
                        payoutAmountInApi3,
                        roles.manager.address
                      );
                    expect((await api3Token.balanceOf(claimant)).sub(claimantBalance)).to.equal(payoutAmountInApi3);
                    const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                    const claimState = await claimsManager.claimHashToState(claimHash2);
                    expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithClaimPayout);
                    expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
                    expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
                    expect(
                      coverageAmount.sub((await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd)
                    ).to.equal(payoutAmountInUsd);
                    expect((await claimsManager.getQuotaUsage(roles.manager.address)).sub(quotaUsage)).to.equal(
                      payoutAmountInApi3
                    );
                  });
                });
              });
              context('Payout causes the sender quota to be exceeded', function () {
                it('reverts', async function () {
                  const quotaPeriod = 7 * 24 * 60 * 60;
                  const quotaAmount = hre.ethers.utils.parseEther('1000');
                  await claimsManager.connect(roles.admin).setQuota(roles.manager.address, quotaPeriod, quotaAmount);
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
                  await claimsManager
                    .connect(roles.arbitrator)
                    .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                  const arbitratorDecision = ArbitratorDecision.PayClaim;
                  await expect(
                    claimsManager
                      .connect(roles.manager)
                      .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                  ).to.be.revertedWith('Quota exceeded');
                });
              });
            });
            context('Api3UsdAmountConverter is not valid', function () {
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
                await claimsManager
                  .connect(roles.arbitrator)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                const invalidApi3UsdAmountConverter = '0x00000000000000000000000000000000DeaDBeef';
                await claimsManager.connect(roles.admin).setApi3UsdAmountConverter(invalidApi3UsdAmountConverter);
                const arbitratorDecision = ArbitratorDecision.PayClaim;
                await expect(
                  claimsManager
                    .connect(roles.manager)
                    .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                ).to.be.revertedWithoutReason;
              });
            });
          });
          context('Arbitrator decision is to pay out the settlement', function () {
            context('Settlement was proposed', function () {
              context('Api3UsdAmountConverter is valid', function () {
                context('Payout does not cause the sender quota to be exceeded', function () {
                  context('Coverage covers the entire payout', function () {
                    context('Pool has enough funds', function () {
                      it('resolves dispute by paying out the settlement, updates coverage and records usage', async function () {
                        const quotaPeriod = 7 * 24 * 60 * 60;
                        const quotaAmount = hre.ethers.utils.parseEther('1000000');
                        await claimsManager
                          .connect(roles.admin)
                          .setQuota(roles.manager.address, quotaPeriod, quotaAmount);
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
                        await claimsManager
                          .connect(roles.arbitrator)
                          .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                        const payoutAmountInUsd = settlementAmountInUsd;
                        const payoutAmountInApi3 = payoutAmountInUsd
                          .mul(hre.ethers.utils.parseEther('1'))
                          .div(api3UsdPriceWith18Decimals);
                        const arbitratorDecision = ArbitratorDecision.PaySettlement;
                        await expect(
                          claimsManager
                            .connect(roles.manager)
                            .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                        )
                          .to.emit(claimsManager, 'ResolvedDisputeByAcceptingSettlement')
                          .withArgs(
                            claimant,
                            policyHash,
                            claimHash,
                            payoutAmountInUsd,
                            payoutAmountInApi3,
                            roles.manager.address
                          );
                        expect(await api3Token.balanceOf(claimant)).to.equal(payoutAmountInApi3);
                        const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                        const claimState = await claimsManager.claimHashToState(claimHash);
                        expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithSettlementPayout);
                        expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
                        expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
                        const policyState = await claimsManager.policyHashToState(policyHash);
                        expect(policyState.coverageAmountInUsd).to.equal(coverageAmountInUsd.sub(payoutAmountInUsd));
                        expect(await claimsManager.getQuotaUsage(roles.manager.address)).to.equal(payoutAmountInApi3);
                      });
                    });
                    context('Pool does not have enough funds', function () {
                      it('reverts', async function () {
                        const usdAmountThatExceedsTotalStake = api3UsdPriceWith18Decimals.gt(
                          hre.ethers.utils.parseEther('1')
                        )
                          ? totalStake
                              .mul(api3UsdPriceWith18Decimals)
                              .div(hre.ethers.utils.parseEther('1'))
                              .add(api3UsdPriceWith18Decimals.div(hre.ethers.utils.parseEther('1')))
                          : totalStake.mul(api3UsdPriceWith18Decimals).div(hre.ethers.utils.parseEther('1')).add(1);

                        const claimant = roles.claimant.address;
                        const coverageAmountInUsd = usdAmountThatExceedsTotalStake.mul(2);
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
                        const claimAmountInUsd = usdAmountThatExceedsTotalStake.mul(2);
                        const evidence = '/ipfs/Qm...testaddress';
                        await claimsManager
                          .connect(roles.claimant)
                          .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                        const settlementAmountInUsd = usdAmountThatExceedsTotalStake;
                        await claimsManager
                          .connect(roles.mediator)
                          .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd);
                        await claimsManager
                          .connect(roles.arbitrator)
                          .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                        const arbitratorDecision = ArbitratorDecision.PaySettlement;
                        await expect(
                          claimsManager
                            .connect(roles.manager)
                            .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                        ).to.be.revertedWith('Pool: Amount exceeds total stake');
                      });
                    });
                  });
                  context('Coverage does not cover the entire payout', function () {
                    it('resolves dispute by paying out the remaining coverage, updates coverage and records usage', async function () {
                      const quotaPeriod = 7 * 24 * 60 * 60;
                      const quotaAmount = hre.ethers.utils.parseEther('1000000');
                      await claimsManager
                        .connect(roles.admin)
                        .setQuota(roles.manager.address, quotaPeriod, quotaAmount);
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
                      const evidence = '/ipfs/Qm...testaddress';
                      const claimAmountInUsd1 = hre.ethers.utils.parseEther('40000');
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                      const claimAmountInUsd2 = hre.ethers.utils.parseEther('25000');
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                      const claimHash2 = hre.ethers.utils.solidityKeccak256(
                        ['bytes32', 'address', 'uint224', 'string'],
                        [policyHash, claimant, claimAmountInUsd2, evidence]
                      );
                      await claimsManager
                        .connect(roles.mediator)
                        .acceptClaim(policyHash, claimant, claimAmountInUsd1, evidence);
                      const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
                      await claimsManager
                        .connect(roles.mediator)
                        .proposeSettlement(policyHash, claimant, claimAmountInUsd2, evidence, settlementAmountInUsd);
                      await claimsManager
                        .connect(roles.arbitrator)
                        .createDispute(policyHash, claimant, claimAmountInUsd2, evidence);
                      const payoutAmountInUsd = coverageAmountInUsd.sub(claimAmountInUsd1).lt(claimAmountInUsd2)
                        ? coverageAmountInUsd.sub(claimAmountInUsd1)
                        : claimAmountInUsd2;
                      const payoutAmountInApi3 = payoutAmountInUsd
                        .mul(hre.ethers.utils.parseEther('1'))
                        .div(api3UsdPriceWith18Decimals);
                      const arbitratorDecision = ArbitratorDecision.PaySettlement;
                      const claimantBalance = await api3Token.balanceOf(claimant);
                      const coverageAmount = (await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd;
                      const quotaUsage = await claimsManager.getQuotaUsage(roles.manager.address);
                      await expect(
                        claimsManager
                          .connect(roles.manager)
                          .resolveDispute(policyHash, claimant, claimAmountInUsd2, evidence, arbitratorDecision)
                      )
                        .to.emit(claimsManager, 'ResolvedDisputeByAcceptingSettlement')
                        .withArgs(
                          claimant,
                          policyHash,
                          claimHash2,
                          payoutAmountInUsd,
                          payoutAmountInApi3,
                          roles.manager.address
                        );
                      expect((await api3Token.balanceOf(claimant)).sub(claimantBalance)).to.equal(payoutAmountInApi3);
                      const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                      const claimState = await claimsManager.claimHashToState(claimHash2);
                      expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithSettlementPayout);
                      expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
                      expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
                      expect(
                        coverageAmount.sub((await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd)
                      ).to.equal(payoutAmountInUsd);
                      expect((await claimsManager.getQuotaUsage(roles.manager.address)).sub(quotaUsage)).to.equal(
                        payoutAmountInApi3
                      );
                    });
                  });
                });
                context('Payout causes the sender quota to be exceeded', function () {
                  it('reverts', async function () {
                    const quotaPeriod = 7 * 24 * 60 * 60;
                    const quotaAmount = hre.ethers.utils.parseEther('1000');
                    await claimsManager.connect(roles.admin).setQuota(roles.manager.address, quotaPeriod, quotaAmount);
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
                    await claimsManager
                      .connect(roles.arbitrator)
                      .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                    const arbitratorDecision = ArbitratorDecision.PaySettlement;
                    await expect(
                      claimsManager
                        .connect(roles.manager)
                        .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                    ).to.be.revertedWith('Quota exceeded');
                  });
                });
              });
              context('Api3UsdAmountConverter is not valid', function () {
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
                  await claimsManager
                    .connect(roles.arbitrator)
                    .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                  const invalidApi3UsdAmountConverter = '0x00000000000000000000000000000000DeaDBeef';
                  await claimsManager.connect(roles.admin).setApi3UsdAmountConverter(invalidApi3UsdAmountConverter);
                  const arbitratorDecision = ArbitratorDecision.PaySettlement;
                  await expect(
                    claimsManager
                      .connect(roles.manager)
                      .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                  ).to.be.revertedWithoutReason;
                });
              });
            });
            context('Settlement was not proposed', function () {
              it('resolves dispute by not paying out', async function () {
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
                await claimsManager
                  .connect(roles.arbitrator)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                const arbitratorDecision = ArbitratorDecision.PaySettlement;
                await expect(
                  claimsManager
                    .connect(roles.manager)
                    .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                )
                  .to.emit(claimsManager, 'ResolvedDisputeByRejectingClaim')
                  .withArgs(claimant, policyHash, claimHash, roles.manager.address);
                expect(await api3Token.balanceOf(claimant)).to.equal(0);
                const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                const claimState = await claimsManager.claimHashToState(claimHash);
                expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithoutPayout);
                expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
                expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
              });
            });
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
            await claimsManager
              .connect(roles.arbitrator)
              .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
            const disputeResolutionBlockTimestamp = disputeCreationBlockTimestamp + arbitratorResponsePeriod;
            await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeResolutionBlockTimestamp]);
            const arbitratorDecision = ArbitratorDecision.DoNotPay;
            await expect(
              claimsManager
                .connect(roles.manager)
                .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
            ).to.be.revertedWith('Too late to resolve dispute');
          });
        });
      });
      context('Last action was not dispute creation', function () {
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
          await claimsManager.connect(roles.arbitrator).createDispute(policyHash, claimant, claimAmountInUsd, evidence);
          const arbitratorDecision = ArbitratorDecision.DoNotPay;
          await claimsManager
            .connect(roles.manager)
            .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision);
          await expect(
            claimsManager
              .connect(roles.manager)
              .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
          ).to.be.revertedWith('No dispute to be resolved');
        });
      });
    });
    context('Sender is admin', function () {
      context('Last action was dispute creation', function () {
        context('It is not too late to resolve the dispute', function () {
          context('Arbitrator decision is to not pay out', function () {
            it('resolves dispute by not paying out', async function () {
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
              await claimsManager
                .connect(roles.arbitrator)
                .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
              const arbitratorDecision = ArbitratorDecision.DoNotPay;
              await expect(
                claimsManager
                  .connect(roles.admin)
                  .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
              )
                .to.emit(claimsManager, 'ResolvedDisputeByRejectingClaim')
                .withArgs(claimant, policyHash, claimHash, roles.admin.address);
              expect(await api3Token.balanceOf(claimant)).to.equal(0);
              const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const claimState = await claimsManager.claimHashToState(claimHash);
              expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithoutPayout);
              expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
              expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
            });
          });
          context('Arbitrator decision is to pay out the claim', function () {
            context('Api3UsdAmountConverter is valid', function () {
              context('Payout does not cause the sender quota to be exceeded', function () {
                context('Coverage covers the entire payout', function () {
                  context('Pool has enough funds', function () {
                    it('resolves dispute by paying out the claim, updates coverage and records usage', async function () {
                      const quotaPeriod = 7 * 24 * 60 * 60;
                      const quotaAmount = hre.ethers.utils.parseEther('1000000');
                      await claimsManager.connect(roles.admin).setQuota(roles.admin.address, quotaPeriod, quotaAmount);
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
                      await claimsManager
                        .connect(roles.arbitrator)
                        .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                      const payoutAmountInUsd = claimAmountInUsd;
                      const payoutAmountInApi3 = claimAmountInUsd
                        .mul(hre.ethers.utils.parseEther('1'))
                        .div(api3UsdPriceWith18Decimals);
                      const arbitratorDecision = ArbitratorDecision.PayClaim;
                      await expect(
                        claimsManager
                          .connect(roles.admin)
                          .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                      )
                        .to.emit(claimsManager, 'ResolvedDisputeByAcceptingClaim')
                        .withArgs(
                          claimant,
                          policyHash,
                          claimHash,
                          payoutAmountInUsd,
                          payoutAmountInApi3,
                          roles.admin.address
                        );
                      expect(await api3Token.balanceOf(claimant)).to.equal(payoutAmountInApi3);
                      const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                      const claimState = await claimsManager.claimHashToState(claimHash);
                      expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithClaimPayout);
                      expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
                      expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
                      const policyState = await claimsManager.policyHashToState(policyHash);
                      expect(policyState.coverageAmountInUsd).to.equal(coverageAmountInUsd.sub(payoutAmountInUsd));
                      expect(await claimsManager.getQuotaUsage(roles.admin.address)).to.equal(payoutAmountInApi3);
                    });
                  });
                  context('Pool does not have enough funds', function () {
                    it('reverts', async function () {
                      const usdAmountThatExceedsTotalStake = api3UsdPriceWith18Decimals.gt(
                        hre.ethers.utils.parseEther('1')
                      )
                        ? totalStake
                            .mul(api3UsdPriceWith18Decimals)
                            .div(hre.ethers.utils.parseEther('1'))
                            .add(api3UsdPriceWith18Decimals.div(hre.ethers.utils.parseEther('1')))
                        : totalStake.mul(api3UsdPriceWith18Decimals).div(hre.ethers.utils.parseEther('1')).add(1);
                      const claimant = roles.claimant.address;
                      const coverageAmountInUsd = usdAmountThatExceedsTotalStake;
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
                      const claimAmountInUsd = usdAmountThatExceedsTotalStake;
                      const evidence = '/ipfs/Qm...testaddress';
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                      const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                      const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
                      await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                      await claimsManager
                        .connect(roles.arbitrator)
                        .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                      const arbitratorDecision = ArbitratorDecision.PayClaim;
                      await expect(
                        claimsManager
                          .connect(roles.admin)
                          .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                      ).to.be.revertedWith('Pool: Amount exceeds total stake');
                    });
                  });
                });
                context('Coverage does not cover the entire payout', function () {
                  it('resolves dispute by paying out the remaining coverage, updates coverage and records usage', async function () {
                    const quotaPeriod = 7 * 24 * 60 * 60;
                    const quotaAmount = hre.ethers.utils.parseEther('1000000');
                    await claimsManager.connect(roles.admin).setQuota(roles.admin.address, quotaPeriod, quotaAmount);
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
                    const evidence = '/ipfs/Qm...testaddress';
                    const claimAmountInUsd1 = hre.ethers.utils.parseEther('40000');
                    await claimsManager
                      .connect(roles.claimant)
                      .createClaim(claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                    const claimAmountInUsd2 = hre.ethers.utils.parseEther('25000');
                    await claimsManager
                      .connect(roles.claimant)
                      .createClaim(claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                    const claimHash2 = hre.ethers.utils.solidityKeccak256(
                      ['bytes32', 'address', 'uint224', 'string'],
                      [policyHash, claimant, claimAmountInUsd2, evidence]
                    );
                    await claimsManager
                      .connect(roles.mediator)
                      .acceptClaim(policyHash, claimant, claimAmountInUsd1, evidence);
                    const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                    const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
                    await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                    await claimsManager
                      .connect(roles.arbitrator)
                      .createDispute(policyHash, claimant, claimAmountInUsd2, evidence);
                    const payoutAmountInUsd = coverageAmountInUsd.sub(claimAmountInUsd1).lt(claimAmountInUsd2)
                      ? coverageAmountInUsd.sub(claimAmountInUsd1)
                      : claimAmountInUsd2;
                    const payoutAmountInApi3 = payoutAmountInUsd
                      .mul(hre.ethers.utils.parseEther('1'))
                      .div(api3UsdPriceWith18Decimals);
                    const arbitratorDecision = ArbitratorDecision.PayClaim;
                    const claimantBalance = await api3Token.balanceOf(claimant);
                    const coverageAmount = (await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd;
                    const quotaUsage = await claimsManager.getQuotaUsage(roles.admin.address);
                    await expect(
                      claimsManager
                        .connect(roles.admin)
                        .resolveDispute(policyHash, claimant, claimAmountInUsd2, evidence, arbitratorDecision)
                    )
                      .to.emit(claimsManager, 'ResolvedDisputeByAcceptingClaim')
                      .withArgs(
                        claimant,
                        policyHash,
                        claimHash2,
                        payoutAmountInUsd,
                        payoutAmountInApi3,
                        roles.admin.address
                      );
                    expect((await api3Token.balanceOf(claimant)).sub(claimantBalance)).to.equal(payoutAmountInApi3);
                    const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                    const claimState = await claimsManager.claimHashToState(claimHash2);
                    expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithClaimPayout);
                    expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
                    expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
                    expect(
                      coverageAmount.sub((await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd)
                    ).to.equal(payoutAmountInUsd);
                    expect((await claimsManager.getQuotaUsage(roles.admin.address)).sub(quotaUsage)).to.equal(
                      payoutAmountInApi3
                    );
                  });
                });
              });
              context('Payout causes the sender quota to be exceeded', function () {
                it('reverts', async function () {
                  const quotaPeriod = 7 * 24 * 60 * 60;
                  const quotaAmount = hre.ethers.utils.parseEther('1000');
                  await claimsManager.connect(roles.admin).setQuota(roles.admin.address, quotaPeriod, quotaAmount);
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
                  await claimsManager
                    .connect(roles.arbitrator)
                    .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                  const arbitratorDecision = ArbitratorDecision.PayClaim;
                  await expect(
                    claimsManager
                      .connect(roles.admin)
                      .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                  ).to.be.revertedWith('Quota exceeded');
                });
              });
            });
            context('Api3UsdAmountConverter is not valid', function () {
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
                await claimsManager
                  .connect(roles.arbitrator)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                const invalidApi3UsdAmountConverter = '0x00000000000000000000000000000000DeaDBeef';
                await claimsManager.connect(roles.admin).setApi3UsdAmountConverter(invalidApi3UsdAmountConverter);
                const arbitratorDecision = ArbitratorDecision.PayClaim;
                await expect(
                  claimsManager
                    .connect(roles.admin)
                    .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                ).to.be.revertedWithoutReason;
              });
            });
          });
          context('Arbitrator decision is to pay out the settlement', function () {
            context('Settlement was proposed', function () {
              context('Api3UsdAmountConverter is valid', function () {
                context('Payout does not cause the sender quota to be exceeded', function () {
                  context('Coverage covers the entire payout', function () {
                    context('Pool has enough funds', function () {
                      it('resolves dispute by paying out the settlement, updates coverage and records usage', async function () {
                        const quotaPeriod = 7 * 24 * 60 * 60;
                        const quotaAmount = hre.ethers.utils.parseEther('1000000');
                        await claimsManager
                          .connect(roles.admin)
                          .setQuota(roles.admin.address, quotaPeriod, quotaAmount);
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
                        await claimsManager
                          .connect(roles.arbitrator)
                          .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                        const payoutAmountInUsd = settlementAmountInUsd;
                        const payoutAmountInApi3 = payoutAmountInUsd
                          .mul(hre.ethers.utils.parseEther('1'))
                          .div(api3UsdPriceWith18Decimals);
                        const arbitratorDecision = ArbitratorDecision.PaySettlement;
                        await expect(
                          claimsManager
                            .connect(roles.admin)
                            .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                        )
                          .to.emit(claimsManager, 'ResolvedDisputeByAcceptingSettlement')
                          .withArgs(
                            claimant,
                            policyHash,
                            claimHash,
                            payoutAmountInUsd,
                            payoutAmountInApi3,
                            roles.admin.address
                          );
                        expect(await api3Token.balanceOf(claimant)).to.equal(payoutAmountInApi3);
                        const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                        const claimState = await claimsManager.claimHashToState(claimHash);
                        expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithSettlementPayout);
                        expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
                        expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
                        const policyState = await claimsManager.policyHashToState(policyHash);
                        expect(policyState.coverageAmountInUsd).to.equal(coverageAmountInUsd.sub(payoutAmountInUsd));
                        expect(await claimsManager.getQuotaUsage(roles.admin.address)).to.equal(payoutAmountInApi3);
                      });
                    });
                    context('Pool does not have enough funds', function () {
                      it('reverts', async function () {
                        const usdAmountThatExceedsTotalStake = api3UsdPriceWith18Decimals.gt(
                          hre.ethers.utils.parseEther('1')
                        )
                          ? totalStake
                              .mul(api3UsdPriceWith18Decimals)
                              .div(hre.ethers.utils.parseEther('1'))
                              .add(api3UsdPriceWith18Decimals.div(hre.ethers.utils.parseEther('1')))
                          : totalStake.mul(api3UsdPriceWith18Decimals).div(hre.ethers.utils.parseEther('1')).add(1);

                        const claimant = roles.claimant.address;
                        const coverageAmountInUsd = usdAmountThatExceedsTotalStake.mul(2);
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
                        const claimAmountInUsd = usdAmountThatExceedsTotalStake.mul(2);
                        const evidence = '/ipfs/Qm...testaddress';
                        await claimsManager
                          .connect(roles.claimant)
                          .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                        const settlementAmountInUsd = usdAmountThatExceedsTotalStake;
                        await claimsManager
                          .connect(roles.mediator)
                          .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd);
                        await claimsManager
                          .connect(roles.arbitrator)
                          .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                        const arbitratorDecision = ArbitratorDecision.PaySettlement;
                        await expect(
                          claimsManager
                            .connect(roles.admin)
                            .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                        ).to.be.revertedWith('Pool: Amount exceeds total stake');
                      });
                    });
                  });
                  context('Coverage does not cover the entire payout', function () {
                    it('resolves dispute by paying out the remaining coverage, updates coverage and records usage', async function () {
                      const quotaPeriod = 7 * 24 * 60 * 60;
                      const quotaAmount = hre.ethers.utils.parseEther('1000000');
                      await claimsManager.connect(roles.admin).setQuota(roles.admin.address, quotaPeriod, quotaAmount);
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
                      const evidence = '/ipfs/Qm...testaddress';
                      const claimAmountInUsd1 = hre.ethers.utils.parseEther('40000');
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                      const claimAmountInUsd2 = hre.ethers.utils.parseEther('25000');
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                      const claimHash2 = hre.ethers.utils.solidityKeccak256(
                        ['bytes32', 'address', 'uint224', 'string'],
                        [policyHash, claimant, claimAmountInUsd2, evidence]
                      );
                      await claimsManager
                        .connect(roles.mediator)
                        .acceptClaim(policyHash, claimant, claimAmountInUsd1, evidence);
                      const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
                      await claimsManager
                        .connect(roles.mediator)
                        .proposeSettlement(policyHash, claimant, claimAmountInUsd2, evidence, settlementAmountInUsd);
                      await claimsManager
                        .connect(roles.arbitrator)
                        .createDispute(policyHash, claimant, claimAmountInUsd2, evidence);
                      const payoutAmountInUsd = coverageAmountInUsd.sub(claimAmountInUsd1).lt(claimAmountInUsd2)
                        ? coverageAmountInUsd.sub(claimAmountInUsd1)
                        : claimAmountInUsd2;
                      const payoutAmountInApi3 = payoutAmountInUsd
                        .mul(hre.ethers.utils.parseEther('1'))
                        .div(api3UsdPriceWith18Decimals);
                      const arbitratorDecision = ArbitratorDecision.PaySettlement;
                      const claimantBalance = await api3Token.balanceOf(claimant);
                      const coverageAmount = (await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd;
                      const quotaUsage = await claimsManager.getQuotaUsage(roles.admin.address);
                      await expect(
                        claimsManager
                          .connect(roles.admin)
                          .resolveDispute(policyHash, claimant, claimAmountInUsd2, evidence, arbitratorDecision)
                      )
                        .to.emit(claimsManager, 'ResolvedDisputeByAcceptingSettlement')
                        .withArgs(
                          claimant,
                          policyHash,
                          claimHash2,
                          payoutAmountInUsd,
                          payoutAmountInApi3,
                          roles.admin.address
                        );
                      expect((await api3Token.balanceOf(claimant)).sub(claimantBalance)).to.equal(payoutAmountInApi3);
                      const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                      const claimState = await claimsManager.claimHashToState(claimHash2);
                      expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithSettlementPayout);
                      expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
                      expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
                      expect(
                        coverageAmount.sub((await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd)
                      ).to.equal(payoutAmountInUsd);
                      expect((await claimsManager.getQuotaUsage(roles.admin.address)).sub(quotaUsage)).to.equal(
                        payoutAmountInApi3
                      );
                    });
                  });
                });
                context('Payout causes the sender quota to be exceeded', function () {
                  it('reverts', async function () {
                    const quotaPeriod = 7 * 24 * 60 * 60;
                    const quotaAmount = hre.ethers.utils.parseEther('1000');
                    await claimsManager.connect(roles.admin).setQuota(roles.admin.address, quotaPeriod, quotaAmount);
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
                    await claimsManager
                      .connect(roles.arbitrator)
                      .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                    const arbitratorDecision = ArbitratorDecision.PaySettlement;
                    await expect(
                      claimsManager
                        .connect(roles.admin)
                        .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                    ).to.be.revertedWith('Quota exceeded');
                  });
                });
              });
              context('Api3UsdAmountConverter is not valid', function () {
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
                  await claimsManager
                    .connect(roles.arbitrator)
                    .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                  const invalidApi3UsdAmountConverter = '0x00000000000000000000000000000000DeaDBeef';
                  await claimsManager.connect(roles.admin).setApi3UsdAmountConverter(invalidApi3UsdAmountConverter);
                  const arbitratorDecision = ArbitratorDecision.PaySettlement;
                  await expect(
                    claimsManager
                      .connect(roles.admin)
                      .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                  ).to.be.revertedWithoutReason;
                });
              });
            });
            context('Settlement was not proposed', function () {
              it('resolves dispute by not paying out', async function () {
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
                await claimsManager
                  .connect(roles.arbitrator)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                const arbitratorDecision = ArbitratorDecision.PaySettlement;
                await expect(
                  claimsManager
                    .connect(roles.admin)
                    .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                )
                  .to.emit(claimsManager, 'ResolvedDisputeByRejectingClaim')
                  .withArgs(claimant, policyHash, claimHash, roles.admin.address);
                expect(await api3Token.balanceOf(claimant)).to.equal(0);
                const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                const claimState = await claimsManager.claimHashToState(claimHash);
                expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithoutPayout);
                expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
                expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
              });
            });
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
            await claimsManager
              .connect(roles.arbitrator)
              .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
            const disputeResolutionBlockTimestamp = disputeCreationBlockTimestamp + arbitratorResponsePeriod;
            await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeResolutionBlockTimestamp]);
            const arbitratorDecision = ArbitratorDecision.DoNotPay;
            await expect(
              claimsManager
                .connect(roles.admin)
                .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
            ).to.be.revertedWith('Too late to resolve dispute');
          });
        });
      });
      context('Last action was not dispute creation', function () {
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
          await claimsManager.connect(roles.arbitrator).createDispute(policyHash, claimant, claimAmountInUsd, evidence);
          const arbitratorDecision = ArbitratorDecision.DoNotPay;
          await claimsManager
            .connect(roles.admin)
            .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision);
          await expect(
            claimsManager
              .connect(roles.admin)
              .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
          ).to.be.revertedWith('No dispute to be resolved');
        });
      });
    });
    context('Sender is arbitrator', function () {
      context('Sender is the arbitrator of the claim', function () {
        context('Last action was dispute creation', function () {
          context('It is not too late to resolve the dispute', function () {
            context('Arbitrator decision is to not pay out', function () {
              it('resolves dispute by not paying out', async function () {
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
                await claimsManager
                  .connect(roles.arbitrator)
                  .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                const arbitratorDecision = ArbitratorDecision.DoNotPay;
                await expect(
                  claimsManager
                    .connect(roles.arbitrator)
                    .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                )
                  .to.emit(claimsManager, 'ResolvedDisputeByRejectingClaim')
                  .withArgs(claimant, policyHash, claimHash, roles.arbitrator.address);
                expect(await api3Token.balanceOf(claimant)).to.equal(0);
                const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                const claimState = await claimsManager.claimHashToState(claimHash);
                expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithoutPayout);
                expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
                expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
              });
            });
            context('Arbitrator decision is to pay out the claim', function () {
              context('Api3UsdAmountConverter is valid', function () {
                context('Payout does not cause the sender quota to be exceeded', function () {
                  context('Coverage covers the entire payout', function () {
                    context('Pool has enough funds', function () {
                      it('resolves dispute by paying out the claim, updates coverage and records usage', async function () {
                        const quotaPeriod = 7 * 24 * 60 * 60;
                        const quotaAmount = hre.ethers.utils.parseEther('1000000');
                        await claimsManager
                          .connect(roles.admin)
                          .setQuota(roles.arbitrator.address, quotaPeriod, quotaAmount);
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
                        await claimsManager
                          .connect(roles.arbitrator)
                          .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                        const payoutAmountInUsd = claimAmountInUsd;
                        const payoutAmountInApi3 = claimAmountInUsd
                          .mul(hre.ethers.utils.parseEther('1'))
                          .div(api3UsdPriceWith18Decimals);
                        const arbitratorDecision = ArbitratorDecision.PayClaim;
                        await expect(
                          claimsManager
                            .connect(roles.arbitrator)
                            .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                        )
                          .to.emit(claimsManager, 'ResolvedDisputeByAcceptingClaim')
                          .withArgs(
                            claimant,
                            policyHash,
                            claimHash,
                            payoutAmountInUsd,
                            payoutAmountInApi3,
                            roles.arbitrator.address
                          );
                        expect(await api3Token.balanceOf(claimant)).to.equal(payoutAmountInApi3);
                        const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                        const claimState = await claimsManager.claimHashToState(claimHash);
                        expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithClaimPayout);
                        expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
                        expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
                        const policyState = await claimsManager.policyHashToState(policyHash);
                        expect(policyState.coverageAmountInUsd).to.equal(coverageAmountInUsd.sub(payoutAmountInUsd));
                        expect(await claimsManager.getQuotaUsage(roles.arbitrator.address)).to.equal(
                          payoutAmountInApi3
                        );
                      });
                    });
                    context('Pool does not have enough funds', function () {
                      it('reverts', async function () {
                        const usdAmountThatExceedsTotalStake = api3UsdPriceWith18Decimals.gt(
                          hre.ethers.utils.parseEther('1')
                        )
                          ? totalStake
                              .mul(api3UsdPriceWith18Decimals)
                              .div(hre.ethers.utils.parseEther('1'))
                              .add(api3UsdPriceWith18Decimals.div(hre.ethers.utils.parseEther('1')))
                          : totalStake.mul(api3UsdPriceWith18Decimals).div(hre.ethers.utils.parseEther('1')).add(1);
                        const claimant = roles.claimant.address;
                        const coverageAmountInUsd = usdAmountThatExceedsTotalStake;
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
                        const claimAmountInUsd = usdAmountThatExceedsTotalStake;
                        const evidence = '/ipfs/Qm...testaddress';
                        await claimsManager
                          .connect(roles.claimant)
                          .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                        const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                        const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
                        await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                        await claimsManager
                          .connect(roles.arbitrator)
                          .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                        const arbitratorDecision = ArbitratorDecision.PayClaim;
                        await expect(
                          claimsManager
                            .connect(roles.arbitrator)
                            .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                        ).to.be.revertedWith('Pool: Amount exceeds total stake');
                      });
                    });
                  });
                  context('Coverage does not cover the entire payout', function () {
                    it('resolves dispute by paying out the remaining coverage, updates coverage and records usage', async function () {
                      const quotaPeriod = 7 * 24 * 60 * 60;
                      const quotaAmount = hre.ethers.utils.parseEther('1000000');
                      await claimsManager
                        .connect(roles.admin)
                        .setQuota(roles.arbitrator.address, quotaPeriod, quotaAmount);
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
                      const evidence = '/ipfs/Qm...testaddress';
                      const claimAmountInUsd1 = hre.ethers.utils.parseEther('40000');
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                      const claimAmountInUsd2 = hre.ethers.utils.parseEther('25000');
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                      const claimHash2 = hre.ethers.utils.solidityKeccak256(
                        ['bytes32', 'address', 'uint224', 'string'],
                        [policyHash, claimant, claimAmountInUsd2, evidence]
                      );
                      await claimsManager
                        .connect(roles.mediator)
                        .acceptClaim(policyHash, claimant, claimAmountInUsd1, evidence);
                      const claimCreationBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                      const disputeCreationBlockTimestamp = claimCreationBlockTimestamp + mediatorResponsePeriod;
                      await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeCreationBlockTimestamp]);
                      await claimsManager
                        .connect(roles.arbitrator)
                        .createDispute(policyHash, claimant, claimAmountInUsd2, evidence);
                      const payoutAmountInUsd = coverageAmountInUsd.sub(claimAmountInUsd1).lt(claimAmountInUsd2)
                        ? coverageAmountInUsd.sub(claimAmountInUsd1)
                        : claimAmountInUsd2;
                      const payoutAmountInApi3 = payoutAmountInUsd
                        .mul(hre.ethers.utils.parseEther('1'))
                        .div(api3UsdPriceWith18Decimals);
                      const arbitratorDecision = ArbitratorDecision.PayClaim;
                      const claimantBalance = await api3Token.balanceOf(claimant);
                      const coverageAmount = (await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd;
                      const quotaUsage = await claimsManager.getQuotaUsage(roles.arbitrator.address);
                      await expect(
                        claimsManager
                          .connect(roles.arbitrator)
                          .resolveDispute(policyHash, claimant, claimAmountInUsd2, evidence, arbitratorDecision)
                      )
                        .to.emit(claimsManager, 'ResolvedDisputeByAcceptingClaim')
                        .withArgs(
                          claimant,
                          policyHash,
                          claimHash2,
                          payoutAmountInUsd,
                          payoutAmountInApi3,
                          roles.arbitrator.address
                        );
                      expect((await api3Token.balanceOf(claimant)).sub(claimantBalance)).to.equal(payoutAmountInApi3);
                      const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                      const claimState = await claimsManager.claimHashToState(claimHash2);
                      expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithClaimPayout);
                      expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
                      expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
                      expect(
                        coverageAmount.sub((await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd)
                      ).to.equal(payoutAmountInUsd);
                      expect((await claimsManager.getQuotaUsage(roles.arbitrator.address)).sub(quotaUsage)).to.equal(
                        payoutAmountInApi3
                      );
                    });
                  });
                });
                context('Payout causes the sender quota to be exceeded', function () {
                  it('reverts', async function () {
                    const quotaPeriod = 7 * 24 * 60 * 60;
                    const quotaAmount = hre.ethers.utils.parseEther('1000');
                    await claimsManager
                      .connect(roles.admin)
                      .setQuota(roles.arbitrator.address, quotaPeriod, quotaAmount);
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
                    await claimsManager
                      .connect(roles.arbitrator)
                      .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                    const arbitratorDecision = ArbitratorDecision.PayClaim;
                    await expect(
                      claimsManager
                        .connect(roles.arbitrator)
                        .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                    ).to.be.revertedWith('Quota exceeded');
                  });
                });
              });
              context('Api3UsdAmountConverter is not valid', function () {
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
                  await claimsManager
                    .connect(roles.arbitrator)
                    .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                  const invalidApi3UsdAmountConverter = '0x00000000000000000000000000000000DeaDBeef';
                  await claimsManager.connect(roles.admin).setApi3UsdAmountConverter(invalidApi3UsdAmountConverter);
                  const arbitratorDecision = ArbitratorDecision.PayClaim;
                  await expect(
                    claimsManager
                      .connect(roles.arbitrator)
                      .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                  ).to.be.revertedWithoutReason;
                });
              });
            });
            context('Arbitrator decision is to pay out the settlement', function () {
              context('Settlement was proposed', function () {
                context('Api3UsdAmountConverter is valid', function () {
                  context('Payout does not cause the sender quota to be exceeded', function () {
                    context('Coverage covers the entire payout', function () {
                      context('Pool has enough funds', function () {
                        it('resolves dispute by paying out the settlement, updates coverage and records usage', async function () {
                          const quotaPeriod = 7 * 24 * 60 * 60;
                          const quotaAmount = hre.ethers.utils.parseEther('1000000');
                          await claimsManager
                            .connect(roles.admin)
                            .setQuota(roles.arbitrator.address, quotaPeriod, quotaAmount);
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
                          await claimsManager
                            .connect(roles.arbitrator)
                            .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                          const payoutAmountInUsd = settlementAmountInUsd;
                          const payoutAmountInApi3 = payoutAmountInUsd
                            .mul(hre.ethers.utils.parseEther('1'))
                            .div(api3UsdPriceWith18Decimals);
                          const arbitratorDecision = ArbitratorDecision.PaySettlement;
                          await expect(
                            claimsManager
                              .connect(roles.arbitrator)
                              .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                          )
                            .to.emit(claimsManager, 'ResolvedDisputeByAcceptingSettlement')
                            .withArgs(
                              claimant,
                              policyHash,
                              claimHash,
                              payoutAmountInUsd,
                              payoutAmountInApi3,
                              roles.arbitrator.address
                            );
                          expect(await api3Token.balanceOf(claimant)).to.equal(payoutAmountInApi3);
                          const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                          const claimState = await claimsManager.claimHashToState(claimHash);
                          expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithSettlementPayout);
                          expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
                          expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
                          const policyState = await claimsManager.policyHashToState(policyHash);
                          expect(policyState.coverageAmountInUsd).to.equal(coverageAmountInUsd.sub(payoutAmountInUsd));
                          expect(await claimsManager.getQuotaUsage(roles.arbitrator.address)).to.equal(
                            payoutAmountInApi3
                          );
                        });
                      });
                      context('Pool does not have enough funds', function () {
                        it('reverts', async function () {
                          const usdAmountThatExceedsTotalStake = api3UsdPriceWith18Decimals.gt(
                            hre.ethers.utils.parseEther('1')
                          )
                            ? totalStake
                                .mul(api3UsdPriceWith18Decimals)
                                .div(hre.ethers.utils.parseEther('1'))
                                .add(api3UsdPriceWith18Decimals.div(hre.ethers.utils.parseEther('1')))
                            : totalStake.mul(api3UsdPriceWith18Decimals).div(hre.ethers.utils.parseEther('1')).add(1);

                          const claimant = roles.claimant.address;
                          const coverageAmountInUsd = usdAmountThatExceedsTotalStake.mul(2);
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
                          const claimAmountInUsd = usdAmountThatExceedsTotalStake.mul(2);
                          const evidence = '/ipfs/Qm...testaddress';
                          await claimsManager
                            .connect(roles.claimant)
                            .createClaim(claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                          const settlementAmountInUsd = usdAmountThatExceedsTotalStake;
                          await claimsManager
                            .connect(roles.mediator)
                            .proposeSettlement(policyHash, claimant, claimAmountInUsd, evidence, settlementAmountInUsd);
                          await claimsManager
                            .connect(roles.arbitrator)
                            .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                          const arbitratorDecision = ArbitratorDecision.PaySettlement;
                          await expect(
                            claimsManager
                              .connect(roles.arbitrator)
                              .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                          ).to.be.revertedWith('Pool: Amount exceeds total stake');
                        });
                      });
                    });
                    context('Coverage does not cover the entire payout', function () {
                      it('resolves dispute by paying out the remaining coverage, updates coverage and records usage', async function () {
                        const quotaPeriod = 7 * 24 * 60 * 60;
                        const quotaAmount = hre.ethers.utils.parseEther('1000000');
                        await claimsManager
                          .connect(roles.admin)
                          .setQuota(roles.arbitrator.address, quotaPeriod, quotaAmount);
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
                        const evidence = '/ipfs/Qm...testaddress';
                        const claimAmountInUsd1 = hre.ethers.utils.parseEther('40000');
                        await claimsManager
                          .connect(roles.claimant)
                          .createClaim(claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                        const claimAmountInUsd2 = hre.ethers.utils.parseEther('25000');
                        await claimsManager
                          .connect(roles.claimant)
                          .createClaim(claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                        const claimHash2 = hre.ethers.utils.solidityKeccak256(
                          ['bytes32', 'address', 'uint224', 'string'],
                          [policyHash, claimant, claimAmountInUsd2, evidence]
                        );
                        await claimsManager
                          .connect(roles.mediator)
                          .acceptClaim(policyHash, claimant, claimAmountInUsd1, evidence);
                        const settlementAmountInUsd = hre.ethers.utils.parseEther('12500');
                        await claimsManager
                          .connect(roles.mediator)
                          .proposeSettlement(policyHash, claimant, claimAmountInUsd2, evidence, settlementAmountInUsd);
                        await claimsManager
                          .connect(roles.arbitrator)
                          .createDispute(policyHash, claimant, claimAmountInUsd2, evidence);
                        const payoutAmountInUsd = coverageAmountInUsd.sub(claimAmountInUsd1).lt(claimAmountInUsd2)
                          ? coverageAmountInUsd.sub(claimAmountInUsd1)
                          : claimAmountInUsd2;
                        const payoutAmountInApi3 = payoutAmountInUsd
                          .mul(hre.ethers.utils.parseEther('1'))
                          .div(api3UsdPriceWith18Decimals);
                        const arbitratorDecision = ArbitratorDecision.PaySettlement;
                        const claimantBalance = await api3Token.balanceOf(claimant);
                        const coverageAmount = (await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd;
                        const quotaUsage = await claimsManager.getQuotaUsage(roles.arbitrator.address);
                        await expect(
                          claimsManager
                            .connect(roles.arbitrator)
                            .resolveDispute(policyHash, claimant, claimAmountInUsd2, evidence, arbitratorDecision)
                        )
                          .to.emit(claimsManager, 'ResolvedDisputeByAcceptingSettlement')
                          .withArgs(
                            claimant,
                            policyHash,
                            claimHash2,
                            payoutAmountInUsd,
                            payoutAmountInApi3,
                            roles.arbitrator.address
                          );
                        expect((await api3Token.balanceOf(claimant)).sub(claimantBalance)).to.equal(payoutAmountInApi3);
                        const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                        const claimState = await claimsManager.claimHashToState(claimHash2);
                        expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithSettlementPayout);
                        expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
                        expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
                        expect(
                          coverageAmount.sub((await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd)
                        ).to.equal(payoutAmountInUsd);
                        expect((await claimsManager.getQuotaUsage(roles.arbitrator.address)).sub(quotaUsage)).to.equal(
                          payoutAmountInApi3
                        );
                      });
                    });
                  });
                  context('Payout causes the sender quota to be exceeded', function () {
                    it('reverts', async function () {
                      const quotaPeriod = 7 * 24 * 60 * 60;
                      const quotaAmount = hre.ethers.utils.parseEther('1000');
                      await claimsManager
                        .connect(roles.admin)
                        .setQuota(roles.arbitrator.address, quotaPeriod, quotaAmount);
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
                      await claimsManager
                        .connect(roles.arbitrator)
                        .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                      const arbitratorDecision = ArbitratorDecision.PaySettlement;
                      await expect(
                        claimsManager
                          .connect(roles.arbitrator)
                          .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                      ).to.be.revertedWith('Quota exceeded');
                    });
                  });
                });
                context('Api3UsdAmountConverter is not valid', function () {
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
                    await claimsManager
                      .connect(roles.arbitrator)
                      .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                    const invalidApi3UsdAmountConverter = '0x00000000000000000000000000000000DeaDBeef';
                    await claimsManager.connect(roles.admin).setApi3UsdAmountConverter(invalidApi3UsdAmountConverter);
                    const arbitratorDecision = ArbitratorDecision.PaySettlement;
                    await expect(
                      claimsManager
                        .connect(roles.arbitrator)
                        .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                    ).to.be.revertedWithoutReason;
                  });
                });
              });
              context('Settlement was not proposed', function () {
                it('resolves dispute by not paying out', async function () {
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
                  await claimsManager
                    .connect(roles.arbitrator)
                    .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
                  const arbitratorDecision = ArbitratorDecision.PaySettlement;
                  await expect(
                    claimsManager
                      .connect(roles.arbitrator)
                      .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
                  )
                    .to.emit(claimsManager, 'ResolvedDisputeByRejectingClaim')
                    .withArgs(claimant, policyHash, claimHash, roles.arbitrator.address);
                  expect(await api3Token.balanceOf(claimant)).to.equal(0);
                  const disputeResolutionTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                  const claimState = await claimsManager.claimHashToState(claimHash);
                  expect(claimState.status).to.equal(ClaimStatus.DisputeResolvedWithoutPayout);
                  expect(claimState.updateTime).to.equal(disputeResolutionTimestamp);
                  expect(claimState.arbitrator).to.equal(roles.arbitrator.address);
                });
              });
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
              await claimsManager
                .connect(roles.arbitrator)
                .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
              const disputeResolutionBlockTimestamp = disputeCreationBlockTimestamp + arbitratorResponsePeriod;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [disputeResolutionBlockTimestamp]);
              const arbitratorDecision = ArbitratorDecision.DoNotPay;
              await expect(
                claimsManager
                  .connect(roles.arbitrator)
                  .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
              ).to.be.revertedWith('Too late to resolve dispute');
            });
          });
        });
        context('Last action was not dispute creation', function () {
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
            await claimsManager
              .connect(roles.arbitrator)
              .createDispute(policyHash, claimant, claimAmountInUsd, evidence);
            const arbitratorDecision = ArbitratorDecision.DoNotPay;
            await claimsManager
              .connect(roles.arbitrator)
              .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision);
            await expect(
              claimsManager
                .connect(roles.arbitrator)
                .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
            ).to.be.revertedWith('No dispute to be resolved');
          });
        });
      });
      context('Sender is not the arbitrator of the claim', function () {
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
          await accessControlRegistry
            .connect(roles.admin)
            .grantRole(await claimsManager.arbitratorRole(), roles.admin.address);
          await claimsManager.connect(roles.admin).createDispute(policyHash, claimant, claimAmountInUsd, evidence);
          const arbitratorDecision = ArbitratorDecision.DoNotPay;
          await expect(
            claimsManager
              .connect(roles.arbitrator)
              .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
          ).to.be.revertedWith('Sender cannot arbitrate');
        });
      });
    });
    context('Sender is not manager, admin or arbitrator', function () {
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
        await claimsManager.connect(roles.arbitrator).createDispute(policyHash, claimant, claimAmountInUsd, evidence);
        const arbitratorDecision = ArbitratorDecision.DoNotPay;
        await expect(
          claimsManager
            .connect(roles.randomPerson)
            .resolveDispute(policyHash, claimant, claimAmountInUsd, evidence, arbitratorDecision)
        ).to.be.revertedWith('Sender cannot arbitrate');
      });
    });
  });
});
