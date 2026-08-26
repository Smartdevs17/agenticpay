import { prisma } from '../lib/prisma.js';
import { PluginHost } from './plugin-host.js';
import type { ExtensionPoint, HookContextByExtensionPoint } from './extension-points.js';
import type { PluginHealth, PluginPrismaClient } from './types.js';

const CORE_VERSION = process.env.AGENTICPAY_VERSION ?? '0.1.0';

function parseMajor(version: string): number {
  return Number(version.replace(/^[^\d]*/, '').split('.')[0] ?? 0);
}

function isCompatible(coreVersion: string, range: string): boolean {
  if (range === '*' || range === coreVersion) return true;
  if (range.startsWith('^')) return parseMajor(range) === parseMajor(coreVersion);
  if (range.startsWith('>=')) return parseMajor(coreVersion) >= parseMajor(range);
  return false;
}

export class PluginRegistry {
  constructor(
    private readonly host = new PluginHost(),
    private readonly db = prisma as unknown as PluginPrismaClient
  ) {}

  list() {
    return this.db.plugin.findMany({ orderBy: { installedAt: 'desc' } });
  }

  marketplace() {
    const configured = process.env.PLUGIN_MARKETPLACE
      ? JSON.parse(process.env.PLUGIN_MARKETPLACE) as unknown
      : undefined;

    if (Array.isArray(configured)) return configured;

    return [
      {
        name: 'agenticpay-fee-sample',
        version: '0.1.0',
        description: 'Sample fee:calculate extension',
        compatibility: { agenticPay: `^${CORE_VERSION}` },
      },
    ];
  }

  async install(input: {
    name: string;
    version: string;
    source: string;
    compatibility?: { agenticPay?: string; node?: string };
    config?: Record<string, unknown>;
    actorId?: string;
  }) {
    const compatibility = {
      agenticPay: input.compatibility?.agenticPay ?? `^${CORE_VERSION}`,
      node: input.compatibility?.node ?? process.version,
    };
    if (!isCompatible(CORE_VERSION, compatibility.agenticPay)) {
      throw new Error(`Plugin ${input.name} is not compatible with AgenticPay ${CORE_VERSION}`);
    }

    const record = await this.db.plugin.create({
      data: {
        name: input.name,
        version: input.version,
        source: input.source,
        compatibility,
        health: { status: 'healthy', errorCount: 0 } satisfies PluginHealth,
      },
    });
    await this.db.pluginConfig.upsert({
      where: { pluginId_environment: { pluginId: record.id, environment: 'default' } },
      create: { pluginId: record.id, environment: 'default', config: input.config ?? {} },
      update: { config: input.config ?? {} },
    });
    await this.audit(record.id, 'install', input.actorId, { source: input.source });
    await this.enable(record.id, input.actorId);
    return record;
  }

  async enable(pluginId: string, actorId?: string) {
    const record = await this.db.plugin.findUnique({ where: { id: pluginId } });
    if (!record) throw new Error('Plugin not found');
    const configRecord = await this.db.pluginConfig.findUnique({
      where: { pluginId_environment: { pluginId, environment: 'default' } },
    });
    await this.host.loadFromFile(pluginId, record.source);
    await this.host.install(pluginId, (configRecord?.config as Record<string, unknown>) ?? {});
    const updated = await this.db.plugin.update({
      where: { id: pluginId },
      data: {
        status: 'enabled',
        disabledAt: null,
        health: { status: 'healthy', errorCount: 0 } satisfies PluginHealth,
      },
    });
    await this.audit(pluginId, 'enable', actorId);
    return updated;
  }

  async disable(pluginId: string, actorId?: string, reason?: string) {
    await this.host.uninstall(pluginId).catch(() => undefined);
    const health: PluginHealth = reason
      ? { status: 'disabled', errorCount: 0, lastError: reason }
      : { status: 'disabled', errorCount: 0 };
    const updated = await this.db.plugin.update({
      where: { id: pluginId },
      data: {
        status: 'disabled',
        disabledAt: new Date(),
        health,
      },
    });
    await this.audit(pluginId, 'disable', actorId, { reason });
    return updated;
  }

  async remove(pluginId: string, actorId?: string) {
    await this.host.uninstall(pluginId).catch(() => undefined);
    await this.audit(pluginId, 'remove', actorId);
    return this.db.plugin.delete({ where: { id: pluginId } });
  }

  async update(pluginId: string, input: { version?: string; source?: string; actorId?: string }) {
    const current = await this.db.plugin.findUnique({ where: { id: pluginId } });
    if (!current) throw new Error('Plugin not found');
    await this.host.uninstall(pluginId).catch(() => undefined);
    const updated = await this.db.plugin.update({
      where: { id: pluginId },
      data: {
        version: input.version ?? current.version,
        source: input.source ?? current.source,
        status: 'installed',
        health: { status: 'healthy', errorCount: 0 } satisfies PluginHealth,
      },
    });
    await this.audit(pluginId, 'update', input.actorId, { version: input.version, source: input.source });
    return updated;
  }

  async updateConfig(pluginId: string, config: Record<string, unknown>, actorId?: string) {
    await this.db.pluginConfig.upsert({
      where: { pluginId_environment: { pluginId, environment: 'default' } },
      create: { pluginId, environment: 'default', config },
      update: { config },
    });
    await this.audit(pluginId, 'configure', actorId);
  }

  async runHook<Point extends ExtensionPoint>(
    point: Point,
    context: HookContextByExtensionPoint[Point]
  ) {
    try {
      return await this.host.runHook(point, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Plugin hook failed';
      await this.disableFaultyPlugins(message);
      throw error;
    }
  }

  auditLog(pluginId?: string) {
    return this.db.pluginAuditLog.findMany({
      where: pluginId ? { pluginId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  private async disableFaultyPlugins(message: string) {
    const plugins = await this.db.plugin.findMany({ where: { status: 'enabled' } });
    await Promise.all(
      plugins.map((plugin) =>
        this.db.plugin.update({
          where: { id: plugin.id },
          data: {
            status: 'error',
            disabledAt: new Date(),
            health: { status: 'disabled', errorCount: 1, lastError: message } satisfies PluginHealth,
          },
        })
      )
    );
  }

  private audit(pluginId: string, action: string, actorId?: string, details?: Record<string, unknown>) {
    return this.db.pluginAuditLog.create({
      data: { pluginId, actorId, action, details },
    });
  }
}

export const pluginRegistry = new PluginRegistry();
