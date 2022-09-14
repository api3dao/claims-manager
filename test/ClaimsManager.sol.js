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

const mediatorResponsePeriod = 3 * 24 * 60 * 60,
  claimantResponsePeriod = 3 * 24 * 60 * 60,
  arbitratorResponsePeriod = 60 * 24 * 60 * 60;

// API3 price is $2
const api3UsdPriceWith18Decimals = hre.ethers.utils.parseEther('2');
// The API3 staking pool has 50 million API3 staked
const totalStake = hre.ethers.utils.parseEther('50000000');

describe('ClaimsManager', function () {
  let accessControlRegistry, api3Token, api3Pool, claimsManager, dapiServer, api3ToUsdReader;
  let roles;

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
      beneficiary: accounts[7],
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
    const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
    dapiServer = await dapiServerFactory.deploy();
    const dataFeedId = hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(32));
    const dataFeedTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
    await dapiServer.mockDataFeed(dataFeedId, api3UsdPriceWith18Decimals, dataFeedTimestamp);
    const dapiName = hre.ethers.utils.formatBytes32String('API3/USD');
    await dapiServer.mockDapiName(dapiName, dataFeedId);
    const api3ToUsdReaderFactory = await hre.ethers.getContractFactory('Api3ToUsdReader', roles.deployer);
    api3ToUsdReader = await api3ToUsdReaderFactory.deploy(dapiServer.address, claimsManager.address);
    await claimsManager.connect(roles.admin).setApi3ToUsdReader(api3ToUsdReader.address);
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

  describe('setApi3ToUsdReader', function () {
    context('Sender is manager', function () {
      context('Api3ToUsdReader address is not zero', function () {
        it('sets Api3ToUsdReader', async function () {
          const newApi3ToUsdReader = hre.ethers.utils.getAddress(
            hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20))
          );
          await expect(claimsManager.connect(roles.manager).setApi3ToUsdReader(newApi3ToUsdReader))
            .to.emit(claimsManager, 'SetApi3ToUsdReader')
            .withArgs(newApi3ToUsdReader, roles.manager.address);
          expect(await claimsManager.api3ToUsdReader()).to.equal(newApi3ToUsdReader);
        });
      });
      context('Api3ToUsdReader address is zero', function () {
        it('reverts', async function () {
          await expect(
            claimsManager.connect(roles.manager).setApi3ToUsdReader(hre.ethers.constants.AddressZero)
          ).to.be.revertedWith('Api3ToUsdReader address zero');
        });
      });
    });
    context('Sender is admin', function () {
      context('Api3ToUsdReader address is not zero', function () {
        it('sets Api3ToUsdReader', async function () {
          const newApi3ToUsdReader = hre.ethers.utils.getAddress(
            hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20))
          );
          await expect(claimsManager.connect(roles.admin).setApi3ToUsdReader(newApi3ToUsdReader))
            .to.emit(claimsManager, 'SetApi3ToUsdReader')
            .withArgs(newApi3ToUsdReader, roles.admin.address);
          expect(await claimsManager.api3ToUsdReader()).to.equal(newApi3ToUsdReader);
        });
      });
      context('Api3ToUsdReader address is zero', function () {
        it('reverts', async function () {
          await expect(
            claimsManager.connect(roles.admin).setApi3ToUsdReader(hre.ethers.constants.AddressZero)
          ).to.be.revertedWith('Api3ToUsdReader address zero');
        });
      });
    });
    context('Sender is not manager or admin', function () {
      it('reverts', async function () {
        await expect(
          claimsManager.connect(roles.randomPerson).setApi3ToUsdReader(api3ToUsdReader.address)
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
        await expect(claimsManager.connect(roles.randomPerson).setApi3Pool(api3ToUsdReader.address)).to.be.revertedWith(
          'Sender cannot administrate'
        );
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
      context('Account address is not zero', function () {
        context('Quota period is not zero', function () {
          context('Quota amount is not zero', function () {
            it('sets quota', async function () {
              const account = hre.ethers.utils.getAddress(hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20)));
              const period = 7 * 24 * 60 * 60;
              const amountInApi3 = hre.ethers.utils.parseEther('1000');
              await expect(claimsManager.connect(roles.manager).setQuota(account, period, amountInApi3))
                .to.emit(claimsManager, 'SetQuota')
                .withArgs(account, period, amountInApi3, roles.manager.address);
              const quota = await claimsManager.accountToQuota(account);
              expect(quota.period).is.equal(period);
              expect(quota.amountInApi3).is.equal(amountInApi3);
            });
          });
          context('Quota amount is zero', function () {
            it('reverts', async function () {
              const account = hre.ethers.utils.getAddress(hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20)));
              const period = 7 * 24 * 60 * 60;
              const amountInApi3 = 0;
              await expect(
                claimsManager.connect(roles.manager).setQuota(account, period, amountInApi3)
              ).to.be.revertedWith('Quota amount zero');
            });
          });
        });
        context('Quota period is zero', function () {
          it('reverts', async function () {
            const account = hre.ethers.utils.getAddress(hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20)));
            const period = 0;
            const amountInApi3 = hre.ethers.utils.parseEther('1000');
            await expect(
              claimsManager.connect(roles.manager).setQuota(account, period, amountInApi3)
            ).to.be.revertedWith('Quota period zero');
          });
        });
      });
      context('Account address is zero', function () {
        it('reverts', async function () {
          const account = hre.ethers.constants.AddressZero;
          const period = 7 * 24 * 60 * 60;
          const amountInApi3 = hre.ethers.utils.parseEther('1000');
          await expect(claimsManager.connect(roles.manager).setQuota(account, period, amountInApi3)).to.be.revertedWith(
            'Account address zero'
          );
        });
      });
    });
    context('Sender is admin', function () {
      context('Account address is not zero', function () {
        context('Quota period is not zero', function () {
          context('Quota amount is not zero', function () {
            it('sets quota', async function () {
              const account = hre.ethers.utils.getAddress(hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20)));
              const period = 7 * 24 * 60 * 60;
              const amountInApi3 = hre.ethers.utils.parseEther('1000');
              await expect(claimsManager.connect(roles.admin).setQuota(account, period, amountInApi3))
                .to.emit(claimsManager, 'SetQuota')
                .withArgs(account, period, amountInApi3, roles.admin.address);
              const quota = await claimsManager.accountToQuota(account);
              expect(quota.period).is.equal(period);
              expect(quota.amountInApi3).is.equal(amountInApi3);
            });
          });
          context('Quota amount is zero', function () {
            it('reverts', async function () {
              const account = hre.ethers.utils.getAddress(hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20)));
              const period = 7 * 24 * 60 * 60;
              const amountInApi3 = 0;
              await expect(
                claimsManager.connect(roles.admin).setQuota(account, period, amountInApi3)
              ).to.be.revertedWith('Quota amount zero');
            });
          });
        });
        context('Quota period is zero', function () {
          it('reverts', async function () {
            const account = hre.ethers.utils.getAddress(hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20)));
            const period = 0;
            const amountInApi3 = hre.ethers.utils.parseEther('1000');
            await expect(claimsManager.connect(roles.admin).setQuota(account, period, amountInApi3)).to.be.revertedWith(
              'Quota period zero'
            );
          });
        });
      });
      context('Account address is zero', function () {
        it('reverts', async function () {
          const account = hre.ethers.constants.AddressZero;
          const period = 7 * 24 * 60 * 60;
          const amountInApi3 = hre.ethers.utils.parseEther('1000');
          await expect(claimsManager.connect(roles.admin).setQuota(account, period, amountInApi3)).to.be.revertedWith(
            'Account address zero'
          );
        });
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
      context('Account address is not zero', function () {
        context('Quota is set before', function () {
          it('resets quota', async function () {
            const account = hre.ethers.utils.getAddress(hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20)));
            const period = 7 * 24 * 60 * 60;
            const amountInApi3 = hre.ethers.utils.parseEther('1000');
            await claimsManager.connect(roles.manager).setQuota(account, period, amountInApi3);
            await expect(claimsManager.connect(roles.manager).resetQuota(account))
              .to.emit(claimsManager, 'ResetQuota')
              .withArgs(account, roles.manager.address);
            const quota = await claimsManager.accountToQuota(account);
            expect(quota.period).is.equal(0);
            expect(quota.amountInApi3).is.equal(0);
          });
        });
        context('Quota is not set before', function () {
          it('resets quota', async function () {
            const account = hre.ethers.utils.getAddress(hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20)));
            await expect(claimsManager.connect(roles.manager).resetQuota(account))
              .to.emit(claimsManager, 'ResetQuota')
              .withArgs(account, roles.manager.address);
            const quota = await claimsManager.accountToQuota(account);
            expect(quota.period).is.equal(0);
            expect(quota.amountInApi3).is.equal(0);
          });
        });
      });
      context('Account address is zero', function () {
        it('reverts', async function () {
          const account = hre.ethers.constants.AddressZero;
          await expect(claimsManager.connect(roles.manager).resetQuota(account)).to.be.revertedWith(
            'Account address zero'
          );
        });
      });
    });
    context('Sender is admin', function () {
      context('Account address is not zero', function () {
        context('Quota is set before', function () {
          it('resets quota', async function () {
            const account = hre.ethers.utils.getAddress(hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20)));
            const period = 7 * 24 * 60 * 60;
            const amountInApi3 = hre.ethers.utils.parseEther('1000');
            await claimsManager.connect(roles.admin).setQuota(account, period, amountInApi3);
            await expect(claimsManager.connect(roles.admin).resetQuota(account))
              .to.emit(claimsManager, 'ResetQuota')
              .withArgs(account, roles.admin.address);
            const quota = await claimsManager.accountToQuota(account);
            expect(quota.period).is.equal(0);
            expect(quota.amountInApi3).is.equal(0);
          });
        });
        context('Quota is not set before', function () {
          it('resets quota', async function () {
            const account = hre.ethers.utils.getAddress(hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(20)));
            await expect(claimsManager.connect(roles.admin).resetQuota(account))
              .to.emit(claimsManager, 'ResetQuota')
              .withArgs(account, roles.admin.address);
            const quota = await claimsManager.accountToQuota(account);
            expect(quota.period).is.equal(0);
            expect(quota.amountInApi3).is.equal(0);
          });
        });
      });
      context('Account address is zero', function () {
        it('reverts', async function () {
          const account = hre.ethers.constants.AddressZero;
          await expect(claimsManager.connect(roles.admin).resetQuota(account)).to.be.revertedWith(
            'Account address zero'
          );
        });
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
        context('Beneficiary address is not zero', function () {
          context('Coverage amount is not zero', function () {
            context('Claim period does not start from timestamp-zero', function () {
              context('Claim period ends later than it starts', function () {
                context('Policy address is not empty', function () {
                  context('Policy has not been created before', function () {
                    it('creates policy', async function () {
                      const claimant = roles.claimant.address;
                      const beneficiary = roles.beneficiary.address;
                      const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                      // claimsAllowedFrom can be from the past
                      const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                      const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                      const policy = '/ipfs/Qm...testaddress';
                      const policyHash = hre.ethers.utils.solidityKeccak256(
                        ['address', 'address', 'uint32', 'string'],
                        [claimant, beneficiary, claimsAllowedFrom, policy]
                      );
                      await expect(
                        claimsManager
                          .connect(roles.manager)
                          .createPolicy(
                            claimant,
                            beneficiary,
                            coverageAmountInUsd,
                            claimsAllowedFrom,
                            claimsAllowedUntil,
                            policy
                          )
                      )
                        .to.emit(claimsManager, 'CreatedPolicy')
                        .withArgs(
                          beneficiary,
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
                      const beneficiary = roles.beneficiary.address;
                      const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                      const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                      const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                      const policy = '/ipfs/Qm...testaddress';
                      await claimsManager
                        .connect(roles.manager)
                        .createPolicy(
                          claimant,
                          beneficiary,
                          coverageAmountInUsd,
                          claimsAllowedFrom,
                          claimsAllowedUntil,
                          policy
                        );
                      await expect(
                        claimsManager
                          .connect(roles.manager)
                          .createPolicy(
                            claimant,
                            beneficiary,
                            coverageAmountInUsd,
                            claimsAllowedFrom,
                            claimsAllowedUntil,
                            policy
                          )
                      ).to.be.revertedWith('Policy created before');
                    });
                  });
                });
                context('Policy address is empty', function () {
                  it('reverts', async function () {
                    const claimant = roles.claimant.address;
                    const beneficiary = roles.beneficiary.address;
                    const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                    const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                    const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                    const policy = '';
                    await expect(
                      claimsManager
                        .connect(roles.manager)
                        .createPolicy(
                          claimant,
                          beneficiary,
                          coverageAmountInUsd,
                          claimsAllowedFrom,
                          claimsAllowedUntil,
                          policy
                        )
                    ).to.be.revertedWith('Policy address empty');
                  });
                });
              });
              context('Claim period does not end later than it starts', function () {
                it('reverts', async function () {
                  const claimant = roles.claimant.address;
                  const beneficiary = roles.beneficiary.address;
                  const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                  const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                  const claimsAllowedUntil = claimsAllowedFrom;
                  const policy = '/ipfs/Qm...testaddress';
                  await expect(
                    claimsManager
                      .connect(roles.manager)
                      .createPolicy(
                        claimant,
                        beneficiary,
                        coverageAmountInUsd,
                        claimsAllowedFrom,
                        claimsAllowedUntil,
                        policy
                      )
                  ).to.be.revertedWith('Start not earlier than end');
                });
              });
            });
            context('Claim period starts from timestamp-zero', function () {
              it('reverts', async function () {
                const claimant = roles.claimant.address;
                const beneficiary = roles.beneficiary.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = 0;
                const claimsAllowedUntil = (await hre.ethers.provider.getBlock()).timestamp + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                await expect(
                  claimsManager
                    .connect(roles.manager)
                    .createPolicy(
                      claimant,
                      beneficiary,
                      coverageAmountInUsd,
                      claimsAllowedFrom,
                      claimsAllowedUntil,
                      policy
                    )
                ).to.be.revertedWith('Start time zero');
              });
            });
          });
          context('Coverage amount is zero', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const beneficiary = roles.beneficiary.address;
              const coverageAmountInUsd = 0;
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              await expect(
                claimsManager
                  .connect(roles.manager)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy
                  )
              ).to.be.revertedWith('Coverage amount zero');
            });
          });
        });
        context('Beneficiary address is zero', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const beneficiary = hre.ethers.constants.AddressZero;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await expect(
              claimsManager
                .connect(roles.manager)
                .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
            ).to.be.revertedWith('Beneficiary address zero');
          });
        });
      });
      context('Claimant address is zero', function () {
        it('reverts', async function () {
          const claimant = hre.ethers.constants.AddressZero;
          const beneficiary = roles.beneficiary.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.manager)
              .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
          ).to.be.revertedWith('Claimant address zero');
        });
      });
    });
    context('Sender is admin', function () {
      context('Claimant address is not zero', function () {
        context('Beneficiary address is not zero', function () {
          context('Coverage amount is not zero', function () {
            context('Claim period does not start from timestamp-zero', function () {
              context('Claim period ends later than it starts', function () {
                context('Policy address is not empty', function () {
                  context('Policy has not been created before', function () {
                    it('creates policy', async function () {
                      const claimant = roles.claimant.address;
                      const beneficiary = roles.beneficiary.address;
                      const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                      // claimsAllowedFrom can be from the past
                      const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                      const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                      const policy = '/ipfs/Qm...testaddress';
                      const policyHash = hre.ethers.utils.solidityKeccak256(
                        ['address', 'address', 'uint32', 'string'],
                        [claimant, beneficiary, claimsAllowedFrom, policy]
                      );
                      await expect(
                        claimsManager
                          .connect(roles.admin)
                          .createPolicy(
                            claimant,
                            beneficiary,
                            coverageAmountInUsd,
                            claimsAllowedFrom,
                            claimsAllowedUntil,
                            policy
                          )
                      )
                        .to.emit(claimsManager, 'CreatedPolicy')
                        .withArgs(
                          beneficiary,
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
                      const beneficiary = roles.beneficiary.address;
                      const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                      const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                      const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                      const policy = '/ipfs/Qm...testaddress';
                      await claimsManager
                        .connect(roles.admin)
                        .createPolicy(
                          claimant,
                          beneficiary,
                          coverageAmountInUsd,
                          claimsAllowedFrom,
                          claimsAllowedUntil,
                          policy
                        );
                      await expect(
                        claimsManager
                          .connect(roles.admin)
                          .createPolicy(
                            claimant,
                            beneficiary,
                            coverageAmountInUsd,
                            claimsAllowedFrom,
                            claimsAllowedUntil,
                            policy
                          )
                      ).to.be.revertedWith('Policy created before');
                    });
                  });
                });
                context('Policy address is empty', function () {
                  it('reverts', async function () {
                    const claimant = roles.claimant.address;
                    const beneficiary = roles.beneficiary.address;
                    const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                    const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                    const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                    const policy = '';
                    await expect(
                      claimsManager
                        .connect(roles.admin)
                        .createPolicy(
                          claimant,
                          beneficiary,
                          coverageAmountInUsd,
                          claimsAllowedFrom,
                          claimsAllowedUntil,
                          policy
                        )
                    ).to.be.revertedWith('Policy address empty');
                  });
                });
              });
              context('Claim period does not end later than it starts', function () {
                it('reverts', async function () {
                  const claimant = roles.claimant.address;
                  const beneficiary = roles.beneficiary.address;
                  const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                  const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                  const claimsAllowedUntil = claimsAllowedFrom;
                  const policy = '/ipfs/Qm...testaddress';
                  await expect(
                    claimsManager
                      .connect(roles.admin)
                      .createPolicy(
                        claimant,
                        beneficiary,
                        coverageAmountInUsd,
                        claimsAllowedFrom,
                        claimsAllowedUntil,
                        policy
                      )
                  ).to.be.revertedWith('Start not earlier than end');
                });
              });
            });
            context('Claim period starts from timestamp-zero', function () {
              it('reverts', async function () {
                const claimant = roles.claimant.address;
                const beneficiary = roles.beneficiary.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = 0;
                const claimsAllowedUntil = (await hre.ethers.provider.getBlock()).timestamp + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                await expect(
                  claimsManager
                    .connect(roles.admin)
                    .createPolicy(
                      claimant,
                      beneficiary,
                      coverageAmountInUsd,
                      claimsAllowedFrom,
                      claimsAllowedUntil,
                      policy
                    )
                ).to.be.revertedWith('Start time zero');
              });
            });
          });
          context('Coverage amount is zero', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const beneficiary = roles.beneficiary.address;
              const coverageAmountInUsd = 0;
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              await expect(
                claimsManager
                  .connect(roles.admin)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy
                  )
              ).to.be.revertedWith('Coverage amount zero');
            });
          });
        });
        context('Beneficiary address is zero', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const beneficiary = hre.ethers.constants.AddressZero;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await expect(
              claimsManager
                .connect(roles.admin)
                .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
            ).to.be.revertedWith('Beneficiary address zero');
          });
        });
      });
      context('Claimant address is zero', function () {
        it('reverts', async function () {
          const claimant = hre.ethers.constants.AddressZero;
          const beneficiary = roles.beneficiary.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.admin)
              .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
          ).to.be.revertedWith('Claimant address zero');
        });
      });
    });
    context('Sender is policy agent', function () {
      context('Claimant address is not zero', function () {
        context('Beneficiary address is not zero', function () {
          context('Coverage amount is not zero', function () {
            context('Claim period does not start from timestamp-zero', function () {
              context('Claim period ends later than it starts', function () {
                context('Policy address is not empty', function () {
                  context('Policy has not been created before', function () {
                    it('creates policy', async function () {
                      const claimant = roles.claimant.address;
                      const beneficiary = roles.beneficiary.address;
                      const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                      // claimsAllowedFrom can be from the past
                      const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                      const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                      const policy = '/ipfs/Qm...testaddress';
                      const policyHash = hre.ethers.utils.solidityKeccak256(
                        ['address', 'address', 'uint32', 'string'],
                        [claimant, beneficiary, claimsAllowedFrom, policy]
                      );
                      await expect(
                        claimsManager
                          .connect(roles.policyAgent)
                          .createPolicy(
                            claimant,
                            beneficiary,
                            coverageAmountInUsd,
                            claimsAllowedFrom,
                            claimsAllowedUntil,
                            policy
                          )
                      )
                        .to.emit(claimsManager, 'CreatedPolicy')
                        .withArgs(
                          beneficiary,
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
                      const beneficiary = roles.beneficiary.address;
                      const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                      const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                      const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                      const policy = '/ipfs/Qm...testaddress';
                      await claimsManager
                        .connect(roles.policyAgent)
                        .createPolicy(
                          claimant,
                          beneficiary,
                          coverageAmountInUsd,
                          claimsAllowedFrom,
                          claimsAllowedUntil,
                          policy
                        );
                      await expect(
                        claimsManager
                          .connect(roles.policyAgent)
                          .createPolicy(
                            claimant,
                            beneficiary,
                            coverageAmountInUsd,
                            claimsAllowedFrom,
                            claimsAllowedUntil,
                            policy
                          )
                      ).to.be.revertedWith('Policy created before');
                    });
                  });
                });
                context('Policy address is empty', function () {
                  it('reverts', async function () {
                    const claimant = roles.claimant.address;
                    const beneficiary = roles.beneficiary.address;
                    const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                    const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                    const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                    const policy = '';
                    await expect(
                      claimsManager
                        .connect(roles.policyAgent)
                        .createPolicy(
                          claimant,
                          beneficiary,
                          coverageAmountInUsd,
                          claimsAllowedFrom,
                          claimsAllowedUntil,
                          policy
                        )
                    ).to.be.revertedWith('Policy address empty');
                  });
                });
              });
              context('Claim period does not end later than it starts', function () {
                it('reverts', async function () {
                  const claimant = roles.claimant.address;
                  const beneficiary = roles.beneficiary.address;
                  const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                  const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                  const claimsAllowedUntil = claimsAllowedFrom;
                  const policy = '/ipfs/Qm...testaddress';
                  await expect(
                    claimsManager
                      .connect(roles.policyAgent)
                      .createPolicy(
                        claimant,
                        beneficiary,
                        coverageAmountInUsd,
                        claimsAllowedFrom,
                        claimsAllowedUntil,
                        policy
                      )
                  ).to.be.revertedWith('Start not earlier than end');
                });
              });
            });
            context('Claim period starts from timestamp-zero', function () {
              it('reverts', async function () {
                const claimant = roles.claimant.address;
                const beneficiary = roles.beneficiary.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = 0;
                const claimsAllowedUntil = (await hre.ethers.provider.getBlock()).timestamp + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                await expect(
                  claimsManager
                    .connect(roles.policyAgent)
                    .createPolicy(
                      claimant,
                      beneficiary,
                      coverageAmountInUsd,
                      claimsAllowedFrom,
                      claimsAllowedUntil,
                      policy
                    )
                ).to.be.revertedWith('Start time zero');
              });
            });
          });
          context('Coverage amount is zero', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const beneficiary = roles.beneficiary.address;
              const coverageAmountInUsd = 0;
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              await expect(
                claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy
                  )
              ).to.be.revertedWith('Coverage amount zero');
            });
          });
        });
        context('Beneficiary address is zero', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const beneficiary = hre.ethers.constants.AddressZero;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await expect(
              claimsManager
                .connect(roles.policyAgent)
                .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
            ).to.be.revertedWith('Beneficiary address zero');
          });
        });
      });
      context('Claimant address is zero', function () {
        it('reverts', async function () {
          const claimant = hre.ethers.constants.AddressZero;
          const beneficiary = roles.beneficiary.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
          ).to.be.revertedWith('Claimant address zero');
        });
      });
    });
    context('Sender is not manager, admin or policy agent', function () {
      it('reverts', async function () {
        await expect(
          claimsManager
            .connect(roles.randomPerson)
            .createPolicy(hre.ethers.constants.AddressZero, hre.ethers.constants.AddressZero, 0, 0, 0, '')
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
              const beneficiary = roles.beneficiary.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              // claimsAllowedFrom can be from the past
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'address', 'uint32', 'string'],
                [claimant, beneficiary, claimsAllowedFrom, policy]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy
                );
              const newCoverageAmountInUsd = coverageAmountInUsd.add(hre.ethers.utils.parseEther('50000'));
              const newClaimsAllowedUntil = claimsAllowedUntil + 365 * 24 * 60 * 60;
              await expect(
                claimsManager
                  .connect(roles.manager)
                  .upgradePolicy(
                    claimant,
                    beneficiary,
                    newCoverageAmountInUsd,
                    claimsAllowedFrom,
                    newClaimsAllowedUntil,
                    policy
                  )
              )
                .to.emit(claimsManager, 'UpgradedPolicy')
                .withArgs(
                  beneficiary,
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
              const beneficiary = roles.beneficiary.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy
                );
              const newCoverageAmountInUsd = coverageAmountInUsd.add(hre.ethers.utils.parseEther('50000'));
              const newClaimsAllowedUntil = claimsAllowedUntil - 1;
              await expect(
                claimsManager
                  .connect(roles.manager)
                  .upgradePolicy(
                    claimant,
                    beneficiary,
                    newCoverageAmountInUsd,
                    claimsAllowedFrom,
                    newClaimsAllowedUntil,
                    policy
                  )
              ).to.be.revertedWith('Reduces claim period');
            });
          });
        });
        context('Upgrade reduces coverage amount', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const beneficiary = roles.beneficiary.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
            const newCoverageAmountInUsd = coverageAmountInUsd.sub(1);
            const newClaimsAllowedUntil = claimsAllowedUntil + 365 * 24 * 60 * 60;
            await expect(
              claimsManager
                .connect(roles.manager)
                .upgradePolicy(
                  claimant,
                  beneficiary,
                  newCoverageAmountInUsd,
                  claimsAllowedFrom,
                  newClaimsAllowedUntil,
                  policy
                )
            ).to.be.revertedWith('Reduces coverage amount');
          });
        });
      });
      context('Policy does not exist', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const beneficiary = roles.beneficiary.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.manager)
              .upgradePolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
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
              const beneficiary = roles.beneficiary.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              // claimsAllowedFrom can be from the past
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'address', 'uint32', 'string'],
                [claimant, beneficiary, claimsAllowedFrom, policy]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy
                );
              const newCoverageAmountInUsd = coverageAmountInUsd.add(hre.ethers.utils.parseEther('50000'));
              const newClaimsAllowedUntil = claimsAllowedUntil + 365 * 24 * 60 * 60;
              await expect(
                claimsManager
                  .connect(roles.admin)
                  .upgradePolicy(
                    claimant,
                    beneficiary,
                    newCoverageAmountInUsd,
                    claimsAllowedFrom,
                    newClaimsAllowedUntil,
                    policy
                  )
              )
                .to.emit(claimsManager, 'UpgradedPolicy')
                .withArgs(
                  beneficiary,
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
              const beneficiary = roles.beneficiary.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy
                );
              const newCoverageAmountInUsd = coverageAmountInUsd.add(hre.ethers.utils.parseEther('50000'));
              const newClaimsAllowedUntil = claimsAllowedUntil - 1;
              await expect(
                claimsManager
                  .connect(roles.admin)
                  .upgradePolicy(
                    claimant,
                    beneficiary,
                    newCoverageAmountInUsd,
                    claimsAllowedFrom,
                    newClaimsAllowedUntil,
                    policy
                  )
              ).to.be.revertedWith('Reduces claim period');
            });
          });
        });
        context('Upgrade reduces coverage amount', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const beneficiary = roles.beneficiary.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
            const newCoverageAmountInUsd = coverageAmountInUsd.sub(1);
            const newClaimsAllowedUntil = claimsAllowedUntil + 365 * 24 * 60 * 60;
            await expect(
              claimsManager
                .connect(roles.admin)
                .upgradePolicy(
                  claimant,
                  beneficiary,
                  newCoverageAmountInUsd,
                  claimsAllowedFrom,
                  newClaimsAllowedUntil,
                  policy
                )
            ).to.be.revertedWith('Reduces coverage amount');
          });
        });
      });
      context('Policy does not exist', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const beneficiary = roles.beneficiary.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.admin)
              .upgradePolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
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
              const beneficiary = roles.beneficiary.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              // claimsAllowedFrom can be from the past
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'address', 'uint32', 'string'],
                [claimant, beneficiary, claimsAllowedFrom, policy]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy
                );
              const newCoverageAmountInUsd = coverageAmountInUsd.add(hre.ethers.utils.parseEther('50000'));
              const newClaimsAllowedUntil = claimsAllowedUntil + 365 * 24 * 60 * 60;
              await expect(
                claimsManager
                  .connect(roles.policyAgent)
                  .upgradePolicy(
                    claimant,
                    beneficiary,
                    newCoverageAmountInUsd,
                    claimsAllowedFrom,
                    newClaimsAllowedUntil,
                    policy
                  )
              )
                .to.emit(claimsManager, 'UpgradedPolicy')
                .withArgs(
                  beneficiary,
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
              const beneficiary = roles.beneficiary.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy
                );
              const newCoverageAmountInUsd = coverageAmountInUsd.add(hre.ethers.utils.parseEther('50000'));
              const newClaimsAllowedUntil = claimsAllowedUntil - 1;
              await expect(
                claimsManager
                  .connect(roles.policyAgent)
                  .upgradePolicy(
                    claimant,
                    beneficiary,
                    newCoverageAmountInUsd,
                    claimsAllowedFrom,
                    newClaimsAllowedUntil,
                    policy
                  )
              ).to.be.revertedWith('Reduces claim period');
            });
          });
        });
        context('Upgrade reduces coverage amount', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const beneficiary = roles.beneficiary.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
            const newCoverageAmountInUsd = coverageAmountInUsd.sub(1);
            const newClaimsAllowedUntil = claimsAllowedUntil + 365 * 24 * 60 * 60;
            await expect(
              claimsManager
                .connect(roles.policyAgent)
                .upgradePolicy(
                  claimant,
                  beneficiary,
                  newCoverageAmountInUsd,
                  claimsAllowedFrom,
                  newClaimsAllowedUntil,
                  policy
                )
            ).to.be.revertedWith('Reduces coverage amount');
          });
        });
      });
      context('Policy does not exist', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const beneficiary = roles.beneficiary.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.policyAgent)
              .upgradePolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
          ).to.be.revertedWith('Policy does not exist');
        });
      });
    });
    context('Sender is not manager, admin or policy agent', function () {
      it('reverts', async function () {
        await expect(
          claimsManager
            .connect(roles.randomPerson)
            .upgradePolicy(hre.ethers.constants.AddressZero, hre.ethers.constants.AddressZero, 0, 0, 0, '')
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
                const beneficiary = roles.beneficiary.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                // claimsAllowedFrom can be from the past
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'address', 'uint32', 'string'],
                  [claimant, beneficiary, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy
                  );
                const newCoverageAmountInUsd = coverageAmountInUsd.sub(hre.ethers.utils.parseEther('10000'));
                const newClaimsAllowedUntil = claimsAllowedUntil - 30 * 24 * 60 * 60;
                await expect(
                  claimsManager
                    .connect(roles.manager)
                    .downgradePolicy(
                      claimant,
                      beneficiary,
                      newCoverageAmountInUsd,
                      claimsAllowedFrom,
                      newClaimsAllowedUntil,
                      policy
                    )
                )
                  .to.emit(claimsManager, 'DowngradedPolicy')
                  .withArgs(
                    beneficiary,
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
                const beneficiary = roles.beneficiary.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy
                  );
                const newCoverageAmountInUsd = coverageAmountInUsd.sub(hre.ethers.utils.parseEther('10000'));
                const newClaimsAllowedUntil = claimsAllowedUntil + 1;
                await expect(
                  claimsManager
                    .connect(roles.manager)
                    .downgradePolicy(
                      claimant,
                      beneficiary,
                      newCoverageAmountInUsd,
                      claimsAllowedFrom,
                      newClaimsAllowedUntil,
                      policy
                    )
                ).to.be.revertedWith('Increases claim period');
              });
            });
          });
          context('Downgrade increases coverage amount', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const beneficiary = roles.beneficiary.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy
                );
              const newCoverageAmountInUsd = coverageAmountInUsd.add(1);
              const newClaimsAllowedUntil = claimsAllowedUntil - 30 * 24 * 60 * 60;
              await expect(
                claimsManager
                  .connect(roles.manager)
                  .downgradePolicy(
                    claimant,
                    beneficiary,
                    newCoverageAmountInUsd,
                    claimsAllowedFrom,
                    newClaimsAllowedUntil,
                    policy
                  )
              ).to.be.revertedWith('Increases coverage amount');
            });
          });
        });
        context('Policy does not exist', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const beneficiary = roles.beneficiary.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await expect(
              claimsManager
                .connect(roles.manager)
                .downgradePolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy
                )
            ).to.be.revertedWith('Policy does not exist');
          });
        });
      });
      context('Claim period does not end later than it starts', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const beneficiary = roles.beneficiary.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom;
          const policy = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.manager)
              .downgradePolicy(
                claimant,
                beneficiary,
                coverageAmountInUsd,
                claimsAllowedFrom,
                claimsAllowedUntil,
                policy
              )
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
                const beneficiary = roles.beneficiary.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                // claimsAllowedFrom can be from the past
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'address', 'uint32', 'string'],
                  [claimant, beneficiary, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy
                  );
                const newCoverageAmountInUsd = coverageAmountInUsd.sub(hre.ethers.utils.parseEther('10000'));
                const newClaimsAllowedUntil = claimsAllowedUntil - 30 * 24 * 60 * 60;
                await expect(
                  claimsManager
                    .connect(roles.admin)
                    .downgradePolicy(
                      claimant,
                      beneficiary,
                      newCoverageAmountInUsd,
                      claimsAllowedFrom,
                      newClaimsAllowedUntil,
                      policy
                    )
                )
                  .to.emit(claimsManager, 'DowngradedPolicy')
                  .withArgs(
                    beneficiary,
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
                const beneficiary = roles.beneficiary.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy
                  );
                const newCoverageAmountInUsd = coverageAmountInUsd.sub(hre.ethers.utils.parseEther('10000'));
                const newClaimsAllowedUntil = claimsAllowedUntil + 1;
                await expect(
                  claimsManager
                    .connect(roles.admin)
                    .downgradePolicy(
                      claimant,
                      beneficiary,
                      newCoverageAmountInUsd,
                      claimsAllowedFrom,
                      newClaimsAllowedUntil,
                      policy
                    )
                ).to.be.revertedWith('Increases claim period');
              });
            });
          });
          context('Downgrade increases coverage amount', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const beneficiary = roles.beneficiary.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy
                );
              const newCoverageAmountInUsd = coverageAmountInUsd.add(1);
              const newClaimsAllowedUntil = claimsAllowedUntil - 30 * 24 * 60 * 60;
              await expect(
                claimsManager
                  .connect(roles.admin)
                  .downgradePolicy(
                    claimant,
                    beneficiary,
                    newCoverageAmountInUsd,
                    claimsAllowedFrom,
                    newClaimsAllowedUntil,
                    policy
                  )
              ).to.be.revertedWith('Increases coverage amount');
            });
          });
        });
        context('Policy does not exist', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const beneficiary = roles.beneficiary.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await expect(
              claimsManager
                .connect(roles.admin)
                .downgradePolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy
                )
            ).to.be.revertedWith('Policy does not exist');
          });
        });
      });
      context('Claim period does not end later than it starts', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const beneficiary = roles.beneficiary.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom;
          const policy = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.admin)
              .downgradePolicy(
                claimant,
                beneficiary,
                coverageAmountInUsd,
                claimsAllowedFrom,
                claimsAllowedUntil,
                policy
              )
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
                const beneficiary = roles.beneficiary.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                // claimsAllowedFrom can be from the past
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'address', 'uint32', 'string'],
                  [claimant, beneficiary, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy
                  );
                const newCoverageAmountInUsd = coverageAmountInUsd.sub(hre.ethers.utils.parseEther('10000'));
                const newClaimsAllowedUntil = claimsAllowedUntil - 30 * 24 * 60 * 60;
                await expect(
                  claimsManager
                    .connect(roles.claimant)
                    .downgradePolicy(
                      claimant,
                      beneficiary,
                      newCoverageAmountInUsd,
                      claimsAllowedFrom,
                      newClaimsAllowedUntil,
                      policy
                    )
                )
                  .to.emit(claimsManager, 'DowngradedPolicy')
                  .withArgs(
                    beneficiary,
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
                const beneficiary = roles.beneficiary.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy
                  );
                const newCoverageAmountInUsd = coverageAmountInUsd.sub(hre.ethers.utils.parseEther('10000'));
                const newClaimsAllowedUntil = claimsAllowedUntil + 1;
                await expect(
                  claimsManager
                    .connect(roles.claimant)
                    .downgradePolicy(
                      claimant,
                      beneficiary,
                      newCoverageAmountInUsd,
                      claimsAllowedFrom,
                      newClaimsAllowedUntil,
                      policy
                    )
                ).to.be.revertedWith('Increases claim period');
              });
            });
          });
          context('Downgrade increases coverage amount', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const beneficiary = roles.beneficiary.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy
                );
              const newCoverageAmountInUsd = coverageAmountInUsd.add(1);
              const newClaimsAllowedUntil = claimsAllowedUntil - 30 * 24 * 60 * 60;
              await expect(
                claimsManager
                  .connect(roles.claimant)
                  .downgradePolicy(
                    claimant,
                    beneficiary,
                    newCoverageAmountInUsd,
                    claimsAllowedFrom,
                    newClaimsAllowedUntil,
                    policy
                  )
              ).to.be.revertedWith('Increases coverage amount');
            });
          });
        });
        context('Policy does not exist', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const beneficiary = roles.beneficiary.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await expect(
              claimsManager
                .connect(roles.claimant)
                .downgradePolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy
                )
            ).to.be.revertedWith('Policy does not exist');
          });
        });
      });
      context('Claim period does not end later than it starts', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const beneficiary = roles.beneficiary.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom;
          const policy = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.claimant)
              .downgradePolicy(
                claimant,
                beneficiary,
                coverageAmountInUsd,
                claimsAllowedFrom,
                claimsAllowedUntil,
                policy
              )
          ).to.be.revertedWith('Start not earlier than end');
        });
      });
    });
    context('Sender is not manager, admin or claimant', function () {
      it('reverts', async function () {
        const claimant = roles.claimant.address;
        const beneficiary = roles.beneficiary.address;
        const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
        const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
        const claimsAllowedUntil = claimsAllowedFrom;
        const policy = '/ipfs/Qm...testaddress';
        await expect(
          claimsManager
            .connect(roles.randomPerson)
            .downgradePolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy)
        ).to.be.revertedWith('Sender cannot downgrade policies');
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
                    const beneficiary = roles.beneficiary.address;
                    const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                    // claimsAllowedFrom can be from the past
                    const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                    const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                    const policy = '/ipfs/Qm...testaddress';
                    const policyHash = hre.ethers.utils.solidityKeccak256(
                      ['address', 'address', 'uint32', 'string'],
                      [claimant, beneficiary, claimsAllowedFrom, policy]
                    );
                    await claimsManager
                      .connect(roles.policyAgent)
                      .createPolicy(
                        claimant,
                        beneficiary,
                        coverageAmountInUsd,
                        claimsAllowedFrom,
                        claimsAllowedUntil,
                        policy
                      );
                    const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                    const evidence = '/ipfs/Qm...testaddress';
                    const claimHash = hre.ethers.utils.solidityKeccak256(
                      ['bytes32', 'address', 'address', 'uint224', 'string'],
                      [policyHash, claimant, beneficiary, claimAmountInUsd, evidence]
                    );
                    const currentBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                    const claimCreationBlockTimestamp = currentBlockTimestamp + 1;
                    await hre.ethers.provider.send('evm_setNextBlockTimestamp', [claimCreationBlockTimestamp]);
                    await expect(
                      claimsManager
                        .connect(roles.claimant)
                        .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence)
                    )
                      .to.emit(claimsManager, 'CreatedClaim')
                      .withArgs(
                        claimHash,
                        claimant,
                        policyHash,
                        beneficiary,
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
                    const beneficiary = roles.beneficiary.address;
                    const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                    const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                    const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                    const policy = '/ipfs/Qm...testaddress';
                    await claimsManager
                      .connect(roles.policyAgent)
                      .createPolicy(
                        claimant,
                        beneficiary,
                        coverageAmountInUsd,
                        claimsAllowedFrom,
                        claimsAllowedUntil,
                        policy
                      );
                    const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                    const evidence = '/ipfs/Qm...testaddress';
                    await claimsManager
                      .connect(roles.claimant)
                      .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                    await expect(
                      claimsManager
                        .connect(roles.claimant)
                        .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence)
                    ).to.be.revertedWith('Claim already exists');
                  });
                });
              });
              context('Claim period has ended', function () {
                it('reverts', async function () {
                  const claimant = roles.claimant.address;
                  const beneficiary = roles.beneficiary.address;
                  const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                  const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                  const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                  const policy = '/ipfs/Qm...testaddress';
                  await claimsManager
                    .connect(roles.policyAgent)
                    .createPolicy(
                      claimant,
                      beneficiary,
                      coverageAmountInUsd,
                      claimsAllowedFrom,
                      claimsAllowedUntil,
                      policy
                    );
                  const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                  const evidence = '/ipfs/Qm...testaddress';
                  const claimCreationBlockTimestamp = claimsAllowedUntil + 1;
                  await hre.ethers.provider.send('evm_setNextBlockTimestamp', [claimCreationBlockTimestamp]);
                  await expect(
                    claimsManager
                      .connect(roles.claimant)
                      .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence)
                  ).to.be.revertedWith('Claims not allowed anymore');
                });
              });
            });
            context('Claim amount is larger than coverage', function () {
              it('reverts', async function () {
                const claimant = roles.claimant.address;
                const beneficiary = roles.beneficiary.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy
                  );
                const claimAmountInUsd = coverageAmountInUsd.add(1);
                const evidence = '/ipfs/Qm...testaddress';
                await expect(
                  claimsManager
                    .connect(roles.claimant)
                    .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence)
                ).to.be.revertedWith('Claim larger than coverage');
              });
            });
          });
          context('Policy does not exist', function () {
            it('reverts', async function () {
              const beneficiary = roles.beneficiary.address;
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const policy = '/ipfs/Qm...testaddress';
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              const evidence = '/ipfs/Qm...testaddress';
              await expect(
                claimsManager
                  .connect(roles.claimant)
                  .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence)
              ).to.be.revertedWith('Claim larger than coverage');
            });
          });
        });
        context('Evidence address is empty', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const beneficiary = roles.beneficiary.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            await claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
            const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
            const evidence = '';
            await expect(
              claimsManager
                .connect(roles.claimant)
                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence)
            ).to.be.revertedWith('Evidence address empty');
          });
        });
      });
      context('Claim period has not started', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const beneficiary = roles.beneficiary.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp + 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          await claimsManager
            .connect(roles.policyAgent)
            .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
          const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
          const evidence = '/ipfs/Qm...testaddress';
          await expect(
            claimsManager
              .connect(roles.claimant)
              .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence)
          ).to.be.revertedWith('Claims not allowed yet');
        });
      });
    });
    context('Claim amount is zero', function () {
      it('reverts', async function () {
        const claimant = roles.claimant.address;
        const beneficiary = roles.beneficiary.address;
        const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
        const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
        const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
        const policy = '/ipfs/Qm...testaddress';
        await claimsManager
          .connect(roles.policyAgent)
          .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
        const claimAmountInUsd = 0;
        const evidence = '/ipfs/Qm...testaddress';
        await expect(
          claimsManager
            .connect(roles.claimant)
            .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence)
        ).to.be.revertedWith('Claim amount zero');
      });
    });
  });

  describe('acceptClaim', function () {
    context('Sender is manager', function () {
      context('Claim exists', function () {
        context('Claim is acceptable', function () {
          context('It is not too late to accept the claim', function () {
            context('Api3ToUsdReader is set', function () {
              context('ClaimsManager is whitelisted to read the dAPI', function () {
                context('dAPI name is set', function () {
                  context('Data feed value is not small enough to cause overflow', function () {
                    context('dAPI name is set to a data feed that has a non-negative value', function () {
                      context('Accepting does not cause the sender quota to be exceeded', function () {
                        context('Coverage covers the entire claim', function () {
                          context('Pool has enough funds', function () {
                            it('accepts and pays out the claim fully, updates coverage and quota', async function () {
                              const quotaPeriod = 7 * 24 * 60 * 60;
                              const quotaAmount = hre.ethers.utils.parseEther('1000000');
                              await claimsManager
                                .connect(roles.admin)
                                .setQuota(roles.manager.address, quotaPeriod, quotaAmount);
                              const claimant = roles.claimant.address;
                              const beneficiary = roles.beneficiary.address;
                              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                              const policy = '/ipfs/Qm...testaddress';
                              const policyHash = hre.ethers.utils.solidityKeccak256(
                                ['address', 'address', 'uint32', 'string'],
                                [claimant, beneficiary, claimsAllowedFrom, policy]
                              );
                              await claimsManager
                                .connect(roles.policyAgent)
                                .createPolicy(
                                  claimant,
                                  beneficiary,
                                  coverageAmountInUsd,
                                  claimsAllowedFrom,
                                  claimsAllowedUntil,
                                  policy
                                );
                              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                              const evidence = '/ipfs/Qm...testaddress';
                              await claimsManager
                                .connect(roles.claimant)
                                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                              const claimHash = hre.ethers.utils.solidityKeccak256(
                                ['bytes32', 'address', 'address', 'uint224', 'string'],
                                [policyHash, claimant, beneficiary, claimAmountInUsd, evidence]
                              );
                              const payoutAmountInUsd = claimAmountInUsd;
                              const payoutAmountInApi3 = claimAmountInUsd
                                .mul(hre.ethers.utils.parseEther('1'))
                                .div(api3UsdPriceWith18Decimals);
                              await expect(
                                claimsManager
                                  .connect(roles.manager)
                                  .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                              )
                                .to.emit(claimsManager, 'AcceptedClaim')
                                .withArgs(
                                  claimHash,
                                  claimant,
                                  beneficiary,
                                  payoutAmountInUsd,
                                  payoutAmountInApi3,
                                  roles.manager.address
                                );
                              expect(await api3Token.balanceOf(beneficiary)).to.equal(payoutAmountInApi3);
                              const policyState = await claimsManager.policyHashToState(policyHash);
                              expect(policyState.coverageAmountInUsd).to.equal(
                                coverageAmountInUsd.sub(payoutAmountInUsd)
                              );
                              expect(await claimsManager.getQuotaUsage(roles.manager.address)).to.equal(
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
                                : totalStake
                                    .mul(api3UsdPriceWith18Decimals)
                                    .div(hre.ethers.utils.parseEther('1'))
                                    .add(1);
                              const claimant = roles.claimant.address;
                              const beneficiary = roles.beneficiary.address;
                              const coverageAmountInUsd = usdAmountThatExceedsTotalStake;
                              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                              const policy = '/ipfs/Qm...testaddress';
                              const policyHash = hre.ethers.utils.solidityKeccak256(
                                ['address', 'address', 'uint32', 'string'],
                                [claimant, beneficiary, claimsAllowedFrom, policy]
                              );
                              await claimsManager
                                .connect(roles.policyAgent)
                                .createPolicy(
                                  claimant,
                                  beneficiary,
                                  coverageAmountInUsd,
                                  claimsAllowedFrom,
                                  claimsAllowedUntil,
                                  policy
                                );
                              const claimAmountInUsd = usdAmountThatExceedsTotalStake;
                              const evidence = '/ipfs/Qm...testaddress';
                              await claimsManager
                                .connect(roles.claimant)
                                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                              await expect(
                                claimsManager
                                  .connect(roles.manager)
                                  .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                              ).to.be.revertedWith('Pool: Amount exceeds total stake');
                            });
                          });
                        });
                        context('Coverage does not cover the entire claim', function () {
                          context('Pool has enough funds', function () {
                            it('accepts and pays out the remaining coverage, updates coverage and quota', async function () {
                              const quotaPeriod = 7 * 24 * 60 * 60;
                              const quotaAmount = hre.ethers.utils.parseEther('1000000');
                              await claimsManager
                                .connect(roles.admin)
                                .setQuota(roles.manager.address, quotaPeriod, quotaAmount);
                              const claimant = roles.claimant.address;
                              const beneficiary = roles.beneficiary.address;
                              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                              const policy = '/ipfs/Qm...testaddress';
                              const policyHash = hre.ethers.utils.solidityKeccak256(
                                ['address', 'address', 'uint32', 'string'],
                                [claimant, beneficiary, claimsAllowedFrom, policy]
                              );
                              await claimsManager
                                .connect(roles.policyAgent)
                                .createPolicy(
                                  claimant,
                                  beneficiary,
                                  coverageAmountInUsd,
                                  claimsAllowedFrom,
                                  claimsAllowedUntil,
                                  policy
                                );
                              const evidence = '/ipfs/Qm...testaddress';
                              const claimAmountInUsd1 = hre.ethers.utils.parseEther('40000');
                              await claimsManager
                                .connect(roles.claimant)
                                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                              const claimAmountInUsd2 = hre.ethers.utils.parseEther('25000');
                              await claimsManager
                                .connect(roles.claimant)
                                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                              const claimHash2 = hre.ethers.utils.solidityKeccak256(
                                ['bytes32', 'address', 'address', 'uint224', 'string'],
                                [policyHash, claimant, beneficiary, claimAmountInUsd2, evidence]
                              );
                              await claimsManager
                                .connect(roles.mediator)
                                .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd1, evidence);
                              const payoutAmountInUsd = coverageAmountInUsd.sub(claimAmountInUsd1).lt(claimAmountInUsd2)
                                ? coverageAmountInUsd.sub(claimAmountInUsd1)
                                : claimAmountInUsd2;
                              const payoutAmountInApi3 = payoutAmountInUsd
                                .mul(hre.ethers.utils.parseEther('1'))
                                .div(api3UsdPriceWith18Decimals);
                              const beneficiaryBalance = await api3Token.balanceOf(beneficiary);
                              const coverageAmount = (await claimsManager.policyHashToState(policyHash))
                                .coverageAmountInUsd;
                              const quotaUsage = await claimsManager.getQuotaUsage(roles.manager.address);
                              await expect(
                                claimsManager
                                  .connect(roles.manager)
                                  .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd2, evidence)
                              )
                                .to.emit(claimsManager, 'AcceptedClaim')
                                .withArgs(
                                  claimHash2,
                                  claimant,
                                  beneficiary,
                                  payoutAmountInUsd,
                                  payoutAmountInApi3,
                                  roles.manager.address
                                );
                              expect((await api3Token.balanceOf(beneficiary)).sub(beneficiaryBalance)).to.equal(
                                payoutAmountInApi3
                              );
                              expect(
                                coverageAmount.sub(
                                  (await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd
                                )
                              ).to.equal(payoutAmountInUsd);
                              expect(
                                (await claimsManager.getQuotaUsage(roles.manager.address)).sub(quotaUsage)
                              ).to.equal(payoutAmountInApi3);
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
                                : totalStake
                                    .mul(api3UsdPriceWith18Decimals)
                                    .div(hre.ethers.utils.parseEther('1'))
                                    .add(1);
                              const claimant = roles.claimant.address;
                              const beneficiary = roles.beneficiary.address;
                              const coverageAmountInUsd = usdAmountThatExceedsTotalStake.mul(2);
                              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                              const policy = '/ipfs/Qm...testaddress';
                              const policyHash = hre.ethers.utils.solidityKeccak256(
                                ['address', 'address', 'uint32', 'string'],
                                [claimant, beneficiary, claimsAllowedFrom, policy]
                              );
                              await claimsManager
                                .connect(roles.policyAgent)
                                .createPolicy(
                                  claimant,
                                  beneficiary,
                                  coverageAmountInUsd,
                                  claimsAllowedFrom,
                                  claimsAllowedUntil,
                                  policy
                                );
                              const evidence = '/ipfs/Qm...testaddress';
                              const claimAmountInUsd1 = 1;
                              await claimsManager
                                .connect(roles.claimant)
                                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                              const claimAmountInUsd2 = coverageAmountInUsd;
                              await claimsManager
                                .connect(roles.claimant)
                                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                              await claimsManager
                                .connect(roles.mediator)
                                .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd1, evidence);
                              await expect(
                                claimsManager
                                  .connect(roles.manager)
                                  .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd2, evidence)
                              ).to.be.revertedWith('Pool: Amount exceeds total stake');
                            });
                          });
                        });
                      });
                      context('Accepting causes the sender quota to be exceeded', function () {
                        it('reverts', async function () {
                          const quotaPeriod = 7 * 24 * 60 * 60;
                          const quotaAmount = hre.ethers.utils.parseEther('10000');
                          await claimsManager
                            .connect(roles.admin)
                            .setQuota(roles.manager.address, quotaPeriod, quotaAmount);
                          const claimant = roles.claimant.address;
                          const beneficiary = roles.beneficiary.address;
                          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                          const policy = '/ipfs/Qm...testaddress';
                          const policyHash = hre.ethers.utils.solidityKeccak256(
                            ['address', 'address', 'uint32', 'string'],
                            [claimant, beneficiary, claimsAllowedFrom, policy]
                          );
                          await claimsManager
                            .connect(roles.policyAgent)
                            .createPolicy(
                              claimant,
                              beneficiary,
                              coverageAmountInUsd,
                              claimsAllowedFrom,
                              claimsAllowedUntil,
                              policy
                            );
                          const evidence = '/ipfs/Qm...testaddress';
                          const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                          await claimsManager
                            .connect(roles.claimant)
                            .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                          await expect(
                            claimsManager
                              .connect(roles.manager)
                              .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                          ).to.be.revertedWith('Quota exceeded');
                        });
                      });
                    });
                    context('dAPI name is set to a data feed that has a negative value', function () {
                      it('reverts', async function () {
                        const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
                        dapiServer = await dapiServerFactory.deploy();
                        const dataFeedId = hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(32));
                        const dataFeedValue = -1;
                        const dataFeedTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                        await dapiServer.mockDataFeed(dataFeedId, dataFeedValue, dataFeedTimestamp);
                        const dapiName = hre.ethers.utils.formatBytes32String('API3/USD');
                        await dapiServer.mockDapiName(dapiName, dataFeedId);
                        const api3ToUsdReaderFactory = await hre.ethers.getContractFactory(
                          'Api3ToUsdReader',
                          roles.deployer
                        );
                        api3ToUsdReader = await api3ToUsdReaderFactory.deploy(
                          dapiServer.address,
                          claimsManager.address
                        );
                        await claimsManager.connect(roles.manager).setApi3ToUsdReader(api3ToUsdReader.address);
                        const claimant = roles.claimant.address;
                        const beneficiary = roles.beneficiary.address;
                        const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                        const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                        const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                        const policy = '/ipfs/Qm...testaddress';
                        const policyHash = hre.ethers.utils.solidityKeccak256(
                          ['address', 'address', 'uint32', 'string'],
                          [claimant, beneficiary, claimsAllowedFrom, policy]
                        );
                        await claimsManager
                          .connect(roles.policyAgent)
                          .createPolicy(
                            claimant,
                            beneficiary,
                            coverageAmountInUsd,
                            claimsAllowedFrom,
                            claimsAllowedUntil,
                            policy
                          );
                        const evidence = '/ipfs/Qm...testaddress';
                        const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                        await claimsManager
                          .connect(roles.claimant)
                          .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                        await expect(
                          claimsManager
                            .connect(roles.manager)
                            .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                        ).to.be.revertedWith('API3 price not positive');
                      });
                    });
                  });
                  context('Data feed value is small enough to cause overflow', function () {
                    it('reverts', async function () {
                      const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
                      dapiServer = await dapiServerFactory.deploy();
                      const dataFeedId = hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(32));
                      const dataFeedValue = 1;
                      const dataFeedTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                      await dapiServer.mockDataFeed(dataFeedId, dataFeedValue, dataFeedTimestamp);
                      const dapiName = hre.ethers.utils.formatBytes32String('API3/USD');
                      await dapiServer.mockDapiName(dapiName, dataFeedId);
                      const api3ToUsdReaderFactory = await hre.ethers.getContractFactory(
                        'Api3ToUsdReader',
                        roles.deployer
                      );
                      api3ToUsdReader = await api3ToUsdReaderFactory.deploy(dapiServer.address, claimsManager.address);
                      await claimsManager.connect(roles.manager).setApi3ToUsdReader(api3ToUsdReader.address);
                      const claimant = roles.claimant.address;
                      const beneficiary = roles.beneficiary.address;
                      const coverageAmountInUsd = hre.ethers.BigNumber.from(
                        '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
                      ); // max uint224
                      hre.ethers.constants.MaxUint256;
                      const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                      const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                      const policy = '/ipfs/Qm...testaddress';
                      const policyHash = hre.ethers.utils.solidityKeccak256(
                        ['address', 'address', 'uint32', 'string'],
                        [claimant, beneficiary, claimsAllowedFrom, policy]
                      );
                      await claimsManager
                        .connect(roles.policyAgent)
                        .createPolicy(
                          claimant,
                          beneficiary,
                          coverageAmountInUsd,
                          claimsAllowedFrom,
                          claimsAllowedUntil,
                          policy
                        );
                      const evidence = '/ipfs/Qm...testaddress';
                      const claimAmountInUsd = hre.ethers.BigNumber.from(
                        '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
                      ); // max uint224
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                      await expect(
                        claimsManager
                          .connect(roles.manager)
                          .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                      ).to.be.reverted;
                    });
                  });
                  context('Data feed value is not initialized', function () {
                    it('reverts', async function () {
                      const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
                      dapiServer = await dapiServerFactory.deploy();
                      const dataFeedId = hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(32));
                      const dapiName = hre.ethers.utils.formatBytes32String('API3/USD');
                      await dapiServer.mockDapiName(dapiName, dataFeedId);
                      const api3ToUsdReaderFactory = await hre.ethers.getContractFactory(
                        'Api3ToUsdReader',
                        roles.deployer
                      );
                      api3ToUsdReader = await api3ToUsdReaderFactory.deploy(dapiServer.address, claimsManager.address);
                      await claimsManager.connect(roles.manager).setApi3ToUsdReader(api3ToUsdReader.address);
                      const claimant = roles.claimant.address;
                      const beneficiary = roles.beneficiary.address;
                      const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                      const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                      const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                      const policy = '/ipfs/Qm...testaddress';
                      const policyHash = hre.ethers.utils.solidityKeccak256(
                        ['address', 'address', 'uint32', 'string'],
                        [claimant, beneficiary, claimsAllowedFrom, policy]
                      );
                      await claimsManager
                        .connect(roles.policyAgent)
                        .createPolicy(
                          claimant,
                          beneficiary,
                          coverageAmountInUsd,
                          claimsAllowedFrom,
                          claimsAllowedUntil,
                          policy
                        );
                      const evidence = '/ipfs/Qm...testaddress';
                      const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                      await expect(
                        claimsManager
                          .connect(roles.manager)
                          .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                      ).to.be.revertedWith('Data feed does not exist');
                    });
                  });
                });
                context('dAPI name is not set', function () {
                  it('reverts', async function () {
                    const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
                    dapiServer = await dapiServerFactory.deploy();
                    const api3ToUsdReaderFactory = await hre.ethers.getContractFactory(
                      'Api3ToUsdReader',
                      roles.deployer
                    );
                    api3ToUsdReader = await api3ToUsdReaderFactory.deploy(dapiServer.address, claimsManager.address);
                    await claimsManager.connect(roles.manager).setApi3ToUsdReader(api3ToUsdReader.address);
                    const claimant = roles.claimant.address;
                    const beneficiary = roles.beneficiary.address;
                    const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                    const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                    const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                    const policy = '/ipfs/Qm...testaddress';
                    const policyHash = hre.ethers.utils.solidityKeccak256(
                      ['address', 'address', 'uint32', 'string'],
                      [claimant, beneficiary, claimsAllowedFrom, policy]
                    );
                    await claimsManager
                      .connect(roles.policyAgent)
                      .createPolicy(
                        claimant,
                        beneficiary,
                        coverageAmountInUsd,
                        claimsAllowedFrom,
                        claimsAllowedUntil,
                        policy
                      );
                    const evidence = '/ipfs/Qm...testaddress';
                    const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                    await claimsManager
                      .connect(roles.claimant)
                      .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                    await expect(
                      claimsManager
                        .connect(roles.manager)
                        .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                    ).to.be.revertedWith('Data feed does not exist');
                  });
                });
              });
              context('ClaimsManager is not whitelisted to read the dAPI', function () {
                it('reverts', async function () {
                  await dapiServer.mockIfAllowedToRead(false);
                  const claimant = roles.claimant.address;
                  const beneficiary = roles.beneficiary.address;
                  const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                  const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                  const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                  const policy = '/ipfs/Qm...testaddress';
                  const policyHash = hre.ethers.utils.solidityKeccak256(
                    ['address', 'address', 'uint32', 'string'],
                    [claimant, beneficiary, claimsAllowedFrom, policy]
                  );
                  await claimsManager
                    .connect(roles.policyAgent)
                    .createPolicy(
                      claimant,
                      beneficiary,
                      coverageAmountInUsd,
                      claimsAllowedFrom,
                      claimsAllowedUntil,
                      policy
                    );
                  const evidence = '/ipfs/Qm...testaddress';
                  const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                  await claimsManager
                    .connect(roles.claimant)
                    .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                  await expect(
                    claimsManager
                      .connect(roles.manager)
                      .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                  ).to.be.revertedWith('Sender cannot read');
                });
              });
            });
            context('Api3ToUsdReader is not set', function () {
              it('reverts', async function () {
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
                  .grantRole(await claimsManager.policyAgentRole(), roles.policyAgent.address);
                await accessControlRegistry;
                const claimant = roles.claimant.address;
                const beneficiary = roles.beneficiary.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'address', 'uint32', 'string'],
                  [claimant, beneficiary, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy
                  );
                const evidence = '/ipfs/Qm...testaddress';
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                await expect(
                  claimsManager
                    .connect(roles.manager)
                    .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                ).to.be.revertedWith('Api3ToUsdReader not set');
              });
            });
          });
          context('It is too late to accept the claim', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const beneficiary = roles.beneficiary.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'address', 'uint32', 'string'],
                [claimant, beneficiary, claimsAllowedFrom, policy]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy
                );
              const evidence = '/ipfs/Qm...testaddress';
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              const currentBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const claimCreationBlockTimestamp = currentBlockTimestamp + 1;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [claimCreationBlockTimestamp]);
              await claimsManager
                .connect(roles.claimant)
                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                claimCreationBlockTimestamp + mediatorResponsePeriod,
              ]);
              await expect(
                claimsManager
                  .connect(roles.manager)
                  .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
              ).to.be.revertedWith('Too late to accept claim');
            });
          });
        });
        context('Claim is not acceptable', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const beneficiary = roles.beneficiary.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            const policyHash = hre.ethers.utils.solidityKeccak256(
              ['address', 'address', 'uint32', 'string'],
              [claimant, beneficiary, claimsAllowedFrom, policy]
            );
            await claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
            const evidence = '/ipfs/Qm...testaddress';
            const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
            await claimsManager
              .connect(roles.claimant)
              .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
            await claimsManager
              .connect(roles.mediator)
              .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence);
            await expect(
              claimsManager
                .connect(roles.manager)
                .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
            ).to.be.revertedWith('Claim not acceptable');
          });
        });
      });
      context('Claim does not exist', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const beneficiary = roles.beneficiary.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          const policyHash = hre.ethers.utils.solidityKeccak256(
            ['address', 'address', 'uint32', 'string'],
            [claimant, beneficiary, claimsAllowedFrom, policy]
          );
          await claimsManager
            .connect(roles.policyAgent)
            .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
          const evidence = '/ipfs/Qm...testaddress';
          const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
          await expect(
            claimsManager
              .connect(roles.manager)
              .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
          ).to.be.revertedWith('Claim not acceptable');
        });
      });
    });
    context('Sender is admin', function () {
      context('Claim exists', function () {
        context('Claim is acceptable', function () {
          context('It is not too late to accept the claim', function () {
            context('Api3ToUsdReader is set', function () {
              context('ClaimsManager is whitelisted to read the dAPI', function () {
                context('dAPI name is set', function () {
                  context('Data feed value is not small enough to cause overflow', function () {
                    context('dAPI name is set to a data feed that has a non-negative value', function () {
                      context('Accepting does not cause the sender quota to be exceeded', function () {
                        context('Coverage covers the entire claim', function () {
                          context('Pool has enough funds', function () {
                            it('accepts and pays out the claim fully, updates coverage and quota', async function () {
                              const quotaPeriod = 7 * 24 * 60 * 60;
                              const quotaAmount = hre.ethers.utils.parseEther('1000000');
                              await claimsManager
                                .connect(roles.admin)
                                .setQuota(roles.admin.address, quotaPeriod, quotaAmount);
                              const claimant = roles.claimant.address;
                              const beneficiary = roles.beneficiary.address;
                              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                              const policy = '/ipfs/Qm...testaddress';
                              const policyHash = hre.ethers.utils.solidityKeccak256(
                                ['address', 'address', 'uint32', 'string'],
                                [claimant, beneficiary, claimsAllowedFrom, policy]
                              );
                              await claimsManager
                                .connect(roles.policyAgent)
                                .createPolicy(
                                  claimant,
                                  beneficiary,
                                  coverageAmountInUsd,
                                  claimsAllowedFrom,
                                  claimsAllowedUntil,
                                  policy
                                );
                              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                              const evidence = '/ipfs/Qm...testaddress';
                              await claimsManager
                                .connect(roles.claimant)
                                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                              const claimHash = hre.ethers.utils.solidityKeccak256(
                                ['bytes32', 'address', 'address', 'uint224', 'string'],
                                [policyHash, claimant, beneficiary, claimAmountInUsd, evidence]
                              );
                              const payoutAmountInUsd = claimAmountInUsd;
                              const payoutAmountInApi3 = claimAmountInUsd
                                .mul(hre.ethers.utils.parseEther('1'))
                                .div(api3UsdPriceWith18Decimals);
                              await expect(
                                claimsManager
                                  .connect(roles.admin)
                                  .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                              )
                                .to.emit(claimsManager, 'AcceptedClaim')
                                .withArgs(
                                  claimHash,
                                  claimant,
                                  beneficiary,
                                  payoutAmountInUsd,
                                  payoutAmountInApi3,
                                  roles.admin.address
                                );
                              expect(await api3Token.balanceOf(beneficiary)).to.equal(payoutAmountInApi3);
                              const policyState = await claimsManager.policyHashToState(policyHash);
                              expect(policyState.coverageAmountInUsd).to.equal(
                                coverageAmountInUsd.sub(payoutAmountInUsd)
                              );
                              expect(await claimsManager.getQuotaUsage(roles.admin.address)).to.equal(
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
                                : totalStake
                                    .mul(api3UsdPriceWith18Decimals)
                                    .div(hre.ethers.utils.parseEther('1'))
                                    .add(1);
                              const claimant = roles.claimant.address;
                              const beneficiary = roles.beneficiary.address;
                              const coverageAmountInUsd = usdAmountThatExceedsTotalStake;
                              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                              const policy = '/ipfs/Qm...testaddress';
                              const policyHash = hre.ethers.utils.solidityKeccak256(
                                ['address', 'address', 'uint32', 'string'],
                                [claimant, beneficiary, claimsAllowedFrom, policy]
                              );
                              await claimsManager
                                .connect(roles.policyAgent)
                                .createPolicy(
                                  claimant,
                                  beneficiary,
                                  coverageAmountInUsd,
                                  claimsAllowedFrom,
                                  claimsAllowedUntil,
                                  policy
                                );
                              const claimAmountInUsd = usdAmountThatExceedsTotalStake;
                              const evidence = '/ipfs/Qm...testaddress';
                              await claimsManager
                                .connect(roles.claimant)
                                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                              await expect(
                                claimsManager
                                  .connect(roles.admin)
                                  .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                              ).to.be.revertedWith('Pool: Amount exceeds total stake');
                            });
                          });
                        });
                        context('Coverage does not cover the entire claim', function () {
                          context('Pool has enough funds', function () {
                            it('accepts and pays out the remaining coverage, updates coverage and quota', async function () {
                              const quotaPeriod = 7 * 24 * 60 * 60;
                              const quotaAmount = hre.ethers.utils.parseEther('1000000');
                              await claimsManager
                                .connect(roles.admin)
                                .setQuota(roles.admin.address, quotaPeriod, quotaAmount);
                              const claimant = roles.claimant.address;
                              const beneficiary = roles.beneficiary.address;
                              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                              const policy = '/ipfs/Qm...testaddress';
                              const policyHash = hre.ethers.utils.solidityKeccak256(
                                ['address', 'address', 'uint32', 'string'],
                                [claimant, beneficiary, claimsAllowedFrom, policy]
                              );
                              await claimsManager
                                .connect(roles.policyAgent)
                                .createPolicy(
                                  claimant,
                                  beneficiary,
                                  coverageAmountInUsd,
                                  claimsAllowedFrom,
                                  claimsAllowedUntil,
                                  policy
                                );
                              const evidence = '/ipfs/Qm...testaddress';
                              const claimAmountInUsd1 = hre.ethers.utils.parseEther('40000');
                              await claimsManager
                                .connect(roles.claimant)
                                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                              const claimAmountInUsd2 = hre.ethers.utils.parseEther('25000');
                              await claimsManager
                                .connect(roles.claimant)
                                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                              const claimHash2 = hre.ethers.utils.solidityKeccak256(
                                ['bytes32', 'address', 'address', 'uint224', 'string'],
                                [policyHash, claimant, beneficiary, claimAmountInUsd2, evidence]
                              );
                              await claimsManager
                                .connect(roles.mediator)
                                .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd1, evidence);
                              const payoutAmountInUsd = coverageAmountInUsd.sub(claimAmountInUsd1).lt(claimAmountInUsd2)
                                ? coverageAmountInUsd.sub(claimAmountInUsd1)
                                : claimAmountInUsd2;
                              const payoutAmountInApi3 = payoutAmountInUsd
                                .mul(hre.ethers.utils.parseEther('1'))
                                .div(api3UsdPriceWith18Decimals);
                              const beneficiaryBalance = await api3Token.balanceOf(beneficiary);
                              const coverageAmount = (await claimsManager.policyHashToState(policyHash))
                                .coverageAmountInUsd;
                              const quotaUsage = await claimsManager.getQuotaUsage(roles.admin.address);
                              await expect(
                                claimsManager
                                  .connect(roles.admin)
                                  .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd2, evidence)
                              )
                                .to.emit(claimsManager, 'AcceptedClaim')
                                .withArgs(
                                  claimHash2,
                                  claimant,
                                  beneficiary,
                                  payoutAmountInUsd,
                                  payoutAmountInApi3,
                                  roles.admin.address
                                );
                              expect((await api3Token.balanceOf(beneficiary)).sub(beneficiaryBalance)).to.equal(
                                payoutAmountInApi3
                              );
                              expect(
                                coverageAmount.sub(
                                  (await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd
                                )
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
                                : totalStake
                                    .mul(api3UsdPriceWith18Decimals)
                                    .div(hre.ethers.utils.parseEther('1'))
                                    .add(1);
                              const claimant = roles.claimant.address;
                              const beneficiary = roles.beneficiary.address;
                              const coverageAmountInUsd = usdAmountThatExceedsTotalStake.mul(2);
                              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                              const policy = '/ipfs/Qm...testaddress';
                              const policyHash = hre.ethers.utils.solidityKeccak256(
                                ['address', 'address', 'uint32', 'string'],
                                [claimant, beneficiary, claimsAllowedFrom, policy]
                              );
                              await claimsManager
                                .connect(roles.policyAgent)
                                .createPolicy(
                                  claimant,
                                  beneficiary,
                                  coverageAmountInUsd,
                                  claimsAllowedFrom,
                                  claimsAllowedUntil,
                                  policy
                                );
                              const evidence = '/ipfs/Qm...testaddress';
                              const claimAmountInUsd1 = 1;
                              await claimsManager
                                .connect(roles.claimant)
                                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                              const claimAmountInUsd2 = coverageAmountInUsd;
                              await claimsManager
                                .connect(roles.claimant)
                                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                              await claimsManager
                                .connect(roles.mediator)
                                .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd1, evidence);
                              await expect(
                                claimsManager
                                  .connect(roles.admin)
                                  .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd2, evidence)
                              ).to.be.revertedWith('Pool: Amount exceeds total stake');
                            });
                          });
                        });
                      });
                      context('Accepting causes the sender quota to be exceeded', function () {
                        it('reverts', async function () {
                          const quotaPeriod = 7 * 24 * 60 * 60;
                          const quotaAmount = hre.ethers.utils.parseEther('10000');
                          await claimsManager
                            .connect(roles.admin)
                            .setQuota(roles.admin.address, quotaPeriod, quotaAmount);
                          const claimant = roles.claimant.address;
                          const beneficiary = roles.beneficiary.address;
                          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                          const policy = '/ipfs/Qm...testaddress';
                          const policyHash = hre.ethers.utils.solidityKeccak256(
                            ['address', 'address', 'uint32', 'string'],
                            [claimant, beneficiary, claimsAllowedFrom, policy]
                          );
                          await claimsManager
                            .connect(roles.policyAgent)
                            .createPolicy(
                              claimant,
                              beneficiary,
                              coverageAmountInUsd,
                              claimsAllowedFrom,
                              claimsAllowedUntil,
                              policy
                            );
                          const evidence = '/ipfs/Qm...testaddress';
                          const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                          await claimsManager
                            .connect(roles.claimant)
                            .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                          await expect(
                            claimsManager
                              .connect(roles.admin)
                              .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                          ).to.be.revertedWith('Quota exceeded');
                        });
                      });
                    });
                    context('dAPI name is set to a data feed that has a negative value', function () {
                      it('reverts', async function () {
                        const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
                        dapiServer = await dapiServerFactory.deploy();
                        const dataFeedId = hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(32));
                        const dataFeedValue = -1;
                        const dataFeedTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                        await dapiServer.mockDataFeed(dataFeedId, dataFeedValue, dataFeedTimestamp);
                        const dapiName = hre.ethers.utils.formatBytes32String('API3/USD');
                        await dapiServer.mockDapiName(dapiName, dataFeedId);
                        const api3ToUsdReaderFactory = await hre.ethers.getContractFactory(
                          'Api3ToUsdReader',
                          roles.deployer
                        );
                        api3ToUsdReader = await api3ToUsdReaderFactory.deploy(
                          dapiServer.address,
                          claimsManager.address
                        );
                        await claimsManager.connect(roles.admin).setApi3ToUsdReader(api3ToUsdReader.address);
                        const claimant = roles.claimant.address;
                        const beneficiary = roles.beneficiary.address;
                        const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                        const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                        const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                        const policy = '/ipfs/Qm...testaddress';
                        const policyHash = hre.ethers.utils.solidityKeccak256(
                          ['address', 'address', 'uint32', 'string'],
                          [claimant, beneficiary, claimsAllowedFrom, policy]
                        );
                        await claimsManager
                          .connect(roles.policyAgent)
                          .createPolicy(
                            claimant,
                            beneficiary,
                            coverageAmountInUsd,
                            claimsAllowedFrom,
                            claimsAllowedUntil,
                            policy
                          );
                        const evidence = '/ipfs/Qm...testaddress';
                        const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                        await claimsManager
                          .connect(roles.claimant)
                          .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                        await expect(
                          claimsManager
                            .connect(roles.admin)
                            .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                        ).to.be.revertedWith('API3 price not positive');
                      });
                    });
                  });
                  context('Data feed value is small enough to cause overflow', function () {
                    it('reverts', async function () {
                      const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
                      dapiServer = await dapiServerFactory.deploy();
                      const dataFeedId = hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(32));
                      const dataFeedValue = 1;
                      const dataFeedTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                      await dapiServer.mockDataFeed(dataFeedId, dataFeedValue, dataFeedTimestamp);
                      const dapiName = hre.ethers.utils.formatBytes32String('API3/USD');
                      await dapiServer.mockDapiName(dapiName, dataFeedId);
                      const api3ToUsdReaderFactory = await hre.ethers.getContractFactory(
                        'Api3ToUsdReader',
                        roles.deployer
                      );
                      api3ToUsdReader = await api3ToUsdReaderFactory.deploy(dapiServer.address, claimsManager.address);
                      await claimsManager.connect(roles.admin).setApi3ToUsdReader(api3ToUsdReader.address);
                      const claimant = roles.claimant.address;
                      const beneficiary = roles.beneficiary.address;
                      const coverageAmountInUsd = hre.ethers.BigNumber.from(
                        '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
                      ); // max uint224
                      hre.ethers.constants.MaxUint256;
                      const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                      const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                      const policy = '/ipfs/Qm...testaddress';
                      const policyHash = hre.ethers.utils.solidityKeccak256(
                        ['address', 'address', 'uint32', 'string'],
                        [claimant, beneficiary, claimsAllowedFrom, policy]
                      );
                      await claimsManager
                        .connect(roles.policyAgent)
                        .createPolicy(
                          claimant,
                          beneficiary,
                          coverageAmountInUsd,
                          claimsAllowedFrom,
                          claimsAllowedUntil,
                          policy
                        );
                      const evidence = '/ipfs/Qm...testaddress';
                      const claimAmountInUsd = hre.ethers.BigNumber.from(
                        '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
                      ); // max uint224
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                      await expect(
                        claimsManager
                          .connect(roles.admin)
                          .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                      ).to.be.reverted;
                    });
                  });
                  context('Data feed value is not initialized', function () {
                    it('reverts', async function () {
                      const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
                      dapiServer = await dapiServerFactory.deploy();
                      const dataFeedId = hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(32));
                      const dapiName = hre.ethers.utils.formatBytes32String('API3/USD');
                      await dapiServer.mockDapiName(dapiName, dataFeedId);
                      const api3ToUsdReaderFactory = await hre.ethers.getContractFactory(
                        'Api3ToUsdReader',
                        roles.deployer
                      );
                      api3ToUsdReader = await api3ToUsdReaderFactory.deploy(dapiServer.address, claimsManager.address);
                      await claimsManager.connect(roles.admin).setApi3ToUsdReader(api3ToUsdReader.address);
                      const claimant = roles.claimant.address;
                      const beneficiary = roles.beneficiary.address;
                      const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                      const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                      const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                      const policy = '/ipfs/Qm...testaddress';
                      const policyHash = hre.ethers.utils.solidityKeccak256(
                        ['address', 'address', 'uint32', 'string'],
                        [claimant, beneficiary, claimsAllowedFrom, policy]
                      );
                      await claimsManager
                        .connect(roles.policyAgent)
                        .createPolicy(
                          claimant,
                          beneficiary,
                          coverageAmountInUsd,
                          claimsAllowedFrom,
                          claimsAllowedUntil,
                          policy
                        );
                      const evidence = '/ipfs/Qm...testaddress';
                      const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                      await expect(
                        claimsManager
                          .connect(roles.admin)
                          .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                      ).to.be.revertedWith('Data feed does not exist');
                    });
                  });
                });
                context('dAPI name is not set', function () {
                  it('reverts', async function () {
                    const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
                    dapiServer = await dapiServerFactory.deploy();
                    const api3ToUsdReaderFactory = await hre.ethers.getContractFactory(
                      'Api3ToUsdReader',
                      roles.deployer
                    );
                    api3ToUsdReader = await api3ToUsdReaderFactory.deploy(dapiServer.address, claimsManager.address);
                    await claimsManager.connect(roles.admin).setApi3ToUsdReader(api3ToUsdReader.address);
                    const claimant = roles.claimant.address;
                    const beneficiary = roles.beneficiary.address;
                    const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                    const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                    const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                    const policy = '/ipfs/Qm...testaddress';
                    const policyHash = hre.ethers.utils.solidityKeccak256(
                      ['address', 'address', 'uint32', 'string'],
                      [claimant, beneficiary, claimsAllowedFrom, policy]
                    );
                    await claimsManager
                      .connect(roles.policyAgent)
                      .createPolicy(
                        claimant,
                        beneficiary,
                        coverageAmountInUsd,
                        claimsAllowedFrom,
                        claimsAllowedUntil,
                        policy
                      );
                    const evidence = '/ipfs/Qm...testaddress';
                    const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                    await claimsManager
                      .connect(roles.claimant)
                      .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                    await expect(
                      claimsManager
                        .connect(roles.admin)
                        .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                    ).to.be.revertedWith('Data feed does not exist');
                  });
                });
              });
              context('ClaimsManager is not whitelisted to read the dAPI', function () {
                it('reverts', async function () {
                  await dapiServer.mockIfAllowedToRead(false);
                  const claimant = roles.claimant.address;
                  const beneficiary = roles.beneficiary.address;
                  const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                  const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                  const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                  const policy = '/ipfs/Qm...testaddress';
                  const policyHash = hre.ethers.utils.solidityKeccak256(
                    ['address', 'address', 'uint32', 'string'],
                    [claimant, beneficiary, claimsAllowedFrom, policy]
                  );
                  await claimsManager
                    .connect(roles.policyAgent)
                    .createPolicy(
                      claimant,
                      beneficiary,
                      coverageAmountInUsd,
                      claimsAllowedFrom,
                      claimsAllowedUntil,
                      policy
                    );
                  const evidence = '/ipfs/Qm...testaddress';
                  const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                  await claimsManager
                    .connect(roles.claimant)
                    .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                  await expect(
                    claimsManager
                      .connect(roles.admin)
                      .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                  ).to.be.revertedWith('Sender cannot read');
                });
              });
            });
            context('Api3ToUsdReader is not set', function () {
              it('reverts', async function () {
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
                  .grantRole(await claimsManager.adminRole(), roles.admin.address);
                await accessControlRegistry
                  .connect(roles.manager)
                  .initializeRoleAndGrantToSender(await claimsManager.adminRole(), 'Policy agent');
                await accessControlRegistry
                  .connect(roles.manager)
                  .grantRole(await claimsManager.policyAgentRole(), roles.policyAgent.address);
                await accessControlRegistry;
                const claimant = roles.claimant.address;
                const beneficiary = roles.beneficiary.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'address', 'uint32', 'string'],
                  [claimant, beneficiary, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy
                  );
                const evidence = '/ipfs/Qm...testaddress';
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                await expect(
                  claimsManager
                    .connect(roles.admin)
                    .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                ).to.be.revertedWith('Api3ToUsdReader not set');
              });
            });
          });
          context('It is too late to accept the claim', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const beneficiary = roles.beneficiary.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'address', 'uint32', 'string'],
                [claimant, beneficiary, claimsAllowedFrom, policy]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy
                );
              const evidence = '/ipfs/Qm...testaddress';
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              const currentBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const claimCreationBlockTimestamp = currentBlockTimestamp + 1;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [claimCreationBlockTimestamp]);
              await claimsManager
                .connect(roles.claimant)
                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                claimCreationBlockTimestamp + mediatorResponsePeriod,
              ]);
              await expect(
                claimsManager
                  .connect(roles.admin)
                  .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
              ).to.be.revertedWith('Too late to accept claim');
            });
          });
        });
        context('Claim is not acceptable', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const beneficiary = roles.beneficiary.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            const policyHash = hre.ethers.utils.solidityKeccak256(
              ['address', 'address', 'uint32', 'string'],
              [claimant, beneficiary, claimsAllowedFrom, policy]
            );
            await claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
            const evidence = '/ipfs/Qm...testaddress';
            const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
            await claimsManager
              .connect(roles.claimant)
              .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
            await claimsManager
              .connect(roles.mediator)
              .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence);
            await expect(
              claimsManager
                .connect(roles.admin)
                .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
            ).to.be.revertedWith('Claim not acceptable');
          });
        });
      });
      context('Claim does not exist', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const beneficiary = roles.beneficiary.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          const policyHash = hre.ethers.utils.solidityKeccak256(
            ['address', 'address', 'uint32', 'string'],
            [claimant, beneficiary, claimsAllowedFrom, policy]
          );
          await claimsManager
            .connect(roles.policyAgent)
            .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
          const evidence = '/ipfs/Qm...testaddress';
          const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
          await expect(
            claimsManager
              .connect(roles.admin)
              .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
          ).to.be.revertedWith('Claim not acceptable');
        });
      });
    });
    context('Sender is mediator', function () {
      context('Claim exists', function () {
        context('Claim is acceptable', function () {
          context('It is not too late to accept the claim', function () {
            context('Api3ToUsdReader is set', function () {
              context('ClaimsManager is whitelisted to read the dAPI', function () {
                context('dAPI name is set', function () {
                  context('Data feed value is not small enough to cause overflow', function () {
                    context('dAPI name is set to a data feed that has a non-negative value', function () {
                      context('Accepting does not cause the sender quota to be exceeded', function () {
                        context('Coverage covers the entire claim', function () {
                          context('Pool has enough funds', function () {
                            it('accepts and pays out the claim fully, updates coverage and quota', async function () {
                              const quotaPeriod = 7 * 24 * 60 * 60;
                              const quotaAmount = hre.ethers.utils.parseEther('1000000');
                              await claimsManager
                                .connect(roles.admin)
                                .setQuota(roles.mediator.address, quotaPeriod, quotaAmount);
                              const claimant = roles.claimant.address;
                              const beneficiary = roles.beneficiary.address;
                              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                              const policy = '/ipfs/Qm...testaddress';
                              const policyHash = hre.ethers.utils.solidityKeccak256(
                                ['address', 'address', 'uint32', 'string'],
                                [claimant, beneficiary, claimsAllowedFrom, policy]
                              );
                              await claimsManager
                                .connect(roles.policyAgent)
                                .createPolicy(
                                  claimant,
                                  beneficiary,
                                  coverageAmountInUsd,
                                  claimsAllowedFrom,
                                  claimsAllowedUntil,
                                  policy
                                );
                              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                              const evidence = '/ipfs/Qm...testaddress';
                              await claimsManager
                                .connect(roles.claimant)
                                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                              const claimHash = hre.ethers.utils.solidityKeccak256(
                                ['bytes32', 'address', 'address', 'uint224', 'string'],
                                [policyHash, claimant, beneficiary, claimAmountInUsd, evidence]
                              );
                              const payoutAmountInUsd = claimAmountInUsd;
                              const payoutAmountInApi3 = claimAmountInUsd
                                .mul(hre.ethers.utils.parseEther('1'))
                                .div(api3UsdPriceWith18Decimals);
                              await expect(
                                claimsManager
                                  .connect(roles.mediator)
                                  .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                              )
                                .to.emit(claimsManager, 'AcceptedClaim')
                                .withArgs(
                                  claimHash,
                                  claimant,
                                  beneficiary,
                                  payoutAmountInUsd,
                                  payoutAmountInApi3,
                                  roles.mediator.address
                                );
                              expect(await api3Token.balanceOf(beneficiary)).to.equal(payoutAmountInApi3);
                              const policyState = await claimsManager.policyHashToState(policyHash);
                              expect(policyState.coverageAmountInUsd).to.equal(
                                coverageAmountInUsd.sub(payoutAmountInUsd)
                              );
                              expect(await claimsManager.getQuotaUsage(roles.mediator.address)).to.equal(
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
                                : totalStake
                                    .mul(api3UsdPriceWith18Decimals)
                                    .div(hre.ethers.utils.parseEther('1'))
                                    .add(1);
                              const claimant = roles.claimant.address;
                              const beneficiary = roles.beneficiary.address;
                              const coverageAmountInUsd = usdAmountThatExceedsTotalStake;
                              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                              const policy = '/ipfs/Qm...testaddress';
                              const policyHash = hre.ethers.utils.solidityKeccak256(
                                ['address', 'address', 'uint32', 'string'],
                                [claimant, beneficiary, claimsAllowedFrom, policy]
                              );
                              await claimsManager
                                .connect(roles.policyAgent)
                                .createPolicy(
                                  claimant,
                                  beneficiary,
                                  coverageAmountInUsd,
                                  claimsAllowedFrom,
                                  claimsAllowedUntil,
                                  policy
                                );
                              const claimAmountInUsd = usdAmountThatExceedsTotalStake;
                              const evidence = '/ipfs/Qm...testaddress';
                              await claimsManager
                                .connect(roles.claimant)
                                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                              await expect(
                                claimsManager
                                  .connect(roles.mediator)
                                  .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                              ).to.be.revertedWith('Pool: Amount exceeds total stake');
                            });
                          });
                        });
                        context('Coverage does not cover the entire claim', function () {
                          context('Pool has enough funds', function () {
                            it('accepts and pays out the remaining coverage, updates coverage and quota', async function () {
                              const quotaPeriod = 7 * 24 * 60 * 60;
                              const quotaAmount = hre.ethers.utils.parseEther('1000000');
                              await claimsManager
                                .connect(roles.admin)
                                .setQuota(roles.mediator.address, quotaPeriod, quotaAmount);
                              const claimant = roles.claimant.address;
                              const beneficiary = roles.beneficiary.address;
                              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                              const policy = '/ipfs/Qm...testaddress';
                              const policyHash = hre.ethers.utils.solidityKeccak256(
                                ['address', 'address', 'uint32', 'string'],
                                [claimant, beneficiary, claimsAllowedFrom, policy]
                              );
                              await claimsManager
                                .connect(roles.policyAgent)
                                .createPolicy(
                                  claimant,
                                  beneficiary,
                                  coverageAmountInUsd,
                                  claimsAllowedFrom,
                                  claimsAllowedUntil,
                                  policy
                                );
                              const evidence = '/ipfs/Qm...testaddress';
                              const claimAmountInUsd1 = hre.ethers.utils.parseEther('40000');
                              await claimsManager
                                .connect(roles.claimant)
                                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                              const claimAmountInUsd2 = hre.ethers.utils.parseEther('25000');
                              await claimsManager
                                .connect(roles.claimant)
                                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                              const claimHash2 = hre.ethers.utils.solidityKeccak256(
                                ['bytes32', 'address', 'address', 'uint224', 'string'],
                                [policyHash, claimant, beneficiary, claimAmountInUsd2, evidence]
                              );
                              await claimsManager
                                .connect(roles.mediator)
                                .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd1, evidence);
                              const payoutAmountInUsd = coverageAmountInUsd.sub(claimAmountInUsd1).lt(claimAmountInUsd2)
                                ? coverageAmountInUsd.sub(claimAmountInUsd1)
                                : claimAmountInUsd2;
                              const payoutAmountInApi3 = payoutAmountInUsd
                                .mul(hre.ethers.utils.parseEther('1'))
                                .div(api3UsdPriceWith18Decimals);
                              const beneficiaryBalance = await api3Token.balanceOf(beneficiary);
                              const coverageAmount = (await claimsManager.policyHashToState(policyHash))
                                .coverageAmountInUsd;
                              const quotaUsage = await claimsManager.getQuotaUsage(roles.mediator.address);
                              await expect(
                                claimsManager
                                  .connect(roles.mediator)
                                  .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd2, evidence)
                              )
                                .to.emit(claimsManager, 'AcceptedClaim')
                                .withArgs(
                                  claimHash2,
                                  claimant,
                                  beneficiary,
                                  payoutAmountInUsd,
                                  payoutAmountInApi3,
                                  roles.mediator.address
                                );
                              expect((await api3Token.balanceOf(beneficiary)).sub(beneficiaryBalance)).to.equal(
                                payoutAmountInApi3
                              );
                              expect(
                                coverageAmount.sub(
                                  (await claimsManager.policyHashToState(policyHash)).coverageAmountInUsd
                                )
                              ).to.equal(payoutAmountInUsd);
                              expect(
                                (await claimsManager.getQuotaUsage(roles.mediator.address)).sub(quotaUsage)
                              ).to.equal(payoutAmountInApi3);
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
                                : totalStake
                                    .mul(api3UsdPriceWith18Decimals)
                                    .div(hre.ethers.utils.parseEther('1'))
                                    .add(1);
                              const claimant = roles.claimant.address;
                              const beneficiary = roles.beneficiary.address;
                              const coverageAmountInUsd = usdAmountThatExceedsTotalStake.mul(2);
                              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                              const policy = '/ipfs/Qm...testaddress';
                              const policyHash = hre.ethers.utils.solidityKeccak256(
                                ['address', 'address', 'uint32', 'string'],
                                [claimant, beneficiary, claimsAllowedFrom, policy]
                              );
                              await claimsManager
                                .connect(roles.policyAgent)
                                .createPolicy(
                                  claimant,
                                  beneficiary,
                                  coverageAmountInUsd,
                                  claimsAllowedFrom,
                                  claimsAllowedUntil,
                                  policy
                                );
                              const evidence = '/ipfs/Qm...testaddress';
                              const claimAmountInUsd1 = 1;
                              await claimsManager
                                .connect(roles.claimant)
                                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd1, evidence);
                              const claimAmountInUsd2 = coverageAmountInUsd;
                              await claimsManager
                                .connect(roles.claimant)
                                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd2, evidence);
                              await claimsManager
                                .connect(roles.mediator)
                                .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd1, evidence);
                              await expect(
                                claimsManager
                                  .connect(roles.mediator)
                                  .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd2, evidence)
                              ).to.be.revertedWith('Pool: Amount exceeds total stake');
                            });
                          });
                        });
                      });
                      context('Accepting causes the sender quota to be exceeded', function () {
                        it('reverts', async function () {
                          const quotaPeriod = 7 * 24 * 60 * 60;
                          const quotaAmount = hre.ethers.utils.parseEther('10000');
                          await claimsManager
                            .connect(roles.admin)
                            .setQuota(roles.mediator.address, quotaPeriod, quotaAmount);
                          const claimant = roles.claimant.address;
                          const beneficiary = roles.beneficiary.address;
                          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                          const policy = '/ipfs/Qm...testaddress';
                          const policyHash = hre.ethers.utils.solidityKeccak256(
                            ['address', 'address', 'uint32', 'string'],
                            [claimant, beneficiary, claimsAllowedFrom, policy]
                          );
                          await claimsManager
                            .connect(roles.policyAgent)
                            .createPolicy(
                              claimant,
                              beneficiary,
                              coverageAmountInUsd,
                              claimsAllowedFrom,
                              claimsAllowedUntil,
                              policy
                            );
                          const evidence = '/ipfs/Qm...testaddress';
                          const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                          await claimsManager
                            .connect(roles.claimant)
                            .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                          await expect(
                            claimsManager
                              .connect(roles.mediator)
                              .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                          ).to.be.revertedWith('Quota exceeded');
                        });
                      });
                    });
                    context('dAPI name is set to a data feed that has a negative value', function () {
                      it('reverts', async function () {
                        const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
                        dapiServer = await dapiServerFactory.deploy();
                        const dataFeedId = hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(32));
                        const dataFeedValue = -1;
                        const dataFeedTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                        await dapiServer.mockDataFeed(dataFeedId, dataFeedValue, dataFeedTimestamp);
                        const dapiName = hre.ethers.utils.formatBytes32String('API3/USD');
                        await dapiServer.mockDapiName(dapiName, dataFeedId);
                        const api3ToUsdReaderFactory = await hre.ethers.getContractFactory(
                          'Api3ToUsdReader',
                          roles.deployer
                        );
                        api3ToUsdReader = await api3ToUsdReaderFactory.deploy(
                          dapiServer.address,
                          claimsManager.address
                        );
                        await claimsManager.connect(roles.admin).setApi3ToUsdReader(api3ToUsdReader.address);
                        const claimant = roles.claimant.address;
                        const beneficiary = roles.beneficiary.address;
                        const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                        const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                        const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                        const policy = '/ipfs/Qm...testaddress';
                        const policyHash = hre.ethers.utils.solidityKeccak256(
                          ['address', 'address', 'uint32', 'string'],
                          [claimant, beneficiary, claimsAllowedFrom, policy]
                        );
                        await claimsManager
                          .connect(roles.policyAgent)
                          .createPolicy(
                            claimant,
                            beneficiary,
                            coverageAmountInUsd,
                            claimsAllowedFrom,
                            claimsAllowedUntil,
                            policy
                          );
                        const evidence = '/ipfs/Qm...testaddress';
                        const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                        await claimsManager
                          .connect(roles.claimant)
                          .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                        await expect(
                          claimsManager
                            .connect(roles.mediator)
                            .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                        ).to.be.revertedWith('API3 price not positive');
                      });
                    });
                  });
                  context('Data feed value is small enough to cause overflow', function () {
                    it('reverts', async function () {
                      const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
                      dapiServer = await dapiServerFactory.deploy();
                      const dataFeedId = hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(32));
                      const dataFeedValue = 1;
                      const dataFeedTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                      await dapiServer.mockDataFeed(dataFeedId, dataFeedValue, dataFeedTimestamp);
                      const dapiName = hre.ethers.utils.formatBytes32String('API3/USD');
                      await dapiServer.mockDapiName(dapiName, dataFeedId);
                      const api3ToUsdReaderFactory = await hre.ethers.getContractFactory(
                        'Api3ToUsdReader',
                        roles.deployer
                      );
                      api3ToUsdReader = await api3ToUsdReaderFactory.deploy(dapiServer.address, claimsManager.address);
                      await claimsManager.connect(roles.admin).setApi3ToUsdReader(api3ToUsdReader.address);
                      const claimant = roles.claimant.address;
                      const beneficiary = roles.beneficiary.address;
                      const coverageAmountInUsd = hre.ethers.BigNumber.from(
                        '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
                      ); // max uint224
                      hre.ethers.constants.MaxUint256;
                      const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                      const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                      const policy = '/ipfs/Qm...testaddress';
                      const policyHash = hre.ethers.utils.solidityKeccak256(
                        ['address', 'address', 'uint32', 'string'],
                        [claimant, beneficiary, claimsAllowedFrom, policy]
                      );
                      await claimsManager
                        .connect(roles.policyAgent)
                        .createPolicy(
                          claimant,
                          beneficiary,
                          coverageAmountInUsd,
                          claimsAllowedFrom,
                          claimsAllowedUntil,
                          policy
                        );
                      const evidence = '/ipfs/Qm...testaddress';
                      const claimAmountInUsd = hre.ethers.BigNumber.from(
                        '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
                      ); // max uint224
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                      await expect(
                        claimsManager
                          .connect(roles.mediator)
                          .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                      ).to.be.reverted;
                    });
                  });
                  context('Data feed value is not initialized', function () {
                    it('reverts', async function () {
                      const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
                      dapiServer = await dapiServerFactory.deploy();
                      const dataFeedId = hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(32));
                      const dapiName = hre.ethers.utils.formatBytes32String('API3/USD');
                      await dapiServer.mockDapiName(dapiName, dataFeedId);
                      const api3ToUsdReaderFactory = await hre.ethers.getContractFactory(
                        'Api3ToUsdReader',
                        roles.deployer
                      );
                      api3ToUsdReader = await api3ToUsdReaderFactory.deploy(dapiServer.address, claimsManager.address);
                      await claimsManager.connect(roles.admin).setApi3ToUsdReader(api3ToUsdReader.address);
                      const claimant = roles.claimant.address;
                      const beneficiary = roles.beneficiary.address;
                      const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                      const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                      const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                      const policy = '/ipfs/Qm...testaddress';
                      const policyHash = hre.ethers.utils.solidityKeccak256(
                        ['address', 'address', 'uint32', 'string'],
                        [claimant, beneficiary, claimsAllowedFrom, policy]
                      );
                      await claimsManager
                        .connect(roles.policyAgent)
                        .createPolicy(
                          claimant,
                          beneficiary,
                          coverageAmountInUsd,
                          claimsAllowedFrom,
                          claimsAllowedUntil,
                          policy
                        );
                      const evidence = '/ipfs/Qm...testaddress';
                      const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                      await claimsManager
                        .connect(roles.claimant)
                        .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                      await expect(
                        claimsManager
                          .connect(roles.mediator)
                          .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                      ).to.be.revertedWith('Data feed does not exist');
                    });
                  });
                });
                context('dAPI name is not set', function () {
                  it('reverts', async function () {
                    const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
                    dapiServer = await dapiServerFactory.deploy();
                    const api3ToUsdReaderFactory = await hre.ethers.getContractFactory(
                      'Api3ToUsdReader',
                      roles.deployer
                    );
                    api3ToUsdReader = await api3ToUsdReaderFactory.deploy(dapiServer.address, claimsManager.address);
                    await claimsManager.connect(roles.admin).setApi3ToUsdReader(api3ToUsdReader.address);
                    const claimant = roles.claimant.address;
                    const beneficiary = roles.beneficiary.address;
                    const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                    const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                    const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                    const policy = '/ipfs/Qm...testaddress';
                    const policyHash = hre.ethers.utils.solidityKeccak256(
                      ['address', 'address', 'uint32', 'string'],
                      [claimant, beneficiary, claimsAllowedFrom, policy]
                    );
                    await claimsManager
                      .connect(roles.policyAgent)
                      .createPolicy(
                        claimant,
                        beneficiary,
                        coverageAmountInUsd,
                        claimsAllowedFrom,
                        claimsAllowedUntil,
                        policy
                      );
                    const evidence = '/ipfs/Qm...testaddress';
                    const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                    await claimsManager
                      .connect(roles.claimant)
                      .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                    await expect(
                      claimsManager
                        .connect(roles.mediator)
                        .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                    ).to.be.revertedWith('Data feed does not exist');
                  });
                });
              });
              context('ClaimsManager is not whitelisted to read the dAPI', function () {
                it('reverts', async function () {
                  await dapiServer.mockIfAllowedToRead(false);
                  const claimant = roles.claimant.address;
                  const beneficiary = roles.beneficiary.address;
                  const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                  const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                  const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                  const policy = '/ipfs/Qm...testaddress';
                  const policyHash = hre.ethers.utils.solidityKeccak256(
                    ['address', 'address', 'uint32', 'string'],
                    [claimant, beneficiary, claimsAllowedFrom, policy]
                  );
                  await claimsManager
                    .connect(roles.policyAgent)
                    .createPolicy(
                      claimant,
                      beneficiary,
                      coverageAmountInUsd,
                      claimsAllowedFrom,
                      claimsAllowedUntil,
                      policy
                    );
                  const evidence = '/ipfs/Qm...testaddress';
                  const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                  await claimsManager
                    .connect(roles.claimant)
                    .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                  await expect(
                    claimsManager
                      .connect(roles.mediator)
                      .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                  ).to.be.revertedWith('Sender cannot read');
                });
              });
            });
            context('Api3ToUsdReader is not set', function () {
              it('reverts', async function () {
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
                  .grantRole(await claimsManager.policyAgentRole(), roles.policyAgent.address);
                await accessControlRegistry;
                const claimant = roles.claimant.address;
                const beneficiary = roles.beneficiary.address;
                const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                const policy = '/ipfs/Qm...testaddress';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'address', 'uint32', 'string'],
                  [claimant, beneficiary, claimsAllowedFrom, policy]
                );
                await claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy
                  );
                const evidence = '/ipfs/Qm...testaddress';
                const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
                await claimsManager
                  .connect(roles.claimant)
                  .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
                await expect(
                  claimsManager
                    .connect(roles.mediator)
                    .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
                ).to.be.revertedWith('Api3ToUsdReader not set');
              });
            });
          });
          context('It is too late to accept the claim', function () {
            it('reverts', async function () {
              const claimant = roles.claimant.address;
              const beneficiary = roles.beneficiary.address;
              const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
              const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
              const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
              const policy = '/ipfs/Qm...testaddress';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'address', 'uint32', 'string'],
                [claimant, beneficiary, claimsAllowedFrom, policy]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy
                );
              const evidence = '/ipfs/Qm...testaddress';
              const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
              const currentBlockTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              const claimCreationBlockTimestamp = currentBlockTimestamp + 1;
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [claimCreationBlockTimestamp]);
              await claimsManager
                .connect(roles.claimant)
                .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
              await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
                claimCreationBlockTimestamp + mediatorResponsePeriod,
              ]);
              await expect(
                claimsManager
                  .connect(roles.mediator)
                  .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
              ).to.be.revertedWith('Too late to accept claim');
            });
          });
        });
        context('Claim is not acceptable', function () {
          it('reverts', async function () {
            const claimant = roles.claimant.address;
            const beneficiary = roles.beneficiary.address;
            const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
            const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
            const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
            const policy = '/ipfs/Qm...testaddress';
            const policyHash = hre.ethers.utils.solidityKeccak256(
              ['address', 'address', 'uint32', 'string'],
              [claimant, beneficiary, claimsAllowedFrom, policy]
            );
            await claimsManager
              .connect(roles.policyAgent)
              .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
            const evidence = '/ipfs/Qm...testaddress';
            const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
            await claimsManager
              .connect(roles.claimant)
              .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
            await claimsManager
              .connect(roles.mediator)
              .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence);
            await expect(
              claimsManager
                .connect(roles.mediator)
                .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
            ).to.be.revertedWith('Claim not acceptable');
          });
        });
      });
      context('Claim does not exist', function () {
        it('reverts', async function () {
          const claimant = roles.claimant.address;
          const beneficiary = roles.beneficiary.address;
          const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
          const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
          const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
          const policy = '/ipfs/Qm...testaddress';
          const policyHash = hre.ethers.utils.solidityKeccak256(
            ['address', 'address', 'uint32', 'string'],
            [claimant, beneficiary, claimsAllowedFrom, policy]
          );
          await claimsManager
            .connect(roles.policyAgent)
            .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
          const evidence = '/ipfs/Qm...testaddress';
          const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
          await expect(
            claimsManager
              .connect(roles.mediator)
              .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
          ).to.be.revertedWith('Claim not acceptable');
        });
      });
    });
    context('Sender is not manager, admin or mediator', function () {
      it('reverts', async function () {
        const claimant = roles.claimant.address;
        const beneficiary = roles.beneficiary.address;
        const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
        const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
        const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
        const policy = '/ipfs/Qm...testaddress';
        const policyHash = hre.ethers.utils.solidityKeccak256(
          ['address', 'address', 'uint32', 'string'],
          [claimant, beneficiary, claimsAllowedFrom, policy]
        );
        await claimsManager
          .connect(roles.policyAgent)
          .createPolicy(claimant, beneficiary, coverageAmountInUsd, claimsAllowedFrom, claimsAllowedUntil, policy);
        const evidence = '/ipfs/Qm...testaddress';
        const claimAmountInUsd = hre.ethers.utils.parseEther('25000');
        await claimsManager
          .connect(roles.claimant)
          .createClaim(beneficiary, claimsAllowedFrom, policy, claimAmountInUsd, evidence);
        await expect(
          claimsManager
            .connect(roles.randomPerson)
            .acceptClaim(policyHash, claimant, beneficiary, claimAmountInUsd, evidence)
        ).to.be.revertedWith('Sender cannot mediate');
      });
    });
  });
});
