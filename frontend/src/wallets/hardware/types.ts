/**
 * Hardware Wallet Types and Interfaces
 */

export enum WalletType {
  LEDGER = 'ledger',
  TREZOR = 'trezor'
}

export interface HardwareWalletProvider {
  readonly type: WalletType;
  readonly name: string;
  readonly icon: string;
  
  initialize(): Promise<void>;
  connect(): Promise<{ address: string; publicKey: string }>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getAddress(): Promise<string>;
  getPublicKey(): Promise<string>;
  signTransaction(transactionXDR: string, networkPassphrase: string): Promise<string>;
  simulateTransaction(transactionXDR: string, networkPassphrase: string): Promise<TransactionSimulation>;
  getDeviceInfo(): Promise<{ version: string; model: string }>;
  checkAppSupport(): Promise<boolean>;
}

export interface TransactionSimulation {
  operations: TransactionOperation[];
  fee: string;
  gasEstimate: number;
  sequence: string;
  networkPassphrase: string;
  warnings: string[];
  requiresApproval: boolean;
  estimatedTime: number;
}

export interface TransactionOperation {
  type: string;
  source: string;
  destination: string;
  amount: string;
  asset: string;
  description: string;
}

export interface WalletConnectionState {
  isConnected: boolean;
  address: string | null;
  publicKey: string | null;
  deviceInfo: DeviceInfo | null;
  error: string | null;
}

export interface DeviceInfo {
  version: string;
  model: string;
  features?: any;
}

export interface TransactionRequest {
  to: string;
  amount: string;
  asset?: string;
  memo?: string;
  fee?: string;
}

export interface TransactionStatus {
  hash: string;
  status: 'pending' | 'success' | 'failed';
  timestamp: number;
  error?: string;
}

export interface HardwareWalletConfig {
  allowSimultaneousConnections: boolean;
  autoConnect: boolean;
  timeout: number;
  retryAttempts: number;
}

export interface WalletEvent {
  type: 'connect' | 'disconnect' | 'error' | 'transaction';
  payload: any;
}

export interface TransactionApproval {
  approved: boolean;
  transactionXDR: string;
  simulation: TransactionSimulation;
  timestamp: number;
}

export interface GasEstimate {
  minFee: number;
  maxFee: number;
  estimatedFee: number;
  confidence: number;
}

export interface NetworkConfig {
  networkPassphrase: string;
  horizonUrl: string;
  feeBump: number;
  baseReserve: number;
}

export interface WalletError {
  code: string;
  message: string;
  details?: any;
}

export const WalletErrorCodes = {
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  INVALID_TRANSACTION: 'INVALID_TRANSACTION',
  USER_REJECTED: 'USER_REJECTED',
  TIMEOUT: 'TIMEOUT',
  FIRMWARE_OUTDATED: 'FIRMWARE_OUTDATED',
  APP_NOT_OPEN: 'APP_NOT_OPEN',
  UNSUPPORTED_OPERATION: 'UNSUPPORTED_OPERATION'
} as const;

export type WalletErrorCode = typeof WalletErrorCodes[keyof typeof WalletErrorCodes];
