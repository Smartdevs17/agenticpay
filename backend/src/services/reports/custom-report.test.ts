import { describe, expect, it } from "vitest";
import { buildReportRows } from "./report-aggregation";

describe("custom report aggregation", () => {
  it("groups filtered payment data into selected dimensions and metrics", () => {
    const rows = buildReportRows(
      [
        {
          amount: "10",
          status: "completed",
          currency: "XLM",
          network: "stellar",
          createdAt: new Date("2026-09-01"),
          userId: "u1",
        },
        {
          amount: "5",
          status: "failed",
          currency: "XLM",
          network: "stellar",
          createdAt: new Date("2026-09-01"),
          userId: "u2",
        },
      ],
      ["revenue", "tx_count", "success_rate", "unique_users"],
      ["chain", "currency"],
    );

    expect(rows).toEqual([
      {
        chain: "stellar",
        currency: "XLM",
        revenue: 15,
        tx_count: 2,
        success_rate: 50,
        unique_users: 2,
      },
    ]);
  });
});
