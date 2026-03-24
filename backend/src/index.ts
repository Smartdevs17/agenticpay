import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { httpLogger, logger } from './middleware/logger.js';
import { verificationRouter } from './routes/verification.js';
import { invoiceRouter } from './routes/invoice.js';
import { stellarRouter } from './routes/stellar.js';
import { catalogRouter } from './routes/catalog.js';
import { jobsRouter } from './routes/jobs.js';
import { startJobs } from './jobs/index.js';

dotenv.config();

const traceStorage = new AsyncLocalStorage<string>();

const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

function formatMessage(args: any[]): any[] {
  const traceId = traceStorage.getStore();
  if (traceId) {
    if (typeof args[0] === 'string') {
      args[0] = `[TraceID: ${traceId}] ${args[0]}`;
    } else {
      args.unshift(`[TraceID: ${traceId}]`);
    }
  }
  return args;
}

console.log = (...args) => originalConsole.log(...formatMessage(args));
console.info = (...args) => originalConsole.info(...formatMessage(args));
console.warn = (...args) => originalConsole.warn(...formatMessage(args));
console.error = (...args) => originalConsole.error(...formatMessage(args));

const app = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Logging – must be first so every request (incl. rejections) is captured
// ---------------------------------------------------------------------------
app.use(httpLogger);

app.use(cors());
app.use(express.json());

// Trace ID middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const traceId = (req.headers['x-trace-id'] as string) || randomUUID();
  res.setHeader('X-Trace-Id', traceId);

  traceStorage.run(traceId, () => {
    console.log(`${req.method} ${req.url} - Started`);

    res.on('finish', () => {
      console.log(`${req.method} ${req.url} - Finished with status ${res.statusCode}`);
    });

    next();
  });
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
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
app.use('/api/v1/jobs', jobsRouter);

const jobsEnabled = process.env.JOBS_ENABLED !== 'false';
if (jobsEnabled) {
  startJobs();
}

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'AgenticPay backend running');
});

export default app;
