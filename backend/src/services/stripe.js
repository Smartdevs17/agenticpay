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
exports.getStripe = getStripe;
exports.createPaymentIntent = createPaymentIntent;
exports.confirmPaymentIntent = confirmPaymentIntent;
exports.cancelPaymentIntent = cancelPaymentIntent;
exports.createCustomer = createCustomer;
exports.getCustomer = getCustomer;
exports.createRefund = createRefund;
exports.getRefund = getRefund;
exports.getDispute = getDispute;
exports.listDisputes = listDisputes;
exports.submitDisputeEvidence = submitDisputeEvidence;
exports.constructWebhookEvent = constructWebhookEvent;
exports.recordFee = recordFee;
exports.getFeeRecord = getFeeRecord;
exports.listFeeRecords = listFeeRecords;
exports.estimateStripeFee = estimateStripeFee;
var stripe_1 = require("stripe");
var env_js_1 = require("../config/env.js");
var errorHandler_js_1 = require("../middleware/errorHandler.js");
var stripeClient = null;
function getStripe() {
    var cfg = (0, env_js_1.config)();
    if (!cfg.STRIPE_SECRET_KEY) {
        throw new errorHandler_js_1.AppError(500, 'Stripe is not configured', 'STRIPE_NOT_CONFIGURED');
    }
    if (!stripeClient) {
        stripeClient = new stripe_1.default(cfg.STRIPE_SECRET_KEY, { apiVersion: '2025-03-31.basil' });
    }
    return stripeClient;
}
function createPaymentIntent(input) {
    return __awaiter(this, void 0, void 0, function () {
        var stripe;
        var _a;
        return __generator(this, function (_b) {
            stripe = getStripe();
            return [2 /*return*/, stripe.paymentIntents.create({
                    amount: input.amount,
                    currency: input.currency.toLowerCase(),
                    customer: input.customerId,
                    description: input.description,
                    metadata: (_a = input.metadata) !== null && _a !== void 0 ? _a : {},
                    // Enable 3D Secure automatically
                    payment_method_types: ['card'],
                })];
        });
    });
}
function confirmPaymentIntent(paymentIntentId) {
    return __awaiter(this, void 0, void 0, function () {
        var stripe;
        return __generator(this, function (_a) {
            stripe = getStripe();
            return [2 /*return*/, stripe.paymentIntents.retrieve(paymentIntentId)];
        });
    });
}
function cancelPaymentIntent(paymentIntentId) {
    return __awaiter(this, void 0, void 0, function () {
        var stripe;
        return __generator(this, function (_a) {
            stripe = getStripe();
            return [2 /*return*/, stripe.paymentIntents.cancel(paymentIntentId)];
        });
    });
}
// ── Customers ────────────────────────────────────────────────────────────────
function createCustomer(email, name) {
    return __awaiter(this, void 0, void 0, function () {
        var stripe;
        return __generator(this, function (_a) {
            stripe = getStripe();
            return [2 /*return*/, stripe.customers.create({ email: email, name: name })];
        });
    });
}
function getCustomer(customerId) {
    return __awaiter(this, void 0, void 0, function () {
        var stripe;
        return __generator(this, function (_a) {
            stripe = getStripe();
            return [2 /*return*/, stripe.customers.retrieve(customerId)];
        });
    });
}
function createRefund(input) {
    return __awaiter(this, void 0, void 0, function () {
        var stripe;
        var _a;
        return __generator(this, function (_b) {
            stripe = getStripe();
            return [2 /*return*/, stripe.refunds.create({
                    payment_intent: input.paymentIntentId,
                    amount: input.amount,
                    reason: (_a = input.reason) !== null && _a !== void 0 ? _a : 'requested_by_customer',
                })];
        });
    });
}
function getRefund(refundId) {
    return __awaiter(this, void 0, void 0, function () {
        var stripe;
        return __generator(this, function (_a) {
            stripe = getStripe();
            return [2 /*return*/, stripe.refunds.retrieve(refundId)];
        });
    });
}
// ── Disputes ─────────────────────────────────────────────────────────────────
function getDispute(disputeId) {
    return __awaiter(this, void 0, void 0, function () {
        var stripe;
        return __generator(this, function (_a) {
            stripe = getStripe();
            return [2 /*return*/, stripe.disputes.retrieve(disputeId)];
        });
    });
}
function listDisputes(paymentIntentId) {
    return __awaiter(this, void 0, void 0, function () {
        var stripe;
        return __generator(this, function (_a) {
            stripe = getStripe();
            return [2 /*return*/, stripe.disputes.list(paymentIntentId ? { payment_intent: paymentIntentId } : {})];
        });
    });
}
function submitDisputeEvidence(disputeId, evidence) {
    return __awaiter(this, void 0, void 0, function () {
        var stripe;
        return __generator(this, function (_a) {
            stripe = getStripe();
            return [2 /*return*/, stripe.disputes.update(disputeId, { evidence: evidence })];
        });
    });
}
// ── Webhooks ─────────────────────────────────────────────────────────────────
function constructWebhookEvent(payload, signature) {
    var cfg = (0, env_js_1.config)();
    if (!cfg.STRIPE_WEBHOOK_SECRET) {
        throw new errorHandler_js_1.AppError(500, 'Stripe webhook secret not configured', 'STRIPE_WEBHOOK_NOT_CONFIGURED');
    }
    var stripe = getStripe();
    try {
        return stripe.webhooks.constructEvent(payload, signature, cfg.STRIPE_WEBHOOK_SECRET);
    }
    catch (_a) {
        throw new errorHandler_js_1.AppError(400, 'Invalid webhook signature', 'INVALID_WEBHOOK_SIGNATURE');
    }
}
// In-memory store; replace with DB in production
var feeStore = new Map();
function recordFee(record) {
    feeStore.set(record.paymentIntentId, record);
}
function getFeeRecord(paymentIntentId) {
    return feeStore.get(paymentIntentId);
}
function listFeeRecords() {
    return Array.from(feeStore.values());
}
/**
 * Estimate Stripe fee: 2.9% + $0.30 for US cards
 */
function estimateStripeFee(amountCents) {
    return Math.round(amountCents * 0.029 + 30);
}
