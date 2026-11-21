#!/usr/bin/env tsx
/**
 * Validates translation file parity against en.json — Issue #476
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const MESSAGES_DIR = join(ROOT, 'messages');
const SOURCE = 'en';
const TARGETS = ['es', 'fr', 'ja', 'ar'];

type Messages = Record<string, unknown>;

function loadMessages(locale: string): Messages {
  const path = join(MESSAGES_DIR, `${locale}.json`);
  if (!existsSync(path)) throw new Error(`Missing messages file: ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8')) as Messages;
}

function flattenKeys(obj: Messages, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Messages, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function main(): void {
  const source = loadMessages(SOURCE);
  const sourceKeys = flattenKeys(source);
  let failed = false;

  for (const locale of TARGETS) {
    const target = loadMessages(locale);
    const targetKeys = new Set(flattenKeys(target));
    const missing = sourceKeys.filter((k) => !targetKeys.has(k));
    const extra = [...targetKeys].filter((k) => !sourceKeys.includes(k));

    if (missing.length > 0) {
      failed = true;
      console.error(`[i18n:check] ${locale}: missing ${missing.length} key(s)`);
      for (const key of missing.slice(0, 20)) {
        console.error(`  - ${key}`);
      }
      if (missing.length > 20) console.error(`  …and ${missing.length - 20} more`);
    }

    if (extra.length > 0) {
      console.warn(`[i18n:check] ${locale}: ${extra.length} extra key(s) not in en.json`);
    }

    if (missing.length === 0) {
      console.log(`[i18n:check] ${locale}: OK (${sourceKeys.length} keys)`);
    }
  }

  if (failed) process.exit(1);
}

main();
