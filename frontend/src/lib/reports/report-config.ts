import type { ReportConfig } from "../../store/report-builder-store";

const ALLOWED_FILTERS = new Set(["status", "network", "currency", "merchant"]);

export function normalizeReportFilters(
  filters: Record<string, unknown>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filters)
      .filter(
        ([key, value]) =>
          ALLOWED_FILTERS.has(key) && typeof value === "string" && value.trim(),
      )
      .map(([key, value]) => [key, (value as string).trim()]),
  );
}

export function validateReportConfig(config: ReportConfig): string | null {
  if (!config.name.trim()) return "Report name is required";
  if (config.metrics.length === 0) return "Select at least one metric";
  if (config.dimensions.length === 0) return "Select at least one dimension";
  if (config.dateRange.preset === "custom") {
    if (!config.dateRange.start || !config.dateRange.end)
      return "Custom date ranges require start and end dates";
    if (new Date(config.dateRange.start) > new Date(config.dateRange.end))
      return "Start date must be before end date";
  }
  return null;
}

export function buildReportPayload(config: ReportConfig): ReportConfig {
  return {
    ...config,
    name: config.name.trim(),
    description: config.description.trim(),
    filters: normalizeReportFilters(config.filters),
  };
}
