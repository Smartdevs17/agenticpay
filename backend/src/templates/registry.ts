import { z } from 'zod';
import EmailTemplateEngine from '../services/email-template-engine.js';
import type { RenderedTemplate } from '../services/email-template-engine.js';

const engine = new EmailTemplateEngine();

/**
 * Type-safe, component-based email template registry. Each entry owns a Zod
 * schema for its variables (validated at render time) plus content HTML that
 * composes shared components (`{{> button}}`, etc.) — the layout/header/
 * footer chrome is applied uniformly via `engine.renderWithLayout`.
 * Optional `variants` enable A/B testing of subject/content per template.
 */
export interface TemplateVariant {
  id: string;
  weight: number;
  subject: string;
  contentHtml: string;
}

export interface TemplateDefinition<Schema extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string;
  version: number;
  schema: Schema;
  subject: string;
  contentHtml: string;
  variants?: TemplateVariant[];
}

const welcomeSchema = z.object({
  name: z.string().min(1),
  actionUrl: z.string().url(),
});

const paymentReceivedSchema = z.object({
  name: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(2).max(8),
  sender: z.string().min(1),
  transactionId: z.string().min(1),
});

export const TEMPLATE_REGISTRY = {
  'welcome-email': {
    id: 'welcome-email',
    version: 1,
    schema: welcomeSchema,
    subject: 'Welcome to AgenticPay, {{name}}!',
    contentHtml: `
      <h1 style="margin:0 0 12px;font-size:20px;">Welcome, {{name}}!</h1>
      <p>We're excited to have you on board.</p>
      {{> button url=actionUrl label="Get started"}}
    `,
    variants: [
      { id: 'control', weight: 50, subject: 'Welcome to AgenticPay, {{name}}!', contentHtml: `<h1>Welcome, {{name}}!</h1><p>We're excited to have you on board.</p>{{> button url=actionUrl label="Get started"}}` },
      { id: 'urgency', weight: 50, subject: '{{name}}, your AgenticPay account is ready', contentHtml: `<h1>You're all set, {{name}}</h1><p>Complete setup now to unlock instant payments.</p>{{> button url=actionUrl label="Finish setup"}}` },
    ],
  },
  'payment-received': {
    id: 'payment-received',
    version: 1,
    schema: paymentReceivedSchema,
    subject: 'Payment of {{formatCurrency amount currency}} received',
    contentHtml: `
      <h1 style="margin:0 0 12px;font-size:20px;">Payment received</h1>
      <p>Hi {{name}}, you've received a payment of <strong>{{formatCurrency amount currency}}</strong> from {{sender}}.</p>
      <p style="color:#6b7280;font-size:13px;">Transaction ID: {{transactionId}}</p>
    `,
  },
} as const satisfies Record<string, TemplateDefinition>;

export type TemplateId = keyof typeof TEMPLATE_REGISTRY;
export type TemplateVariables<K extends TemplateId> = z.infer<(typeof TEMPLATE_REGISTRY)[K]['schema']>;

/** Deterministic A/B bucketing: same recipient always gets the same variant for a given template. */
function selectVariant(def: TemplateDefinition, bucketKey: string): { id: string; subject: string; contentHtml: string } {
  if (!def.variants || def.variants.length === 0) {
    return { id: 'default', subject: def.subject, contentHtml: def.contentHtml };
  }
  let hash = 0;
  for (let i = 0; i < bucketKey.length; i++) hash = (hash * 31 + bucketKey.charCodeAt(i)) >>> 0;
  const totalWeight = def.variants.reduce((sum, v) => sum + v.weight, 0);
  let cursor = hash % totalWeight;
  for (const variant of def.variants) {
    if (cursor < variant.weight) return variant;
    cursor -= variant.weight;
  }
  return def.variants[0];
}

/**
 * Validates `variables` against the template's Zod schema (compile-time via
 * the generic, runtime via `.parse`), selects an A/B variant deterministically
 * per `bucketKey` (e.g. recipient email), and renders through the shared
 * layout. Throws a ZodError on invalid variables — callers should surface
 * that as a 400 rather than silently sending a broken email.
 */
export function renderTypedTemplate<K extends TemplateId>(
  templateId: K,
  variables: TemplateVariables<K>,
  bucketKey = 'default',
): RenderedTemplate & { templateId: K; version: number; variant: string } {
  const def = TEMPLATE_REGISTRY[templateId] as TemplateDefinition;
  const parsed = def.schema.parse(variables);
  const variant = selectVariant(def, bucketKey);

  const htmlBody = engine.renderWithLayout(variant.contentHtml, parsed);
  const subject = engine.render(variant.subject, parsed);

  return {
    templateId,
    version: def.version,
    variant: variant.id,
    subject,
    htmlBody,
    textBody: htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    missingVariables: [],
  };
}

export function listTemplates() {
  return Object.values(TEMPLATE_REGISTRY).map((def) => ({
    id: def.id,
    version: def.version,
    variants: def.variants?.map((v) => v.id) ?? ['default'],
  }));
}
