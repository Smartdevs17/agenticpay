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

  constructor(config: NotionClientConfig) {
    this.apiKey = config.apiKey;
    this.databaseId = config.databaseId;
    this.apiVersion = config.apiVersion || "2022-06-28";
    this.baseUrl = config.baseUrl || "https://api.notion.com/v1";
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
    const response = await fetch(
      `${this.baseUrl}/databases/${this.databaseId}/query`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          filter: {
            property: "Slug",
            rich_text: { equals: slug },
          },
          page_size: 1,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Notion query failed: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      results: Array<{ id: string; url: string; last_edited_time: string }>;
    };

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
    const response = await fetch(`${this.baseUrl}/pages`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        parent: { database_id: this.databaseId },
        properties: {
          Name: { title: [{ text: { content: title } }] },
          Slug: { rich_text: [{ text: { content: slug } }] },
        },
        children: markdownToBlocks(markdown),
      }),
    });

    if (!response.ok) {
      throw new Error(`Notion page creation failed: ${response.statusText}`);
    }

    const page = (await response.json()) as {
      id: string;
      url: string;
      last_edited_time: string;
    };

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
    const propsResponse = await fetch(`${this.baseUrl}/pages/${pageId}`, {
      method: "PATCH",
      headers: this.headers,
      body: JSON.stringify({
        properties: {
          Name: { title: [{ text: { content: title } }] },
        },
      }),
    });

    if (!propsResponse.ok) {
      throw new Error(`Notion page update failed: ${propsResponse.statusText}`);
    }

    const existingBlocks = await this.listBlockChildren(pageId);
    for (const block of existingBlocks) {
      await fetch(`${this.baseUrl}/blocks/${block.id}`, {
        method: "DELETE",
        headers: this.headers,
      });
    }

    const appendResponse = await fetch(
      `${this.baseUrl}/blocks/${pageId}/children`,
      {
        method: "PATCH",
        headers: this.headers,
        body: JSON.stringify({ children: markdownToBlocks(markdown) }),
      },
    );

    if (!appendResponse.ok) {
      throw new Error(
        `Notion block append failed: ${appendResponse.statusText}`,
      );
    }
  }

  private async listBlockChildren(
    pageId: string,
  ): Promise<Array<{ id: string }>> {
    const response = await fetch(
      `${this.baseUrl}/blocks/${pageId}/children?page_size=100`,
      { headers: this.headers },
    );

    if (!response.ok) {
      throw new Error(`Notion block list failed: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      results: Array<{ id: string }>;
    };
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
