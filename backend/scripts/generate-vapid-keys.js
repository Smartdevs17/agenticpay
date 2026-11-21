#!/usr/bin/env node

/**
 * Script to generate VAPID keys for Web Push API
 * Usage: node scripts/generate-vapid-keys.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function urlBase64Encode(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateVapidKeys() {
  const curve = crypto.createECDH('prime256v1');
  curve.generateKeys();

  const publicKey = urlBase64Encode(curve.getPublicKey());
  const privateKey = urlBase64Encode(curve.getPrivateKey());

  return { publicKey, privateKey };
}

try {
  console.log('🔑 Generating VAPID keys for Web Push API...\n');

  const keys = generateVapidKeys();

  console.log('✅ VAPID keys generated successfully!\n');
  console.log('📋 Add the following to your .env file:\n');
  console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}\n`);

  console.log('⚠️  Important Security Notes:');
  console.log('   - Keep your VAPID_PRIVATE_KEY secret');
  console.log('   - Never commit .env to version control');
  console.log('   - Store keys in secure environment variables\n');

  // Optionally create or update .env.local
  const envPath = path.join(__dirname, '..', '.env');
  if (process.argv.includes('--update-env') && !fs.existsSync(envPath)) {
    const envContent = `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`;
    fs.writeFileSync(envPath, envContent);
    console.log(`✅ Created ${envPath} with VAPID keys`);
  }
} catch (error) {
  console.error('❌ Error generating VAPID keys:', error.message);
  process.exit(1);
}
