import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeContractWasmHash,
  ContractHashVerificationError,
  loadContractBuildManifest,
  parseContractBuildManifest,
  resolveContractHashVerificationSettings,
  verifyContractHash,
  verifyContractHashAtStartup,
} from '../stellar.js';

const contractId = StrKey.encodeContract(Keypair.random().rawPublicKey());
const otherContractId = StrKey.encodeContract(Keypair.random().rawPublicKey());
const wasmBytes = Buffer.from('wasm-bytecode-for-tests');
const wasmSha256 = computeContractWasmHash(wasmBytes);
const otherWasmBytes = Buffer.from('tampered-bytecode');

let tempDir: string;

function manifestFor(overrides: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify({
    contractId,
    network: 'testnet',
    wasmSha256,
    ...overrides,
  });
}

function startupEnv(manifestPath: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    STELLAR_NETWORK: 'testnet',
    SOROBAN_CONTRACT_ID: contractId,
    SOROBAN_RPC_URL: 'http://localhost:8000/soroban/rpc',
    SOROBAN_BUILD_MANIFEST: manifestPath,
    ...overrides,
  };
}

async function writeManifest(content: string): Promise<string> {
  const manifestPath = path.join(tempDir, 'build-manifest.json');
  await writeFile(manifestPath, content, 'utf8');
  return manifestPath;
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'agenticpay-contract-hash-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('computeContractWasmHash', () => {
  it('hashes the raw bytecode with SHA-256', () => {
    expect(computeContractWasmHash(Buffer.from(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(computeContractWasmHash(Buffer.from('hello'))).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });
});

describe('parseContractBuildManifest', () => {
  it('parses a valid manifest and normalises the hash casing', () => {
    const manifest = parseContractBuildManifest(manifestFor({ wasmSha256: wasmSha256.toUpperCase() }));

    expect(manifest).toEqual({
      contractId,
      network: 'testnet',
      wasmSha256,
      wasmFile: undefined,
      builtAt: undefined,
    });
  });

  it('rejects non-JSON content', () => {
    expect(() => parseContractBuildManifest('not json')).toThrowError(
      expect.objectContaining({ code: 'MANIFEST_INVALID' })
    );
  });

  it('rejects a missing contract ID', () => {
    expect(() => parseContractBuildManifest(manifestFor({ contractId: '' }))).toThrowError(
      expect.objectContaining({ code: 'MANIFEST_INVALID' })
    );
  });

  it('rejects an invalid contract ID', () => {
    expect(() => parseContractBuildManifest(manifestFor({ contractId: 'GABC' }))).toThrowError(
      expect.objectContaining({ code: 'MANIFEST_INVALID_CONTRACT_ID' })
    );
  });

  it('rejects an unsupported network', () => {
    expect(() => parseContractBuildManifest(manifestFor({ network: 'futurenet' }))).toThrowError(
      expect.objectContaining({ code: 'MANIFEST_INVALID_NETWORK' })
    );
  });

  it('rejects a malformed hash', () => {
    expect(() => parseContractBuildManifest(manifestFor({ wasmSha256: 'abc123' }))).toThrowError(
      expect.objectContaining({ code: 'MANIFEST_INVALID_HASH' })
    );
  });
});

describe('loadContractBuildManifest', () => {
  it('reads and parses a manifest from disk', async () => {
    const manifestPath = await writeManifest(manifestFor());

    await expect(loadContractBuildManifest(manifestPath)).resolves.toMatchObject({
      contractId,
      network: 'testnet',
      wasmSha256,
    });
  });

  it('fails with an actionable error when the manifest is missing', async () => {
    const missingPath = path.join(tempDir, 'missing.json');

    await expect(loadContractBuildManifest(missingPath)).rejects.toMatchObject({
      code: 'MANIFEST_NOT_FOUND',
    });
    expect(existsSync(missingPath)).toBe(false);
  });
});

describe('resolveContractHashVerificationSettings', () => {
  it('defaults to enforce mode, testnet and the public testnet RPC', () => {
    const settings = resolveContractHashVerificationSettings({ STELLAR_NETWORK: 'testnet' });

    expect(settings.mode).toBe('enforce');
    expect(settings.network).toBe('testnet');
    expect(settings.rpcUrl).toBe('https://soroban-testnet.stellar.org');
    expect(settings.contractId).toBe('');
  });

  it('requires an explicit RPC URL on the public network', () => {
    const settings = resolveContractHashVerificationSettings({ STELLAR_NETWORK: 'public' });

    expect(settings.network).toBe('public');
    expect(settings.rpcUrl).toBe('');
  });

  it('rejects an unknown verification mode', () => {
    expect(() =>
      resolveContractHashVerificationSettings({ CONTRACT_HASH_VERIFICATION: 'sometimes' })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_VERIFICATION_MODE' }));
  });
});

describe('verifyContractHash', () => {
  it('reports verification success when the deployed bytecode matches', async () => {
    const fetchWasm = vi.fn().mockResolvedValue(wasmBytes);

    const result = await verifyContractHash(contractId, wasmSha256, fetchWasm);

    expect(result).toEqual({
      contractId,
      expectedSha256: wasmSha256,
      actualSha256: wasmSha256,
      verified: true,
    });
    expect(fetchWasm).toHaveBeenCalledWith(contractId);
  });

  it('reports a mismatch without throwing', async () => {
    const result = await verifyContractHash(contractId, wasmSha256, async () => otherWasmBytes);

    expect(result.verified).toBe(false);
    expect(result.actualSha256).toBe(computeContractWasmHash(otherWasmBytes));
  });

  it('rejects an invalid expected hash', async () => {
    await expect(verifyContractHash(contractId, 'deadbeef', async () => wasmBytes)).rejects.toMatchObject({
      code: 'INVALID_EXPECTED_HASH',
    });
  });

  it('rejects an invalid contract ID', async () => {
    await expect(verifyContractHash('GABC', wasmSha256, async () => wasmBytes)).rejects.toMatchObject({
      code: 'INVALID_CONTRACT_ID',
    });
  });

  it('wraps RPC failures with a verification error', async () => {
    await expect(
      verifyContractHash(contractId, wasmSha256, async () => {
        throw new Error('rpc unavailable');
      })
    ).rejects.toMatchObject({ code: 'WASM_FETCH_FAILED' });
  });

  it('rejects empty bytecode from the network', async () => {
    await expect(
      verifyContractHash(contractId, wasmSha256, async () => new Uint8Array())
    ).rejects.toMatchObject({ code: 'EMPTY_WASM' });
  });
});

describe('verifyContractHashAtStartup', () => {
  it('skips verification when no contract ID is configured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await verifyContractHashAtStartup({ env: {} });

    expect(result).toEqual({ status: 'skipped', reason: 'SOROBAN_CONTRACT_ID is not set' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SOROBAN_CONTRACT_ID is not set'));
  });

  it('skips verification when explicitly disabled', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await verifyContractHashAtStartup({
      env: startupEnv(path.join(tempDir, 'unused.json'), { CONTRACT_HASH_VERIFICATION: 'off' }),
    });

    expect(result).toEqual({ status: 'skipped', reason: 'verification disabled' });
  });

  it('verifies the deployed contract against the manifest', async () => {
    const manifestPath = await writeManifest(manifestFor());
    const fetchWasm = vi.fn().mockResolvedValue(wasmBytes);

    const result = await verifyContractHashAtStartup({
      env: startupEnv(manifestPath),
      fetchWasm,
    });

    expect(result).toEqual({ status: 'verified', contractId, wasmSha256 });
    expect(fetchWasm).toHaveBeenCalledWith(contractId);
  });

  it('refuses to start when the deployed hash does not match the manifest', async () => {
    const manifestPath = await writeManifest(manifestFor());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      verifyContractHashAtStartup({
        env: startupEnv(manifestPath),
        fetchWasm: async () => otherWasmBytes,
      })
    ).rejects.toBeInstanceOf(ContractHashVerificationError);
  });

  it('continues in warn mode when the hash does not match', async () => {
    const manifestPath = await writeManifest(manifestFor());
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await verifyContractHashAtStartup({
      env: startupEnv(manifestPath, { CONTRACT_HASH_VERIFICATION: 'warn' }),
      fetchWasm: async () => otherWasmBytes,
    });

    expect(result.status).toBe('failed');
    expect((result as { reason: string }).reason).toContain('hash mismatch');
  });

  it('refuses to start when the manifest is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      verifyContractHashAtStartup({
        env: startupEnv(path.join(tempDir, 'missing.json')),
        fetchWasm: async () => wasmBytes,
      })
    ).rejects.toMatchObject({ code: 'MANIFEST_NOT_FOUND' });
  });

  it('refuses to start when the manifest is for a different contract', async () => {
    const manifestPath = await writeManifest(manifestFor({ contractId: otherContractId }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      verifyContractHashAtStartup({ env: startupEnv(manifestPath), fetchWasm: async () => wasmBytes })
    ).rejects.toMatchObject({ code: 'MANIFEST_CONTRACT_MISMATCH' });
  });

  it('refuses to start when the manifest targets a different network', async () => {
    const manifestPath = await writeManifest(manifestFor({ network: 'public' }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      verifyContractHashAtStartup({ env: startupEnv(manifestPath), fetchWasm: async () => wasmBytes })
    ).rejects.toMatchObject({ code: 'MANIFEST_NETWORK_MISMATCH' });
  });

  it('refuses to start on the public network without an RPC URL', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      verifyContractHashAtStartup({
        env: startupEnv(path.join(tempDir, 'unused.json'), {
          STELLAR_NETWORK: 'public',
          SOROBAN_RPC_URL: '',
        }),
        fetchWasm: async () => wasmBytes,
      })
    ).rejects.toMatchObject({ code: 'MISSING_RPC_URL' });
  });
});
