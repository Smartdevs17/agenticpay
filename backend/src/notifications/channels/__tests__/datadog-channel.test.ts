import { describe, it, expect, beforeEach, vi } from "vitest";
import { DatadogChannel } from "../datadog-channel";
import type { Notification } from "../../channel-interface";

const notification: Notification = {
  id: "n-1",
  userId: "u-1",
  eventType: "payout.delayed",
  title: "Payout delayed",
  body: "Payout for merchant M-1 is delayed",
  priority: "high",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("DatadogChannel", () => {
  let channel: DatadogChannel;

  beforeEach(() => {
    channel = new DatadogChannel({
      apiKey: "test-api-key",
      maxPerHour: 100,
      maxPerDay: 1000,
    });
    vi.restoreAllMocks();
  });

  it("is disabled without an API key", () => {
    const disabled = new DatadogChannel({
      apiKey: "",
      maxPerHour: 100,
      maxPerDay: 1000,
    });
    expect(disabled.enabled).toBe(false);
  });

  it("maps high priority to a warning alert type", async () => {
    const formatted = (await channel.format(notification)) as {
      alert_type: string;
    };
    expect(formatted.alert_type).toBe("warning");
  });

  it("sends an event to the Datadog Events API", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ event: { id: 42 } }),
    }) as unknown as typeof fetch;

    const result = await channel.send(notification);

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("42");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.datadoghq.com/api/v1/events",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "DD-API-KEY": "test-api-key" }),
      }),
    );
  });

  it("submits a raw metric", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;

    const ok = await channel.submitMetric("agenticpay.payouts.delayed", 1);

    expect(ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.datadoghq.com/api/v2/series",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
