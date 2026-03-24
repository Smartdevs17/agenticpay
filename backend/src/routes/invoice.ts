import { Router } from 'express';
import { generateInvoice } from '../services/invoice.js';
import { idempotency } from '../middleware/idempotency.js';

export const invoiceRouter = Router();

// AI-powered invoice generation
invoiceRouter.post('/generate', idempotency(), async (req, res) => {
  try {
    const { projectId, workDescription, hoursWorked, hourlyRate } = req.body;

    if (!projectId || !workDescription) {
      res.status(400).json({ message: 'Missing required fields' });
      return;
    }

    const invoice = await generateInvoice({
      projectId,
      workDescription,
      hoursWorked: hoursWorked || 0,
      hourlyRate: hourlyRate || 0,
    });

    res.json(invoice);
  } catch (error) {
    console.error('Invoice generation error:', error);
    res.status(500).json({ message: 'Invoice generation failed' });
  }
});
