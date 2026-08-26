import { randomUUID } from 'node:crypto';

export interface Arbitrator {
  id: string;
  name: string;
  address: string;
  email?: string;
  specializations: string[];
  activeDisputes: number;
  totalResolved: number;
  rating: number;
  isAvailable: boolean;
  joinedAt: number;
}

export class ArbitratorService {
  private arbitrators = new Map<string, Arbitrator>();
  private disputeAssignments = new Map<string, string>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    const now = Date.now();
    this.arbitrators.set('arb-1', { id: 'arb-1', name: 'Alice Johnson', address: 'GA7...', specializations: ['escrow', 'payment'], activeDisputes: 2, totalResolved: 45, rating: 4.8, isAvailable: true, joinedAt: now - 365 * 86400000 });
    this.arbitrators.set('arb-2', { id: 'arb-2', name: 'Bob Chen', address: 'GB8...', specializations: ['smart-contract', 'defi'], activeDisputes: 1, totalResolved: 32, rating: 4.6, isAvailable: true, joinedAt: now - 180 * 86400000 });
    this.arbitrators.set('arb-3', { id: 'arb-3', name: 'Carol Martinez', address: 'GC9...', specializations: ['payment', 'identity'], activeDisputes: 3, totalResolved: 28, rating: 4.9, isAvailable: true, joinedAt: now - 90 * 86400000 });
  }

  registerArbitrator(params: Omit<Arbitrator, 'id' | 'activeDisputes' | 'totalResolved' | 'rating' | 'isAvailable' | 'joinedAt'>): Arbitrator {
    const arbitrator: Arbitrator = {
      id: `arb-${randomUUID().slice(0, 8)}`,
      activeDisputes: 0,
      totalResolved: 0,
      rating: 5.0,
      isAvailable: true,
      joinedAt: Date.now(),
      ...params,
    };
    this.arbitrators.set(arbitrator.id, arbitrator);
    return arbitrator;
  }

  assignArbitrator(disputeId: string): Arbitrator | null {
    const available = Array.from(this.arbitrators.values())
      .filter(a => a.isAvailable)
      .sort((a, b) => a.activeDisputes - b.activeDisputes || b.rating - a.rating);

    if (available.length === 0) return null;

    const chosen = available[0];
    chosen.activeDisputes++;
    this.arbitrators.set(chosen.id, chosen);
    this.disputeAssignments.set(disputeId, chosen.id);
    return chosen;
  }

  releaseArbitrator(disputeId: string): void {
    const arbId = this.disputeAssignments.get(disputeId);
    if (!arbId) return;
    const arb = this.arbitrators.get(arbId);
    if (arb) {
      arb.activeDisputes = Math.max(0, arb.activeDisputes - 1);
      arb.totalResolved++;
      this.arbitrators.set(arbId, arb);
    }
    this.disputeAssignments.delete(disputeId);
  }

  getArbitrator(id: string): Arbitrator | undefined {
    return this.arbitrators.get(id);
  }

  listArbitrators(availableOnly?: boolean): Arbitrator[] {
    const all = Array.from(this.arbitrators.values());
    return availableOnly ? all.filter(a => a.isAvailable) : all;
  }

  getWorkloadStats(): { total: number; available: number; avgActiveDisputes: number } {
    const all = Array.from(this.arbitrators.values());
    return {
      total: all.length,
      available: all.filter(a => a.isAvailable).length,
      avgActiveDisputes: all.reduce((s, a) => s + a.activeDisputes, 0) / all.length,
    };
  }
}
