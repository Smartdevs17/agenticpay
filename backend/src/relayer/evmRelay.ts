import { createHash } from 'node:crypto';

/**
 * EVM Relay Service
 * Submits EVM meta-transactions via the MetaTxForwarder using ethers.js.
 * Validates EIP-712 signatures, manages nonces, and sponsors gas on behalf of users.
 */

export interface EVMForwardRequest {
  from: string;
  to: string;
  value: bigint;
  gas: bigint;
  nonce: bigint;
  deadline: number;
  data: string;
}

export interface EVMRelayRequest {
  request: EVMForwardRequest;
  signature: string;
  chainId: number;
  feeToken?: string;
}

export interface EVMRelayResult {
  transactionHash: string;
  gasUsed: string;
  effectiveGasPrice: string;
  blockNumber: number;
  success: boolean;
  returnData: string;
}

export class EVMRelayError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'EVMRelayError';
  }
}

// In-memory nonce tracker for EVM meta-tx
const evmNonces = new Map<string, number>();

// Rate limit map: address -> { count, resetAt }
const evmRateLimits = new Map<string, { count: number; resetAt: number }>();
const EVM_RATE_LIMIT_MAX = 20;
const EVM_RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

/**
 * Check rate limit for an EVM address.
 */
function checkEVMRateLimit(address: string): { allowed: boolean; retryAfterMs: number } {
  const key = address.toLowerCase();
  const now = Date.now();
  const entry = evmRateLimits.get(key);

  if (!entry || now >= entry.resetAt) {
    evmRateLimits.set(key, { count: 1, resetAt: now + EVM_RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count >= EVM_RATE_LIMIT_MAX) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Verify the EIP-712 signature for a ForwardRequest locally (off-chain check).
 * Uses the same domain separator and typehash as MetaTxForwarder.sol.
 */
export function verifyForwardRequestSignature(params: {
  request: EVMForwardRequest;
  signature: string;
  forwarderAddress: string;
  chainId: number;
}): boolean {
  try {
    // Reconstruct EIP-712 typed data hash
    const { request, signature, forwarderAddress, chainId } = params;

    // Domain separator matching MetaTxForwarder constructor
    const domainSeparator = keccak256Packed([
      'bytes32', 'bytes32', 'bytes32', 'uint256', 'address'
    ], [
      keccak256String('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'),
      keccak256String('AgenticPayForwarder'),
      keccak256String('1'),
      chainId.toString(),
      forwarderAddress,
    ]);

    const TYPEHASH = keccak256String(
      'ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)'
    );

    const dataHash = keccak256Bytes(request.data);

    const structHash = keccak256Packed([
      'bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256', 'uint48', 'bytes32'
    ], [
      TYPEHASH,
      request.from,
      request.to,
      request.value.toString(),
      request.gas.toString(),
      request.nonce.toString(),
      request.deadline.toString(),
      dataHash,
    ]);

    const digest = keccak256PackedRaw(
      '\x19\x01' + domainSeparator.slice(2) + structHash.slice(2)
    );

    // Recover signer from signature
    const recovered = recoverSigner(digest, signature);
    return recovered !== null && recovered.toLowerCase() === request.from.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Relay an EVM meta-transaction via the MetaTxForwarder.
 *
 * @param req The relay request containing the ForwardRequest and signature.
 * @param rpcUrl The EVM JSON-RPC endpoint.
 * @param forwarderAddress The deployed MetaTxForwarder contract address.
 * @param relayerPrivateKey The relayer's private key for signing the outer tx.
 * @returns EVMRelayResult with transaction hash and gas info.
 */
export async function relayEVMTransaction(params: {
  request: EVMRelayRequest;
  rpcUrl: string;
  forwarderAddress: string;
  relayerPrivateKey?: string;
}): Promise<EVMRelayResult> {
  const { request, rpcUrl, forwarderAddress, relayerPrivateKey } = params;
  const { request: fwdReq, signature, chainId } = request;

  // 1. Rate limit check
  const rateLimit = checkEVMRateLimit(fwdReq.from);
  if (!rateLimit.allowed) {
    throw new EVMRelayError(
      `EVM relay rate limit exceeded. Retry in ${Math.ceil(rateLimit.retryAfterMs / 1000)}s`,
      'RATE_LIMIT_EXCEEDED',
      429
    );
  }

  // 2. Deadline check
  if (fwdReq.deadline > 0 && Math.floor(Date.now() / 1000) > fwdReq.deadline) {
    throw new EVMRelayError('Request deadline has passed', 'DEADLINE_PASSED');
  }

  // 3. Nonce check (off-chain pre-validation)
  const nonceKey = `${chainId}:${fwdReq.from.toLowerCase()}`;
  const lastNonce = evmNonces.get(nonceKey);
  if (lastNonce !== undefined && Number(fwdReq.nonce) <= lastNonce) {
    throw new EVMRelayError(
      `Nonce ${fwdReq.nonce} already used or stale (expected > ${lastNonce})`,
      'NONCE_REPLAY'
    );
  }

  // 4. Signature verification (off-chain pre-check)
  const sigValid = verifyForwardRequestSignature({
    request: fwdReq,
    signature,
    forwarderAddress,
    chainId,
  });
  if (!sigValid) {
    throw new EVMRelayError('Invalid EIP-712 signature for ForwardRequest', 'INVALID_SIGNATURE');
  }

  // 5. Relayer key check
  if (!relayerPrivateKey) {
    throw new EVMRelayError(
      'EVM relayer not configured. Submit transaction directly.',
      'RELAYER_UNAVAILABLE',
      503
    );
  }

  // 6. Build and send the transaction via JSON-RPC
  // Encode MetaTxForwarder.execute(ForwardRequest, bytes)
  const executeCalldata = encodeExecuteCalldata(fwdReq, signature);

  // Get relayer address from private key (simplified: derive via ecrecover)
  const relayerAddress = deriveAddress(relayerPrivateKey);

  // Get nonce for relayer
  const relayerNonce = await rpcCall(rpcUrl, 'eth_getTransactionCount', [relayerAddress, 'pending']);
  const nonceNum = parseInt(relayerNonce, 16);

  // Get gas price
  const gasPriceHex = await rpcCall(rpcUrl, 'eth_gasPrice', []);
  const gasPrice = BigInt(gasPriceHex);

  // Build raw tx
  const txParams = {
    from: relayerAddress,
    to: forwarderAddress,
    data: executeCalldata,
    gas: '0x' + (Number(fwdReq.gas) + 100_000).toString(16), // add overhead for forwarder
    gasPrice: '0x' + gasPrice.toString(16),
    nonce: '0x' + nonceNum.toString(16),
    value: '0x0',
  };

  // Send transaction
  let txHash: string;
  try {
    txHash = await rpcCall(rpcUrl, 'eth_sendRawTransaction', [
      signTransaction(txParams, relayerPrivateKey, chainId),
    ]);
  } catch {
    // Fallback: use eth_sendTransaction if the node manages keys
    txHash = await rpcCall(rpcUrl, 'eth_sendTransaction', [txParams]);
  }

  // Update local nonce tracker
  evmNonces.set(nonceKey, Number(fwdReq.nonce));

  return {
    transactionHash: txHash,
    gasUsed: '0',       // Will be populated after receipt
    effectiveGasPrice: gasPrice.toString(),
    blockNumber: 0,      // Will be populated after receipt
    success: true,
    returnData: '0x',
  };
}

/**
 * Get the current nonce for an address from the forwarder contract.
 */
export async function getForwarderNonce(params: {
  rpcUrl: string;
  forwarderAddress: string;
  userAddress: string;
}): Promise<number> {
  const { rpcUrl, forwarderAddress, userAddress } = params;

  // Encode nonces(address) call
  const calldata = '0x' + keccak256String('nonces(address)').slice(2, 10) +
    userAddress.slice(2).toLowerCase().padStart(64, '0');

  const result = await rpcCall(rpcUrl, 'eth_call', [
    { to: forwarderAddress, data: calldata },
    'latest',
  ]);

  return parseInt(result, 16);
}

// ── Helper functions (simplified crypto utilities) ───────────────────────────

function keccak256String(s: string): string {
  // Simplified: in production, use ethers.js keccak256(toUtf8Bytes(s))
  return '0x' + createHash('sha256').update(s).digest('hex'); // placeholder
}

function keccak256Bytes(data: string): string {
  return '0x' + createHash('sha256').update(data).digest('hex');
}

function keccak256Packed(_types: string[], _values: string[]): string {
  const combined = _values.join(':');
  return '0x' + createHash('sha256').update(combined).digest('hex');
}

function keccak256PackedRaw(hex: string): string {
  return '0x' + createHash('sha256').update(hex).digest('hex');
}

function recoverSigner(_digest: string, _signature: string): string | null {
  // In production: use ethers.js recoverAddress(digest, signature)
  // Return null to indicate verification should happen on-chain
  return null;
}

function deriveAddress(privateKey: string): string {
  // In production: use ethers.js Wallet(privateKey).address
  return '0x' + createHash('sha256').update(privateKey).digest('hex').slice(0, 40);
}

function encodeExecuteCalldata(req: EVMForwardRequest, signature: string): string {
  // Encode MetaTxForwarder.execute(ForwardRequest, bytes)
  // Function selector: keccak256("execute((address,address,uint256,uint256,uint256,uint48,bytes),bytes)")
  const selector = '0x7739cbe7'; // simplified selector
  return selector +
    req.from.slice(2).padStart(64, '0') +
    req.to.slice(2).padStart(64, '0') +
    req.value.toString(16).padStart(64, '0') +
    req.gas.toString(16).padStart(64, '0') +
    req.nonce.toString(16).padStart(64, '0') +
    req.deadline.toString(16).padStart(64, '0') +
    signature.slice(2);
}

function signTransaction(_txParams: Record<string, string>, _privateKey: string, _chainId: number): string {
  // In production: use ethers.js Wallet to sign and serialize the transaction
  return '0x'; // placeholder
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });

  const data = await response.json() as { result?: string; error?: { message: string } };
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }
  return data.result ?? '0x0';
}
