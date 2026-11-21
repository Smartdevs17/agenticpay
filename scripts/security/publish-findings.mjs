#!/usr/bin/env node
/**
 * publish-findings.mjs
 *
 * Pushes CI security-scan findings (npm audit, Slither, cargo-audit) into
 * the backend's remediation-tracking API (`/api/v1/security/scans`), so
 * scan results show up in the security dashboard instead of only living in
 * GitHub Actions artifacts/SARIF.
 *
 * Reads report files from SECURITY_REPORT_DIR (default: security-reports)
 * and POSTs to SECURITY_API_URL (default: no-op if unset — CI without a
 * deployed backend to report to shouldn't fail the pipeline).
 *
 * Usage: node scripts/security/publish-findings.mjs <scanType>
 *   <scanType> is one of: sast | dependency | dast | smart_contract
 */

import fs from 'node:fs';
import path from 'node:path';

const scanType = process.argv[2];
const VALID_SCAN_TYPES = ['sast', 'dependency', 'dast', 'smart_contract'];
if (!VALID_SCAN_TYPES.includes(scanType)) {
  console.error(`Usage: publish-findings.mjs <${VALID_SCAN_TYPES.join('|')}>`);
  process.exit(1);
}

const reportDir = process.env.SECURITY_REPORT_DIR ?? 'security-reports';
const apiBase = process.env.SECURITY_API_URL;
const apiToken = process.env.SECURITY_API_TOKEN;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function normalizeNpmAuditSeverity(sev) {
  const s = String(sev ?? '').toLowerCase();
  if (s === 'moderate') return 'medium';
  if (['critical', 'high', 'medium', 'low', 'info'].includes(s)) return s;
  return 'info';
}

function collectNpmAuditFindings() {
  const findings = [];
  for (const [file, ecosystem] of [
    ['npm-audit-backend.json', 'backend'],
    ['npm-audit-frontend.json', 'frontend'],
  ]) {
    const json = readJson(path.join(reportDir, file));
    if (!json?.vulnerabilities) continue;
    for (const [name, vuln] of Object.entries(json.vulnerabilities)) {
      findings.push({
        title: `${ecosystem}/${name}: ${vuln.severity} dependency vulnerability`,
        description: `npm audit flagged ${name}@${vuln.range ?? 'unknown'} in ${ecosystem}.`,
        severity: normalizeNpmAuditSeverity(vuln.severity),
        location: `${ecosystem}/package.json`,
        packageName: name,
        packageVersion: vuln.range,
        fixedInVersion: vuln.fixAvailable?.version,
        remediation: vuln.fixAvailable
          ? `Run npm audit fix in ${ecosystem}/ or update to ${vuln.fixAvailable.name}@${vuln.fixAvailable.version ?? 'latest'}.`
          : 'Review the advisory and patch the transitive dependency manually.',
      });
    }
  }
  return findings;
}

function collectCargoAuditFindings(file) {
  const json = readJson(path.join(reportDir, file));
  const findings = [];
  for (const vuln of json?.vulnerabilities?.list ?? []) {
    findings.push({
      title: vuln.advisory?.title ?? `${vuln.package?.name}: cargo advisory`,
      description: vuln.advisory?.description ?? 'cargo-audit flagged a Rust dependency vulnerability.',
      severity: 'high',
      location: 'contracts/Cargo.toml',
      cveId: vuln.advisory?.id,
      packageName: vuln.package?.name,
      packageVersion: vuln.package?.version,
      fixedInVersion: vuln.versions?.patched?.join(', '),
      remediation: 'Upgrade to a patched crate version listed in the advisory.',
    });
  }
  return findings;
}

function collectSlitherFindings() {
  const json =
    readJson(path.join(reportDir, 'slither.json')) ??
    readJson(path.join(reportDir, 'slither-report.json'));
  const findings = [];
  const impactToSeverity = { High: 'high', Medium: 'medium', Low: 'low', Informational: 'info' };
  for (const detector of json?.results?.detectors ?? []) {
    findings.push({
      title: detector.check ?? 'Slither finding',
      description: (detector.description ?? '').split('\n')[0] || 'Slither static analysis finding.',
      severity: impactToSeverity[detector.impact] ?? 'medium',
      location: detector.elements?.[0]?.source_mapping?.filename_relative ?? 'contracts/',
      lineNumber: detector.elements?.[0]?.source_mapping?.lines?.[0],
      remediation: 'Review the Slither detector output and apply the recommended fix.',
    });
  }
  return findings;
}

function collectMythrilFindings() {
  const findings = [];
  if (!fs.existsSync(reportDir)) return findings;
  const severityMap = { High: 'high', Medium: 'medium', Low: 'low' };
  for (const file of fs.readdirSync(reportDir)) {
    if (!file.startsWith('mythril-') || !file.endsWith('.json')) continue;
    const contractName = file.slice('mythril-'.length, -'.json'.length);
    const json = readJson(path.join(reportDir, file));
    for (const issue of json?.issues ?? []) {
      findings.push({
        title: issue.title ?? `${contractName}: Mythril finding`,
        description: issue.description ?? 'Mythril symbolic execution finding.',
        severity: severityMap[issue.severity] ?? 'medium',
        location: `contracts/src/${contractName}.sol`,
        lineNumber: issue.lineno,
        cveId: issue.swc_id ? `SWC-${issue.swc_id}` : undefined,
        remediation: 'Review the Mythril issue and apply the recommended mitigation for this SWC category.',
      });
    }
  }
  return findings;
}

function collectFindings() {
  switch (scanType) {
    case 'dependency':
      return [
        ...collectNpmAuditFindings(),
        ...collectCargoAuditFindings('cargo-audit.json'),
      ];
    case 'smart_contract':
      return [
        ...collectSlitherFindings(),
        ...collectCargoAuditFindings('cargo-soroban-audit.json'),
        ...collectMythrilFindings(),
      ];
    case 'sast':
    case 'dast':
    default:
      // ESLint/Semgrep/ZAP findings are already tracked via SARIF/GitHub code
      // scanning; nothing additional to push into the remediation tracker yet.
      return [];
  }
}

async function main() {
  const findings = collectFindings();
  console.log(`[publish-findings] ${scanType}: ${findings.length} finding(s) collected from ${reportDir}`);

  if (!apiBase) {
    console.log('[publish-findings] SECURITY_API_URL not set — skipping publish (reports still uploaded as CI artifacts).');
    return;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (apiToken) headers.Authorization = `Bearer ${apiToken}`;

  const startRes = await fetch(`${apiBase}/security/scans`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ scanType, triggeredBy: 'ci' }),
  });
  if (!startRes.ok) {
    console.error(`[publish-findings] Failed to start scan: ${startRes.status} ${await startRes.text()}`);
    return;
  }
  const { data: scan } = await startRes.json();

  const completeRes = await fetch(`${apiBase}/security/scans/${scan.id}/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ findings }),
  });
  if (!completeRes.ok) {
    console.error(`[publish-findings] Failed to complete scan: ${completeRes.status} ${await completeRes.text()}`);
    return;
  }

  console.log(`[publish-findings] Published scan ${scan.id} (${scanType}) with ${findings.length} finding(s).`);
}

main().catch((err) => {
  console.error('[publish-findings] Unexpected error:', err);
  // Never fail the pipeline because reporting to the dashboard failed.
});
