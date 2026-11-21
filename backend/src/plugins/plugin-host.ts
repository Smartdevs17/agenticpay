import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import type { ExtensionPoint, HookContextByExtensionPoint } from './extension-points.js';
import { extensionPoints } from './extension-points.js';
import type { AgenticPayPlugin, PluginHookMap } from './types.js';

export interface PluginHostOptions {
  timeoutMs?: number;
  maxSourceBytes?: number;
}

const DEFAULT_OPTIONS: Required<PluginHostOptions> = {
  timeoutMs: 500,
  maxSourceBytes: 256_000,
};

function assertPlugin(value: unknown): asserts value is AgenticPayPlugin {
  const plugin = value as Partial<AgenticPayPlugin>;
  if (!plugin.name || !plugin.version || !plugin.hooks) {
    throw new Error('Plugin must export name, version, and hooks');
  }

  for (const hookName of Object.keys(plugin.hooks)) {
    if (!extensionPoints.includes(hookName as ExtensionPoint)) {
      throw new Error(`Unsupported plugin hook: ${hookName}`);
    }
  }
}

export class PluginHost {
  private readonly options: Required<PluginHostOptions>;
  private readonly plugins = new Map<string, AgenticPayPlugin>();

  constructor(options: PluginHostOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async loadFromFile(id: string, source: string): Promise<AgenticPayPlugin> {
    const code = await readFile(source, 'utf8');
    if (Buffer.byteLength(code, 'utf8') > this.options.maxSourceBytes) {
      throw new Error('Plugin source exceeds configured size limit');
    }

    const sandbox = {
      module: { exports: {} },
      exports: {},
      console: {
        log: (...args: unknown[]) => console.log(`[plugin:${id}]`, ...args),
        warn: (...args: unknown[]) => console.warn(`[plugin:${id}]`, ...args),
        error: (...args: unknown[]) => console.error(`[plugin:${id}]`, ...args),
      },
      setTimeout: undefined,
      setInterval: undefined,
      process: undefined,
      require: undefined,
    };

    const context = vm.createContext(sandbox, {
      name: `agenticpay-plugin:${id}`,
      codeGeneration: { strings: false, wasm: false },
    });
    const script = new vm.Script(code, { filename: source });
    script.runInContext(context, { timeout: this.options.timeoutMs });

    const exported = (sandbox.module.exports as { default?: unknown }).default ?? sandbox.module.exports;
    assertPlugin(exported);
    this.plugins.set(id, exported);
    return exported;
  }

  unload(id: string): void {
    this.plugins.delete(id);
  }

  async install(id: string, config: Record<string, unknown>): Promise<void> {
    await this.plugins.get(id)?.install?.(config);
  }

  async uninstall(id: string): Promise<void> {
    await this.plugins.get(id)?.uninstall?.();
    this.unload(id);
  }

  async runHook<Point extends ExtensionPoint>(
    point: Point,
    context: HookContextByExtensionPoint[Point]
  ): Promise<Array<{ pluginId: string; result: unknown }>> {
    const results: Array<{ pluginId: string; result: unknown }> = [];
    for (const [pluginId, plugin] of this.plugins) {
      const hook = plugin.hooks[point];
      if (!hook) continue;
      const typedHook = hook as NonNullable<PluginHookMap[Point]>;
      const result = await Promise.race([
        typedHook(context),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Plugin hook timed out')), this.options.timeoutMs)),
      ]);
      results.push({ pluginId, result });
    }
    return results;
  }
}
