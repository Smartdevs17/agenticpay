"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Link2, Eye, CheckCircle2, TrendingUp, DollarSign } from "lucide-react";

interface PaymentLinkSummaryCardsProps {
  summary: {
    totalLinks: number;
    activeLinks: number;
    totalViews: number;
    totalCompletions: number;
    totalRevenue: number;
    overallConversionRate: number;
  };
}

export function PaymentLinkSummaryCards({ summary }: PaymentLinkSummaryCardsProps) {
  const cards = [
    {
      title: "Total Payment Links",
      value: summary.totalLinks.toLocaleString(),
      subtext: `${summary.activeLinks} active links`,
      icon: Link2,
      color: "text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400",
    },
    {
      title: "Total Views",
      value: summary.totalViews.toLocaleString(),
      subtext: "Impressions recorded",
      icon: Eye,
      color: "text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 dark:text-indigo-400",
    },
    {
      title: "Total Conversions",
      value: summary.totalCompletions.toLocaleString(),
      subtext: "Successful payments",
      icon: CheckCircle2,
      color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400",
    },
    {
      title: "Conversion Rate",
      value: `${summary.overallConversionRate.toFixed(1)}%`,
      subtext: "Avg link conversion",
      icon: TrendingUp,
      color: "text-purple-600 bg-purple-50 dark:bg-purple-900/20 dark:text-purple-400",
    },
    {
      title: "Total Revenue",
      value: `$${summary.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      subtext: "Generated via links",
      icon: DollarSign,
      color: "text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <Card key={idx} className="border shadow-xs hover:shadow-md transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  {card.title}
                </span>
                <div className={`p-2.5 rounded-xl ${card.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {card.value}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {card.subtext}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
