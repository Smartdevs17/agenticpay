// Pins .github/CODEOWNERS: valid GitHub syntax, no stale patterns, every
// top-level directory explicitly owned, and high-risk paths resolving to the
// rule intended for them under GitHub's last-match-wins semantics.
//
// Owner validity (users/teams with write access) can only be checked by
// GitHub; the CI tooling job queries the CODEOWNERS errors API for that.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(repositoryRoot, path), 'utf8');

const rules = read('.github/CODEOWNERS')
  .split('\n')
  .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
  .filter(({ raw }) => raw && !raw.startsWith('#'))
  .map(({ raw, line }) => {
    const [pattern, ...owners] = raw.split(/\s+/);
    return { pattern, owners, line, regex: toRegex(pattern) };
  });

const trackedFiles = execFileSync('git', ['ls-files'], { cwd: repositoryRoot, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

/** GitHub CODEOWNERS uses gitignore-style patterns (minus `!` and `[]`). */
function toRegex(pattern) {
  const directoryOnly = pattern.endsWith('/');
  let body = pattern.replace(/^\//, '').replace(/\/$/, '');
  const anchored = pattern.startsWith('/') || body.includes('/');
  body = body
    .split(/(\*\*\/|\/\*\*$|\*\*|\*|\?)/)
    .map((part) => {
      if (part === '**/') return '(?:.*/)?';
      if (part === '/**') return '/.*';
      if (part === '**') return '.*';
      if (part === '*') return '[^/]*';
      if (part === '?') return '[^/]';
      return part.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  const prefix = anchored ? '^' : '^(?:.*/)?';
  const suffix = directoryOnly ? '/.*$' : '(?:/.*)?$';
  return new RegExp(prefix + body + suffix);
}

/** The rule GitHub applies to `path`: the last one that matches. */
function ownerRule(path) {
  return rules.findLast((rule) => rule.regex.test(path));
}

describe('pattern matcher', () => {
  const matches = (pattern, path) => toRegex(pattern).test(path);

  test('catch-all matches every path', () => {
    assert.ok(matches('*', 'README.md'));
    assert.ok(matches('*', 'backend/src/index.ts'));
  });

  test('leading slash anchors to the repo root', () => {
    assert.ok(matches('/infra/', 'infra/main.tf'));
    assert.ok(!matches('/infra/', 'docs/infra/main.tf'));
  });

  test('trailing slash matches everything below the directory', () => {
    assert.ok(matches('/backend/src/payments/', 'backend/src/payments/stripe/client.ts'));
    assert.ok(!matches('/backend/src/payments/', 'backend/src/payments.ts'));
  });

  test('single star does not cross directories', () => {
    assert.ok(matches('/Dockerfile.*', 'Dockerfile.backend'));
    assert.ok(!matches('/docker-compose*.yml', 'infra/docker-compose.yml'));
  });

  test('unanchored name matches at any depth', () => {
    assert.ok(matches('package.json', 'frontend/package.json'));
  });
});

describe('.github/CODEOWNERS', () => {
  test('every rule has a pattern and at least one well-formed owner', () => {
    for (const { pattern, owners, line } of rules) {
      assert.ok(owners.length > 0, `line ${line}: ${pattern} has no owner`);
      for (const owner of owners) {
        assert.match(
          owner,
          /^@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\/[A-Za-z0-9._-]+)?$|^[^@\s]+@[^@\s]+\.[^@\s]+$/,
          `line ${line}: malformed owner ${owner}`,
        );
      }
    }
  });

  test('uses only syntax GitHub supports', () => {
    for (const { pattern, line } of rules) {
      assert.ok(!pattern.startsWith('!'), `line ${line}: negation is not supported by CODEOWNERS`);
      assert.ok(!/[[\]]/.test(pattern), `line ${line}: character ranges are not supported`);
    }
  });

  test('starts with a catch-all so no file is left without an owner', () => {
    assert.equal(rules[0].pattern, '*');
  });

  test('has no duplicate patterns (a later duplicate silently overrides)', () => {
    const seen = new Map();
    for (const { pattern, line } of rules) {
      assert.ok(!seen.has(pattern), `line ${line}: ${pattern} already declared on line ${seen.get(pattern)}`);
      seen.set(pattern, line);
    }
  });

  test('every pattern matches at least one tracked file (no stale rules)', () => {
    for (const { pattern, regex, line } of rules) {
      assert.ok(
        trackedFiles.some((file) => regex.test(file)),
        `line ${line}: ${pattern} matches no tracked file — remove or fix it`,
      );
    }
  });

  test('every top-level directory has an explicit owner rule', () => {
    const topLevelDirectories = new Set(
      trackedFiles.filter((file) => file.includes('/')).map((file) => file.split('/')[0]),
    );
    const declared = new Set(rules.map((rule) => rule.pattern));
    for (const directory of topLevelDirectories) {
      assert.ok(
        declared.has(`/${directory}/`),
        `/${directory}/ has no CODEOWNERS rule — add one when creating a top-level directory`,
      );
    }
  });

  for (const [path, expected] of [
    ['backend/src/payments/razorpay.ts', '/backend/src/payments/'],
    ['backend/src/auth/session.ts', '/backend/src/auth/'],
    ['backend/src/routes/invoices.ts', '/backend/'],
    ['backend/prisma/schema.prisma', '/backend/prisma/'],
    ['backend/migrations/runner.ts', '/backend/migrations/'],
    ['contracts/Splitter.sol', '/contracts/'],
    ['infra/sentry/upload-sourcemaps.mjs', '/infra/'],
    ['.github/workflows/release.yml', '/.github/workflows/'],
    ['.github/CODEOWNERS', '/.github/CODEOWNERS'],
    ['.github/PULL_REQUEST_TEMPLATE.md', '/.github/'],
    ['frontend/app/page.tsx', '/frontend/'],
    ['package-lock.json', '/package-lock.json'],
    ['frontend/package.json', '/frontend/'],
    ['Dockerfile.backend', '/Dockerfile.*'],
    ['README.md', '*'],
  ]) {
    test(`${path} is owned by the ${expected} rule`, () => {
      assert.equal(ownerRule(path)?.pattern, expected);
    });
  }

  test('CI validates owners against GitHub', () => {
    assert.match(read('.github/workflows/ci.yml'), /codeowners\/errors/);
  });
});
