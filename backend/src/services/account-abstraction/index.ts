import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import { prisma } from '../../lib/prisma.js';
import type {
  PaymasterBudget,
  UserOperation,
  UserOpStatus,
} from '@prisma/client';

export type {
  PaymasterBudget,
  UserOperation,
  UserOpStatus,
};

// ─── DTOs ──────────────────────────────────────────────────────────────────────

export interface SubmitUserOperationInput {
  userOpHash: string;
  sender: string;
  nonce: string;
  paymaster: string;
  mode?: 'verifying' | 'deposit';
}

export interface EstimateUserOperationGasInput {
  sender: string;
  paymaster: string;
  mode: 'verifying' | 'deposit';
  callData: string;
  chainId: number;
}

export interface UserOperationGasEstimate {
  verificationGasLimit: string;
  preVerificationGas: string;
  callGasLimit: string;
  paymasterVerificationGasLimit: string;
  paymasterPostOpGasLimit: string;
  estimatedFeeWei: string;
}

export interface TopUpDepositInput {
  tenantId: string;
  chainId: number;
  token: string;
  amount: string;
}

export interface CreatePaymasterBudgetInput {
  tenantId: string;
  chainId: number;
  token: string;
  balance: string;
  totalDeposited: string;
  totalUsed: string;
  maxGasPerTx?: string;
}

export interface UpdateUserOperationStatusInput {
  status: UserOpStatus;
  actualGasCost?: string;
  txHash?: string;
  errorMsg?: string;
}

// ─── Service ────────────────────────────────────────────────────────────────────

export class AccountAbstractionService extends BaseService {
  // ── User Operations ─────────────────────────────────────────────────────────

  async submitUserOperation(
    input: SubmitUserOperationInput,
  ): Promise<Result<UserOperation>> {
    try {
      if (!input.userOpHash.trim()) {
        return this.validationFailure('userOpHash is required');
      }
      if (!input.sender.trim()) {
        return this.validationFailure('Sender address is required');
      }

      const existing = await prisma.userOperation.findUnique({
        where: { userOpHash: input.userOpHash },
      });
      if (existing) return this.conflictFailure('UserOperation already exists');

      const op = await prisma.userOperation.create({
        data: {
          userOpHash: input.userOpHash.trim(),
          sender: input.sender.trim(),
          nonce: input.nonce,
          paymaster: input.paymaster.trim(),
          mode: input.mode ?? 'verifying',
          status: 'pending',
        },
      });
      return this.ok(op);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async estimateUserOperationGas(
    input: EstimateUserOperationGasInput,
  ): Promise<Result<UserOperationGasEstimate>> {
    try {
      if (!input.callData || input.callData === '0x') {
        return this.validationFailure('callData is required');
      }

      const calldataBytes = input.callData.startsWith('0x')
        ? (input.callData.length - 2) / 2
        : input.callData.length / 2;

      const baseGas = 21_000n;
      const calldataGas = BigInt(calldataBytes) * 16n;
      const executionGas = BigInt(Math.max(30_000, calldataBytes * 100));
      const verificationGas = input.mode === 'verifying' ? 60_000n : 45_000n;
      const postOpGas = input.mode === 'verifying' ? 20_000n : 15_000n;

      const callGasLimit = (baseGas + calldataGas + executionGas).toString();
      const verificationGasLimit = verificationGas.toString();
      const preVerificationGas = (baseGas + calldataGas).toString();
      const paymasterVerificationGasLimit = verificationGas.toString();
      const paymasterPostOpGasLimit = postOpGas.toString();
      const estimatedFeeWei = (
        (baseGas + calldataGas + executionGas + verificationGas + postOpGas) * 100_000_000n
      ).toString();

      return this.ok({
        verificationGasLimit,
        preVerificationGas,
        callGasLimit,
        paymasterVerificationGasLimit,
        paymasterPostOpGasLimit,
        estimatedFeeWei,
      });
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async getUserOperation(userOpHash: string): Promise<Result<UserOperation>> {
    try {
      const op = await prisma.userOperation.findUnique({
        where: { userOpHash },
      });
      if (!op) return this.notFoundFailure('UserOperation', userOpHash);
      return this.ok(op);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async listUserOperations(
    filters?: {
      sender?: string;
      status?: UserOpStatus;
      limit?: number;
      offset?: number;
    },
  ): Promise<Result<UserOperation[]>> {
    try {
      const ops = await prisma.userOperation.findMany({
        where: {
          ...(filters?.sender ? { sender: filters.sender } : {}),
          ...(filters?.status ? { status: filters.status } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: filters?.limit ?? 50,
        skip: filters?.offset ?? 0,
      });
      return this.ok(ops);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async updateUserOperationStatus(
    userOpHash: string,
    input: UpdateUserOperationStatusInput,
  ): Promise<Result<UserOperation>> {
    try {
      const op = await prisma.userOperation.findUnique({
        where: { userOpHash },
      });
      if (!op) return this.notFoundFailure('UserOperation', userOpHash);

      const updated = await prisma.userOperation.update({
        where: { userOpHash },
        data: {
          status: input.status,
          ...(input.actualGasCost !== undefined ? { actualGasCost: input.actualGasCost } : {}),
          ...(input.txHash !== undefined ? { txHash: input.txHash } : {}),
          ...(input.errorMsg !== undefined ? { errorMsg: input.errorMsg } : {}),
          ...(input.status === 'completed' || input.status === 'failed'
            ? { completedAt: new Date() }
            : {}),
        },
      });
      return this.ok(updated);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  // ── Paymaster Budgets ──────────────────────────────────────────────────────

  async getOrCreateBudget(
    input: CreatePaymasterBudgetInput,
  ): Promise<Result<PaymasterBudget>> {
    try {
      if (!input.token.trim()) {
        return this.validationFailure('Token address is required');
      }

      const budget = await prisma.paymasterBudget.upsert({
        where: {
          tenantId_chainId_token: {
            tenantId: input.tenantId,
            chainId: input.chainId,
            token: input.token.toLowerCase(),
          },
        },
        update: {
          balance: input.balance,
          totalDeposited: input.totalDeposited,
          totalUsed: input.totalUsed,
          ...(input.maxGasPerTx !== undefined ? { maxGasPerTx: input.maxGasPerTx } : {}),
        },
        create: {
          tenantId: input.tenantId,
          chainId: input.chainId,
          token: input.token.toLowerCase(),
          balance: input.balance,
          totalDeposited: input.totalDeposited,
          totalUsed: input.totalUsed,
          maxGasPerTx: input.maxGasPerTx ?? null,
        },
      });
      return this.ok(budget);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async topUpDeposit(input: TopUpDepositInput): Promise<Result<PaymasterBudget>> {
    try {
      if (BigInt(input.amount) <= 0n) {
        return this.validationFailure('Deposit amount must be positive');
      }

      const existing = await prisma.paymasterBudget.findUnique({
        where: {
          tenantId_chainId_token: {
            tenantId: input.tenantId,
            chainId: input.chainId,
            token: input.token.toLowerCase(),
          },
        },
      });
      if (!existing) return this.notFoundFailure('PaymasterBudget', `${input.chainId}:${input.token}`);

      const budget = await prisma.paymasterBudget.update({
        where: {
          tenantId_chainId_token: {
            tenantId: input.tenantId,
            chainId: input.chainId,
            token: input.token.toLowerCase(),
          },
        },
        data: {
          balance: { increment: input.amount },
          totalDeposited: { increment: input.amount },
        },
      });
      return this.ok(budget);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async recordPaymasterUsage(
    tenantId: string,
    chainId: number,
    token: string,
    amount: string,
  ): Promise<Result<PaymasterBudget>> {
    try {
      const existing = await prisma.paymasterBudget.findUnique({
        where: {
          tenantId_chainId_token: {
            tenantId,
            chainId,
            token: token.toLowerCase(),
          },
        },
      });
      if (!existing) return this.notFoundFailure('PaymasterBudget', `${chainId}:${token}`);

      const currentBalance = BigInt(existing.balance);
      const usageAmount = BigInt(amount);
      if (usageAmount > currentBalance) {
        return this.validationFailure('Insufficient paymaster budget balance');
      }

      const budget = await prisma.paymasterBudget.update({
        where: {
          tenantId_chainId_token: {
            tenantId,
            chainId,
            token: token.toLowerCase(),
          },
        },
        data: {
          balance: { increment: `-${amount}` },
          totalUsed: { increment: amount },
        },
      });
      return this.ok(budget);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async getBudget(
    tenantId: string,
    chainId: number,
    token: string,
  ): Promise<Result<PaymasterBudget>> {
    try {
      const budget = await prisma.paymasterBudget.findUnique({
        where: {
          tenantId_chainId_token: {
            tenantId,
            chainId,
            token: token.toLowerCase(),
          },
        },
      });
      if (!budget) return this.notFoundFailure('PaymasterBudget', `${chainId}:${token}`);
      return this.ok(budget);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }

  async listBudgets(tenantId: string): Promise<Result<PaymasterBudget[]>> {
    try {
      const budgets = await prisma.paymasterBudget.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
      return this.ok(budgets);
    } catch (error) {
      return this.unexpectedFailure(error);
    }
  }
}

export const accountAbstractionService = new AccountAbstractionService();
