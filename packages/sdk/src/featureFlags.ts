import { AgenticPayClient } from './client.js';
import { FeatureFlagEvaluateResponse, FeatureFlagStateResponse } from './types.js';

export class FeatureFlagsApi {
  constructor(private readonly client: AgenticPayClient) {}

  /**
   * Deterministically evaluates a feature flag for a user identifier.
   */
  async evaluate(
    flag: string,
    identifier: string
  ): Promise<FeatureFlagEvaluateResponse> {
    const query = new URLSearchParams({ flag, identifier }).toString();
    return this.client.get<FeatureFlagEvaluateResponse>(`/flags/evaluate?${query}`);
  }

  /**
   * Fetches the state of all active feature flags for a user identifier.
   */
  async state(identifier: string): Promise<FeatureFlagStateResponse> {
    const query = new URLSearchParams({ identifier }).toString();
    return this.client.get<FeatureFlagStateResponse>(`/flags/state?${query}`);
  }

  /**
   * Records a client-side exposure event (e.g. for variants or simple flags).
   */
  async recordExposure(
    flag: string,
    identifier: string,
    value: boolean | string
  ): Promise<{ recorded: boolean }> {
    return this.client.post<{ recorded: boolean }>('/flags/exposure', {
      flag,
      identifier,
      value,
    });
  }
}
