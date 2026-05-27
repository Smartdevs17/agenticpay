import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateWebhookSignature,
  verifyWebhookSignature,
  createWebhookSecret,
  getActiveSecretForProvider,
  rotateWebhookSecret,
  deactivateWebhookSecret,
  queueFailedWebhook,
  getQueuedWebhooks,
  retryWebhook,
  markWebhookProcessed,
  getWebhookEvents,
  getAllWebhookSecrets,
  clearWebhookEvents,
  clearWebhookSecrets,
  WebhookProvider,
} from '../verification';

describe('Webhook Signature Verification', () => {
  const testSecret = 'whsec_test_secret_key_32_chars_minimum';
  const testProvider: WebhookProvider = 'stripe';
  const testPayload = JSON.stringify({ event: 'test', data: { id: '123' } });
  const testTimestamp = new Date().toISOString();

  beforeEach(() => {
    clearWebhookEvents();
    clearWebhookSecrets();
  });

  describe('HMAC-SHA256 Signature Generation', () => {
    it('should generate consistent signatures', () => {
      const sig1 = generateWebhookSignature(testPayload, testSecret, testTimestamp);
      const sig2 = generateWebhookSignature(testPayload, testSecret, testTimestamp);
      expect(sig1).toBe(sig2);
      expect(sig1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex is 64 chars
    });

    it('should generate different signatures for different payloads', () => {
      const sig1 = generateWebhookSignature(testPayload, testSecret, testTimestamp);
      const sig2 = generateWebhookSignature('different payload', testSecret, testTimestamp);
      expect(sig1).not.toBe(sig2);
    });

    it('should generate different signatures for different secrets', () => {
      const sig1 = generateWebhookSignature(testPayload, testSecret, testTimestamp);
      const sig2 = generateWebhookSignature(testPayload, 'different_secret', testTimestamp);
      expect(sig1).not.toBe(sig2);
    });

    it('should generate different signatures for different timestamps', () => {
      const sig1 = generateWebhookSignature(testPayload, testSecret, testTimestamp);
      const sig2 = generateWebhookSignature(testPayload, testSecret, '2024-01-01T00:00:00.000Z');
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('Webhook Signature Verification', () => {
    it('should verify valid signatures', () => {
      const signature = generateWebhookSignature(testPayload, testSecret, testTimestamp);
      createWebhookSecret(testProvider, testSecret);

      const result = verifyWebhookSignature({
        signature,
        timestamp: testTimestamp,
        body: testPayload,
        provider: testProvider,
      });

      expect(result.isValid).toBe(true);
      expect(result.provider).toBe(testProvider);
      expect(result.timestamp).toEqual(new Date(testTimestamp));
    });

    it('should reject invalid signatures', () => {
      createWebhookSecret(testProvider, testSecret);

      const result = verifyWebhookSignature({
        signature: 'invalid_signature',
        timestamp: testTimestamp,
        body: testPayload,
        provider: testProvider,
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('verification failed');
    });

    it('should reject when no secret exists for provider', () => {
      // Get the default custom secret and deactivate it
      const customSecret = getActiveSecretForProvider('custom');
      if (customSecret) {
        deactivateWebhookSecret(customSecret.id);
      }

      const signature = generateWebhookSignature(testPayload, testSecret, testTimestamp);

      const result = verifyWebhookSignature({
        signature,
        timestamp: testTimestamp,
        body: testPayload,
        provider: 'custom',
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('No active secret found');
    });

    it('should reject timestamps outside tolerance window', () => {
      const oldTimestamp = '2020-01-01T00:00:00.000Z'; // Very old timestamp
      const signature = generateWebhookSignature(testPayload, testSecret, oldTimestamp);
      createWebhookSecret(testProvider, testSecret);

      const result = verifyWebhookSignature({
        signature,
        timestamp: oldTimestamp,
        body: testPayload,
        provider: testProvider,
        toleranceSeconds: 300, // 5 minutes
      });

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('outside tolerance window');
    });

    it('should accept timestamps within tolerance window', () => {
      const recentTimestamp = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 minutes ago
      const signature = generateWebhookSignature(testPayload, testSecret, recentTimestamp);
      createWebhookSecret(testProvider, testSecret);

      const result = verifyWebhookSignature({
        signature,
        timestamp: recentTimestamp,
        body: testPayload,
        provider: testProvider,
        toleranceSeconds: 300, // 5 minutes
      });

      expect(result.isValid).toBe(true);
    });
  });

  describe('Webhook Secret Management', () => {
    it('should create and retrieve webhook secrets', () => {
      const secret = createWebhookSecret(testProvider, testSecret);
      expect(secret.id).toBeDefined();
      expect(secret.provider).toBe(testProvider);
      expect(secret.secret).toBe(testSecret);
      expect(secret.isActive).toBe(true);

      const activeSecret = getActiveSecretForProvider(testProvider);
      expect(activeSecret).toEqual(secret);
    });

    it('should rotate webhook secrets with grace period', () => {
      const oldSecret = createWebhookSecret(testProvider, testSecret);
      const newSecretValue = 'whsec_new_secret_key_32_chars_minimum';

      const rotatedSecret = rotateWebhookSecret(testProvider, newSecretValue, 24);

      expect(rotatedSecret.provider).toBe(testProvider);
      expect(rotatedSecret.secret).toBe(newSecretValue);
      expect(rotatedSecret.isActive).toBe(true);

      // Old secret should be deactivated with expiration - check the stored version
      const storedOldSecret = getAllWebhookSecrets().find(s => s.id === oldSecret.id);
      expect(storedOldSecret?.isActive).toBe(false);
      expect(storedOldSecret?.expiresAt).toBeDefined();
    });

    it('should deactivate webhook secrets', () => {
      const secret = createWebhookSecret('github', testSecret); // Use github to avoid conflicts
      const success = deactivateWebhookSecret(secret.id);

      expect(success).toBe(true);
      const storedSecret = getAllWebhookSecrets().find(s => s.id === secret.id);
      expect(storedSecret?.isActive).toBe(false);

      const activeSecret = getActiveSecretForProvider('github');
      expect(activeSecret).toBeNull(); // No active secrets for github now
    });

    it('should handle expired secrets', () => {
      // Deactivate all existing secrets for paypal
      const allSecrets = getAllWebhookSecrets();
      allSecrets.forEach(secret => {
        if (secret.provider === 'paypal') {
          deactivateWebhookSecret(secret.id);
        }
      });

      const expiredSecret = createWebhookSecret(
        'paypal',
        testSecret,
        new Date(Date.now() - 1000).toISOString() // Already expired
      );

      const activeSecret = getActiveSecretForProvider('paypal');
      expect(activeSecret).toBeNull();
    });
  });

  describe('Webhook Event Queue Management', () => {
    it('should queue failed webhook events', () => {
      const event = queueFailedWebhook(
        testProvider,
        'payment.failed',
        { id: '123', amount: 100 },
        'invalid_signature',
        testTimestamp,
        'Signature verification failed'
      );

      expect(event.id).toBeDefined();
      expect(event.provider).toBe(testProvider);
      expect(event.eventType).toBe('payment.failed');
      expect(event.verified).toBe(false);
      expect(event.processed).toBe(false);
      expect(event.retryCount).toBe(0);
      expect(event.error).toBe('Signature verification failed');
    });

    it('should retrieve queued webhooks', () => {
      // Clear any existing events
      const existingEvents = getQueuedWebhooks(100);
      existingEvents.forEach(event => markWebhookProcessed(event.id));

      // Create new events
      queueFailedWebhook(testProvider, 'event1', {}, 'sig1', testTimestamp, 'error1');
      queueFailedWebhook(testProvider, 'event2', {}, 'sig2', testTimestamp, 'error2');

      const queuedEvents = getQueuedWebhooks(10);
      expect(queuedEvents.length).toBe(2);
      expect(queuedEvents.every(e => !e.processed && e.verified === false)).toBe(true);
    });

    it('should retry failed webhooks', () => {
      const event = queueFailedWebhook(
        testProvider,
        'test.event',
        { test: 'data' },
        'invalid_sig',
        testTimestamp,
        'Test error'
      );

      // Create a valid secret for retry
      createWebhookSecret(testProvider, testSecret);
      const validSignature = generateWebhookSignature(
        JSON.stringify(event.payload),
        testSecret,
        event.timestamp
      );

      // Manually set valid signature for test
      event.signature = validSignature;

      const retryResult = retryWebhook(event.id);
      expect(retryResult).toBeDefined();
      expect(retryResult?.isValid).toBe(true);

      // Event should be marked as processed
      const updatedEvent = getWebhookEvents(1)[0];
      expect(updatedEvent.processed).toBe(true);
      expect(updatedEvent.verified).toBe(true);
    });

    it('should limit retry attempts', () => {
      const event = queueFailedWebhook(
        testProvider,
        'test.event',
        { test: 'data' },
        'invalid_sig',
        testTimestamp,
        'Test error'
      );

      // Simulate multiple retries
      for (let i = 0; i < 5; i++) {
        retryWebhook(event.id);
      }

      const updatedEvent = getWebhookEvents(1)[0];
      expect(updatedEvent.retryCount).toBe(3); // Should be capped at 3
    });

    it('should mark webhooks as processed', () => {
      const event = queueFailedWebhook(
        testProvider,
        'test.event',
        { test: 'data' },
        'sig',
        testTimestamp,
        'error'
      );

      const success = markWebhookProcessed(event.id);
      expect(success).toBe(true);

      const updatedEvent = getWebhookEvents(1)[0];
      expect(updatedEvent.processed).toBe(true);
      expect(updatedEvent.processedAt).toBeDefined();
    });
  });

  describe('Webhook Event Retrieval', () => {
    it('should retrieve webhook events with limit', () => {
      // Clear existing events
      const existing = getWebhookEvents(1000);
      existing.forEach(event => markWebhookProcessed(event.id));

      // Create test events
      for (let i = 0; i < 5; i++) {
        queueFailedWebhook(testProvider, `event${i}`, { id: i }, 'sig', testTimestamp, 'error');
      }

      const events = getWebhookEvents(3);
      expect(events.length).toBe(3);

      // Should be ordered by creation date (newest first)
      expect(new Date(events[0].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(events[1].createdAt).getTime()
      );
    });
  });

  describe('Provider-Specific Verification', () => {
    const providers: WebhookProvider[] = ['stripe', 'paypal', 'github', 'custom'];

    it('should handle all supported providers', () => {
      providers.forEach(provider => {
        const secret = createWebhookSecret(provider, testSecret);
        const activeSecret = getActiveSecretForProvider(provider);
        expect(activeSecret).toEqual(secret);
      });
    });

    it('should maintain separate secrets per provider', () => {
      providers.forEach(provider => {
        createWebhookSecret(provider, `${testSecret}_${provider}`);
      });

      providers.forEach(provider => {
        const secret = getActiveSecretForProvider(provider);
        expect(secret?.secret).toBe(`${testSecret}_${provider}`);
      });
    });
  });
});