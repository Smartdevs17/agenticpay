import { NotionClient } from "./notion-client";

export interface DocPage {
  slug: string;
  title: string;
  markdown: string;
}

export interface SyncResult {
  slug: string;
  action: "created" | "updated";
  url: string;
}

/**
 * Syncs generated documentation pages to a Notion database, creating
 * pages that don't exist yet and refreshing ones that do.
 */
export class NotionSyncService {
  constructor(private readonly client: NotionClient) {}

  async syncPage(page: DocPage): Promise<SyncResult> {
    const existing = await this.client.findPageBySlug(page.slug);

    if (existing) {
      await this.client.updatePage(existing.id, page.title, page.markdown);
      return { slug: page.slug, action: "updated", url: existing.url };
    }

    const created = await this.client.createPage(
      page.slug,
      page.title,
      page.markdown,
    );
    return { slug: page.slug, action: "created", url: created.url };
  }

  async syncPages(pages: DocPage[]): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    for (const page of pages) {
      results.push(await this.syncPage(page));
    }
    return results;
  }
}
