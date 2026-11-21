import { describe, it, expect, vi } from "vitest";
import { LinearIssueService } from "../linear-issue-service";
import { LinearClient } from "../linear-client";

describe("LinearIssueService", () => {
  it("creates a Linear issue from a trackable event", async () => {
    const client = new LinearClient({ apiKey: "k", teamId: "team-1" });
    const createIssueSpy = vi.spyOn(client, "createIssue").mockResolvedValue({
      id: "issue-1",
      identifier: "OPS-1",
      url: "https://linear.app/agenticpay/issue/OPS-1",
    });

    const service = new LinearIssueService(client);
    const issue = await service.trackEvent({
      eventType: "dispute.opened",
      title: "Dispute opened for charge ch_123",
      body: "A dispute was opened.",
      data: { chargeId: "ch_123" },
    });

    expect(issue.identifier).toBe("OPS-1");
    expect(createIssueSpy).toHaveBeenCalledWith(
      "Dispute opened for charge ch_123",
      expect.stringContaining("dispute.opened"),
    );
  });

  it("resolves an issue by updating its state", async () => {
    const client = new LinearClient({ apiKey: "k", teamId: "team-1" });
    const updateSpy = vi
      .spyOn(client, "updateIssueState")
      .mockResolvedValue(undefined);

    const service = new LinearIssueService(client);
    await service.resolve("issue-1", "state-done");

    expect(updateSpy).toHaveBeenCalledWith("issue-1", "state-done");
  });
});
