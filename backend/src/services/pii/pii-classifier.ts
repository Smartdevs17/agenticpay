/**
 * PII Classification Engine (#668)
 *
 * Detects and classifies PII in arbitrary JSON blobs or strings.
 * Supports three classification levels (strict, standard, permissive)
 * and is fully configurable with custom patterns.
 */

export type PiiType =
  | 'email'
  | 'phone'
  | 'ssn'
  | 'credit_card'
  | 'crypto_address'
  | 'api_key'
  | 'ip_address'
  | 'date_of_birth'
  | 'passport'
  | 'custom';

export type ClassificationLevel = 'strict' | 'standard' | 'permissive';

export interface PiiPattern {
  type: PiiType | string;
  regex: RegExp;
  /** Minimum severity level at which this pattern is active */
  minLevel: ClassificationLevel;
  /** Replace matched groups with this mask instead of full redaction */
  mask?: string;
}

export interface DetectedPii {
  type: PiiType | string;
  path: string;       // JSON pointer, e.g. "/user/email"
  original?: string;  // only populated when level === 'strict' (for audit, never logged)
  masked: string;
}

export interface ClassificationResult {
  detections: DetectedPii[];
  redacted: Record<string, unknown>;
}

// ─── Default patterns ─────────────────────────────────────────────────────────

const LEVEL_ORDER: Record<ClassificationLevel, number> = {
  strict: 0,
  standard: 1,
  permissive: 2,
};

const DEFAULT_PATTERNS: PiiPattern[] = [
  {
    type: 'email',
    regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    minLevel: 'permissive',
    mask: '***@***.***',
  },
  {
    type: 'phone',
    regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g,
    minLevel: 'standard',
    mask: '***-***-****',
  },
  {
    type: 'ssn',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    minLevel: 'permissive',
    mask: '***-**-****',
  },
  {
    type: 'credit_card',
    regex: /\b(?:4\d{3}|5[1-5]\d{2}|6011|3[47]\d{2})[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g,
    minLevel: 'permissive',
    mask: '**** **** **** ****',
  },
  {
    type: 'crypto_address',
    // Stellar (G... 56 chars), EVM (0x...), Bitcoin
    regex: /\b(?:G[A-Z2-7]{54,55}|0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g,
    minLevel: 'strict',
    mask: '[CRYPTO_ADDR]',
  },
  {
    type: 'api_key',
    // sk_*, pk_*, Bearer tokens
    regex: /\b(?:sk|pk|api)_(?:live|test|[a-z]+)_[a-zA-Z0-9_\-]{16,}\b/g,
    minLevel: 'permissive',
    mask: '[API_KEY_REDACTED]',
  },
  {
    type: 'ip_address',
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    minLevel: 'strict',
    mask: '*.*.*.*',
  },
];

// ─── Classifier ───────────────────────────────────────────────────────────────

export class PiiClassifier {
  private patterns: PiiPattern[];
  private level: ClassificationLevel;

  constructor(level: ClassificationLevel = 'standard', extraPatterns: PiiPattern[] = []) {
    this.level = level;
    this.patterns = [...DEFAULT_PATTERNS, ...extraPatterns];
  }

  /** Scan a raw string and return detections */
  scanString(value: string, path = '/'): DetectedPii[] {
    const detections: DetectedPii[] = [];
    for (const pattern of this.patterns) {
      // Pattern is active when our level is AT LEAST as strict as pattern.minLevel
      // strict(0) <= strict(0) ✓   strict(0) <= permissive(2) ✓
      // permissive(2) <= strict(0) ✗  → permissive mode skips strict-only patterns
      if (LEVEL_ORDER[this.level] > LEVEL_ORDER[pattern.minLevel]) continue;
      const re = new RegExp(pattern.regex.source, pattern.regex.flags.includes('g') ? 'g' : 'g');
      let match: RegExpExecArray | null;
      while ((match = re.exec(value)) !== null) {
        detections.push({
          type: pattern.type,
          path,
          masked: pattern.mask ?? '[REDACTED]',
        });
      }
    }
    return detections;
  }

  /** Deep-scan a JSON object, redacting in place (returns a clone) */
  classify(obj: unknown, basePath = ''): ClassificationResult {
    const detections: DetectedPii[] = [];
    const redacted = this.redactValue(obj, basePath, detections);
    return { detections, redacted: redacted as Record<string, unknown> };
  }

  private redactValue(value: unknown, path: string, detections: DetectedPii[]): unknown {
    if (typeof value === 'string') {
      return this.redactString(value, path, detections);
    }
    if (Array.isArray(value)) {
      return value.map((item, i) => this.redactValue(item, `${path}/${i}`, detections));
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.redactValue(v, `${path}/${k}`, detections);
      }
      return out;
    }
    return value;
  }

  private redactString(value: string, path: string, detections: DetectedPii[]): string {
    let result = value;
    for (const pattern of this.patterns) {
      if (LEVEL_ORDER[this.level] > LEVEL_ORDER[pattern.minLevel]) continue;
      const re = new RegExp(pattern.regex.source, pattern.regex.flags.includes('g') ? 'g' : 'g');
      if (re.test(value)) {
        detections.push({ type: pattern.type, path, masked: pattern.mask ?? '[REDACTED]' });
        const re2 = new RegExp(pattern.regex.source, 'g');
        result = result.replace(re2, pattern.mask ?? '[REDACTED]');
      }
    }
    return result;
  }

  /** Add a custom pattern at runtime */
  addPattern(p: PiiPattern): void {
    this.patterns.push(p);
  }

  setLevel(level: ClassificationLevel): void {
    this.level = level;
  }
}

// Default singleton
export const piiClassifier = new PiiClassifier('standard');
