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
          await expect(claimsManager.connect(roles.manager).setMediatorResponsePeriod(123))
            .to.emit(claimsManager, 'SetMediatorResponsePeriod')
            .withArgs(123, roles.manager.address);
          expect(await claimsManager.mediatorResponsePeriod()).to.equal(123);
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
          await expect(claimsManager.connect(roles.admin).setMediatorResponsePeriod(123))
            .to.emit(claimsManager, 'SetMediatorResponsePeriod')
            .withArgs(123, roles.admin.address);
          expect(await claimsManager.mediatorResponsePeriod()).to.equal(123);
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
        await expect(claimsManager.connect(roles.randomPerson).setMediatorResponsePeriod(123)).to.be.revertedWith(
          'Sender cannot administrate'
        );
      });
    });
  });

  describe('setClaimantResponsePeriod', function () {
    context('Sender is manager', function () {
      context('Claimant response period is not zero', function () {
        it('sets claimant response period', async function () {
          await expect(claimsManager.connect(roles.manager).setClaimantResponsePeriod(123))
            .to.emit(claimsManager, 'SetClaimantResponsePeriod')
            .withArgs(123, roles.manager.address);
          expect(await claimsManager.claimantResponsePeriod()).to.equal(123);
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
          await expect(claimsManager.connect(roles.admin).setClaimantResponsePeriod(123))
            .to.emit(claimsManager, 'SetClaimantResponsePeriod')
            .withArgs(123, roles.admin.address);
          expect(await claimsManager.claimantResponsePeriod()).to.equal(123);
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
        await expect(claimsManager.connect(roles.randomPerson).setClaimantResponsePeriod(123)).to.be.revertedWith(
          'Sender cannot administrate'
        );
      });
    });
  });

  describe('setArbitratorResponsePeriod', function () {
    context('Sender is manager', function () {
      context('Arbitrator response period is not zero', function () {
        it('sets arbitrator response period', async function () {
          await expect(claimsManager.connect(roles.manager).setArbitratorResponsePeriod(123))
            .to.emit(claimsManager, 'SetArbitratorResponsePeriod')
            .withArgs(123, roles.manager.address);
          expect(await claimsManager.arbitratorResponsePeriod()).to.equal(123);
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
          await expect(claimsManager.connect(roles.admin).setArbitratorResponsePeriod(123))
            .to.emit(claimsManager, 'SetArbitratorResponsePeriod')
            .withArgs(123, roles.admin.address);
          expect(await claimsManager.arbitratorResponsePeriod()).to.equal(123);
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
        await expect(claimsManager.connect(roles.randomPerson).setArbitratorResponsePeriod(123)).to.be.revertedWith(
          'Sender cannot administrate'
        );
      });
    });
  });
});
