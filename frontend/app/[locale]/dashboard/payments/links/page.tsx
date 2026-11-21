"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Link2,
  Plus,
  Search,
  Filter,
  BarChart2,
  Share2,
  Sparkles,
  QrCode,
  CheckCircle,
  XCircle,
  ExternalLink,
  Copy,
} from "lucide-react";
import { PaymentLinkSummaryCards } from "@/components/payment/PaymentLinkSummaryCards";
import { PaymentLinkAnalyticsModal, PaymentLinkAnalyticsData } from "@/components/payment/PaymentLinkAnalyticsModal";
import { ABTestConfigModal, ABTestVariantForm } from "@/components/payment/ABTestConfigModal";
import { LinkShareModal } from "@/components/payment/LinkShareModal";

interface PaymentLinkItem {
  id: string;
  merchantId: string;
  slug: string;
  amount: number;
  currency: string;
  description?: string;
  expiresAt: string;
  recurrence: string;
  tags: string[];
  category?: string;
  variants?: ABTestVariantForm[];
  isActive: boolean;
  createdAt: string;
  analytics: {
    views: number;
    completions: number;
    totalRevenue: number;
    conversionRate: number;
    bySource: Record<string, number>;
    variantAnalytics: Record<string, any>;
  };
}

export default function PaymentLinksPage() {
  const [links, setLinks] = useState<PaymentLinkItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  // Modals state
  const [selectedAnalytics, setSelectedAnalytics] = useState<PaymentLinkAnalyticsData | null>(null);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);

  const [abTestLinkId, setAbTestLinkId] = useState<string | null>(null);
  const [abTestVariants, setAbTestVariants] = useState<ABTestVariantForm[]>([]);
  const [isAbTestOpen, setIsAbTestOpen] = useState(false);

  const [shareSlug, setShareSlug] = useState<string | null>(null);
  const [shareDescription, setShareDescription] = useState<string | undefined>();
  const [isShareOpen, setIsShareOpen] = useState(false);

  // Mock initial fetch for merchant links
  useEffect(() => {
    // In production, fetches from /api/payment-links?merchantId=...
    const mockLinks: PaymentLinkItem[] = [
      {
        id: "pl_101",
        merchantId: "m_default",
        slug: "starter-retainer",
        amount: 250,
        currency: "USD",
        description: "Monthly Website Support Retainer",
        expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
        recurrence: "monthly",
        tags: ["retainer", "services"],
        category: "services",
        isActive: true,
        createdAt: new Date().toISOString(),
        variants: [
          { id: "var_a", name: "Standard $250", amount: 250, weight: 50 },
          { id: "var_b", name: "Promo $225", amount: 225, weight: 50, ctaText: "Claim Discount" },
        ],
        analytics: {
          views: 124,
          completions: 42,
          totalRevenue: 10125,
          conversionRate: 33.9,
          bySource: { direct: 50, twitter: 40, newsletter: 34 },
          variantAnalytics: {
            var_a: { variantId: "var_a", name: "Standard $250", views: 60, completions: 18, totalRevenue: 4500, conversionRate: 30.0 },
            var_b: { variantId: "var_b", name: "Promo $225", views: 64, completions: 24, totalRevenue: 5625, conversionRate: 37.5 },
          },
        },
      },
      {
        id: "pl_102",
        merchantId: "m_default",
        slug: "design-audit",
        amount: 150,
        currency: "USD",
        description: "UI/UX Design Audit Session",
        expiresAt: new Date(Date.now() + 86400000 * 14).toISOString(),
        recurrence: "one_time",
        tags: ["audit", "design"],
        category: "consulting",
        isActive: true,
        createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
        analytics: {
          views: 85,
          completions: 28,
          totalRevenue: 4200,
          conversionRate: 32.9,
          bySource: { direct: 35, linkedin: 30, email: 20 },
          variantAnalytics: {},
        },
      },
    ];

    setLinks(mockLinks);
    setLoading(false);
  }, []);

  const summaryData = {
    totalLinks: links.length,
    activeLinks: links.filter((l) => l.isActive).length,
    totalViews: links.reduce((acc, l) => acc + l.analytics.views, 0),
    totalCompletions: links.reduce((acc, l) => acc + l.analytics.completions, 0),
    totalRevenue: links.reduce((acc, l) => acc + l.analytics.totalRevenue, 0),
    overallConversionRate:
      links.reduce((acc, l) => acc + l.analytics.views, 0) > 0
        ? (links.reduce((acc, l) => acc + l.analytics.completions, 0) /
            links.reduce((acc, l) => acc + l.analytics.views, 0)) *
          100
        : 0,
  };

  const filteredLinks = links.filter((l) => {
    const matchesSearch =
      l.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (l.description && l.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
      l.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = categoryFilter === "all" || l.category === categoryFilter;

    return matchesSearch && matchesCategory;
  });

  const handleOpenAnalytics = (link: PaymentLinkItem) => {
    setSelectedAnalytics({
      id: link.id,
      slug: link.slug,
      description: link.description,
      views: link.analytics.views,
      completions: link.analytics.completions,
      totalRevenue: link.analytics.totalRevenue,
      conversionRate: link.analytics.conversionRate,
      bySource: link.analytics.bySource,
      variantAnalytics: link.analytics.variantAnalytics,
    });
    setIsAnalyticsOpen(true);
  };

  const handleOpenAbTest = (link: PaymentLinkItem) => {
    setAbTestLinkId(link.id);
    setAbTestVariants(link.variants || []);
    setIsAbTestOpen(true);
  };

  const handleSaveAbTest = async (id: string, variants: ABTestVariantForm[]) => {
    setLinks((prev) =>
      prev.map((l) => (l.id === id ? { ...l, variants } : l))
    );
  };

  const handleOpenShare = (link: PaymentLinkItem) => {
    setShareSlug(link.slug);
    setShareDescription(link.description);
    setIsShareOpen(true);
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Link2 className="h-7 w-7 text-indigo-600 dark:text-indigo-400" />
            Payment Links & Analytics
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
            Monitor payment conversion tracking, A/B testing performance, QR codes, and sharing tools.
          </p>
        </div>
        <Button className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
          <Plus className="h-4 w-4" /> Create Payment Link
        </Button>
      </div>

      {/* Analytics Summary Cards */}
      <PaymentLinkSummaryCards summary={summaryData} />

      {/* Filters and Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-800 shadow-xs">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search link slug, description, or tag..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="h-4 w-4 text-gray-400" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-gray-700 dark:text-gray-300 focus:outline-none"
          >
            <option value="all">All Categories</option>
            <option value="services">Services</option>
            <option value="consulting">Consulting</option>
            <option value="digital">Digital Goods</option>
          </select>
        </div>
      </div>

      {/* Payment Links Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/40 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="py-3.5 px-4">Payment Link</th>
                  <th className="py-3.5 px-4">Price / A/B Variants</th>
                  <th className="py-3.5 px-4">Views</th>
                  <th className="py-3.5 px-4">Conversions</th>
                  <th className="py-3.5 px-4">Conversion Rate</th>
                  <th className="py-3.5 px-4">Revenue</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {filteredLinks.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-gray-500">
                      No payment links found matching your search criteria.
                    </td>
                  </tr>
                ) : (
                  filteredLinks.map((link) => (
                    <tr key={link.id} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="py-4 px-4 font-medium text-gray-900 dark:text-white">
                        <div className="flex flex-col">
                          <span className="font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                            /r/{link.slug}
                            <a
                              href={`https://pay.agenticpay.com/r/${link.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-gray-400 hover:text-indigo-600"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </span>
                          <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {link.description || "No description"}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex flex-col">
                          <span className="font-semibold text-gray-900 dark:text-white">
                            ${link.amount.toFixed(2)} {link.currency}
                          </span>
                          {link.variants && link.variants.length > 0 ? (
                            <span className="text-xs text-purple-600 dark:text-purple-400 font-medium flex items-center gap-1">
                              <Sparkles className="h-3 w-3" /> {link.variants.length} A/B Variants
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">Standard</span>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-4 text-gray-700 dark:text-gray-300 font-medium">
                        {link.analytics.views.toLocaleString()}
                      </td>
                      <td className="py-4 px-4 text-gray-700 dark:text-gray-300 font-medium">
                        {link.analytics.completions.toLocaleString()}
                      </td>
                      <td className="py-4 px-4 font-semibold text-emerald-600 dark:text-emerald-400">
                        {link.analytics.conversionRate.toFixed(1)}%
                      </td>
                      <td className="py-4 px-4 font-bold text-gray-900 dark:text-white">
                        ${link.analytics.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-4 px-4">
                        {link.isActive ? (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 flex items-center gap-1 w-fit">
                            <CheckCircle className="h-3 w-3" /> Active
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-400 flex items-center gap-1 w-fit">
                            <XCircle className="h-3 w-3" /> Disabled
                          </Badge>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right space-x-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          title="View Analytics"
                          onClick={() => handleOpenAnalytics(link)}
                        >
                          <BarChart2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Configure A/B Testing"
                          onClick={() => handleOpenAbTest(link)}
                        >
                          <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Share & QR Code"
                          onClick={() => handleOpenShare(link)}
                        >
                          <Share2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Analytics Modal */}
      <PaymentLinkAnalyticsModal
        isOpen={isAnalyticsOpen}
        onClose={() => setIsAnalyticsOpen(false)}
        analytics={selectedAnalytics}
      />

      {/* A/B Test Config Modal */}
      {abTestLinkId && (
        <ABTestConfigModal
          isOpen={isAbTestOpen}
          onClose={() => setIsAbTestOpen(false)}
          linkId={abTestLinkId}
          initialVariants={abTestVariants}
          onSave={handleSaveAbTest}
        />
      )}

      {/* Link Share & QR Modal */}
      {shareSlug && (
        <LinkShareModal
          isOpen={isShareOpen}
          onClose={() => setIsShareOpen(false)}
          slug={shareSlug}
          description={shareDescription}
        />
      )}
    </div>
  );
}
