import { Request, Router } from 'express';
import { validate } from '../middleware/validate.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { idempotency } from '../middleware/idempotency.js';
import { cacheControl, CacheTTL } from '../middleware/cache.js';
import { authMiddleware } from '../middleware/auth.js';
import { auditService } from '../services/auditService.js';
import { logger } from '../utils/logger.js';
import {
  createReceiptDownloadGrant,
  verifyReceiptDownloadGrant,
  ReceiptDownloadError,
  mintReceipt,
  batchMintReceipts,
  transferReceipt,
  burnReceipt,
  getReceiptByTokenId,
  getReceiptByPaymentId,
  getReceiptByTxHash,
  getReceiptsByWallet,
  getAllReceipts,
  verifyReceiptProof,
  getReceiptByMerkleRoot,
  searchReceipts,
  archiveReceipts,
  generateReceiptPdf,
} from '../services/receipts.js';
import {
  archiveReceiptSchema,
  mintReceiptSchema,
  batchMintReceiptSchema,
  transferReceiptSchema,
} from '../schemas/receipts.js';

export const receiptsRouter = Router();

receiptsRouter.post(
  '/mint',
  idempotency(),
  validate(mintReceiptSchema),
  asyncHandler(async (req, res) => {
    const receipt = mintReceipt(req.body);
    res.status(201).json(receipt);
  })
);

receiptsRouter.post(
  '/mint/batch',
  idempotency(),
  validate(batchMintReceiptSchema),
  asyncHandler(async (req, res) => {
    const results = batchMintReceipts({ receipts: req.body.receipts });
    res.status(201).json({ receipts: results, count: results.length });
  })
);

receiptsRouter.patch(
  '/:tokenId/transfer',
  validate(transferReceiptSchema),
  asyncHandler(async (req, res) => {
    const { tokenId } = req.params;
    const { newOwner } = req.body as { newOwner: string };
    try {
      const receipt = transferReceipt(tokenId, newOwner);
      res.json(receipt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transfer failed';
      throw new AppError(400, msg, 'TRANSFER_FAILED');
    }
  })
);

receiptsRouter.delete(
  '/:tokenId/burn',
  asyncHandler(async (req, res) => {
    const { tokenId } = req.params;
    try {
      const receipt = burnReceipt(tokenId);
      res.json({ message: 'Receipt burned', receipt });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Burn failed';
      throw new AppError(400, msg, 'BURN_FAILED');
    }
  })
);

receiptsRouter.get(
  '/search',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    res.json(searchReceipts({
      paymentId: req.query.paymentId as string | undefined,
      txHash: req.query.txHash as string | undefined,
      wallet: req.query.wallet as string | undefined,
      currency: req.query.currency as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      includeArchived: req.query.includeArchived === 'true',
    }));
  })
);

receiptsRouter.post(
  '/archive',
  validate(archiveReceiptSchema),
  asyncHandler(async (req, res) => {
    const archived = archiveReceipts(req.body.retentionBefore);
    res.json({ archived, count: archived.length });
  })
);

receiptsRouter.get(
  '/',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const includeBurned = req.query.includeBurned === 'true';
    res.json(getAllReceipts(includeBurned));
  })
);

receiptsRouter.get(
  '/by-payment/:paymentId',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const receipt = getReceiptByPaymentId(req.params.paymentId);
    if (!receipt) throw new AppError(404, 'Receipt not found', 'NOT_FOUND');
    res.json(receipt);
  })
);

receiptsRouter.get(
  '/by-root/:root',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const receipt = getReceiptByMerkleRoot(req.params.root);
    if (!receipt) throw new AppError(404, 'Receipt not found', 'NOT_FOUND');
    res.json(receipt);
  })
);

receiptsRouter.get(
  '/by-tx/:txHash',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const receipt = getReceiptByTxHash(req.params.txHash);
    if (!receipt) throw new AppError(404, 'Receipt not found', 'NOT_FOUND');
    res.json(receipt);
  })
);

receiptsRouter.get(
  '/by-wallet/:walletAddress',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    res.json(getReceiptsByWallet(req.params.walletAddress));
  })
);

receiptsRouter.get(
  '/:tokenId',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const receipt = getReceiptByTokenId(req.params.tokenId);
    if (!receipt) throw new AppError(404, 'Receipt not found', 'NOT_FOUND');
    res.json(receipt);
  })
);

receiptsRouter.get(
  '/:tokenId/verify',
  cacheControl({ maxAge: CacheTTL.SHORT }),
  asyncHandler(async (req, res) => {
    const receipt = getReceiptByTokenId(req.params.tokenId);
    if (!receipt) throw new AppError(404, 'Receipt not found', 'NOT_FOUND');
    res.json({
      tokenId: receipt.tokenId,
      merkleRoot: receipt.merkleRoot,
      valid: verifyReceiptProof(receipt),
      proof: receipt.merkleProof,
    });
  })
);

/**
 * Issue a time-bounded PDF link for one receipt. The grant is bound to the
 * authenticated caller and every issuance is audited.
 */
receiptsRouter.post(
  '/:tokenId/download-url',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const tokenId = String(req.params.tokenId);
    const userId = req.user!.id;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const unknownKeys = Object.keys(body).filter((key) => key !== 'ttlSeconds');
    if (unknownKeys.length > 0 || (body.ttlSeconds !== undefined && typeof body.ttlSeconds !== 'number')) {
      throw new AppError(400, 'Request body accepts only an optional numeric ttlSeconds', 'INVALID_DOWNLOAD_REQUEST');
    }
    let grant;
    try {
      grant = createReceiptDownloadGrant({ tokenId, userId, ttlSeconds: body.ttlSeconds as number | undefined });
    } catch (err) {
      if (err instanceof ReceiptDownloadError && err.code === 'NOT_FOUND') {
        throw new AppError(404, 'Receipt not found', 'NOT_FOUND');
      }
      if (err instanceof ReceiptDownloadError) throw new AppError(400, err.message, 'INVALID_DOWNLOAD_REQUEST');
      throw err;
    }

    const query = new URLSearchParams({
      uid: grant.userId,
      iat: String(grant.iat),
      expires: String(grant.expires),
      sig: grant.sig,
    });
    await auditReceiptDownload(req, { tokenId, userId, action: 'receipt.download_url_issued', outcome: 'success', status: 201 });
    res.status(201).json({
      url: `${req.baseUrl}/${encodeURIComponent(tokenId)}/pdf?${query.toString()}`,
      expiresAt: new Date(grant.expires).toISOString(),
    });
  })
);

/**
 * Download a receipt PDF. Requires a grant issued by `download-url`. Every
 * attempt, successful or not, is written to the audit log against the user
 * named in the grant.
 */
receiptsRouter.get(
  '/:tokenId/pdf',
  asyncHandler(async (req, res) => {
    const tokenId = String(req.params.tokenId);
    const uid = typeof req.query.uid === 'string' ? req.query.uid : '';
    const iat = Number(req.query.iat);
    const expires = Number(req.query.expires);
    const sig = typeof req.query.sig === 'string' ? req.query.sig : '';

    let receipt;
    try {
      receipt = verifyReceiptDownloadGrant({ tokenId, userId: uid, iat, expires, sig });
    } catch (err) {
      if (err instanceof ReceiptDownloadError) {
        const status = err.code === 'NOT_FOUND' ? 404 : 401;
        await auditReceiptDownload(req, {
          tokenId,
          userId: uid || undefined,
          action: 'receipt.download',
          outcome: 'failure',
          status,
          reason: err.code,
        });
        throw new AppError(status, err.message, `RECEIPT_DOWNLOAD_${err.code}`);
      }
      throw err;
    }

    const pdf = generateReceiptPdf(receipt);
    await auditReceiptDownload(req, { tokenId, userId: uid, action: 'receipt.download', outcome: 'success', status: 200 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${receipt.tokenId}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  })
);

/** Per-user audit entry for receipt download activity. */
async function auditReceiptDownload(
  req: Request,
  params: {
    tokenId: string;
    userId?: string;
    action: 'receipt.download' | 'receipt.download_url_issued';
    outcome: 'success' | 'failure';
    status: number;
    reason?: ReceiptDownloadError['code'];
  }
): Promise<void> {
  await auditService.logAction({
    userId: params.userId || undefined,
    action: params.action,
    resource: 'receipt',
    resourceId: params.tokenId,
    outcome: params.outcome,
    details: params.reason ? { reason: params.reason } : undefined,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    request: { method: req.method, path: req.path },
    response: { status: params.status },
  });
  logger.info(
    JSON.stringify({
      event: params.action,
      outcome: params.outcome,
      status: params.status,
      ...(params.reason ? { reason: params.reason } : {}),
    })
  );
}

receiptsRouter.get(
  '/:tokenId/metadata',
  cacheControl({ maxAge: CacheTTL.LONG }),
  asyncHandler(async (req, res) => {
    const receipt = getReceiptByTokenId(req.params.tokenId);
    if (!receipt) throw new AppError(404, 'Receipt not found', 'NOT_FOUND');
    res.json(receipt.metadata);
  })
);
