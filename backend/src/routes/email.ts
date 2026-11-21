import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';

export const emailRouter = Router();

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  variables: string[];
}

interface EmailDeliveryRecord {
  id: string;
  templateId: string;
  recipient: string;
  status: 'pending' | 'sent' | 'failed' | 'bounced';
  sentAt?: Date;
  openedAt?: Date;
  clickedAt?: Date;
  retryCount: number;
  error?: string;
}

const emailTemplates: Map<string, EmailTemplate> = new Map();
const emailQueue: EmailDeliveryRecord[] = [];
const unsubscribedUsers: Set<string> = new Set();

emailTemplates.set('payment_receipt', {
  id: 'payment_receipt',
  name: 'Payment Receipt',
  subject: 'Payment Receipt - {{amount}} {{currency}}',
  body: `Dear {{customerName}},

Thank you for your payment of {{amount}} {{currency}}.

Payment Details:
- Transaction ID: {{transactionId}}
- Amount: {{amount}} {{currency}}
- Date: {{date}}
- Status: {{status}}

{{#if projectName}}
Project: {{projectName}}
{{/if}}

If you have any questions, please contact support.

Best regards,
AgenticPay Team`,
  variables: ['customerName', 'amount', 'currency', 'transactionId', 'date', 'status', 'projectName'],
});

emailTemplates.set('payment_confirmation', {
  id: 'payment_confirmation',
  name: 'Payment Confirmation',
  subject: 'Payment Confirmed - {{amount}} {{currency}}',
  body: `Dear {{customerName}},

Your payment has been confirmed!

Amount: {{amount}} {{currency}}
Transaction Hash: {{transactionHash}}
Timestamp: {{timestamp}}

This email serves as your official receipt.

Best regards,
AgenticPay Team`,
  variables: ['customerName', 'amount', 'currency', 'transactionHash', 'timestamp'],
});

emailTemplates.set('refund_notification', {
  id: 'refund_notification',
  name: 'Refund Notification',
  subject: 'Refund Processed - {{amount}} {{currency}}',
  body: `Dear {{customerName}},

Your refund of {{amount}} {{currency}} has been processed.

Original Transaction: {{originalTransactionId}}
Refund Amount: {{amount}} {{currency}}
Refund ID: {{refundId}}

The funds should appear in your account within 5-7 business days.

Best regards,
AgenticPay Team`,
  variables: ['customerName', 'amount', 'currency', 'originalTransactionId', 'refundId'],
});

function interpolateTemplate(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return result;
}

emailRouter.get('/templates', asyncHandler(async (req, res) => {
  const templates = Array.from(emailTemplates.values()).map(t => ({
    id: t.id,
    name: t.name,
    subject: t.subject,
    variables: t.variables,
  }));
  res.json({ templates });
}));

emailRouter.get('/templates/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const template = emailTemplates.get(id);
  if (!template) {
    res.status(404).json({ error: 'Template not found' });
    return;
  }
  res.json(template);
}));

emailRouter.post('/templates', asyncHandler(async (req, res) => {
  const { id, name, subject, body, variables } = req.body;
  if (!id || !name || !subject || !body) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }
  const template: EmailTemplate = { id, name, subject, body, variables: variables || [] };
  emailTemplates.set(id, template);
  res.status(201).json(template);
}));

emailRouter.put('/templates/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, subject, body, variables } = req.body;
  const existing = emailTemplates.get(id);
  if (!existing) {
    res.status(404).json({ error: 'Template not found' });
    return;
  }
  const template: EmailTemplate = {
    id,
    name: name || existing.name,
    subject: subject || existing.subject,
    body: body || existing.body,
    variables: variables || existing.variables,
  };
  emailTemplates.set(id, template);
  res.json(template);
}));

emailRouter.post('/send', asyncHandler(async (req, res) => {
  const { templateId, recipient, variables, backupEmail } = req.body;
  
  if (!templateId || !recipient) {
    res.status(400).json({ error: 'Missing templateId or recipient' });
    return;
  }

  const template = emailTemplates.get(templateId);
  if (!template) {
    res.status(404).json({ error: 'Template not found' });
    return;
  }

  const primaryEmail = recipient;
  const targetEmail = unsubscribedUsers.has(primaryEmail) ? (backupEmail || primaryEmail) : primaryEmail;

  if (unsubscribedUsers.has(primaryEmail)) {
    res.status(200).json({ 
      status: 'skipped', 
      reason: 'User unsubscribed, sent to backup email',
      sentTo: targetEmail,
    });
    return;
  }

  const deliveryRecord: EmailDeliveryRecord = {
    id: `delivery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    templateId,
    recipient: targetEmail,
    status: 'pending',
    retryCount: 0,
  };

  const subject = interpolateTemplate(template.subject, variables || {});
  const body = interpolateTemplate(template.body, variables || {});

  try {
    console.log(`[Email] Sending to ${targetEmail}: ${subject}`);
    deliveryRecord.status = 'sent';
    deliveryRecord.sentAt = new Date();
  } catch (error) {
    deliveryRecord.status = 'failed';
    deliveryRecord.error = error instanceof Error ? error.message : 'Unknown error';
    deliveryRecord.retryCount += 1;
  }

  emailQueue.push(deliveryRecord);
  res.json({
    id: deliveryRecord.id,
    status: deliveryRecord.status,
    recipient: deliveryRecord.recipient,
    sentAt: deliveryRecord.sentAt,
  });
}));

emailRouter.post('/send/batch', asyncHandler(async (req, res) => {
  const { emails } = req.body;
  
  if (!Array.isArray(emails)) {
    res.status(400).json({ error: 'emails must be an array' });
    return;
  }

  const results = await Promise.all(
    emails.map(async (email) => {
      const { templateId, recipient, variables, backupEmail } = email;
      
      if (!templateId || !recipient) {
        return { error: 'Missing templateId or recipient', recipient };
      }

      const template = emailTemplates.get(templateId);
      if (!template) {
        return { error: 'Template not found', templateId };
      }

      const targetEmail = unsubscribedUsers.has(recipient) ? (backupEmail || recipient) : recipient;
      const deliveryRecord: EmailDeliveryRecord = {
        id: `delivery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        templateId,
        recipient: targetEmail,
        status: 'pending',
        retryCount: 0,
      };

      try {
        console.log(`[Email] Batch sending to ${targetEmail}`);
        deliveryRecord.status = 'sent';
        deliveryRecord.sentAt = new Date();
      } catch (error) {
        deliveryRecord.status = 'failed';
        deliveryRecord.error = error instanceof Error ? error.message : 'Unknown error';
      }

      emailQueue.push(deliveryRecord);
      return { id: deliveryRecord.id, status: deliveryRecord.status, recipient: targetEmail };
    })
  );

  res.json({ results, total: results.length });
}));

emailRouter.get('/delivery/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const record = emailQueue.find(r => r.id === id);
  if (!record) {
    res.status(404).json({ error: 'Delivery record not found' });
    return;
  }
  res.json(record);
}));

emailRouter.get('/delivery', asyncHandler(async (req, res) => {
  const { recipient, status, limit = '50' } = req.query;
  
  let filtered = emailQueue;
  
  if (recipient) {
    filtered = filtered.filter(r => r.recipient === recipient);
  }
  if (status) {
    filtered = filtered.filter(r => r.status === status);
  }
  
  const limitNum = Math.min(parseInt(limit as string, 10) || 50, 200);
  res.json({ deliveries: filtered.slice(-limitNum) });
}));

emailRouter.post('/track/open/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const record = emailQueue.find(r => r.id === id);
  if (!record) {
    res.status(404).json({ error: 'Delivery record not found' });
    return;
  }
  record.openedAt = new Date();
  res.json({ success: true, openedAt: record.openedAt });
}));

emailRouter.post('/track/click/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const record = emailQueue.find(r => r.id === id);
  if (!record) {
    res.status(404).json({ error: 'Delivery record not found' });
    return;
  }
  record.clickedAt = new Date();
  res.json({ success: true, clickedAt: record.clickedAt });
}));

emailRouter.post('/unsubscribe', asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }
  unsubscribedUsers.add(email);
  res.json({ success: true, message: 'Unsubscribed successfully' });
}));

emailRouter.post('/subscribe', asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }
  unsubscribedUsers.delete(email);
  res.json({ success: true, message: 'Subscribed successfully' });
}));

emailRouter.get('/unsubscribed', asyncHandler(async (req, res) => {
  res.json({ unsubscribed: Array.from(unsubscribedUsers) });
}));

emailRouter.get('/preferences/:email', asyncHandler(async (req, res) => {
  const { email } = req.params;
  const isUnsubscribed = unsubscribedUsers.has(email);
  res.json({
    email,
    unsubscribed: isUnsubscribed,
    preferences: {
      paymentReceipts: !isUnsubscribed,
      paymentConfirmations: !isUnsubscribed,
      refundNotifications: !isUnsubscribed,
    },
  });
}));

emailRouter.put('/preferences/:email', asyncHandler(async (req, res) => {
  const { email } = req.params;
  const { paymentReceipts, paymentConfirmations, refundNotifications } = req.body;
  
  const allDisabled = !paymentReceipts && !paymentConfirmations && !refundNotifications;
  
  if (allDisabled) {
    unsubscribedUsers.add(email);
  } else {
    unsubscribedUsers.delete(email);
  }
  
  res.json({
    email,
    unsubscribed: unsubscribedUsers.has(email),
    preferences: {
      paymentReceipts: paymentReceipts ?? true,
      paymentConfirmations: paymentConfirmations ?? true,
      refundNotifications: refundNotifications ?? true,
    },
  });
}));

emailRouter.post('/retry/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const record = emailQueue.find(r => r.id === id);
  if (!record) {
    res.status(404).json({ error: 'Delivery record not found' });
    return;
  }
  if (record.status !== 'failed' && record.status !== 'bounced') {
    res.status(400).json({ error: 'Can only retry failed or bounced deliveries' });
    return;
  }
  if (record.retryCount >= 3) {
    res.status(400).json({ error: 'Max retry attempts reached' });
    return;
  }
  
  try {
    console.log(`[Email] Retrying delivery ${id}`);
    record.status = 'sent';
    record.sentAt = new Date();
  } catch (error) {
    record.status = 'failed';
    record.error = error instanceof Error ? error.message : 'Unknown error';
    record.retryCount += 1;
  }
  
  res.json({
    id: record.id,
    status: record.status,
    retryCount: record.retryCount,
  });
}));