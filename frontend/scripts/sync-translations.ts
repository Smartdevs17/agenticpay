#!/usr/bin/env tsx
/**
 * Automated translation pipeline — Issue #476
 *
 * Syncs missing keys from en.json to target locales via DeepL API.
 * Usage: DEEPL_API_KEY=... npx tsx scripts/sync-translations.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const MESSAGES_DIR = join(ROOT, 'messages');
const SOURCE_LOCALE = 'en';
const TARGET_LOCALES = ['es', 'fr', 'ja', 'ar'];

type Messages = Record<string, unknown>;

function loadMessages(locale: string): Messages {
  const path = join(MESSAGES_DIR, `${locale}.json`);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf-8')) as Messages;
}

function saveMessages(locale: string, messages: Messages): void {
  writeFileSync(join(MESSAGES_DIR, `${locale}.json`), JSON.stringify(messages, null, 2) + '\n');
}

function getNested(obj: Messages, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Messages)[key];
  }
  return current;
}

function setNested(obj: Messages, path: string[], value: string): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Messages;
  }
  current[path[path.length - 1]!] = value;
}

function collectLeafPaths(obj: Messages, prefix: string[] = []): Array<{ path: string[]; value: string }> {
  const leaves: Array<{ path: string[]; value: string }> = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = [...prefix, key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      leaves.push(...collectLeafPaths(value as Messages, path));
    } else if (typeof value === 'string') {
      leaves.push({ path, value });
    }
  }
  return leaves;
}

async function translateText(text: string, targetLang: string): Promise<string> {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) return text;

  const res = await fetch('https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      auth_key: apiKey,
      text,
      target_lang: targetLang.toUpperCase(),
    }),
  });

  if (!res.ok) {
    console.warn(`[i18n] DeepL failed for "${text.slice(0, 40)}": ${res.status}`);
    return text;
  }

  const body = (await res.json()) as { translations?: Array<{ text: string }> };
  return body.translations?.[0]?.text ?? text;
}

async function main(): Promise<void> {
  const source = loadMessages(SOURCE_LOCALE);
  const sourceLeaves = collectLeafPaths(source);

  for (const locale of TARGET_LOCALES) {
    const target = loadMessages(locale);
    let updated = 0;

    for (const leaf of sourceLeaves) {
      if (getNested(target, leaf.path) !== undefined) continue;
      const translated = await translateText(leaf.value, locale);
      setNested(target, leaf.path, translated);
      updated++;
    }

    saveMessages(locale, target);
    console.log(`[i18n] ${locale}: added ${updated} missing key(s)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
