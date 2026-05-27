import { createHash, randomUUID } from 'node:crypto';
import { randomUUID as uuidv4 } from 'node:crypto';

export interface AuditEntry {
  id: string;
  timestamp: number;
  userId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  requestMethod?: string;
  requestPath?: string;
  requestBody?: unknown;
  responseStatus?: number;
  previousHash: string;
  hash: string;
  suspicious?: boolean;
  flags?: string[];
}

export interface AuditQuery {
  userId?: string;
  action?: string;
  resource?: string;
  startDate?: number;
  endDate?: number;
  suspicious?: boolean;
  limit?: number;
  offset?: number;
}

export interface RetentionPolicy {
  retentionDays: number;
  archiveAfterDays: number;
  deleteAfterDays: number;
}

export class AuditService {
  private entries: AuditEntry[] = [];
  private currentHash = '0000000000000000000000000000000000000000000000000000000000000000';
  private retentionPolicy: RetentionPolicy = {
    retentionDays: 2555,
    archiveAfterDays: 2190,
    deleteAfterDays: 3650,
  };

  constructor(policy?: Partial<RetentionPolicy>) {
    if (policy) {
      this.retentionPolicy = { ...this.retentionPolicy, ...policy };
    }
  }

  private computeHash(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  private generateEntryHash(entry: Omit<AuditEntry, 'hash'>): string {
    const data = [
      entry.id,
      entry.timestamp,
      entry.userId || '',
      entry.action,
      entry.resource,
      entry.resourceId || '',
      JSON.stringify(entry.details || {}),
      JSON.stringify(entry.beforeState || {}),
      JSON.stringify(entry.afterState || {}),
      entry.ipAddress || '',
      entry.requestMethod || '',
      entry.requestPath || '',
      entry.previousHash,
    ].join('|');
    return this.computeHash(data);
  }

  async logAction(params: {
    userId?: string;
    action: string;
    resource: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    beforeState?: Record<string, unknown>;
    afterState?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    request?: {
      method?: string;
      path?: string;
      body?: unknown;
    };
    response?: {
      status?: number;
    };
  }): Promise<AuditEntry> {
    const id = uuidv4();
    const timestamp = Date.now();
    
    const entry: Omit<AuditEntry, 'hash'> = {
      id,
      timestamp,
      userId: params.userId,
      action: params.action,
      resource: params.resource,
      resourceId: params.resourceId,
      details: params.details,
      beforeState: params.beforeState,
      afterState: params.afterState,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      requestMethod: params.request?.method,
      requestPath: params.request?.path,
      requestBody: this.sanitizeRequestBody(params.request?.body),
      responseStatus: params.response?.status,
      previousHash: this.currentHash,
    };

    const hash = this.generateEntryHash(entry);
    const fullEntry: AuditEntry = { ...entry, hash };
    
    this.entries.push(fullEntry);
    this.currentHash = hash;

    return fullEntry;
  }

  private sanitizeRequestBody(body?: unknown): unknown {
    if (!body) return undefined;
    if (typeof body !== 'object') return body;
    
    const sanitized = { ...body as Record<string, unknown> };
    const sensitiveFields = ['password', 'token', 'apiKey', 'secret', 'creditCard', 'ssn'];
    
    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }

  async queryEntries(query: AuditQuery): Promise<{ entries: AuditEntry[]; total: number }> {
    let filtered = this.entries.filter((entry) => {
      if (query.userId && entry.userId !== query.userId) return false;
      if (query.action && entry.action !== query.action) return false;
      if (query.resource && entry.resource !== query.resource) return false;
      if (query.suspicious !== undefined && entry.suspicious !== query.suspicious) return false;
      if (query.startDate && entry.timestamp < query.startDate) return false;
      if (query.endDate && entry.timestamp > query.endDate) return false;
      return true;
    });

    const total = filtered.length;
    const offset = query.offset || 0;
    const limit = query.limit || 50;
    
    filtered = filtered.sort((a, b) => b.timestamp - a.timestamp);
    filtered = filtered.slice(offset, offset + limit);

    return { entries: filtered, total };
  }

  async getEntry(id: string): Promise<AuditEntry | undefined> {
    return this.entries.find((entry) => entry.id === id);
  }

  async verifyIntegrity(): Promise<{ valid: boolean; brokenAt?: string }> {
    let expectedHash = '0000000000000000000000000000000000000000000000000000000000000000';
    
    for (const entry of this.entries) {
      if (entry.previousHash !== expectedHash) {
        return { valid: false, brokenAt: entry.id };
      }
      
      const computedHash = this.generateEntryHash(entry);
      if (computedHash !== entry.hash) {
        return { valid: false, brokenAt: entry.id };
      }
      
      expectedHash = entry.hash;
    }
    
    if (this.currentHash !== expectedHash) {
      return { valid: false, brokenAt: this.entries[this.entries.length - 1]?.id };
    }
    
    return { valid: true };
  }

  async flagSuspicious(entryId: string, reasons: string[]): Promise<AuditEntry | undefined> {
    const entry = this.entries.find((e) => e.id === entryId);
    if (entry) {
      entry.suspicious = true;
      entry.flags = reasons;
    }
    return entry;
  }

  async exportToCSV(): Promise<string> {
    const headers = [
      'ID', 'Timestamp', 'User ID', 'Action', 'Resource', 'Resource ID',
      'IP Address', 'Request Method', 'Request Path', 'Response Status',
      'Previous Hash', 'Hash', 'Suspicious', 'Flags'
    ].join(',');
    
    const rows = this.entries.map((entry) => [
      entry.id,
      new Date(entry.timestamp).toISOString(),
      entry.userId || '',
      entry.action,
      entry.resource,
      entry.resourceId || '',
      entry.ipAddress || '',
      entry.requestMethod || '',
      entry.requestPath || '',
      entry.responseStatus || '',
      entry.previousHash,
      entry.hash,
      entry.suspicious ? 'YES' : 'NO',
      (entry.flags || []).join(';'),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    
    return [headers, ...rows].join('\n');
  }

  async exportToJSON(): Promise<string> {
    return JSON.stringify({
      exportedAt: Date.now(),
      entryCount: this.entries.length,
      retentionPolicy: this.retentionPolicy,
      integrity: await this.verifyIntegrity(),
      entries: this.entries,
    }, null, 2);
  }

  setRetentionPolicy(policy: Partial<RetentionPolicy>): void {
    this.retentionPolicy = { ...this.retentionPolicy, ...policy };
  }

  async getRetentionStats(): Promise<{
    totalEntries: number;
    byResource: Record<string, number>;
    suspiciousCount: number;
    dateRange: { oldest: number; newest: number };
  }> {
    const byResource: Record<string, number> = {};
    let suspiciousCount = 0;
    
    for (const entry of this.entries) {
      byResource[entry.resource] = (byResource[entry.resource] || 0) + 1;
      if (entry.suspicious) suspiciousCount++;
    }
    
    const timestamps = this.entries.map((e) => e.timestamp);
    timestamps.sort((a, b) => a - b);
    
    return {
      totalEntries: this.entries.length,
      byResource,
      suspiciousCount,
      dateRange: {
        oldest: timestamps[0] || 0,
        newest: timestamps[timestamps.length - 1] || 0,
      },
    };
  }

  async getEntryCount(): Promise<number> {
    return this.entries.length;
  }

  async clearOldEntries(): Promise<number> {
    const cutoff = Date.now() - (this.retentionPolicy.deleteAfterDays * 24 * 60 * 60 * 1000);
    const toDelete = this.entries.filter((e) => e.timestamp < cutoff);
    
    this.entries = this.entries.filter((e) => e.timestamp >= cutoff);
    
    return toDelete.length;
  }
}

export const auditService = new AuditService();