# Transactional Email System Guide

## Overview

The AgenticPay transactional email system provides a comprehensive solution for sending, tracking, and managing emails with customizable templates, user preferences, analytics, and localization support.

## Features

### 1. Template Engine with Handlebars-Style Variables

The system uses Handlebars for template rendering with custom helpers for formatting dates, currency, numbers, and more.

#### Available Helpers

- `{{formatDate date format}}` - Format dates
- `{{formatCurrency amount currency}}` - Format currency values
- `{{formatNumber num decimals}}` - Format numbers with decimals
- `{{eq a b}}` - Check equality
- `{{ne a b}}` - Check inequality
- `{{gt a b}}` - Greater than
- `{{lt a b}}` - Less than
- `{{default value defaultValue}}` - Default value if empty
- `{{truncate str length}}` - Truncate text
- `{{uppercase str}}` - Convert to uppercase
- `{{lowercase str}}` - Convert to lowercase
- `{{json obj}}` - JSON stringify
- `{{urlencode str}}` - URL encode
- `{{length arr}}` - Array length
- `{{first arr}}` - First array item
- `{{last arr}}` - Last array item
- `{{join arr separator}}` - Join array items

#### Example Template

```handlebars
Dear {{customerName}},

Thank you for your payment of {{formatCurrency amount currency}}.

Transaction Details:
- Amount: {{formatCurrency amount currency}}
- Transaction ID: {{transactionId}}
- Date: {{formatDate date}}
- Status: {{status}}

{{#if projectName}}
Project: {{projectName}}
{{/if}}

Best regards,
AgenticPay Team
```

### 2. Email Delivery via SMTP with SendGrid Fallback

The system supports both SMTP and SendGrid for email delivery with automatic fallback.

#### Configuration

```env
# SMTP Configuration
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password

# SendGrid Configuration
SENDGRID_API_KEY=your-sendgrid-api-key

# Default From Address
EMAIL_FROM=noreply@agenticpay.com
EMAIL_FROM_NAME=AgenticPay
```

#### Provider Selection

The system automatically tries the preferred provider first and falls back to the alternative if it fails.

### 3. User Preference Center (Opt-In/Opt-Out Per Category)

Users can control which types of emails they receive through a preference center.

#### Available Categories

- `paymentReceipts` - Payment receipt emails
- `paymentConfirmations` - Payment confirmation emails
- `refundNotifications` - Refund notification emails
- `disputeUpdates` - Dispute update emails
- `weeklySummaries` - Weekly summary emails
- `marketing` - Marketing emails (default: opt-in required)
- `securityAlerts` - Security alert emails
- `onboarding` - Onboarding emails

#### API Endpoints

```bash
# Get user preferences
GET /api/v2/email/preferences/:email?tenantId=tenant-123

# Update preferences
PUT /api/v2/email/preferences/:email?tenantId=tenant-123
Content-Type: application/json
{
  "paymentReceipts": true,
  "marketing": false
}

# Opt out of all emails
POST /api/v2/email/preferences/:email/opt-out-all?tenantId=tenant-123

# Opt in to all emails
POST /api/v2/email/preferences/:email/opt-in-all?tenantId=tenant-123
```

### 4. Email Analytics (Open Rate, Click Rate, Bounce)

Track email engagement metrics with comprehensive analytics.

#### Metrics Tracked

- Sent count
- Delivered count
- Opened count
- Clicked count
- Bounced count
- Failed count
- Open rate (opened / sent * 100)
- Click rate (clicked / opened * 100)
- Bounce rate (bounced / sent * 100)
- Delivery rate (delivered / sent * 100)

#### API Endpoints

```bash
# Get tenant analytics
GET /api/v2/email/analytics?tenantId=tenant-123&days=30

# Get template analytics
GET /api/v2/email/analytics/template/:templateId?startDate=2024-01-01&endDate=2024-12-31

# Get category analytics
GET /api/v2/email/analytics/category/:category?tenantId=tenant-123

# Get delivery status
GET /api/v2/email/delivery/:deliveryId

# Track events
POST /api/v2/email/delivery/:deliveryId/open
POST /api/v2/email/delivery/:deliveryId/click
POST /api/v2/email/delivery/:deliveryId/bounce
```

### 5. Localization Support for Template Content

Templates support multiple locales with automatic fallback to the base template.

#### Supported Locales

- English (en)
- Spanish (es)
- French (fr)
- German (de)
- Italian (it)
- Portuguese (pt)
- Chinese (zh)
- Japanese (ja)
- Korean (ko)
- Arabic (ar)
- Russian (ru)
- Hindi (hi)

#### API Endpoints

```bash
# Add localization
POST /api/v2/email/templates/:templateId/localizations
Content-Type: application/json
{
  "locale": "es",
  "subject": "Recibo de Pago - {{formatCurrency amount currency}}",
  "htmlBody": "...",
  "textBody": "..."
}

# Get template with localizations
GET /api/v2/email/templates/:templateId/localizations

# Update localization
PUT /api/v2/email/templates/:templateId/localizations/:locale

# Delete localization
DELETE /api/v2/email/templates/:templateId/localizations/:locale

# Get supported locales
GET /api/v2/email/locales
```

### 6. Batch Email Processing with Rate Limiting

Send emails to multiple recipients with configurable rate limiting.

#### Rate Limiting Configuration

Default limits:
- 10 emails per second
- 300 emails per minute
- 5,000 emails per hour

#### API Endpoints

```bash
# Send batch with automatic rate limiting
POST /api/v2/email/batch
Content-Type: application/json
{
  "tenantId": "tenant-123",
  "templateId": "template-uuid",
  "category": "payment_receipt",
  "recipients": [
    {
      "email": "user1@example.com",
      "name": "User One",
      "variables": {
        "customerName": "User One",
        "amount": 100,
        "currency": "USD"
      }
    }
  ],
  "locale": "en"
}

# Send batch with fixed delay between sends
POST /api/v2/email/batch/delayed
Content-Type: application/json
{
  "tenantId": "tenant-123",
  "templateId": "template-uuid",
  "category": "payment_receipt",
  "recipients": [...],
  "delayMs": 100
}

# Get batch status
GET /api/v2/email/batch/:batchId

# Update rate limit config
PUT /api/v2/email/rate-limit/config
Content-Type: application/json
{
  "maxPerSecond": 20,
  "maxPerMinute": 600
}
```

## API Endpoints Summary

### Template Management

- `POST /api/v2/email/templates` - Create template
- `GET /api/v2/email/templates` - List templates
- `GET /api/v2/email/templates/:id` - Get template
- `PUT /api/v2/email/templates/:id` - Update template
- `DELETE /api/v2/email/templates/:id` - Delete template

### Template Localization

- `POST /api/v2/email/templates/:id/localizations` - Add localization
- `GET /api/v2/email/templates/:id/localizations` - Get localizations
- `PUT /api/v2/email/templates/:id/localizations/:locale` - Update localization
- `DELETE /api/v2/email/templates/:id/localizations/:locale` - Delete localization

### Send Emails

- `POST /api/v2/email/send` - Send single email
- `POST /api/v2/email/batch` - Send batch with rate limiting
- `POST /api/v2/email/batch/delayed` - Send batch with delay
- `GET /api/v2/email/batch/:batchId` - Get batch status

### Preferences

- `GET /api/v2/email/preferences/:email` - Get preferences
- `PUT /api/v2/email/preferences/:email` - Update preferences
- `POST /api/v2/email/preferences/:email/opt-out-all` - Opt out all
- `POST /api/v2/email/preferences/:email/opt-in-all` - Opt in all

### Analytics

- `GET /api/v2/email/analytics` - Get tenant analytics
- `GET /api/v2/email/analytics/template/:templateId` - Get template analytics
- `GET /api/v2/email/analytics/category/:category` - Get category analytics
- `GET /api/v2/email/delivery/:id` - Get delivery status
- `POST /api/v2/email/delivery/:id/open` - Track open
- `POST /api/v2/email/delivery/:id/click` - Track click
- `POST /api/v2/email/delivery/:id/bounce` - Track bounce

### System

- `GET /api/v2/email/provider/status` - Get provider status
- `GET /api/v2/email/rate-limit/config` - Get rate limit config
- `PUT /api/v2/email/rate-limit/config` - Update rate limit config
- `GET /api/v2/email/locales` - Get supported locales

## Database Schema

### EmailTemplate

Stores email templates with Handlebars variables.

```prisma
model EmailTemplate {
  id          String        @id @default(uuid())
  tenantId    String
  name        String
  category    EmailCategory
  subject     String
  htmlBody    String
  textBody    String?
  variables   String[]
  isActive    Boolean       @default(true)
  locale      String        @default("en")
  version     Int           @default(1)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  deletedAt   DateTime?
}
```

### EmailTemplateLocalization

Stores template translations for different locales.

```prisma
model EmailTemplateLocalization {
  id         String   @id @default(uuid())
  templateId String
  locale     String
  subject    String
  htmlBody   String
  textBody   String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

### EmailDelivery

Records email delivery attempts and status.

```prisma
model EmailDelivery {
  id              String          @id @default(uuid())
  tenantId        String
  templateId      String?
  recipientEmail  String
  recipientName   String?
  subject         String
  htmlBody        String
  textBody        String?
  status          EmailStatus     @default(pending)
  provider        DeliveryProvider @default(smtp)
  providerId      String?
  sentAt          DateTime?
  deliveredAt     DateTime?
  openedAt        DateTime?
  clickedAt       DateTime?
  bouncedAt       DateTime?
  bounceReason    String?
  retryCount      Int             @default(0)
  error           String?
  metadata        Json?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
}
```

### EmailPreference

Stores user email preferences per category.

```prisma
model EmailPreference {
  id                String   @id @default(uuid())
  tenantId          String
  userId            String?
  email             String
  paymentReceipts   Boolean  @default(true)
  paymentConfirmations Boolean @default(true)
  refundNotifications Boolean  @default(true)
  disputeUpdates    Boolean  @default(true)
  weeklySummaries   Boolean  @default(true)
  marketing         Boolean  @default(false)
  securityAlerts    Boolean  @default(true)
  onboarding        Boolean  @default(true)
  locale            String   @default("en")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

### EmailAnalytics

Aggregates email metrics by date and category.

```prisma
model EmailAnalytics {
  id              String   @id @default(uuid())
  tenantId        String
  templateId      String?
  category        EmailCategory
  sentCount       Int      @default(0)
  deliveredCount  Int      @default(0)
  openedCount     Int      @default(0)
  clickedCount    Int      @default(0)
  bouncedCount    Int      @default(0)
  failedCount     Int      @default(0)
  date            DateTime @db.Date
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

## Seeding Templates

Use the seed script to create default email templates:

```typescript
import { seedEmailTemplates } from './src/templates/seed-email-templates.js';

await seedEmailTemplates('your-tenant-id');
```

Default templates include:
- Payment Receipt
- Payment Confirmation
- Refund Notification
- Dispute Update
- Weekly Summary
- Marketing Newsletter
- Security Alert
- Welcome Email

## Best Practices

1. **Always validate template syntax** before saving templates
2. **Use descriptive template names** for easier identification
3. **Test templates with sample data** before sending to users
4. **Respect user preferences** - always check opt-in status
5. **Monitor analytics** to improve email performance
6. **Use localization** for international users
7. **Set appropriate rate limits** for batch sends
8. **Handle bounces** to maintain deliverability
9. **Use text fallback** for HTML emails
10. **Track engagement** to optimize content

## Troubleshooting

### Emails Not Sending

- Check provider configuration
- Verify API keys and credentials
- Check rate limits
- Review error logs

### High Bounce Rate

- Verify email addresses
- Check SPF/DKIM records
- Review content for spam triggers
- Clean email lists regularly

### Low Open Rate

- Improve subject lines
- Optimize send times
- Segment audiences
- A/B test content

### Template Rendering Errors

- Validate Handlebars syntax
- Check variable names
- Test with sample data
- Review helper usage

## Security Considerations

- Never expose API keys in client code
- Use environment variables for credentials
- Validate user input for template variables
- Sanitize HTML content to prevent XSS
- Implement rate limiting to prevent abuse
- Log all email sends for audit trails
- Respect unsubscribe requests immediately
- Use TLS for SMTP connections

## Support

For issues or questions about the email system:
- Check the API documentation
- Review server logs for detailed error messages
- Contact support with tenant ID and delivery ID (if applicable)
