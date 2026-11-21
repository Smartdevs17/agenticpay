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

  constructor(config: LinearClientConfig) {
    this.apiKey = config.apiKey;
    this.teamId = config.teamId;
    this.apiUrl = config.apiUrl || "https://api.linear.app/graphql";
  }

  private async request<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        Authorization: this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`Linear API error: ${response.statusText}`);
    }

    const result = (await response.json()) as GraphQLResponse<T>;
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
