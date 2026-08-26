import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ChartType = 'line' | 'bar' | 'pie' | 'table' | 'heatmap' | 'area';

export interface ReportConfig {
  name: string;
  description: string;
  metrics: string[];
  dimensions: string[];
  filters: Record<string, unknown>;
  chartType: ChartType;
  dateRange: {
    preset?: 'last7d' | 'last30d' | 'thisMonth' | 'custom';
    start?: string;
    end?: string;
  };
}

export interface SavedReport extends ReportConfig {
  id: string;
  isFavorite: boolean;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ReportBuilderState {
  currentStep: number;
  config: ReportConfig;
  savedReports: SavedReport[];
  templates: SavedReport[];
  isSaving: boolean;
  isLoading: boolean;
  error: string | null;

  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  updateConfig: (updates: Partial<ReportConfig>) => void;
  setMetric: (metric: string) => void;
  removeMetric: (metric: string) => void;
  setDimension: (dimension: string) => void;
  removeDimension: (dimension: string) => void;
  setChartType: (type: ChartType) => void;
  setDateRange: (range: ReportConfig['dateRange']) => void;
  setFilter: (key: string, value: unknown) => void;
  reset: () => void;
  loadReports: (tenantId: string) => Promise<void>;
  saveReport: (tenantId: string) => Promise<void>;
  loadTemplates: () => Promise<void>;
}

const defaultConfig: ReportConfig = {
  name: '',
  description: '',
  metrics: [],
  dimensions: [],
  filters: {},
  chartType: 'line',
  dateRange: { preset: 'last30d' },
};

export const useReportBuilderStore = create<ReportBuilderState>()(
  persist(
    (set, get) => ({
      currentStep: 0,
      config: { ...defaultConfig },
      savedReports: [],
      templates: [],
      isSaving: false,
      isLoading: false,
      error: null,

      setStep: (step) => set({ currentStep: step }),
      nextStep: () => set((s) => ({ currentStep: Math.min(s.currentStep + 1, 3) })),
      prevStep: () => set((s) => ({ currentStep: Math.max(s.currentStep - 1, 0) })),

      updateConfig: (updates) => set((s) => ({ config: { ...s.config, ...updates } })),
      setMetric: (metric) => set((s) => ({
        config: { ...s.config, metrics: [...new Set([...s.config.metrics, metric])] },
      })),
      removeMetric: (metric) => set((s) => ({
        config: { ...s.config, metrics: s.config.metrics.filter((m) => m !== metric) },
      })),
      setDimension: (dimension) => set((s) => ({
        config: { ...s.config, dimensions: [...new Set([...s.config.dimensions, dimension])] },
      })),
      removeDimension: (dimension) => set((s) => ({
        config: { ...s.config, dimensions: s.config.dimensions.filter((d) => d !== dimension) },
      })),
      setChartType: (chartType) => set((s) => ({ config: { ...s.config, chartType } })),
      setDateRange: (dateRange) => set((s) => ({ config: { ...s.config, dateRange } })),
      setFilter: (key, value) => set((s) => ({
        config: { ...s.config, filters: { ...s.config.filters, [key]: value } },
      })),

      reset: () => set({ config: { ...defaultConfig }, currentStep: 0, error: null }),

      loadReports: async (tenantId) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch(`/api/v1/reports`, {
            headers: { 'x-tenant-id': tenantId },
          });
          const data = await res.json();
          set({ savedReports: data.reports ?? [], isLoading: false });
        } catch (err) {
          set({ error: (err as Error).message, isLoading: false });
        }
      },

      saveReport: async (tenantId) => {
        const { config } = get();
        if (!config.name) {
          set({ error: 'Report name is required' });
          return;
        }
        set({ isSaving: true, error: null });
        try {
          const res = await fetch('/api/v1/reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
            body: JSON.stringify(config),
          });
          const report = await res.json();
          set((s) => ({
            savedReports: [report, ...s.savedReports],
            isSaving: false,
            config: { ...defaultConfig },
            currentStep: 0,
          }));
        } catch (err) {
          set({ error: (err as Error).message, isSaving: false });
        }
      },

      loadTemplates: async () => {
        try {
          const res = await fetch('/api/v1/reports/templates/list');
          const data = await res.json();
          set({ templates: data.templates ?? [] });
        } catch {
          // silently fail
        }
      },
    }),
    {
      name: 'agenticpay-report-builder',
      partialize: (state) => ({ config: state.config, currentStep: state.currentStep }),
    },
  ),
);
