const { expect } = require('chai');
const hre = require('hardhat');

describe('ClaimsManager', function () {
  let accessControlRegistry, api3Pool, claimsManager, dapiServer, api3ToUsdReader;
  let roles;
  let mediatorResponsePeriod = 3 * 24 * 60 * 60,
    claimantResponsePeriod = 3 * 24 * 60 * 60,
    arbitratorResponsePeriod = 60 * 24 * 60 * 60;

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
    const api3PoolFactory = await hre.ethers.getContractFactory('MockApi3Pool', roles.deployer);
    api3Pool = await api3PoolFactory.deploy();
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
    const api3ToUsdReaderFactory = await hre.ethers.getContractFactory('Api3ToUsdReader', roles.deployer);
    api3ToUsdReader = await api3ToUsdReaderFactory.deploy(dapiServer.address, claimsManager.address);
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
                    context('Metadata argument is not empty', function () {
                      it('creates policy', async function () {
                        const claimant = roles.claimant.address;
                        const beneficiary = roles.beneficiary.address;
                        const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                        // claimsAllowedFrom can be from the past
                        const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                        const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                        const policy = '/ipfs/Qm...testhash';
                        const metadata = 'dAPI:ETH/USD...testmetadata';
                        const policyHash = hre.ethers.utils.solidityKeccak256(
                          ['address', 'address', 'uint32', 'string', 'string'],
                          [claimant, beneficiary, claimsAllowedFrom, policy, metadata]
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
                              policy,
                              metadata
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
                            metadata,
                            roles.manager.address
                          );
                        const policyState = await claimsManager.policyHashToState(policyHash);
                        expect(policyState.claimsAllowedUntil).to.equal(claimsAllowedUntil);
                        expect(policyState.coverageAmountInUsd).to.equal(coverageAmountInUsd);
                      });
                    });
                    context('Metadata argument is not empty', function () {
                      it('creates policy', async function () {
                        const claimant = roles.claimant.address;
                        const beneficiary = roles.beneficiary.address;
                        const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                        // claimsAllowedFrom can be from the past
                        const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                        const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                        const policy = '/ipfs/Qm...testhash';
                        const metadata = '';
                        const policyHash = hre.ethers.utils.solidityKeccak256(
                          ['address', 'address', 'uint32', 'string', 'string'],
                          [claimant, beneficiary, claimsAllowedFrom, policy, metadata]
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
                              policy,
                              metadata
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
                            metadata,
                            roles.manager.address
                          );
                        const policyState = await claimsManager.policyHashToState(policyHash);
                        expect(policyState.claimsAllowedUntil).to.equal(claimsAllowedUntil);
                        expect(policyState.coverageAmountInUsd).to.equal(coverageAmountInUsd);
                      });
                    });
                  });
                  context('Policy has been created before', function () {
                    it('reverts', async function () {
                      const claimant = roles.claimant.address;
                      const beneficiary = roles.beneficiary.address;
                      const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                      const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                      const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                      const policy = '/ipfs/Qm...testhash';
                      const metadata = 'dAPI:ETH/USD...testmetadata';
                      await claimsManager
                        .connect(roles.manager)
                        .createPolicy(
                          claimant,
                          beneficiary,
                          coverageAmountInUsd,
                          claimsAllowedFrom,
                          claimsAllowedUntil,
                          policy,
                          metadata
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
                            policy,
                            metadata
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
                    const metadata = 'dAPI:ETH/USD...testmetadata';
                    await expect(
                      claimsManager
                        .connect(roles.manager)
                        .createPolicy(
                          claimant,
                          beneficiary,
                          coverageAmountInUsd,
                          claimsAllowedFrom,
                          claimsAllowedUntil,
                          policy,
                          metadata
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
                  const policy = '/ipfs/Qm...testhash';
                  const metadata = 'dAPI:ETH/USD...testmetadata';
                  await expect(
                    claimsManager
                      .connect(roles.manager)
                      .createPolicy(
                        claimant,
                        beneficiary,
                        coverageAmountInUsd,
                        claimsAllowedFrom,
                        claimsAllowedUntil,
                        policy,
                        metadata
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
                const policy = '/ipfs/Qm...testhash';
                const metadata = 'dAPI:ETH/USD...testmetadata';
                await expect(
                  claimsManager
                    .connect(roles.manager)
                    .createPolicy(
                      claimant,
                      beneficiary,
                      coverageAmountInUsd,
                      claimsAllowedFrom,
                      claimsAllowedUntil,
                      policy,
                      metadata
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
              const policy = '/ipfs/Qm...testhash';
              const metadata = 'dAPI:ETH/USD...testmetadata';
              await expect(
                claimsManager
                  .connect(roles.manager)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy,
                    metadata
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
            const policy = '/ipfs/Qm...testhash';
            const metadata = 'dAPI:ETH/USD...testmetadata';
            await expect(
              claimsManager
                .connect(roles.manager)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy,
                  metadata
                )
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
          const policy = '/ipfs/Qm...testhash';
          const metadata = 'dAPI:ETH/USD...testmetadata';
          await expect(
            claimsManager
              .connect(roles.manager)
              .createPolicy(
                claimant,
                beneficiary,
                coverageAmountInUsd,
                claimsAllowedFrom,
                claimsAllowedUntil,
                policy,
                metadata
              )
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
                    context('Metadata argument is not empty', function () {
                      it('creates policy', async function () {
                        const claimant = roles.claimant.address;
                        const beneficiary = roles.beneficiary.address;
                        const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                        // claimsAllowedFrom can be from the past
                        const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                        const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                        const policy = '/ipfs/Qm...testhash';
                        const metadata = 'dAPI:ETH/USD...testmetadata';
                        const policyHash = hre.ethers.utils.solidityKeccak256(
                          ['address', 'address', 'uint32', 'string', 'string'],
                          [claimant, beneficiary, claimsAllowedFrom, policy, metadata]
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
                              policy,
                              metadata
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
                            metadata,
                            roles.policyAgent.address
                          );
                        const policyState = await claimsManager.policyHashToState(policyHash);
                        expect(policyState.claimsAllowedUntil).to.equal(claimsAllowedUntil);
                        expect(policyState.coverageAmountInUsd).to.equal(coverageAmountInUsd);
                      });
                    });
                    context('Metadata argument is not empty', function () {
                      it('creates policy', async function () {
                        const claimant = roles.claimant.address;
                        const beneficiary = roles.beneficiary.address;
                        const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                        // claimsAllowedFrom can be from the past
                        const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                        const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                        const policy = '/ipfs/Qm...testhash';
                        const metadata = '';
                        const policyHash = hre.ethers.utils.solidityKeccak256(
                          ['address', 'address', 'uint32', 'string', 'string'],
                          [claimant, beneficiary, claimsAllowedFrom, policy, metadata]
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
                              policy,
                              metadata
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
                            metadata,
                            roles.policyAgent.address
                          );
                        const policyState = await claimsManager.policyHashToState(policyHash);
                        expect(policyState.claimsAllowedUntil).to.equal(claimsAllowedUntil);
                        expect(policyState.coverageAmountInUsd).to.equal(coverageAmountInUsd);
                      });
                    });
                  });
                  context('Policy has been created before', function () {
                    it('reverts', async function () {
                      const claimant = roles.claimant.address;
                      const beneficiary = roles.beneficiary.address;
                      const coverageAmountInUsd = hre.ethers.utils.parseEther('50000');
                      const claimsAllowedFrom = (await hre.ethers.provider.getBlock()).timestamp - 10000;
                      const claimsAllowedUntil = claimsAllowedFrom + 365 * 24 * 60 * 60;
                      const policy = '/ipfs/Qm...testhash';
                      const metadata = 'dAPI:ETH/USD...testmetadata';
                      await claimsManager
                        .connect(roles.policyAgent)
                        .createPolicy(
                          claimant,
                          beneficiary,
                          coverageAmountInUsd,
                          claimsAllowedFrom,
                          claimsAllowedUntil,
                          policy,
                          metadata
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
                            policy,
                            metadata
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
                    const metadata = 'dAPI:ETH/USD...testmetadata';
                    await expect(
                      claimsManager
                        .connect(roles.policyAgent)
                        .createPolicy(
                          claimant,
                          beneficiary,
                          coverageAmountInUsd,
                          claimsAllowedFrom,
                          claimsAllowedUntil,
                          policy,
                          metadata
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
                  const policy = '/ipfs/Qm...testhash';
                  const metadata = 'dAPI:ETH/USD...testmetadata';
                  await expect(
                    claimsManager
                      .connect(roles.policyAgent)
                      .createPolicy(
                        claimant,
                        beneficiary,
                        coverageAmountInUsd,
                        claimsAllowedFrom,
                        claimsAllowedUntil,
                        policy,
                        metadata
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
                const policy = '/ipfs/Qm...testhash';
                const metadata = 'dAPI:ETH/USD...testmetadata';
                await expect(
                  claimsManager
                    .connect(roles.policyAgent)
                    .createPolicy(
                      claimant,
                      beneficiary,
                      coverageAmountInUsd,
                      claimsAllowedFrom,
                      claimsAllowedUntil,
                      policy,
                      metadata
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
              const policy = '/ipfs/Qm...testhash';
              const metadata = 'dAPI:ETH/USD...testmetadata';
              await expect(
                claimsManager
                  .connect(roles.policyAgent)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy,
                    metadata
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
            const policy = '/ipfs/Qm...testhash';
            const metadata = 'dAPI:ETH/USD...testmetadata';
            await expect(
              claimsManager
                .connect(roles.policyAgent)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy,
                  metadata
                )
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
          const policy = '/ipfs/Qm...testhash';
          const metadata = 'dAPI:ETH/USD...testmetadata';
          await expect(
            claimsManager
              .connect(roles.policyAgent)
              .createPolicy(
                claimant,
                beneficiary,
                coverageAmountInUsd,
                claimsAllowedFrom,
                claimsAllowedUntil,
                policy,
                metadata
              )
          ).to.be.revertedWith('Claimant address zero');
        });
      });
    });
    context('Sender is not manager or policy agent', function () {
      it('reverts', async function () {
        await expect(
          claimsManager
            .connect(roles.randomPerson)
            .createPolicy(hre.ethers.constants.AddressZero, hre.ethers.constants.AddressZero, 0, 0, 0, '', '')
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
              const policy = '/ipfs/Qm...testhash';
              const metadata = 'dAPI:ETH/USD...testmetadata';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'address', 'uint32', 'string', 'string'],
                [claimant, beneficiary, claimsAllowedFrom, policy, metadata]
              );
              await claimsManager
                .connect(roles.manager)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy,
                  metadata
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
                    policy,
                    metadata
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
                  metadata,
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
              const policy = '/ipfs/Qm...testhash';
              const metadata = 'dAPI:ETH/USD...testmetadata';
              await claimsManager
                .connect(roles.manager)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy,
                  metadata
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
                    policy,
                    metadata
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
            const policy = '/ipfs/Qm...testhash';
            const metadata = 'dAPI:ETH/USD...testmetadata';
            await claimsManager
              .connect(roles.manager)
              .createPolicy(
                claimant,
                beneficiary,
                coverageAmountInUsd,
                claimsAllowedFrom,
                claimsAllowedUntil,
                policy,
                metadata
              );
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
                  policy,
                  metadata
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
          const policy = '/ipfs/Qm...testhash';
          const metadata = 'dAPI:ETH/USD...testmetadata';
          await expect(
            claimsManager
              .connect(roles.manager)
              .upgradePolicy(
                claimant,
                beneficiary,
                coverageAmountInUsd,
                claimsAllowedFrom,
                claimsAllowedUntil,
                policy,
                metadata
              )
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
              const policy = '/ipfs/Qm...testhash';
              const metadata = 'dAPI:ETH/USD...testmetadata';
              const policyHash = hre.ethers.utils.solidityKeccak256(
                ['address', 'address', 'uint32', 'string', 'string'],
                [claimant, beneficiary, claimsAllowedFrom, policy, metadata]
              );
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy,
                  metadata
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
                    policy,
                    metadata
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
                  metadata,
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
              const policy = '/ipfs/Qm...testhash';
              const metadata = 'dAPI:ETH/USD...testmetadata';
              await claimsManager
                .connect(roles.policyAgent)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy,
                  metadata
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
                    policy,
                    metadata
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
            const policy = '/ipfs/Qm...testhash';
            const metadata = 'dAPI:ETH/USD...testmetadata';
            await claimsManager
              .connect(roles.policyAgent)
              .createPolicy(
                claimant,
                beneficiary,
                coverageAmountInUsd,
                claimsAllowedFrom,
                claimsAllowedUntil,
                policy,
                metadata
              );
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
                  policy,
                  metadata
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
          const policy = '/ipfs/Qm...testhash';
          const metadata = 'dAPI:ETH/USD...testmetadata';
          await expect(
            claimsManager
              .connect(roles.policyAgent)
              .upgradePolicy(
                claimant,
                beneficiary,
                coverageAmountInUsd,
                claimsAllowedFrom,
                claimsAllowedUntil,
                policy,
                metadata
              )
          ).to.be.revertedWith('Policy does not exist');
        });
      });
    });
    context('Sender is not manager or policy agent', function () {
      it('reverts', async function () {
        await expect(
          claimsManager
            .connect(roles.randomPerson)
            .upgradePolicy(hre.ethers.constants.AddressZero, hre.ethers.constants.AddressZero, 0, 0, 0, '', '')
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
                const policy = '/ipfs/Qm...testhash';
                const metadata = 'dAPI:ETH/USD...testmetadata';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'address', 'uint32', 'string', 'string'],
                  [claimant, beneficiary, claimsAllowedFrom, policy, metadata]
                );
                await claimsManager
                  .connect(roles.manager)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy,
                    metadata
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
                      policy,
                      metadata
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
                    metadata,
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
                const policy = '/ipfs/Qm...testhash';
                const metadata = 'dAPI:ETH/USD...testmetadata';
                await claimsManager
                  .connect(roles.manager)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy,
                    metadata
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
                      policy,
                      metadata
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
              const policy = '/ipfs/Qm...testhash';
              const metadata = 'dAPI:ETH/USD...testmetadata';
              await claimsManager
                .connect(roles.manager)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy,
                  metadata
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
                    policy,
                    metadata
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
            const policy = '/ipfs/Qm...testhash';
            const metadata = 'dAPI:ETH/USD...testmetadata';
            await expect(
              claimsManager
                .connect(roles.manager)
                .downgradePolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy,
                  metadata
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
          const policy = '/ipfs/Qm...testhash';
          const metadata = 'dAPI:ETH/USD...testmetadata';
          await expect(
            claimsManager
              .connect(roles.manager)
              .downgradePolicy(
                claimant,
                beneficiary,
                coverageAmountInUsd,
                claimsAllowedFrom,
                claimsAllowedUntil,
                policy,
                metadata
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
                const policy = '/ipfs/Qm...testhash';
                const metadata = 'dAPI:ETH/USD...testmetadata';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'address', 'uint32', 'string', 'string'],
                  [claimant, beneficiary, claimsAllowedFrom, policy, metadata]
                );
                await claimsManager
                  .connect(roles.manager)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy,
                    metadata
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
                      policy,
                      metadata
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
                    metadata,
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
                const policy = '/ipfs/Qm...testhash';
                const metadata = 'dAPI:ETH/USD...testmetadata';
                await claimsManager
                  .connect(roles.manager)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy,
                    metadata
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
                      policy,
                      metadata
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
              const policy = '/ipfs/Qm...testhash';
              const metadata = 'dAPI:ETH/USD...testmetadata';
              await claimsManager
                .connect(roles.manager)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy,
                  metadata
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
                    policy,
                    metadata
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
            const policy = '/ipfs/Qm...testhash';
            const metadata = 'dAPI:ETH/USD...testmetadata';
            await expect(
              claimsManager
                .connect(roles.admin)
                .downgradePolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy,
                  metadata
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
          const policy = '/ipfs/Qm...testhash';
          const metadata = 'dAPI:ETH/USD...testmetadata';
          await expect(
            claimsManager
              .connect(roles.admin)
              .downgradePolicy(
                claimant,
                beneficiary,
                coverageAmountInUsd,
                claimsAllowedFrom,
                claimsAllowedUntil,
                policy,
                metadata
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
                const policy = '/ipfs/Qm...testhash';
                const metadata = 'dAPI:ETH/USD...testmetadata';
                const policyHash = hre.ethers.utils.solidityKeccak256(
                  ['address', 'address', 'uint32', 'string', 'string'],
                  [claimant, beneficiary, claimsAllowedFrom, policy, metadata]
                );
                await claimsManager
                  .connect(roles.manager)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy,
                    metadata
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
                      policy,
                      metadata
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
                    metadata,
                    roles.claimant.address
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
                const policy = '/ipfs/Qm...testhash';
                const metadata = 'dAPI:ETH/USD...testmetadata';
                await claimsManager
                  .connect(roles.manager)
                  .createPolicy(
                    claimant,
                    beneficiary,
                    coverageAmountInUsd,
                    claimsAllowedFrom,
                    claimsAllowedUntil,
                    policy,
                    metadata
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
                      policy,
                      metadata
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
              const policy = '/ipfs/Qm...testhash';
              const metadata = 'dAPI:ETH/USD...testmetadata';
              await claimsManager
                .connect(roles.manager)
                .createPolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy,
                  metadata
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
                    policy,
                    metadata
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
            const policy = '/ipfs/Qm...testhash';
            const metadata = 'dAPI:ETH/USD...testmetadata';
            await expect(
              claimsManager
                .connect(roles.claimant)
                .downgradePolicy(
                  claimant,
                  beneficiary,
                  coverageAmountInUsd,
                  claimsAllowedFrom,
                  claimsAllowedUntil,
                  policy,
                  metadata
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
          const policy = '/ipfs/Qm...testhash';
          const metadata = 'dAPI:ETH/USD...testmetadata';
          await expect(
            claimsManager
              .connect(roles.claimant)
              .downgradePolicy(
                claimant,
                beneficiary,
                coverageAmountInUsd,
                claimsAllowedFrom,
                claimsAllowedUntil,
                policy,
                metadata
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
        const policy = '/ipfs/Qm...testhash';
        const metadata = 'dAPI:ETH/USD...testmetadata';
        await expect(
          claimsManager
            .connect(roles.randomPerson)
            .downgradePolicy(
              claimant,
              beneficiary,
              coverageAmountInUsd,
              claimsAllowedFrom,
              claimsAllowedUntil,
              policy,
              metadata
            )
        ).to.be.revertedWith('Sender cannot downgrade policies');
      });
    });
  });
});
