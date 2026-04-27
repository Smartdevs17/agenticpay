import { z } from 'zod';

export const mintReceiptSchema = z.object({
  paymentId: z.string().min(1, 'Payment ID is required'),
  transactionHash: z.string().min(1, 'Transaction hash is required'),
  sender: z.string().min(1, 'Sender address is required'),
  recipient: z.string().min(1, 'Recipient address is required'),
  amount: z.number().positive('Amount must be positive'),
  asset: z.string().min(1, 'Asset is required'),
});

export const batchMintReceiptSchema = z.object({
  receipts: z.array(mintReceiptSchema).min(1, 'At least one receipt is required').max(100),
});

export const transferReceiptSchema = z.object({
  newOwner: z.string().min(1, 'New owner address is required'),
});
