import { describe, expect, it, beforeEach } from 'vitest';
import {
  classifyFailure,
  FailureAnalytics,
  ERROR_CODES,
  type TransactionFailure,
} from '../failure-analysis.js';

// ── classifyFailure ───────────────────────────────────────────────────────────

describe('classifyFailure', () => {
  it('classifies out-of-gas errors', () => {
    const result = classifyFailure({ errorMessage: 'out of gas', gasUsed: 200_000n, gasLimit: 200_000n });
    expect(result.code).toBe(ERROR_CODES.INSUFFICIENT_GAS);
    expect(result.severity).toBe('high');
    expect(result.resolutions.length).toBeGreaterThan(0);
  });

  it('classifies nonce too low', () => {
    const result = classifyFailure({ errorMessage: 'nonce too low' });
    expect(result.code).toBe(ERROR_CODES.NONCE_TOO_LOW);
  });

  it('classifies nonce too high', () => {
    const result = classifyFailure({ errorMessage: 'nonce too high', nonce: 500 });
    expect(result.code).toBe(ERROR_CODES.NONCE_TOO_HIGH);
    expect(result.shouldAlert).toBe(true);
  });

  it('classifies nonce collision', () => {
    const result = classifyFailure({ errorMessage: 'nonce collision detected' });
    expect(result.code).toBe(ERROR_CODES.NONCE_COLLISION);
    expect(result.severity).toBe('high');
    expect(result.shouldAlert).toBe(true);
  });

  it('classifies insufficient funds', () => {
    const result = classifyFailure({ errorMessage: 'insufficient funds for gas * price + value' });
    expect(result.code).toBe(ERROR_CODES.INSUFFICIENT_FUNDS);
    expect(result.shouldAlert).toBe(true);
  });

  it('classifies gas price too low / underpriced', () => {
    const result = classifyFailure({ errorMessage: 'transaction underpriced' });
    expect(result.code).toBe(ERROR_CODES.GAS_PRICE_TOO_LOW);
  });

  it('classifies access control errors', () => {
    const result = classifyFailure({ errorMessage: 'caller is not the owner' });
    expect(result.code).toBe(ERROR_CODES.ACCESS_CONTROL);
    expect(result.shouldAlert).toBe(true);
  });

  it('classifies invalid signature', () => {
    const result = classifyFailure({ errorMessage: 'invalid signature: ECDSA error' });
    expect(result.code).toBe(ERROR_CODES.SIGNATURE_INVALID);
    expect(result.severity).toBe('critical');
  });

  it('parses standard ABI-encoded revert reason', () => {
    // Encodes Error("ERC20: transfer amount exceeds balance")
    // selector 08c379a0 + offset 32 + length 38 + "ERC20: transfer amount exceeds balance"
    const revertData =
      '0x08c379a0' +
      '0000000000000000000000000000000000000000000000000000000000000020' +
      '0000000000000000000000000000000000000000000000000000000000000026' +
      Buffer.from('ERC20: transfer amount exceeds balance').toString('hex').padEnd(64, '0');
    const result = classifyFailure({ errorMessage: 'execution reverted', revertData });
    expect(result.revertReason).toBe('ERC20: transfer amount exceeds balance');
    expect([ERROR_CODES.REVERT, ERROR_CODES.REVERT_CUSTOM]).toContain(result.code);
  });

  it('classifies network timeouts', () => {
    const result = classifyFailure({ errorMessage: 'Request timeout: ECONNRESET' });
    expect(result.code).toBe(ERROR_CODES.NETWORK_TIMEOUT);
  });

  it('falls back to UNKNOWN for unrecognised errors', () => {
    const result = classifyFailure({ errorMessage: 'some totally novel error xyzzy' });
    expect(result.code).toBe(ERROR_CODES.UNKNOWN);
    expect(result.shouldAlert).toBe(true);
  });

  it('triggers insufficient gas when gasUsed >= gasLimit', () => {
    const result = classifyFailure({
      errorMessage: '',
      gasUsed: 150_000n,
      gasLimit: 150_000n,
    });
    expect(result.code).toBe(ERROR_CODES.INSUFFICIENT_GAS);
  });
});

// ── FailureAnalytics ──────────────────────────────────────────────────────────

describe('FailureAnalytics', () => {
  let analytics: FailureAnalytics;

  beforeEach(() => {
    analytics = new FailureAnalytics();
  });

  it('stores analysed failures and returns top patterns', () => {
    analytics.analyse({ errorMessage: 'out of gas' });
    analytics.analyse({ errorMessage: 'out of gas' });
    analytics.analyse({ errorMessage: 'nonce too low' });

    const top = analytics.getTopFailures(5);
    expect(top[0].code).toBe(ERROR_CODES.INSUFFICIENT_GAS);
    expect(top[0].count).toBe(2);
    expect(analytics.size).toBe(3);
  });

  it('tracks alerts separately', () => {
    analytics.analyse({ errorMessage: 'nonce collision detected', txHash: '0xabc' });
    analytics.analyse({ errorMessage: 'out of gas' }); // shouldAlert: false
    const alerts = analytics.getAlertsToEmit();
    expect(alerts.length).toBe(1);
    expect(alerts[0].txHash).toBe('0xabc');
  });

  it('clears history', () => {
    analytics.analyse({ errorMessage: 'revert' });
    analytics.clearHistory();
    expect(analytics.size).toBe(0);
    expect(analytics.getTopFailures()).toHaveLength(0);
  });

  it('attaches network and txHash to result', () => {
    const result = analytics.analyse({
      errorMessage: 'insufficient funds',
      txHash: '0xdeadbeef',
      network: 'mainnet',
    });
    expect(result.txHash).toBe('0xdeadbeef');
    expect(result.network).toBe('mainnet');
    expect(result.analysedAt).toBeInstanceOf(Date);
  });
});
