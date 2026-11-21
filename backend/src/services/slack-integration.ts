export interface SlackDestination { id: string; webhookUrl: string; channel?: string; enabled: boolean; }

export class SlackIntegrationService {
  private destinations = new Map<string, SlackDestination>();

  configure(input: Omit<SlackDestination, 'enabled'> & { enabled?: boolean }): SlackDestination {
    if (!/^https:\/\/hooks\.slack\.com\/services\//.test(input.webhookUrl)) throw new Error('Invalid Slack webhook URL');
    const destination = { ...input, enabled: input.enabled ?? true };
    this.destinations.set(input.id, destination);
    return destination;
  }

  list(): SlackDestination[] { return [...this.destinations.values()].map((item) => ({ ...item, webhookUrl: '[redacted]' })); }

  async send(id: string, text: string): Promise<void> {
    const destination = this.destinations.get(id);
    if (!destination || !destination.enabled) throw new Error('Slack destination is not enabled');
    const response = await fetch(destination.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, ...(destination.channel ? { channel: destination.channel } : {}) }) });
    if (!response.ok) throw new Error(`Slack API error: ${response.status}`);
  }

  resetForTests(): void { this.destinations.clear(); }
}

export const slackIntegrationService = new SlackIntegrationService();