import { z } from 'zod';

const gasOperation = z.enum([
  'splitPayment',
  'setRecipient',
  'setPlatformFeeBps',
  'withdraw',
  'batchTransfer',
  'erc20Transfer',
  'erc20TransferFrom',
  'erc20Approve',
  'erc20BatchTransfer',
  'erc20Mint',
  'erc20Burn',
  'metaTxExecute',
  'eip7702Execute',
  'eip7702ExecuteWithAuth',
]);

export const estimateSchema = z.object({
  operation: gasOperation,
  itemCount: z.number().int().min(0).max(1000).optional(),
  calldataBytes: z.number().int().min(0).max(128_000).optional(),
  calldataNonZeroRatio: z.number().min(0).max(1).optional(),
  fee: z
    .object({
      baseFeeGwei: z.number().min(0).max(100_000),
      priorityFeeGwei: z.number().min(0).max(100_000).optional(),
    })
    .optional(),
});

export const batchEstimateSchema = z.object({
  operation: gasOperation,
  itemCount: z.number().int().min(1).max(1000),
  calldataBytes: z.number().int().min(0).max(128_000).optional(),
});

export const metaTxEstimateSchema = z.object({
  innerOperation: gasOperation,
  innerItemCount: z.number().int().min(0).max(1000).optional(),
  innerCalldataBytes: z.number().int().min(0).max(128_000).optional(),
  channel: z.enum(['forwarder', 'eip7702']),
});

export type EstimateInput = z.infer<typeof estimateSchema>;
export type BatchEstimateInput = z.infer<typeof batchEstimateSchema>;
export type MetaTxEstimateInput = z.infer<typeof metaTxEstimateSchema>;
