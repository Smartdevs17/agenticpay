"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUEST_ID_HEADER = void 0;
exports.requestIdMiddleware = requestIdMiddleware;
var node_crypto_1 = require("node:crypto");
exports.REQUEST_ID_HEADER = 'x-request-id';
function requestIdMiddleware(req, res, next) {
    var requestId = req.headers[exports.REQUEST_ID_HEADER] || (0, node_crypto_1.randomUUID)();
    req.requestId = requestId;
    res.setHeader(exports.REQUEST_ID_HEADER, requestId);
    next();
}
