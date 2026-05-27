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
exports.pushRouter = void 0;
var express_1 = require("express");
var push_js_1 = require("../services/push.js");
exports.pushRouter = (0, express_1.Router)();
exports.pushRouter.post('/subscribe', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, subscription, userId, result, error_1;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 2, , 3]);
                _a = req.body, subscription = _a.subscription, userId = _a.userId;
                if (!subscription || !subscription.endpoint) {
                    return [2 /*return*/, res.status(400).json({
                            error: {
                                code: 'INVALID_SUBSCRIPTION',
                                message: 'Push subscription is required',
                                status: 400,
                            },
                        })];
                }
                return [4 /*yield*/, push_js_1.pushService.subscribe(userId, subscription)];
            case 1:
                result = _b.sent();
                res.status(201).json(result);
                return [3 /*break*/, 3];
            case 2:
                error_1 = _b.sent();
                console.error('Push subscription error:', error_1);
                res.status(500).json({
                    error: {
                        code: 'SUBSCRIPTION_FAILED',
                        message: 'Failed to subscribe to push notifications',
                        status: 500,
                    },
                });
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); });
exports.pushRouter.delete('/unsubscribe', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, endpoint, userId, error_2;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 2, , 3]);
                _a = req.body, endpoint = _a.endpoint, userId = _a.userId;
                if (!endpoint) {
                    return [2 /*return*/, res.status(400).json({
                            error: {
                                code: 'INVALID_REQUEST',
                                message: 'Endpoint is required',
                                status: 400,
                            },
                        })];
                }
                return [4 /*yield*/, push_js_1.pushService.unsubscribe(userId, endpoint)];
            case 1:
                _b.sent();
                res.status(204).send();
                return [3 /*break*/, 3];
            case 2:
                error_2 = _b.sent();
                console.error('Push unsubscription error:', error_2);
                res.status(500).json({
                    error: {
                        code: 'UNSUBSCRIPTION_FAILED',
                        message: 'Failed to unsubscribe from push notifications',
                        status: 500,
                    },
                });
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); });
exports.pushRouter.post('/notify', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, userId, title, body, icon, badge, data, actions, result, error_3;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 2, , 3]);
                _a = req.body, userId = _a.userId, title = _a.title, body = _a.body, icon = _a.icon, badge = _a.badge, data = _a.data, actions = _a.actions;
                if (!userId || !title) {
                    return [2 /*return*/, res.status(400).json({
                            error: {
                                code: 'INVALID_REQUEST',
                                message: 'userId and title are required',
                                status: 400,
                            },
                        })];
                }
                return [4 /*yield*/, push_js_1.pushService.sendNotification({
                        userId: userId,
                        title: title,
                        body: body,
                        icon: icon,
                        badge: badge,
                        data: data,
                        actions: actions,
                    })];
            case 1:
                result = _b.sent();
                res.status(200).json(result);
                return [3 /*break*/, 3];
            case 2:
                error_3 = _b.sent();
                console.error('Push notification error:', error_3);
                res.status(500).json({
                    error: {
                        code: 'NOTIFICATION_FAILED',
                        message: 'Failed to send push notification',
                        status: 500,
                    },
                });
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); });
exports.pushRouter.get('/vapid-public-key', function (req, res) {
    var publicKey = push_js_1.pushService.getVapidPublicKey();
    res.status(200).json({ publicKey: publicKey });
});
exports.pushRouter.get('/preferences/:userId', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var userId, preferences, error_4;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                userId = req.params.userId;
                return [4 /*yield*/, push_js_1.pushService.getPreferences(userId)];
            case 1:
                preferences = _a.sent();
                res.status(200).json(preferences);
                return [3 /*break*/, 3];
            case 2:
                error_4 = _a.sent();
                console.error('Get preferences error:', error_4);
                res.status(500).json({
                    error: {
                        code: 'FETCH_FAILED',
                        message: 'Failed to fetch notification preferences',
                        status: 500,
                    },
                });
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); });
exports.pushRouter.put('/preferences/:userId', function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var userId, preferences, result, error_5;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                userId = req.params.userId;
                preferences = req.body;
                return [4 /*yield*/, push_js_1.pushService.updatePreferences(userId, preferences)];
            case 1:
                result = _a.sent();
                res.status(200).json(result);
                return [3 /*break*/, 3];
            case 2:
                error_5 = _a.sent();
                console.error('Update preferences error:', error_5);
                res.status(500).json({
                    error: {
                        code: 'UPDATE_FAILED',
                        message: 'Failed to update notification preferences',
                        status: 500,
                    },
                });
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); });
