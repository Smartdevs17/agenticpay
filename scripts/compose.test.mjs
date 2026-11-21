import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = resolve(repoRoot, 'docker-compose.yml');

function compose(args) {
  return spawnSync('docker', ['compose', '-f', composeFile, ...args], { encoding: 'utf8', cwd: repoRoot });
}

const dockerCompose = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
const skip = dockerCompose.status === 0 ? false : 'docker compose is not available';

function resolved(profiles = []) {
  const args = [];
  for (const profile of profiles) args.push('--profile', profile);
  args.push('config', '--format', 'json');
  const result = compose(args);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).services;
}

test('without a profile only the infrastructure services start', { skip }, () => {
  const services = Object.keys(resolved());
  assert.deepEqual(services.sort(), ['grafana', 'loki', 'postgres', 'redis'].sort());
});

test('the app profile adds the backend and frontend to the infrastructure', { skip }, () => {
  const services = Object.keys(resolved(['app']));
  for (const name of ['postgres', 'redis', 'loki', 'grafana', 'backend', 'frontend']) {
    assert.ok(services.includes(name), `expected ${name} in the app profile`);
  }
});

test('the backend builds from the production Dockerfile and waits for healthy infra', { skip }, () => {
  const backend = resolved(['app']).backend;
  assert.equal(backend.build.dockerfile, 'Dockerfile.backend');
  assert.equal(backend.depends_on.postgres.condition, 'service_healthy');
  assert.equal(backend.depends_on.redis.condition, 'service_healthy');
  assert.equal(backend.environment.DATABASE_URL, 'postgresql://postgres:postgres@postgres:5432/agenticpay');
});

test('the frontend passes NEXT_PUBLIC_API_URL as a build arg, not a runtime variable', { skip }, () => {
  const frontend = resolved(['app']).frontend;
  assert.equal(frontend.build.dockerfile, 'Dockerfile.frontend');
  assert.equal(frontend.build.args.NEXT_PUBLIC_API_URL, 'http://localhost:3001/api/v1');
  assert.equal(frontend.environment, undefined);
});

test('the frontend build arg follows NEXT_PUBLIC_API_URL from the environment', { skip }, () => {
  const result = spawnSync(
    'docker',
    ['compose', '-f', composeFile, '--profile', 'app', 'config', '--format', 'json'],
    {
      encoding: 'utf8',
      cwd: repoRoot,
      env: { ...process.env, NEXT_PUBLIC_API_URL: 'https://api.example.test/api/v1' },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const frontend = JSON.parse(result.stdout).services.frontend;
  assert.equal(frontend.build.args.NEXT_PUBLIC_API_URL, 'https://api.example.test/api/v1');
});
