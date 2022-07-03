const hre = require('hardhat');

describe('ClaimsManagerWithKlerosArbitration', function () {
  let accessControlRegistry,
    mockApi3Pool,
    mockKlerosArbitrator,
    claimsManagerWithKlerosArbitration,
    mockDapiServer,
    api3ToUsdReader;
  let roles;

  beforeEach(async () => {
    const accounts = await hre.ethers.getSigners();
    roles = {
      deployer: accounts[0],
      manager: accounts[1],
    };
    const accessControlRegistryFactory = await hre.ethers.getContractFactory('AccessControlRegistry', roles.deployer);
    accessControlRegistry = await accessControlRegistryFactory.deploy();
    const mockApi3PoolFactory = await hre.ethers.getContractFactory('MockApi3Pool', roles.deployer);
    mockApi3Pool = await mockApi3PoolFactory.deploy();
    const mockKlerosArbitratorFactory = await hre.ethers.getContractFactory('MockKlerosArbitrator', roles.deployer);
    mockKlerosArbitrator = await mockKlerosArbitratorFactory.deploy();
    const claimsManagerWithKlerosArbitrationFactory = await hre.ethers.getContractFactory(
      'ClaimsManagerWithKlerosArbitration',
      roles.deployer
    );
    claimsManagerWithKlerosArbitration = await claimsManagerWithKlerosArbitrationFactory.deploy(
      accessControlRegistry.address,
      'ClaimsManager admin',
      roles.manager.address,
      mockApi3Pool.address,
      3 * 24 * 60 * 60,
      3 * 24 * 60 * 60,
      mockKlerosArbitrator.address,
      '0x123456',
      '/ipfs/Qm...testhash/metaevidence.json',
      40 * 24 * 60 * 60
    );
    const mockDapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
    mockDapiServer = await mockDapiServerFactory.deploy();
    const api3ToUsdReaderFactory = await hre.ethers.getContractFactory('Api3ToUsdReader', roles.deployer);
    api3ToUsdReader = await api3ToUsdReaderFactory.deploy(
      mockDapiServer.address,
      claimsManagerWithKlerosArbitration.address
    );
  });

  describe('constructor', function () {
    it('works', async function () {
      console.log(api3ToUsdReader.address);
    });
  });
});
