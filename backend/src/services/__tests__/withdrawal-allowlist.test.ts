import { describe, it, expect, beforeEach } from 'vitest';
import {
  configureWallet,
  addToAllowlist,
  removeFromAllowlist,
  isAllowlisted,
  createWithdrawalRequest,
  approveWithdrawal,
  rejectWithdrawal,
  markExecuted,
  checkVelocity,
  resetWithdrawalAllowlistStore,
  WithdrawalApprovalError,
} from '../withdrawal-allowlist.js';

describe('withdrawal allowlist service', () => {
  beforeEach(() => {
    resetWithdrawalAllowlistStore();
  });

  it('auto-approves a withdrawal to an allowlisted address with no extra signers required', () => {
    addToAllowlist('wallet-1', 'GADDR_ALLOWED', 'owner');
    const request = createWithdrawalRequest({
      walletId: 'wallet-1',
      toAddress: 'GADDR_ALLOWED',
      amount: 100,
      currency: 'XLM',
      requestedBy: 'owner',
    });

    expect(request.isAllowlisted).toBe(true);
    expect(request.status).toBe('approved');
  });

  it('requires multi-signature approval for a non-allowlisted address', () => {
    configureWallet('wallet-2', { approvalThreshold: 2, approvers: ['alice', 'bob'] });
    const request = createWithdrawalRequest({
      walletId: 'wallet-2',
      toAddress: 'GADDR_UNKNOWN',
      amount: 100,
      currency: 'XLM',
      requestedBy: 'owner',
    });

    expect(request.isAllowlisted).toBe(false);
    expect(request.status).toBe('pending_approval');

    const afterOne = approveWithdrawal(request.id, 'alice');
    expect(afterOne.status).toBe('pending_approval');

    const afterTwo = approveWithdrawal(request.id, 'bob');
    expect(afterTwo.status).toBe('approved');
  });

  it('rejects approval attempts from non-authorized approvers', () => {
    configureWallet('wallet-3', { approvalThreshold: 1, approvers: ['alice'] });
    const request = createWithdrawalRequest({
      walletId: 'wallet-3',
      toAddress: 'GADDR_UNKNOWN',
      amount: 50,
      currency: 'XLM',
      requestedBy: 'owner',
    });

    expect(() => approveWithdrawal(request.id, 'eve')).toThrow(WithdrawalApprovalError);
  });

  it('rejects a withdrawal request and prevents further approval', () => {
    configureWallet('wallet-4', { approvalThreshold: 1, approvers: ['alice'] });
    const request = createWithdrawalRequest({
      walletId: 'wallet-4',
      toAddress: 'GADDR_UNKNOWN',
      amount: 50,
      currency: 'XLM',
      requestedBy: 'owner',
    });

    const rejected = rejectWithdrawal(request.id, 'alice');
    expect(rejected.status).toBe('rejected');
    expect(() => approveWithdrawal(request.id, 'alice')).toThrow(WithdrawalApprovalError);
  });

  it('blocks withdrawal creation once hourly count velocity limit is exceeded', () => {
    configureWallet('wallet-5', { velocityLimits: { maxCountPerHour: 1, maxAmountPerHour: 1_000_000, maxAmountPerDay: 1_000_000 } });
    addToAllowlist('wallet-5', 'GADDR_ALLOWED', 'owner');

    const first = createWithdrawalRequest({
      walletId: 'wallet-5',
      toAddress: 'GADDR_ALLOWED',
      amount: 10,
      currency: 'XLM',
      requestedBy: 'owner',
    });
    markExecuted(first.id, 'tx_1');

    const second = createWithdrawalRequest({
      walletId: 'wallet-5',
      toAddress: 'GADDR_ALLOWED',
      amount: 10,
      currency: 'XLM',
      requestedBy: 'owner',
    });

    expect(second.status).toBe('blocked_velocity');
  });

  it('blocks withdrawal creation once daily amount velocity limit is exceeded', () => {
    configureWallet('wallet-6', { velocityLimits: { maxCountPerHour: 100, maxAmountPerHour: 1_000_000, maxAmountPerDay: 100 } });
    const result = checkVelocity('wallet-6', 150);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/daily/i);
  });

  it('cannot execute a withdrawal that has not been approved', () => {
    configureWallet('wallet-7', { approvalThreshold: 2, approvers: ['alice', 'bob'] });
    const request = createWithdrawalRequest({
      walletId: 'wallet-7',
      toAddress: 'GADDR_UNKNOWN',
      amount: 20,
      currency: 'XLM',
      requestedBy: 'owner',
    });

    expect(() => markExecuted(request.id, 'tx_x')).toThrow(WithdrawalApprovalError);
  });

  it('removeFromAllowlist removes a previously added address', () => {
    addToAllowlist('wallet-8', 'GADDR_X', 'owner');
    expect(isAllowlisted('wallet-8', 'GADDR_X')).toBe(true);
    expect(removeFromAllowlist('wallet-8', 'GADDR_X')).toBe(true);
    expect(isAllowlisted('wallet-8', 'GADDR_X')).toBe(false);
  });
});
