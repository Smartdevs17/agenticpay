import { randomUUID } from 'node:crypto';

export interface ReceiptNFT {
  id: string;
  tokenId: string;
  paymentId: string;
  transactionHash: string;
  sender: string;
  recipient: string;
  amount: number;
  asset: string;
  mintedAt: string;
  owner: string;
  burned: boolean;
  burnedAt?: string;
  metadata: ReceiptMetadata;
}

export interface ReceiptMetadata {
  name: string;
  description: string;
  image: string;
  attributes: Array<{ trait_type: string; value: string | number }>;
  external_url?: string;
}

interface MintReceiptInput {
  paymentId: string;
  transactionHash: string;
  sender: string;
  recipient: string;
  amount: number;
  asset: string;
}

interface BatchMintInput {
  receipts: MintReceiptInput[];
}

const receipts = new Map<string, ReceiptNFT>();
const paymentIndex = new Map<string, string>();
const walletIndex = new Map<string, Set<string>>();
const txHashIndex = new Map<string, string>();

let tokenCounter = 0;

function nextTokenId(): string {
  tokenCounter += 1;
  return `RCPT-${String(tokenCounter).padStart(8, '0')}`;
}

function buildMetadata(receipt: Omit<ReceiptNFT, 'metadata'>): ReceiptMetadata {
  return {
    name: `AgenticPay Receipt #${receipt.tokenId}`,
    description: `Verified payment receipt for transaction ${receipt.transactionHash}`,
    image: `https://receipts.agenticpay.io/nft/${receipt.tokenId}.png`,
    external_url: `https://agenticpay.io/receipts/${receipt.tokenId}`,
    attributes: [
      { trait_type: 'Payment ID', value: receipt.paymentId },
      { trait_type: 'Transaction Hash', value: receipt.transactionHash },
      { trait_type: 'Sender', value: receipt.sender },
      { trait_type: 'Recipient', value: receipt.recipient },
      { trait_type: 'Amount', value: receipt.amount },
      { trait_type: 'Asset', value: receipt.asset },
      { trait_type: 'Minted At', value: receipt.mintedAt },
    ],
  };
}

function indexByWallet(walletAddress: string, tokenId: string): void {
  const existing = walletIndex.get(walletAddress) ?? new Set<string>();
  existing.add(tokenId);
  walletIndex.set(walletAddress, existing);
}

function removeFromWalletIndex(walletAddress: string, tokenId: string): void {
  const existing = walletIndex.get(walletAddress);
  if (existing) {
    existing.delete(tokenId);
  }
}

export function mintReceipt(input: MintReceiptInput): ReceiptNFT {
  if (paymentIndex.has(input.paymentId)) {
    const existing = receipts.get(paymentIndex.get(input.paymentId)!);
    if (existing && !existing.burned) {
      throw new Error(`Receipt already exists for payment ${input.paymentId}`);
    }
  }

  const tokenId = nextTokenId();
  const now = new Date().toISOString();

  const base = {
    id: randomUUID(),
    tokenId,
    paymentId: input.paymentId,
    transactionHash: input.transactionHash,
    sender: input.sender,
    recipient: input.recipient,
    amount: input.amount,
    asset: input.asset,
    mintedAt: now,
    owner: input.recipient,
    burned: false,
  };

  const receipt: ReceiptNFT = { ...base, metadata: buildMetadata(base) };

  receipts.set(tokenId, receipt);
  paymentIndex.set(input.paymentId, tokenId);
  txHashIndex.set(input.transactionHash, tokenId);
  indexByWallet(input.recipient, tokenId);

  return receipt;
}

export function batchMintReceipts(input: BatchMintInput): ReceiptNFT[] {
  return input.receipts.map(mintReceipt);
}

export function transferReceipt(tokenId: string, newOwner: string): ReceiptNFT {
  const receipt = receipts.get(tokenId);
  if (!receipt) throw new Error(`Receipt ${tokenId} not found`);
  if (receipt.burned) throw new Error(`Receipt ${tokenId} is burned and cannot be transferred`);

  removeFromWalletIndex(receipt.owner, tokenId);
  receipt.owner = newOwner;
  indexByWallet(newOwner, tokenId);
  receipts.set(tokenId, receipt);

  return receipt;
}

export function burnReceipt(tokenId: string): ReceiptNFT {
  const receipt = receipts.get(tokenId);
  if (!receipt) throw new Error(`Receipt ${tokenId} not found`);
  if (receipt.burned) throw new Error(`Receipt ${tokenId} is already burned`);

  receipt.burned = true;
  receipt.burnedAt = new Date().toISOString();
  removeFromWalletIndex(receipt.owner, tokenId);
  receipts.set(tokenId, receipt);

  return receipt;
}

export function getReceiptByTokenId(tokenId: string): ReceiptNFT | undefined {
  return receipts.get(tokenId);
}

export function getReceiptByPaymentId(paymentId: string): ReceiptNFT | undefined {
  const tokenId = paymentIndex.get(paymentId);
  return tokenId ? receipts.get(tokenId) : undefined;
}

export function getReceiptByTxHash(txHash: string): ReceiptNFT | undefined {
  const tokenId = txHashIndex.get(txHash);
  return tokenId ? receipts.get(tokenId) : undefined;
}

export function getReceiptsByWallet(walletAddress: string): ReceiptNFT[] {
  const tokenIds = walletIndex.get(walletAddress) ?? new Set<string>();
  return Array.from(tokenIds)
    .map((id) => receipts.get(id))
    .filter((r): r is ReceiptNFT => r !== undefined);
}

export function getAllReceipts(includesBurned = false): ReceiptNFT[] {
  const all = Array.from(receipts.values());
  return includesBurned ? all : all.filter((r) => !r.burned);
}
