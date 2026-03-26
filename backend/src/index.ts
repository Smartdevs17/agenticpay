import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import { verificationRouter } from './routes/verification.js';
import { invoiceRouter } from './routes/invoice.js';
import { stellarRouter } from './routes/stellar.js';



const app = express();
const PORT = process.env.PORT || 3001;

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

app.listen(PORT, () => {
  console.log(`AgenticPay backend running on port ${PORT}`);
});

export default app;
