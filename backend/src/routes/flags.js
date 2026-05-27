"use strict";
/**
 * flags.ts — Admin endpoints for inspecting and overriding feature flags.
 *
 * Routes (all under /api/v1/flags):
 *
 *   GET  /              — list all flags with current state and usage stats
 *   GET  /:name         — get a single flag
 *   PATCH /:name        — runtime override (enabled, rolloutPercentage, allowlist)
 *   POST  /:name/reset  — reset a flag to its default / env-var value
 */
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
exports.flagsRouter = void 0;
var express_1 = require("express");
var featureFlags_js_1 = require("../config/featureFlags.js");
var errorHandler_js_1 = require("../middleware/errorHandler.js");
exports.flagsRouter = (0, express_1.Router)();
// GET /api/v1/flags
exports.flagsRouter.get('/', (0, errorHandler_js_1.asyncHandler)(function (_req, res) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        res.json({
            flags: featureFlags_js_1.featureFlags.getAll().map(serializeFlag),
            total: featureFlags_js_1.featureFlags.getAll().length,
        });
        return [2 /*return*/];
    });
}); }));
// GET /api/v1/flags/:name
exports.flagsRouter.get('/:name', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var name, flag;
    return __generator(this, function (_a) {
        name = req.params.name;
        flag = featureFlags_js_1.featureFlags.get(name);
        if (!flag) {
            throw new errorHandler_js_1.AppError(404, "Feature flag '".concat(name, "' not found"), 'NOT_FOUND');
        }
        res.json(serializeFlag(flag));
        return [2 /*return*/];
    });
}); }));
// PATCH /api/v1/flags/:name
// Body: { enabled?: boolean, rolloutPercentage?: number, allowlist?: string[] }
exports.flagsRouter.patch('/:name', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var name, _a, enabled, rolloutPercentage, allowlist, hasUpdate, updated;
    return __generator(this, function (_b) {
        name = req.params.name;
        if (!featureFlags_js_1.featureFlags.get(name)) {
            throw new errorHandler_js_1.AppError(404, "Feature flag '".concat(name, "' not found"), 'NOT_FOUND');
        }
        _a = req.body, enabled = _a.enabled, rolloutPercentage = _a.rolloutPercentage, allowlist = _a.allowlist;
        hasUpdate = enabled !== undefined || rolloutPercentage !== undefined || allowlist !== undefined;
        if (!hasUpdate) {
            throw new errorHandler_js_1.AppError(400, 'Provide at least one of: enabled, rolloutPercentage, allowlist', 'VALIDATION_ERROR');
        }
        if (rolloutPercentage !== undefined && (rolloutPercentage < 0 || rolloutPercentage > 100)) {
            throw new errorHandler_js_1.AppError(400, 'rolloutPercentage must be between 0 and 100', 'VALIDATION_ERROR');
        }
        featureFlags_js_1.featureFlags.override(name, { enabled: enabled, rolloutPercentage: rolloutPercentage, allowlist: allowlist });
        updated = featureFlags_js_1.featureFlags.get(name);
        res.json(serializeFlag(updated));
        return [2 /*return*/];
    });
}); }));
// POST /api/v1/flags/:name/reset
exports.flagsRouter.post('/:name/reset', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var name, reset;
    return __generator(this, function (_a) {
        name = req.params.name;
        if (!featureFlags_js_1.featureFlags.get(name)) {
            throw new errorHandler_js_1.AppError(404, "Feature flag '".concat(name, "' not found"), 'NOT_FOUND');
        }
        featureFlags_js_1.featureFlags.reset(name);
        reset = featureFlags_js_1.featureFlags.get(name);
        res.json(serializeFlag(reset));
        return [2 /*return*/];
    });
}); }));
// ─── Serialiser ───────────────────────────────────────────────────────────────
function serializeFlag(flag) {
    if (!flag)
        return null;
    return {
        name: flag.definition.name,
        description: flag.definition.description,
        defaultEnabled: flag.definition.defaultEnabled,
        currentStrategy: flag.currentStrategy,
        rolloutPercentage: flag.currentRolloutPercentage,
        overridden: flag.overridden,
        usage: flag.usage,
    };
}
