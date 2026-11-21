"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateVapidKeys = generateVapidKeys;
exports.urlBase64Decode = urlBase64Decode;
exports.signPayload = signPayload;
function generateVapidKeys() {
    var curve = 'prime256v1';
    var ecdh = require('crypto').ECDH(curve);
    ecdh.generateKeys();
    var publicKey = ecdh.getPublicKey('base64');
    var privateKey = ecdh.getPrivateKey('base64');
    var formattedPublicKey = urlBase64Encode(publicKey);
    var formattedPrivateKey = urlBase64Encode(privateKey);
    return {
        publicKey: formattedPublicKey,
        privateKey: formattedPrivateKey,
    };
}
function urlBase64Encode(buffer) {
    return buffer
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}
function urlBase64Decode(base64) {
    var base64Url = base64.replace(/-/g, '+').replace(/_/g, '/');
    while (base64Url.length % 4) {
        base64Url += '=';
    }
    return Buffer.from(base64Url, 'base64');
}
function signPayload(payload, privateKey) {
    var crypto = require('crypto');
    var privateKeyBuffer = urlBase64Decode(privateKey);
    var sign = crypto.createSign('ES256');
    sign.update(payload);
    var signature = sign.sign(privateKeyBuffer);
    return urlBase64Encode(signature);
}
