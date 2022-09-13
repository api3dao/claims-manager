const hre = require('hardhat');

// API3 price is $2
const api3UsdPriceWith18Decimals = hre.ethers.utils.parseEther('2');
// The API3 staking pool has 50 million API3 staked
const totalStake = hre.ethers.utils.parseEther('50000000');

describe('KlerosLiquidProxy', function () {
  let accessControlRegistry,
    api3Token,
    api3Pool,
    claimsManager,
    dapiServer,
    api3ToUsdReader,
    klerosLiquid,
    klerosLiquidProxy;
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
      // claimant: accounts[6],
      // beneficiary: accounts[7],
      // randomPerson: accounts[9],
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
      3 * 24 * 60 * 60,
      3 * 24 * 60 * 60,
      30 * 24 * 60 * 60
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
    const klerosLiquidFactory = await hre.ethers.getContractFactory('MockKlerosLiquid', roles.deployer);
    klerosLiquid = await klerosLiquidFactory.deploy();
    const klerosLiquidProxyFactory = await hre.ethers.getContractFactory('KlerosLiquidProxy', roles.deployer);
    klerosLiquidProxy = await klerosLiquidProxyFactory.deploy(
      claimsManager.address,
      klerosLiquid.address,
      '0x123456',
      '/ipfs/Qm...testhash/metaevidence.json'
    );
  });

  describe('constructor', function () {
    it('works', async function () {
      console.log(klerosLiquidProxy.address);
      console.log(api3ToUsdReader.address);
    });
  });
});
