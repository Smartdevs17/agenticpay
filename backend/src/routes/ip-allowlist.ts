import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  initIpAllowlist,
  addBypassCode,
  removeBypassCode,
  setAdminIpAllowlist,
  clearAdminIpAllowlist,
  config as ipAllowlistConfig,
} from '../middleware/ip-allowlist.js';

const router = express.Router();

const UpdateConfigSchema = z.object({
  allowedIps: z.array(z.string()),
  enabled: z.boolean().optional(),
});

const AdminAllowlistSchema = z.object({
  allowedIps: z.array(z.string()),
});

const BypassCodeSchema = z.object({
  code: z.string().min(1).max(100),
  expiresInMs: z.number().positive().optional(),
});

const DEFAULT_BYPASS_EXPIRY_MS = 30 * 60 * 1000;

router.get(
  '/config',
  asyncHandler(async (_req, res) => {
    res.json({
      enabled: ipAllowlistConfig.enabled,
      allowedIps: ipAllowlistConfig.allowedIps,
      adminAllowlistsCount: ipAllowlistConfig.adminAllowedIps.size,
      bypassCodesCount: ipAllowlistConfig.bypassCodes.size,
    });
  })
);

router.put(
  '/config',
  asyncHandler(async (req, res) => {
    const body = UpdateConfigSchema.parse(req.body);
    
    initIpAllowlist(body.allowedIps, body.enabled ?? true);
    
    res.json({
      message: 'IP allowlist configuration updated',
      allowedIps: body.allowedIps,
      enabled: body.enabled ?? true,
    });
  })
);

router.post(
  '/bypass',
  asyncHandler(async (req, res) => {
    const body = BypassCodeSchema.parse(req.body);
    
    addBypassCode(body.code, body.expiresInMs ?? DEFAULT_BYPASS_EXPIRY_MS);
    
    res.json({
      message: 'Bypass code created',
      code: body.code,
      expiresInMs: body.expiresInMs ?? DEFAULT_BYPASS_EXPIRY_MS,
    });
  })
);

router.delete(
  '/bypass/:code',
  asyncHandler(async (req, res) => {
    const { code } = req.params;
    
    removeBypassCode(code);
    
    res.json({
      message: 'Bypass code removed',
      code,
    });
  })
);

router.put(
  '/admins/:adminId',
  asyncHandler(async (req, res) => {
    const body = AdminAllowlistSchema.parse(req.body);
    setAdminIpAllowlist(req.params.adminId, body.allowedIps);

    res.json({
      message: 'Admin IP allowlist updated',
      adminId: req.params.adminId,
      allowedIps: body.allowedIps,
    });
  })
);

router.delete(
  '/admins/:adminId',
  asyncHandler(async (req, res) => {
    clearAdminIpAllowlist(req.params.adminId);

    res.json({
      message: 'Admin IP allowlist cleared',
      adminId: req.params.adminId,
    });
  })
);

export const ipAllowlistRouter = router;
