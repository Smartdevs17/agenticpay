import { readFileSync } from 'fs';
import { join } from 'path';

let cachedVersion = 'unknown';

try {
  // Use process.cwd() as we can safely assume this runs from backend/ directory
  const pkgPath = join(process.cwd(), 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  cachedVersion = pkg.version || '0.1.0';
} catch {
  console.warn('Could not read package.json version, defaulting to 0.1.0');
  cachedVersion = '0.1.0';
}

export function getCatalog() {
  return {
    version: cachedVersion,
    services: [
      {
        id: 'verification',
        name: 'AI-powered work verification',
        capabilities: ['Verify work based on milestone descriptions and repository URLs'],
        dependencies: ['OpenAI API'],
      },
      {
        id: 'invoice',
        name: 'Invoice Generation',
        capabilities: ['Generate professional invoices with itemized line items and summaries based on hours and rates'],
        dependencies: ['OpenAI API'],
      },
      {
        id: 'stellar',
        name: 'Stellar Network Operations',
        capabilities: ['Retrieve account info (balances, sequence)', 'Get transaction status via hash'],
        dependencies: ['Stellar SDK', 'Stellar Horizon'],
      }
    ]
  };
}
