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
var express_1 = require("express");
var zod_1 = require("zod");
var allowances_js_1 = require("../../services/allowances.js");
var router = (0, express_1.Router)();
var fetchQuerySchema = zod_1.z.object({
    owner: zod_1.z.string(),
    tokens: zod_1.z.string().optional(),
    spenders: zod_1.z.string().optional(),
});
var approvalBodySchema = zod_1.z.object({
    token: zod_1.z.string(),
    spender: zod_1.z.string(),
    amount: zod_1.z.string(),
    unlimited: zod_1.z.boolean().optional(),
    expiresAt: zod_1.z.number().optional(),
});
var revokeBodySchema = zod_1.z.object({
    token: zod_1.z.string(),
    spender: zod_1.z.string(),
});
var batchRevokeBodySchema = zod_1.z.array(zod_1.z.object({
    token: zod_1.z.string(),
    spender: zod_1.z.string(),
}));
router.get('/', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, owner, tokens, spenders, tokensList, spendersList, allowances, error_1, message;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 2, , 3]);
                _a = fetchQuerySchema.parse(req.query), owner = _a.owner, tokens = _a.tokens, spenders = _a.spenders;
                tokensList = tokens ? tokens.split(',') : undefined;
                spendersList = spenders ? spenders.split(',') : undefined;
                return [4 /*yield*/, (0, allowances_js_1.fetchAllowances)(owner, tokensList, spendersList)];
            case 1:
                allowances = _b.sent();
                res.json({ success: true, data: allowances });
                return [3 /*break*/, 3];
            case 2:
                error_1 = _b.sent();
                message = error_1 instanceof Error ? error_1.message : 'Failed to fetch allowances';
                res.status(400).json({ success: false, error: message });
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); });
router.post('/approve', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var body, result, error_2, message;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                body = approvalBodySchema.parse(req.body);
                return [4 /*yield*/, (0, allowances_js_1.approveToken)(body.token, body.spender, body.amount, body.unlimited, body.expiresAt)];
            case 1:
                result = _a.sent();
                if (result.success) {
                    res.json({ success: true, txHash: result.txHash });
                }
                else {
                    res.status(400).json({ success: false, error: result.error });
                }
                return [3 /*break*/, 3];
            case 2:
                error_2 = _a.sent();
                message = error_2 instanceof Error ? error_2.message : 'Approval failed';
                res.status(400).json({ success: false, error: message });
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); });
router.post('/revoke', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var body, result, error_3, message;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                body = revokeBodySchema.parse(req.body);
                return [4 /*yield*/, (0, allowances_js_1.revokeAllowance)(body.token, body.spender)];
            case 1:
                result = _a.sent();
                if (result.success) {
                    res.json({ success: true });
                }
                else {
                    res.status(400).json({ success: false, error: result.error });
                }
                return [3 /*break*/, 3];
            case 2:
                error_3 = _a.sent();
                message = error_3 instanceof Error ? error_3.message : 'Revocation failed';
                res.status(400).json({ success: false, error: message });
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); });
router.post('/batch-revoke', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var body, result, error_4, message;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                body = batchRevokeBodySchema.parse(req.body);
                return [4 /*yield*/, (0, allowances_js_1.batchRevoke)(body)];
            case 1:
                result = _a.sent();
                res.json(result);
                return [3 /*break*/, 3];
            case 2:
                error_4 = _a.sent();
                message = error_4 instanceof Error ? error_4.message : 'Batch revocation failed';
                res.status(400).json({ success: false, error: message });
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); });
router.get('/gas-estimate', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, token, spender, amount, unlimited, result, error_5, message;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 2, , 3]);
                _a = approvalBodySchema.parse(req.query), token = _a.token, spender = _a.spender, amount = _a.amount, unlimited = _a.unlimited;
                return [4 /*yield*/, (0, allowances_js_1.estimateGasForApproval)(token, spender, amount, unlimited)];
            case 1:
                result = _b.sent();
                res.json(result);
                return [3 /*break*/, 3];
            case 2:
                error_5 = _b.sent();
                message = error_5 instanceof Error ? error_5.message : 'Gas estimation failed';
                res.status(400).json({ success: false, error: message });
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); });
router.get('/recommended', function (req, res) {
    var _a = req.query, token = _a.token, spender = _a.spender, typicalUsage = _a.typicalUsage;
    if (!token || !spender || !typicalUsage) {
        return res.status(400).json({
            success: false,
            error: 'Missing required parameters: token, spender, typicalUsage',
        });
    }
    var recommended = (0, allowances_js_1.getRecommendedAllowance)(token, spender, typicalUsage);
    res.json({ success: true, recommended: recommended });
});
router.get('/logs', function (req, res) {
    var _a = req.query, token = _a.token, spender = _a.spender, limit = _a.limit;
    var logs = (0, allowances_js_1.getApprovalLogs)(token, spender, limit ? parseInt(limit) : 100);
    res.json({ success: true, logs: logs });
});
router.get('/stats', function (req, res) {
    var stats = (0, allowances_js_1.getAllowanceStats)();
    res.json({ success: true, stats: stats });
});
exports.default = router;
