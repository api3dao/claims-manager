const { expect } = require('chai');
const hre = require('hardhat');

describe('QuotaEnforcer', function () {
  let quotaEnforcer;
  let roles;

  beforeEach(async () => {
    const accounts = await hre.ethers.getSigners();
    roles = {
      deployer: accounts[0],
      account: accounts[1],
    };
    const quotaEnforcerFactory = await hre.ethers.getContractFactory('MockQuotaEnforcer', roles.deployer);
    quotaEnforcer = await quotaEnforcerFactory.deploy();
  });

  describe('_setQuota', function () {
    context('Account address is not zero', function () {
      context('Quota period is not zero', function () {
        context('Quota amount is not zero', function () {
          it('sets quota', async function () {
            const account = roles.account.address;
            const period = 7 * 24 * 60 * 60;
            const amount = hre.ethers.utils.parseEther('1000000');
            await expect(quotaEnforcer.setQuota(account, period, amount)).to.not.be.reverted;
            const quota = await quotaEnforcer.accountToQuota(account);
            expect(quota.period).is.equal(period);
            expect(quota.amount).is.equal(amount);
          });
        });
        context('Quota amount is zero', function () {
          it('reverts', async function () {
            const account = roles.account.address;
            const period = 7 * 24 * 60 * 60;
            const amount = 0;
            await expect(quotaEnforcer.setQuota(account, period, amount)).to.be.revertedWith('Quota amount zero');
          });
        });
      });
      context('Quota period is zero', function () {
        it('reverts', async function () {
          const account = roles.account.address;
          const period = 0;
          const amount = hre.ethers.utils.parseEther('1000000');
          await expect(quotaEnforcer.setQuota(account, period, amount)).to.be.revertedWith('Quota period zero');
        });
      });
    });
    context('Account address is zero', function () {
      it('reverts', async function () {
        const account = hre.ethers.constants.AddressZero;
        const period = 7 * 24 * 60 * 60;
        const amount = hre.ethers.utils.parseEther('1000000');
        await expect(quotaEnforcer.setQuota(account, period, amount)).to.be.revertedWith('Account address zero');
      });
    });
  });

  describe('_resetQuota', function () {
    context('Account address is not zero', function () {
      context('Quota is set before', function () {
        it('resets quota', async function () {
          const account = roles.account.address;
          const period = 7 * 24 * 60 * 60;
          const amount = hre.ethers.utils.parseEther('1000000');
          await quotaEnforcer.setQuota(account, period, amount);
          await expect(quotaEnforcer.resetQuota(account)).to.not.be.reverted;
          const quota = await quotaEnforcer.accountToQuota(account);
          expect(quota.period).is.equal(0);
          expect(quota.amount).is.equal(0);
        });
      });
      context('Quota is not set before', function () {
        it('resets quota', async function () {
          const account = roles.account.address;
          await expect(quotaEnforcer.resetQuota(account)).to.not.be.reverted;
          const quota = await quotaEnforcer.accountToQuota(account);
          expect(quota.period).is.equal(0);
          expect(quota.amount).is.equal(0);
        });
      });
    });
    context('Account address is zero', function () {
      it('reverts', async function () {
        const account = hre.ethers.constants.AddressZero;
        await expect(quotaEnforcer.resetQuota(account)).to.be.revertedWith('Account address zero');
      });
    });
  });

  describe('recordUsage', function () {
    context('Quota has not been set', function () {
      it('records usage', async function () {
        const account = roles.account.address;
        const usageAmount = hre.ethers.utils.parseEther('1000000');
        await expect(quotaEnforcer.externalRecordUsage(account, usageAmount)).to.not.be.reverted;
      });
    });
    context('Update does not quota to be exceeded', function () {
      it('records usage', async function () {
        const account = roles.account.address;
        const period = 7 * 24 * 60 * 60;
        const quotaAmount = hre.ethers.utils.parseEther('1000000');
        const usageAmount = quotaAmount;
        await quotaEnforcer.setQuota(account, period, quotaAmount);
        await expect(quotaEnforcer.externalRecordUsage(account, usageAmount)).to.not.be.reverted;
        expect(await quotaEnforcer.getQuotaUsage(account)).to.equal(usageAmount);
      });
    });
    context('Update causes quota to be exceeded', function () {
      it('reverts', async function () {
        const account = roles.account.address;
        const period = 7 * 24 * 60 * 60;
        const quotaAmount = hre.ethers.utils.parseEther('1000000');
        const usageAmount = quotaAmount.mul(2);
        await quotaEnforcer.setQuota(account, period, quotaAmount);
        await expect(quotaEnforcer.externalRecordUsage(account, usageAmount)).to.be.revertedWith('Quota exceeded');
        expect(await quotaEnforcer.getQuotaUsage(account)).to.equal(0);
      });
    });
  });

  describe('getQuotaUsage', function () {
    context('Quota has not been set', function () {
      it('returns 0', async function () {
        const account = roles.account.address;
        const usageAmount = hre.ethers.utils.parseEther('1000000');
        await expect(quotaEnforcer.externalRecordUsage(account, usageAmount)).to.not.be.reverted;
        expect(await quotaEnforcer.getQuotaUsage(account)).to.equal(0);
      });
    });
    context('Quota has been set', function () {
      it('returns quota usage', async function () {
        // Quota period is 7 days
        const account = roles.account.address;
        const period = 7 * 24 * 60 * 60;
        const quotaAmount = hre.ethers.utils.parseEther('1000000');
        await quotaEnforcer.setQuota(account, period, quotaAmount);
        expect(await quotaEnforcer.getQuotaUsage(account)).to.equal(0);
        // Record usage now
        const usageAmount = quotaAmount.div(2);
        await quotaEnforcer.externalRecordUsage(account, usageAmount);
        expect(await quotaEnforcer.getQuotaUsage(account)).to.equal(usageAmount);
        // Record usage 4 days later
        const usagePeriod = 4 * 24 * 60 * 60;
        await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
          (await hre.ethers.provider.getBlock()).timestamp + usagePeriod,
        ]);
        await quotaEnforcer.externalRecordUsage(account, usageAmount);
        expect(await quotaEnforcer.getQuotaUsage(account)).to.equal(usageAmount.mul(2));
        // Record usage 4 days later (the first usage is now beyond the scope of the quota)
        await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
          (await hre.ethers.provider.getBlock()).timestamp + usagePeriod,
        ]);
        await quotaEnforcer.externalRecordUsage(account, usageAmount);
        expect(await quotaEnforcer.getQuotaUsage(account)).to.equal(usageAmount.mul(2));
        // Record usage 4 days later (the first two usages is now beyond the scope of the quota)
        await hre.ethers.provider.send('evm_setNextBlockTimestamp', [
          (await hre.ethers.provider.getBlock()).timestamp + usagePeriod,
        ]);
        await quotaEnforcer.externalRecordUsage(account, usageAmount);
        expect(await quotaEnforcer.getQuotaUsage(account)).to.equal(usageAmount.mul(2));
      });
    });
  });
});
