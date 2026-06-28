'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Filter, Loader2, BarChart3, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import { useDashboardData } from '@/lib/hooks/useDashboardData';
import { EmptyState } from '@/components/empty/EmptyState';
import { formatDateInTimeZone } from '@/lib/utils';
import { useAuthStore } from '@/store/useAuthStore';

type TaxReportData = {
  id: string;
  taxableAmount: number;
  taxRate: number;
  taxDue: number;
  country: string;
  period: string;
  invoiceCount: number;
  currency: string;
};

export default function TaxReportsPage() {
  const { invoices, loading } = useDashboardData();
  const timezone = useAuthStore((state) => state.timezone);
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());

  const taxReports = useMemo(() => {
    if (!invoices.length) return [];

    const reportMap = new Map<string, TaxReportData>();

    invoices.forEach((invoice) => {
      const invoiceDate = new Date(invoice.generatedAt);
      const invoiceYear = invoiceDate.getFullYear().toString();
      const country = invoice.country || 'US';
      const key = `${country}-${invoiceYear}`;

      const existing = reportMap.get(key) || {
        id: key,
        taxableAmount: 0,
        taxRate: 0.15,
        taxDue: 0,
        country,
        period: invoiceYear,
        invoiceCount: 0,
        currency: invoice.currency,
      };

      existing.taxableAmount += Number(invoice.amount) || 0;
      existing.invoiceCount += 1;
      existing.taxDue = existing.taxableAmount * existing.taxRate;

      reportMap.set(key, existing);
    });

    return Array.from(reportMap.values());
  }, [invoices]);

  const filteredReports = useMemo(() => {
    return taxReports.filter((report) => {
      if (selectedCountry && report.country !== selectedCountry) return false;
      if (selectedYear && report.period !== selectedYear) return false;
      return true;
    });
  }, [taxReports, selectedCountry, selectedYear]);

  const countries = useMemo(() => {
    return Array.from(new Set(taxReports.map((r) => r.country)));
  }, [taxReports]);

  const years = useMemo(() => {
    return Array.from(new Set(taxReports.map((r) => r.period))).sort().reverse();
  }, [taxReports]);

  const totalTaxDue = useMemo(() => {
    return filteredReports.reduce((sum, report) => sum + report.taxDue, 0);
  }, [filteredReports]);

  const downloadReport = (report: TaxReportData) => {
    const csv = `Tax Report\n\nCountry: ${report.country}\nPeriod: ${report.period}\n\nTax Summary\nTaxable Amount: ${report.taxableAmount}\nTax Rate: ${(report.taxRate * 100).toFixed(2)}%\nTax Due: ${report.taxDue.toFixed(2)}\nInvoices: ${report.invoiceCount}\n`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tax-report-${report.country}-${report.period}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Tax Reports</h1>
          <p className="text-gray-600 mt-1">Track and download your tax compliance reports</p>
          <div className="mt-2 inline-flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading reports...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Tax Reports</h1>
        <p className="text-gray-600 mt-1">Track and download your tax compliance reports</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(280px,320px)_1fr]">
        <Card className="border border-gray-200">
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Filter className="h-4 w-4" />
              Refine tax reports by country and year.
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Country</label>
              <select
                value={selectedCountry}
                onChange={(e) => setSelectedCountry(e.target.value)}
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">All Countries</option>
                {countries.map((country) => (
                  <option key={country} value={country}>
                    {country}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Year</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(e.target.value)}
                className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">All Years</option>
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <Button
              type="button"
              onClick={() => {
                setSelectedCountry('');
                setSelectedYear(new Date().getFullYear().toString());
              }}
              className="w-full"
              variant="outline"
              size="sm"
            >
              Reset Filters
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {filteredReports.length > 0 && (
            <Card className="border border-blue-200 bg-blue-50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Total Tax Due</p>
                    <p className="text-3xl font-bold text-gray-900 mt-1">
                      ${totalTaxDue.toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-500 mt-2">
                      Across {filteredReports.length} report{filteredReports.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <BarChart3 className="h-12 w-12 text-blue-600 opacity-20" />
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4">
            {filteredReports.map((report, index) => (
              <motion.div
                key={report.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card className="hover:shadow-lg transition-all border border-gray-200">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-3">
                          <FileText className="h-5 w-5 text-gray-600" />
                          <h3 className="text-lg font-semibold text-gray-900">
                            {report.country} - {report.period}
                          </h3>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs text-gray-500">Taxable Income</p>
                            <p className="text-lg font-semibold text-gray-900">
                              {report.currency} {report.taxableAmount.toFixed(2)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500">Tax Rate</p>
                            <p className="text-lg font-semibold text-gray-900">
                              {(report.taxRate * 100).toFixed(1)}%
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500">Tax Due</p>
                            <p className="text-lg font-semibold text-red-600">
                              {report.currency} {report.taxDue.toFixed(2)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500">Invoices</p>
                            <p className="text-lg font-semibold text-gray-900">
                              {report.invoiceCount}
                            </p>
                          </div>
                        </div>
                      </div>

                      <Button
                        onClick={() => downloadReport(report)}
                        variant="outline"
                        size="sm"
                        className="ml-4"
                      >
                        <Download className="h-4 w-4 mr-2" />
                        Download
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {filteredReports.length === 0 && (
            <Card>
              <CardContent className="p-0">
                <EmptyState
                  icon={FileText}
                  title="No tax reports found"
                  description="Generate invoices to create tax reports."
                  action={{
                    label: 'View Invoices',
                    onClick: () => window.location.href = '/dashboard/invoices',
                  }}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
