import { Request, Response, NextFunction, RequestHandler } from 'express';

export interface IpAllowlistConfig {
  enabled: boolean;
  allowedIps: string[];
  bypassCodes: Map<string, { expiresAt: number }>;
}

export const config: IpAllowlistConfig = {
  enabled: false,
  allowedIps: [],
  bypassCodes: new Map(),
};

export function initIpAllowlist(allowedIps: string[], enabled = false): void {
  config.enabled = enabled;
  config.allowedIps = allowedIps;
}

export function addBypassCode(code: string, expiresInMs: number): void {
  config.bypassCodes.set(code, { expiresAt: Date.now() + expiresInMs });
}

export function removeBypassCode(code: string): void {
  config.bypassCodes.delete(code);
}

interface IpRange {
  ip: string;
  mask: number | null;
}

function parseIpCidr(cidr: string): IpRange | null {
  if (!cidr.includes('/')) {
    return { ip: cidr.trim(), mask: null };
  }

  const parts = cidr.split('/');
  const ip = parts[0].trim();
  const mask = parseInt(parts[1], 10);

  if (isNaN(mask) || mask < 0 || mask > 32) {
    return null;
  }

  return { ip, mask };
}

function ipToNumber(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }

  let result = 0;
  for (let i = 0; i < 4; i++) {
    const num = parseInt(parts[i], 10);
    if (isNaN(num) || num < 0 || num > 255) {
      return null;
    }
    result = (result << 8) | num;
  }

  return result;
}

function numberToIp(num: number): string {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255,
  ].join('.');
}

function isIpInCidr(ip: string, cidr: string): boolean {
  const range = parseIpCidr(cidr);
  if (!range) {
    return false;
  }

  const ipNum = ipToNumber(ip);
  if (ipNum === null) {
    return false;
  }

  if (range.mask === null) {
    return ip === range.ip;
  }

  const rangeNum = ipToNumber(range.ip);
  if (rangeNum === null) {
    return false;
  }

  const mask = ~((1 << (32 - range.mask)) - 1);
  return (ipNum & mask) === (rangeNum & mask);
}

function isIpAllowed(ip: string): boolean {
  for (const allowedCidr of config.allowedIps) {
    if (isIpInCidr(ip, allowedCidr)) {
      return true;
    }
  }
  return false;
}

function isBypassValid(code: string): boolean {
  const bypass = config.bypassCodes.get(code);
  if (!bypass) {
    return false;
  }
  if (Date.now() > bypass.expiresAt) {
    config.bypassCodes.delete(code);
    return false;
  }
  return true;
}

function getClientIp(req: Request): string | undefined {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0];
    return ips.trim();
  }
  
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }
  
  return req.ip?.replace(/^::ffff:/, '') || req.socket.remoteAddress;
}

export function ipAllowlistMiddleware(allowedIps?: string[], enableBypass = false): RequestHandler {
  const ips = allowedIps || config.allowedIps;

  return (req: Request, res: Response, next: NextFunction) => {
    if (ips.length === 0) {
      return next();
    }

    const bypassCode = req.headers['x-bypass-code'] as string | undefined;
    if (enableBypass && bypassCode && isBypassValid(bypassCode)) {
      return next();
    }

    const clientIp = getClientIp(req);
    if (!clientIp) {
      console.warn(`[IP Allowlist] No client IP found for ${req.method} ${req.originalUrl}`);
      return res.status(403).json({
        error: {
          code: 'IP_DENIED',
          message: 'Access denied: Unable to determine client IP',
          status: 403,
        },
      });
    }

    if (!isIpAllowed(clientIp)) {
      console.warn(`[IP Allowlist] Denied access from ${clientIp} to ${req.method} ${req.originalUrl}`);
      return res.status(403).json({
        error: {
          code: 'IP_DENIED',
          message: 'Access denied: Your IP is not in the allowed list',
          status: 403,
        },
      });
    }

    next();
  };
}

export function adminIpAllowlistMiddleware(): RequestHandler {
  return ipAllowlistMiddleware();
}

export function apiIpAllowlistMiddleware(): RequestHandler {
  return ipAllowlistMiddleware();
}