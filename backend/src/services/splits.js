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
exports.createSplitConfig = createSplitConfig;
exports.updateSplitConfig = updateSplitConfig;
exports.getSplitConfig = getSplitConfig;
exports.listMerchantSplits = listMerchantSplits;
exports.executeSplitPayment = executeSplitPayment;
exports.getSplitAnalytics = getSplitAnalytics;
exports.getSplitAuditTrail = getSplitAuditTrail;
exports.exportSplitRecipientsCsv = exportSplitRecipientsCsv;
var errorHandler_js_1 = require("../middleware/errorHandler.js");
var splitConfigs = new Map();
var merchantSplitIndex = new Map();
var splitExecutions = new Map();
var splitAuditTrail = new Map();
var round2 = function (value) { return Math.round(value * 100) / 100; };
function validatePercentages(recipients, platformFeePercentage) {
    var recipientTotal = recipients.reduce(function (sum, recipient) { return sum + recipient.percentage; }, 0);
    var grandTotal = round2(recipientTotal + platformFeePercentage);
    if (grandTotal > 100) {
        throw new errorHandler_js_1.AppError(400, 'Recipient percentages plus platform fee cannot exceed 100', 'VALIDATION_ERROR');
    }
}
function pushAudit(splitId, eventType, message) {
    var _a;
    var current = (_a = splitAuditTrail.get(splitId)) !== null && _a !== void 0 ? _a : [];
    current.push({
        id: "audit_".concat(Date.now(), "_").concat(Math.random().toString(36).slice(2, 8)),
        splitId: splitId,
        eventType: eventType,
        message: message,
        createdAt: new Date().toISOString(),
    });
    splitAuditTrail.set(splitId, current);
}
function createSplitConfig(input) {
    var _a;
    validatePercentages(input.recipients, input.platformFeePercentage);
    var id = "split_".concat(Date.now(), "_").concat(Math.random().toString(36).slice(2, 8));
    var now = new Date().toISOString();
    var config = {
        id: id,
        merchantId: input.merchantId,
        platformFeePercentage: input.platformFeePercentage,
        recipients: input.recipients,
        createdAt: now,
        updatedAt: now,
    };
    splitConfigs.set(id, config);
    var merchantSplits = (_a = merchantSplitIndex.get(input.merchantId)) !== null && _a !== void 0 ? _a : [];
    merchantSplits.push(id);
    merchantSplitIndex.set(input.merchantId, merchantSplits);
    pushAudit(id, 'created', "Split config created for merchant ".concat(input.merchantId));
    return config;
}
function updateSplitConfig(splitId, patch) {
    var _a, _b;
    var existing = splitConfigs.get(splitId);
    if (!existing) {
        throw new errorHandler_js_1.AppError(404, 'Split config not found', 'NOT_FOUND');
    }
    var nextRecipients = (_a = patch.recipients) !== null && _a !== void 0 ? _a : existing.recipients;
    var nextPlatformFee = (_b = patch.platformFeePercentage) !== null && _b !== void 0 ? _b : existing.platformFeePercentage;
    validatePercentages(nextRecipients, nextPlatformFee);
    var updated = __assign(__assign({}, existing), { recipients: nextRecipients, platformFeePercentage: nextPlatformFee, updatedAt: new Date().toISOString() });
    splitConfigs.set(splitId, updated);
    pushAudit(splitId, 'updated', 'Split config updated');
    return updated;
}
function getSplitConfig(splitId) {
    var _a;
    return (_a = splitConfigs.get(splitId)) !== null && _a !== void 0 ? _a : null;
}
function listMerchantSplits(merchantId) {
    var _a;
    var ids = (_a = merchantSplitIndex.get(merchantId)) !== null && _a !== void 0 ? _a : [];
    return ids
        .map(function (id) { return splitConfigs.get(id); })
        .filter(function (config) { return Boolean(config); });
}
function executeSplitPayment(input) {
    var _a;
    var split = splitConfigs.get(input.splitId);
    if (!split) {
        throw new errorHandler_js_1.AppError(404, 'Split config not found', 'NOT_FOUND');
    }
    var platformFeeAmount = round2((input.totalAmount * split.platformFeePercentage) / 100);
    var recipientDistributions = split.recipients.map(function (recipient) {
        var amount = round2((input.totalAmount * recipient.percentage) / 100);
        var skipped = amount < recipient.minimumThreshold;
        return {
            recipientId: recipient.recipientId,
            walletAddress: recipient.walletAddress,
            amount: amount,
            skipped: skipped,
            reason: skipped ? 'Below minimum threshold' : undefined,
        };
    });
    var result = {
        paymentId: input.paymentId,
        splitId: split.id,
        totalAmount: input.totalAmount,
        currency: input.currency,
        platformFeeAmount: platformFeeAmount,
        recipientDistributions: recipientDistributions,
        executedAt: new Date().toISOString(),
    };
    var existing = (_a = splitExecutions.get(split.id)) !== null && _a !== void 0 ? _a : [];
    existing.push(result);
    splitExecutions.set(split.id, existing);
    pushAudit(split.id, 'executed', "Split executed for payment ".concat(input.paymentId));
    return result;
}
function getSplitAnalytics(splitId) {
    var _a;
    var executions = (_a = splitExecutions.get(splitId)) !== null && _a !== void 0 ? _a : [];
    var totalProcessed = executions.reduce(function (sum, item) { return sum + item.totalAmount; }, 0);
    var totalPlatformFees = executions.reduce(function (sum, item) { return sum + item.platformFeeAmount; }, 0);
    var skippedDistributions = executions.reduce(function (sum, item) { return sum + item.recipientDistributions.filter(function (distribution) { return distribution.skipped; }).length; }, 0);
    return {
        splitId: splitId,
        totalExecutions: executions.length,
        totalProcessed: round2(totalProcessed),
        totalPlatformFees: round2(totalPlatformFees),
        skippedDistributions: skippedDistributions,
    };
}
function getSplitAuditTrail(splitId) {
    var _a;
    return (_a = splitAuditTrail.get(splitId)) !== null && _a !== void 0 ? _a : [];
}
function exportSplitRecipientsCsv(splitId) {
    var split = splitConfigs.get(splitId);
    if (!split) {
        throw new errorHandler_js_1.AppError(404, 'Split config not found', 'NOT_FOUND');
    }
    var header = 'recipientId,walletAddress,percentage,minimumThreshold';
    var rows = split.recipients.map(function (recipient) {
        return "".concat(recipient.recipientId, ",").concat(recipient.walletAddress, ",").concat(recipient.percentage.toFixed(2), ",").concat(recipient.minimumThreshold.toFixed(2));
    });
    return __spreadArray([header], rows, true).join('\n');
}
