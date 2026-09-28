/**
 * Queue Job Producers
 * Provides convenient methods to enqueue specific types of jobs
 */

import { messageQueue, QueueJob } from './queue.js';

/**
 * Email job data structure
 */
export interface EmailJobData {
  to: string;
  subject: string;
  body: string;
  html?: string;
  from?: string;
  cc?: string[];
  bcc?: string[];
}

/**
 * Notification job data structure
 */
export interface NotificationJobData {
  userId: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * Webhook job data structure
 */
export interface WebhookJobData {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  timeout?: number;
}

/**
 * Queue an email to be sent asynchronously
 */
export async function queueEmail(emailData: EmailJobData, maxAttempts?: number): Promise<QueueJob> {
  return messageQueue.enqueue('email', emailData, maxAttempts || 3);
}

/**
 * Queue a notification to be delivered asynchronously
 */
export async function queueNotification(
  notificationData: NotificationJobData,
  maxAttempts?: number
): Promise<QueueJob> {
  return messageQueue.enqueue('notifications', notificationData, maxAttempts || 5);
}

/**
 * Queue a webhook call to be delivered asynchronously
 */
export async function queueWebhook(
  webhookData: WebhookJobData,
  maxAttempts?: number
): Promise<QueueJob> {
  return messageQueue.enqueue('webhooks', webhookData, maxAttempts || 5);
}

/**
 * Default email processor implementation
 * In production, this would integrate with a real email service like SendGrid or AWS SES
 */
export async function processEmailJob(job: QueueJob): Promise<void> {
  const { to, subject, body, html, from = 'noreply@agenticpay.dev' } =
    job.data as unknown as EmailJobData;

  if (!to || !subject || !body) {
    throw new Error('Missing required email fields: to, subject, body');
  }

  // TODO: Integrate with actual email service
  // For now, just log the email
  console.log(`Sending email to ${to}:`, {
    from,
    subject,
    body,
    html,
  });

  // Simulate email sending delay
  await new Promise((resolve) => setTimeout(resolve, 100));
}

/**
 * Default notification processor implementation
 * In production, this would integrate with a notification service
 */
export async function processNotificationJob(job: QueueJob): Promise<void> {
  const { userId, type, title, message, metadata } =
    job.data as unknown as NotificationJobData;

  if (!userId || !type || !title || !message) {
    throw new Error('Missing required notification fields: userId, type, title, message');
  }

  // TODO: Integrate with actual notification service (push notifications, in-app, email, SMS, etc.)
  // For now, just log the notification
  console.log(`Sending ${type} notification to user ${userId}:`, {
    title,
    message,
    metadata,
  });

  // Simulate notification delivery delay
  await new Promise((resolve) => setTimeout(resolve, 50));
}

/**
 * Default webhook processor implementation
 */
export async function processWebhookJob(job: QueueJob): Promise<void> {
  const { url, method = 'POST', headers = {}, body, timeout = 5000 } =
    job.data as unknown as WebhookJobData;

  if (!url) {
    throw new Error('Missing required webhook field: url');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Webhook request failed with status ${response.status}: ${response.statusText}`
      );
    }

    console.log(`Webhook delivered successfully to ${url}`, {
      status: response.status,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Register all default job processors
 */
export function registerDefaultProcessors(): void {
  messageQueue.registerProcessor('email', processEmailJob);
  messageQueue.registerProcessor('notifications', processNotificationJob);
  messageQueue.registerProcessor('webhooks', processWebhookJob);
}
