import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendEvent } from '../events/event-store.js';
import { publish } from '../events/event-bus.js';
import { logger } from '../utils/logger.js';

export interface ReceiptNFT {
  id: string;
  tokenId: string;
  paymentId: string;
  transactionHash: string;
  sender: string;
  recipient: string;
  amount: number;
  asset: string;
  currency: string;
  timestamp: string;
  merkleRoot: string;
  merkleProof: MerkleProofNode[];
  archived: boolean;
  archivedAt?: string;
  retentionUntil?: string;
  mintedAt: string;
  owner: string;
  burned: boolean;
  burnedAt?: string;
  metadata: ReceiptMetadata;
}

export interface MerkleProofNode {
  position: 'left' | 'right';
  hash: string;
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
  asset?: string;
  currency?: string;
  timestamp?: string;
  retentionUntil?: string;
}

interface BatchMintInput {
  receipts: MintReceiptInput[];
}

const receipts = new Map<string, ReceiptNFT>();
const paymentIndex = new Map<string, string>();
const walletIndex = new Map<string, Set<string>>();
const txHashIndex = new Map<string, string>();
const receiptRootIndex = new Map<string, string>();

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
      { trait_type: 'Currency', value: receipt.currency },
      { trait_type: 'Minted At', value: receipt.mintedAt },
      { trait_type: 'Merkle Root', value: receipt.merkleRoot },
    ],
  };
}

function hashReceiptField(value: string | number): string {
  return createHash('sha256').update(String(value)).digest('hex');
}

function hashPair(left: string, right: string): string {
  return createHash('sha256').update(`${left}:${right}`).digest('hex');
}

function buildReceiptProof(fields: Array<string | number>): { root: string; proof: MerkleProofNode[] } {
  let layer = fields.map(hashReceiptField);
  let index = 0;
  const proof: MerkleProofNode[] = [];

  while (layer.length > 1) {
    if (layer.length % 2 === 1) layer.push(layer[layer.length - 1]);
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    proof.push({
      position: index % 2 === 0 ? 'right' : 'left',
      hash: layer[siblingIndex],
    });

    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(hashPair(layer[i], layer[i + 1]));
    }
    index = Math.floor(index / 2);
    layer = next;
  }

  return { root: layer[0], proof };
}

export function verifyReceiptProof(receipt: ReceiptNFT): boolean {
  const leaf = hashReceiptField(receipt.paymentId);
  const root = receipt.merkleProof.reduce((acc, node) => {
    return node.position === 'left' ? hashPair(node.hash, acc) : hashPair(acc, node.hash);
  }, leaf);

  return root === receipt.merkleRoot;
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
  const now = input.timestamp ?? new Date().toISOString();
  const currency = input.currency ?? input.asset ?? 'USD';
  const proof = buildReceiptProof([
    input.paymentId,
    input.transactionHash,
    input.sender,
    input.recipient,
    input.amount,
    currency,
    now,
  ]);

  const base = {
    id: randomUUID(),
    tokenId,
    paymentId: input.paymentId,
    transactionHash: input.transactionHash,
    sender: input.sender,
    recipient: input.recipient,
    amount: input.amount,
    asset: currency,
    currency,
    timestamp: now,
    merkleRoot: proof.root,
    merkleProof: proof.proof,
    archived: false,
    retentionUntil: input.retentionUntil,
    mintedAt: now,
    owner: input.recipient,
    burned: false,
  };

  const receipt: ReceiptNFT = { ...base, metadata: buildMetadata(base) };

  receipts.set(tokenId, receipt);
  paymentIndex.set(input.paymentId, tokenId);
  txHashIndex.set(input.transactionHash, tokenId);
  receiptRootIndex.set(receipt.merkleRoot, tokenId);
  indexByWallet(input.recipient, tokenId);

  const event = appendEvent('receipt', tokenId, 'receipt.minted', {
    tokenId,
    paymentId: receipt.paymentId,
    sender: receipt.sender,
    recipient: receipt.recipient,
    amount: receipt.amount,
    asset: receipt.currency,
    merkleRoot: receipt.merkleRoot,
  });
  void publish(event);

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

  const event = appendEvent('receipt', tokenId, 'receipt.burned', { tokenId });
  void publish(event);

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

export function searchReceipts(query: {
  paymentId?: string;
  txHash?: string;
  wallet?: string;
  currency?: string;
  from?: string;
  to?: string;
  includeArchived?: boolean;
}): ReceiptNFT[] {
  const fromMs = query.from ? Date.parse(query.from) : undefined;
  const toMs = query.to ? Date.parse(query.to) : undefined;

  return getAllReceipts(false).filter((receipt) => {
    if (!query.includeArchived && receipt.archived) return false;
    if (query.paymentId && receipt.paymentId !== query.paymentId) return false;
    if (query.txHash && receipt.transactionHash !== query.txHash) return false;
    if (query.wallet && receipt.sender !== query.wallet && receipt.recipient !== query.wallet && receipt.owner !== query.wallet) return false;
    if (query.currency && receipt.currency !== query.currency) return false;

    const timestampMs = Date.parse(receipt.timestamp);
    if (fromMs !== undefined && timestampMs < fromMs) return false;
    if (toMs !== undefined && timestampMs > toMs) return false;
    return true;
  });
}

export function getReceiptByMerkleRoot(root: string): ReceiptNFT | undefined {
  const tokenId = receiptRootIndex.get(root);
  return tokenId ? receipts.get(tokenId) : undefined;
}

export function archiveReceipts(retentionBefore: string): ReceiptNFT[] {
  const cutoff = Date.parse(retentionBefore);
  const archived: ReceiptNFT[] = [];

  for (const receipt of receipts.values()) {
    const retentionMs = receipt.retentionUntil ? Date.parse(receipt.retentionUntil) : undefined;
    const timestampMs = Date.parse(receipt.timestamp);
    if (receipt.archived) continue;
    if ((retentionMs !== undefined && retentionMs <= cutoff) || timestampMs <= cutoff) {
      receipt.archived = true;
      receipt.archivedAt = new Date().toISOString();
      receipts.set(receipt.tokenId, receipt);
      archived.push(receipt);
    }
  }

  return archived;
}

export function generateReceiptPdf(receipt: ReceiptNFT): Buffer {
  const lines = [
    'AgenticPay Payment Receipt',
    `Receipt: ${receipt.tokenId}`,
    `Payment: ${receipt.paymentId}`,
    `Amount: ${receipt.amount} ${receipt.currency}`,
    `Sender: ${receipt.sender}`,
    `Recipient: ${receipt.recipient}`,
    `Transaction: ${receipt.transactionHash}`,
    `Timestamp: ${receipt.timestamp}`,
    `Merkle Root: ${receipt.merkleRoot}`,
  ];
  const escaped = lines.join('\\n').replace(/[()]/g, '');
  const content = `BT /F1 12 Tf 72 760 Td (${escaped}) Tj ET`;
  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj
4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
5 0 obj << /Length ${content.length} >> stream
${content}
endstream endobj
xref
0 6
0000000000 65535 f
trailer << /Root 1 0 R /Size 6 >>
%%EOF`;

  return Buffer.from(pdf);
}

// ---------------------------------------------------------------------------
// Signed, time-bounded receipt downloads — issue #1494
// ---------------------------------------------------------------------------

/** Longest lifetime a download grant may ever have. */
export const RECEIPT_DOWNLOAD_MAX_TTL_SECONDS = 15 * 60;
export const RECEIPT_DOWNLOAD_DEFAULT_TTL_SECONDS = 5 * 60;
/** Tolerated clock skew for an `iat` slightly in the future. */
const DOWNLOAD_CLOCK_SKEW_MS = 30 * 1000;

export type ReceiptDownloadErrorCode = 'NOT_FOUND' | 'INVALID' | 'EXPIRED' | 'TTL_EXCEEDED';

export class ReceiptDownloadError extends Error {
  constructor(public readonly code: ReceiptDownloadErrorCode, message: string) {
    super(message);
    this.name = 'ReceiptDownloadError';
  }
}

export interface ReceiptDownloadGrant {
  tokenId: string;
  userId: string;
  /** Issued-at, Unix milliseconds. */
  iat: number;
  /** Expiry, Unix milliseconds. */
  expires: number;
  /** Hex HMAC-SHA256 over the grant fields. */
  sig: string;
}

let ephemeralDownloadSecret: string | undefined;

/**
 * HMAC key for download grants. Production must set RECEIPT_DOWNLOAD_SECRET,
 * so grants stay valid across restarts and instances. Other environments
 * fall back to a per-process secret, which invalidates grants on restart.
 */
function downloadSecret(): string {
  const configured = process.env.RECEIPT_DOWNLOAD_SECRET;
  if (configured) {
    if (configured.length < 32) throw new Error('RECEIPT_DOWNLOAD_SECRET must be at least 32 characters');
    return configured;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('RECEIPT_DOWNLOAD_SECRET is required in production');
  }
  if (!ephemeralDownloadSecret) {
    ephemeralDownloadSecret = randomBytes(32).toString('hex');
    logger.warn(JSON.stringify({ event: 'receipt.download_secret_ephemeral' }));
  }
  return ephemeralDownloadSecret;
}

function grantPayload(tokenId: string, userId: string, iat: number, expires: number): string {
  return ['RECEIPT-DL-V1', tokenId, userId, String(iat), String(expires)].join('\n');
}

function computeGrantSignature(tokenId: string, userId: string, iat: number, expires: number): string {
  return createHmac('sha256', downloadSecret()).update(grantPayload(tokenId, userId, iat, expires), 'utf8').digest('hex');
}

/**
 * Issue a download grant for one receipt to one user. The lifetime is
 * capped at RECEIPT_DOWNLOAD_MAX_TTL_SECONDS.
 */
export function createReceiptDownloadGrant(input: {
  tokenId: string;
  userId: string;
  ttlSeconds?: number;
  now?: number;
}): ReceiptDownloadGrant {
  if (!input.userId) throw new ReceiptDownloadError('INVALID', 'A user is required to issue a download grant');
  const ttl = input.ttlSeconds ?? RECEIPT_DOWNLOAD_DEFAULT_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > RECEIPT_DOWNLOAD_MAX_TTL_SECONDS) {
    throw new ReceiptDownloadError(
      'TTL_EXCEEDED',
      `ttlSeconds must be an integer between 1 and ${RECEIPT_DOWNLOAD_MAX_TTL_SECONDS}`
    );
  }
  if (!receipts.has(input.tokenId)) throw new ReceiptDownloadError('NOT_FOUND', 'Receipt not found');

  const iat = input.now ?? Date.now();
  const expires = iat + ttl * 1000;
  return {
    tokenId: input.tokenId,
    userId: input.userId,
    iat,
    expires,
    sig: computeGrantSignature(input.tokenId, input.userId, iat, expires),
  };
}

/**
 * Verify a download grant. Checks run in this order: signature, lifetime
 * bound, issued-at not in the future, expiry, then receipt existence. The
 * signature check comes first so a forged request learns nothing about
 * timing or existence.
 */
export function verifyReceiptDownloadGrant(input: {
  tokenId: string;
  userId: string;
  iat: number;
  expires: number;
  sig: string;
  now?: number;
}): ReceiptNFT {
  const { tokenId, userId, iat, expires, sig } = input;
  const invalid = () => new ReceiptDownloadError('INVALID', 'Download link is invalid');

  if (!userId || !Number.isSafeInteger(iat) || !Number.isSafeInteger(expires)) throw invalid();
  if (!/^[0-9a-f]{64}$/.test(sig)) throw invalid();

  const expected = Buffer.from(computeGrantSignature(tokenId, userId, iat, expires), 'hex');
  const provided = Buffer.from(sig, 'hex');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw invalid();

  if (expires <= iat || expires - iat > RECEIPT_DOWNLOAD_MAX_TTL_SECONDS * 1000) {
    throw new ReceiptDownloadError('TTL_EXCEEDED', 'Download link lifetime is out of bounds');
  }

  const now = input.now ?? Date.now();
  if (iat > now + DOWNLOAD_CLOCK_SKEW_MS) throw invalid();
  if (now >= expires) throw new ReceiptDownloadError('EXPIRED', 'Download link has expired');

  const receipt = receipts.get(tokenId);
  if (!receipt) throw new ReceiptDownloadError('NOT_FOUND', 'Receipt not found');
  return receipt;
}
