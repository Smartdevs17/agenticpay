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
exports.splitsRouter = void 0;
var express_1 = require("express");
var validate_js_1 = require("../middleware/validate.js");
var errorHandler_js_1 = require("../middleware/errorHandler.js");
var index_js_1 = require("../schemas/index.js");
var splits_js_1 = require("../services/splits.js");
exports.splitsRouter = (0, express_1.Router)();
var firstParam = function (value) { var _a; return (Array.isArray(value) ? (_a = value[0]) !== null && _a !== void 0 ? _a : '' : value !== null && value !== void 0 ? value : ''); };
exports.splitsRouter.post('/', (0, validate_js_1.validate)(index_js_1.splitConfigSchema), (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var created;
    return __generator(this, function (_a) {
        created = (0, splits_js_1.createSplitConfig)(req.body);
        res.status(201).json(created);
        return [2 /*return*/];
    });
}); }));
exports.splitsRouter.get('/merchant/:merchantId', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var merchantId;
    return __generator(this, function (_a) {
        merchantId = firstParam(req.params.merchantId);
        if (!merchantId) {
            throw new errorHandler_js_1.AppError(400, 'Merchant id is required', 'VALIDATION_ERROR');
        }
        res.json({ items: (0, splits_js_1.listMerchantSplits)(merchantId) });
        return [2 /*return*/];
    });
}); }));
exports.splitsRouter.get('/:splitId', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var splitId, split;
    return __generator(this, function (_a) {
        splitId = firstParam(req.params.splitId);
        split = (0, splits_js_1.getSplitConfig)(splitId);
        if (!split) {
            throw new errorHandler_js_1.AppError(404, 'Split config not found', 'NOT_FOUND');
        }
        res.json(split);
        return [2 /*return*/];
    });
}); }));
exports.splitsRouter.patch('/:splitId', (0, validate_js_1.validate)(index_js_1.splitUpdateSchema), (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var splitId, updated;
    return __generator(this, function (_a) {
        splitId = firstParam(req.params.splitId);
        updated = (0, splits_js_1.updateSplitConfig)(splitId, req.body);
        res.json(updated);
        return [2 /*return*/];
    });
}); }));
exports.splitsRouter.post('/:splitId/execute', (0, validate_js_1.validate)(index_js_1.splitExecutionSchema), (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, paymentId, totalAmount, currency, splitId, result;
    return __generator(this, function (_b) {
        _a = req.body, paymentId = _a.paymentId, totalAmount = _a.totalAmount, currency = _a.currency;
        splitId = firstParam(req.params.splitId);
        result = (0, splits_js_1.executeSplitPayment)({
            splitId: splitId,
            paymentId: paymentId,
            totalAmount: totalAmount,
            currency: currency,
        });
        res.json(result);
        return [2 /*return*/];
    });
}); }));
exports.splitsRouter.get('/:splitId/analytics', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var splitId;
    return __generator(this, function (_a) {
        splitId = firstParam(req.params.splitId);
        res.json((0, splits_js_1.getSplitAnalytics)(splitId));
        return [2 /*return*/];
    });
}); }));
exports.splitsRouter.get('/:splitId/audit', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var splitId;
    return __generator(this, function (_a) {
        splitId = firstParam(req.params.splitId);
        res.json({ events: (0, splits_js_1.getSplitAuditTrail)(splitId) });
        return [2 /*return*/];
    });
}); }));
exports.splitsRouter.get('/:splitId/recipients/export', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var splitId, csv;
    return __generator(this, function (_a) {
        splitId = firstParam(req.params.splitId);
        csv = (0, splits_js_1.exportSplitRecipientsCsv)(splitId);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', "attachment; filename=\"split-".concat(splitId, "-recipients.csv\""));
        res.send(csv);
        return [2 /*return*/];
    });
}); }));
