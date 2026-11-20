import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { OPENAPI_GENERATOR_IMAGE, buildGeneratorCommand } from './generate-sdk.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const backendDir = resolve(repoRoot, 'backend');
const config = JSON.parse(readFileSync(resolve(backendDir, 'openapi-generator.config.json'), 'utf8'));
const workflow = readFileSync(resolve(repoRoot, '.github/workflows/sdk-generation.yml'), 'utf8');
const backendPackage = JSON.parse(readFileSync(resolve(backendDir, 'package.json'), 'utf8'));

const build = (lang, overrides = {}) =>
  buildGeneratorCommand({ lang, config, repoRoot, backendDir, uid: 1000, gid: 1000, ...overrides });

test('builds a docker invocation that mounts the repo and writes into packages/sdk', () => {
  const { command, args } = build('typescript');

  assert.equal(command, 'docker');
  assert.deepEqual(args.slice(0, 6), ['run', '--rm', '--user', '1000:1000', '--volume', `${repoRoot}:/local`]);
  assert.equal(args[6], OPENAPI_GENERATOR_IMAGE);
  assert.equal(args[7], 'generate');
  assert.equal(args[args.indexOf('--input-spec') + 1], '/local/backend/docs/api/openapi/openapi.json');
  assert.equal(args[args.indexOf('--generator-name') + 1], 'typescript-axios');
  assert.equal(args[args.indexOf('--output') + 1], '/local/packages/sdk/generated/typescript');
});

test('passes the configured additional properties as one comma-separated flag', () => {
  const { args } = build('typescript');
  const props = args[args.indexOf('--additional-properties') + 1];
  assert.match(props, /(^|,)npmName=@agenticpay\/sdk(,|$)/);
  assert.match(props, /(^|,)stringEnums=true(,|$)/);
});

test('per-language properties override the shared typescript-axios options', () => {
  const overridden = structuredClone(config);
  overridden.generators.typescript.additionalProperties.stringEnums = 'false';
  const { args } = build('typescript', { config: overridden });
  const props = args[args.indexOf('--additional-properties') + 1].split(',');
  assert.ok(props.includes('stringEnums=false'));
  assert.ok(!props.includes('stringEnums=true'));
});

test('passes global properties (models, apis, supporting files) to the generator', () => {
  const { args } = build('typescript');
  const globals = args[args.indexOf('--global-property') + 1];
  assert.match(globals, /(^|,)models=true(,|$)/);
  assert.match(globals, /(^|,)modelTests=false(,|$)/);
});

test('does not apply typescript-axios options to other generators', () => {
  const { args } = build('python');
  assert.ok(!args.includes('--global-property'));
  const props = args[args.indexOf('--additional-properties') + 1];
  assert.ok(!props.includes('stringEnums'));
});

test('pins the generator image to the version declared in the config', () => {
  assert.equal(OPENAPI_GENERATOR_IMAGE, `openapitools/openapi-generator-cli:v${config.openapiGenerator.version}`);
});

test('omits --user when the host uid/gid are unknown (e.g. on Windows)', () => {
  const { args } = build('python', { uid: undefined, gid: undefined });
  assert.ok(!args.includes('--user'));
});

test('rejects a language with no generator configured and names the known ones', () => {
  assert.throws(() => build('rust'), /no generator configured for "rust" \(configured: .*typescript/);
});

test('rejects an output directory outside the repository', () => {
  const badConfig = structuredClone(config);
  badConfig.generators.go.outputDir = '../../../etc';
  assert.throws(
    () => build('go', { config: badConfig }),
    /outside the repository/,
  );
});

test('rejects an additional property that contains a comma', () => {
  const badConfig = structuredClone(config);
  badConfig.generators.python.additionalProperties.packageName = 'a,b';
  assert.throws(() => build('python', { config: badConfig }), /must not contain a comma/);
});

test('every language in the SDK workflow matrix has a generator config and a backend script', () => {
  const matrix = workflow.match(/language:\s*\[([^\]]+)\]/);
  assert.ok(matrix, 'sdk-generation.yml must declare a language matrix');
  const languages = matrix[1].split(',').map((s) => s.trim());
  assert.ok(languages.length > 0);

  for (const lang of languages) {
    assert.ok(config.generators[lang], `no generator config for workflow language "${lang}"`);
    assert.equal(
      backendPackage.scripts[`sdk:generate:${lang}`],
      `node ../scripts/sdk/generate-sdk.mjs ${lang}`,
      `backend/package.json is missing sdk:generate:${lang}`,
    );
  }
});

test('the CLI prints the docker command with --print', () => {
  const result = spawnSync(process.execPath, [resolve(repoRoot, 'scripts/sdk/generate-sdk.mjs'), 'typescript', '--print'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^docker run --rm/);
  assert.ok(result.stdout.includes(OPENAPI_GENERATOR_IMAGE));
});

test('the CLI exits 2 with usage when no language is given', () => {
  const result = spawnSync(process.execPath, [resolve(repoRoot, 'scripts/sdk/generate-sdk.mjs')], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage:/);
});
