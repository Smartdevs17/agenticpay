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
exports.verificationRouter = void 0;
var express_1 = require("express");
var verification_js_1 = require("../services/verification.js");
var idempotency_js_1 = require("../middleware/idempotency.js");
var validate_js_1 = require("../middleware/validate.js");
var errorHandler_js_1 = require("../middleware/errorHandler.js");
var index_js_1 = require("../schemas/index.js");
var cache_js_1 = require("../middleware/cache.js");
exports.verificationRouter = (0, express_1.Router)();
// AI-powered work verification
exports.verificationRouter.post('/verify', (0, idempotency_js_1.idempotency)(), (0, validate_js_1.validate)(index_js_1.verificationSchema), (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, repositoryUrl, milestoneDescription, projectId, result;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = req.body, repositoryUrl = _a.repositoryUrl, milestoneDescription = _a.milestoneDescription, projectId = _a.projectId;
                if (!repositoryUrl || !milestoneDescription || !projectId) {
                    throw new errorHandler_js_1.AppError(400, 'Missing required fields', 'VALIDATION_ERROR');
                }
                return [4 /*yield*/, (0, verification_js_1.verifyWork)({ repositoryUrl: repositoryUrl, milestoneDescription: milestoneDescription, projectId: projectId })];
            case 1:
                result = _b.sent();
                res.json(result);
                return [2 /*return*/];
        }
    });
}); }));
// Bulk AI-powered work verification
exports.verificationRouter.post('/verify/batch', (0, idempotency_js_1.idempotency)(), (0, validate_js_1.validate)(index_js_1.bulkVerificationSchema), (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var items, results;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                items = req.body.items;
                if (!Array.isArray(items) || items.length === 0) {
                    throw new errorHandler_js_1.AppError(400, 'Missing items for bulk verification', 'VALIDATION_ERROR');
                }
                return [4 /*yield*/, Promise.all(items.map(function (item, index) { return __awaiter(void 0, void 0, void 0, function () {
                        var data, error_1, message;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    if (!(item === null || item === void 0 ? void 0 : item.repositoryUrl) || !(item === null || item === void 0 ? void 0 : item.milestoneDescription) || !(item === null || item === void 0 ? void 0 : item.projectId)) {
                                        return [2 /*return*/, { index: index, status: 'error', error: 'Missing required fields' }];
                                    }
                                    _a.label = 1;
                                case 1:
                                    _a.trys.push([1, 3, , 4]);
                                    return [4 /*yield*/, (0, verification_js_1.verifyWork)({
                                            repositoryUrl: item.repositoryUrl,
                                            milestoneDescription: item.milestoneDescription,
                                            projectId: item.projectId,
                                        })];
                                case 2:
                                    data = _a.sent();
                                    return [2 /*return*/, { index: index, status: 'success', data: data }];
                                case 3:
                                    error_1 = _a.sent();
                                    message = error_1 instanceof Error ? error_1.message : 'Verification failed';
                                    return [2 /*return*/, { index: index, status: 'error', error: message }];
                                case 4: return [2 /*return*/];
                            }
                        });
                    }); }))];
            case 1:
                results = _a.sent();
                res.json({ results: results });
                return [2 /*return*/];
        }
    });
}); }));
// Bulk update verification results
exports.verificationRouter.patch('/batch', (0, validate_js_1.validate)(index_js_1.bulkUpdateSchema), (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var items, results, updatedCount;
    return __generator(this, function (_a) {
        items = req.body.items;
        if (!Array.isArray(items) || items.length === 0) {
            throw new errorHandler_js_1.AppError(400, 'Missing items for bulk update', 'VALIDATION_ERROR');
        }
        results = items.map(function (item, index) {
            if (!(item === null || item === void 0 ? void 0 : item.id)) {
                return { index: index, status: 'error', error: 'Missing verification id' };
            }
            var hasUpdates = item.status !== undefined ||
                item.score !== undefined ||
                item.summary !== undefined ||
                item.details !== undefined;
            if (!hasUpdates) {
                return { index: index, status: 'error', error: 'No update fields provided' };
            }
            var updated = (0, verification_js_1.updateVerification)({
                id: item.id,
                status: item.status,
                score: item.score,
                summary: item.summary,
                details: item.details,
            });
            if (!updated) {
                return { index: index, status: 'error', error: 'Verification not found' };
            }
            return { index: index, status: 'success', data: updated };
        });
        updatedCount = results.filter(function (result) { return result.status === 'success'; }).length;
        res.json({ results: results, updatedCount: updatedCount });
        return [2 /*return*/];
    });
}); }));
// Bulk delete verification results
exports.verificationRouter.delete('/batch', (0, validate_js_1.validate)(index_js_1.bulkDeleteSchema), (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var ids, results, deletedCount;
    return __generator(this, function (_a) {
        ids = req.body.ids;
        if (!Array.isArray(ids) || ids.length === 0) {
            throw new errorHandler_js_1.AppError(400, 'Missing ids for bulk delete', 'VALIDATION_ERROR');
        }
        results = ids.map(function (id) {
            if (!id) {
                return { id: id, status: 'error', error: 'Missing verification id' };
            }
            var deleted = (0, verification_js_1.deleteVerification)(id);
            return deleted ? { id: id, status: 'deleted' } : { id: id, status: 'not_found' };
        });
        deletedCount = results.filter(function (result) { return result.status === 'deleted'; }).length;
        res.json({ results: results, deletedCount: deletedCount });
        return [2 /*return*/];
    });
}); }));
// Get verification result by ID — cache for 30 s (result may still be updated)
exports.verificationRouter.get('/:id', (0, cache_js_1.cacheControl)({ maxAge: cache_js_1.CacheTTL.SHORT }), (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var id, result;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
                return [4 /*yield*/, (0, verification_js_1.getVerification)(id)];
            case 1:
                result = _a.sent();
                if (!result) {
                    throw new errorHandler_js_1.AppError(404, 'Verification not found', 'NOT_FOUND');
                }
                res.json(result);
                return [2 /*return*/];
        }
    });
}); }));
