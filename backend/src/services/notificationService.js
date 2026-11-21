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
exports.NotificationService = void 0;
var email_js_1 = require("./channels/email.js");
var sms_js_1 = require("./channels/sms.js");
var push_js_1 = require("./channels/push.js");
var in_app_js_1 = require("./channels/in-app.js");
var preferenceService_js_1 = require("./preferenceService.js");
var templateService_js_1 = require("./templateService.js");
var deliveryTracker_js_1 = require("./deliveryTracker.js");
var NotificationService = /** @class */ (function () {
    function NotificationService() {
        this.emailChannel = new email_js_1.EmailChannel();
        this.smsChannel = new sms_js_1.SMSChannel();
        this.pushChannel = new push_js_1.PushChannel();
        this.inAppChannel = new in_app_js_1.InAppChannel();
        this.preferenceService = new preferenceService_js_1.NotificationPreferenceService();
        this.templateService = new templateService_js_1.NotificationTemplateService();
        this.deliveryTracker = new deliveryTracker_js_1.DeliveryTracker();
    }
    NotificationService.prototype.sendNotification = function (payload) {
        return __awaiter(this, void 0, void 0, function () {
            var templateId, variables, channels, userId, recipient, priority, scheduledFor, now, preferences, template, rendered, result, _i, channels_1, channel, channelResult, _a, emailResult, _b, _c, _d, smsResult, _e, _f, _g, pushResult, inAppResult, error_1;
            return __generator(this, function (_h) {
                switch (_h.label) {
                    case 0:
                        templateId = payload.templateId, variables = payload.variables, channels = payload.channels, userId = payload.userId, recipient = payload.recipient, priority = payload.priority, scheduledFor = payload.scheduledFor;
                        now = new Date();
                        if (scheduledFor && scheduledFor > now) {
                            // For simplicity, we'll just store and let a cron job handle it later
                            // In a real implementation, we would add to a scheduled jobs queue
                            return [2 /*return*/, {
                                    id: "scheduled_".concat(Date.now(), "_").concat(Math.random().toString(36).substr(2, 9)),
                                    channelResults: {}
                                }];
                        }
                        return [4 /*yield*/, this.preferenceService.getPreferences(userId)];
                    case 1:
                        preferences = _h.sent();
                        template = this.templateService.getTemplate(templateId);
                        if (!template) {
                            throw new Error("Template not found: ".concat(templateId));
                        }
                        rendered = this.templateService.renderTemplate(template, variables);
                        result = {
                            id: "notification_".concat(Date.now(), "_").concat(Math.random().toString(36).substr(2, 9)),
                            channelResults: {}
                        };
                        _i = 0, channels_1 = channels;
                        _h.label = 2;
                    case 2:
                        if (!(_i < channels_1.length)) return [3 /*break*/, 22];
                        channel = channels_1[_i];
                        channelResult = {
                            success: false
                        };
                        _h.label = 3;
                    case 3:
                        _h.trys.push([3, 18, , 20]);
                        // Check if channel is enabled for this user and notification type
                        if (!this.isChannelEnabled(preferences, channel, templateId)) {
                            channelResult.success = false;
                            channelResult.error = "Channel ".concat(channel, " is disabled for this user or notification type");
                            result.channelResults[channel] = channelResult;
                            return [3 /*break*/, 21];
                        }
                        // Check quiet hours
                        if (this.isInQuietHours(preferences)) {
                            channelResult.success = false;
                            channelResult.error = 'Quiet hours are active';
                            result.channelResults[channel] = channelResult;
                            return [3 /*break*/, 21];
                        }
                        _a = channel;
                        switch (_a) {
                            case 'email': return [3 /*break*/, 4];
                            case 'sms': return [3 /*break*/, 8];
                            case 'push': return [3 /*break*/, 12];
                            case 'in-app': return [3 /*break*/, 14];
                        }
                        return [3 /*break*/, 16];
                    case 4:
                        _c = (_b = this.emailChannel).send;
                        _d = recipient;
                        if (_d) return [3 /*break*/, 6];
                        return [4 /*yield*/, this.getUserEmail(userId)];
                    case 5:
                        _d = (_h.sent());
                        _h.label = 6;
                    case 6: return [4 /*yield*/, _c.apply(_b, [_d, rendered.subject,
                            rendered.body,
                            templateId])];
                    case 7:
                        emailResult = _h.sent();
                        channelResult = { success: emailResult.success, messageId: emailResult.messageId, error: emailResult.error };
                        return [3 /*break*/, 16];
                    case 8:
                        _f = (_e = this.smsChannel).send;
                        _g = recipient;
                        if (_g) return [3 /*break*/, 10];
                        return [4 /*yield*/, this.getUserPhone(userId)];
                    case 9:
                        _g = (_h.sent());
                        _h.label = 10;
                    case 10: return [4 /*yield*/, _f.apply(_e, [_g, rendered.body,
                            templateId])];
                    case 11:
                        smsResult = _h.sent();
                        channelResult = { success: smsResult.success, messageId: smsResult.messageId, error: smsResult.error };
                        return [3 /*break*/, 16];
                    case 12: return [4 /*yield*/, this.pushChannel.send(userId, rendered.title || rendered.subject, rendered.body, { templateId: templateId, variables: variables })];
                    case 13:
                        pushResult = _h.sent();
                        channelResult = { success: pushResult.success, messageId: pushResult.messageId, error: pushResult.error };
                        return [3 /*break*/, 16];
                    case 14: return [4 /*yield*/, this.inAppChannel.send(userId, rendered.title || rendered.subject, rendered.body, { templateId: templateId, variables: variables, priority: priority })];
                    case 15:
                        inAppResult = _h.sent();
                        channelResult = { success: inAppResult.success, messageId: inAppResult.messageId, error: inAppResult.error };
                        return [3 /*break*/, 16];
                    case 16: 
                    // Track delivery
                    return [4 /*yield*/, this.deliveryTracker.track({
                            notificationId: result.id,
                            channel: channel,
                            userId: userId,
                            templateId: templateId,
                            status: channelResult.success ? 'sent' : 'failed',
                            messageId: channelResult.messageId,
                            error: channelResult.error
                        })];
                    case 17:
                        // Track delivery
                        _h.sent();
                        return [3 /*break*/, 20];
                    case 18:
                        error_1 = _h.sent();
                        channelResult.success = false;
                        channelResult.error = error_1 instanceof Error ? error_1.message : 'Unknown error';
                        // Track failed delivery
                        return [4 /*yield*/, this.deliveryTracker.track({
                                notificationId: result.id,
                                channel: channel,
                                userId: userId,
                                templateId: templateId,
                                status: 'failed',
                                error: channelResult.error
                            })];
                    case 19:
                        // Track failed delivery
                        _h.sent();
                        return [3 /*break*/, 20];
                    case 20:
                        result.channelResults[channel] = channelResult;
                        _h.label = 21;
                    case 21:
                        _i++;
                        return [3 /*break*/, 2];
                    case 22: return [2 /*return*/, result];
                }
            });
        });
    };
    NotificationService.prototype.isChannelEnabled = function (preferences, channel, templateId) {
        var _a, _b, _c, _d;
        // In a real implementation, we would check per-template or per-category preferences
        // For now, we'll check general channel enablement
        switch (channel) {
            case 'email': return (_a = preferences.emailEnabled) !== null && _a !== void 0 ? _a : true;
            case 'sms': return (_b = preferences.smsEnabled) !== null && _b !== void 0 ? _b : true;
            case 'push': return (_c = preferences.pushEnabled) !== null && _c !== void 0 ? _c : true;
            case 'in-app': return (_d = preferences.inAppEnabled) !== null && _d !== void 0 ? _d : true;
            default: return false;
        }
    };
    NotificationService.prototype.isInQuietHours = function (preferences) {
        var _a, _b;
        if (!preferences.quietHoursEnabled)
            return false;
        var now = new Date();
        var currentHour = now.getHours();
        var currentMinute = now.getMinutes();
        var currentTime = currentHour * 60 + currentMinute;
        var startTime = ((_a = preferences.quietHoursStart) === null || _a === void 0 ? void 0 : _a.split(':').map(Number)) || [0, 0];
        var endTime = ((_b = preferences.quietHoursEnd) === null || _b === void 0 ? void 0 : _b.split(':').map(Number)) || [0, 0];
        var startMinutes = startTime[0] * 60 + startTime[1];
        var endMinutes = endTime[0] * 60 + endTime[1];
        // Handle overnight quiet hours (e.g., 22:00 to 06:00)
        if (startMinutes > endMinutes) {
            return currentTime >= startMinutes || currentTime <= endMinutes;
        }
        else {
            return currentTime >= startMinutes && currentTime <= endMinutes;
        }
    };
    NotificationService.prototype.getUserEmail = function (userId) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                // In a real implementation, this would fetch from user database
                // For now, return a placeholder
                return [2 /*return*/, "user".concat(userId, "@example.com")];
            });
        });
    };
    NotificationService.prototype.getUserPhone = function (userId) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                // In a real implementation, this would fetch from user database
                // For now, return a placeholder
                return [2 /*return*/, "+1555".concat(userId.padStart(7, '0'))];
            });
        });
    };
    return NotificationService;
}());
exports.NotificationService = NotificationService;
