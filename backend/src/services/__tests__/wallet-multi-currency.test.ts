import { describe, it, expect } from 'vitest';
import { WalletAggregationService } from '../walletAggregation.js';

describe('Multi-currency wallet balances (#1009)', () => {
  it('keeps each currency isolated and aggregates by currency', async () => {
    const userId = `user_multi_${Date.now()}`;
    WalletAggregationService.connectWallet(userId, 'stellar', 'GSTELLARADDRESS123', 'freighter');
    WalletAggregationService.connectWallet(userId, 'ethereum', '0xETHADDRESS123', 'metamask');

    const aggregate = await WalletAggregationService.getAggregatedBalance(userId);
    const currencies = Object.fromEntries(aggregate.byCurrency.map((c) => [c.currency, c]));

    // Each currency is its own bucket...
    expect(currencies.XLM.amount).toBeCloseTo(1250.5);
    expect(currencies.ETH.amount).toBeCloseTo(0.42);
    // ...and the same symbol on two chains is summed, with both chains recorded.
    expect(currencies.USDC.amount).toBeCloseTo(350);
    expect(currencies.USDC.chains.sort()).toEqual(['ethereum', 'stellar']);

    // The aggregate USD total still exists as a headline figure.
    const sumOfCurrencies = aggregate.byCurrency.reduce((sum, c) => sum + c.balanceUSD, 0);
    expect(aggregate.totalUSD).toBeCloseTo(Number(sumOfCurrencies.toFixed(2)), 1);
  });

  it('reports a single currency without leaking others', async () => {
    const userId = `user_single_${Date.now()}`;
    WalletAggregationService.connectWallet(userId, 'stellar', 'GSTELLARONLY123', 'freighter');

    const balances = await WalletAggregationService.getBalancesByCurrency(userId);
    const currencyCodes = balances.currencies.map((c) => c.currency);

    expect(currencyCodes).toContain('XLM');
    expect(currencyCodes).not.toContain('ETH');

    const xlm = await WalletAggregationService.getCurrencyBalance(userId, 'xlm');
    expect(xlm?.currency).toBe('XLM');
    expect(xlm?.includesNative).toBe(true);

    const missing = await WalletAggregationService.getCurrencyBalance(userId, 'btc');
    expect(missing).toBeUndefined();
  });

  it('returns an empty currency list for a user with no wallets', async () => {
    const balances = await WalletAggregationService.getBalancesByCurrency(`user_none_${Date.now()}`);
    expect(balances.currencies).toEqual([]);
    expect(balances.totalUSD).toBe(0);
  });
});
