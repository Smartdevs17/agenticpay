"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditRouter = void 0;
var express_1 = require("express");
var errorHandler_js_1 = require("../middleware/errorHandler.js");
var auditService_js_1 = require("../services/auditService.js");
exports.auditRouter = (0, express_1.Router)();
exports.auditRouter.post('/log', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, userId, action, resource, resourceId, details, beforeState, afterState, ipAddress, userAgent, request, response, entry;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = req.body, userId = _a.userId, action = _a.action, resource = _a.resource, resourceId = _a.resourceId, details = _a.details, beforeState = _a.beforeState, afterState = _a.afterState, ipAddress = _a.ipAddress, userAgent = _a.userAgent, request = _a.request, response = _a.response;
                if (!action || !resource) {
                    res.status(400).json({ error: 'Action and resource are required' });
                    return [2 /*return*/];
                }
                return [4 /*yield*/, auditService_js_1.auditService.logAction({
                        userId: userId,
                        action: action,
                        resource: resource,
                        resourceId: resourceId,
                        details: details,
                        beforeState: beforeState,
                        afterState: afterState,
                        ipAddress: ipAddress || req.ip,
                        userAgent: userAgent || req.headers['user-agent'],
                        request: request,
                        response: response,
                    })];
            case 1:
                entry = _b.sent();
                res.status(201).json(entry);
                return [2 /*return*/];
        }
    });
}); }));
exports.auditRouter.get('/entries', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, userId, action, resource, startDate, endDate, suspicious, limit, offset, result;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = req.query, userId = _a.userId, action = _a.action, resource = _a.resource, startDate = _a.startDate, endDate = _a.endDate, suspicious = _a.suspicious, limit = _a.limit, offset = _a.offset;
                return [4 /*yield*/, auditService_js_1.auditService.queryEntries({
                        userId: userId,
                        action: action,
                        resource: resource,
                        startDate: startDate ? Number(startDate) : undefined,
                        endDate: endDate ? Number(endDate) : undefined,
                        suspicious: suspicious === 'true' ? true : suspicious === 'false' ? false : undefined,
                        limit: limit ? Number(limit) : 50,
                        offset: offset ? Number(offset) : 0,
                    })];
            case 1:
                result = _b.sent();
                res.status(200).json(result);
                return [2 /*return*/];
        }
    });
}); }));
exports.auditRouter.get('/entries/:id', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var id, entry;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                id = req.params.id;
                return [4 /*yield*/, auditService_js_1.auditService.getEntry(id)];
            case 1:
                entry = _a.sent();
                if (!entry) {
                    res.status(404).json({ error: 'Entry not found' });
                    return [2 /*return*/];
                }
                res.status(200).json(entry);
                return [2 /*return*/];
        }
    });
}); }));
exports.auditRouter.get('/verify', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var result;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, auditService_js_1.auditService.verifyIntegrity()];
            case 1:
                result = _a.sent();
                res.status(200).json(result);
                return [2 /*return*/];
        }
    });
}); }));
exports.auditRouter.post('/flag/:id', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var id, reasons, entry;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                id = req.params.id;
                reasons = req.body.reasons;
                if (!reasons || !Array.isArray(reasons)) {
                    res.status(400).json({ error: 'Reasons array is required' });
                    return [2 /*return*/];
                }
                return [4 /*yield*/, auditService_js_1.auditService.flagSuspicious(id, reasons)];
            case 1:
                entry = _a.sent();
                if (!entry) {
                    res.status(404).json({ error: 'Entry not found' });
                    return [2 /*return*/];
                }
                res.status(200).json(entry);
                return [2 /*return*/];
        }
    });
}); }));
exports.auditRouter.get('/export/csv', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var csv;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, auditService_js_1.auditService.exportToCSV()];
            case 1:
                csv = _a.sent();
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', "attachment; filename=\"audit-log-".concat(Date.now(), ".csv\""));
                res.status(200).send(csv);
                return [2 /*return*/];
        }
    });
}); }));
exports.auditRouter.get('/export/json', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var json;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, auditService_js_1.auditService.exportToJSON()];
            case 1:
                json = _a.sent();
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', "attachment; filename=\"audit-log-".concat(Date.now(), ".json\""));
                res.status(200).send(json);
                return [2 /*return*/];
        }
    });
}); }));
exports.auditRouter.get('/stats', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var stats;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, auditService_js_1.auditService.getRetentionStats()];
            case 1:
                stats = _a.sent();
                res.status(200).json(stats);
                return [2 /*return*/];
        }
    });
}); }));
exports.auditRouter.get('/count', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var count;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, auditService_js_1.auditService.getEntryCount()];
            case 1:
                count = _a.sent();
                res.status(200).json({ count: count });
                return [2 /*return*/];
        }
    });
}); }));
exports.auditRouter.get('/retention', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var stats;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, auditService_js_1.auditService.getRetentionStats()];
            case 1:
                stats = _a.sent();
                res.status(200).json({ policy: {
                        retentionDays: 2555,
                        archiveAfterDays: 2190,
                        deleteAfterDays: 3650,
                    }, stats: stats });
                return [2 /*return*/];
        }
    });
}); }));
exports.auditRouter.delete('/clear', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var deleted;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                if (req.query.confirm !== 'true') {
                    res.status(400).json({ error: 'Add ?confirm=true to confirm deletion of old entries' });
                    return [2 /*return*/];
                }
                return [4 /*yield*/, auditService_js_1.auditService.clearOldEntries()];
            case 1:
                deleted = _a.sent();
                res.status(200).json({ deleted: deleted, message: 'Old entries cleared' });
                return [2 /*return*/];
        }
    });
}); }));
