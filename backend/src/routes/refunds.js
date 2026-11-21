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
exports.refundsRouter = void 0;
var express_1 = require("express");
var validate_js_1 = require("../middleware/validate.js");
var errorHandler_js_1 = require("../middleware/errorHandler.js");
var index_js_1 = require("../schemas/index.js");
var refunds_js_1 = require("../services/refunds.js");
exports.refundsRouter = (0, express_1.Router)();
var firstParam = function (value) { var _a; return (Array.isArray(value) ? (_a = value[0]) !== null && _a !== void 0 ? _a : '' : value !== null && value !== void 0 ? value : ''); };
exports.refundsRouter.post('/policies', (0, validate_js_1.validate)(index_js_1.refundPolicySchema), (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var policy;
    return __generator(this, function (_a) {
        policy = (0, refunds_js_1.upsertRefundPolicy)(req.body);
        res.status(201).json(policy);
        return [2 /*return*/];
    });
}); }));
exports.refundsRouter.get('/policies/:merchantId', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var merchantId;
    return __generator(this, function (_a) {
        merchantId = firstParam(req.params.merchantId);
        if (!merchantId) {
            throw new errorHandler_js_1.AppError(400, 'Merchant id is required', 'VALIDATION_ERROR');
        }
        res.json((0, refunds_js_1.getRefundPolicy)(merchantId));
        return [2 /*return*/];
    });
}); }));
exports.refundsRouter.post('/evaluate', (0, validate_js_1.validate)(index_js_1.refundEvaluationSchema), (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        res.json((0, refunds_js_1.evaluateRefund)(req.body));
        return [2 /*return*/];
    });
}); }));
exports.refundsRouter.get('/manual-review', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var merchantId;
    return __generator(this, function (_a) {
        merchantId = typeof req.query.merchantId === 'string' ? req.query.merchantId : undefined;
        res.json({ items: (0, refunds_js_1.listManualReviews)(merchantId) });
        return [2 /*return*/];
    });
}); }));
exports.refundsRouter.patch('/manual-review/:reviewId', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var reviewId, status;
    var _a;
    return __generator(this, function (_b) {
        reviewId = firstParam(req.params.reviewId);
        status = (_a = req.body) === null || _a === void 0 ? void 0 : _a.status;
        if (status !== 'approved' && status !== 'rejected') {
            throw new errorHandler_js_1.AppError(400, "Status must be 'approved' or 'rejected'", 'VALIDATION_ERROR');
        }
        res.json((0, refunds_js_1.resolveManualReview)(reviewId, status));
        return [2 /*return*/];
    });
}); }));
exports.refundsRouter.get('/analytics/:merchantId', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var merchantId;
    return __generator(this, function (_a) {
        merchantId = firstParam(req.params.merchantId);
        res.json((0, refunds_js_1.getRefundAnalytics)(merchantId));
        return [2 /*return*/];
    });
}); }));
