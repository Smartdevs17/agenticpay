import { describe, it, expect, vi } from 'vitest';

// `batch.ts` pulls in the Stellar service, which validates required environment
// variables at import time and exits the process when one is missing. vi.hoisted
// runs before the import graph is evaluated, so the placeholder is in place first.
vi.hoisted(() => {
  process.env.OPENAI_API_KEY ??= 'sk-test-placeholder';
});

import {
  parseCSV,
  detectDuplicates,
  estimateBatch,
  executeBatch,
  rollbackBatch,
  getBatch,
  generateCSVTemplate,
  type BatchPaymentItem,
} from '../batch.js';

// Matches /^G[A-Z2-7]{55}$/, the address guard used by the batch service.
const VALID_A = 'G' + 'A'.repeat(55);
const VALID_B = 'G' + 'B'.repeat(55);
const INVALID = 'not-a-stellar-address';

function item(overrides: Partial<BatchPaymentItem> = {}): BatchPaymentItem {
  return { recipient: VALID_A, amount: '10', asset: 'XLM', ...overrides };
}

describe('parseCSV', () => {
  it('parses rows under a header row', () => {
    const { rows, errors } = parseCSV(
      ['recipient,amount,asset,memo', `${VALID_A},100.00,XLM,payroll`].join('\n')
    );

    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { recipient: VALID_A, amount: '100.00', asset: 'XLM', memo: 'payroll' },
    ]);
  });

  it('parses rows when no header is present', () => {
    const { rows } = parseCSV(`${VALID_A},100.00,XLM,payroll`);

    expect(rows).toHaveLength(1);
    expect(rows[0].memo).toBe('payroll');
  });

  it('keeps a quoted field containing a comma as a single column', () => {
    const { rows, errors } = parseCSV(
      `recipient,amount,asset,memo\n${VALID_A},100.00,XLM,"Invoice 12, net 30"`
    );

    expect(errors).toEqual([]);
    expect(rows[0].memo).toBe('Invoice 12, net 30');
    expect(rows[0].amount).toBe('100.00');
  });

  it('does not shift fields that follow a quoted field with a comma', () => {
    const { rows } = parseCSV(
      `recipient,amount,asset,memo\n${VALID_A},100.00,XLM,"Invoice 12, net 30"`
    );

    expect(rows[0].recipient).toBe(VALID_A);
    expect(rows[0].asset).toBe('XLM');
  });

  it('unescapes doubled quotes inside a quoted field', () => {
    const { rows } = parseCSV(
      `recipient,amount,asset,memo\n${VALID_A},1,XLM,"say ""hello"" loudly"`
    );

    expect(rows[0].memo).toBe('say "hello" loudly');
  });

  it('strips surrounding whitespace around unquoted fields', () => {
    const { rows } = parseCSV(
      `recipient,amount,asset,memo\n  ${VALID_A} , 100.00 , XLM , payroll  `
    );

    expect(rows[0].recipient).toBe(VALID_A);
    expect(rows[0].amount).toBe('100.00');
    expect(rows[0].asset).toBe('XLM');
    expect(rows[0].memo).toBe('payroll');
  });

  it('normalises CRLF line endings without leaving a stray carriage return', () => {
    const { rows, errors } = parseCSV(
      `recipient,amount,asset,memo\r\n${VALID_A},100.00,XLM,payroll\r\n`
    );

    expect(errors).toEqual([]);
    expect(rows[0].memo).toBe('payroll');
    expect(rows[0].memo).not.toContain('\r');
  });

  it('ignores blank lines', () => {
    const { rows } = parseCSV(
      `recipient,amount,asset,memo\n\n${VALID_A},100.00,XLM,payroll\n\n`
    );

    expect(rows).toHaveLength(1);
  });

  it('defaults the asset to XLM when the column is omitted', () => {
    const { rows } = parseCSV(`recipient,amount,memo\n${VALID_A},100.00,payroll`);

    expect(rows[0].asset).toBe('XLM');
  });

  it('keeps the memo in the memo column when there is no asset column', () => {
    const { rows } = parseCSV(`recipient,amount,memo\n${VALID_A},100.00,payroll`);

    expect(rows[0].memo).toBe('payroll');
  });

  it('maps columns by header name when the order differs', () => {
    const { rows, errors } = parseCSV(
      `memo,amount,recipient\npayroll,100.00,${VALID_A}`
    );

    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({
      recipient: VALID_A,
      amount: '100.00',
      asset: 'XLM',
      memo: 'payroll',
    });
  });

  it('matches header names case-insensitively', () => {
    const { rows } = parseCSV(`Recipient,Amount,Asset\n${VALID_A},100.00,USDC`);

    expect(rows[0].asset).toBe('USDC');
    expect(rows[0].amount).toBe('100.00');
  });

  it('falls back to positional columns when no header is present', () => {
    const { rows } = parseCSV(`${VALID_A},100.00,USDC,payroll`);

    expect(rows[0]).toEqual({
      recipient: VALID_A,
      amount: '100.00',
      asset: 'USDC',
      memo: 'payroll',
    });
  });

  it('reports a missing recipient with the offending line number', () => {
    const { rows, errors } = parseCSV(
      `recipient,amount,asset\n${VALID_A},1,XLM\n,2,XLM`
    );

    expect(rows).toHaveLength(1);
    expect(errors).toEqual([{ line: 3, error: 'Missing recipient' }]);
  });

  it('rejects an amount that is not a positive decimal', () => {
    const { rows, errors } = parseCSV(
      `recipient,amount,asset\n${VALID_A},not-a-number,XLM\n${VALID_A},-5,XLM`
    );

    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toEqual({ line: 2, error: 'Invalid amount: not-a-number' });
    expect(errors[1]).toEqual({ line: 3, error: 'Invalid amount: -5' });
  });

  it('rejects an amount with more than 7 decimal places', () => {
    const { rows, errors } = parseCSV(`recipient,amount,asset\n${VALID_A},1.12345678,XLM`);

    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it('round-trips its own generated template header', () => {
    const template = generateCSVTemplate();

    expect(template.split('\n')[0]).toBe('recipient,amount,asset,memo');
  });
});

describe('detectDuplicates', () => {
  it('flags every repeat of the same recipient and asset', () => {
    const duplicates = detectDuplicates([
      item(),
      item({ amount: '20' }),
      item({ amount: '30' }),
    ]);

    expect(duplicates).toEqual([1, 2]);
  });

  it('does not flag the same recipient in a different asset', () => {
    const duplicates = detectDuplicates([
      item({ asset: 'XLM' }),
      item({ asset: 'USDC' }),
    ]);

    expect(duplicates).toEqual([]);
  });

  it('returns an empty list for a batch with no repeats', () => {
    expect(detectDuplicates([item(), item({ recipient: VALID_B })])).toEqual([]);
  });
});

describe('estimateBatch', () => {
  it('returns a combined total for a single-asset batch', () => {
    const estimate = estimateBatch([
      item({ amount: '100.5' }),
      item({ amount: '50.25' }),
    ]);

    expect(estimate.totalAmount).toBe('150.7500000');
    expect(estimate.byAsset).toEqual({ XLM: '150.7500000' });
  });

  it('never sums incomparable assets into one total', () => {
    const estimate = estimateBatch([
      item({ amount: '100', asset: 'XLM' }),
      item({ amount: '40', asset: 'USDC' }),
    ]);

    expect(estimate.totalAmount).toBeNull();
    expect(estimate.byAsset).toEqual({ XLM: '100.0000000', USDC: '40.0000000' });
  });

  it('sums decimal amounts without floating point drift', () => {
    const estimate = estimateBatch([
      item({ amount: '0.1' }),
      item({ amount: '0.2' }),
    ]);

    expect(estimate.totalAmount).toBe('0.3000000');
  });

  it('excludes invalid addresses from totals and counts them', () => {
    const estimate = estimateBatch([
      item({ amount: '100' }),
      item({ amount: '999', recipient: INVALID }),
    ]);

    expect(estimate.invalidAddressCount).toBe(1);
    expect(estimate.byAsset).toEqual({ XLM: '100.0000000' });
    expect(estimate.totalPayments).toBe(2);
  });

  it('reports no total when every address is invalid', () => {
    const estimate = estimateBatch([item({ recipient: INVALID })]);

    expect(estimate.invalidAddressCount).toBe(1);
    expect(estimate.totalAmount).toBeNull();
    expect(estimate.byAsset).toEqual({});
  });

  it('counts duplicate recipient/asset pairs', () => {
    const estimate = estimateBatch([item(), item({ amount: '5' })]);

    expect(estimate.duplicateCount).toBe(1);
  });

  it('scales the gas and duration estimates with batch size', () => {
    const payments = Array.from({ length: 10 }, () => item());
    const estimate = estimateBatch(payments);

    expect(estimate.estimatedGasUnits).toBe(10 * 100 + 100);
    expect(estimate.estimatedDurationMs).toBe(10 * 50 + 500);
  });
});

describe('executeBatch', () => {
  it('completes a batch where every address is valid', () => {
    const record = executeBatch([item({ amount: '100' })], 'payroll');

    expect(record.status).toBe('completed');
    expect(record.total).toBe(1);
    expect(record.succeeded).toBe(1);
    expect(record.failed).toBe(0);
    expect(record.label).toBe('payroll');
  });

  it('attaches a transaction hash to each successful payment', () => {
    const record = executeBatch([item()]);

    expect(record.results[0].txHash).toMatch(/^tx_[0-9a-f]{32}$/);
  });

  it('reports partial failure when some addresses are invalid', () => {
    const record = executeBatch([item(), item({ recipient: INVALID })]);

    expect(record.status).toBe('partial_failure');
    expect(record.succeeded).toBe(1);
    expect(record.failed).toBe(1);
    expect(record.results[1].error).toBe('Invalid Stellar address');
  });

  it('fails the whole batch when no address is valid', () => {
    const record = executeBatch([item({ recipient: INVALID })]);

    expect(record.status).toBe('failed');
    expect(record.succeeded).toBe(0);
  });

  it('stores the record so it can be fetched by id', () => {
    const record = executeBatch([item()]);

    expect(getBatch(record.id)).toEqual(record);
  });
});

describe('rollbackBatch', () => {
  it('returns undefined for an unknown batch', () => {
    expect(rollbackBatch('batch_does_not_exist')).toBeUndefined();
  });

  it('rolls back every successful payment in a completed batch', () => {
    const record = executeBatch([item({ recipient: VALID_A }), item({ recipient: VALID_B })]);
    const result = rollbackBatch(record.id);

    expect(result?.status).toBe('fully_rolled_back');
    expect(result?.rolledBackPayments).toEqual([VALID_A, VALID_B]);
  });

  it('marks rolled back payments as failed with a reason', () => {
    const record = executeBatch([item()]);
    rollbackBatch(record.id);

    const updated = getBatch(record.id)!;
    expect(updated.status).toBe('completed');
    expect(updated.results[0].status).toBe('failed');
    expect(updated.results[0].error).toBe('rolled back');
  });

  it('does not claim a rollback for a batch that never succeeded', () => {
    const record = executeBatch([item({ recipient: INVALID })]);
    const result = rollbackBatch(record.id);

    expect(result?.rolledBackPayments).toEqual([]);
    expect(result?.status).toBe('fully_rolled_back');
  });
});
