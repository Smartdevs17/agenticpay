import { Router, Request, Response } from 'express';
import { ZKIdentityService } from '../services/zk-identity-service';
import { 
  IdentityVerificationRequest, 
  VerificationResult, 
  Credential, 
  RevocationList,
  AgeVerificationInput,
  IdentityVerificationInput,
  KYBVerificationInput
} from '../types/zk-types';
import { validateInput } from '../middleware/sanitize';
import { z } from 'zod';

const router = Router();
const zkService = new ZKIdentityService();

// Validation schemas
const ageVerificationSchema = z.object({
  birthYear: z.number().min(1900).max(2024),
  birthMonth: z.number().min(1).max(12),
  birthDay: z.number().min(1).max(31),
  currentYear: z.number().min(2024).max(2100),
  currentMonth: z.number().min(1).max(12),
  currentDay: z.number().min(1).max(31),
  minAge: z.number().min(13).max(120)
});

const identityVerificationSchema = z.object({
  userIdHash: z.string().min(64).max(64),
  claimHash: z.string().min(64).max(64),
  issuerSignature: z.array(z.string().min(1)).length(3),
  nullifierHash: z.string().min(64).max(64),
  timestamp: z.number().min(0)
});

const kybVerificationSchema = z.object({
  businessIdHash: z.string().min(64).max(64),
  registrationNumber: z.string().min(1).max(50),
  incorporationDate: z.number().min(0),
  jurisdiction: z.number().min(1).max(999),
  businessType: z.number().min(1).max(10),
  issuerSignature: z.array(z.string().min(1)).length(3)
});

/**
 * Generate age verification proof
 */
router.post('/prove/age', validateInput(ageVerificationSchema), async (req: Request, res: Response) => {
  try {
    const input: AgeVerificationInput = req.body;
    
    // Generate ZK proof
    const proof = await zkService.generateAgeProof(input);
    
    // Verify proof
    const verified = await zkService.verifyProof(proof);
    
    res.json({
      success: true,
      proof,
      verified,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Age proof generation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Age proof generation failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Generate identity verification proof
 */
router.post('/prove/identity', validateInput(identityVerificationSchema), async (req: Request, res: Response) => {
  try {
    const input: IdentityVerificationInput = req.body;
    
    // Generate ZK proof
    const proof = await zkService.generateIdentityProof(input);
    
    // Verify proof
    const verified = await zkService.verifyProof(proof);
    
    res.json({
      success: true,
      proof,
      verified,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Identity proof generation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Identity proof generation failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Generate KYB verification proof
 */
router.post('/prove/kyb', validateInput(kybVerificationSchema), async (req: Request, res: Response) => {
  try {
    const input: KYBVerificationInput = req.body;
    
    // Generate ZK proof
    const proof = await zkService.generateKYBProof(input);
    
    // Verify proof
    const verified = await zkService.verifyProof(proof);
    
    res.json({
      success: true,
      proof,
      verified,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('KYB proof generation failed:', error);
    res.status(500).json({
      success: false,
      error: 'KYB proof generation failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Verify existing ZK proof
 */
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { proof } = req.body;
    
    if (!proof) {
      return res.status(400).json({
        success: false,
        error: 'Proof is required'
      });
    }
    
    // Verify proof
    const verified = await zkService.verifyProof(proof);
    
    res.json({
      success: true,
      verified,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Proof verification failed:', error);
    res.status(500).json({
      success: false,
      error: 'Proof verification failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Create new credential
 */
router.post('/credentials', async (req: Request, res: Response) => {
  try {
    const { userId, claims, issuerPrivateKey, expirationDate } = req.body;
    
    if (!userId || !claims || !issuerPrivateKey || !expirationDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, claims, issuerPrivateKey, expirationDate'
      });
    }
    
    // Create credential
    const credential = await zkService.createCredential({
      userId,
      claims,
      issuerPrivateKey,
      expirationDate
    });
    
    res.json({
      success: true,
      credential,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Credential creation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Credential creation failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Verify credential signature
 */
router.post('/credentials/verify-signature', async (req: Request, res: Response) => {
  try {
    const { credential, issuerPublicKey } = req.body;
    
    if (!credential || !issuerPublicKey) {
      return res.status(400).json({
        success: false,
        error: 'Credential and issuerPublicKey are required'
      });
    }
    
    // Verify signature
    const verified = await zkService.verifyCredentialSignature(credential, issuerPublicKey);
    
    res.json({
      success: true,
      verified,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Credential signature verification failed:', error);
    res.status(500).json({
      success: false,
      error: 'Credential signature verification failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Check credential revocation status
 */
router.post('/credentials/check-revocation', async (req: Request, res: Response) => {
  try {
    const { credentialId, revocationList } = req.body;
    
    if (!credentialId || !revocationList) {
      return res.status(400).json({
        success: false,
        error: 'CredentialId and revocationList are required'
      });
    }
    
    // Check revocation status
    const notRevoked = await zkService.checkRevocationStatus(credentialId, revocationList);
    
    res.json({
      success: true,
      notRevoked,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Revocation status check failed:', error);
    res.status(500).json({
      success: false,
      error: 'Revocation status check failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Update revocation list
 */
router.post('/revocation-list', async (req: Request, res: Response) => {
  try {
    const { revokedCredentials } = req.body;
    
    if (!Array.isArray(revokedCredentials)) {
      return res.status(400).json({
        success: false,
        error: 'RevokedCredentials must be an array'
      });
    }
    
    // Update revocation list
    const revocationList = await zkService.updateRevocationList(revokedCredentials);
    
    res.json({
      success: true,
      revocationList,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Revocation list update failed:', error);
    res.status(500).json({
      success: false,
      error: 'Revocation list update failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Generate audit trail
 */
router.post('/audit', async (req: Request, res: Response) => {
  try {
    const verificationRequest: IdentityVerificationRequest = req.body;
    
    if (!verificationRequest.userId || !verificationRequest.credentialId) {
      return res.status(400).json({
        success: false,
        error: 'Verification request missing required fields'
      });
    }
    
    // Generate audit trail
    const auditTrail = await zkService.generateAuditTrail(verificationRequest);
    
    res.json({
      success: true,
      auditTrail,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Audit trail generation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Audit trail generation failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get verification statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await zkService.getVerificationStats();
    
    res.json({
      success: true,
      stats,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Failed to get verification stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get verification stats',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Batch verification endpoint
 */
router.post('/batch-verify', async (req: Request, res: Response) => {
  try {
    const { requests } = req.body;
    
    if (!Array.isArray(requests)) {
      return res.status(400).json({
        success: false,
        error: 'Requests must be an array'
      });
    }
    
    const results = [];
    
    for (const request of requests) {
      try {
        const proof = await zkService.generateIdentityProof(request.circuitInputs);
        const verified = await zkService.verifyProof(proof);
        
        results.push({
          requestId: request.userId,
          success: true,
          verified,
          proof,
          timestamp: Date.now()
        });
      } catch (error) {
        results.push({
          requestId: request.userId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now()
        });
      }
    }
    
    const successful = results.filter(r => r.success).length;
    
    res.json({
      success: true,
      batchId: `batch_${Date.now()}`,
      totalProcessed: results.length,
      successful,
      failed: results.length - successful,
      results,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Batch verification failed:', error);
    res.status(500).json({
      success: false,
      error: 'Batch verification failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Health check for ZK service
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const stats = await zkService.getVerificationStats();
    
    res.json({
      success: true,
      status: 'healthy',
      supportedCircuits: stats.supportedCircuits,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now()
    });
  }
});

export default router;
