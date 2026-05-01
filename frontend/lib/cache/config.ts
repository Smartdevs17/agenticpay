export const CACHE_REVALIDATE = {
  landing: 900,
  accessibility: 86400,
  publicOverview: 600,
} as const;

export const CACHE_TAGS = {
  landing: "landing-page",
  accessibility: "accessibility-page",
  publicOverview: "public-overview",
  projects: "projects",
  invoices: "invoices",
  payments: "payments",
} as const;

export const CACHE_HEADERS = {
  status: "x-agenticpay-cache-status",
  key: "x-agenticpay-cache-key",
  generatedAt: "x-agenticpay-cache-generated-at",
  age: "x-agenticpay-cache-age",
  revalidateIn: "x-agenticpay-cache-revalidate-in",
  tags: "x-agenticpay-cache-tags",
} as const;

