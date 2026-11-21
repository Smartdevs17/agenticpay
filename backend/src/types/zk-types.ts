/**
 * Zero-Knowledge Proof Types and Interfaces
 */

export interface ZKProof {
  proof: {
    a: string[];
    b: string[][];
    c: string[];
  };
  publicSignals: string[];
  circuitInputs: Record<string, any>;
  verified: boolean;
}

export interface Credential {
  id: string;
  userId: string;
  claims: Record<string, any>;
  issuerSignature: string[];
  nullifier: string;
  expirationDate: number;
  createdAt: number;
  revoked: boolean;
}

export interface RevocationList {
  root: string;
  size: number;
  lastUpdated: number;
  proofs: Record<string, string[]>;
}

export interface IdentityVerificationRequest {
  userId: string;
  credentialId: string;
  proofType: 'age' | 'identity' | 'kyb';
  circuitInputs: Record<string, any>;
  timestamp: number;
}

export interface VerificationResult {
  success: boolean;
  proofValid: boolean;
  credentialValid: boolean;
  notRevoked: boolean;
  timestamp: number;
  auditId: string;
}

export interface Issuer {
  id: string;
  name: string;
  publicKey: string;
  trusted: boolean;
  createdAt: number;
}

export interface ZKConfig {
  circuitPaths: {
    ageVerification: string;
    identityVerification: string;
    kybVerification: string;
  };
  zkeyPaths: {
    ageVerification: string;
    identityVerification: string;
    kybVerification: string;
  };
  verificationKeys: {
    ageVerification: string;
    identityVerification: string;
    kybVerification: string;
  };
}

export interface AgeVerificationInput {
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  currentYear: number;
  currentMonth: number;
  currentDay: number;
  minAge: number;
}

export interface IdentityVerificationInput {
  userIdHash: string;
  claimHash: string;
  issuerSignature: string[];
  nullifierHash: string;
  timestamp: number;
}

export interface KYBVerificationInput {
  businessIdHash: string;
  registrationNumber: string;
  incorporationDate: number;
  jurisdiction: number;
  businessType: number;
  issuerSignature: string[];
}

export interface MerkleProof {
  leaf: string;
  root: string;
  siblings: string[];
  path: number[];
}

export interface CircuitCompilationResult {
  wasmPath: string;
  zkeyPath: string;
  verificationKey: any;
  success: boolean;
  error?: string;
}

export interface ProofGenerationStats {
  circuitType: string;
  generationTime: number;
  verificationTime: number;
  proofSize: number;
  success: boolean;
}

export interface ComplianceAudit {
  auditId: string;
  verificationId: string;
  timestamp: number;
  proofHash: string;
  complianceStatus: 'compliant' | 'non_compliant' | 'pending';
  privacyLevel: 'full' | 'partial' | 'zero_knowledge';
  dataShared: string[];
  dataProtected: string[];
}

export interface CredentialRequest {
  userId: string;
  claimType: string;
  claimData: Record<string, any>;
  issuerId: string;
  requestedAt: number;
}

export interface CredentialResponse {
  credentialId: string;
  credential: Credential;
  issuedAt: number;
  expiresAt: number;
}

export interface RevocationRequest {
  credentialId: string;
  reason: string;
  revokedBy: string;
  revokedAt: number;
}

export interface ZKVerificationSession {
  sessionId: string;
  userId: string;
  proofType: string;
  status: 'initiated' | 'proof_generated' | 'verified' | 'failed';
  createdAt: number;
  expiresAt: number;
  proof?: ZKProof;
  result?: VerificationResult;
}

export interface PrivacyMetrics {
  zeroKnowledgeProofs: number;
  dataItemsProtected: number;
  dataItemsShared: number;
  privacyScore: number;
  timestamp: number;
}

export interface CircuitMetrics {
  circuitName: string;
  totalProofs: number;
  successfulProofs: number;
  averageProofTime: number;
  averageVerificationTime: number;
  lastUpdated: number;
}

export interface IdentityProvider {
  id: string;
  name: string;
  type: 'government' | 'financial' | 'educational' | 'corporate';
  endpoint: string;
  publicKey: string;
  supportedClaims: string[];
  trusted: boolean;
  createdAt: number;
}

export interface ClaimDefinition {
  id: string;
  name: string;
  description: string;
  dataType: 'string' | 'number' | 'boolean' | 'date';
  required: boolean;
  verificationCircuit: string;
  privacyLevel: 'public' | 'private' | 'zero_knowledge';
}

export interface VerificationPolicy {
  id: string;
  name: string;
  description: string;
  requiredClaims: string[];
  minimumAge?: number;
  businessVerificationRequired: boolean;
  revocationCheckRequired: boolean;
  createdAt: number;
  active: boolean;
}

export interface BatchVerificationRequest {
  requests: IdentityVerificationRequest[];
  batchId: string;
  requestedAt: number;
}

export interface BatchVerificationResult {
  batchId: string;
  results: VerificationResult[];
  totalProcessed: number;
  successful: number;
  failed: number;
  processedAt: number;
}

export enum ProofType {
  AGE_VERIFICATION = 'age_verification',
  IDENTITY_VERIFICATION = 'identity_verification',
  KYB_VERIFICATION = 'kyb_verification',
  CUSTOM_VERIFICATION = 'custom_verification'
}

export enum VerificationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired'
}

export enum PrivacyLevel {
  PUBLIC = 'public',
  PRIVATE = 'private',
  ZERO_KNOWLEDGE = 'zero_knowledge'
}

export enum CredentialStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
  SUSPENDED = 'suspended'
}

export enum IssuerType {
  GOVERNMENT = 'government',
  FINANCIAL = 'financial',
  EDUCATIONAL = 'educational',
  CORPORATE = 'corporate',
  TRUSTED_THIRD_PARTY = 'trusted_third_party'
}
