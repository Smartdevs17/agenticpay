import { constants, publicEncrypt, randomBytes, createCipheriv } from 'node:crypto';

export interface EncryptedWebhookPayload {
  encrypted: true;
  alg: 'RSA-OAEP-256+A256GCM';
  encryptedKey: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export function encryptWebhookPayload(payload: string, merchantPublicKeyPem?: string): string {
  if (!merchantPublicKeyPem) return payload;

  const contentKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', contentKey, iv);
  const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const encryptedKey = publicEncrypt(
    {
      key: merchantPublicKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    contentKey
  );

  const envelope: EncryptedWebhookPayload = {
    encrypted: true,
    alg: 'RSA-OAEP-256+A256GCM',
    encryptedKey: encryptedKey.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };

  return JSON.stringify(envelope);
}
