const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
  { pattern: /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]+\b/g, replacement: '[REDACTED_STRIPE_KEY]' },
  { pattern: /\bwhsec_[A-Za-z0-9]+\b/g, replacement: '[REDACTED_WEBHOOK_SECRET]' },
  { pattern: /\bBearer\s+[A-Za-z0-9._-]+\b/gi, replacement: 'Bearer [REDACTED]' },
  { pattern: /\b(?:\d[ -]*?){13,19}\b/g, replacement: '[REDACTED_CARD]' },
];

export function redactPii(value: unknown): unknown {
  if (typeof value === 'string') {
    let out = value;
    for (const { pattern, replacement } of PII_PATTERNS) {
      out = out.replace(pattern, replacement);
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map(redactPii);
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (['password', 'secret', 'token', 'authorization', 'cookie', 'apikey', 'api_key'].some((s) => lower.includes(s))) {
        result[k] = '[REDACTED]';
      } else {
        result[k] = redactPii(v);
      }
    }
    return result;
  }
  return value;
}
