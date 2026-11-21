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
exports.emailRouter = void 0;
var express_1 = require("express");
var errorHandler_js_1 = require("../middleware/errorHandler.js");
exports.emailRouter = (0, express_1.Router)();
var emailTemplates = new Map();
var emailQueue = [];
var unsubscribedUsers = new Set();
emailTemplates.set('payment_receipt', {
    id: 'payment_receipt',
    name: 'Payment Receipt',
    subject: 'Payment Receipt - {{amount}} {{currency}}',
    body: "Dear {{customerName}},\n\nThank you for your payment of {{amount}} {{currency}}.\n\nPayment Details:\n- Transaction ID: {{transactionId}}\n- Amount: {{amount}} {{currency}}\n- Date: {{date}}\n- Status: {{status}}\n\n{{#if projectName}}\nProject: {{projectName}}\n{{/if}}\n\nIf you have any questions, please contact support.\n\nBest regards,\nAgenticPay Team",
    variables: ['customerName', 'amount', 'currency', 'transactionId', 'date', 'status', 'projectName'],
});
emailTemplates.set('payment_confirmation', {
    id: 'payment_confirmation',
    name: 'Payment Confirmation',
    subject: 'Payment Confirmed - {{amount}} {{currency}}',
    body: "Dear {{customerName}},\n\nYour payment has been confirmed!\n\nAmount: {{amount}} {{currency}}\nTransaction Hash: {{transactionHash}}\nTimestamp: {{timestamp}}\n\nThis email serves as your official receipt.\n\nBest regards,\nAgenticPay Team",
    variables: ['customerName', 'amount', 'currency', 'transactionHash', 'timestamp'],
});
emailTemplates.set('refund_notification', {
    id: 'refund_notification',
    name: 'Refund Notification',
    subject: 'Refund Processed - {{amount}} {{currency}}',
    body: "Dear {{customerName}},\n\nYour refund of {{amount}} {{currency}} has been processed.\n\nOriginal Transaction: {{originalTransactionId}}\nRefund Amount: {{amount}} {{currency}}\nRefund ID: {{refundId}}\n\nThe funds should appear in your account within 5-7 business days.\n\nBest regards,\nAgenticPay Team",
    variables: ['customerName', 'amount', 'currency', 'originalTransactionId', 'refundId'],
});
function interpolateTemplate(template, variables) {
    var result = template;
    for (var _i = 0, _a = Object.entries(variables); _i < _a.length; _i++) {
        var _b = _a[_i], key = _b[0], value = _b[1];
        result = result.replace(new RegExp("{{".concat(key, "}}"), 'g'), value);
    }
    return result;
}
exports.emailRouter.get('/templates', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var templates;
    return __generator(this, function (_a) {
        templates = Array.from(emailTemplates.values()).map(function (t) { return ({
            id: t.id,
            name: t.name,
            subject: t.subject,
            variables: t.variables,
        }); });
        res.json({ templates: templates });
        return [2 /*return*/];
    });
}); }));
exports.emailRouter.get('/templates/:id', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var id, template;
    return __generator(this, function (_a) {
        id = req.params.id;
        template = emailTemplates.get(id);
        if (!template) {
            res.status(404).json({ error: 'Template not found' });
            return [2 /*return*/];
        }
        res.json(template);
        return [2 /*return*/];
    });
}); }));
exports.emailRouter.post('/templates', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, id, name, subject, body, variables, template;
    return __generator(this, function (_b) {
        _a = req.body, id = _a.id, name = _a.name, subject = _a.subject, body = _a.body, variables = _a.variables;
        if (!id || !name || !subject || !body) {
            res.status(400).json({ error: 'Missing required fields' });
            return [2 /*return*/];
        }
        template = { id: id, name: name, subject: subject, body: body, variables: variables || [] };
        emailTemplates.set(id, template);
        res.status(201).json(template);
        return [2 /*return*/];
    });
}); }));
exports.emailRouter.put('/templates/:id', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var id, _a, name, subject, body, variables, existing, template;
    return __generator(this, function (_b) {
        id = req.params.id;
        _a = req.body, name = _a.name, subject = _a.subject, body = _a.body, variables = _a.variables;
        existing = emailTemplates.get(id);
        if (!existing) {
            res.status(404).json({ error: 'Template not found' });
            return [2 /*return*/];
        }
        template = {
            id: id,
            name: name || existing.name,
            subject: subject || existing.subject,
            body: body || existing.body,
            variables: variables || existing.variables,
        };
        emailTemplates.set(id, template);
        res.json(template);
        return [2 /*return*/];
    });
}); }));
exports.emailRouter.post('/send', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, templateId, recipient, variables, backupEmail, template, primaryEmail, targetEmail, deliveryRecord, subject, body;
    return __generator(this, function (_b) {
        _a = req.body, templateId = _a.templateId, recipient = _a.recipient, variables = _a.variables, backupEmail = _a.backupEmail;
        if (!templateId || !recipient) {
            res.status(400).json({ error: 'Missing templateId or recipient' });
            return [2 /*return*/];
        }
        template = emailTemplates.get(templateId);
        if (!template) {
            res.status(404).json({ error: 'Template not found' });
            return [2 /*return*/];
        }
        primaryEmail = recipient;
        targetEmail = unsubscribedUsers.has(primaryEmail) ? (backupEmail || primaryEmail) : primaryEmail;
        if (unsubscribedUsers.has(primaryEmail)) {
            res.status(200).json({
                status: 'skipped',
                reason: 'User unsubscribed, sent to backup email',
                sentTo: targetEmail,
            });
            return [2 /*return*/];
        }
        deliveryRecord = {
            id: "delivery_".concat(Date.now(), "_").concat(Math.random().toString(36).substr(2, 9)),
            templateId: templateId,
            recipient: targetEmail,
            status: 'pending',
            retryCount: 0,
        };
        subject = interpolateTemplate(template.subject, variables || {});
        body = interpolateTemplate(template.body, variables || {});
        try {
            console.log("[Email] Sending to ".concat(targetEmail, ": ").concat(subject));
            deliveryRecord.status = 'sent';
            deliveryRecord.sentAt = new Date();
        }
        catch (error) {
            deliveryRecord.status = 'failed';
            deliveryRecord.error = error instanceof Error ? error.message : 'Unknown error';
            deliveryRecord.retryCount += 1;
        }
        emailQueue.push(deliveryRecord);
        res.json({
            id: deliveryRecord.id,
            status: deliveryRecord.status,
            recipient: deliveryRecord.recipient,
            sentAt: deliveryRecord.sentAt,
        });
        return [2 /*return*/];
    });
}); }));
exports.emailRouter.post('/send/batch', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var emails, results;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                emails = req.body.emails;
                if (!Array.isArray(emails)) {
                    res.status(400).json({ error: 'emails must be an array' });
                    return [2 /*return*/];
                }
                return [4 /*yield*/, Promise.all(emails.map(function (email) { return __awaiter(void 0, void 0, void 0, function () {
                        var templateId, recipient, variables, backupEmail, template, targetEmail, deliveryRecord;
                        return __generator(this, function (_a) {
                            templateId = email.templateId, recipient = email.recipient, variables = email.variables, backupEmail = email.backupEmail;
                            if (!templateId || !recipient) {
                                return [2 /*return*/, { error: 'Missing templateId or recipient', recipient: recipient }];
                            }
                            template = emailTemplates.get(templateId);
                            if (!template) {
                                return [2 /*return*/, { error: 'Template not found', templateId: templateId }];
                            }
                            targetEmail = unsubscribedUsers.has(recipient) ? (backupEmail || recipient) : recipient;
                            deliveryRecord = {
                                id: "delivery_".concat(Date.now(), "_").concat(Math.random().toString(36).substr(2, 9)),
                                templateId: templateId,
                                recipient: targetEmail,
                                status: 'pending',
                                retryCount: 0,
                            };
                            try {
                                console.log("[Email] Batch sending to ".concat(targetEmail));
                                deliveryRecord.status = 'sent';
                                deliveryRecord.sentAt = new Date();
                            }
                            catch (error) {
                                deliveryRecord.status = 'failed';
                                deliveryRecord.error = error instanceof Error ? error.message : 'Unknown error';
                            }
                            emailQueue.push(deliveryRecord);
                            return [2 /*return*/, { id: deliveryRecord.id, status: deliveryRecord.status, recipient: targetEmail }];
                        });
                    }); }))];
            case 1:
                results = _a.sent();
                res.json({ results: results, total: results.length });
                return [2 /*return*/];
        }
    });
}); }));
exports.emailRouter.get('/delivery/:id', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var id, record;
    return __generator(this, function (_a) {
        id = req.params.id;
        record = emailQueue.find(function (r) { return r.id === id; });
        if (!record) {
            res.status(404).json({ error: 'Delivery record not found' });
            return [2 /*return*/];
        }
        res.json(record);
        return [2 /*return*/];
    });
}); }));
exports.emailRouter.get('/delivery', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, recipient, status, _b, limit, filtered, limitNum;
    return __generator(this, function (_c) {
        _a = req.query, recipient = _a.recipient, status = _a.status, _b = _a.limit, limit = _b === void 0 ? '50' : _b;
        filtered = emailQueue;
        if (recipient) {
            filtered = filtered.filter(function (r) { return r.recipient === recipient; });
        }
        if (status) {
            filtered = filtered.filter(function (r) { return r.status === status; });
        }
        limitNum = Math.min(parseInt(limit, 10) || 50, 200);
        res.json({ deliveries: filtered.slice(-limitNum) });
        return [2 /*return*/];
    });
}); }));
exports.emailRouter.post('/track/open/:id', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var id, record;
    return __generator(this, function (_a) {
        id = req.params.id;
        record = emailQueue.find(function (r) { return r.id === id; });
        if (!record) {
            res.status(404).json({ error: 'Delivery record not found' });
            return [2 /*return*/];
        }
        record.openedAt = new Date();
        res.json({ success: true, openedAt: record.openedAt });
        return [2 /*return*/];
    });
}); }));
exports.emailRouter.post('/track/click/:id', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var id, record;
    return __generator(this, function (_a) {
        id = req.params.id;
        record = emailQueue.find(function (r) { return r.id === id; });
        if (!record) {
            res.status(404).json({ error: 'Delivery record not found' });
            return [2 /*return*/];
        }
        record.clickedAt = new Date();
        res.json({ success: true, clickedAt: record.clickedAt });
        return [2 /*return*/];
    });
}); }));
exports.emailRouter.post('/unsubscribe', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var email;
    return __generator(this, function (_a) {
        email = req.body.email;
        if (!email) {
            res.status(400).json({ error: 'Email is required' });
            return [2 /*return*/];
        }
        unsubscribedUsers.add(email);
        res.json({ success: true, message: 'Unsubscribed successfully' });
        return [2 /*return*/];
    });
}); }));
exports.emailRouter.post('/subscribe', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var email;
    return __generator(this, function (_a) {
        email = req.body.email;
        if (!email) {
            res.status(400).json({ error: 'Email is required' });
            return [2 /*return*/];
        }
        unsubscribedUsers.delete(email);
        res.json({ success: true, message: 'Subscribed successfully' });
        return [2 /*return*/];
    });
}); }));
exports.emailRouter.get('/unsubscribed', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        res.json({ unsubscribed: Array.from(unsubscribedUsers) });
        return [2 /*return*/];
    });
}); }));
exports.emailRouter.get('/preferences/:email', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var email, isUnsubscribed;
    return __generator(this, function (_a) {
        email = req.params.email;
        isUnsubscribed = unsubscribedUsers.has(email);
        res.json({
            email: email,
            unsubscribed: isUnsubscribed,
            preferences: {
                paymentReceipts: !isUnsubscribed,
                paymentConfirmations: !isUnsubscribed,
                refundNotifications: !isUnsubscribed,
            },
        });
        return [2 /*return*/];
    });
}); }));
exports.emailRouter.put('/preferences/:email', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var email, _a, paymentReceipts, paymentConfirmations, refundNotifications, allDisabled;
    return __generator(this, function (_b) {
        email = req.params.email;
        _a = req.body, paymentReceipts = _a.paymentReceipts, paymentConfirmations = _a.paymentConfirmations, refundNotifications = _a.refundNotifications;
        allDisabled = !paymentReceipts && !paymentConfirmations && !refundNotifications;
        if (allDisabled) {
            unsubscribedUsers.add(email);
        }
        else {
            unsubscribedUsers.delete(email);
        }
        res.json({
            email: email,
            unsubscribed: unsubscribedUsers.has(email),
            preferences: {
                paymentReceipts: paymentReceipts !== null && paymentReceipts !== void 0 ? paymentReceipts : true,
                paymentConfirmations: paymentConfirmations !== null && paymentConfirmations !== void 0 ? paymentConfirmations : true,
                refundNotifications: refundNotifications !== null && refundNotifications !== void 0 ? refundNotifications : true,
            },
        });
        return [2 /*return*/];
    });
}); }));
exports.emailRouter.post('/retry/:id', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var id, record;
    return __generator(this, function (_a) {
        id = req.params.id;
        record = emailQueue.find(function (r) { return r.id === id; });
        if (!record) {
            res.status(404).json({ error: 'Delivery record not found' });
            return [2 /*return*/];
        }
        if (record.status !== 'failed' && record.status !== 'bounced') {
            res.status(400).json({ error: 'Can only retry failed or bounced deliveries' });
            return [2 /*return*/];
        }
        if (record.retryCount >= 3) {
            res.status(400).json({ error: 'Max retry attempts reached' });
            return [2 /*return*/];
        }
        try {
            console.log("[Email] Retrying delivery ".concat(id));
            record.status = 'sent';
            record.sentAt = new Date();
        }
        catch (error) {
            record.status = 'failed';
            record.error = error instanceof Error ? error.message : 'Unknown error';
            record.retryCount += 1;
        }
        res.json({
            id: record.id,
            status: record.status,
            retryCount: record.retryCount,
        });
        return [2 /*return*/];
    });
}); }));
