import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { httpLogger, logger } from './middleware/logger.js';
import { verificationRouter } from './routes/verification.js';
import { invoiceRouter } from './routes/invoice.js';
import { stellarRouter } from './routes/stellar.js';
import { catalogRouter } from './routes/catalog.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Must be first so every request is captured before other middleware runs
app.use(httpLogger);

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'agenticpay-backend' });
});

// API routes
app.use('/api/v1/verification', verificationRouter);
app.use('/api/v1/invoice', invoiceRouter);
app.use('/api/v1/stellar', stellarRouter);
app.use('/api/v1/catalog', catalogRouter);

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'AgenticPay backend running');
});

export default app;
