export type ChurnSignal = 'payment_failed' | 'cancelled' | 'inactive';

export interface ChurnEvent {
  customerId: string;
  event: ChurnSignal;
  occurredAt: Date;
}

export interface ChurnPrediction {
  customerId: string;
  score: number;
  risk: 'low' | 'medium' | 'high';
  signals: ChurnSignal[];
  intervention: 'none' | 'reminder' | 'retention_offer';
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class ChurnPredictionService {
  private events: ChurnEvent[] = [];

  track(event: ChurnEvent): void {
    if (!event.customerId || !['payment_failed', 'cancelled', 'inactive'].includes(event.event)) {
      throw new Error('Invalid churn event');
    }
    if (!(event.occurredAt instanceof Date) || Number.isNaN(event.occurredAt.getTime())) {
      throw new Error('occurredAt must be a valid Date');
    }
    this.events.push({ ...event });
  }

  predict(customerId: string, now = new Date()): ChurnPrediction {
    const events = this.events.filter((event) => event.customerId === customerId);
    const recent = events.filter((event) => now.getTime() - event.occurredAt.getTime() <= 90 * DAY_MS);
    const signals = [...new Set(recent.map((event) => event.event))];
    let score = 0;
    if (signals.includes('payment_failed')) score += 35;
    if (signals.includes('inactive')) score += 25;
    if (signals.includes('cancelled')) score += 50;
    if (recent.filter((event) => event.event === 'payment_failed').length >= 2) score += 15;
    score = Math.min(100, score);
    const risk = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
    return {
      customerId,
      score,
      risk,
      signals,
      intervention: risk === 'high' ? 'retention_offer' : risk === 'medium' ? 'reminder' : 'none',
    };
  }

  resetForTests(): void { this.events = []; }
}

export const churnPredictionService = new ChurnPredictionService();