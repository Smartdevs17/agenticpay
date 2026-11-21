import { unstable_cache } from "next/cache";
import { CACHE_REVALIDATE, CACHE_TAGS } from "@/lib/cache/config";
import type { CacheEnvelope } from "@/lib/cache/headers";
import { mockProjects } from "@/lib/mock-data/projects";
import { mockInvoices } from "@/lib/mock-data/invoices";
import { mockPayments } from "@/lib/mock-data/payments";

export interface LandingSnapshot {
  totals: {
    activeProjects: number;
    paidInvoices: number;
    completedPayments: number;
    totalVolumeUsd: string;
  };
  featuredProjects: Array<{
    id: string;
    title: string;
    status: string;
    amount: string;
    currency: string;
  }>;
}

export interface AccessibilitySnapshot {
  lastUpdated: string;
  commitments: string[];
  supportItems: string[];
}

function createEnvelope<T>(
  cacheKey: string,
  tags: string[],
  revalidateAfterSeconds: number,
  data: T
): CacheEnvelope<T> {
  return {
    cacheKey,
    tags,
    revalidateAfterSeconds,
    generatedAt: new Date().toISOString(),
    data,
  };
}

export const getLandingSnapshot = unstable_cache(
  async (): Promise<CacheEnvelope<LandingSnapshot>> => {
    const totalVolume = mockPayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const paidInvoices = mockInvoices.filter((invoice) => invoice.status === "paid").length;
    const completedPayments = mockPayments.filter((payment) => payment.status === "completed").length;
    const activeProjects = mockProjects.filter((project) => project.status === "active").length;

    return createEnvelope(
      "landing-snapshot",
      [CACHE_TAGS.landing, CACHE_TAGS.publicOverview, CACHE_TAGS.projects, CACHE_TAGS.invoices, CACHE_TAGS.payments],
      CACHE_REVALIDATE.landing,
      {
        totals: {
          activeProjects,
          paidInvoices,
          completedPayments,
          totalVolumeUsd: totalVolume.toLocaleString("en-US"),
        },
        featuredProjects: mockProjects.slice(0, 3).map((project) => ({
          id: project.id,
          title: project.title,
          status: project.status,
          amount: project.totalAmount,
          currency: project.currency,
        })),
      }
    );
  },
  ["landing-snapshot"],
  {
    revalidate: CACHE_REVALIDATE.landing,
    tags: [CACHE_TAGS.landing, CACHE_TAGS.publicOverview, CACHE_TAGS.projects, CACHE_TAGS.invoices, CACHE_TAGS.payments],
  }
);

export const getAccessibilitySnapshot = unstable_cache(
  async (): Promise<CacheEnvelope<AccessibilitySnapshot>> => {
    return createEnvelope(
      "accessibility-snapshot",
      [CACHE_TAGS.accessibility],
      CACHE_REVALIDATE.accessibility,
      {
        lastUpdated: "March 25, 2026",
        commitments: [
          "Design flows that work with keyboard navigation and visible focus states.",
          "Use semantic structure, readable content, and clear labels for interactive elements.",
          "Review motion and contrast choices so the interface stays comfortable to use.",
          "Keep improving accessibility as new product areas and integrations ship.",
        ],
        supportItems: [
          "Tell us which page or feature caused trouble.",
          "Share the device, browser, and any assistive technology you were using.",
          "Include screenshots or exact steps when possible so we can reproduce the issue faster.",
        ],
      }
    );
  },
  ["accessibility-snapshot"],
  {
    revalidate: CACHE_REVALIDATE.accessibility,
    tags: [CACHE_TAGS.accessibility],
  }
);

export const getPublicOverviewSnapshot = unstable_cache(
  async (): Promise<
    CacheEnvelope<{
      projects: number;
      invoices: number;
      payments: number;
      overdueInvoices: number;
      pendingInvoices: number;
    }>
  > => {
    return createEnvelope(
      "public-overview",
      [CACHE_TAGS.publicOverview, CACHE_TAGS.projects, CACHE_TAGS.invoices, CACHE_TAGS.payments],
      CACHE_REVALIDATE.publicOverview,
      {
        projects: mockProjects.length,
        invoices: mockInvoices.length,
        payments: mockPayments.length,
        overdueInvoices: mockInvoices.filter((invoice) => invoice.status === "overdue").length,
        pendingInvoices: mockInvoices.filter((invoice) => invoice.status === "pending").length,
      }
    );
  },
  ["public-overview"],
  {
    revalidate: CACHE_REVALIDATE.publicOverview,
    tags: [CACHE_TAGS.publicOverview, CACHE_TAGS.projects, CACHE_TAGS.invoices, CACHE_TAGS.payments],
  }
);

export async function warmPublicCaches() {
  return Promise.all([
    getLandingSnapshot(),
    getAccessibilitySnapshot(),
    getPublicOverviewSnapshot(),
  ]);
}

