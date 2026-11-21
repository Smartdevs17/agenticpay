import { Router } from 'express';
import { AgentMarketplace, type SignedManifest } from '../services/agentMarketplace.js';

export const agentMarketplace = new AgentMarketplace();
export const agentMarketplaceRouter = Router();

agentMarketplaceRouter.get('/manifests', (_req, res) => {
  res.json({ data: agentMarketplace.list().map(({ manifest, digest }) => ({ ...manifest, digest })) });
});

agentMarketplaceRouter.post('/manifests/verify', (req, res) => {
  const entry = req.body as SignedManifest;
  if (!entry?.manifest || !entry.digest || !entry.publicKey || !entry.signature) {
    return res.status(400).json({ error: 'signed manifest is required' });
  }
  return res.json({ valid: agentMarketplace.verify(entry) });
});
