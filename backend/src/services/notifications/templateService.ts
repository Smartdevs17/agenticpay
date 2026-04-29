import { config } from '../../config.js';

export interface NotificationTemplate {
  id: string;
  name: string;
  subject: string; // For email and push title
  body: string; // For email, SMS, and push body
  variables: string[];
  channels: ('email' | 'sms' | 'push' | 'in-app')[];
}

export class NotificationTemplateService {
  // In a real implementation, these would come from a database or file storage
  private templates: Map<string, NotificationTemplate> = new Map();

  constructor() {
    this.loadDefaultTemplates();
  }

  private loadDefaultTemplates() {
    // Payment receipt template
    this.templates.set('payment_receipt', {
      id: 'payment_receipt',
      name: 'Payment Receipt',
      subject: 'Payment Receipt - {{amount}} {{currency}}',
      body: `Dear {{customerName}},\n\nThank you for your payment of {{amount}} {{currency}}.\n\nPayment Details:\n- Transaction ID: {{transactionId}}\n- Amount: {{amount}} {{currency}}\n- Date: {{date}}\n- Status: {{status}}\n\n{{#if projectName}}\nProject: {{projectName}}\n{{/if}}\n\nIf you have any questions, please contact support.\n\nBest regards,\nAgenticPay Team`,
      variables: ['customerName', 'amount', 'currency', 'transactionId', 'date', 'status', 'projectName'],
      channels: ['email', 'sms', 'push', 'in-app']
    });

    // Payment confirmation template
    this.templates.set('payment_confirmation', {
      id: 'payment_confirmation',
      name: 'Payment Confirmation',
      subject: 'Payment Confirmed - {{amount}} {{currency}}',
      body: `Dear {{customerName}},\n\nYour payment has been confirmed!\n\nAmount: {{amount}} {{currency}}\nTransaction Hash: {{transactionHash}}\nTimestamp: {{timestamp}}\n\nThis email serves as your official receipt.\n\nBest regards,\nAgenticPay Team`,
      variables: ['customerName', 'amount', 'currency', 'transactionHash', 'timestamp'],
      channels: ['email', 'sms', 'push', 'in-app']
    });

    // Refund notification template
    this.templates.set('refund_notification', {
      id: 'refund_notification',
      name: 'Refund Notification',
      subject: 'Refund Processed - {{amount}} {{currency}}',
      body: `Dear {{customerName}},\n\nYour refund of {{amount}} {{currency}} has been processed.\n\nOriginal Transaction: {{originalTransactionId}}\nRefund Amount: {{amount}} {{currency}}\nRefund ID: {{refundId}}\n\nThe funds should appear in your account within 5-7 business days.\n\nBest regards,\nAgenticPay Team`,
      variables: ['customerName', 'amount', 'currency', 'originalTransactionId', 'refundId'],
      channels: ['email', 'sms', 'push', 'in-app']
    });

    // Invoice created template
    this.templates.set('invoice_created', {
      id: 'invoice_created',
      name: 'Invoice Created',
      subject: 'New Invoice - {{invoiceNumber}}',
      body: `Hello {{customerName}},\n\nYou have a new invoice:\n\nInvoice Number: {{invoiceNumber}}\nAmount: {{amount}} {{currency}}\nDue Date: {{dueDate}}\n\nPlease review and pay at your earliest convenience.\n\nBest regards,\nAgenticPay Team`,
      variables: ['customerName', 'invoiceNumber', 'amount', 'currency', 'dueDate'],
      channels: ['email', 'sms', 'push', 'in-app']
    });

    // Invoice paid template
    this.templates.set('invoice_paid', {
      id: 'invoice_paid',
      name: 'Invoice Paid',
      subject: 'Invoice Paid - {{invoiceNumber}}',
      body: `Hello {{customerName}},\n\nThank you for your payment!\n\nInvoice {{invoiceNumber}} for {{amount}} {{currency}} has been paid.\n\nPayment Date: {{paymentDate}}\nTransaction ID: {{transactionId}}\n\nBest regards,\nAgenticPay Team`,
      variables: ['customerName', 'invoiceNumber', 'amount', 'currency', 'paymentDate', 'transactionId'],
      channels: ['email', 'sms', 'push', 'in-app']
    });

    // Security alert template
    this.templates.set('security_alert', {
      id: 'security_alert',
      name: 'Security Alert',
      subject: 'Security Alert: {{alertType}}',
      body: `Hello {{userName}},\n\nWe detected a {{alertType}} on your account.\n\nDetails:\n- Time: {{timestamp}}\n- IP Address: {{ipAddress}}\n- Location: {{location}}\n\nIf this was not you, please secure your account immediately.\n\nBest regards,\nAgenticPay Security Team`,
      variables: ['userName', 'alertType', 'timestamp', 'ipAddress', 'location'],
      channels: ['email', 'push', 'in-app'] // SMS might be too short for security alerts
    });
  }

  getTemplate(id: string): NotificationTemplate | undefined {
    return this.templates.get(id);
  }

  getAllTemplates(): NotificationTemplate[] {
    return Array.from(this.templates.values());
  }

  addTemplate(template: NotificationTemplate): void {
    this.templates.set(template.id, template);
  }

  updateTemplate(id: string, updates: Partial<NotificationTemplate>): NotificationTemplate | undefined {
    const existing = this.templates.get(id);
    if (!existing) return undefined;
    
    const updated = { ...existing, ...updates };
    this.templates.set(id, updated);
    return updated;
  }

  deleteTemplate(id: string): boolean {
    return this.templates.delete(id);
  }

  renderTemplate(template: NotificationTemplate, variables: Record<string, string>): { subject: string; body: string } {
    let subject = template.subject;
    let body = template.body;
    
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      subject = subject.replace(regex, value);
      body = body.replace(regex, value);
    }
    
    return { subject, body };
  }
}