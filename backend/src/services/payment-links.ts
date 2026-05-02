import { createHash, randomBytes, randomUUID } from 'node:crypto';

type Recurrence = 'one_time' | 'weekly' | 'monthly';

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
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  analytics: {
    views: number;
    completions: number;
    bySource: Record<string, number>;
    lastViewedAt: string | null;
    lastCompletedAt: string | null;
  };
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
};

export class PaymentLinksService {
  private links = new Map<string, PaymentLinkRecord>();
  private bySlug = new Map<string, string>();

  private nowIso(): string {
    return new Date().toISOString();
  }

  private generateSlug(): string {
    const entropy = randomBytes(12).toString('base64url');
    const suffix = createHash('sha256').update(entropy).digest('hex').slice(0, 4);
    return `${entropy}${suffix}`.slice(0, 16);
  }

  private buildLinkUrl(slug: string): string {
    return `https://pay.agenticpay.com/r/${slug}`;
  }

  create(input: CreatePaymentLinkInput): PaymentLinkRecord {
    const id = randomUUID();
    const slug = this.generateSlug();
    const now = this.nowIso();

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
      isActive: true,
      createdAt: now,
      updatedAt: now,
      analytics: {
        views: 0,
        completions: 0,
        bySource: {},
        lastViewedAt: null,
        lastCompletedAt: null,
      },
    };

    this.links.set(id, link);
    this.bySlug.set(slug, id);
    return link;
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

    this.links.set(id, updated);
    return updated;
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

  trackView(slug: string, source = 'direct'): PaymentLinkRecord | undefined {
    const link = this.getBySlug(slug);
    if (!link) {
      return undefined;
    }

    link.analytics.views += 1;
    link.analytics.lastViewedAt = this.nowIso();
    link.analytics.bySource[source] = (link.analytics.bySource[source] || 0) + 1;
    link.updatedAt = this.nowIso();
    this.links.set(link.id, link);
    return link;
  }

  complete(slug: string, source = 'direct'): PaymentLinkRecord | undefined {
    const link = this.getBySlug(slug);
    if (!link) {
      return undefined;
    }

    link.analytics.completions += 1;
    link.analytics.lastCompletedAt = this.nowIso();
    link.analytics.bySource[source] = (link.analytics.bySource[source] || 0) + 1;

    if (link.recurrence === 'one_time') {
      link.isActive = false;
    }

    link.updatedAt = this.nowIso();
    this.links.set(link.id, link);
    return link;
  }

  isUsable(link: PaymentLinkRecord): boolean {
    if (!link.isActive) {
      return false;
    }
    return new Date(link.expiresAt).getTime() > Date.now();
  }

  getQrCodeUrl(slug: string): string {
    return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(this.buildLinkUrl(slug))}`;
  }

  getShareLinks(slug: string): { url: string; twitter: string; whatsapp: string; email: string } {
    const url = this.buildLinkUrl(slug);
    const encoded = encodeURIComponent(url);
    return {
      url,
      twitter: `https://twitter.com/intent/tweet?url=${encoded}`,
      whatsapp: `https://wa.me/?text=${encoded}`,
      email: `mailto:?subject=Payment%20Link&body=${encoded}`,
    };
  }

  resetForTests(): void {
    this.links.clear();
    this.bySlug.clear();
  }
}

export const paymentLinksService = new PaymentLinksService();