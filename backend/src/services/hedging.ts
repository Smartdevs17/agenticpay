import { randomUUID } from 'node:crypto';
import { auditService } from './auditService.js';
import type {
  RateSnapshot,
  HedgeSchedule,
  HedgePosition,
  HedgeThreshold,
  HedgeAuditEntry,
  CreateScheduleRequest,
  ExecuteHedgeRequest,
  HedgePnlReport,
  HedgeStatus,
} from '../types/hedging.js';

/** Simulated provider: fetch live rate (replace with real API call) */
async function fetchLiveRate(base: string, quote: string): Promise<number> {
  // Stub: real implementation would call e.g. Open Exchange Rates / ECB
  const knownRates: Record<string, number> = {
    'USD/EUR': 0.92,
    'EUR/USD': 1.087,
    'USD/GBP': 0.79,
    'GBP/USD': 1.265,
    'USD/XLM': 9.5,
    'XLM/USD': 0.105,
  };
  const key = `${base}/${quote}`;
  const rate = knownRates[key];
  if (rate === undefined) throw new Error(`Unsupported pair: ${key}`);
  // Add small random noise to simulate live feed
  return rate * (1 + (Math.random() - 0.5) * 0.002);
}

export class HedgingService {
  private schedules = new Map<string, HedgeSchedule>();
  private positions = new Map<string, HedgePosition>();
  private rateHistory: RateSnapshot[] = [];
  private hedgeAudit: HedgeAuditEntry[] = [];
  private pollingTimers = new Map<string, ReturnType<typeof setInterval>>();

  // ── Rate monitoring ──────────────────────────────────────────────────────

  async getRate(base: string, quote: string): Promise<RateSnapshot> {
    const rate = await fetchLiveRate(base, quote);
    const snapshot: RateSnapshot = {
      baseCurrency: base,
      quoteCurrency: quote,
      rate,
      timestamp: Date.now(),
      source: 'stub-provider',
    };
    this.rateHistory.push(snapshot);
    if (this.rateHistory.length > 10_000) this.rateHistory.shift();
    return snapshot;
  }

  getRateHistory(base: string, quote: string, limit = 100): RateSnapshot[] {
    return this.rateHistory
      .filter((s) => s.baseCurrency === base && s.quoteCurrency === quote)
      .slice(-limit);
  }

  // ── Schedule management ──────────────────────────────────────────────────

  createSchedule(req: CreateScheduleRequest): HedgeSchedule {
    const id = randomUUID();
    const now = Date.now();
    const schedule: HedgeSchedule = {
      id,
      merchantId: req.merchantId,
      thresholds: req.thresholds,
      pollIntervalMs: req.pollIntervalMs ?? 60_000,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    this.schedules.set(id, schedule);
    this._startPolling(schedule);
    this._audit(id, req.merchantId, 'schedule.created', { schedule });
    return schedule;
  }

  getSchedule(id: string): HedgeSchedule | undefined {
    return this.schedules.get(id);
  }

  listSchedules(merchantId: string): HedgeSchedule[] {
    return [...this.schedules.values()].filter((s) => s.merchantId === merchantId);
  }

  updateSchedule(id: string, patch: Partial<Pick<HedgeSchedule, 'thresholds' | 'pollIntervalMs' | 'enabled'>>): HedgeSchedule | undefined {
    const schedule = this.schedules.get(id);
    if (!schedule) return undefined;
    Object.assign(schedule, patch, { updatedAt: Date.now() });
    this._restartPolling(schedule);
    this._audit(id, schedule.merchantId, 'schedule.updated', { patch });
    return schedule;
  }

  deleteSchedule(id: string): boolean {
    const schedule = this.schedules.get(id);
    if (!schedule) return false;
    this._stopPolling(id);
    this.schedules.delete(id);
    this._audit(id, schedule.merchantId, 'schedule.deleted', {});
    return true;
  }

  // ── Hedge execution ──────────────────────────────────────────────────────

  async executeHedge(req: ExecuteHedgeRequest): Promise<HedgePosition> {
    const snapshot = await this.getRate(req.baseCurrency, req.quoteCurrency);
    const now = Date.now();
    const position: HedgePosition = {
      id: randomUUID(),
      merchantId: req.merchantId,
      baseCurrency: req.baseCurrency,
      quoteCurrency: req.quoteCurrency,
      notionalAmount: req.notionalAmount,
      lockedRate: snapshot.rate,
      instrument: req.instrument,
      triggerType: req.triggerType ?? 'manual',
      status: 'active',
      openedAt: now,
      expiresAt: now + req.lockDurationSeconds * 1000,
      unrealizedPnl: 0,
    };

    try {
      // Stub: call real provider API here
      position.providerRef = `stub-${position.id.slice(0, 8)}`;
      position.status = 'active';
    } catch (err) {
      position.status = 'failed';
      position.failureReason = err instanceof Error ? err.message : String(err);
    }

    this.positions.set(position.id, position);
    this._audit(position.id, req.merchantId, 'hedge.executed', { position });
    await auditService.logAction({
      action: 'hedge.executed',
      resource: 'hedge_position',
      resourceId: position.id,
      details: { merchantId: req.merchantId, instrument: req.instrument, lockedRate: snapshot.rate },
    });
    return position;
  }

  async closePosition(positionId: string, currentRate?: number): Promise<HedgePosition | undefined> {
    const position = this.positions.get(positionId);
    if (!position || position.status !== 'active') return undefined;

    const rate = currentRate ?? (await this.getRate(position.baseCurrency, position.quoteCurrency)).rate;
    const pnl = (rate - position.lockedRate) * position.notionalAmount;

    position.status = 'executed';
    position.closedAt = Date.now();
    position.realizedPnl = pnl;
    position.unrealizedPnl = undefined;

    this._audit(positionId, position.merchantId, 'hedge.closed', { realizedPnl: pnl, closeRate: rate });
    await auditService.logAction({
      action: 'hedge.closed',
      resource: 'hedge_position',
      resourceId: positionId,
      details: { realizedPnl: pnl, closeRate: rate },
    });
    return position;
  }

  cancelPosition(positionId: string): HedgePosition | undefined {
    const position = this.positions.get(positionId);
    if (!position || position.status !== 'active') return undefined;
    position.status = 'cancelled';
    position.closedAt = Date.now();
    this._audit(positionId, position.merchantId, 'hedge.cancelled', {});
    return position;
  }

  getPosition(id: string): HedgePosition | undefined {
    return this.positions.get(id);
  }

  listPositions(merchantId: string): HedgePosition[] {
    return [...this.positions.values()].filter((p) => p.merchantId === merchantId);
  }

  // ── P&L reporting ────────────────────────────────────────────────────────

  async getPnlReport(merchantId: string): Promise<HedgePnlReport> {
    const positions = this.listPositions(merchantId);
    let totalRealized = 0;
    let totalUnrealized = 0;
    let open = 0;
    let closed = 0;

    for (const p of positions) {
      if (p.status === 'active') {
        open++;
        try {
          const rate = (await this.getRate(p.baseCurrency, p.quoteCurrency)).rate;
          p.unrealizedPnl = (rate - p.lockedRate) * p.notionalAmount;
          totalUnrealized += p.unrealizedPnl;
        } catch {
          // skip if rate unavailable
        }
      } else {
        closed++;
        totalRealized += p.realizedPnl ?? 0;
      }
    }

    return {
      merchantId,
      generatedAt: Date.now(),
      positions,
      totalRealizedPnl: totalRealized,
      totalUnrealizedPnl: totalUnrealized,
      openPositions: open,
      closedPositions: closed,
    };
  }

  // ── Audit trail ──────────────────────────────────────────────────────────

  getHedgeAudit(merchantId?: string): HedgeAuditEntry[] {
    if (!merchantId) return [...this.hedgeAudit];
    return this.hedgeAudit.filter((e) => e.merchantId === merchantId);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private _audit(resourceId: string, merchantId: string, action: string, details: Record<string, unknown>): void {
    this.hedgeAudit.push({
      id: randomUUID(),
      positionId: resourceId,
      merchantId,
      action,
      details,
      timestamp: Date.now(),
    });
  }

  private _startPolling(schedule: HedgeSchedule): void {
    if (!schedule.enabled) return;
    const timer = setInterval(() => this._pollThresholds(schedule), schedule.pollIntervalMs);
    this.pollingTimers.set(schedule.id, timer);
  }

  private _stopPolling(scheduleId: string): void {
    const timer = this.pollingTimers.get(scheduleId);
    if (timer) {
      clearInterval(timer);
      this.pollingTimers.delete(scheduleId);
    }
  }

  private _restartPolling(schedule: HedgeSchedule): void {
    this._stopPolling(schedule.id);
    this._startPolling(schedule);
  }

  private async _pollThresholds(schedule: HedgeSchedule): Promise<void> {
    if (!schedule.enabled) return;
    for (const threshold of schedule.thresholds) {
      try {
        const snapshot = await this.getRate(threshold.baseCurrency, threshold.quoteCurrency);
        if (this._shouldTrigger(snapshot.rate, threshold)) {
          await this.executeHedge({
            merchantId: schedule.merchantId,
            baseCurrency: threshold.baseCurrency,
            quoteCurrency: threshold.quoteCurrency,
            notionalAmount: threshold.notionalAmount,
            instrument: threshold.instrument,
            lockDurationSeconds: threshold.lockDurationSeconds,
            triggerType: 'threshold',
          });
        }
      } catch (err) {
        console.error(`[Hedging] Poll error for schedule ${schedule.id}:`, err);
      }
    }
  }

  private _shouldTrigger(rate: number, threshold: HedgeThreshold): boolean {
    if (threshold.upperBound !== undefined && rate >= threshold.upperBound) return true;
    if (threshold.lowerBound !== undefined && rate <= threshold.lowerBound) return true;
    return false;
  }

  /** Expire positions that have passed their expiry time */
  expirePositions(): number {
    const now = Date.now();
    let count = 0;
    for (const position of this.positions.values()) {
      if (position.status === 'active' && position.expiresAt <= now) {
        position.status = 'expired';
        position.closedAt = now;
        this._audit(position.id, position.merchantId, 'hedge.expired', {});
        count++;
      }
    }
    return count;
  }
}

export const hedgingService = new HedgingService();
