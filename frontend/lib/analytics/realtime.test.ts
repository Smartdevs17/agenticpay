import { describe, expect, it } from "vitest";
import { parseAnalyticsUpdates, reconnectDelay } from "./realtime";

describe("analytics realtime protocol", () => {
  it("extracts updates from single and batched websocket frames", () => {
    expect(
      parseAnalyticsUpdates(
        '{"type":"analytics:update","payload":{"total":1}}',
      ),
    ).toEqual([{ total: 1 }]);
    expect(
      parseAnalyticsUpdates(
        '[{"type":"pong"},{"type":"analytics:update","payload":{"total":2}}]',
      ),
    ).toEqual([{ total: 2 }]);
  });

  it("ignores malformed and unrelated frames", () => {
    expect(parseAnalyticsUpdates("not-json")).toEqual([]);
    expect(
      parseAnalyticsUpdates('{"type":"payment:update","payload":{}}'),
    ).toEqual([]);
  });

  it("uses bounded exponential reconnect delays", () => {
    expect(reconnectDelay(0)).toBe(1_000);
    expect(reconnectDelay(4)).toBe(16_000);
    expect(reconnectDelay(10)).toBe(30_000);
  });
});
