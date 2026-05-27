"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.legacyRouter = void 0;
var express_1 = require("express");
var deprecation_js_1 = require("../middleware/deprecation.js");
exports.legacyRouter = (0, express_1.Router)();
/**
 * @openapi
 * /api/v1/legacy-data:
 *   get:
 *     summary: Get legacy data (Deprecated)
 *     responses:
 *       200:
 *         description: Returns legacy data with deprecation headers
 */
exports.legacyRouter.get('/legacy-data', (0, deprecation_js_1.deprecationMiddleware)({
    deprecationDate: '2023-10-01',
    sunsetDate: '2024-12-31',
    alternativeUrl: 'https://agenticpay.io/docs/api/v2/data'
}), function (req, res) {
    res.json({
        message: 'This is legacy data. Please migrate to the new API.',
        data: [1, 2, 3, 4, 5]
    });
});
