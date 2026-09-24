import { describe, expect, it } from "vitest";
import { buildReportPayload, validateReportConfig } from "./report-config";
import type { ReportConfig } from "../../store/report-builder-store";

const valid: ReportConfig = {
  name: " Revenue ",
  description: " Monthly ",
  metrics: ["revenue"],
  dimensions: ["network"],
  filters: { network: " stellar ", ignored: "value", status: "" },
  chartType: "line",
  dateRange: { preset: "last30d" },
};

describe("report configuration", () => {
  it("normalizes supported filters before persistence", () => {
    expect(buildReportPayload(valid)).toMatchObject({
      name: "Revenue",
      description: "Monthly",
      filters: { network: "stellar" },
    });
  });

  it("requires metrics, dimensions, and a valid custom range", () => {
    expect(validateReportConfig({ ...valid, metrics: [] })).toBe(
      "Select at least one metric",
    );
    expect(
      validateReportConfig({
        ...valid,
        dateRange: { preset: "custom", start: "2026-09-02", end: "2026-09-01" },
      }),
    ).toBe("Start date must be before end date");
    expect(validateReportConfig(valid)).toBeNull();
  });
});
