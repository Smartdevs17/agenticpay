/**
 * Webhook egress policy (#1490).
 *
 * Every outbound webhook destination must pass this guard before we open a
 * connection. The guard is applied twice:
 *   1. when an endpoint is registered (fail fast, with a clear reason), and
 *   2. immediately before each delivery attempt (the DNS answer can change
 *      after registration, and an endpoint may have been stored by an older
 *      code path).
 *
 * Rules, in order:
 *   - the URL must parse, use `https:`, and carry no userinfo;
 *   - the effective port must be in the port allow-list (default: 443 only);
 *   - the hostname must match the host allow-list (exact host, or `*.suffix`);
 *   - the hostname and every resolved address must not be loopback, private,
 *     link-local, multicast, or unspecified. This check is not overridable by
 *     the allow-list, so an operator cannot point webhooks at internal services.
 *
 * An empty host allow-list denies all egress (fail closed).
 *
 * Configuration (environment):
 *   WEBHOOK_EGRESS_ALLOWED_HOSTS  comma-separated, e.g. "hooks.example.com,*.partner.io"
 *   WEBHOOK_EGRESS_ALLOWED_PORTS  comma-separated, default "443"
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { logger } from '../../utils/logger.js';

export type EgressDenyReason =
  | 'malformed_url'
  | 'scheme_not_allowed'
  | 'credentials_in_url'
  | 'port_not_allowed'
  | 'host_not_allowed'
  | 'private_address';

export class EgressDeniedError extends Error {
  readonly reason: EgressDenyReason;

  constructor(reason: EgressDenyReason, detail: string) {
    super(`webhook egress denied (${reason}): ${detail}`);
    this.name = 'EgressDeniedError';
    this.reason = reason;
  }
}

export interface EgressPolicy {
  /** Exact hostnames, or `*.suffix` wildcards that match any subdomain of `suffix`. */
  readonly allowedHosts: readonly string[];
  /** Effective ports (after applying the scheme default) that may be contacted. */
  readonly allowedPorts: readonly number[];
}

export type HostResolver = (hostname: string) => Promise<readonly string[]>;

const HTTPS_DEFAULT_PORT = 443;

export function parseEgressPolicy(env: NodeJS.ProcessEnv = process.env): EgressPolicy {
  const allowedHosts = splitList(env.WEBHOOK_EGRESS_ALLOWED_HOSTS).map((host) => host.toLowerCase());

  const rawPorts = splitList(env.WEBHOOK_EGRESS_ALLOWED_PORTS);
  const allowedPorts = (rawPorts.length > 0 ? rawPorts : [String(HTTPS_DEFAULT_PORT)]).map((raw) => {
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`WEBHOOK_EGRESS_ALLOWED_PORTS contains an invalid port: "${raw}"`);
    }
    return port;
  });

  for (const host of allowedHosts) {
    if (!isValidAllowedHost(host)) {
      throw new Error(`WEBHOOK_EGRESS_ALLOWED_HOSTS contains an invalid entry: "${host}"`);
    }
  }

  return { allowedHosts, allowedPorts };
}

/** Parses and checks a URL without touching the network. Returns the parsed URL. */
export function assertEgressUrl(rawUrl: string, policy: EgressPolicy): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new EgressDeniedError('malformed_url', 'URL could not be parsed');
  }

  if (url.protocol !== 'https:') {
    throw new EgressDeniedError('scheme_not_allowed', `scheme ${url.protocol} is not https`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new EgressDeniedError('credentials_in_url', 'URL must not contain userinfo');
  }

  const port = url.port === '' ? HTTPS_DEFAULT_PORT : Number(url.port);
  if (!policy.allowedPorts.includes(port)) {
    throw new EgressDeniedError('port_not_allowed', `port ${port} is not in the allow-list`);
  }

  const hostname = normalizeHostname(url.hostname);
  if (isPrivateHostname(hostname)) {
    throw new EgressDeniedError('private_address', `host ${hostname} is a loopback, private or reserved address`);
  }
  if (!matchesAllowedHost(hostname, policy.allowedHosts)) {
    throw new EgressDeniedError('host_not_allowed', `host ${hostname} is not in the allow-list`);
  }

  return url;
}

/**
 * Full check: URL rules plus DNS. Every address the hostname resolves to must
 * be public. Literal IPs skip DNS because their address is already checked.
 */
export async function assertEgressAllowed(
  rawUrl: string,
  policy: EgressPolicy,
  resolveHost: HostResolver = defaultResolver,
): Promise<URL> {
  const url = assertEgressUrl(rawUrl, policy);
  const hostname = normalizeHostname(url.hostname);

  if (isIpLiteral(hostname)) return url;

  // A resolution failure is transient (or the name is not yet published), so it
  // is a plain Error: the delivery retries instead of dead-lettering.
  let addresses: readonly string[];
  try {
    addresses = await resolveHost(hostname);
  } catch {
    throw new Error(`webhook host ${hostname} could not be resolved`);
  }
  if (addresses.length === 0) {
    throw new Error(`webhook host ${hostname} could not be resolved`);
  }
  for (const address of addresses) {
    if (isPrivateHostname(normalizeHostname(address))) {
      throw new EgressDeniedError(
        'private_address',
        `host ${hostname} resolves to a loopback, private or reserved address`,
      );
    }
  }

  return url;
}

/** Records a permanent denial. Keeps the destination out of logs by logging only the reason. */
export function logEgressDenial(
  err: EgressDeniedError,
  context: { endpointId?: string; merchantId?: string },
): void {
  logger.warn('webhook egress denied', {
    reason: err.reason,
    endpointId: context.endpointId,
    merchantId: context.merchantId,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function isValidAllowedHost(entry: string): boolean {
  const body = entry.startsWith('*.') ? entry.slice(2) : entry;
  if (body.length === 0 || body.length > 253) return false;
  return body.split('.').every((label) => HOST_LABEL.test(label));
}

function normalizeHostname(hostname: string): string {
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

function matchesAllowedHost(hostname: string, allowedHosts: readonly string[]): boolean {
  return allowedHosts.some((entry) => {
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1); // ".partner.io"
      return hostname.endsWith(suffix) && hostname.length > suffix.length;
    }
    return hostname === entry;
  });
}

function isIpLiteral(hostname: string): boolean {
  return parseIPv4(hostname) !== null || hostname.includes(':');
}

/** True for loopback, private, link-local, CGNAT, multicast, unspecified, and `localhost` names. */
export function isPrivateHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  const v4 = parseIPv4(host);
  if (v4) return isPrivateIPv4(v4);

  if (host.includes(':')) {
    const groups = parseIPv6(host);
    // An unparseable IPv6 literal is treated as unsafe.
    if (!groups) return true;
    return isPrivateIPv6(groups);
  }

  return false;
}

function parseIPv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
  return octets as [number, number, number, number];
}

function isPrivateIPv4([a, b]: [number, number, number, number]): boolean {
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, includes cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a >= 224) return true; // multicast and reserved
  return false;
}

/** Expands an IPv6 literal (without brackets) into eight 16-bit groups, or null if malformed. */
function parseIPv6(host: string): number[] | null {
  let address = host;
  // Trailing dotted IPv4 (e.g. ::ffff:1.2.3.4) becomes two hex groups.
  const dotted = address.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) {
    const v4 = parseIPv4(dotted[1]);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    address = address.slice(0, -dotted[1].length) + `${hi}:${lo}`;
  }

  const halves = address.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : halves[0].split(':');
  const tail = halves.length === 2 && halves[1] !== '' ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : head.length !== 8) return null;

  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const values = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  if (values.length !== 8 || values.some((v) => Number.isNaN(v))) return null;
  return values;
}

function isPrivateIPv6(g: number[]): boolean {
  const allZeroBefore = g.slice(0, 5).every((v) => v === 0);
  if (g.every((v) => v === 0)) return true; // ::
  if (g.slice(0, 7).every((v) => v === 0) && g[7] === 1) return true; // ::1
  if (allZeroBefore && g[5] === 0xffff) {
    // IPv4-mapped (::ffff:a.b.c.d) — judge by the embedded IPv4 address.
    return isPrivateIPv4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]);
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

async function defaultResolver(hostname: string): Promise<string[]> {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}
