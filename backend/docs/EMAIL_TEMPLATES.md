# Email Template System — Issue #727

AgenticPay uses a **component-based email templating engine** built on Handlebars for composable, maintainable email generation.

## Architecture

### Template Registry (`src/templates/registry.ts`)

Type-safe template definitions with Zod schema validation:

```typescript
export const TEMPLATE_REGISTRY = {
  'welcome-email': {
    id: 'welcome-email',
    version: 1,
    schema: z.object({
      name: z.string().min(1),
      actionUrl: z.string().url(),
    }),
    subject: 'Welcome to AgenticPay, {{name}}!',
    contentHtml: `
      <h1>Welcome, {{name}}!</h1>
      <p>We're excited to have you on board.</p>
      {{> button url=actionUrl label="Get started"}}
    `,
  },
  // ... more templates
};
```

### Template Engine (`src/services/email-template-engine.ts`)

Renders templates with Handlebars helpers and reusable components:

```typescript
const engine = new EmailTemplateEngine();
const rendered = engine.renderWithLayout(contentHtml, context);
```

### Reusable Components (`src/templates/components/`)

- **header.hbs** — Email header with branding
- **footer.hbs** — Email footer with unsubscribe link
- **button.hbs** — CTA button styling
- **layout.hbs** — Main email layout (composes header/footer)

## Using Components in Templates

Include components with Handlebars partials:

```handlebars
{{> header}}
<p>Your email content here</p>
{{> button url=myUrl label="Click Me"}}
{{> footer}}
```

The layout automatically wraps components with header/footer.

## Adding a New Template

1. Define in `src/templates/registry.ts`:

```typescript
const newTemplate: TemplateDefinition = {
  id: 'invoice-ready',
  version: 1,
  schema: z.object({
    invoiceId: z.string(),
    amount: z.number(),
  }),
  subject: 'Invoice {{invoiceId}} is ready',
  contentHtml: `
    <h1>Invoice Ready</h1>
    <p>Amount: {{formatCurrency amount}}</p>
    {{> button url="/invoices/{{invoiceId}}" label="View Invoice"}}
  `,
};
```

2. Export from registry:

```typescript
export const TEMPLATE_REGISTRY = {
  // ... existing templates
  'invoice-ready': newTemplate,
};
```

3. Use in code:

```typescript
engine.renderEmail(template.subject, template.contentHtml, null, {
  invoiceId: '123',
  amount: 500,
});
```

## Handlebars Helpers

Built-in helpers for formatting:

- `{{formatDate date}}` — Date formatting
- `{{formatCurrency amount currency}}` — Currency formatting
- `{{formatNumber num decimals}}` — Number formatting
- `{{eq a b}}` — Equality check
- `{{truncate str length}}` — String truncation
- `{{uppercase str}}` — Uppercase conversion
- `{{join array separator}}` — Array joining

## A/B Testing

Templates support variants for experimentation:

```typescript
variants: [
  { 
    id: 'control', 
    weight: 50, 
    subject: 'Welcome!', 
    contentHtml: '...' 
  },
  { 
    id: 'urgency', 
    weight: 50, 
    subject: 'Your account is ready', 
    contentHtml: '...' 
  },
];
```

Bucketing is deterministic per recipient.

## Validation

Schemas are automatically validated before rendering:

```typescript
const result = renderEmail(template, {
  name: 'John', // Required ✓
  actionUrl: 'not-a-url', // Schema validation error
});
```

## See Also

- [Handlebars Docs](https://handlebarsjs.com/)
- [Template Registry](../src/templates/registry.ts)
- [Email Template Engine](../src/services/email-template-engine.ts)
