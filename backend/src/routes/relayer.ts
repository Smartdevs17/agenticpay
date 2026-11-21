import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { relayTransaction, RelayError } from '../relayer/relay.js';
import { getRelayerHealth, estimateGas } from '../relayer/health.js';
import { relayRequestSchema } from '../relayer/schema.js';
import {
  relayEVMTransaction,
  EVMRelayError,
  getForwarderNonce,
  type EVMRelayRequest,
} from '../relayer/evmRelay.js';
import { generateGasQuote, isQuoteValid, type EVMGasQuote } from '../relayer/gasOracle.js';

export const relayerRouter = Router();

/**
 * POST /api/v1/relayer/relay
 * Submit a gasless transaction using an off-chain authorization token.
 */
relayerRouter.post(
  '/relay',
  validate(relayRequestSchema),
  asyncHandler(async (req, res) => {
    try {
      const result = await relayTransaction(req.body);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      if (err instanceof RelayError) {
        res.status(err.statusCode).json({
          success: false,
          error: { code: err.code, message: err.message },
        });
        return;
      }
      throw err;
    }
  })
);

/**
 * GET /api/v1/relayer/health
 * Returns relayer health status and balance.
 */
relayerRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const relayerAddress = process.env.RELAYER_PUBLIC_KEY;
    const health = await getRelayerHealth(relayerAddress);
    const statusCode = health.status === 'unavailable' ? 503 : 200;
    res.status(statusCode).json({ success: true, data: health });
  })
);

/**
 * GET /api/v1/relayer/estimate
 * Returns current gas/fee estimate for a relayed transaction.
 */
relayerRouter.get(
  '/estimate',
  asyncHandler(async (_req, res) => {
    const estimate = estimateGas();
    res.json({ success: true, data: estimate });
  })
);

// ── EVM Relay Endpoints ──────────────────────────────────────────────────────

const evmForwardRequestSchema = z.object({
  from: z.string().min(42).max(42),
  to: z.string().min(42).max(42),
  value: z.string(),
  gas: z.string(),
  nonce: z.string(),
  deadline: z.number().int().positive(),
  data: z.string(),
});

const evmRelayRequestSchema = z.object({
  request: evmForwardRequestSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, 'Signature must be 65-byte hex with 0x prefix'),
  chainId: z.number().int().positive(),
  feeToken: z.string().min(42).max(42).optional(),
});

const evmGasQuoteQuerySchema = z.object({
  chainId: z.coerce.number().int().positive(),
  gasLimit: z.coerce.number().int().positive().default(200_000),
  token: z.string().min(42).max(42).optional(),
});

/**
 * POST /api/v1/relayer/evm/relay
 * Submit an EVM meta-transaction via the MetaTxForwarder.
 */
relayerRouter.post(
  '/evm/relay',
  validate(evmRelayRequestSchema),
  asyncHandler(async (req, res) => {
    try {
      const rpcUrl = process.env.EVM_RPC_URL ?? 'https://ethereum-rpc.publicnode.com';
      const forwarderAddress = process.env.EVM_FORWARDER_ADDRESS ?? '';
      const relayerPrivateKey = process.env.EVM_RELAYER_PRIVATE_KEY;

      if (!forwarderAddress) {
        throw new AppError(503, 'EVM forwarder address not configured');
      }

      const body = req.body as z.infer<typeof evmRelayRequestSchema>;
      const evmRequest: EVMRelayRequest = {
        request: {
          from: body.request.from,
          to: body.request.to,
          value: BigInt(body.request.value),
          gas: BigInt(body.request.gas),
          nonce: BigInt(body.request.nonce),
          deadline: body.request.deadline,
          data: body.request.data,
        },
        signature: body.signature,
        chainId: body.chainId,
        feeToken: body.feeToken,
      };

      const result = await relayEVMTransaction({
        request: evmRequest,
        rpcUrl,
        forwarderAddress,
        relayerPrivateKey,
      });

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      if (err instanceof EVMRelayError) {
        res.status(err.statusCode).json({
          success: false,
          error: { code: err.code, message: err.message },
        });
        return;
      }
      throw err;
    }
  })
);

/**
 * GET /api/v1/relayer/evm/gas-quote
 * Get a gas quote for an EVM meta-transaction.
 */
relayerRouter.get(
  '/evm/gas-quote',
  asyncHandler(async (req, res) => {
    const parsed = evmGasQuoteQuerySchema.parse(req.query);
    const rpcUrl = process.env.EVM_RPC_URL ?? 'https://ethereum-rpc.publicnode.com';

    const quote = await generateGasQuote({
      rpcUrl,
      chainId: parsed.chainId,
      gasLimit: parsed.gasLimit,
      token: parsed.token,
      ttlSeconds: 300,
    });

    res.json({
      success: true,
      data: {
        baseFee: quote.baseFee.toString(),
        priorityFee: quote.priorityFee.toString(),
        maxFeePerGas: quote.maxFeePerGas.toString(),
        estimatedGasCostWei: quote.estimatedGasCostWei.toString(),
        tokenFee: quote.tokenFee?.toString(),
        token: quote.token,
        validUntil: quote.validUntil,
      },
    });
  })
);

/**
 * GET /api/v1/relayer/evm/nonce/:address
 * Get the current forwarder nonce for an address.
 */
relayerRouter.get(
  '/evm/nonce/:address',
  asyncHandler(async (req, res) => {
    const { address } = req.params;
    const rpcUrl = process.env.EVM_RPC_URL ?? 'https://ethereum-rpc.publicnode.com';
    const forwarderAddress = process.env.EVM_FORWARDER_ADDRESS ?? '';

    if (!forwarderAddress) {
      throw new AppError(503, 'EVM forwarder address not configured');
    }

    const nonce = await getForwarderNonce({ rpcUrl, forwarderAddress, userAddress: address });
    res.json({ success: true, data: { address, nonce } });
  })
);
