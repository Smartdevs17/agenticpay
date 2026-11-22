import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTemplate,
  getTemplate,
  listTemplates,
  addStep,
  reorderSteps,
  cloneTemplate,
  getUsageCount,
  validateTemplate,
  instantiateWorkflow,
  resetForTests,
} from '../templates.js';

describe('templates service & customizable workflows (#1360)', () => {
  beforeEach(() => {
    resetForTests();
  });

  it('creates, lists, validates, and clones project templates', () => {
    const tpl = createTemplate({
      name: 'Escrow Payout Workflow',
      description: 'Standard milestone payout flow',
      category: 'payments',
      createdBy: 'alice',
      isPublic: true,
      variables: [
        { name: 'recipient', type: 'string', required: true },
        { name: 'amount', type: 'number', defaultValue: 100, required: false },
      ],
      steps: [
        {
          id: 'step-1',
          name: 'Notify Recipient',
          type: 'notification',
          order: 1,
          config: { to: '{{recipient}}', message: 'Paying {{amount}} USDC' },
        },
      ],
    });

    expect(getTemplate(tpl.id)?.name).toBe('Escrow Payout Workflow');
    expect(listTemplates({ category: 'payments', isPublic: true })).toHaveLength(1);
    expect(validateTemplate(tpl)).toEqual({ valid: true, errors: [] });

    const cloned = cloneTemplate(tpl.id, { name: 'Custom Payout' });
    expect(cloned?.name).toBe('Custom Payout');
    expect(cloned?.id).not.toBe(tpl.id);
  });

  it('instantiates a customizable workflow with variable interpolation and step overrides', () => {
    const tpl = createTemplate({
      name: 'Agent Milestone',
      description: 'Customizable agent workflow',
      category: 'agents',
      createdBy: 'alice',
      isPublic: true,
      variables: [
        { name: 'recipient', type: 'string', required: true },
        { name: 'amount', type: 'number', defaultValue: 250, required: false },
        { name: 'notify', type: 'boolean', defaultValue: true, required: false },
      ],
      steps: [
        {
          id: 's-pay',
          name: 'Release Funds',
          type: 'action',
          order: 2,
          config: { to: '{{recipient}}', amount: '{{amount}}', asset: 'USDC' },
        },
        {
          id: 's-check',
          name: 'Verify Deliverable',
          type: 'condition',
          order: 1,
          config: { notify: '{{notify}}', threshold: 0.9 },
        },
      ],
    });

    const added = addStep(tpl.id, {
      name: 'Post Receipt',
      type: 'notification',
      config: { channel: 'webhook' },
    });
    expect(added).toBeDefined();
    expect(reorderSteps(tpl.id, ['s-check', 's-pay', added!.id])).toBe(true);

    const wf = instantiateWorkflow(tpl.id, {
      workspaceId: 'ws-1',
      variables: { recipient: 'GALICE' },
      stepOverrides: { 's-check': { threshold: 0.95 } },
    });

    expect(wf.templateId).toBe(tpl.id);
    expect(wf.steps.map((s) => s.id)).toEqual(['s-check', 's-pay', added!.id]);
    expect(wf.steps[0].config).toEqual({ notify: true, threshold: 0.95 });
    expect(wf.steps[1].config).toEqual({ to: 'GALICE', amount: 250, asset: 'USDC' });
    expect(getUsageCount(tpl.id)).toBe(1);
  });

  it('rejects missing required variables, invalid types, and unknown templates', () => {
    expect(() => instantiateWorkflow('missing-tpl')).toThrow(/not found/i);

    const tpl = createTemplate({
      name: 'Strict Template',
      description: 'Requires typed variables',
      category: 'finance',
      createdBy: 'bob',
      isPublic: false,
      variables: [
        { name: 'budget', type: 'number', required: true },
      ],
      steps: [],
    });

    expect(() => instantiateWorkflow(tpl.id, { variables: {} })).toThrow(
      /Missing required template variable: budget/,
    );
    expect(() =>
      instantiateWorkflow(tpl.id, { variables: { budget: 'not-a-number' } }),
    ).toThrow(/Invalid type for template variable "budget"/);
  });
});
