import { describe, expect, it } from 'vitest';
import { SlackIntegrationService } from '../slack-integration.js';

describe('SlackIntegrationService', () => {
  it('validates webhook URLs and never exposes them in listings', () => {
    const service = new SlackIntegrationService();
    service.configure({ id: 'billing', webhookUrl: 'https://hooks.slack.com/services/T000/B000/secret' });

    expect(service.list()).toEqual([{ id: 'billing', webhookUrl: '[redacted]', enabled: true }]);
    expect(() => service.configure({ id: 'invalid', webhookUrl: 'https://example.com/hook' })).toThrow(/Invalid Slack/);
  });
});