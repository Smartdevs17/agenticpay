import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { verificationRouter } from './routes/verification.js';
import { invoiceRouter } from './routes/invoice.js';
import { stellarRouter } from './routes/stellar.js';
import { catalogRouter } from './routes/catalog.js';
import { jobsRouter } from './routes/jobs.js';
import { healthRouter } from './routes/health.js';
import { startJobs, getJobScheduler } from './jobs/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { generalLimiter, invoiceLimiter } from './middleware/rateLimit.js';

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

const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
  : '*';

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Trace-Id'],
  })
);
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

// Health & Readiness checks
app.use(healthRouter);

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
app.use(notFoundHandler);
app.use(errorHandler);

const jobsEnabled = process.env.JOBS_ENABLED !== 'false';
if (jobsEnabled) {
  startJobs();
}

const server = app.listen(PORT, () => {
  console.log(`AgenticPay backend running on port ${PORT}`);
});

// Graceful shutdown
const shutdown = (signal: string) => {
  console.log(`${signal} received. Starting graceful shutdown...`);

  server.close(() => {
    console.log('HTTP server closed.');

    try {
      const scheduler = getJobScheduler();
      if (scheduler) {
        scheduler.stopAll();
        console.log('Job scheduler stopped.');
      }
    } catch (err) {
      console.error('Error stopping scheduler:', err);
    }

    console.log('Graceful shutdown complete. Exiting.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Could not close connections in time, forceful shutdown');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
