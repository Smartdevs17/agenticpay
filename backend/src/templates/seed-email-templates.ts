// Seed Email Templates
// Creates default email templates for common use cases

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface EmailTemplateSeed {
  tenantId: string;
  name: string;
  category: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  variables: string[];
  locale?: string;
}

const defaultTemplates: Omit<EmailTemplateSeed, 'tenantId'>[] = [
  {
    name: 'Payment Receipt',
    category: 'payment_receipt',
    subject: 'Payment Receipt - {{formatCurrency amount currency}}',
    htmlBody: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Receipt</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #f8f9fa; padding: 30px; border-radius: 8px;">
      <h1 style="color: #2c3e50; margin-top: 0;">Payment Receipt</h1>
      <p>Dear {{customerName}},</p>
      <p>Thank you for your payment. This email serves as your official receipt.</p>
      
      <div style="background: white; padding: 20px; border-radius: 4px; margin: 20px 0;">
        <h2 style="color: #2c3e50; font-size: 18px;">Payment Details</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Amount:</td>
            <td style="padding: 8px 0;">{{formatCurrency amount currency}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Transaction ID:</td>
            <td style="padding: 8px 0;">{{transactionId}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Date:</td>
            <td style="padding: 8px 0;">{{formatDate date}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Status:</td>
            <td style="padding: 8px 0;">
              <span style="background: #28a745; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                {{status}}
              </span>
            </td>
          </tr>
          {{#if projectName}}
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Project:</td>
            <td style="padding: 8px 0;">{{projectName}}</td>
          </tr>
          {{/if}}
        </table>
      </div>
      
      <p>If you have any questions about this payment, please contact our support team.</p>
      <p>Best regards,<br>AgenticPay Team</p>
    </div>
  </div>
</body>
</html>`,
    textBody: `Payment Receipt

Dear {{customerName}},

Thank you for your payment. This email serves as your official receipt.

Payment Details:
- Amount: {{formatCurrency amount currency}}
- Transaction ID: {{transactionId}}
- Date: {{formatDate date}}
- Status: {{status}}
{{#if projectName}}
- Project: {{projectName}}
{{/if}}

If you have any questions about this payment, please contact our support team.

Best regards,
AgenticPay Team`,
    variables: ['customerName', 'amount', 'currency', 'transactionId', 'date', 'status', 'projectName'],
    locale: 'en',
  },
  {
    name: 'Payment Confirmation',
    category: 'payment_confirmation',
    subject: 'Payment Confirmed - {{formatCurrency amount currency}}',
    htmlBody: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Confirmed</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #d4edda; padding: 30px; border-radius: 8px; border: 1px solid #c3e6cb;">
      <h1 style="color: #155724; margin-top: 0;">✓ Payment Confirmed</h1>
      <p>Dear {{customerName}},</p>
      <p>Your payment has been successfully confirmed and processed.</p>
      
      <div style="background: white; padding: 20px; border-radius: 4px; margin: 20px 0;">
        <h2 style="color: #155724; font-size: 18px;">Transaction Details</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Amount:</td>
            <td style="padding: 8px 0;">{{formatCurrency amount currency}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Transaction Hash:</td>
            <td style="padding: 8px 0; font-family: monospace;">{{transactionHash}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Timestamp:</td>
            <td style="padding: 8px 0;">{{formatDate timestamp}}</td>
          </tr>
        </table>
      </div>
      
      <p>You can view the transaction details in your dashboard.</p>
      <p>Best regards,<br>AgenticPay Team</p>
    </div>
  </div>
</body>
</html>`,
    textBody: `Payment Confirmed

Dear {{customerName}},

Your payment has been successfully confirmed and processed.

Transaction Details:
- Amount: {{formatCurrency amount currency}}
- Transaction Hash: {{transactionHash}}
- Timestamp: {{formatDate timestamp}}

You can view the transaction details in your dashboard.

Best regards,
AgenticPay Team`,
    variables: ['customerName', 'amount', 'currency', 'transactionHash', 'timestamp'],
    locale: 'en',
  },
  {
    name: 'Refund Notification',
    category: 'refund_notification',
    subject: 'Refund Processed - {{formatCurrency amount currency}}',
    htmlBody: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Refund Notification</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #fff3cd; padding: 30px; border-radius: 8px; border: 1px solid #ffeeba;">
      <h1 style="color: #856404; margin-top: 0;">Refund Processed</h1>
      <p>Dear {{customerName}},</p>
      <p>Your refund has been processed successfully.</p>
      
      <div style="background: white; padding: 20px; border-radius: 4px; margin: 20px 0;">
        <h2 style="color: #856404; font-size: 18px;">Refund Details</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Refund Amount:</td>
            <td style="padding: 8px 0;">{{formatCurrency amount currency}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Original Transaction:</td>
            <td style="padding: 8px 0;">{{originalTransactionId}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Refund ID:</td>
            <td style="padding: 8px 0;">{{refundId}}</td>
          </tr>
        </table>
      </div>
      
      <p>The funds should appear in your account within 5-7 business days.</p>
      <p>Best regards,<br>AgenticPay Team</p>
    </div>
  </div>
</body>
</html>`,
    textBody: `Refund Processed

Dear {{customerName}},

Your refund has been processed successfully.

Refund Details:
- Refund Amount: {{formatCurrency amount currency}}
- Original Transaction: {{originalTransactionId}}
- Refund ID: {{refundId}}

The funds should appear in your account within 5-7 business days.

Best regards,
AgenticPay Team`,
    variables: ['customerName', 'amount', 'currency', 'originalTransactionId', 'refundId'],
    locale: 'en',
  },
  {
    name: 'Dispute Update',
    category: 'dispute_update',
    subject: 'Dispute Update - {{disputeId}}',
    htmlBody: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dispute Update</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #e2e3e5; padding: 30px; border-radius: 8px;">
      <h1 style="color: #383d41; margin-top: 0;">Dispute Update</h1>
      <p>Dear {{customerName}},</p>
      <p>There is an update regarding your dispute.</p>
      
      <div style="background: white; padding: 20px; border-radius: 4px; margin: 20px 0;">
        <h2 style="color: #383d41; font-size: 18px;">Dispute Details</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Dispute ID:</td>
            <td style="padding: 8px 0;">{{disputeId}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Status:</td>
            <td style="padding: 8px 0;">
              <span style="background: #17a2b8; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">
                {{status}}
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Update:</td>
            <td style="padding: 8px 0;">{{updateMessage}}</td>
          </tr>
        </table>
      </div>
      
      <p>You can view the full details in your dashboard.</p>
      <p>Best regards,<br>AgenticPay Team</p>
    </div>
  </div>
</body>
</html>`,
    textBody: `Dispute Update

Dear {{customerName}},

There is an update regarding your dispute.

Dispute Details:
- Dispute ID: {{disputeId}}
- Status: {{status}}
- Update: {{updateMessage}}

You can view the full details in your dashboard.

Best regards,
AgenticPay Team`,
    variables: ['customerName', 'disputeId', 'status', 'updateMessage'],
    locale: 'en',
  },
  {
    name: 'Weekly Summary',
    category: 'weekly_summary',
    subject: 'Your Weekly Summary - Week of {{formatDate weekStart}}',
    htmlBody: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly Summary</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #e7f3ff; padding: 30px; border-radius: 8px;">
      <h1 style="color: #004085; margin-top: 0;">Weekly Summary</h1>
      <p>Dear {{customerName}},</p>
      <p>Here's your weekly activity summary.</p>
      
      <div style="background: white; padding: 20px; border-radius: 4px; margin: 20px 0;">
        <h2 style="color: #004085; font-size: 18px;">Activity Overview</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Total Payments:</td>
            <td style="padding: 8px 0;">{{totalPayments}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Total Amount:</td>
            <td style="padding: 8px 0;">{{formatCurrency totalAmount currency}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Completed Projects:</td>
            <td style="padding: 8px 0;">{{completedProjects}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Active Projects:</td>
            <td style="padding: 8px 0;">{{activeProjects}}</td>
          </tr>
        </table>
      </div>
      
      <p>View your dashboard for more details.</p>
      <p>Best regards,<br>AgenticPay Team</p>
    </div>
  </div>
</body>
</html>`,
    textBody: `Weekly Summary

Dear {{customerName}},

Here's your weekly activity summary.

Activity Overview:
- Total Payments: {{totalPayments}}
- Total Amount: {{formatCurrency totalAmount currency}}
- Completed Projects: {{completedProjects}}
- Active Projects: {{activeProjects}}

View your dashboard for more details.

Best regards,
AgenticPay Team`,
    variables: ['customerName', 'weekStart', 'totalPayments', 'totalAmount', 'currency', 'completedProjects', 'activeProjects'],
    locale: 'en',
  },
  {
    name: 'Marketing Newsletter',
    category: 'marketing',
    subject: '{{subject}}',
    htmlBody: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{subject}}</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #6610f2; padding: 30px; border-radius: 8px; color: white;">
      <h1 style="margin-top: 0;">{{subject}}</h1>
    </div>
    <div style="background: white; padding: 30px; border-radius: 8px; margin-top: 20px;">
      {{{content}}}
      <p style="margin-top: 30px;">
        <a href="{{unsubscribeLink}}" style="color: #6610f2;">Unsubscribe</a>
      </p>
    </div>
  </div>
</body>
</html>`,
    textBody: `{{subject}}

{{content}}

To unsubscribe, visit: {{unsubscribeLink}}`,
    variables: ['subject', 'content', 'unsubscribeLink'],
    locale: 'en',
  },
  {
    name: 'Security Alert',
    category: 'security_alert',
    subject: 'Security Alert - {{alertType}}',
    htmlBody: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Alert</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: #f8d7da; padding: 30px; border-radius: 8px; border: 1px solid #f5c6cb;">
      <h1 style="color: #721c24; margin-top: 0;">⚠️ Security Alert</h1>
      <p>Dear {{customerName}},</p>
      <p>We detected a security activity on your account.</p>
      
      <div style="background: white; padding: 20px; border-radius: 4px; margin: 20px 0;">
        <h2 style="color: #721c24; font-size: 18px;">Alert Details</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Alert Type:</td>
            <td style="padding: 8px 0;">{{alertType}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Timestamp:</td>
            <td style="padding: 8px 0;">{{formatDate timestamp}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">IP Address:</td>
            <td style="padding: 8px 0;">{{ipAddress}}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Location:</td>
            <td style="padding: 8px 0;">{{location}}</td>
          </tr>
        </table>
      </div>
      
      <p>If this was not you, please secure your account immediately.</p>
      <p>Best regards,<br>AgenticPay Security Team</p>
    </div>
  </div>
</body>
</html>`,
    textBody: `Security Alert

Dear {{customerName}},

We detected a security activity on your account.

Alert Details:
- Alert Type: {{alertType}}
- Timestamp: {{formatDate timestamp}}
- IP Address: {{ipAddress}}
- Location: {{location}}

If this was not you, please secure your account immediately.

Best regards,
AgenticPay Security Team`,
    variables: ['customerName', 'alertType', 'timestamp', 'ipAddress', 'location'],
    locale: 'en',
  },
  {
    name: 'Welcome Email',
    category: 'onboarding',
    subject: 'Welcome to AgenticPay!',
    htmlBody: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to AgenticPay</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; border-radius: 8px; color: white;">
      <h1 style="margin-top: 0; font-size: 32px;">Welcome to AgenticPay!</h1>
      <p style="font-size: 18px;">We're excited to have you on board.</p>
    </div>
    <div style="background: white; padding: 30px; border-radius: 8px; margin-top: 20px;">
      <p>Dear {{customerName}},</p>
      <p>Thank you for joining AgenticPay. Your account has been successfully created.</p>
      
      <h2 style="color: #667eea;">Getting Started</h2>
      <ul>
        <li>Complete your profile setup</li>
        <li>Add your payment methods</li>
        <li>Create your first project</li>
        <li>Invite team members</li>
      </ul>
      
      <p style="margin-top: 30px;">
        <a href="{{dashboardLink}}" style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
          Go to Dashboard
        </a>
      </p>
      
      <p style="margin-top: 30px;">If you have any questions, our support team is here to help.</p>
      <p>Best regards,<br>AgenticPay Team</p>
    </div>
  </div>
</body>
</html>`,
    textBody: `Welcome to AgenticPay!

Dear {{customerName}},

Thank you for joining AgenticPay. Your account has been successfully created.

Getting Started:
- Complete your profile setup
- Add your payment methods
- Create your first project
- Invite team members

Go to Dashboard: {{dashboardLink}}

If you have any questions, our support team is here to help.

Best regards,
AgenticPay Team`,
    variables: ['customerName', 'dashboardLink'],
    locale: 'en',
  },
];

export async function seedEmailTemplates(tenantId: string) {
  const createdTemplates = [];

  for (const template of defaultTemplates) {
    try {
      const created = await prisma.emailTemplate.create({
        data: {
          tenantId,
          name: template.name,
          category: template.category as any,
          subject: template.subject,
          htmlBody: template.htmlBody,
          textBody: template.textBody,
          variables: template.variables,
          locale: template.locale || 'en',
        },
      });
      createdTemplates.push(created);
      console.log(`[Seed] Created template: ${template.name}`);
    } catch (error) {
      console.error(`[Seed] Failed to create template ${template.name}:`, error);
    }
  }

  return createdTemplates;
}

export default seedEmailTemplates;
