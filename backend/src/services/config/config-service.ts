import { EventEmitter } from 'node:events';
import Redis from 'ioredis';
import { z } from 'zod';
import { AppError } from '../../middleware/errorHandler.js';
import {
  CONFIG_DEFINITIONS,
  type ConfigKey,
  type ConfigSource,
  type ConfigValue,
  type ResolvedConfig,
  configSchemaSnapshot,
  parseEnvValue,
  validateConfigValue,
} from './config-schema.js';
import { ConfigStore, PrismaConfigStore, type StoredConfiguration } from './config-store.js';

const CONFIG_CHANGE_CHANNEL = 'agenticpay:config:changed';

export interface ConfigChangeEvent {
  key: string;
  value: ConfigValue;
  source: ConfigSource;
  version?: number;
  changedAt: string;
}

export class ConfigurationService {
  private readonly events = new EventEmitter();
  private readonly runtimeOverrides = new Map<string, ConfigValue>();
  private databaseValues = new Map<string, StoredConfiguration>();
  private publisher?: Redis;
  private subscriber?: Redis;
  private initialized = false;

  constructor(private readonly store: ConfigStore = new PrismaConfigStore()) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.reload();

    if (process.env.REDIS_URL) {
      this.publisher = new Redis(process.env.REDIS_URL);
      this.subscriber = new Redis(process.env.REDIS_URL);
      await this.subscriber.subscribe(CONFIG_CHANGE_CHANNEL);
      this.subscriber.on('message', (_channel, payload) => {
        try {
          const event = JSON.parse(payload) as ConfigChangeEvent;
          this.reload(event.key).catch((error) => console.warn('[config] reload failed', error));
          this.events.emit('changed', event);
        } catch (error) {
          console.warn('[config] invalid change event', error);
        }
      });
    }

    this.initialized = true;
  }

  async reload(key?: string): Promise<void> {
    if (key) {
      const stored = await this.store.get(key);
      if (stored) this.databaseValues.set(key, stored);
      else this.databaseValues.delete(key);
      return;
    }

    const rows = await this.store.list();
    this.databaseValues = new Map(rows.map((row) => [row.key, row]));
  }

  list(): ResolvedConfig[] {
    return Object.keys(CONFIG_DEFINITIONS).map((key) => this.get(key as ConfigKey));
  }

  schema() {
    return configSchemaSnapshot();
  }

  get<T extends ConfigValue = ConfigValue>(key: ConfigKey): ResolvedConfig<T> {
    const definition = CONFIG_DEFINITIONS[key];
    let value: ConfigValue = definition.defaultValue;
    let source: ConfigSource = 'default';
    let version: number | undefined;
    let updatedAt: string | undefined;

    if (definition.envVar && process.env[definition.envVar] !== undefined) {
      value = parseEnvValue(definition, process.env[definition.envVar] as string);
      source = 'environment';
    }

    const stored = this.databaseValues.get(key);
    if (stored) {
      value = stored.value;
      source = 'database';
      version = stored.version;
      updatedAt = stored.updatedAt.toISOString();
    }

    if (this.runtimeOverrides.has(key)) {
      value = this.runtimeOverrides.get(key) as ConfigValue;
      source = 'runtime';
    }

    const parsed = definition.schema.parse(value) as T;
    return {
      key,
      description: definition.description,
      type: definition.type,
      defaultValue: definition.defaultValue as T,
      value: parsed,
      source,
      version,
      updatedAt,
      sensitive: definition.sensitive ?? false,
    };
  }

  async update(input: {
    key: string;
    value: unknown;
    actor?: string;
    reason?: string;
    requestId?: string;
    expectedVersion?: number;
  }): Promise<ResolvedConfig> {
    let value: ConfigValue;
    try {
      value = validateConfigValue(input.key, input.value);
    } catch (error) {
      const details = error instanceof z.ZodError ? error.flatten() : { message: (error as Error).message };
      throw new AppError(400, 'Invalid configuration value', 'ERR_CONFIG_INVALID_VALUE', details);
    }

    const definition = CONFIG_DEFINITIONS[input.key as ConfigKey];
    const result = await this.store.upsert({
      key: input.key,
      value,
      description: definition.description,
      actor: input.actor,
      expectedVersion: input.expectedVersion,
    });

    if (result.conflict) {
      throw new AppError(409, 'Configuration update conflict', 'ERR_CONFIG_CONFLICT', {
        expectedVersion: input.expectedVersion,
        currentVersion: result.before?.version,
      });
    }

    await this.store.audit({
      key: input.key,
      oldValue: result.before?.value ?? null,
      newValue: value,
      actor: input.actor,
      reason: input.reason,
      source: 'admin',
      requestId: input.requestId,
    });

    await this.reload(input.key);
    await this.publishChange({
      key: input.key,
      value,
      source: 'database',
      version: result.after.version,
      changedAt: new Date().toISOString(),
    });

    return this.get(input.key as ConfigKey);
  }

  async setRuntimeOverride(key: string, value: unknown): Promise<ResolvedConfig> {
    const parsed = validateConfigValue(key, value);
    this.runtimeOverrides.set(key, parsed);
    const resolved = this.get(key as ConfigKey);
    await this.publishChange({
      key,
      value: parsed,
      source: 'runtime',
      version: resolved.version,
      changedAt: new Date().toISOString(),
    });
    return resolved;
  }

  async import(values: Record<string, unknown>, actor?: string, reason?: string, requestId?: string): Promise<number> {
    let updated = 0;
    for (const [key, value] of Object.entries(values)) {
      await this.update({ key, value, actor, reason, requestId });
      updated += 1;
    }
    return updated;
  }

  export(): Record<string, ConfigValue> {
    return Object.fromEntries(this.list().map((entry) => [entry.key, entry.value]));
  }

  subscribe(listener: (event: ConfigChangeEvent) => void): () => void {
    this.events.on('changed', listener);
    return () => this.events.off('changed', listener);
  }

  async audit(limit?: number) {
    return this.store.listAudit(limit);
  }

  private async publishChange(event: ConfigChangeEvent): Promise<void> {
    this.events.emit('changed', event);
    if (this.publisher) {
      await this.publisher.publish(CONFIG_CHANGE_CHANNEL, JSON.stringify(event));
    }
  }
}

export const configurationService = new ConfigurationService();
