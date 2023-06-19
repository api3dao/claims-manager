const { ethers } = require('hardhat');

module.exports = {
  deriveRootRole: (managerAddress) => {
    return ethers.utils.solidityKeccak256(['address'], [managerAddress]);
  },
};
