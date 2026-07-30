"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Eye, CheckCircle, DollarSign, TrendingUp, Sparkles, Globe } from "lucide-react";

interface VariantAnalytic {
  variantId: string;
  name: string;
  views: number;
  completions: number;
  totalRevenue: number;
  conversionRate: number;
}

interface ConversionRecord {
  id: string;
  amount: number;
  currency: string;
  source: string;
  variantId?: string;
  timestamp: string;
}

export interface PaymentLinkAnalyticsData {
  id: string;
  slug: string;
  description?: string;
  views: number;
  completions: number;
  totalRevenue: number;
  conversionRate: number;
  bySource: Record<string, number>;
  variantAnalytics: Record<string, VariantAnalytic>;
  conversions?: ConversionRecord[];
}

interface PaymentLinkAnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  analytics: PaymentLinkAnalyticsData | null;
}

export function PaymentLinkAnalyticsModal({
  isOpen,
  onClose,
  analytics,
}: PaymentLinkAnalyticsModalProps) {
  if (!analytics) return null;

  const variantList = Object.values(analytics.variantAnalytics || {});

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              Payment Link Performance & Conversion Analytics
            </DialogTitle>
            <Badge variant="outline" className="font-mono">
              /r/{analytics.slug}
            </Badge>
          </div>
          <DialogDescription>
            {analytics.description || "Detailed performance, conversion rates, and A/B test variant metrics."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Key KPI Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <Eye className="h-4 w-4 text-blue-500" /> Views
              </div>
              <p className="text-2xl font-bold mt-1">{analytics.views.toLocaleString()}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <CheckCircle className="h-4 w-4 text-emerald-500" /> Conversions
              </div>
              <p className="text-2xl font-bold mt-1">{analytics.completions.toLocaleString()}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <TrendingUp className="h-4 w-4 text-purple-500" /> Conversion Rate
              </div>
              <p className="text-2xl font-bold mt-1 text-purple-600 dark:text-purple-400">
                {analytics.conversionRate.toFixed(1)}%
              </p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2 text-gray-500 text-sm">
                <DollarSign className="h-4 w-4 text-amber-500" /> Total Revenue
              </div>
              <p className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">
                ${(analytics.totalRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {/* A/B Test Variant Performance Breakdown */}
          {variantList.length > 0 && (
            <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-indigo-500" /> A/B Testing Variant Metrics
                </h4>
                <span className="text-xs text-gray-500">{variantList.length} Variants Active</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-800 text-xs text-gray-500 uppercase bg-gray-50/50 dark:bg-gray-900/50">
                      <th className="py-2.5 px-3">Variant Name</th>
                      <th className="py-2.5 px-3">Views</th>
                      <th className="py-2.5 px-3">Conversions</th>
                      <th className="py-2.5 px-3">Conversion Rate</th>
                      <th className="py-2.5 px-3">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {variantList.map((v) => (
                      <tr key={v.variantId} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                        <td className="py-2.5 px-3 font-medium text-gray-900 dark:text-white">
                          {v.name}
                        </td>
                        <td className="py-2.5 px-3 text-gray-600 dark:text-gray-300">{v.views}</td>
                        <td className="py-2.5 px-3 text-gray-600 dark:text-gray-300">{v.completions}</td>
                        <td className="py-2.5 px-3 font-semibold text-emerald-600 dark:text-emerald-400">
                          {v.conversionRate.toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-3 font-medium text-gray-900 dark:text-white">
                          ${v.totalRevenue.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Traffic Sources Breakdown */}
          <div className="border border-gray-200 dark:border-gray-800 rounded-xl p-4 space-y-3">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Globe className="h-4 w-4 text-blue-500" /> Traffic Sources Breakdown
            </h4>
            {Object.keys(analytics.bySource || {}).length === 0 ? (
              <p className="text-xs text-gray-500 italic">No traffic source data available yet.</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(analytics.bySource).map(([src, count]) => {
                  const percentage = analytics.views > 0 ? (count / analytics.views) * 100 : 0;
                  return (
                    <div key={src} className="space-y-1">
                      <div className="flex justify-between text-xs font-medium">
                        <span className="capitalize text-gray-700 dark:text-gray-300">{src}</span>
                        <span className="text-gray-500">{count} hits ({percentage.toFixed(0)}%)</span>
                      </div>
                      <div className="w-full bg-gray-100 dark:bg-gray-800 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-blue-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
