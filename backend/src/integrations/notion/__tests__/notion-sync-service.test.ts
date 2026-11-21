import { describe, it, expect, vi } from "vitest";
import { NotionSyncService } from "../notion-sync-service";
import { NotionClient } from "../notion-client";

describe("NotionSyncService", () => {
  it("creates a page when one does not exist for the slug", async () => {
    const client = new NotionClient({ apiKey: "k", databaseId: "db" });
    vi.spyOn(client, "findPageBySlug").mockResolvedValue(null);
    vi.spyOn(client, "createPage").mockResolvedValue({
      id: "page-1",
      url: "https://notion.so/page-1",
      lastEditedTime: "2026-01-01T00:00:00Z",
    });

    const service = new NotionSyncService(client);
    const result = await service.syncPage({
      slug: "api-reference",
      title: "API Reference",
      markdown: "# API Reference\n\nDocs body",
    });

    expect(result.action).toBe("created");
    expect(result.url).toBe("https://notion.so/page-1");
  });

  it("updates an existing page for the slug", async () => {
    const client = new NotionClient({ apiKey: "k", databaseId: "db" });
    vi.spyOn(client, "findPageBySlug").mockResolvedValue({
      id: "page-1",
      url: "https://notion.so/page-1",
      lastEditedTime: "2026-01-01T00:00:00Z",
    });
    const updateSpy = vi
      .spyOn(client, "updatePage")
      .mockResolvedValue(undefined);

    const service = new NotionSyncService(client);
    const result = await service.syncPage({
      slug: "api-reference",
      title: "API Reference",
      markdown: "# API Reference\n\nUpdated body",
    });

    expect(result.action).toBe("updated");
    expect(updateSpy).toHaveBeenCalledWith(
      "page-1",
      "API Reference",
      "# API Reference\n\nUpdated body",
    );
  });
});
