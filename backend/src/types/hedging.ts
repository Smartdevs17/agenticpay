export type HedgeInstrument = 'forward' | 'option' | 'spot';
export type HedgeStatus = 'pending' | 'active' | 'executed' | 'expired' | 'cancelled' | 'failed';
export type HedgeTriggerType = 'threshold' | 'scheduled' | 'manual';

export interface RateSnapshot {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  timestamp: number;
  source: string;
}

export interface HedgeThreshold {
  baseCurrency: string;
  quoteCurrency: string;
  /** Lock rate when it rises above this value */
  upperBound?: number;
  /** Lock rate when it falls below this value */
  lowerBound?: number;
  /** Notional amount in base currency to hedge */
  notionalAmount: number;
  instrument: HedgeInstrument;
  /** Duration in seconds for the locked rate */
  lockDurationSeconds: number;
}

export interface HedgeSchedule {
  id: string;
  merchantId: string;
  thresholds: HedgeThreshold[];
  /** Cron-like interval in ms for rate polling */
  pollIntervalMs: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface HedgePosition {
  id: string;
  merchantId: string;
  scheduleId?: string;
  baseCurrency: string;
  quoteCurrency: string;
  notionalAmount: number;
  lockedRate: number;
  instrument: HedgeInstrument;
  triggerType: HedgeTriggerType;
  status: HedgeStatus;
  openedAt: number;
  expiresAt: number;
  closedAt?: number;
  /** P&L in quote currency at close */
  realizedPnl?: number;
  /** Current unrealized P&L in quote currency */
  unrealizedPnl?: number;
  providerRef?: string;
  failureReason?: string;
}

export interface HedgeAuditEntry {
  id: string;
  positionId: string;
  merchantId: string;
  action: string;
  details: Record<string, unknown>;
  timestamp: number;
}

export interface CreateScheduleRequest {
  merchantId: string;
  thresholds: HedgeThreshold[];
  pollIntervalMs?: number;
}

export interface ExecuteHedgeRequest {
  merchantId: string;
  baseCurrency: string;
  quoteCurrency: string;
  notionalAmount: number;
  instrument: HedgeInstrument;
  lockDurationSeconds: number;
  triggerType?: HedgeTriggerType;
}

export interface HedgePnlReport {
  merchantId: string;
  generatedAt: number;
  positions: HedgePosition[];
  totalRealizedPnl: number;
  totalUnrealizedPnl: number;
  openPositions: number;
  closedPositions: number;
}
