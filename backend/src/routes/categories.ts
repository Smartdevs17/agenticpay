import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { 
  PAYMENT_CATEGORIES, 
  getPaymentCategory, 
  overrideCategory, 
  getCategoryAnalytics, 
  getCategoryTrends,
  PaymentCategory
} from '../services/categories.js';

export const categoriesRouter = Router();

// Get all available categories
categoriesRouter.get('/definitions', (req, res) => {
  res.json({ categories: PAYMENT_CATEGORIES });
});

// Manual override for a payment category
categoriesRouter.post('/override', asyncHandler(async (req, res) => {
  const { paymentId, category } = req.body;
  
  if (!paymentId || !category) {
    return res.status(400).json({ error: 'paymentId and category are required' });
  }
  
  if (!PAYMENT_CATEGORIES.includes(category as PaymentCategory)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  
  overrideCategory(paymentId, category as PaymentCategory);
  res.json({ success: true, paymentId, category });
}));

// Bulk categorization override
categoriesRouter.post('/bulk-override', asyncHandler(async (req, res) => {
  const { items } = req.body; // Array of { paymentId, category }
  
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items must be an array' });
  }
  
  items.forEach(item => {
    if (item.paymentId && PAYMENT_CATEGORIES.includes(item.category as PaymentCategory)) {
      overrideCategory(item.paymentId, item.category as PaymentCategory);
    }
  });
  
  res.json({ success: true, count: items.length });
}));

// Get analytics for a list of payments
categoriesRouter.post('/analytics', asyncHandler(async (req, res) => {
  const { payments } = req.body;
  
  if (!Array.isArray(payments)) {
    return res.status(400).json({ error: 'payments must be an array' });
  }
  
  const analytics = getCategoryAnalytics(payments);
  const trends = getCategoryTrends(payments);
  
  res.json({ analytics, trends });
}));

// Export by category
categoriesRouter.post('/export', asyncHandler(async (req, res) => {
  const { payments, category } = req.body;
  
  if (!Array.isArray(payments)) {
    return res.status(400).json({ error: 'payments must be an array' });
  }
  
  const filtered = category && category !== 'all'
    ? payments.filter(p => getPaymentCategory(p.id, p.description || p.projectTitle || '', p.amount, p.type) === category)
    : payments;
    
  // Mocking CSV generation
  const headers = ['ID', 'Date', 'Amount', 'Currency', 'Category', 'Description'];
  const rows = filtered.map(p => [
    p.id,
    p.timestamp,
    p.amount,
    p.currency,
    getPaymentCategory(p.id, p.description || p.projectTitle || '', p.amount, p.type),
    p.description || p.projectTitle || ''
  ]);
  
  const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=payments_${category || 'all'}.csv`);
  res.send(csv);
}));
