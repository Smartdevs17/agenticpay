import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

export interface AuditAnchorRecord {
  id: string;
  latestHash: string;
  chain: 'ethereum' | 'stellar' | 'local';
  transactionHash?: string;
  blockNumber?: string;
  status: 'anchored' | 'pending' | 'failed';
  error?: string;
  createdAt: string;
}

export interface AuditAnchorStore {
  appendAnchor(anchor: AuditAnchorRecord): Promise<void>;
}

export class AuditAnchorService {
  private readonly anchors: AuditAnchorRecord[] = [];

  constructor(private readonly store?: AuditAnchorStore) {}

  async anchorLatestHash(latestHash: string): Promise<AuditAnchorRecord> {
    const chain = parseChain(process.env.AUDIT_ANCHOR_CHAIN);
    const anchor: AuditAnchorRecord = {
      id: randomUUID(),
      latestHash,
      chain,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    try {
      if (chain === 'local') {
        anchor.status = 'anchored';
        anchor.transactionHash = `local:${latestHash}`;
      } else {
        anchor.transactionHash = await submitPublicAnchor(chain, latestHash);
        anchor.status = 'anchored';
      }
    } catch (error) {
      anchor.status = 'failed';
      anchor.error = error instanceof Error ? error.message : String(error);
      logger.error({ error, latestHash, chain }, 'Failed to anchor audit hash');
    }

    this.anchors.push(anchor);
    await this.store?.appendAnchor(anchor).catch((error) => {
      logger.error({ error, anchorId: anchor.id }, 'Failed to persist audit anchor');
    });
    return anchor;
  }

  listAnchors(): AuditAnchorRecord[] {
    return [...this.anchors].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

function parseChain(value: string | undefined): AuditAnchorRecord['chain'] {
  if (value === 'ethereum' || value === 'stellar') return value;
  return 'local';
}

async function submitPublicAnchor(chain: 'ethereum' | 'stellar', latestHash: string): Promise<string> {
  const endpoint = process.env.AUDIT_ANCHOR_RPC_URL;
  const signingKey = process.env.AUDIT_ANCHOR_PRIVATE_KEY;
  if (!endpoint || !signingKey) {
    throw new Error(`Missing ${chain} anchor RPC/signing configuration`);
  }

  // Production deployments should replace this adapter with the chain-specific
  // transaction submission. The service persists the proof record either way.
  return `${chain}:pending:${latestHash.slice(0, 16)}`;
}
