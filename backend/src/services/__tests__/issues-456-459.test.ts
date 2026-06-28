import { describe, expect, it } from 'vitest';
import { WebhookTemplateService, renderTemplate, validateTemplate } from '../webhooks/template-engine.js';
import { PayoutEngine } from '../payouts/payout-engine.js';
import { TaggingService } from '../tags/tagging-service.js';

describe('Webhook Template Engine (Issue 456)', () => {
  const service = new WebhookTemplateService();

  it('renders simple variables and helpers correctly', () => {
    const template = 'Event: {{event}}, Amount: {{formatCurrency amount}}, Date: {{dateFormat date}}';
    const data = {
      event: 'payment.succeeded',
      amount: 15.5,
      date: '2026-06-28T09:00:00Z',
    };
    const result = renderTemplate(template, data);
    expect(result).toContain('Event: payment.succeeded');
    expect(result).toContain('$15.50');
    expect(result).toContain('June 28, 2026');
  });

  it('evaluates conditional block correctly', () => {
    const template = 'Status: {{#if is_premium}}Premium{{/if}}';
    expect(renderTemplate(template, { is_premium: true })).toBe('Status: Premium');
    expect(renderTemplate(template, { is_premium: false })).toBe('Status: ');
  });

  it('processes array loops correctly', () => {
    const template = 'Items:{{#each items}} - {{this}}{{/each}}';
    const result = renderTemplate(template, { items: ['apple', 'orange'] });
    expect(result).toBe('Items: - apple - orange');
  });

  it('validates syntax and falls back to default JSON on failure', () => {
    const brokenTemplate = '{{#if missing}}';
    expect(() => validateTemplate(brokenTemplate)).toThrow();
    
    const sample = { id: 'evt_1' };
    const rendered = service.previewRender(brokenTemplate, sample);
    expect(rendered).toBe(JSON.stringify(sample));
  });
});

describe('Payout Engine (Issue 457)', () => {
  it('triggers payouts based on thresholds and schedule types', async () => {
    const engine = new PayoutEngine();
    engine.configureSchedule({
      id: 'sch_1',
      merchantId: 'merch_1',
      scheduleType: 'threshold',
      thresholdAmount: 100,
      preferredAsset: 'USDC',
      autoApproveLimit: 500,
    });

    engine.setPendingAmount('merch_1', 50);
    let batches = await engine.evaluatePayouts();
    expect(batches).toHaveLength(0);

    engine.setPendingAmount('merch_1', 150);
    batches = await engine.evaluatePayouts();
    expect(batches).toHaveLength(1);
    expect(batches[0].status).toBe('completed');
  });

  it('requires manual review and supports approval flow above autoApproveLimit', async () => {
    const engine = new PayoutEngine();
    engine.configureSchedule({
      id: 'sch_2',
      merchantId: 'merch_2',
      scheduleType: 'threshold',
      thresholdAmount: 100,
      preferredAsset: 'USDC',
      autoApproveLimit: 500,
    });

    engine.setPendingAmount('merch_2', 600);
    const batches = await engine.evaluatePayouts();
    expect(batches).toHaveLength(1);
    expect(batches[0].status).toBe('pending');

    const approved = await engine.approveManualPayout(batches[0].id);
    expect(approved).toBe(true);
    expect(batches[0].status).toBe('completed');
  });
});

describe('Transaction Tagging and Rule Engine (Issue 459)', () => {
  const service = new TaggingService();

  it('automatically suggests categories based on tx memo and amounts', () => {
    const refundTx = { id: 'tx_1', amount: 10, sender: 'A', receiver: 'B', memo: 'Refund payment', tags: [] };
    const subscriptionTx = { id: 'tx_2', amount: 20, sender: 'A', receiver: 'B', memo: 'Sub_Monthly_Plan', tags: [] };
    
    expect(service.suggestCategory(refundTx).category).toBe('refund');
    expect(service.suggestCategory(subscriptionTx).category).toBe('subscription');
  });

  it('applies custom merchant tag rules based on regex and ranges', () => {
    service.addRule({
      id: 'rule_1',
      merchantId: 'merch_1',
      tagName: 'HighValue_Stellar',
      minAmount: 1000,
    });

    const tx = { id: 'tx_3', amount: 1500, sender: 'A', receiver: 'B', tags: [] };
    const tags = service.evaluateRules('merch_1', tx);
    expect(tags).toContain('HighValue_Stellar');
  });

  it('supports bulk tag additions and removals', () => {
    const txList = [
      { id: 'tx_4', amount: 10, sender: 'A', receiver: 'B', tags: ['old_tag'] },
    ];
    const updated = service.bulkEditTags(txList, 'new_tag', 'old_tag');
    expect(updated[0].tags).toContain('new_tag');
    expect(updated[0].tags).not.toContain('old_tag');
  });
});
