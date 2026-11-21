import { randomUUID } from 'node:crypto';

export interface TokenMintRequest {
  id: string;
  accountId: string;
  currency: string;
  amount: number;
  collateralRatio: number;
  kycVerified: boolean;
  amlVerified: boolean;
  status: 'minted' | 'rejected';
  reason?: string;
  createdAt: string;
}

export interface OffchainTransfer {
  id: string;
  token: string;
  from: string;
  to: string;
  amount: number;
  nonce: string;
  signature: string;
  status: 'queued' | 'settled';
  createdAt: string;
}

export interface SettlementBatch {
  id: string;
  token: string;
  transferIds: string[];
  totalAmount: number;
  status: 'prepared' | 'submitted';
  createdAt: string;
}

type OracleState = {
  [currency: string]: {
    collateralLocked: number;
    tokenSupply: number;
    updatedAt: string;
  };
};

const mintRequests: TokenMintRequest[] = [];
const transfers: OffchainTransfer[] = [];
const settlements: SettlementBatch[] = [];
const oracleState: OracleState = {};
let emergencyHalt = false;

function nowIso(): string {
  return new Date().toISOString();
}

export function setEmergencyHalt(enabled: boolean): { emergencyHalt: boolean } {
  emergencyHalt = enabled;
  return { emergencyHalt };
}

export function getEmergencyHalt(): { emergencyHalt: boolean } {
  return { emergencyHalt };
}

export function updateOracle(
  currency: string,
  collateralLocked: number,
  tokenSupply: number
): OracleState[string] {
  oracleState[currency.toUpperCase()] = {
    collateralLocked,
    tokenSupply,
    updatedAt: nowIso(),
  };
  return oracleState[currency.toUpperCase()];
}

export function getOracleState(): OracleState {
  return { ...oracleState };
}

export function requestMint(input: {
  accountId: string;
  currency: string;
  amount: number;
  collateralRatio: number;
  kycVerified: boolean;
  amlVerified: boolean;
}): TokenMintRequest {
  const currency = input.currency.toUpperCase();
  const isVerified = input.kycVerified && input.amlVerified;
  const hasCollateral = input.collateralRatio >= 1.05;
  const tokenState = oracleState[currency];
  const ratioSafe = tokenState
    ? tokenState.collateralLocked / Math.max(tokenState.tokenSupply + input.amount, 1) >= 1.05
    : true;

  const request: TokenMintRequest = {
    id: `mint_${randomUUID()}`,
    accountId: input.accountId,
    currency,
    amount: input.amount,
    collateralRatio: input.collateralRatio,
    kycVerified: input.kycVerified,
    amlVerified: input.amlVerified,
    status: isVerified && hasCollateral && ratioSafe && !emergencyHalt ? 'minted' : 'rejected',
    reason: !isVerified
      ? 'KYC_AML_REQUIRED'
      : !hasCollateral
        ? 'COLLATERAL_RATIO_TOO_LOW'
        : !ratioSafe
          ? 'ORACLE_COLLATERAL_BREACH'
          : emergencyHalt
            ? 'EMERGENCY_HALT'
            : undefined,
    createdAt: nowIso(),
  };
  mintRequests.unshift(request);
  return request;
}

export function createOffchainTransfer(input: {
  token: string;
  from: string;
  to: string;
  amount: number;
  nonce: string;
  signature: string;
}): OffchainTransfer {
  if (emergencyHalt) throw new Error('Tokenization halted');
  const transfer: OffchainTransfer = {
    id: `otx_${randomUUID()}`,
    token: input.token.toUpperCase(),
    from: input.from,
    to: input.to,
    amount: input.amount,
    nonce: input.nonce,
    signature: input.signature,
    status: 'queued',
    createdAt: nowIso(),
  };
  transfers.unshift(transfer);
  return transfer;
}

export function settleBatch(token: string, limit = 100): SettlementBatch {
  const queued = transfers.filter((x) => x.token === token.toUpperCase() && x.status === 'queued').slice(0, limit);
  queued.forEach((x) => {
    x.status = 'settled';
  });
  const batch: SettlementBatch = {
    id: `batch_${randomUUID()}`,
    token: token.toUpperCase(),
    transferIds: queued.map((x) => x.id),
    totalAmount: queued.reduce((sum, x) => sum + x.amount, 0),
    status: 'submitted',
    createdAt: nowIso(),
  };
  settlements.unshift(batch);
  return batch;
}

export function redeemTokens(input: { accountId: string; token: string; amount: number }): {
  redemptionId: string;
  accountId: string;
  token: string;
  amount: number;
  status: 'queued' | 'rejected';
  reason?: string;
} {
  if (emergencyHalt) {
    return {
      redemptionId: `redeem_${randomUUID()}`,
      accountId: input.accountId,
      token: input.token.toUpperCase(),
      amount: input.amount,
      status: 'rejected',
      reason: 'EMERGENCY_HALT',
    };
  }
  return {
    redemptionId: `redeem_${randomUUID()}`,
    accountId: input.accountId,
    token: input.token.toUpperCase(),
    amount: input.amount,
    status: 'queued',
  };
}

export function listTokenizationState() {
  return {
    mints: mintRequests,
    transfers,
    settlements,
    oracleState: getOracleState(),
    emergencyHalt,
  };
}
