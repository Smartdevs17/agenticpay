"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditService = exports.AuditService = void 0;
var node_crypto_1 = require("node:crypto");
var node_crypto_2 = require("node:crypto");
var AuditService = /** @class */ (function () {
    function AuditService(policy) {
        this.entries = [];
        this.currentHash = '0000000000000000000000000000000000000000000000000000000000000000';
        this.retentionPolicy = {
            retentionDays: 2555,
            archiveAfterDays: 2190,
            deleteAfterDays: 3650,
        };
        if (policy) {
            this.retentionPolicy = __assign(__assign({}, this.retentionPolicy), policy);
        }
    }
    AuditService.prototype.computeHash = function (data) {
        return (0, node_crypto_1.createHash)('sha256').update(data).digest('hex');
    };
    AuditService.prototype.generateEntryHash = function (entry) {
        var data = [
            entry.id,
            entry.timestamp,
            entry.userId || '',
            entry.action,
            entry.resource,
            entry.resourceId || '',
            JSON.stringify(entry.details || {}),
            JSON.stringify(entry.beforeState || {}),
            JSON.stringify(entry.afterState || {}),
            entry.ipAddress || '',
            entry.requestMethod || '',
            entry.requestPath || '',
            entry.previousHash,
        ].join('|');
        return this.computeHash(data);
    };
    AuditService.prototype.logAction = function (params) {
        return __awaiter(this, void 0, void 0, function () {
            var id, timestamp, entry, hash, fullEntry;
            var _a, _b, _c, _d;
            return __generator(this, function (_e) {
                id = (0, node_crypto_2.randomUUID)();
                timestamp = Date.now();
                entry = {
                    id: id,
                    timestamp: timestamp,
                    userId: params.userId,
                    action: params.action,
                    resource: params.resource,
                    resourceId: params.resourceId,
                    details: params.details,
                    beforeState: params.beforeState,
                    afterState: params.afterState,
                    ipAddress: params.ipAddress,
                    userAgent: params.userAgent,
                    requestMethod: (_a = params.request) === null || _a === void 0 ? void 0 : _a.method,
                    requestPath: (_b = params.request) === null || _b === void 0 ? void 0 : _b.path,
                    requestBody: this.sanitizeRequestBody((_c = params.request) === null || _c === void 0 ? void 0 : _c.body),
                    responseStatus: (_d = params.response) === null || _d === void 0 ? void 0 : _d.status,
                    previousHash: this.currentHash,
                };
                hash = this.generateEntryHash(entry);
                fullEntry = __assign(__assign({}, entry), { hash: hash });
                this.entries.push(fullEntry);
                this.currentHash = hash;
                return [2 /*return*/, fullEntry];
            });
        });
    };
    AuditService.prototype.sanitizeRequestBody = function (body) {
        if (!body)
            return undefined;
        if (typeof body !== 'object')
            return body;
        var sanitized = __assign({}, body);
        var sensitiveFields = ['password', 'token', 'apiKey', 'secret', 'creditCard', 'ssn'];
        for (var _i = 0, sensitiveFields_1 = sensitiveFields; _i < sensitiveFields_1.length; _i++) {
            var field = sensitiveFields_1[_i];
            if (field in sanitized) {
                sanitized[field] = '[REDACTED]';
            }
        }
        return sanitized;
    };
    AuditService.prototype.queryEntries = function (query) {
        return __awaiter(this, void 0, void 0, function () {
            var filtered, total, offset, limit;
            return __generator(this, function (_a) {
                filtered = this.entries.filter(function (entry) {
                    if (query.userId && entry.userId !== query.userId)
                        return false;
                    if (query.action && entry.action !== query.action)
                        return false;
                    if (query.resource && entry.resource !== query.resource)
                        return false;
                    if (query.suspicious !== undefined && entry.suspicious !== query.suspicious)
                        return false;
                    if (query.startDate && entry.timestamp < query.startDate)
                        return false;
                    if (query.endDate && entry.timestamp > query.endDate)
                        return false;
                    return true;
                });
                total = filtered.length;
                offset = query.offset || 0;
                limit = query.limit || 50;
                filtered = filtered.sort(function (a, b) { return b.timestamp - a.timestamp; });
                filtered = filtered.slice(offset, offset + limit);
                return [2 /*return*/, { entries: filtered, total: total }];
            });
        });
    };
    AuditService.prototype.getEntry = function (id) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.entries.find(function (entry) { return entry.id === id; })];
            });
        });
    };
    AuditService.prototype.verifyIntegrity = function () {
        return __awaiter(this, void 0, void 0, function () {
            var expectedHash, _i, _a, entry, computedHash;
            var _b;
            return __generator(this, function (_c) {
                expectedHash = '0000000000000000000000000000000000000000000000000000000000000000';
                for (_i = 0, _a = this.entries; _i < _a.length; _i++) {
                    entry = _a[_i];
                    if (entry.previousHash !== expectedHash) {
                        return [2 /*return*/, { valid: false, brokenAt: entry.id }];
                    }
                    computedHash = this.generateEntryHash(entry);
                    if (computedHash !== entry.hash) {
                        return [2 /*return*/, { valid: false, brokenAt: entry.id }];
                    }
                    expectedHash = entry.hash;
                }
                if (this.currentHash !== expectedHash) {
                    return [2 /*return*/, { valid: false, brokenAt: (_b = this.entries[this.entries.length - 1]) === null || _b === void 0 ? void 0 : _b.id }];
                }
                return [2 /*return*/, { valid: true }];
            });
        });
    };
    AuditService.prototype.flagSuspicious = function (entryId, reasons) {
        return __awaiter(this, void 0, void 0, function () {
            var entry;
            return __generator(this, function (_a) {
                entry = this.entries.find(function (e) { return e.id === entryId; });
                if (entry) {
                    entry.suspicious = true;
                    entry.flags = reasons;
                }
                return [2 /*return*/, entry];
            });
        });
    };
    AuditService.prototype.exportToCSV = function () {
        return __awaiter(this, void 0, void 0, function () {
            var headers, rows;
            return __generator(this, function (_a) {
                headers = [
                    'ID', 'Timestamp', 'User ID', 'Action', 'Resource', 'Resource ID',
                    'IP Address', 'Request Method', 'Request Path', 'Response Status',
                    'Previous Hash', 'Hash', 'Suspicious', 'Flags'
                ].join(',');
                rows = this.entries.map(function (entry) { return [
                    entry.id,
                    new Date(entry.timestamp).toISOString(),
                    entry.userId || '',
                    entry.action,
                    entry.resource,
                    entry.resourceId || '',
                    entry.ipAddress || '',
                    entry.requestMethod || '',
                    entry.requestPath || '',
                    entry.responseStatus || '',
                    entry.previousHash,
                    entry.hash,
                    entry.suspicious ? 'YES' : 'NO',
                    (entry.flags || []).join(';'),
                ].map(function (v) { return "\"".concat(String(v).replace(/"/g, '""'), "\""); }).join(','); });
                return [2 /*return*/, __spreadArray([headers], rows, true).join('\n')];
            });
        });
    };
    AuditService.prototype.exportToJSON = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, _b;
            var _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        _b = (_a = JSON).stringify;
                        _c = {
                            exportedAt: Date.now(),
                            entryCount: this.entries.length,
                            retentionPolicy: this.retentionPolicy
                        };
                        return [4 /*yield*/, this.verifyIntegrity()];
                    case 1: return [2 /*return*/, _b.apply(_a, [(_c.integrity = _d.sent(),
                                _c.entries = this.entries,
                                _c), null, 2])];
                }
            });
        });
    };
    AuditService.prototype.setRetentionPolicy = function (policy) {
        this.retentionPolicy = __assign(__assign({}, this.retentionPolicy), policy);
    };
    AuditService.prototype.getRetentionStats = function () {
        return __awaiter(this, void 0, void 0, function () {
            var byResource, suspiciousCount, _i, _a, entry, timestamps;
            return __generator(this, function (_b) {
                byResource = {};
                suspiciousCount = 0;
                for (_i = 0, _a = this.entries; _i < _a.length; _i++) {
                    entry = _a[_i];
                    byResource[entry.resource] = (byResource[entry.resource] || 0) + 1;
                    if (entry.suspicious)
                        suspiciousCount++;
                }
                timestamps = this.entries.map(function (e) { return e.timestamp; });
                timestamps.sort(function (a, b) { return a - b; });
                return [2 /*return*/, {
                        totalEntries: this.entries.length,
                        byResource: byResource,
                        suspiciousCount: suspiciousCount,
                        dateRange: {
                            oldest: timestamps[0] || 0,
                            newest: timestamps[timestamps.length - 1] || 0,
                        },
                    }];
            });
        });
    };
    AuditService.prototype.getEntryCount = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.entries.length];
            });
        });
    };
    AuditService.prototype.clearOldEntries = function () {
        return __awaiter(this, void 0, void 0, function () {
            var cutoff, toDelete;
            return __generator(this, function (_a) {
                cutoff = Date.now() - (this.retentionPolicy.deleteAfterDays * 24 * 60 * 60 * 1000);
                toDelete = this.entries.filter(function (e) { return e.timestamp < cutoff; });
                this.entries = this.entries.filter(function (e) { return e.timestamp >= cutoff; });
                return [2 /*return*/, toDelete.length];
            });
        });
    };
    return AuditService;
}());
exports.AuditService = AuditService;
exports.auditService = new AuditService();
