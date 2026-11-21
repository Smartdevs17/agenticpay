import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * A single proxy-implementation pairing, recorded at deploy / upgrade time
 * so we can roll back, audit, or re-verify without having to re-derive the
 * history from on-chain events.
 */
export interface DeploymentRecord {
  /** ISO-8601 timestamp, UTC. */
  timestamp: string;
  /** Action that produced this record. */
  action: 'deploy' | 'upgrade' | 'rollback';
  /** Human-readable version emitted by the implementation. */
  version: string;
  /** Upgrade-proxy address (stable for the proxy's lifetime). */
  proxy: string;
  /** Implementation contract address the proxy points at *after* this action. */
  implementation: string;
  /** Deployer / proposer EOA that submitted the transaction. */
  deployer: string;
  /** On-chain transaction hash. Absent for Safe proposals not yet executed. */
  transactionHash?: string;
  /** Contract-source identifier (e.g. "SplitterV2"). */
  contract: string;
  /** Chain ID for cross-reference against hardhat network configs. */
  chainId: number;
  /** Free-form notes (audit link, PR number, commit SHA, etc). */
  notes?: string;
}

/**
 * Persistent-state wrapper around `deployments/<network>.json`. Each file
 * holds the full history for a single logical deployment on a single
 * network, which keeps rollback / list operations deterministic and
 * reviewable via git diff.
 */
export interface DeploymentFile {
  network: string;
  chainId: number;
  contract: string;
  proxy: string;
  currentImplementation: string;
  currentVersion: string;
  history: DeploymentRecord[];
}

const DEFAULT_ROOT = path.resolve(__dirname, '..', '..', 'deployments');

export function deploymentsRoot(): string {
  return process.env.AGENTICPAY_DEPLOYMENTS_DIR
    ? path.resolve(process.env.AGENTICPAY_DEPLOYMENTS_DIR)
    : DEFAULT_ROOT;
}

export function deploymentFilePath(network: string): string {
  return path.join(deploymentsRoot(), `${network}.json`);
}

export function readDeployment(network: string): DeploymentFile | null {
  const file = deploymentFilePath(network);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf-8');
  return JSON.parse(raw) as DeploymentFile;
}

export function writeDeployment(deployment: DeploymentFile): string {
  const root = deploymentsRoot();
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  const file = deploymentFilePath(deployment.network);
  fs.writeFileSync(file, `${JSON.stringify(deployment, null, 2)}\n`, 'utf-8');
  return file;
}

/**
 * Append a history entry and set it as the current pointer. Returns the
 * updated file contents so callers can log them.
 */
export function appendRecord(
  existing: DeploymentFile | null,
  record: DeploymentRecord,
  meta: { network: string; contract: string },
): DeploymentFile {
  const next: DeploymentFile = existing ?? {
    network: meta.network,
    chainId: record.chainId,
    contract: meta.contract,
    proxy: record.proxy,
    currentImplementation: record.implementation,
    currentVersion: record.version,
    history: [],
  };

  next.proxy = record.proxy;
  next.currentImplementation = record.implementation;
  next.currentVersion = record.version;
  next.contract = meta.contract;
  next.chainId = record.chainId;
  next.history.push(record);

  return next;
}

/**
 * Latest record of a given action, or undefined when there is none. Used
 * by rollback to find the previous implementation.
 */
export function latestRecord(
  deployment: DeploymentFile,
  action?: DeploymentRecord['action'],
): DeploymentRecord | undefined {
  if (!action) return deployment.history.at(-1);
  return [...deployment.history].reverse().find((r) => r.action === action);
}

export function listDeployments(): DeploymentFile[] {
  const root = deploymentsRoot();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf-8')) as DeploymentFile);
}
