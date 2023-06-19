const { expect } = require('chai');
const hre = require('hardhat');

describe('CurrencyConverterWithDapi', function () {
  let proxy, currencyConverterWithDapi;
  let roles;

  // API3 price is $2
  const api3UsdPriceWith18Decimals = hre.ethers.utils.parseEther('2');
  const dapiDecimals = 18;
  const dataFeedValue = api3UsdPriceWith18Decimals
    .mul(hre.ethers.BigNumber.from(10).pow(dapiDecimals))
    .div(hre.ethers.utils.parseEther('1'));

  beforeEach(async () => {
    const accounts = await hre.ethers.getSigners();
    roles = {
      deployer: accounts[0],
      reader: accounts[1],
      api3ServerV1: accounts[2],
      randomPerson: accounts[9],
    };
    const proxyFactory = await hre.ethers.getContractFactory('MockProxy', roles.deployer);
    proxy = await proxyFactory.deploy(roles.api3ServerV1.address);
    const dataFeedTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
    await proxy.mock(dataFeedValue, dataFeedTimestamp);
    const currencyConverterWithDapiFactory = await hre.ethers.getContractFactory(
      'CurrencyConverterWithDapi',
      roles.deployer
    );
    currencyConverterWithDapi = await currencyConverterWithDapiFactory.deploy(proxy.address, dapiDecimals);
  });

  describe('constructor', function () {
    context('Proxy address is not zero', function () {
      context('dAPI decimals is not zero', function () {
        it('constructs', async function () {
          expect(await currencyConverterWithDapi.proxy()).to.be.equal(proxy.address);
          expect(await currencyConverterWithDapi.dapiDecimals()).to.be.equal(dapiDecimals);
        });
      });
      context('dAPI decimals is zero', function () {
        it('reverts', async function () {
          const currencyConverterWithDapiFactory = await hre.ethers.getContractFactory(
            'CurrencyConverterWithDapi',
            roles.deployer
          );
          await expect(currencyConverterWithDapiFactory.deploy(proxy.address, 0)).to.be.revertedWith(
            'dAPI decimals zero'
          );
        });
      });
    });
    context('Proxy address is zero', function () {
      it('reverts', async function () {
        const currencyConverterWithDapiFactory = await hre.ethers.getContractFactory(
          'CurrencyConverterWithDapi',
          roles.deployer
        );
        await expect(
          currencyConverterWithDapiFactory.deploy(hre.ethers.constants.AddressZero, dapiDecimals)
        ).to.be.revertedWith('Proxy address zero');
      });
    });
  });

  describe('convertBaseToQuote', function () {
    context('Data feed value is not large enough to cause overflow', function () {
      context('dAPI name is set to a data feed that has a non-negative value', function () {
        it('converts base to quote', async function () {
          const baseAmount = hre.ethers.utils.parseEther('1000000');
          const expectedQuoteAmount = hre.ethers.utils.parseEther('2000000');
          expect(await currencyConverterWithDapi.connect(roles.reader).convertBaseToQuote(baseAmount)).to.equal(
            expectedQuoteAmount
          );
        });
      });
      context('dAPI name is set to a data feed that has a negative value', function () {
        it('reverts', async function () {
          const negativeDataFeedValue = -1;
          const dataFeedTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
          await proxy.mock(negativeDataFeedValue, dataFeedTimestamp);

          const baseAmount = hre.ethers.utils.parseEther('1000000');
          await expect(
            currencyConverterWithDapi.connect(roles.reader).convertBaseToQuote(baseAmount)
          ).to.be.revertedWith('Price not positive');
        });
      });
    });
    context('Data feed value is large enough to cause overflow', function () {
      it('reverts', async function () {
        const largeDataFeedValue = hre.ethers.BigNumber.from(
          '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffff'
        ); // max int224
        const dataFeedTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
        await proxy.mock(largeDataFeedValue, dataFeedTimestamp);

        const baseAmount = hre.ethers.utils.parseEther('1000000');
        await expect(currencyConverterWithDapi.connect(roles.reader).convertBaseToQuote(baseAmount)).to.be.reverted;
      });
    });
  });

  describe('convertQuoteToBase', function () {
    context('Data feed value is not small enough to cause overflow', function () {
      context('dAPI name is set to a data feed that has a non-negative value', function () {
        it('converts base to quote', async function () {
          const quoteAmount = hre.ethers.utils.parseEther('1000000');
          const expectedBaseAmount = hre.ethers.utils.parseEther('500000');
          expect(await currencyConverterWithDapi.connect(roles.reader).convertQuoteToBase(quoteAmount)).to.equal(
            expectedBaseAmount
          );
        });
      });
      context('dAPI name is set to a data feed that has a negative value', function () {
        it('reverts', async function () {
          const negativeDataFeedValue = -1;
          const dataFeedTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
          await proxy.mock(negativeDataFeedValue, dataFeedTimestamp);

          const quoteAmount = hre.ethers.utils.parseEther('1000000');
          await expect(
            currencyConverterWithDapi.connect(roles.reader).convertQuoteToBase(quoteAmount)
          ).to.be.revertedWith('Price not positive');
        });
      });
    });
    context('Data feed value is small enough to cause overflow', function () {
      it('reverts', async function () {
        const smallDataFeedValue = 1;
        const dataFeedTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
        await proxy.mock(smallDataFeedValue, dataFeedTimestamp);

        const quoteAmount = hre.ethers.constants.MaxUint256;
        await expect(currencyConverterWithDapi.connect(roles.reader).convertQuoteToBase(quoteAmount)).to.be.reverted;
      });
    });
  });
});
