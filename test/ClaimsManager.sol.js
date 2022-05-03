const hre = require('hardhat');

describe('GnosisSafeWithoutProxy', function () {
  let claimsManager;
  let roles;

  beforeEach(async () => {
    const accounts = await hre.ethers.getSigners();
    roles = {
      deployer: accounts[0],
    };
    const claimsManagerFactory = await hre.ethers.getContractFactory('ClaimsManager', roles.deployer);
    claimsManager = await claimsManagerFactory.deploy();
  });

  describe('constructor', function () {
    it('works', async function () {
      console.log(claimsManager.address);
    });
  });
});
