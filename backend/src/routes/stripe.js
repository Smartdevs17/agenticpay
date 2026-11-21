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
exports.stripeRouter = void 0;
var express_1 = require("express");
var express_2 = require("express");
var zod_1 = require("zod");
var errorHandler_js_1 = require("../middleware/errorHandler.js");
var validate_js_1 = require("../middleware/validate.js");
var stripe_js_1 = require("../services/stripe.js");
exports.stripeRouter = (0, express_1.Router)();
// ── Schemas ──────────────────────────────────────────────────────────────────
var createPaymentIntentSchema = zod_1.z.object({
    amount: zod_1.z.number().int().positive(),
    currency: zod_1.z.string().min(3).max(3),
    customerId: zod_1.z.string().optional(),
    description: zod_1.z.string().optional(),
    metadata: zod_1.z.record(zod_1.z.string()).optional(),
});
var createCustomerSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    name: zod_1.z.string().optional(),
});
var createRefundSchema = zod_1.z.object({
    paymentIntentId: zod_1.z.string().min(1),
    amount: zod_1.z.number().int().positive().optional(),
    reason: zod_1.z.enum(['duplicate', 'fraudulent', 'requested_by_customer']).optional(),
});
var disputeEvidenceSchema = zod_1.z.object({
    customerEmailAddress: zod_1.z.string().email().optional(),
    customerName: zod_1.z.string().optional(),
    productDescription: zod_1.z.string().optional(),
    uncategorizedText: zod_1.z.string().optional(),
});
// ── Payment Intents ──────────────────────────────────────────────────────────
/**
 * POST /api/v1/stripe/payment-intents
 * Create a payment intent (card tokenization entry point)
 */
exports.stripeRouter.post('/payment-intents', (0, validate_js_1.validate)(createPaymentIntentSchema), (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, amount, currency, customerId, description, metadata, intent, stripeFee;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = req.body, amount = _a.amount, currency = _a.currency, customerId = _a.customerId, description = _a.description, metadata = _a.metadata;
                return [4 /*yield*/, (0, stripe_js_1.createPaymentIntent)({ amount: amount, currency: currency, customerId: customerId, description: description, metadata: metadata })];
            case 1:
                intent = _b.sent();
                stripeFee = (0, stripe_js_1.estimateStripeFee)(amount);
                (0, stripe_js_1.recordFee)({
                    paymentIntentId: intent.id,
                    amount: amount,
                    currency: currency,
                    stripeFee: stripeFee,
                    netAmount: amount - stripeFee,
                    createdAt: new Date().toISOString(),
                });
                res.status(201).json({
                    id: intent.id,
                    clientSecret: intent.client_secret,
                    status: intent.status,
                    amount: intent.amount,
                    currency: intent.currency,
                    stripeFee: stripeFee,
                    netAmount: amount - stripeFee,
                });
                return [2 /*return*/];
        }
    });
}); }));
/**
 * GET /api/v1/stripe/payment-intents/:id
 * Retrieve a payment intent (check 3DS status, etc.)
 */
exports.stripeRouter.get('/payment-intents/:id', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var intent;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, stripe_js_1.confirmPaymentIntent)(req.params.id)];
            case 1:
                intent = _a.sent();
                res.json({
                    id: intent.id,
                    status: intent.status,
                    amount: intent.amount,
                    currency: intent.currency,
                    nextAction: intent.next_action,
                });
                return [2 /*return*/];
        }
    });
}); }));
/**
 * POST /api/v1/stripe/payment-intents/:id/cancel
 * Cancel a payment intent
 */
exports.stripeRouter.post('/payment-intents/:id/cancel', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var intent;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, stripe_js_1.cancelPaymentIntent)(req.params.id)];
            case 1:
                intent = _a.sent();
                res.json({ id: intent.id, status: intent.status });
                return [2 /*return*/];
        }
    });
}); }));
// ── Customers ────────────────────────────────────────────────────────────────
/**
 * POST /api/v1/stripe/customers
 * Create a Stripe customer for card tokenization
 */
exports.stripeRouter.post('/customers', (0, validate_js_1.validate)(createCustomerSchema), (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, email, name, customer;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = req.body, email = _a.email, name = _a.name;
                return [4 /*yield*/, (0, stripe_js_1.createCustomer)(email, name)];
            case 1:
                customer = _b.sent();
                res.status(201).json({ id: customer.id, email: customer.email, name: customer.name });
                return [2 /*return*/];
        }
    });
}); }));
/**
 * GET /api/v1/stripe/customers/:id
 */
exports.stripeRouter.get('/customers/:id', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var customer;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, stripe_js_1.getCustomer)(req.params.id)];
            case 1:
                customer = _a.sent();
                if (customer.deleted) {
                    throw new errorHandler_js_1.AppError(404, 'Customer not found', 'NOT_FOUND');
                }
                res.json({ id: customer.id });
                return [2 /*return*/];
        }
    });
}); }));
// ── Refunds ──────────────────────────────────────────────────────────────────
/**
 * POST /api/v1/stripe/refunds
 * Issue a full or partial refund
 */
exports.stripeRouter.post('/refunds', (0, validate_js_1.validate)(createRefundSchema), (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, paymentIntentId, amount, reason, refund;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = req.body, paymentIntentId = _a.paymentIntentId, amount = _a.amount, reason = _a.reason;
                return [4 /*yield*/, (0, stripe_js_1.createRefund)({ paymentIntentId: paymentIntentId, amount: amount, reason: reason })];
            case 1:
                refund = _b.sent();
                res.status(201).json({
                    id: refund.id,
                    status: refund.status,
                    amount: refund.amount,
                    currency: refund.currency,
                    reason: refund.reason,
                });
                return [2 /*return*/];
        }
    });
}); }));
/**
 * GET /api/v1/stripe/refunds/:id
 */
exports.stripeRouter.get('/refunds/:id', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var refund;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, stripe_js_1.getRefund)(req.params.id)];
            case 1:
                refund = _a.sent();
                res.json({ id: refund.id, status: refund.status, amount: refund.amount, currency: refund.currency });
                return [2 /*return*/];
        }
    });
}); }));
// ── Disputes ─────────────────────────────────────────────────────────────────
/**
 * GET /api/v1/stripe/disputes
 * List disputes, optionally filtered by payment intent
 */
exports.stripeRouter.get('/disputes', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var paymentIntentId, disputes;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                paymentIntentId = req.query.paymentIntentId;
                return [4 /*yield*/, (0, stripe_js_1.listDisputes)(paymentIntentId)];
            case 1:
                disputes = _a.sent();
                res.json({ data: disputes.data.map(function (d) { return ({ id: d.id, status: d.status, amount: d.amount, reason: d.reason }); }) });
                return [2 /*return*/];
        }
    });
}); }));
/**
 * GET /api/v1/stripe/disputes/:id
 */
exports.stripeRouter.get('/disputes/:id', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var dispute;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, stripe_js_1.getDispute)(req.params.id)];
            case 1:
                dispute = _a.sent();
                res.json({ id: dispute.id, status: dispute.status, amount: dispute.amount, reason: dispute.reason });
                return [2 /*return*/];
        }
    });
}); }));
/**
 * POST /api/v1/stripe/disputes/:id/evidence
 * Submit evidence for a dispute
 */
exports.stripeRouter.post('/disputes/:id/evidence', (0, validate_js_1.validate)(disputeEvidenceSchema), (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var dispute;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, stripe_js_1.submitDisputeEvidence)(req.params.id, req.body)];
            case 1:
                dispute = _a.sent();
                res.json({ id: dispute.id, status: dispute.status });
                return [2 /*return*/];
        }
    });
}); }));
// ── Fees ─────────────────────────────────────────────────────────────────────
/**
 * GET /api/v1/stripe/fees
 * List all tracked fee records
 */
exports.stripeRouter.get('/fees', (0, errorHandler_js_1.asyncHandler)(function (_req, res) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        res.json({ data: (0, stripe_js_1.listFeeRecords)() });
        return [2 /*return*/];
    });
}); }));
/**
 * GET /api/v1/stripe/fees/:paymentIntentId
 */
exports.stripeRouter.get('/fees/:paymentIntentId', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var record;
    return __generator(this, function (_a) {
        record = (0, stripe_js_1.getFeeRecord)(req.params.paymentIntentId);
        if (!record)
            throw new errorHandler_js_1.AppError(404, 'Fee record not found', 'NOT_FOUND');
        res.json(record);
        return [2 /*return*/];
    });
}); }));
// ── Webhooks ─────────────────────────────────────────────────────────────────
/**
 * POST /api/v1/stripe/webhooks
 * Stripe webhook endpoint — must use raw body parser
 */
exports.stripeRouter.post('/webhooks', express_2.default.raw({ type: 'application/json' }), (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var sig, event, pi, pi, pi, dispute, dispute, charge;
    var _a;
    return __generator(this, function (_b) {
        sig = req.headers['stripe-signature'];
        if (!sig)
            throw new errorHandler_js_1.AppError(400, 'Missing stripe-signature header', 'MISSING_SIGNATURE');
        event = (0, stripe_js_1.constructWebhookEvent)(req.body, sig);
        switch (event.type) {
            case 'payment_intent.succeeded': {
                pi = event.data.object;
                console.log("[Stripe] payment_intent.succeeded: ".concat(pi.id, " ").concat(pi.amount, " ").concat(pi.currency));
                break;
            }
            case 'payment_intent.payment_failed': {
                pi = event.data.object;
                console.warn("[Stripe] payment_intent.payment_failed: ".concat(pi.id, " - ").concat((_a = pi.last_payment_error) === null || _a === void 0 ? void 0 : _a.message));
                break;
            }
            case 'payment_intent.requires_action': {
                pi = event.data.object;
                console.log("[Stripe] 3DS required for payment_intent: ".concat(pi.id));
                break;
            }
            case 'charge.dispute.created': {
                dispute = event.data.object;
                console.warn("[Stripe] Dispute created: ".concat(dispute.id, " for PI: ").concat(dispute.payment_intent));
                break;
            }
            case 'charge.dispute.closed': {
                dispute = event.data.object;
                console.log("[Stripe] Dispute closed: ".concat(dispute.id, " status: ").concat(dispute.status));
                break;
            }
            case 'charge.refunded': {
                charge = event.data.object;
                console.log("[Stripe] Charge refunded: ".concat(charge.id, " amount: ").concat(charge.amount_refunded));
                break;
            }
            default:
                console.log("[Stripe] Unhandled event type: ".concat(event.type));
        }
        res.json({ received: true });
        return [2 /*return*/];
    });
}); }));
