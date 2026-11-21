import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { vaultService, VaultConfig, SecretData, LeaseData } from '../services/secrets/vault.js';

export const secretsRouter = Router();

secretsRouter.get('/status', asyncHandler(async (req, res) => {
  const status = vaultService.getStatus();
  res.json(status);
}));

secretsRouter.post('/connect', asyncHandler(async (req, res) => {
  const config: Partial<VaultConfig> = req.body;
  vaultService.initialize(config);
  const connected = await vaultService.connect();
  res.json({ connected });
}));

secretsRouter.post('/disconnect', asyncHandler(async (req, res) => {
  await vaultService.disconnect();
  res.json({ success: true });
}));

secretsRouter.get('/health', asyncHandler(async (req, res) => {
  const status = vaultService.getStatus();
  res.json({
    healthy: status.connected,
    ...status,
  });
}));

secretsRouter.get('/:key', asyncHandler(async (req, res) => {
  const { key } = req.params;
  const secret = await vaultService.getSecret(key);
  
  if (!secret) {
    res.status(404).json({ error: 'Secret not found' });
    return;
  }
  
  res.json(secret);
}));

secretsRouter.post('/:key', asyncHandler(async (req, res) => {
  const { key } = req.params;
  const { value, ...options } = req.body;
  
  if (!value) {
    res.status(400).json({ error: 'value is required' });
    return;
  }
  
  const secret = await vaultService.setSecret(key, value, options);
  res.json({ success: true, secret });
}));

secretsRouter.delete('/:key', asyncHandler(async (req, res) => {
  const { key } = req.params;
  const { versions } = req.query;
  
  await vaultService.deleteSecret(key, versions ? { versions: (versions as string).split(',').map(Number) } : undefined);
  res.json({ success: true, message: `Secret ${key} deleted` });
}));

secretsRouter.get('/metadata/:key', asyncHandler(async (req, res) => {
  const { key } = req.params;
  const metadata = await vaultService.getSecretMetadata(key);
  
  if (!metadata) {
    res.status(404).json({ error: 'Secret not found or Vault not connected' });
    return;
  }
  
  res.json(metadata);
}));

secretsRouter.get('/list/:path(*)', asyncHandler(async (req, res) => {
  const { path } = req.params;
  const secrets = await vaultService.listSecrets(path);
  res.json({ path, secrets });
}));

secretsRouter.post('/database/credentials/:role', asyncHandler(async (req, res) => {
  const { role } = req.params;
  const credentials = await vaultService.getDatabaseCredentials(role);
  res.json(credentials);
}));

secretsRouter.post('/lease/renew', asyncHandler(async (req, res) => {
  const { leaseId } = req.body;
  
  if (!leaseId) {
    res.status(400).json({ error: 'leaseId is required' });
    return;
  }
  
  const renewed = await vaultService.renewLease(leaseId);
  res.json(renewed);
}));

secretsRouter.post('/lease/revoke', asyncHandler(async (req, res) => {
  const { leaseId } = req.body;
  
  if (!leaseId) {
    res.status(400).json({ error: 'leaseId is required' });
    return;
  }
  
  await vaultService.revokeLease(leaseId);
  res.json({ success: true, message: 'Lease revoked' });
}));

secretsRouter.post('/clear-cache', asyncHandler(async (req, res) => {
  vaultService.clearCache();
  res.json({ success: true, message: 'Cache cleared' });
}));