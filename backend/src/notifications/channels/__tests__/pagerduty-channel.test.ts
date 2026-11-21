import { describe, it, expect, beforeEach, vi } from "vitest";
import { PagerDutyChannel } from "../pagerduty-channel";
import type { Notification } from "../../channel-interface";

const notification: Notification = {
  id: "n-1",
  userId: "u-1",
  eventType: "payment.failed",
  title: "Payment failed",
  body: "Payment for invoice INV-1 failed",
  priority: "urgent",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("PagerDutyChannel", () => {
  let channel: PagerDutyChannel;

  beforeEach(() => {
    channel = new PagerDutyChannel({
      routingKey: "test-routing-key",
      maxPerHour: 30,
      maxPerDay: 200,
    });
    vi.restoreAllMocks();
  });

  it("is disabled without a routing key", () => {
    const disabled = new PagerDutyChannel({
      routingKey: "",
      maxPerHour: 30,
      maxPerDay: 200,
    });
    expect(disabled.enabled).toBe(false);
  });

  it("maps urgent priority to critical severity", async () => {
    const formatted = (await channel.format(notification)) as {
      payload: { severity: string };
    };
    expect(formatted.payload.severity).toBe("critical");
  });

  it("triggers an incident via the Events API", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ dedup_key: "n-1" }),
    }) as unknown as typeof fetch;

    const result = await channel.send(notification);

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("n-1");
    expect(fetch).toHaveBeenCalledWith(
      "https://events.pagerduty.com/v2/enqueue",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns a failure result when the API errors", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, statusText: "Bad Request" }) as unknown as typeof fetch;

    const result = await channel.send(notification);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Bad Request");
  });
});
