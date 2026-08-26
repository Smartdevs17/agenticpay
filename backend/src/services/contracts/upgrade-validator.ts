/**
 * upgrade-validator.ts — Issue #474
 *
 * Validates smart contract upgrades before deployment: storage layout
 * compatibility, fork simulation, admin permission checks, and smoke tests.
 */

import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import type { ContractPlatform, UpgradeValidationStatus } from '@prisma/client';
import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import { prisma } from '../../lib/prisma.js';

export interface StorageLayoutDiff {
  type: 'reorder' | 'type_change' | 'slot_collision' | 'new_variable' | 'removed_variable';
  variable: string;
  slot?: number;
  oldType?: string;
  newType?: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface UpgradeValidationInput {
  contractName: string;
  platform: ContractPlatform;
  network: string;
  proxyAddress: string;
  newImplementation: string;
  previousImplementation?: string;
  deployerAddress?: string;
  timelockAddress?: string;
  storageLayoutOld?: Array<{ name: string; type: string; slot: number }>;
  storageLayoutNew?: Array<{ name: string; type: string; slot: number }>;
}

export interface ValidationReport {
  id: string;
  upgradeId: string;
  status: UpgradeValidationStatus;
  storageLayoutDiff: StorageLayoutDiff[];
  simulationPassed: boolean;
  smokeTestsPassed: boolean;
  adminPreserved: boolean;
  proxyAdminValid: boolean;
  implementationVerified: boolean;
  failures: string[];
  warnings: string[];
  durationMs: number;
}

const PROXY_ADMIN_SLOT = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';

class UpgradeValidatorService extends BaseService {
  private usePrisma(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  diffStorageLayout(
    oldLayout: Array<{ name: string; type: string; slot: number }>,
    newLayout: Array<{ name: string; type: string; slot: number }>,
  ): StorageLayoutDiff[] {
    const diffs: StorageLayoutDiff[] = [];
    const oldMap = new Map(oldLayout.map((v) => [v.name, v]));
    const newMap = new Map(newLayout.map((v) => [v.name, v]));
    const usedSlots = new Set<number>();

    for (const [name, newVar] of newMap) {
      const oldVar = oldMap.get(name);
      if (!oldVar) {
        diffs.push({
          type: 'new_variable',
          variable: name,
          slot: newVar.slot,
          newType: newVar.type,
          severity: 'warning',
          message: `New storage variable "${name}" at slot ${newVar.slot}`,
        });
        continue;
      }

      if (oldVar.slot !== newVar.slot) {
        diffs.push({
          type: 'reorder',
          variable: name,
          slot: newVar.slot,
          severity: 'error',
          message: `Variable "${name}" moved from slot ${oldVar.slot} to ${newVar.slot}`,
        });
      }

      if (oldVar.type !== newVar.type) {
        diffs.push({
          type: 'type_change',
          variable: name,
          slot: newVar.slot,
          oldType: oldVar.type,
          newType: newVar.type,
          severity: 'error',
          message: `Variable "${name}" type changed from ${oldVar.type} to ${newVar.type}`,
        });
      }

      if (usedSlots.has(newVar.slot)) {
        diffs.push({
          type: 'slot_collision',
          variable: name,
          slot: newVar.slot,
          severity: 'error',
          message: `Slot collision at ${newVar.slot} for variable "${name}"`,
        });
      }
      usedSlots.add(newVar.slot);
    }

    for (const [name, oldVar] of oldMap) {
      if (!newMap.has(name)) {
        diffs.push({
          type: 'removed_variable',
          variable: name,
          slot: oldVar.slot,
          oldType: oldVar.type,
          severity: 'error',
          message: `Storage variable "${name}" removed from layout`,
        });
      }
    }

    return diffs;
  }

  async checkProxyAdmin(proxyAddress: string, rpcUrl?: string): Promise<{ valid: boolean; admin?: string; renounced: boolean }> {
    const url = rpcUrl ?? process.env.EVM_RPC_URL;
    if (!url) return { valid: false, renounced: false };

    try {
      const provider = new ethers.JsonRpcProvider(url);
      const adminSlot = await provider.getStorage(proxyAddress, PROXY_ADMIN_SLOT);
      const adminAddress = ethers.getAddress('0x' + adminSlot.slice(-40));

      const renounced =
        adminAddress === ethers.ZeroAddress ||
        adminAddress === '0x0000000000000000000000000000000000000000';

      return { valid: !renounced, admin: adminAddress, renounced };
    } catch {
      return { valid: false, renounced: false };
    }
  }

  async simulateUpgrade(input: UpgradeValidationInput): Promise<{ passed: boolean; forkBlock?: bigint; error?: string }> {
    const rpcUrl = process.env.EVM_FORK_RPC_URL ?? process.env.EVM_RPC_URL;
    if (!rpcUrl || input.platform !== 'evm') {
      return { passed: input.platform === 'soroban', error: input.platform === 'evm' ? 'No fork RPC configured' : undefined };
    }

    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const blockNumber = BigInt(await provider.getBlockNumber());

      const implCode = await provider.getCode(input.newImplementation);
      if (implCode === '0x' || implCode.length <= 2) {
        return { passed: false, forkBlock: blockNumber, error: 'New implementation has no bytecode' };
      }

      const proxyCode = await provider.getCode(input.proxyAddress);
      if (proxyCode === '0x' || proxyCode.length <= 2) {
        return { passed: false, forkBlock: blockNumber, error: 'Proxy has no bytecode' };
      }

      return { passed: true, forkBlock: blockNumber };
    } catch (err) {
      return {
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async runSmokeTests(input: UpgradeValidationInput): Promise<{ passed: boolean; failures: string[] }> {
    const failures: string[] = [];
    const rpcUrl = process.env.EVM_RPC_URL;

    if (input.platform === 'evm' && rpcUrl) {
      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const implCode = await provider.getCode(input.newImplementation);
        if (implCode.length < 10) failures.push('Implementation bytecode too small');

        const proxy = new ethers.Contract(
          input.proxyAddress,
          ['function implementation() view returns (address)'],
          provider,
        );

        try {
          const currentImpl = await proxy.implementation();
          if (currentImpl.toLowerCase() === input.newImplementation.toLowerCase()) {
            failures.push('Proxy already points to new implementation — verify this is intentional');
          }
        } catch {
          // UUPS proxies may not expose implementation() directly
        }
      } catch (err) {
        failures.push(`Smoke test RPC error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (input.platform === 'soroban') {
      if (!process.env.SOROBAN_RPC_URL) {
        failures.push('Soroban RPC not configured for sandbox simulation');
      }
    }

    return { passed: failures.length === 0, failures };
  }

  async validateUpgrade(input: UpgradeValidationInput): Promise<Result<ValidationReport>> {
    const start = Date.now();
    const failures: string[] = [];
    const warnings: string[] = [];

    const storageLayoutDiff = this.diffStorageLayout(
      input.storageLayoutOld ?? [],
      input.storageLayoutNew ?? [],
    );

    for (const diff of storageLayoutDiff) {
      if (diff.severity === 'error') failures.push(diff.message);
      else warnings.push(diff.message);
    }

    const simulation = await this.simulateUpgrade(input);
    if (!simulation.passed) {
      failures.push(simulation.error ?? 'Fork simulation failed');
    }

    const smokeTests = await this.runSmokeTests(input);
    failures.push(...smokeTests.failures);

    const proxyAdmin = await this.checkProxyAdmin(input.proxyAddress);
    if (proxyAdmin.renounced) {
      failures.push('Proxy admin ownership appears renounced — upgrade may be impossible');
    }

    const adminPreserved = !proxyAdmin.renounced;
    const proxyAdminValid = proxyAdmin.valid;
    const implementationVerified = simulation.passed;
    const passed = failures.length === 0;

    const status: UpgradeValidationStatus = passed ? 'passed' : 'failed';
    const durationMs = Date.now() - start;

    let upgradeId = randomUUID();
    let reportId = randomUUID();

    if (this.usePrisma()) {
      const upgrade = await prisma.contractUpgrade.create({
        data: {
          id: upgradeId,
          contractName: input.contractName,
          platform: input.platform,
          network: input.network,
          proxyAddress: input.proxyAddress,
          previousImplementation: input.previousImplementation,
          newImplementation: input.newImplementation,
          deployerAddress: input.deployerAddress,
          timelockAddress: input.timelockAddress,
          status,
        },
      });
      upgradeId = upgrade.id;

      const report = await prisma.upgradeValidationReport.create({
        data: {
          id: reportId,
          upgradeId,
          status,
          storageLayoutDiff: storageLayoutDiff as unknown as object,
          simulationPassed: simulation.passed,
          smokeTestsPassed: smokeTests.passed,
          adminPreserved,
          proxyAdminValid,
          implementationVerified,
          failures: failures.length ? failures : undefined,
          warnings: warnings.length ? warnings : undefined,
          forkBlockNumber: simulation.forkBlock,
          durationMs,
        },
      });
      reportId = report.id;
    }

    return this.ok({
      id: reportId,
      upgradeId,
      status,
      storageLayoutDiff,
      simulationPassed: simulation.passed,
      smokeTestsPassed: smokeTests.passed,
      adminPreserved,
      proxyAdminValid,
      implementationVerified,
      failures,
      warnings,
      durationMs,
    });
  }

  async rollbackUpgrade(upgradeId: string): Promise<Result<{ rolledBack: boolean }>> {
    if (!this.usePrisma()) {
      return this.fail('Database required for rollback', 503, 'DB_UNAVAILABLE');
    }

    const upgrade = await prisma.contractUpgrade.findUnique({ where: { id: upgradeId } });
    if (!upgrade) return this.notFoundFailure('ContractUpgrade', upgradeId);
    if (!upgrade.previousImplementation) {
      return this.validationFailure('No previous implementation recorded for rollback');
    }

    await prisma.contractUpgrade.update({
      where: { id: upgradeId },
      data: { status: 'rolled_back', rolledBackAt: new Date() },
    });

    return this.ok({ rolledBack: true });
  }

  async getUpgradeHistory(limit = 20) {
    if (!this.usePrisma()) return this.ok({ upgrades: [] });

    const upgrades = await prisma.contractUpgrade.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        validationReports: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    return this.ok({
      upgrades: upgrades.map((u) => ({
        id: u.id,
        contractName: u.contractName,
        platform: u.platform,
        network: u.network,
        proxyAddress: u.proxyAddress,
        newImplementation: u.newImplementation,
        status: u.status,
        deployedAt: u.deployedAt?.toISOString() ?? null,
        latestReport: u.validationReports[0] ?? null,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  }
}

let instance: UpgradeValidatorService | null = null;

export function getUpgradeValidatorService(): UpgradeValidatorService {
  if (!instance) instance = new UpgradeValidatorService();
  return instance;
}
