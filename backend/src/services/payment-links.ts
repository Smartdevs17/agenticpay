import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

type Recurrence = 'one_time' | 'weekly' | 'monthly';

/** Failed password attempts before a protected link is temporarily locked. */
const MAX_PASSWORD_ATTEMPTS = 5;
/** How long a protected link stays locked after exhausting its attempts. */
const PASSWORD_LOCKOUT_MS = 15 * 60 * 1000;

export type ABTestVariant = {
  id: string;
  name: string;
  amount: number;
  description?: string;
  accentColor?: string;
  ctaText?: string;
  weight: number;
};

export type VariantAnalytics = {
  variantId: string;
  name: string;
  views: number;
  completions: number;
  totalRevenue: number;
  conversionRate: number;
};

export type PaymentLinkConversion = {
  id: string;
  linkId: string;
  slug: string;
  variantId?: string;
  amount: number;
  currency: string;
  source: string;
  referrer?: string;
  userAgent?: string;
  timestamp: string;
};

export type PaymentLinkRecord = {
  id: string;
  merchantId: string;
  slug: string;
  amount: number;
  currency: string;
  description?: string;
  expiresAt: string;
  recurrence: Recurrence;
  tags: string[];
  category?: string;
  metadata?: Record<string, string>;
  brand?: {
    brandName: string;
    accentColor?: string;
    logoUrl?: string;
    redirectUrl?: string;
  };
  variants?: ABTestVariant[];
  /** True when the link is password protected. The password itself is never stored. */
  requiresPassword: boolean;
  /** Maximum number of completions allowed before the link auto-disables. `null` = unlimited. */
  maxUses: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  analytics: {
    views: number;
    completions: number;
    totalRevenue: number;
    conversionRate: number;
    bySource: Record<string, number>;
    variantAnalytics: Record<string, VariantAnalytics>;
    lastViewedAt: string | null;
    lastCompletedAt: string | null;
  };
};

/** Internal-only secret material kept out of the public record/JSON responses. */
type PaymentLinkSecret = {
  passwordHash: Buffer;
  passwordSalt: Buffer;
  failedAttempts: number;
  lockedUntil: number | null;
};

type CreatePaymentLinkInput = {
  merchantId: string;
  amount: number;
  currency: string;
  description?: string;
  expiresAt: string;
  recurrence: Recurrence;
  tags: string[];
  category?: string;
  metadata?: Record<string, string>;
  brand?: {
    brandName: string;
    accentColor?: string;
    logoUrl?: string;
    redirectUrl?: string;
  };
  variants?: ABTestVariant[];
  /** Optional password; when set, payers must supply it to view/complete the link. */
  password?: string;
  /** Optional cap on completions; omit for unlimited. */
  maxUses?: number;
};

export type PasswordCheckResult =
  | { ok: true }
  | { ok: false; reason: 'no_password_required' | 'invalid_password' | 'locked'; lockedUntil?: number };

export class PaymentLinksService {
  private links = new Map<string, PaymentLinkRecord>();
  private bySlug = new Map<string, string>();
  private secrets = new Map<string, PaymentLinkSecret>();
  private conversionsMap = new Map<string, PaymentLinkConversion[]>();

  private nowIso(): string {
    return new Date().toISOString();
  }

  private hashPassword(password: string, salt: Buffer): Buffer {
    // scrypt is deliberately slow and memory-hard, which blunts offline
    // brute force if the hashes ever leak.
    return scryptSync(password, salt, 32);
  }

  private generateSlug(): string {
    const entropy = randomBytes(12).toString('base64url');
    const suffix = createHash('sha256').update(entropy).digest('hex').slice(0, 4);
    return `${entropy}${suffix}`.slice(0, 16);
  }

  private buildLinkUrl(slug: string): string {
    return `https://pay.agenticpay.com/r/${slug}`;
  }

  private initVariantAnalytics(variants?: ABTestVariant[]): Record<string, VariantAnalytics> {
    const map: Record<string, VariantAnalytics> = {};
    if (variants && variants.length > 0) {
      for (const v of variants) {
        map[v.id] = {
          variantId: v.id,
          name: v.name,
          views: 0,
          completions: 0,
          totalRevenue: 0,
          conversionRate: 0,
        };
      }
    }
    return map;
  }

  create(input: CreatePaymentLinkInput): PaymentLinkRecord {
    const id = randomUUID();
    const slug = this.generateSlug();
    const now = this.nowIso();

    const variants = input.variants && input.variants.length > 0 ? input.variants : undefined;

    const link: PaymentLinkRecord = {
      id,
      merchantId: input.merchantId,
      slug,
      amount: Number(input.amount.toFixed(2)),
      currency: input.currency.toUpperCase(),
      description: input.description,
      expiresAt: input.expiresAt,
      recurrence: input.recurrence,
      tags: [...new Set(input.tags)],
      category: input.category,
      metadata: input.metadata,
      brand: input.brand,
      variants,
      requiresPassword: typeof input.password === 'string' && input.password.length > 0,
      maxUses: typeof input.maxUses === 'number' ? input.maxUses : null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      analytics: {
        views: 0,
        completions: 0,
        totalRevenue: 0,
        conversionRate: 0,
        bySource: {},
        variantAnalytics: this.initVariantAnalytics(variants),
        lastViewedAt: null,
        lastCompletedAt: null,
      },
    };

    this.links.set(id, link);
    this.bySlug.set(slug, id);
    this.conversionsMap.set(id, []);

    if (link.requiresPassword) {
      const salt = randomBytes(16);
      this.secrets.set(id, {
        passwordHash: this.hashPassword(input.password as string, salt),
        passwordSalt: salt,
        failedAttempts: 0,
        lockedUntil: null,
      });
    }

    return link;
  }

  /**
   * Verify a payer-supplied password for a protected link. Tracks failed
   * attempts per link and locks the link after MAX_PASSWORD_ATTEMPTS to blunt
   * brute-force guessing; a correct password resets the counter.
   */
  verifyPassword(slug: string, password: string): PasswordCheckResult {
    const link = this.getBySlug(slug);
    if (!link || !link.requiresPassword) {
      return { ok: false, reason: 'no_password_required' };
    }

    const secret = this.secrets.get(link.id);
    if (!secret) {
      return { ok: false, reason: 'no_password_required' };
    }

    const now = Date.now();
    if (secret.lockedUntil && secret.lockedUntil > now) {
      return { ok: false, reason: 'locked', lockedUntil: secret.lockedUntil };
    }

    const candidate = this.hashPassword(password, secret.passwordSalt);
    const matches =
      candidate.length === secret.passwordHash.length &&
      timingSafeEqual(candidate, secret.passwordHash);

    if (!matches) {
      secret.failedAttempts += 1;
      if (secret.failedAttempts >= MAX_PASSWORD_ATTEMPTS) {
        secret.lockedUntil = now + PASSWORD_LOCKOUT_MS;
        secret.failedAttempts = 0;
        return { ok: false, reason: 'locked', lockedUntil: secret.lockedUntil };
      }
      return { ok: false, reason: 'invalid_password' };
    }

    secret.failedAttempts = 0;
    secret.lockedUntil = null;
    return { ok: true };
  }

  /** Whether the link has reached its configured completion cap. */
  hasReachedUsageLimit(link: PaymentLinkRecord): boolean {
    return link.maxUses !== null && link.analytics.completions >= link.maxUses;
  }

  bulkCreate(merchantId: string, links: Omit<CreatePaymentLinkInput, 'merchantId'>[]): PaymentLinkRecord[] {
    return links.map((link) => this.create({ ...link, merchantId }));
  }

  getById(id: string): PaymentLinkRecord | undefined {
    return this.links.get(id);
  }

  getBySlug(slug: string): PaymentLinkRecord | undefined {
    const id = this.bySlug.get(slug);
    if (!id) {
      return undefined;
    }
    return this.links.get(id);
  }

  list(filters?: { merchantId?: string; tag?: string; category?: string; includeExpired?: boolean }): PaymentLinkRecord[] {
    const now = Date.now();
    return [...this.links.values()]
      .filter((link) => {
        if (filters?.merchantId && link.merchantId !== filters.merchantId) {
          return false;
        }
        if (filters?.tag && !link.tags.includes(filters.tag)) {
          return false;
        }
        if (filters?.category && link.category !== filters.category) {
          return false;
        }
        if (!filters?.includeExpired && new Date(link.expiresAt).getTime() < now) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  update(id: string, patch: Partial<PaymentLinkRecord>): PaymentLinkRecord | undefined {
    const existing = this.links.get(id);
    if (!existing) {
      return undefined;
    }

    const updated: PaymentLinkRecord = {
      ...existing,
      ...patch,
      id: existing.id,
      slug: existing.slug,
      merchantId: existing.merchantId,
      analytics: existing.analytics,
      updatedAt: this.nowIso(),
    };

    if (patch.variants && patch.variants.length > 0) {
      updated.variants = patch.variants;
      for (const v of patch.variants) {
        if (!updated.analytics.variantAnalytics[v.id]) {
          updated.analytics.variantAnalytics[v.id] = {
            variantId: v.id,
            name: v.name,
            views: 0,
            completions: 0,
            totalRevenue: 0,
            conversionRate: 0,
          };
        } else {
          updated.analytics.variantAnalytics[v.id].name = v.name;
        }
      }
    }

    this.links.set(id, updated);
    return updated;
  }

  addOrUpdateVariants(id: string, variants: ABTestVariant[]): PaymentLinkRecord | undefined {
    const link = this.getById(id);
    if (!link) {
      return undefined;
    }
    return this.update(id, { variants });
  }

  /**
   * Select a variant based on A/B test weights or explicit variant selection.
   */
  selectVariant(link: PaymentLinkRecord, requestedVariantId?: string): ABTestVariant | undefined {
    if (!link.variants || link.variants.length === 0) {
      return undefined;
    }

    if (requestedVariantId) {
      const found = link.variants.find((v) => v.id === requestedVariantId);
      if (found) {
        return found;
      }
    }

    const totalWeight = link.variants.reduce((sum, v) => sum + Math.max(0, v.weight), 0);
    if (totalWeight <= 0) {
      return link.variants[0];
    }

    let random = Math.random() * totalWeight;
    for (const v of link.variants) {
      if (random < v.weight) {
        return v;
      }
      random -= v.weight;
    }

    return link.variants[0];
  }

  expire(id: string): PaymentLinkRecord | undefined {
    const link = this.links.get(id);
    if (!link) {
      return undefined;
    }

    link.isActive = false;
    link.expiresAt = this.nowIso();
    link.updatedAt = this.nowIso();
    this.links.set(id, link);
    return link;
  }

  trackView(slug: string, source = 'direct', variantId?: string): PaymentLinkRecord | undefined {
    const link = this.getBySlug(slug);
    if (!link) {
      return undefined;
    }

    link.analytics.views += 1;
    link.analytics.lastViewedAt = this.nowIso();
    link.analytics.bySource[source] = (link.analytics.bySource[source] || 0) + 1;

    link.analytics.conversionRate = Number(
      ((link.analytics.completions / link.analytics.views) * 100).toFixed(2)
    );

    if (variantId && link.analytics.variantAnalytics[variantId]) {
      const vAnalytic = link.analytics.variantAnalytics[variantId];
      vAnalytic.views += 1;
      vAnalytic.conversionRate = Number(
        ((vAnalytic.completions / vAnalytic.views) * 100).toFixed(2)
      );
    }

    link.updatedAt = this.nowIso();
    this.links.set(link.id, link);
    return link;
  }

  complete(
    slug: string,
    source = 'direct',
    variantId?: string,
    amountPaid?: number,
    metadata?: { referrer?: string; userAgent?: string }
  ): PaymentLinkRecord | undefined {
    const link = this.getBySlug(slug);
    if (!link) {
      return undefined;
    }

    let completionAmount = link.amount;
    if (variantId && link.variants) {
      const matchedVariant = link.variants.find((v) => v.id === variantId);
      if (matchedVariant) {
        completionAmount = matchedVariant.amount;
      }
    }
    if (typeof amountPaid === 'number' && amountPaid > 0) {
      completionAmount = amountPaid;
    }

    link.analytics.completions += 1;
    link.analytics.totalRevenue = Number((link.analytics.totalRevenue + completionAmount).toFixed(2));
    link.analytics.lastCompletedAt = this.nowIso();
    link.analytics.bySource[source] = (link.analytics.bySource[source] || 0) + 1;

    link.analytics.conversionRate = Number(
      ((link.analytics.completions / link.analytics.views) * 100).toFixed(2)
    );

    if (variantId && link.analytics.variantAnalytics[variantId]) {
      const vAnalytic = link.analytics.variantAnalytics[variantId];
      vAnalytic.completions += 1;
      vAnalytic.totalRevenue = Number((vAnalytic.totalRevenue + completionAmount).toFixed(2));
      vAnalytic.conversionRate = Number(
        ((vAnalytic.completions / Math.max(1, vAnalytic.views)) * 100).toFixed(2)
      );
    }

    const conversionRecord: PaymentLinkConversion = {
      id: randomUUID(),
      linkId: link.id,
      slug: link.slug,
      variantId,
      amount: completionAmount,
      currency: link.currency,
      source,
      referrer: metadata?.referrer,
      userAgent: metadata?.userAgent,
      timestamp: this.nowIso(),
    };

    const existingConversions = this.conversionsMap.get(link.id) || [];
    existingConversions.push(conversionRecord);
    this.conversionsMap.set(link.id, existingConversions);

    // Disable once it is a single-use link or has hit its usage cap.
    if (link.recurrence === 'one_time' || this.hasReachedUsageLimit(link)) {
      link.isActive = false;
    }

    link.updatedAt = this.nowIso();
    this.links.set(link.id, link);
    return link;
  }

  getConversions(linkId: string): PaymentLinkConversion[] {
    return this.conversionsMap.get(linkId) || [];
  }

  getMerchantDashboardSummary(merchantId: string) {
    const merchantLinks = this.list({ merchantId, includeExpired: true });
    const totalLinks = merchantLinks.length;
    const activeLinks = merchantLinks.filter((l) => l.isActive).length;
    const totalViews = merchantLinks.reduce((sum, l) => sum + l.analytics.views, 0);
    const totalCompletions = merchantLinks.reduce((sum, l) => sum + l.analytics.completions, 0);
    const totalRevenue = merchantLinks.reduce((sum, l) => sum + (l.analytics.totalRevenue || 0), 0);
    const overallConversionRate = totalViews > 0 ? Number(((totalCompletions / totalViews) * 100).toFixed(2)) : 0;

    const topLinks = [...merchantLinks]
      .sort((a, b) => (b.analytics.totalRevenue || 0) - (a.analytics.totalRevenue || 0))
      .slice(0, 5)
      .map((l) => ({
        id: l.id,
        slug: l.slug,
        description: l.description || l.slug,
        amount: l.amount,
        currency: l.currency,
        views: l.analytics.views,
        completions: l.analytics.completions,
        conversionRate: l.analytics.conversionRate,
        totalRevenue: l.analytics.totalRevenue,
      }));

    return {
      merchantId,
      totalLinks,
      activeLinks,
      totalViews,
      totalCompletions,
      totalRevenue: Number(totalRevenue.toFixed(2)),
      overallConversionRate,
      topLinks,
    };
  }

  isUsable(link: PaymentLinkRecord): boolean {
    if (!link.isActive) {
      return false;
    }
    if (this.hasReachedUsageLimit(link)) {
      return false;
    }
    return new Date(link.expiresAt).getTime() > Date.now();
  }

  getQrCodeUrl(slug: string): string {
    return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(this.buildLinkUrl(slug))}`;
  }

  async getQrCodeDataUrl(slug: string, type: 'data-url' | 'svg' = 'data-url'): Promise<string> {
    const url = this.buildLinkUrl(slug);
    try {
      const qrcodeModule = await import('qrcode');
      const QRCode = qrcodeModule.default || qrcodeModule;
      if (type === 'svg') {
        return await QRCode.toString(url, { type: 'svg', margin: 2, width: 300 });
      }
      return await QRCode.toDataURL(url, { margin: 2, width: 300 });
    } catch {
      if (type === 'svg') {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="#ffffff"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#000000">QR Code: /r/${slug}</text></svg>`;
      }
      return this.getQrCodeUrl(slug);
    }
  }

  getShareLinks(slug: string, variantId?: string, source?: string): {
    url: string;
    twitter: string;
    whatsapp: string;
    linkedin: string;
    telegram: string;
    email: string;
    embedCode: string;
  } {
    let url = this.buildLinkUrl(slug);
    const queryParams: string[] = [];
    if (variantId) {
      queryParams.push(`variant=${encodeURIComponent(variantId)}`);
    }
    if (source) {
      queryParams.push(`source=${encodeURIComponent(source)}`);
    }
    if (queryParams.length > 0) {
      url += `?${queryParams.join('&')}`;
    }

    const encoded = encodeURIComponent(url);
    const text = encodeURIComponent('Complete your payment securely with AgenticPay');

    return {
      url,
      twitter: `https://twitter.com/intent/tweet?url=${encoded}&text=${text}`,
      whatsapp: `https://wa.me/?text=${text}%20${encoded}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`,
      telegram: `https://t.me/share/url?url=${encoded}&text=${text}`,
      email: `mailto:?subject=Payment%20Link&body=${text}%0A%0A${encoded}`,
      embedCode: `<iframe src="${url}" width="100%" height="600" frameborder="0" allow="payment"></iframe>`,
    };
  }

  resetForTests(): void {
    this.links.clear();
    this.bySlug.clear();
    this.secrets.clear();
    this.conversionsMap.clear();
  }
}

export const paymentLinksService = new PaymentLinksService();