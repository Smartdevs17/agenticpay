const fs = require('fs');
const path = require('path');

const dirs = [
  'packages/types/src',
  'packages/utils/src',
  'packages/contracts/src',
  'packages/eslint-config',
  'packages/typescript-config'
];

dirs.forEach(d => fs.mkdirSync(d, { recursive: true }));

fs.writeFileSync('turbo.json', JSON.stringify({
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": []
    },
    "lint": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}, null, 2));

fs.writeFileSync('package.json', JSON.stringify({
  "name": "agenticpay",
  "private": true,
  "workspaces": [
    "frontend",
    "backend",
    "packages/*",
    "workers"
  ],
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "dev": "turbo run dev"
  },
  "devDependencies": {
    "turbo": "^1.10.16"
  }
}, null, 2));

const packages = ['types', 'utils', 'contracts'];
packages.forEach(pkg => {
  fs.writeFileSync(`packages/${pkg}/package.json`, JSON.stringify({
    "name": `@agenticpay/${pkg}`,
    "version": "0.1.0",
    "main": "dist/index.js",
    "types": "dist/index.d.ts",
    "scripts": {
      "build": "tsc",
      "lint": "eslint src/"
    },
    "dependencies": {},
    "devDependencies": {
      "@agenticpay/typescript-config": "*",
      "@agenticpay/eslint-config": "*",
      "typescript": "^5.6.0"
    }
  }, null, 2));
  fs.writeFileSync(`packages/${pkg}/tsconfig.json`, JSON.stringify({
    "extends": "@agenticpay/typescript-config/base.json",
    "compilerOptions": {
      "outDir": "dist",
      "rootDir": "src"
    },
    "include": ["src"]
  }, null, 2));
  fs.writeFileSync(`packages/${pkg}/src/index.ts`, `export * from './exports.js';\n`);
  fs.writeFileSync(`packages/${pkg}/src/exports.ts`, `export const ${pkg} = '${pkg}';\n`);
});

// typescript-config
fs.writeFileSync(`packages/typescript-config/package.json`, JSON.stringify({
  "name": "@agenticpay/typescript-config",
  "version": "0.1.0",
  "private": true
}, null, 2));
fs.writeFileSync(`packages/typescript-config/base.json`, JSON.stringify({
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true
  }
}, null, 2));

// eslint-config
fs.writeFileSync(`packages/eslint-config/package.json`, JSON.stringify({
  "name": "@agenticpay/eslint-config",
  "version": "0.1.0",
  "private": true
}, null, 2));
fs.writeFileSync(`packages/eslint-config/index.js`, `module.exports = {};\n`);
