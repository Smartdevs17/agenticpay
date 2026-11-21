"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobsRouter = void 0;
var express_1 = require("express");
var index_js_1 = require("../jobs/index.js");
exports.jobsRouter = (0, express_1.Router)();
exports.jobsRouter.get('/', function (_req, res) {
    var _a;
    var scheduler = (0, index_js_1.getJobScheduler)();
    var statuses = (_a = scheduler === null || scheduler === void 0 ? void 0 : scheduler.getStatuses()) !== null && _a !== void 0 ? _a : [];
    res.json({ jobs: statuses });
});
