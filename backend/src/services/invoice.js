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
exports.generateInvoice = generateInvoice;
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
function generateInvoice(request) {
    return __awaiter(this, void 0, void 0, function () {
        var id, completion, generated, lineItems, subtotal;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    id = "inv_".concat(Date.now(), "_").concat(Math.random().toString(36).slice(2, 8));
                    return [4 /*yield*/, getOpenAIClient().chat.completions.create({
                            model: 'gpt-4o-mini',
                            messages: [
                                {
                                    role: 'system',
                                    content: 'You are an invoice generator. Given a work description, hours, and rate, generate professional line items. Respond with JSON containing: lineItems (array of {description, hours, rate, amount}), summary (brief invoice summary).',
                                },
                                {
                                    role: 'user',
                                    content: "Work: ".concat(request.workDescription, "\nHours: ").concat(request.hoursWorked, "\nRate: $").concat(request.hourlyRate, "/hr"),
                                },
                            ],
                            response_format: { type: 'json_object' },
                        })];
                case 1:
                    completion = _a.sent();
                    generated = JSON.parse(completion.choices[0].message.content || '{}');
                    lineItems = generated.lineItems || [
                        {
                            description: request.workDescription,
                            hours: request.hoursWorked,
                            rate: request.hourlyRate,
                            amount: request.hoursWorked * request.hourlyRate,
                        },
                    ];
                    subtotal = lineItems.reduce(function (sum, item) { return sum + item.amount; }, 0);
                    return [2 /*return*/, {
                            id: id,
                            projectId: request.projectId,
                            lineItems: lineItems,
                            subtotal: subtotal,
                            total: subtotal,
                            currency: 'XLM',
                            generatedAt: new Date().toISOString(),
                            summary: generated.summary || 'Invoice generated for completed work',
                        }];
            }
        });
    });
}
