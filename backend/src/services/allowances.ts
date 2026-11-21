import { z } from 'zod';
import { config } from '../config.js';

const allowanceSchema = z.object({
  token: z.string(),
  spender: z.string(),
  allowance: z.string(),
  unlimited: z.boolean().default(false),
  expiresAt: z.number().nullable(),
});

const fetchAllowancesSchema = z.object({
  owner: z.string(),
  tokens: z.array(z.string()).optional(),
  spenders: z.array(z.string()).optional(),
});

const approvalActionSchema = z.object({
  token: z.string(),
  spender: z.string(),
  amount: z.string(),
  unlimited: z.boolean().default(false),
  expiresAt: z.number().nullable().optional(),
});

interface Allowance {
  token: string;
  spender: string;
  allowance: string;
  unlimited: boolean;
  expiresAt: number | null;
  lastUpdated: number;
  riskLevel: 'low' | 'medium' | 'high';
}

interface ApprovalLog {
  token: string;
  spender: string;
  amount: string;
  action: 'approve' | 'revoke' | 'decrease';
  txHash: string;
  timestamp: number;
  gasUsed: number;
}

interface AllowancesState {
  allowances: Record<string, Allowance[]>;
  approvalLogs: ApprovalLog[];
}

let allowancesState: AllowancesState = {
  allowances: {},
  approvalLogs: [],
};

function parseTokenAddress(token: string): { chain: string; address: string } {
  const [chain, address] = token.split(':');
  return { chain: chain || 'eip155', address };
}

function determineRiskLevel(
  allowance: string,
  unlimited: boolean
): 'low' | 'medium' | 'high' {
  if (unlimited) return 'high';
  const allowanceNum = BigInt(allowance);
  const oneMillion = BigInt('1000000000000000000');
  if (allowanceNum > oneMillion * BigInt(1000000)) return 'medium';
  return 'low';
}

export async function fetchAllowances(
  owner: string,
  tokens?: string[],
  spenders?: string[]
): Promise<Allowance[]> {
  const key = `${owner}:${tokens?.join(',')}:${spenders?.join(',')}`;
  const cached = allowancesState.allowances[key];

  if (cached) {
    return cached;
  }

  const allowances: Allowance[] = [];

  for (const token of tokens || []) {
    for (const spender of spenders || []) {
      const response = await fetch(
        `https://api.etherscan.io/api?module=contract&action=allowance&contract=${token}&address=${owner}&spender=${spender}&apikey=${process.env.ETHERSCAN_API_KEY}`
      );

      const data = await response.json() as {
        status: string;
        result: string | { allowance: string; spender: string };
      };

      if (data.status === '1' && typeof data.result === 'object') {
        const allowanceValue = data.result.allowance;
        const unlimited =
          allowanceValue === '115792089237316195423570985008687907853269984665640564039457584007913129639935';

        allowances.push({
          token,
          spender,
          allowance: allowanceValue,
          unlimited,
          expiresAt: null,
          lastUpdated: Date.now(),
          riskLevel: determineRiskLevel(allowanceValue, unlimited),
        });
      }
    }
  }

  allowancesState.allowances[key] = allowances;
  return allowances;
}

export async function approveToken(
  token: string,
  spender: string,
  amount: string,
  unlimited: boolean = false,
  expiresAt?: number
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const functionName = unlimited ? 'approve' : 'approve';
    const value = unlimited
      ? '115792089237316195423570985008687907853269984665640564039457584007913129639935'
      : amount;

    allowancesState.approvalLogs.push({
      token,
      spender,
      amount: value,
      action: 'approve',
      txHash: '',
      timestamp: Date.now(),
      gasUsed: 0,
    });

    return { success: true, txHash: `0x${Buffer.from(JSON.stringify({ token, spender, amount })).toString('hex').slice(0, 64)}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Approval failed';
    return { success: false, error: message };
  }
}

export async function revokeAllowance(
  token: string,
  spender: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const zeroAmount = '0';

    allowancesState.approvalLogs.push({
      token,
      spender,
      amount: zeroAmount,
      action: 'revoke',
      txHash: '',
      timestamp: Date.now(),
      gasUsed: 0,
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Revocation failed';
    return { success: false, error: message };
  }
}

export async function batchRevoke(
  allowances: Array<{ token: string; spender: string }>
): Promise<{ success: boolean; results: Array<{ token: string; spender: string; success: boolean }> }> {
  const results = [];

  for (const { token, spender } of allowances) {
    const result = await revokeAllowance(token, spender);
    results.push({ token, spender, success: result.success });
  }

  return { success: results.every((r) => r.success), results };
}

export async function estimateGasForApproval(
  token: string,
  spender: string,
  amount: string,
  unlimited: boolean = false
): Promise<{ estimatedGas: number; error?: string }> {
  try {
    const value = unlimited
      ? '115792089237316195423570985008687907853269984665640564039457584007913129639935'
      : amount;

    const estimatedGas = unlimited ? 50000 : 80000;

    return { estimatedGas };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gas estimation failed';
    return { estimatedGas: 0, error: message };
  }
}

export function getRecommendedAllowance(
  token: string,
  spender: string,
  typicalUsage: string
): string {
  const usage = BigInt(typicalUsage);
  const buffer = BigInt(2);
  return (usage * buffer).toString();
}

export function getApprovalLogs(
  token?: string,
  spender?: string,
  limit = 100
): ApprovalLog[] {
  let logs = allowancesState.approvalLogs;

  if (token) {
    logs = logs.filter((l) => l.token === token);
  }
  if (spender) {
    logs = logs.filter((l) => l.spender === spender);
  }

  return logs
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

export function getAllowanceStats() {
  const allAllowances = Object.values(allowancesState.allowances).flat();
  const highRisk = allAllowances.filter((a) => a.riskLevel === 'high').length;
  const mediumRisk = allAllowances.filter((a) => a.riskLevel === 'medium').length;
  const lowRisk = allAllowances.filter((a) => a.riskLevel === 'low').length;
  const unlimited = allAllowances.filter((a) => a.unlimited).length;

  return {
    total: allAllowances.length,
    highRisk,
    mediumRisk,
    lowRisk,
    unlimited,
  };
}