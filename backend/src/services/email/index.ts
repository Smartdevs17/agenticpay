export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  variables: string[];
  createdAt: Date;
}

export interface EmailDelivery {
  id: string;
  to: string;
  templateId: string;
  status: 'pending' | 'sent' | 'delivered' | 'bounced' | 'failed';
  sentAt?: Date;
}

export interface EmailPreferences {
  email: string;
  paymentConfirmations: boolean;
  weeklyReports: boolean;
  unsubscribeToken: string;
}

export class EmailService {
  private templates: Map<string, EmailTemplate> = new Map();
  private deliveries: Map<string, EmailDelivery> = new Map();
  private preferences: Map<string, EmailPreferences> = new Map();

  constructor() {
    this.initializeDefaultTemplates();
  }

  private initializeDefaultTemplates(): void {
    const defaultTemplates: EmailTemplate[] = [
      {
        id: 'payment-confirmation',
        name: 'Payment Confirmation',
        subject: 'Payment Received - {{amount}} {{currency}}',
        body: `Dear {{recipientName}},

We've received your payment of {{amount}} {{currency}}.

Transaction Details:
- Transaction Hash: {{transactionHash}}
- Amount: {{amount}} {{currency}}
- Timestamp: {{timestamp}}

Thank you!

AgenticPay Team`,
        variables: ['recipientName', 'amount', 'currency', 'transactionHash', 'timestamp'],
        createdAt: new Date(),
      },
      {
        id: 'payment-receipt',
        name: 'Payment Receipt',
        subject: 'Your Receipt - {{invoiceNumber}}',
        body: `Dear {{recipientName}},

Thank you for your payment.

Invoice: {{invoiceNumber}}
Amount: {{amount}} {{currency}}
Date: {{date}}

AgenticPay Team`,
        variables: ['recipientName', 'invoiceNumber', 'amount', 'currency', 'date'],
        createdAt: new Date(),
      },
    ];

    for (const template of defaultTemplates) {
      this.templates.set(template.id, template);
    }
  }

  async createTemplate(input: Partial<EmailTemplate>): Promise<EmailTemplate> {
    const template: EmailTemplate = {
      id: input.id || `template-${Date.now()}`,
      name: input.name || 'Untitled',
      subject: input.subject || '',
      body: input.body || '',
      variables: input.variables || [],
      createdAt: new Date(),
    };

    this.templates.set(template.id, template);
    return template;
  }

  async getTemplate(id: string): Promise<EmailTemplate | null> {
    return this.templates.get(id) || null;
  }

  async listTemplates(): Promise<EmailTemplate[]> {
    return Array.from(this.templates.values());
  }

  async sendEmail(input: { to: string; templateId: string; variables?: Record<string, string> }): Promise<EmailDelivery> {
    const template = this.templates.get(input.templateId);
    if (!template) {
      throw new Error(`Template ${input.templateId} not found`);
    }

    const delivery: EmailDelivery = {
      id: `delivery-${Date.now()}`,
      to: input.to,
      templateId: input.templateId,
      status: 'pending',
    };

    try {
      const subject = this.renderTemplate(template.subject, input.variables || {});
      const body = this.renderTemplate(template.body, input.variables || {});

      await this.sendViaProvider(input.to, subject, body);

      delivery.status = 'sent';
      delivery.sentAt = new Date();
      console.log(`[Email] Sent ${template.name} to ${input.to}`);
    } catch (error) {
      delivery.status = 'failed';
      console.error(`[Email] Failed:`, error);
    }

    this.deliveries.set(delivery.id, delivery);
    return delivery;
  }

  async listDeliveries(options: { status?: EmailDelivery['status']; limit?: number } = {}): Promise<EmailDelivery[]> {
    let deliveries = Array.from(this.deliveries.values());

    if (options.status) {
      deliveries = deliveries.filter((d) => d.status === options.status);
    }

    return deliveries.slice(0, options.limit || 50);
  }

  async updatePreferences(input: { email: string; paymentConfirmations?: boolean; weeklyReports?: boolean }): Promise<EmailPreferences> {
    const existing = this.preferences.get(input.email);
    const unsubscribeToken = existing?.unsubscribeToken || `unsubscribe-${Date.now()}`;

    const preferences: EmailPreferences = {
      email: input.email,
      paymentConfirmations: input.paymentConfirmations ?? existing?.paymentConfirmations ?? true,
      weeklyReports: input.weeklyReports ?? existing?.weeklyReports ?? false,
      unsubscribeToken,
    };

    this.preferences.set(input.email, preferences);
    return preferences;
  }

  async handleUnsubscribe(token: string): Promise<boolean> {
    for (const [, prefs] of this.preferences) {
      if (prefs.unsubscribeToken === token) {
        prefs.paymentConfirmations = false;
        prefs.weeklyReports = false;
        this.preferences.set(prefs.email, prefs);
        return true;
      }
    }
    return false;
  }

  private renderTemplate(template: string, variables: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    return result;
  }

  private async sendViaProvider(to: string, subject: string, body: string): Promise<void> {
    console.log(`[Email] Sending to ${to}: ${subject}`);
  }
}

export const emailService = new EmailService();