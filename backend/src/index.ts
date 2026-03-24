import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { httpLogger, logger } from './middleware/logger.js';
import { verificationRouter } from './routes/verification.js';
import { invoiceRouter } from './routes/invoice.js';
import { stellarRouter } from './routes/stellar.js';
import { catalogRouter } from './routes/catalog.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Logging – must be first so every request (incl. rejections) is captured
// ---------------------------------------------------------------------------
app.use(httpLogger);

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * General limiter – applied to every /api/* route.
 * 100 requests per 15 minutes per IP.
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100,               // max requests per window
  standardHeaders: 'draft-7', // RateLimit-* headers (RFC draft 7)
  legacyHeaders: false,       // disable X-RateLimit-* legacy headers
  message: {
    error: 'Too Many Requests',
    message: 'You have exceeded the 100 requests per 15 minutes limit. Please try again later.',
  },
});

/**
 * Strict limiter – applied to invoice (write-heavy) routes.
 * 20 requests per 15 minutes per IP.
 */
const invoiceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too Many Requests',
    message: 'You have exceeded the 20 invoice requests per 15 minutes limit. Please try again later.',
  },
});

// Health check – intentionally outside rate limiting
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'agenticpay-backend' });
});

// Apply general limiter to all API routes
app.use('/api/', generalLimiter);

// Apply stricter limiter specifically to invoice routes
app.use('/api/v1/invoice', invoiceLimiter);

// API routes
app.use('/api/v1/verification', verificationRouter);
app.use('/api/v1/invoice', invoiceRouter);
app.use('/api/v1/stellar', stellarRouter);
app.use('/api/v1/catalog', catalogRouter);

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'AgenticPay backend running');
});

export default app;
