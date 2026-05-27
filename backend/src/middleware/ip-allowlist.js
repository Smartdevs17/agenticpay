"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.initIpAllowlist = initIpAllowlist;
exports.addBypassCode = addBypassCode;
exports.removeBypassCode = removeBypassCode;
exports.ipAllowlistMiddleware = ipAllowlistMiddleware;
exports.adminIpAllowlistMiddleware = adminIpAllowlistMiddleware;
exports.apiIpAllowlistMiddleware = apiIpAllowlistMiddleware;
exports.config = {
    enabled: false,
    allowedIps: [],
    bypassCodes: new Map(),
};
function initIpAllowlist(allowedIps, enabled) {
    if (enabled === void 0) { enabled = false; }
    exports.config.enabled = enabled;
    exports.config.allowedIps = allowedIps;
}
function addBypassCode(code, expiresInMs) {
    exports.config.bypassCodes.set(code, { expiresAt: Date.now() + expiresInMs });
}
function removeBypassCode(code) {
    exports.config.bypassCodes.delete(code);
}
function parseIpCidr(cidr) {
    if (!cidr.includes('/')) {
        return { ip: cidr.trim(), mask: null };
    }
    var parts = cidr.split('/');
    var ip = parts[0].trim();
    var mask = parseInt(parts[1], 10);
    if (isNaN(mask) || mask < 0 || mask > 32) {
        return null;
    }
    return { ip: ip, mask: mask };
}
function ipToNumber(ip) {
    var parts = ip.split('.');
    if (parts.length !== 4) {
        return null;
    }
    var result = 0;
    for (var i = 0; i < 4; i++) {
        var num = parseInt(parts[i], 10);
        if (isNaN(num) || num < 0 || num > 255) {
            return null;
        }
        result = (result << 8) | num;
    }
    return result;
}
function numberToIp(num) {
    return [
        (num >>> 24) & 255,
        (num >>> 16) & 255,
        (num >>> 8) & 255,
        num & 255,
    ].join('.');
}
function isIpInCidr(ip, cidr) {
    var range = parseIpCidr(cidr);
    if (!range) {
        return false;
    }
    var ipNum = ipToNumber(ip);
    if (ipNum === null) {
        return false;
    }
    if (range.mask === null) {
        return ip === range.ip;
    }
    var rangeNum = ipToNumber(range.ip);
    if (rangeNum === null) {
        return false;
    }
    var mask = ~((1 << (32 - range.mask)) - 1);
    return (ipNum & mask) === (rangeNum & mask);
}
function isIpAllowed(ip) {
    for (var _i = 0, _a = exports.config.allowedIps; _i < _a.length; _i++) {
        var allowedCidr = _a[_i];
        if (isIpInCidr(ip, allowedCidr)) {
            return true;
        }
    }
    return false;
}
function isBypassValid(code) {
    var bypass = exports.config.bypassCodes.get(code);
    if (!bypass) {
        return false;
    }
    if (Date.now() > bypass.expiresAt) {
        exports.config.bypassCodes.delete(code);
        return false;
    }
    return true;
}
function getClientIp(req) {
    var _a;
    var forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
        var ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0];
        return ips.trim();
    }
    var realIp = req.headers['x-real-ip'];
    if (realIp) {
        return Array.isArray(realIp) ? realIp[0] : realIp;
    }
    return ((_a = req.ip) === null || _a === void 0 ? void 0 : _a.replace(/^::ffff:/, '')) || req.socket.remoteAddress;
}
function ipAllowlistMiddleware(allowedIps, enableBypass) {
    if (enableBypass === void 0) { enableBypass = false; }
    var ips = allowedIps || exports.config.allowedIps;
    return function (req, res, next) {
        if (ips.length === 0) {
            return next();
        }
        var bypassCode = req.headers['x-bypass-code'];
        if (enableBypass && bypassCode && isBypassValid(bypassCode)) {
            return next();
        }
        var clientIp = getClientIp(req);
        if (!clientIp) {
            console.warn("[IP Allowlist] No client IP found for ".concat(req.method, " ").concat(req.originalUrl));
            return res.status(403).json({
                error: {
                    code: 'IP_DENIED',
                    message: 'Access denied: Unable to determine client IP',
                    status: 403,
                },
            });
        }
        if (!isIpAllowed(clientIp)) {
            console.warn("[IP Allowlist] Denied access from ".concat(clientIp, " to ").concat(req.method, " ").concat(req.originalUrl));
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
function adminIpAllowlistMiddleware() {
    return ipAllowlistMiddleware();
}
function apiIpAllowlistMiddleware() {
    return ipAllowlistMiddleware();
}
