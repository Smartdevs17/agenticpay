import fs from 'node:fs';
import path from 'node:path';
import type { GeneratorConfig } from './types.js';

export async function startWatcher(
  config: GeneratorConfig,
  generateFn: () => Promise<void>,
): Promise<void> {
  const specDir = path.dirname(config.specPath);
  const specFile = path.basename(config.specPath);

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastChange = Date.now();

  const debouncedGenerate = () => {
    const now = Date.now();
    if (now - lastChange < 500) {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(debouncedGenerate, 500);
      return;
    }
    lastChange = now;

    const timestamp = new Date().toISOString().slice(11, 19);
    console.log(`[${timestamp}] Spec changed, regenerating...`);
    generateFn().catch((err) => {
      console.error('[api-hooks-generator] Generation error:', err);
    });
  };

  console.log(`[api-hooks-generator] Watching ${specDir} for changes to ${specFile}...`);

  // Initial generation
  await generateFn();

  // Poll for changes (simple cross-platform approach)
  let previousStat = fs.statSync(config.specPath).mtimeMs;

  setInterval(() => {
    try {
      const currentStat = fs.statSync(config.specPath).mtimeMs;
      if (currentStat > previousStat) {
        previousStat = currentStat;
        debouncedGenerate();
      }
    } catch {
      // File might be temporarily unavailable
    }
  }, 1000);
}
