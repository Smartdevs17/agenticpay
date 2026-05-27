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
exports.pushService = void 0;
var webpush_1 = require("webpush");
var config_js_1 = require("../config.js");
var vapid_js_1 = require("./vapid.js");
var PushService = /** @class */ (function () {
    function PushService() {
        this.vapidKeys = null;
        this.subscriptions = new Map();
        this.preferences = new Map();
        this.initializeVapidKeys();
    }
    PushService.prototype.initializeVapidKeys = function () {
        try {
            var storedKeys = config_js_1.config.vapidKeys;
            if (storedKeys && storedKeys.publicKey && storedKeys.privateKey) {
                this.vapidKeys = storedKeys;
            }
            else {
                this.vapidKeys = (0, vapid_js_1.generateVapidKeys)();
            }
            (0, webpush_1.setVapidDetails)('mailto:security@agenticpay.com', this.vapidKeys.publicKey, this.vapidKeys.privateKey);
            console.log('[Push] VAPID keys initialized');
        }
        catch (error) {
            console.error('[Push] Failed to initialize VAPID keys:', error);
            this.vapidKeys = (0, vapid_js_1.generateVapidKeys)();
        }
    };
    PushService.prototype.getVapidPublicKey = function () {
        var _a;
        return ((_a = this.vapidKeys) === null || _a === void 0 ? void 0 : _a.publicKey) || '';
    };
    PushService.prototype.subscribe = function (userId, subscription) {
        return __awaiter(this, void 0, void 0, function () {
            var existingSubscriptions, filtered;
            return __generator(this, function (_a) {
                existingSubscriptions = this.subscriptions.get(userId) || [];
                filtered = existingSubscriptions.filter(function (s) { return s.endpoint !== subscription.endpoint; });
                filtered.push(subscription);
                this.subscriptions.set(userId, filtered);
                console.log("[Push] User ".concat(userId, " subscribed"));
                return [2 /*return*/, { success: true }];
            });
        });
    };
    PushService.prototype.unsubscribe = function (userId, endpoint) {
        return __awaiter(this, void 0, void 0, function () {
            var existingSubscriptions, filtered;
            return __generator(this, function (_a) {
                existingSubscriptions = this.subscriptions.get(userId) || [];
                filtered = existingSubscriptions.filter(function (s) { return s.endpoint !== endpoint; });
                this.subscriptions.set(userId, filtered);
                console.log("[Push] User ".concat(userId, " unsubscribed from ").concat(endpoint));
                return [2 /*return*/];
            });
        });
    };
    PushService.prototype.sendNotification = function (params) {
        return __awaiter(this, void 0, void 0, function () {
            var userId, title, body, icon, badge, data, actions, subscriptions, preferences, isPaymentNotification, isInvoiceNotification, isMarketingNotification, isSecurityNotification, payload, sent, failed, _i, subscriptions_1, subscription, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        userId = params.userId, title = params.title, body = params.body, icon = params.icon, badge = params.badge, data = params.data, actions = params.actions;
                        subscriptions = this.subscriptions.get(userId) || [];
                        return [4 /*yield*/, this.getPreferences(userId)];
                    case 1:
                        preferences = _a.sent();
                        if (!preferences.enabled) {
                            return [2 /*return*/, { sent: 0, failed: 0 }];
                        }
                        isPaymentNotification = (data === null || data === void 0 ? void 0 : data.type) === 'payment';
                        isInvoiceNotification = (data === null || data === void 0 ? void 0 : data.type) === 'invoice';
                        isMarketingNotification = (data === null || data === void 0 ? void 0 : data.type) === 'marketing';
                        isSecurityNotification = (data === null || data === void 0 ? void 0 : data.type) === 'security';
                        if (isPaymentNotification && !preferences.payments)
                            return [2 /*return*/, { sent: 0, failed: 0 }];
                        if (isInvoiceNotification && !preferences.invoices)
                            return [2 /*return*/, { sent: 0, failed: 0 }];
                        if (isMarketingNotification && !preferences.marketing)
                            return [2 /*return*/, { sent: 0, failed: 0 }];
                        if (isSecurityNotification && !preferences.security)
                            return [2 /*return*/, { sent: 0, failed: 0 }];
                        payload = {
                            title: title,
                            body: body,
                            icon: icon || '/icons/notification.png',
                            badge: badge || '/icons/badge.png',
                            data: data,
                            actions: actions,
                            silent: preferences.sound === 'none',
                        };
                        sent = 0;
                        failed = 0;
                        _i = 0, subscriptions_1 = subscriptions;
                        _a.label = 2;
                    case 2:
                        if (!(_i < subscriptions_1.length)) return [3 /*break*/, 9];
                        subscription = subscriptions_1[_i];
                        _a.label = 3;
                    case 3:
                        _a.trys.push([3, 5, , 8]);
                        return [4 /*yield*/, webpush_1.webpush.sendNotification(subscription, JSON.stringify(payload))];
                    case 4:
                        _a.sent();
                        sent++;
                        return [3 /*break*/, 8];
                    case 5:
                        error_1 = _a.sent();
                        console.error("[Push] Failed to send to ".concat(subscription.endpoint, ":"), error_1);
                        failed++;
                        if (!(error_1.statusCode === 410)) return [3 /*break*/, 7];
                        return [4 /*yield*/, this.unsubscribe(userId, subscription.endpoint)];
                    case 6:
                        _a.sent();
                        _a.label = 7;
                    case 7: return [3 /*break*/, 8];
                    case 8:
                        _i++;
                        return [3 /*break*/, 2];
                    case 9: return [2 /*return*/, { sent: sent, failed: failed }];
                }
            });
        });
    };
    PushService.prototype.getPreferences = function (userId) {
        return __awaiter(this, void 0, void 0, function () {
            var stored;
            return __generator(this, function (_a) {
                stored = this.preferences.get(userId);
                if (stored)
                    return [2 /*return*/, stored];
                return [2 /*return*/, {
                        enabled: true,
                        payments: true,
                        invoices: true,
                        marketing: false,
                        security: true,
                        sound: 'default',
                        badge: 'default',
                    }];
            });
        });
    };
    PushService.prototype.updatePreferences = function (userId, preferences) {
        return __awaiter(this, void 0, void 0, function () {
            var current, updated;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.getPreferences(userId)];
                    case 1:
                        current = _a.sent();
                        updated = __assign(__assign({}, current), preferences);
                        this.preferences.set(userId, updated);
                        console.log("[Push] Preferences updated for user ".concat(userId));
                        return [2 /*return*/, updated];
                }
            });
        });
    };
    return PushService;
}());
exports.pushService = new PushService();
