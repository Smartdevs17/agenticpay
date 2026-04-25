import { createHash, randomBytes } from 'crypto';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export function generateVapidKeys(): VapidKeys {
  const curve = 'prime256v1';
  const ecdh = require('crypto').ECDH(curve);
  ecdh.generateKeys();
  
  const publicKey = ecdh.getPublicKey('base64');
  const privateKey = ecdh.getPrivateKey('base64');
  
  const formattedPublicKey = urlBase64Encode(publicKey);
  const formattedPrivateKey = urlBase64Encode(privateKey);

  return {
    publicKey: formattedPublicKey,
    privateKey: formattedPrivateKey,
  };
}

function urlBase64Encode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function urlBase64Decode(base64: string): Buffer {
  let base64Url = base64.replace(/-/g, '+').replace(/_/g, '/');
  while (base64Url.length % 4) {
    base64Url += '=';
  }
  return Buffer.from(base64Url, 'base64');
}

export function signPayload(
  payload: string,
  privateKey: string
): string {
  const crypto = require('crypto');
  const privateKeyBuffer = urlBase64Decode(privateKey);
  
  const sign = crypto.createSign('ES256');
  sign.update(payload);
  
  const signature = sign.sign(privateKeyBuffer);
  return urlBase64Encode(signature);
}