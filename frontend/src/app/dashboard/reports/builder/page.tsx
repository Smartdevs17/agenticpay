"use client";

import React, { useEffect } from 'react';
import { useReportBuilderStore } from '../../../store/report-builder-store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

const METRICS = [
  { id: 'request_count', label: 'Request Count' },
  { id: 'total_amount', label: 'Total Amount' },
  { id: 'avg_latency', label: 'Avg Latency' },
  { id: 'success_rate', label: 'Success Rate' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'tx_count', label: 'Transaction Count' },
  { id: 'fees', label: 'Fees' },
  { id: 'unique_users', label: 'Unique Users' },
];

const DIMENSIONS = [
  { id: 'date', label: 'Date' },
  { id: 'chain', label: 'Chain' },
  { id: 'currency', label: 'Currency' },
  { id: 'merchant', label: 'Merchant' },
  { id: 'status', label: 'Status' },
  { id: 'endpoint', label: 'Endpoint' },
];

const CHART_TYPES = [
  { id: 'line' as const, label: 'Line', icon: '📈' },
  { id: 'bar' as const, label: 'Bar', icon: '📊' },
  { id: 'pie' as const, label: 'Pie', icon: '🥧' },
  { id: 'table' as const, label: 'Table', icon: '📋' },
  { id: 'heatmap' as const, label: 'Heatmap', icon: '🗺️' },
  { id: 'area' as const, label: 'Area', icon: '📉' },
];

const DATE_PRESETS = [
  { id: 'last7d' as const, label: 'Last 7 Days' },
  { id: 'last30d' as const, label: 'Last 30 Days' },
  { id: 'thisMonth' as const, label: 'This Month' },
  { id: 'custom' as const, label: 'Custom Range' },
];

export default function ReportBuilderPage() {
  const {
    currentStep, config, savedReports, templates,
    isSaving, isLoading, error,
    setStep, nextStep, prevStep, updateConfig,
    setMetric, removeMetric, setDimension, removeDimension,
    setChartType, setDateRange,
    reset, loadReports, saveReport, loadTemplates,
  } = useReportBuilderStore();

  const tenantId = 't_123';

  useEffect(() => {
    loadReports(tenantId);
    loadTemplates();
  }, [loadReports, loadTemplates, tenantId]);

  const handleSave = async () => {
    await saveReport(tenantId);
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8 text-gray-900">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">Custom Report Builder</h1>
          <div className="space-x-3">
            <Button variant="outline" onClick={reset}>Reset</Button>
            <Button onClick={handleSave} disabled={isSaving || !config.name}>
              {isSaving ? 'Saving...' : 'Save Report'}
            </Button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        <div className="flex items-center space-x-2 mb-6">
          {['Configure Metrics', 'Select Dimensions', 'Choose Chart', 'Review'].map((label, i) => (
            <React.Fragment key={label}>
              <button
                onClick={() => setStep(i)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                  currentStep === i
                    ? 'bg-blue-600 text-white'
                    : currentStep > i
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-200 text-gray-500'
                }`}
              >
                {i + 1}. {label}
              </button>
              {i < 3 && <div className="w-8 h-0.5 bg-gray-300" />}
            </React.Fragment>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 space-y-6">
            {currentStep === 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Select Metrics</CardTitle>
                  <CardDescription>Choose the data points to include in your report</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    {METRICS.map((metric) => {
                      const isSelected = config.metrics.includes(metric.id);
                      return (
                        <button
                          key={metric.id}
                          onClick={() => isSelected ? removeMetric(metric.id) : setMetric(metric.id)}
                          className={`p-3 rounded-lg border text-left transition ${
                            isSelected
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="font-medium">{metric.label}</div>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {currentStep === 1 && (
              <Card>
                <CardHeader>
                  <CardTitle>Select Dimensions</CardTitle>
                  <CardDescription>Choose how to group and filter your data</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3">
                    {DIMENSIONS.map((dim) => {
                      const isSelected = config.dimensions.includes(dim.id);
                      return (
                        <button
                          key={dim.id}
                          onClick={() => isSelected ? removeDimension(dim.id) : setDimension(dim.id)}
                          className={`p-3 rounded-lg border text-left transition ${
                            isSelected
                              ? 'border-purple-500 bg-purple-50 text-purple-700'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="font-medium">{dim.label}</div>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {currentStep === 2 && (
              <Card>
                <CardHeader>
                  <CardTitle>Choose Visualization</CardTitle>
                  <CardDescription>Select how your report data will be displayed</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <Label className="mb-2 block">Chart Type</Label>
                    <div className="grid grid-cols-3 gap-3">
                      {CHART_TYPES.map((ct) => (
                        <button
                          key={ct.id}
                          onClick={() => setChartType(ct.id)}
                          className={`p-4 rounded-lg border text-center transition ${
                            config.chartType === ct.id
                              ? 'border-green-500 bg-green-50 text-green-700'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="text-2xl mb-1">{ct.icon}</div>
                          <div className="font-medium text-sm">{ct.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="mb-2 block">Date Range</Label>
                    <div className="flex gap-2 mb-3">
                      {DATE_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          onClick={() => setDateRange({ ...config.dateRange, preset: preset.id })}
                          className={`px-3 py-1.5 rounded-full text-sm transition ${
                            config.dateRange.preset === preset.id
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 hover:bg-gray-200'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    {config.dateRange.preset === 'custom' && (
                      <div className="flex gap-3">
                        <Input
                          type="date"
                          value={config.dateRange.start ?? ''}
                          onChange={(e) => setDateRange({ ...config.dateRange, start: e.target.value })}
                          placeholder="Start date"
                        />
                        <Input
                          type="date"
                          value={config.dateRange.end ?? ''}
                          onChange={(e) => setDateRange({ ...config.dateRange, end: e.target.value })}
                          placeholder="End date"
                        />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {currentStep === 3 && (
              <Card>
                <CardHeader>
                  <CardTitle>Review Report</CardTitle>
                  <CardDescription>Review your report configuration before saving</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>Report Name</Label>
                    <Input
                      value={config.name}
                      onChange={(e) => updateConfig({ name: e.target.value })}
                      placeholder="My Custom Report"
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea
                      value={config.description}
                      onChange={(e) => updateConfig({ description: e.target.value })}
                      placeholder="Brief description of this report"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="mb-1 block">Selected Metrics</Label>
                      <div className="flex flex-wrap gap-1">
                        {config.metrics.map((m) => (
                          <Badge key={m} variant="secondary">{METRICS.find((mt) => mt.id === m)?.label ?? m}</Badge>
                        ))}
                      </div>
                    </div>
                    <div>
                      <Label className="mb-1 block">Selected Dimensions</Label>
                      <div className="flex flex-wrap gap-1">
                        {config.dimensions.map((d) => (
                          <Badge key={d} variant="secondary">{DIMENSIONS.find((dm) => dm.id === d)?.label ?? d}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div>
                    <Label>Chart Type</Label>
                    <p className="text-sm text-gray-600">{CHART_TYPES.find((ct) => ct.id === config.chartType)?.label}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={prevStep} disabled={currentStep === 0}>Previous</Button>
              <Button onClick={nextStep} disabled={currentStep === 3}>
                {currentStep === 3 ? 'Complete' : 'Next'}
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Saved Reports</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <p className="text-sm text-gray-500">Loading...</p>
                ) : savedReports.length === 0 ? (
                  <p className="text-sm text-gray-500">No saved reports yet</p>
                ) : (
                  <div className="space-y-2">
                    {savedReports.slice(0, 5).map((report) => (
                      <div key={report.id} className="p-2 rounded border border-gray-100 hover:bg-gray-50 cursor-pointer">
                        <div className="font-medium text-sm truncate">{report.name}</div>
                        <div className="text-xs text-gray-500">{report.chartType} chart</div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Templates</CardTitle>
              </CardHeader>
              <CardContent>
                {templates.length === 0 ? (
                  <p className="text-sm text-gray-500">No templates available</p>
                ) : (
                  <div className="space-y-2">
                    {templates.slice(0, 3).map((t) => (
                      <div key={t.id} className="p-2 rounded border border-gray-100 hover:bg-gray-50 cursor-pointer">
                        <div className="font-medium text-sm truncate">{t.name}</div>
                        <div className="text-xs text-gray-500">{t.description}</div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
