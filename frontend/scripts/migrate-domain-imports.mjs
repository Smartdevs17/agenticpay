import { readFileSync, writeFileSync } from 'node:fs';

const replacements = new Map([
  ['@/components/payment/', '@payments/components/'],
  ['@/lib/hooks/useDashboardData', '@analytics/hooks'],
  ['@/lib/hooks/useWeb3', '@wallets/hooks'],
  ['@/lib/hooks/useAgenticPay', '@wallets/hooks'],
]);

const files = process.argv.slice(2);
for (const file of files) {
  let source = readFileSync(file, 'utf8');
  for (const [from, to] of replacements) {
    source = source.split(from).join(to);
  }
  writeFileSync(file, source);
}
