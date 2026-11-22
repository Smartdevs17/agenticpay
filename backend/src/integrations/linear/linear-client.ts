import { createHttpClient, type HttpClient, HttpError } from '../../lib/http-client.js';

export interface LinearClientConfig {
  apiKey: string;
  teamId: string;
  apiUrl?: string;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  url: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

/**
 * Minimal Linear GraphQL API client for creating and updating issues so
 * AgenticPay events (disputes, failed payments, etc.) can be tracked in
 * Linear.
 */
export class LinearClient {
  private readonly apiKey: string;
  private readonly teamId: string;
  private readonly apiUrl: string;
  private readonly client: HttpClient;

  constructor(config: LinearClientConfig) {
    this.apiKey = config.apiKey;
    this.teamId = config.teamId;
    this.apiUrl = config.apiUrl || "https://api.linear.app/graphql";
    this.client = createHttpClient({
      baseUrl: this.apiUrl,
      headers: {
        Authorization: this.apiKey,
        "Content-Type": "application/json",
      },
    });
  }

  private async request<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    let result: GraphQLResponse<T>;
    try {
      result = await this.client.post<GraphQLResponse<T>>('', { query, variables });
    } catch (err: unknown) {
      if (err instanceof HttpError) {
        throw new Error(`Linear API error: ${err.statusText}`);
      }
      throw err;
    }

    if (result.errors?.length) {
      throw new Error(
        `Linear API error: ${result.errors.map((e) => e.message).join(", ")}`,
      );
    }

    return result.data as T;
  }

  async createIssue(
    title: string,
    description: string,
    labelIds: string[] = [],
  ): Promise<LinearIssue> {
    const data = await this.request<{
      issueCreate: { success: boolean; issue: LinearIssue };
    }>(
      `mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier url }
        }
      }`,
      {
        input: {
          teamId: this.teamId,
          title,
          description,
          labelIds,
        },
      },
    );

    if (!data.issueCreate.success) {
      throw new Error("Linear issue creation was not successful");
    }

    return data.issueCreate.issue;
  }

  async addComment(issueId: string, body: string): Promise<void> {
    await this.request(
      `mutation AddComment($input: CommentCreateInput!) {
        commentCreate(input: $input) { success }
      }`,
      { input: { issueId, body } },
    );
  }

  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    await this.request(
      `mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success }
      }`,
      { id: issueId, input: { stateId } },
    );
  }
}
