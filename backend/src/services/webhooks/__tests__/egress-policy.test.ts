import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EgressDeniedError,
  assertEgressAllowed,
  assertEgressUrl,
  isPrivateHostname,
  parseEgressPolicy,
  type EgressPolicy,
} from '../egress-policy.js';
import {
  attemptDelivery,
  getDeliveryLog,
  registerEndpoint,
  scheduleDelivery,
  DEFAULT_RETRY_POLICY,
} from '../delivery-manager.js';

const policy: EgressPolicy = {
  allowedHosts: ['hooks.example.com', '*.partner.io'],
  allowedPorts: [443],
};

function expectDenied(fn: () => unknown, reason: string) {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(EgressDeniedError);
  expect((caught as EgressDeniedError).reason).toBe(reason);
}

describe('parseEgressPolicy', () => {
  it('defaults to port 443 and an empty host allow-list (fail closed)', () => {
    expect(parseEgressPolicy({})).toEqual({ allowedHosts: [], allowedPorts: [443] });
  });

  it('parses and lowercases hosts and ports', () => {
    const parsed = parseEgressPolicy({
      WEBHOOK_EGRESS_ALLOWED_HOSTS: ' Hooks.Example.com , *.Partner.io ',
      WEBHOOK_EGRESS_ALLOWED_PORTS: '443, 8443',
    });
    expect(parsed.allowedHosts).toEqual(['hooks.example.com', '*.partner.io']);
    expect(parsed.allowedPorts).toEqual([443, 8443]);
  });

  it('rejects an invalid port', () => {
    expect(() => parseEgressPolicy({ WEBHOOK_EGRESS_ALLOWED_PORTS: '70000' })).toThrow(/invalid port/);
    expect(() => parseEgressPolicy({ WEBHOOK_EGRESS_ALLOWED_PORTS: 'https' })).toThrow(/invalid port/);
  });

  it('rejects a malformed host entry', () => {
    expect(() => parseEgressPolicy({ WEBHOOK_EGRESS_ALLOWED_HOSTS: 'bad_host!' })).toThrow(/invalid entry/);
    expect(() => parseEgressPolicy({ WEBHOOK_EGRESS_ALLOWED_HOSTS: '*.' })).toThrow(/invalid entry/);
  });
});

describe('assertEgressUrl', () => {
  it('allows an allow-listed https host on the default port', () => {
    expect(assertEgressUrl('https://hooks.example.com/in', policy).hostname).toBe('hooks.example.com');
  });

  it('allows an explicit default port', () => {
    expect(() => assertEgressUrl('https://hooks.example.com:443/in', policy)).not.toThrow();
  });

  it('denies a URL that cannot be parsed', () => {
    expectDenied(() => assertEgressUrl('not a url', policy), 'malformed_url');
  });

  it('denies plain http', () => {
    expectDenied(() => assertEgressUrl('http://hooks.example.com/in', policy), 'scheme_not_allowed');
  });

  it('denies a non-web scheme', () => {
    expectDenied(() => assertEgressUrl('file:///etc/passwd', policy), 'scheme_not_allowed');
  });

  it('denies userinfo in the URL', () => {
    expectDenied(() => assertEgressUrl('https://user:pw@hooks.example.com/', policy), 'credentials_in_url');
  });

  it('denies a port that is not on the allow-list', () => {
    expectDenied(() => assertEgressUrl('https://hooks.example.com:8443/', policy), 'port_not_allowed');
  });

  it('denies a host that is not on the allow-list', () => {
    expectDenied(() => assertEgressUrl('https://evil.example.org/', policy), 'host_not_allowed');
  });

  it('denies every host when the allow-list is empty', () => {
    expectDenied(
      () => assertEgressUrl('https://hooks.example.com/', { allowedHosts: [], allowedPorts: [443] }),
      'host_not_allowed',
    );
  });

  it('matches wildcard entries on subdomains only', () => {
    expect(() => assertEgressUrl('https://a.b.partner.io/', policy)).not.toThrow();
    expectDenied(() => assertEgressUrl('https://partner.io/', policy), 'host_not_allowed');
    // A suffix collision must not match: "evilpartner.io" is not a subdomain of "partner.io".
    expectDenied(() => assertEgressUrl('https://evilpartner.io/', policy), 'host_not_allowed');
  });

  it('is case-insensitive and ignores a trailing dot on the host', () => {
    expect(() => assertEgressUrl('https://HOOKS.example.com./x', policy)).not.toThrow();
  });

  it('denies localhost and loopback even when allow-listed', () => {
    const allowLoopback: EgressPolicy = { allowedHosts: ['localhost', '127.0.0.1', '[::1]'], allowedPorts: [443] };
    expectDenied(() => assertEgressUrl('https://localhost/', allowLoopback), 'private_address');
    expectDenied(() => assertEgressUrl('https://127.0.0.1/', allowLoopback), 'private_address');
    expectDenied(() => assertEgressUrl('https://[::1]/', allowLoopback), 'private_address');
  });

  it('denies private, link-local, and metadata addresses as literals', () => {
    const literals = [
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
    ];
    for (const ip of literals) {
      expectDenied(() => assertEgressUrl(`https://${ip}/`, { allowedHosts: [ip], allowedPorts: [443] }), 'private_address');
    }
  });

  it('denies IPv6 private, link-local, and unique-local literals', () => {
    for (const ip of ['[fe80::1]', '[fc00::1]', '[fd12:3456::1]', '[::]', '[ff02::1]']) {
      expectDenied(() => assertEgressUrl(`https://${ip}/`, { allowedHosts: [ip], allowedPorts: [443] }), 'private_address');
    }
  });

  it('judges IPv4-mapped IPv6 by its embedded IPv4 address', () => {
    expectDenied(
      () => assertEgressUrl('https://[::ffff:127.0.0.1]/', { allowedHosts: ['[::ffff:7f00:1]'], allowedPorts: [443] }),
      'private_address',
    );
  });

  it('allows an allow-listed public IP literal', () => {
    expect(() => assertEgressUrl('https://8.8.8.8/', { allowedHosts: ['8.8.8.8'], allowedPorts: [443] })).not.toThrow();
  });

  it('does not treat 172.32.0.0 as private (outside 172.16.0.0/12)', () => {
    expect(isPrivateHostname('172.32.0.1')).toBe(false);
  });
});

describe('isPrivateHostname', () => {
  it('treats an unparseable IPv6 literal as unsafe', () => {
    expect(isPrivateHostname('[zz::1]')).toBe(true);
  });

  it('treats a public hostname as safe', () => {
    expect(isPrivateHostname('hooks.example.com')).toBe(false);
  });
});

describe('assertEgressAllowed (DNS)', () => {
  it('allows a hostname that resolves only to public addresses', async () => {
    await expect(
      assertEgressAllowed('https://hooks.example.com/', policy, async () => ['93.184.216.34']),
    ).resolves.toBeInstanceOf(URL);
  });

  it('denies a hostname that resolves to any private address', async () => {
    await expect(
      assertEgressAllowed('https://hooks.example.com/', policy, async () => ['93.184.216.34', '10.0.0.5']),
    ).rejects.toMatchObject({ reason: 'private_address' });
  });

  it('does not call the resolver for an IP literal', async () => {
    const resolver = vi.fn(async () => ['8.8.8.8']);
    await assertEgressAllowed('https://8.8.8.8/', { allowedHosts: ['8.8.8.8'], allowedPorts: [443] }, resolver);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('reports a resolution failure as a retryable error, not a denial', async () => {
    const err = await assertEgressAllowed('https://hooks.example.com/', policy, async () => {
      throw new Error('ENOTFOUND');
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(EgressDeniedError);
  });

  it('reports an empty resolution as a retryable error', async () => {
    const err = await assertEgressAllowed('https://hooks.example.com/', policy, async () => []).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(EgressDeniedError);
  });
});

describe('webhook delivery egress wiring', () => {
  const ENV_KEYS = ['WEBHOOK_EGRESS_ALLOWED_HOSTS', 'WEBHOOK_EGRESS_ALLOWED_PORTS'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.WEBHOOK_EGRESS_ALLOWED_HOSTS = 'hooks.example.com';
    delete process.env.WEBHOOK_EGRESS_ALLOWED_PORTS;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function makeEndpoint(url: string) {
    return registerEndpoint({
      merchantId: 'm1',
      url,
      secret: 's',
      enabled: true,
      retryPolicy: { ...DEFAULT_RETRY_POLICY },
    });
  }

  it('refuses to register an endpoint outside the allow-list', () => {
    expect(() => makeEndpoint('https://evil.example.org/hook')).toThrow(EgressDeniedError);
    expect(() => makeEndpoint('http://hooks.example.com/hook')).toThrow(EgressDeniedError);
    expect(() => makeEndpoint('https://localhost/hook')).toThrow(EgressDeniedError);
  });

  it('delivers to an allowed endpoint without following redirects', async () => {
    const endpoint = makeEndpoint('https://hooks.example.com/hook');
    const log = scheduleDelivery(endpoint.id, 'm1', 'evt_ok', 'payment.paid', { amount: 1 });
    const fetchFn = vi.fn(async () => ({ status: 200, text: async () => 'ok' }));

    const result = await attemptDelivery(log.id, fetchFn, async () => ['93.184.216.34']);

    expect(result.status).toBe('delivered');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe('https://hooks.example.com/hook');
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('dead-letters without sending when DNS now points at a private address', async () => {
    const endpoint = makeEndpoint('https://hooks.example.com/rebind');
    const log = scheduleDelivery(endpoint.id, 'm1', 'evt_rebind', 'payment.paid', {});
    const fetchFn = vi.fn(async () => ({ status: 200, text: async () => 'ok' }));

    const result = await attemptDelivery(log.id, fetchFn, async () => ['169.254.169.254']);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.status).toBe('dead_letter');
    expect(result.failureCategory).toBe('invalid_endpoint');
    expect(result.lastError).toMatch(/private_address/);
    expect(getDeliveryLog(log.id)?.status).toBe('dead_letter');
  });

  it('retries, without sending, when DNS fails transiently', async () => {
    const endpoint = makeEndpoint('https://hooks.example.com/flaky');
    const log = scheduleDelivery(endpoint.id, 'm1', 'evt_dns', 'payment.paid', {});
    const fetchFn = vi.fn(async () => ({ status: 200, text: async () => 'ok' }));

    const result = await attemptDelivery(log.id, fetchFn, async () => {
      throw new Error('SERVFAIL');
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.status).toBe('retrying');
    expect(result.attempt).toBe(1);
    expect(result.nextAttemptAt).toBeDefined();
  });
});
