import { Router } from 'express';
import { generateInvoice } from '../services/invoice.js';
import { idempotency } from '../middleware/idempotency.js';
import { validate } from '../middleware/validate.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { invoiceSchema } from '../schemas/index.js';

export const invoiceRouter = Router();

// AI-powered invoice generation
invoiceRouter.post(
  '/generate',
  idempotency(),
  validate(invoiceSchema),
  asyncHandler(async (req, res) => {
    const { projectId, workDescription, hoursWorked, hourlyRate } = req.body;

    if (!projectId || !workDescription) {
      throw new AppError(400, 'Missing required fields', 'VALIDATION_ERROR');
    }

    const invoice = await generateInvoice({
      projectId,
      workDescription,
      hoursWorked: hoursWorked || 0,
      hourlyRate: hourlyRate || 0,
    });

    res.json(invoice);
  })
);
