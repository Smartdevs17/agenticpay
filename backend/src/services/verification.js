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
exports.verifyWork = verifyWork;
exports.storeVerification = storeVerification;
exports.getVerification = getVerification;
exports.updateVerification = updateVerification;
exports.deleteVerification = deleteVerification;
var openai_1 = require("openai");
var env_js_1 = require("../config/env.js");
var openaiClient = null;
var getOpenAIClient = function () {
    var apiKey = (0, env_js_1.config)().OPENAI_API_KEY;
    if (!openaiClient) {
        openaiClient = new openai_1.default({ apiKey: apiKey });
    }
    return openaiClient;
};
// In-memory store (replace with DB in production)
var verifications = new Map();
function verifyWork(request) {
    return __awaiter(this, void 0, void 0, function () {
        var id, completion, assessment, result;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    id = "ver_".concat(Date.now(), "_").concat(Math.random().toString(36).slice(2, 8));
                    return [4 /*yield*/, getOpenAIClient().chat.completions.create({
                            model: 'gpt-4o-mini',
                            messages: [
                                {
                                    role: 'system',
                                    content: 'You are a code reviewer. Given a milestone description and repository URL, assess whether the work likely meets the requirements. Respond with a JSON object containing: score (0-100), summary (one sentence), details (array of specific observations).',
                                },
                                {
                                    role: 'user',
                                    content: "Repository: ".concat(request.repositoryUrl, "\nMilestone: ").concat(request.milestoneDescription),
                                },
                            ],
                            response_format: { type: 'json_object' },
                        })];
                case 1:
                    completion = _a.sent();
                    assessment = JSON.parse(completion.choices[0].message.content || '{}');
                    result = {
                        id: id,
                        projectId: request.projectId,
                        status: (assessment.score || 0) >= 70 ? 'passed' : 'failed',
                        score: assessment.score || 0,
                        summary: assessment.summary || 'Verification completed',
                        details: assessment.details || [],
                        verifiedAt: new Date().toISOString(),
                    };
                    storeVerification(result);
                    return [2 /*return*/, result];
            }
        });
    });
}
function storeVerification(result) {
    verifications.set(result.id, result);
}
function getVerification(id) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, verifications.get(id)];
        });
    });
}
function updateVerification(update) {
    var _a, _b, _c, _d;
    var current = verifications.get(update.id);
    if (!current) {
        return undefined;
    }
    var updated = __assign(__assign({}, current), { status: (_a = update.status) !== null && _a !== void 0 ? _a : current.status, score: (_b = update.score) !== null && _b !== void 0 ? _b : current.score, summary: (_c = update.summary) !== null && _c !== void 0 ? _c : current.summary, details: (_d = update.details) !== null && _d !== void 0 ? _d : current.details, verifiedAt: new Date().toISOString() });
    verifications.set(update.id, updated);
    return updated;
}
function deleteVerification(id) {
    return verifications.delete(id);
}
