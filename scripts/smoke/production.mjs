const baseUrl = (process.env.SMOKE_BASE_URL || process.env.PRODUCTION_URL || '').replace(/\/$/, '');

if (!baseUrl) {
  console.error('Set SMOKE_BASE_URL or PRODUCTION_URL to run the production smoke suite.');
  process.exit(2);
}

const checks = [
  { path: '/ready', validate: (body) => body.status === 'ready' },
  { path: '/health', validate: (body) => body.status === 'healthy' || body.status === 'degraded' },
];

for (const check of checks) {
  const response = await fetch(`${baseUrl}${check.path}`, { headers: { accept: 'application/json' } });
  let body;
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  if (!response.ok || !check.validate(body)) {
    console.error(`Smoke check failed: ${check.path} (${response.status})`, body);
    process.exit(1);
  }

  console.log(`Smoke check passed: ${check.path}`);
}