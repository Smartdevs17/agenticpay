// Off-chain authorization token types for gasless transactions (Stellar equivalent of EIP-712)

export interface AuthorizationDomain {
  name: string;
  version: string;
  networkPassphrase: string;
  contractId: string;
}

export interface AuthorizationMessage {
  from: string;       // Stellar public key (G...)
  to: string;         // Relayer or contract address
  nonce: number;      // Replay protection
  validUntil: number; // Unix timestamp (seconds)
  operation: string;  // Encoded operation (base64 XDR or JSON)
  maxFee: string;     // Max fee in stroops the user authorizes
}

export interface AuthorizationToken {
  domain: AuthorizationDomain;
  message: AuthorizationMessage;
  signature: string;  // Ed25519 signature (hex)
}

export interface RelayRequest {
  token: AuthorizationToken;
}

export interface RelayResult {
  transactionHash: string;
  fee: string;
  ledger?: number;
}

export interface RelayerHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  balance: string;
  pendingTxCount: number;
  lastCheckedAt: string;
}

export interface GasEstimate {
  baseFee: string;
  relayerFee: string;
  totalFee: string;
  currency: 'XLM';
}
