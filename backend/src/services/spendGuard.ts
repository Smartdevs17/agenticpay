export interface SpendPolicy { agentId: string; perTransactionCeiling: bigint; dailyCeiling: bigint; spentToday: bigint; day: string; }

export class SpendGuard {
  private readonly policies = new Map<string, SpendPolicy>();
  setPolicy(policy: Omit<SpendPolicy, 'spentToday' | 'day'>): SpendPolicy {
    if (policy.perTransactionCeiling <= 0n || policy.dailyCeiling < policy.perTransactionCeiling) throw new Error('invalid spend ceilings');
    const value = { ...policy, spentToday: 0n, day: new Date().toISOString().slice(0, 10) };
    this.policies.set(policy.agentId, value);
    return value;
  }
  authorize(agentId: string, amount: bigint, now = new Date()): SpendPolicy {
    const policy = this.policies.get(agentId);
    if (!policy) throw new Error('spend policy not found');
    const day = now.toISOString().slice(0, 10);
    if (day !== policy.day) { policy.day = day; policy.spentToday = 0n; }
    if (amount <= 0n || amount > policy.perTransactionCeiling || policy.spentToday + amount > policy.dailyCeiling) throw new Error('spend exceeds agent policy ceiling');
    policy.spentToday += amount;
    return policy;
  }
  get(agentId: string) { return this.policies.get(agentId); }
}
