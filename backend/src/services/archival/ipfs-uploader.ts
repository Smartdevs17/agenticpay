/**
 * ipfs-uploader.ts — Issue #473
 *
 * Uploads compressed archival payloads to IPFS via Pinata, web3.storage,
 * or a local IPFS node. Falls back to local storage when IPFS is unavailable.
 */

import { createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type IpfsProvider = 'pinata' | 'web3storage' | 'local-node' | 'local-fs';

export interface UploadResult {
  cid: string;
  url: string;
  provider: IpfsProvider;
  contentHash: string;
  verifiedHash: string;
  compressedBytes: number;
  uncompressedBytes: number;
}

export interface DownloadResult {
  data: Buffer;
  contentHash: string;
  verified: boolean;
}

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024; // 100MB per daily archive

function resolveProvider(): IpfsProvider {
  if (process.env.PINATA_JWT) return 'pinata';
  if (process.env.WEB3_STORAGE_TOKEN) return 'web3storage';
  if (process.env.IPFS_API_URL) return 'local-node';
  return 'local-fs';
}

export async function compressPayload(data: unknown): Promise<{ buffer: Buffer; hash: string; uncompressedBytes: number }> {
  const json = JSON.stringify(data);
  const uncompressed = Buffer.from(json, 'utf-8');
  const hash = createHash('sha256').update(uncompressed).digest('hex');

  const chunks: Buffer[] = [];
  const gzip = createGzip({ level: 9 });
  const input = Readable.from(uncompressed);

  gzip.on('data', (chunk: Buffer) => chunks.push(chunk));
  await pipeline(input, gzip);
  const compressed = Buffer.concat(chunks);

  if (compressed.length > MAX_ARCHIVE_BYTES) {
    throw new Error(
      `Compressed archive exceeds ${MAX_ARCHIVE_BYTES} bytes (${compressed.length}). Split batch required.`,
    );
  }

  return { buffer: compressed, hash, uncompressedBytes: uncompressed.length };
}

async function uploadToPinata(buffer: Buffer, filename: string): Promise<{ cid: string; url: string }> {
  const jwt = process.env.PINATA_JWT!;
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/gzip' }), filename);

  const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Pinata upload failed: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as { IpfsHash: string };
  const cid = body.IpfsHash;
  return { cid, url: `https://gateway.pinata.cloud/ipfs/${cid}` };
}

async function uploadToWeb3Storage(buffer: Buffer): Promise<{ cid: string; url: string }> {
  const token = process.env.WEB3_STORAGE_TOKEN!;

  const res = await fetch('https://api.web3.storage/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/gzip',
    },
    body: buffer,
  });

  if (!res.ok) {
    throw new Error(`web3.storage upload failed: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as { cid: string };
  return { cid: body.cid, url: `https://w3s.link/ipfs/${body.cid}` };
}

async function uploadToLocalNode(buffer: Buffer): Promise<{ cid: string; url: string }> {
  const apiUrl = process.env.IPFS_API_URL ?? 'http://127.0.0.1:5001';
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/gzip' }), 'archive.json.gz');

  const res = await fetch(`${apiUrl}/api/v0/add`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Local IPFS upload failed: ${res.status}`);
  }

  const text = await res.text();
  const lines = text.trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1]!) as { Hash: string };
  const cid = last.Hash;
  return { cid, url: `${apiUrl}/ipfs/${cid}` };
}

async function uploadToLocalFs(buffer: Buffer, contentHash: string): Promise<{ cid: string; url: string }> {
  const dir = process.env.ARCHIVAL_LOCAL_DIR ?? join(process.cwd(), '.archival');
  await mkdir(dir, { recursive: true });
  const cid = `local-${contentHash.slice(0, 32)}`;
  const filePath = join(dir, `${cid}.json.gz`);
  await writeFile(filePath, buffer);
  return { cid, url: `file://${filePath}` };
}

export async function uploadToIpfs(data: unknown, filename = 'archive.json.gz'): Promise<UploadResult> {
  const { buffer, hash, uncompressedBytes } = await compressPayload(data);
  const provider = resolveProvider();

  let result: { cid: string; url: string };

  switch (provider) {
    case 'pinata':
      result = await uploadToPinata(buffer, filename);
      break;
    case 'web3storage':
      result = await uploadToWeb3Storage(buffer);
      break;
    case 'local-node':
      result = await uploadToLocalNode(buffer);
      break;
    default:
      result = await uploadToLocalFs(buffer, hash);
  }

  const verifiedHash = createHash('sha256').update(buffer).digest('hex');

  return {
    cid: result.cid,
    url: result.url,
    provider,
    contentHash: hash,
    compressedBytes: buffer.length,
    uncompressedBytes,
    verifiedHash,
  };
}

export async function downloadFromIpfs(cid: string, expectedHash?: string): Promise<DownloadResult> {
  let buffer: Buffer;

  if (cid.startsWith('local-')) {
    const dir = process.env.ARCHIVAL_LOCAL_DIR ?? join(process.cwd(), '.archival');
    buffer = await readFile(join(dir, `${cid}.json.gz`));
  } else {
    const gateway = process.env.IPFS_GATEWAY_URL ?? 'https://ipfs.io/ipfs';
    const res = await fetch(`${gateway}/${cid}`);
    if (!res.ok) throw new Error(`IPFS download failed for CID ${cid}: ${res.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
  }

  const contentHash = createHash('sha256').update(buffer).digest('hex');
  const verified = expectedHash ? contentHash === expectedHash : true;

  return { data: buffer, contentHash, verified };
}

export async function verifyIntegrity(originalHash: string, cid: string): Promise<boolean> {
  const { data } = await downloadFromIpfs(cid);
  const { createGunzip } = await import('node:zlib');
  const { promisify } = await import('node:util');
  const gunzip = promisify(createGunzip);
  const decompressed = await gunzip(data);
  const hash = createHash('sha256').update(decompressed).digest('hex');
  return hash === originalHash;
}
