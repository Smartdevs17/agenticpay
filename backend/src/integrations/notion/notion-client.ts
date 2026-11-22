import { createHttpClient, type HttpClient, HttpError } from '../../lib/http-client.js';

export interface NotionClientConfig {
  apiKey: string;
  databaseId: string;
  apiVersion?: string;
  baseUrl?: string;
}

export interface NotionPage {
  id: string;
  url: string;
  lastEditedTime: string;
}

/**
 * Minimal Notion REST client covering the endpoints needed to sync
 * generated documentation pages into a Notion database.
 */
export class NotionClient {
  private readonly apiKey: string;
  private readonly databaseId: string;
  private readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly client: HttpClient;

  constructor(config: NotionClientConfig) {
    this.apiKey = config.apiKey;
    this.databaseId = config.databaseId;
    this.apiVersion = config.apiVersion || "2022-06-28";
    this.baseUrl = config.baseUrl || "https://api.notion.com/v1";
    this.client = createHttpClient({
      baseUrl: this.baseUrl,
      auth: {
        type: 'bearer',
        token: this.apiKey,
      },
      headers: {
        "Notion-Version": this.apiVersion,
        "Content-Type": "application/json",
      },
    });
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Notion-Version": this.apiVersion,
      "Content-Type": "application/json",
    };
  }

  /**
   * Find an existing page in the configured database by its unique slug.
   */
  async findPageBySlug(slug: string): Promise<NotionPage | null> {
    let data: { results: Array<{ id: string; url: string; last_edited_time: string }> };
    try {
      data = await this.client.post(`/databases/${this.databaseId}/query`, {
        filter: {
          property: "Slug",
          rich_text: { equals: slug },
        },
        page_size: 1,
      });
    } catch (err: unknown) {
      if (err instanceof HttpError) {
        throw new Error(`Notion query failed: ${err.statusText}`);
      }
      throw err;
    }

    if (data.results.length === 0) {
      return null;
    }

    const [page] = data.results;
    return {
      id: page.id,
      url: page.url,
      lastEditedTime: page.last_edited_time,
    };
  }

  /**
   * Create a new page in the configured database.
   */
  async createPage(
    slug: string,
    title: string,
    markdown: string,
  ): Promise<NotionPage> {
    let page: { id: string; url: string; last_edited_time: string };
    try {
      page = await this.client.post('/pages', {
        parent: { database_id: this.databaseId },
        properties: {
          Name: { title: [{ text: { content: title } }] },
          Slug: { rich_text: [{ text: { content: slug } }] },
        },
        children: markdownToBlocks(markdown),
      });
    } catch (err: unknown) {
      if (err instanceof HttpError) {
        throw new Error(`Notion page creation failed: ${err.statusText}`);
      }
      throw err;
    }

    return {
      id: page.id,
      url: page.url,
      lastEditedTime: page.last_edited_time,
    };
  }

  /**
   * Replace the content blocks of an existing page and refresh its title.
   */
  async updatePage(
    pageId: string,
    title: string,
    markdown: string,
  ): Promise<void> {
    try {
      await this.client.patch(`/pages/${pageId}`, {
        properties: {
          Name: { title: [{ text: { content: title } }] },
        },
      });
    } catch (err: unknown) {
      if (err instanceof HttpError) {
        throw new Error(`Notion page update failed: ${err.statusText}`);
      }
      throw err;
    }

    const existingBlocks = await this.listBlockChildren(pageId);
    for (const block of existingBlocks) {
      try {
        await this.client.delete(`/blocks/${block.id}`);
      } catch {
        // ignore
      }
    }

    try {
      await this.client.patch(`/blocks/${pageId}/children`, {
        children: markdownToBlocks(markdown),
      });
    } catch (err: unknown) {
      if (err instanceof HttpError) {
        throw new Error(`Notion block append failed: ${err.statusText}`);
      }
      throw err;
    }
  }

  private async listBlockChildren(
    pageId: string,
  ): Promise<Array<{ id: string }>> {
    let data: { results: Array<{ id: string }> };
    try {
      data = await this.client.get(`/blocks/${pageId}/children?page_size=100`);
    } catch (err: unknown) {
      if (err instanceof HttpError) {
        throw new Error(`Notion block list failed: ${err.statusText}`);
      }
      throw err;
    }
    return data.results;
  }
}

/**
 * Converts plain markdown text into Notion paragraph blocks, one block per
 * non-empty line. This intentionally supports the subset of markdown used
 * by generated documentation rather than the full CommonMark spec.
 */
export function markdownToBlocks(markdown: string): unknown[] {
  return markdown
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const heading = line.match(/^(#{1,3})\s+(.*)$/);
      if (heading) {
        const level = heading[1].length;
        const type = `heading_${level}`;
        return {
          object: "block",
          type,
          [type]: {
            rich_text: [{ type: "text", text: { content: heading[2] } }],
          },
        };
      }

      return {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: line } }],
        },
      };
    });
}
