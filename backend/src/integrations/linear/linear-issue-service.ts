import { LinearClient, LinearIssue } from "./linear-client";

export interface TrackableEvent {
  eventType: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Maps AgenticPay platform events (disputes, failed payouts, security
 * alerts) onto Linear issues so operations teams can track and resolve
 * them from their existing workflow.
 */
export class LinearIssueService {
  constructor(private readonly client: LinearClient) {}

  async trackEvent(event: TrackableEvent): Promise<LinearIssue> {
    const description = [
      event.body,
      "",
      "---",
      `Event type: \`${event.eventType}\``,
      event.data ? `\`\`\`json\n${JSON.stringify(event.data, null, 2)}\n\`\`\`` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return this.client.createIssue(event.title, description);
  }

  async appendUpdate(issueId: string, note: string): Promise<void> {
    await this.client.addComment(issueId, note);
  }

  async resolve(issueId: string, resolvedStateId: string): Promise<void> {
    await this.client.updateIssueState(issueId, resolvedStateId);
  }
}
