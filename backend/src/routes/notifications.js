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
exports.notificationsRouter = void 0;
var express_1 = require("express");
var errorHandler_js_1 = require("../middleware/errorHandler.js");
var notificationService_js_1 = require("../services/notificationService.js");
exports.notificationsRouter = (0, express_1.Router)();
// Initialize notification service
var notificationService = new notificationService_js_1.NotificationService();
// Send notification endpoint
exports.notificationsRouter.post('/send', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, templateId, variables, channels, userId, recipient, priority, scheduledFor, payload, result;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _a = req.body, templateId = _a.templateId, variables = _a.variables, channels = _a.channels, userId = _a.userId, recipient = _a.recipient, priority = _a.priority, scheduledFor = _a.scheduledFor;
                if (!templateId || !userId) {
                    res.status(400).json({ error: 'Missing templateId or userId' });
                    return [2 /*return*/];
                }
                payload = {
                    templateId: templateId,
                    variables: variables || {},
                    channels: channels || ['email', 'push', 'in-app'],
                    userId: userId,
                    recipient: recipient,
                    priority: priority,
                    scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined
                };
                return [4 /*yield*/, notificationService.sendNotification(payload)];
            case 1:
                result = _b.sent();
                res.status(200).json(result);
                return [2 /*return*/];
        }
    });
}); }));
// Get notification preferences
exports.notificationsRouter.get('/preferences/:userId', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var userId, NotificationPreferenceService, preferenceService, preferences;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                userId = req.params.userId;
                NotificationPreferenceService = require('../services/notifications/preferenceService.js').NotificationPreferenceService;
                preferenceService = new NotificationPreferenceService();
                return [4 /*yield*/, preferenceService.getPreferences(userId)];
            case 1:
                preferences = _a.sent();
                res.status(200).json(preferences);
                return [2 /*return*/];
        }
    });
}); }));
// Update notification preferences
exports.notificationsRouter.put('/preferences/:userId', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var userId, NotificationPreferenceService, preferenceService, preferences;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                userId = req.params.userId;
                NotificationPreferenceService = require('../services/notifications/preferenceService.js').NotificationPreferenceService;
                preferenceService = new NotificationPreferenceService();
                return [4 /*yield*/, preferenceService.updatePreferences(userId, req.body)];
            case 1:
                preferences = _a.sent();
                res.status(200).json(preferences);
                return [2 /*return*/];
        }
    });
}); }));
// Get notification templates
exports.notificationsRouter.get('/templates', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var NotificationTemplateService, templateService, templates;
    return __generator(this, function (_a) {
        NotificationTemplateService = require('../services/notifications/templateService.js').NotificationTemplateService;
        templateService = new NotificationTemplateService();
        templates = templateService.getAllTemplates();
        res.status(200).json({ templates: templates });
        return [2 /*return*/];
    });
}); }));
// Get specific notification template
exports.notificationsRouter.get('/templates/:id', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var id, NotificationTemplateService, templateService, template;
    return __generator(this, function (_a) {
        id = req.params.id;
        NotificationTemplateService = require('../services/notifications/templateService.js').NotificationTemplateService;
        templateService = new NotificationTemplateService();
        template = templateService.getTemplate(id);
        if (!template) {
            res.status(404).json({ error: 'Template not found' });
            return [2 /*return*/];
        }
        res.status(200).json(template);
        return [2 /*return*/];
    });
}); }));
// Create/update notification template
exports.notificationsRouter.post('/templates', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var NotificationTemplateService, templateService, template;
    return __generator(this, function (_a) {
        NotificationTemplateService = require('../services/notifications/templateService.js').NotificationTemplateService;
        templateService = new NotificationTemplateService();
        template = req.body;
        if (!template.id || !template.name || !template.subject || !template.body) {
            res.status(400).json({ error: 'Missing required fields' });
            return [2 /*return*/];
        }
        templateService.addTemplate(template);
        res.status(201).json(template);
        return [2 /*return*/];
    });
}); }));
// Get delivery status
exports.notificationsRouter.get('/delivery/:id', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var id, DeliveryTracker, deliveryTracker, delivery;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                id = req.params.id;
                DeliveryTracker = require('../services/notifications/deliveryTracker.js').DeliveryTracker;
                deliveryTracker = new DeliveryTracker();
                return [4 /*yield*/, deliveryTracker.getDelivery(id)];
            case 1:
                delivery = _a.sent();
                if (!delivery) {
                    res.status(404).json({ error: 'Delivery record not found' });
                    return [2 /*return*/];
                }
                res.status(200).json(delivery);
                return [2 /*return*/];
        }
    });
}); }));
// Get deliveries for a notification
exports.notificationsRouter.get('/delivery/notification/:notificationId', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var notificationId, DeliveryTracker, deliveryTracker, deliveries;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                notificationId = req.params.notificationId;
                DeliveryTracker = require('../services/notifications/deliveryTracker.js').DeliveryTracker;
                deliveryTracker = new DeliveryTracker();
                return [4 /*yield*/, deliveryTracker.getDeliveriesForNotification(notificationId)];
            case 1:
                deliveries = _a.sent();
                res.status(200).json({ deliveries: deliveries });
                return [2 /*return*/];
        }
    });
}); }));
// Get deliveries for a user
exports.notificationsRouter.get('/delivery/user/:userId', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var userId, _a, _b, limit, _c, offset, DeliveryTracker, deliveryTracker, deliveries;
    return __generator(this, function (_d) {
        switch (_d.label) {
            case 0:
                userId = req.params.userId;
                _a = req.query, _b = _a.limit, limit = _b === void 0 ? 50 : _b, _c = _a.offset, offset = _c === void 0 ? 0 : _c;
                DeliveryTracker = require('../services/notifications/deliveryTracker.js').DeliveryTracker;
                deliveryTracker = new DeliveryTracker();
                return [4 /*yield*/, deliveryTracker.getDeliveriesForUser(userId, parseInt(limit), parseInt(offset))];
            case 1:
                deliveries = _d.sent();
                res.status(200).json({ deliveries: deliveries });
                return [2 /*return*/];
        }
    });
}); }));
// Retry failed deliveries
exports.notificationsRouter.post('/retry', (0, errorHandler_js_1.asyncHandler)(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var DeliveryTracker, deliveryTracker, failedDeliveries;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                DeliveryTracker = require('../services/notifications/deliveryTracker.js').DeliveryTracker;
                deliveryTracker = new DeliveryTracker();
                return [4 /*yield*/, deliveryTracker.getFailedDeliveriesForRetry()];
            case 1:
                failedDeliveries = _a.sent();
                // In a real implementation, we would actually retry sending these
                // For now, we'll just return the list
                res.status(200).json({
                    message: "Found ".concat(failedDeliveries.length, " failed deliveries ready for retry"),
                    deliveries: failedDeliveries
                });
                return [2 /*return*/];
        }
    });
}); }));
