"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.versionMiddleware = void 0;
var versionMiddleware = function (req, res, next) {
    var headerVersion = req.headers['api-version'] || req.headers['x-api-version'] || req.headers['accept-version'];
    var version = 'v1';
    if (headerVersion) {
        version = "v".concat(headerVersion.toString().replace(/^v/i, ''));
    }
    else {
        var match = req.originalUrl.match(/^\/api\/(v\d+)\//);
        if (match) {
            version = match[1];
        }
    }
    req.apiVersion = version;
    res.setHeader('X-API-Version', version);
    next();
};
exports.versionMiddleware = versionMiddleware;
