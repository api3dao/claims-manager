const { expect } = require('chai');
const hre = require('hardhat');

describe('CurrencyAmountConverterWithDapi', function () {
  let dapiServer, currencyAmountConverterWithDapi;
  let roles;

  const dapiName = hre.ethers.utils.formatBytes32String('API3/USD');
  const dapiDecimals = 18;
  // API3 price is $2
  const dataFeedValue = hre.ethers.BigNumber.from(2).mul(hre.ethers.BigNumber.from(10).pow(dapiDecimals));

  beforeEach(async () => {
    const accounts = await hre.ethers.getSigners();
    roles = {
      deployer: accounts[0],
      reader: accounts[1],
      randomPerson: accounts[9],
    };
    const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
    dapiServer = await dapiServerFactory.deploy();
    const dataFeedId = hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(32));
    const dataFeedTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
    await dapiServer.mockDataFeed(dataFeedId, dataFeedValue, dataFeedTimestamp);
    await dapiServer.mockDapiName(dapiName, dataFeedId);
    const currencyAmountConverterWithDapiFactory = await hre.ethers.getContractFactory(
      'CurrencyAmountConverterWithDapi',
      roles.deployer
    );
    currencyAmountConverterWithDapi = await currencyAmountConverterWithDapiFactory.deploy(
      dapiServer.address,
      roles.reader.address,
      dapiName,
      dapiDecimals
    );
  });

  describe('constructor', function () {
    context('Reader address is not zero', function () {
      context('dAPI name is not zero', function () {
        context('dAPI decimals is not zero', function () {
          it('constructs', async function () {
            expect(await currencyAmountConverterWithDapi.reader()).to.be.equal(roles.reader.address);
            expect(await currencyAmountConverterWithDapi.dapiName()).to.be.equal(dapiName);
            expect(await currencyAmountConverterWithDapi.dapiDecimals()).to.be.equal(dapiDecimals);
          });
        });
        context('dAPI decimals is zero', function () {
          it('reverts', async function () {
            const currencyAmountConverterWithDapiFactory = await hre.ethers.getContractFactory(
              'CurrencyAmountConverterWithDapi',
              roles.deployer
            );
            await expect(
              currencyAmountConverterWithDapiFactory.deploy(dapiServer.address, roles.reader.address, dapiName, 0)
            ).to.be.revertedWith('dAPI decimals zero');
          });
        });
      });
      context('dAPI name is zero', function () {
        it('reverts', async function () {
          const currencyAmountConverterWithDapiFactory = await hre.ethers.getContractFactory(
            'CurrencyAmountConverterWithDapi',
            roles.deployer
          );
          await expect(
            currencyAmountConverterWithDapiFactory.deploy(
              dapiServer.address,
              roles.reader.address,
              hre.ethers.constants.HashZero,
              dapiDecimals
            )
          ).to.be.revertedWith('dAPI name zero');
        });
      });
    });
    context('Reader address is zero', function () {
      it('reverts', async function () {
        const currencyAmountConverterWithDapiFactory = await hre.ethers.getContractFactory(
          'CurrencyAmountConverterWithDapi',
          roles.deployer
        );
        await expect(
          currencyAmountConverterWithDapiFactory.deploy(
            dapiServer.address,
            hre.ethers.constants.AddressZero,
            dapiName,
            dapiDecimals
          )
        ).to.be.revertedWith('Reader address zero');
      });
    });
  });

  describe('convertBaseToQuote', function () {
    context('Sender is reader', function () {
      context('CurrencyAmountConverterWithDapi is whitelisted to read the dAPI', function () {
        context('dAPI name is set', function () {
          context('Data feed value is not large enough to cause overflow', function () {
            context('dAPI name is set to a data feed that has a non-negative value', function () {
              it('converts base to quote', async function () {
                const baseAmount = hre.ethers.utils.parseEther('1000000');
                const expectedQuoteAmount = hre.ethers.utils.parseEther('2000000');
                expect(
                  await currencyAmountConverterWithDapi.connect(roles.reader).convertBaseToQuote(baseAmount)
                ).to.equal(expectedQuoteAmount);
              });
            });
            context('dAPI name is set to a data feed that has a negative value', function () {
              it('reverts', async function () {
                const negativeDataFeedValue = -1;
                const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
                dapiServer = await dapiServerFactory.deploy();
                const dataFeedId = hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(32));
                const dataFeedTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                await dapiServer.mockDataFeed(dataFeedId, negativeDataFeedValue, dataFeedTimestamp);
                await dapiServer.mockDapiName(dapiName, dataFeedId);
                const currencyAmountConverterWithDapiFactory = await hre.ethers.getContractFactory(
                  'CurrencyAmountConverterWithDapi',
                  roles.deployer
                );
                currencyAmountConverterWithDapi = await currencyAmountConverterWithDapiFactory.deploy(
                  dapiServer.address,
                  roles.reader.address,
                  dapiName,
                  dapiDecimals
                );

                const baseAmount = hre.ethers.utils.parseEther('1000000');
                await expect(
                  currencyAmountConverterWithDapi.connect(roles.reader).convertBaseToQuote(baseAmount)
                ).to.be.revertedWith('Price not positive');
              });
            });
          });
          context('Data feed value is large enough to cause overflow', function () {
            it('reverts', async function () {
              const largeDataFeedValue = hre.ethers.BigNumber.from(
                '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffff'
              ); // max int224
              const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
              dapiServer = await dapiServerFactory.deploy();
              const dataFeedId = hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(32));
              const dataFeedTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              await dapiServer.mockDataFeed(dataFeedId, largeDataFeedValue, dataFeedTimestamp);
              await dapiServer.mockDapiName(dapiName, dataFeedId);
              const currencyAmountConverterWithDapiFactory = await hre.ethers.getContractFactory(
                'CurrencyAmountConverterWithDapi',
                roles.deployer
              );
              currencyAmountConverterWithDapi = await currencyAmountConverterWithDapiFactory.deploy(
                dapiServer.address,
                roles.reader.address,
                dapiName,
                dapiDecimals
              );

              const baseAmount = hre.ethers.utils.parseEther('1000000');
              await expect(
                currencyAmountConverterWithDapi.connect(roles.reader).convertBaseToQuote(baseAmount)
              ).to.be.reverted;
            });
          });
        });
        context('dAPI name is not set', function () {
          it('reverts', async function () {
            const unsetDapiName = hre.ethers.utils.formatBytes32String('API3/ETH');
            const currencyAmountConverterWithDapiFactory = await hre.ethers.getContractFactory(
              'CurrencyAmountConverterWithDapi',
              roles.deployer
            );
            currencyAmountConverterWithDapi = await currencyAmountConverterWithDapiFactory.deploy(
              dapiServer.address,
              roles.reader.address,
              unsetDapiName,
              dapiDecimals
            );

            const baseAmount = hre.ethers.utils.parseEther('1000000');
            await expect(
              currencyAmountConverterWithDapi.connect(roles.reader).convertBaseToQuote(baseAmount)
            ).to.be.revertedWith('Data feed does not exist');
          });
        });
      });
      context('CurrencyAmountConverterWithDapi is not whitelisted to read the dAPI', function () {
        it('reverts', async function () {
          await dapiServer.mockIfAllowedToRead(false);

          const baseAmount = hre.ethers.utils.parseEther('1000000');
          await expect(
            currencyAmountConverterWithDapi.connect(roles.reader).convertBaseToQuote(baseAmount)
          ).to.be.revertedWith('Sender cannot read');
        });
      });
    });
    context('Sender is not reader', function () {
      it('reverts', async function () {
        const baseAmount = hre.ethers.utils.parseEther('1000000');
        await expect(
          currencyAmountConverterWithDapi.connect(roles.randomPerson).convertBaseToQuote(baseAmount)
        ).to.be.revertedWith('Sender not reader');
      });
    });
  });

  describe('convertQuoteToBase', function () {
    context('Sender is reader', function () {
      context('CurrencyAmountConverterWithDapi is whitelisted to read the dAPI', function () {
        context('dAPI name is set', function () {
          context('Data feed value is not small enough to cause overflow', function () {
            context('dAPI name is set to a data feed that has a non-negative value', function () {
              it('converts base to quote', async function () {
                const quoteAmount = hre.ethers.utils.parseEther('1000000');
                const expectedBaseAmount = hre.ethers.utils.parseEther('500000');
                expect(
                  await currencyAmountConverterWithDapi.connect(roles.reader).convertQuoteToBase(quoteAmount)
                ).to.equal(expectedBaseAmount);
              });
            });
            context('dAPI name is set to a data feed that has a negative value', function () {
              it('reverts', async function () {
                const negativeDataFeedValue = -1;
                const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
                dapiServer = await dapiServerFactory.deploy();
                const dataFeedId = hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(32));
                const dataFeedTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
                await dapiServer.mockDataFeed(dataFeedId, negativeDataFeedValue, dataFeedTimestamp);
                await dapiServer.mockDapiName(dapiName, dataFeedId);
                const currencyAmountConverterWithDapiFactory = await hre.ethers.getContractFactory(
                  'CurrencyAmountConverterWithDapi',
                  roles.deployer
                );
                currencyAmountConverterWithDapi = await currencyAmountConverterWithDapiFactory.deploy(
                  dapiServer.address,
                  roles.reader.address,
                  dapiName,
                  dapiDecimals
                );

                const quoteAmount = hre.ethers.utils.parseEther('1000000');
                await expect(
                  currencyAmountConverterWithDapi.connect(roles.reader).convertQuoteToBase(quoteAmount)
                ).to.be.revertedWith('Price not positive');
              });
            });
          });
          context('Data feed value is small enough to cause overflow', function () {
            it('reverts', async function () {
              const smallDataFeedValue = 1;
              const dapiServerFactory = await hre.ethers.getContractFactory('MockDapiServer', roles.deployer);
              dapiServer = await dapiServerFactory.deploy();
              const dataFeedId = hre.ethers.utils.hexlify(hre.ethers.utils.randomBytes(32));
              const dataFeedTimestamp = (await hre.ethers.provider.getBlock()).timestamp;
              await dapiServer.mockDataFeed(dataFeedId, smallDataFeedValue, dataFeedTimestamp);
              await dapiServer.mockDapiName(dapiName, dataFeedId);
              const currencyAmountConverterWithDapiFactory = await hre.ethers.getContractFactory(
                'CurrencyAmountConverterWithDapi',
                roles.deployer
              );
              currencyAmountConverterWithDapi = await currencyAmountConverterWithDapiFactory.deploy(
                dapiServer.address,
                roles.reader.address,
                dapiName,
                dapiDecimals
              );

              const quoteAmount = hre.ethers.constants.MaxUint256;
              await expect(
                currencyAmountConverterWithDapi.connect(roles.reader).convertQuoteToBase(quoteAmount)
              ).to.be.reverted;
            });
          });
        });
        context('dAPI name is not set', function () {
          it('reverts', async function () {
            const unsetDapiName = hre.ethers.utils.formatBytes32String('API3/ETH');
            const currencyAmountConverterWithDapiFactory = await hre.ethers.getContractFactory(
              'CurrencyAmountConverterWithDapi',
              roles.deployer
            );
            currencyAmountConverterWithDapi = await currencyAmountConverterWithDapiFactory.deploy(
              dapiServer.address,
              roles.reader.address,
              unsetDapiName,
              dapiDecimals
            );

            const quoteAmount = hre.ethers.utils.parseEther('1000000');
            await expect(
              currencyAmountConverterWithDapi.connect(roles.reader).convertQuoteToBase(quoteAmount)
            ).to.be.revertedWith('Data feed does not exist');
          });
        });
      });
      context('CurrencyAmountConverterWithDapi is not whitelisted to read the dAPI', function () {
        it('reverts', async function () {
          await dapiServer.mockIfAllowedToRead(false);

          const quoteAmount = hre.ethers.utils.parseEther('1000000');
          await expect(
            currencyAmountConverterWithDapi.connect(roles.reader).convertQuoteToBase(quoteAmount)
          ).to.be.revertedWith('Sender cannot read');
        });
      });
    });
    context('Sender is not reader', function () {
      it('reverts', async function () {
        const quoteAmount = hre.ethers.utils.parseEther('1000000');
        await expect(
          currencyAmountConverterWithDapi.connect(roles.randomPerson).convertQuoteToBase(quoteAmount)
        ).to.be.revertedWith('Sender not reader');
      });
    });
  });
});
