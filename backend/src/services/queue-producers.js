"use strict";
/**
 * Queue Job Producers
 * Provides convenient methods to enqueue specific types of jobs
 */
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
exports.queueEmail = queueEmail;
exports.queueNotification = queueNotification;
exports.queueWebhook = queueWebhook;
exports.processEmailJob = processEmailJob;
exports.processNotificationJob = processNotificationJob;
exports.processWebhookJob = processWebhookJob;
exports.registerDefaultProcessors = registerDefaultProcessors;
var queue_js_1 = require("./queue.js");
/**
 * Queue an email to be sent asynchronously
 */
function queueEmail(emailData, maxAttempts) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, queue_js_1.messageQueue.enqueue('email', emailData, maxAttempts || 3)];
        });
    });
}
/**
 * Queue a notification to be delivered asynchronously
 */
function queueNotification(notificationData, maxAttempts) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, queue_js_1.messageQueue.enqueue('notifications', notificationData, maxAttempts || 5)];
        });
    });
}
/**
 * Queue a webhook call to be delivered asynchronously
 */
function queueWebhook(webhookData, maxAttempts) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, queue_js_1.messageQueue.enqueue('webhooks', webhookData, maxAttempts || 5)];
        });
    });
}
/**
 * Default email processor implementation
 * In production, this would integrate with a real email service like SendGrid or AWS SES
 */
function processEmailJob(job) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, to, subject, body, html, _b, from;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _a = job.data, to = _a.to, subject = _a.subject, body = _a.body, html = _a.html, _b = _a.from, from = _b === void 0 ? 'noreply@agenticpay.dev' : _b;
                    if (!to || !subject || !body) {
                        throw new Error('Missing required email fields: to, subject, body');
                    }
                    // TODO: Integrate with actual email service
                    // For now, just log the email
                    console.log("Sending email to ".concat(to, ":"), {
                        from: from,
                        subject: subject,
                        body: body,
                        html: html,
                    });
                    // Simulate email sending delay
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 100); })];
                case 1:
                    // Simulate email sending delay
                    _c.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Default notification processor implementation
 * In production, this would integrate with a notification service
 */
function processNotificationJob(job) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, userId, type, title, message, metadata;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _a = job.data, userId = _a.userId, type = _a.type, title = _a.title, message = _a.message, metadata = _a.metadata;
                    if (!userId || !type || !title || !message) {
                        throw new Error('Missing required notification fields: userId, type, title, message');
                    }
                    // TODO: Integrate with actual notification service (push notifications, in-app, email, SMS, etc.)
                    // For now, just log the notification
                    console.log("Sending ".concat(type, " notification to user ").concat(userId, ":"), {
                        title: title,
                        message: message,
                        metadata: metadata,
                    });
                    // Simulate notification delivery delay
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 50); })];
                case 1:
                    // Simulate notification delivery delay
                    _b.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Default webhook processor implementation
 */
function processWebhookJob(job) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, url, _b, method, _c, headers, body, _d, timeout, controller, timeoutId, response;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    _a = job.data, url = _a.url, _b = _a.method, method = _b === void 0 ? 'POST' : _b, _c = _a.headers, headers = _c === void 0 ? {} : _c, body = _a.body, _d = _a.timeout, timeout = _d === void 0 ? 5000 : _d;
                    if (!url) {
                        throw new Error('Missing required webhook field: url');
                    }
                    controller = new AbortController();
                    timeoutId = setTimeout(function () { return controller.abort(); }, timeout);
                    _e.label = 1;
                case 1:
                    _e.trys.push([1, , 3, 4]);
                    return [4 /*yield*/, fetch(url, {
                            method: method,
                            headers: __assign({ 'Content-Type': 'application/json' }, headers),
                            body: body ? JSON.stringify(body) : undefined,
                            signal: controller.signal,
                        })];
                case 2:
                    response = _e.sent();
                    if (!response.ok) {
                        throw new Error("Webhook request failed with status ".concat(response.status, ": ").concat(response.statusText));
                    }
                    console.log("Webhook delivered successfully to ".concat(url), {
                        status: response.status,
                    });
                    return [3 /*break*/, 4];
                case 3:
                    clearTimeout(timeoutId);
                    return [7 /*endfinally*/];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * Register all default job processors
 */
function registerDefaultProcessors() {
    queue_js_1.messageQueue.registerProcessor('email', processEmailJob);
    queue_js_1.messageQueue.registerProcessor('notifications', processNotificationJob);
    queue_js_1.messageQueue.registerProcessor('webhooks', processWebhookJob);
}
