import type { ExtensionPoint, HookContextByExtensionPoint, HookResult } from './extension-points.js';

export interface PluginCompatibility {
  agenticPay: string;
  node?: string;
}

export interface PluginConfigSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export type PluginHookMap = {
  [Point in ExtensionPoint]?: (context: HookContextByExtensionPoint[Point]) => HookResult;
};

export interface AgenticPayPlugin {
  name: string;
  version: string;
  compatibility: PluginCompatibility;
  configSchema?: PluginConfigSchema;
  install?: (config: Record<string, unknown>) => Promise<void> | void;
  uninstall?: () => Promise<void> | void;
  hooks: PluginHookMap;
}

export type PluginStatus = 'installed' | 'enabled' | 'disabled' | 'error';

export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  source: string;
  status: PluginStatus;
  compatibility: unknown;
  health: unknown;
  installedAt: Date;
  updatedAt: Date;
  disabledAt: Date | null;
}

export interface PluginPrismaClient {
  plugin: {
    findMany(args?: Record<string, unknown>): Promise<PluginRecord[]>;
    findUnique(args: Record<string, unknown>): Promise<PluginRecord | null>;
    create(args: { data: Record<string, unknown> }): Promise<PluginRecord>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<PluginRecord>;
    delete(args: { where: Record<string, unknown> }): Promise<PluginRecord>;
  };
  pluginConfig: {
    upsert(args: Record<string, unknown>): Promise<unknown>;
    findUnique(args: Record<string, unknown>): Promise<{ config: unknown } | null>;
  };
  pluginAuditLog: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findMany(args?: Record<string, unknown>): Promise<unknown[]>;
  };
}

export interface PluginHealth {
  status: 'healthy' | 'degraded' | 'disabled';
  errorCount: number;
  lastError?: string;
  lastInvokedAt?: string;
}
