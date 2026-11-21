import { z } from 'zod';

export type ConfigValue = string | number | boolean | null | ConfigValue[] | { [key: string]: ConfigValue };
export type ConfigSource = 'default' | 'environment' | 'database' | 'runtime';
export type ConfigType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface ConfigDefinition<T extends ConfigValue = ConfigValue> {
  key: string;
  description: string;
  type: ConfigType;
  schema: z.ZodType<T>;
  defaultValue: T;
  envVar?: string;
  sensitive?: boolean;
}

export interface ResolvedConfig<T extends ConfigValue = ConfigValue> {
  key: string;
  description: string;
  type: ConfigType;
  defaultValue: T;
  value: T;
  source: ConfigSource;
  version?: number;
  updatedAt?: string;
  sensitive?: boolean;
}

const jsonRecord = z.record(z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.unknown()), z.record(z.unknown())]));

export const CONFIG_DEFINITIONS = {
  'features.batchOperations': {
    key: 'features.batchOperations',
    description: 'Enable batch payment operations.',
    type: 'boolean',
    schema: z.boolean(),
    defaultValue: true,
    envVar: 'FEATURE_BATCH_OPERATIONS',
  },
  'features.sandboxMode': {
    key: 'features.sandboxMode',
    description: 'Enable sandbox-only development behavior.',
    type: 'boolean',
    schema: z.boolean(),
    defaultValue: false,
    envVar: 'SANDBOX_MODE',
  },
  'fees.platformBps': {
    key: 'fees.platformBps',
    description: 'Platform fee in basis points.',
    type: 'number',
    schema: z.number().int().min(0).max(10_000),
    defaultValue: 100,
    envVar: 'PLATFORM_FEE_BPS',
  },
  'rateLimits.free': {
    key: 'rateLimits.free',
    description: 'Default free-tier API request limit.',
    type: 'number',
    schema: z.number().int().positive(),
    defaultValue: 100,
    envVar: 'RATE_LIMIT_FREE',
  },
  'rateLimits.pro': {
    key: 'rateLimits.pro',
    description: 'Default pro-tier API request limit.',
    type: 'number',
    schema: z.number().int().positive(),
    defaultValue: 300,
    envVar: 'RATE_LIMIT_PRO',
  },
  'rateLimits.enterprise': {
    key: 'rateLimits.enterprise',
    description: 'Default enterprise-tier API request limit.',
    type: 'number',
    schema: z.number().int().positive(),
    defaultValue: 1000,
    envVar: 'RATE_LIMIT_ENTERPRISE',
  },
  'providers.stellar': {
    key: 'providers.stellar',
    description: 'Stellar provider settings.',
    type: 'object',
    schema: z.object({
      network: z.enum(['testnet', 'public']).default('testnet'),
      horizonUrl: z.string().url().optional(),
    }),
    defaultValue: { network: 'testnet' },
    envVar: 'STELLAR_PROVIDER_CONFIG',
  },
  'providers.stripe': {
    key: 'providers.stripe',
    description: 'Stripe provider settings.',
    type: 'object',
    schema: z.object({
      enabled: z.boolean().default(false),
      publishableKey: z.string().optional(),
    }),
    defaultValue: { enabled: false },
    envVar: 'STRIPE_PROVIDER_CONFIG',
  },
  'payments.defaultCurrency': {
    key: 'payments.defaultCurrency',
    description: 'Default payment currency for new payment flows.',
    type: 'string',
    schema: z.string().min(2).max(16),
    defaultValue: 'XLM',
    envVar: 'DEFAULT_PAYMENT_CURRENCY',
  },
  'notifications.webhookRetries': {
    key: 'notifications.webhookRetries',
    description: 'Maximum webhook delivery retry attempts.',
    type: 'number',
    schema: z.number().int().min(0).max(25),
    defaultValue: 5,
    envVar: 'WEBHOOK_RETRY_ATTEMPTS',
  },
} as const satisfies Record<string, ConfigDefinition>;

export type ConfigKey = keyof typeof CONFIG_DEFINITIONS;

export function parseEnvValue(definition: ConfigDefinition, raw: string): ConfigValue {
  if (definition.type === 'boolean') return raw === 'true' || raw === '1';
  if (definition.type === 'number') return Number(raw);
  if (definition.type === 'object' || definition.type === 'array') return JSON.parse(raw);
  return raw;
}

export function validateConfigValue(key: string, value: unknown): ConfigValue {
  const definition = CONFIG_DEFINITIONS[key as ConfigKey];
  if (!definition) {
    throw new Error(`Unknown configuration key: ${key}`);
  }
  return definition.schema.parse(value) as ConfigValue;
}

export function configSchemaSnapshot() {
  return Object.values(CONFIG_DEFINITIONS).map((definition) => ({
    key: definition.key,
    description: definition.description,
    type: definition.type,
    defaultValue: definition.defaultValue,
    envVar: definition.envVar,
    sensitive: definition.sensitive ?? false,
  }));
}
