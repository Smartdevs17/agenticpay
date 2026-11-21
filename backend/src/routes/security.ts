/**
 * security.ts — Issue #594
 *
 * Security scanning REST API routes.
 *
 * POST   /security/scans                           — start a scan
 * POST   /security/scans/:id/complete              — complete a scan with findings
 * GET    /security/scans/:id                       — get scan report
 * GET    /security/scans                           — list scan reports
 * GET    /security/vulnerabilities                 — list vulnerabilities (with filters)
 * GET    /security/vulnerabilities/:id             — get a vulnerability
 * PATCH  /security/vulnerabilities/:id/status      — update vulnerability status
 * POST   /security/vulnerabilities/:id/assign      — assign for remediation
 * GET    /security/score                           — current security score
 * GET    /security/score/history                   — score history
 * GET    /security/overdue                         — overdue SLA summary
 */

import { Router, type Request, type Response } from 'express';
import { securityService } from '../services/security.js';
import type {
  ScanType,
  VulnerabilitySeverity,
  VulnerabilityStatus,
} from '../services/security.js';

const router = Router();

// ── POST /security/scans ──────────────────────────────────────────────────────

router.post('/scans', (req: Request, res: Response) => {
  const { scanType, triggeredBy } = req.body as {
    scanType?: string;
    triggeredBy?: string;
  };

  if (!scanType) {
    return res.status(400).json({ success: false, error: 'scanType is required' });
  }

  const valid: ScanType[] = ['sast', 'dast', 'dependency', 'smart_contract'];
  if (!valid.includes(scanType as ScanType)) {
    return res.status(400).json({
      success: false,
      error: `scanType must be one of: ${valid.join(', ')}`,
    });
  }

  const result = securityService.startScan(scanType as ScanType, triggeredBy);
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 400).json({
      success: false,
      error: result.error.message,
    });
  }

  return res.status(201).json({ success: true, data: result.value });
});

// ── POST /security/scans/:id/complete ────────────────────────────────────────

router.post('/scans/:id/complete', (req: Request, res: Response) => {
  const { findings } = req.body as { findings?: unknown[] };
  if (!Array.isArray(findings)) {
    return res.status(400).json({ success: false, error: 'findings array is required' });
  }

  const result = securityService.completeScan(req.params.id, findings as Parameters<typeof securityService.completeScan>[1]);
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 400).json({
      success: false,
      error: result.error.message,
    });
  }

  return res.json({ success: true, data: result.value });
});

// ── GET /security/scans ───────────────────────────────────────────────────────

router.get('/scans', (req: Request, res: Response) => {
  const { limit } = req.query as { limit?: string };
  const reports = securityService.listScanReports(limit ? parseInt(limit) : 20);
  return res.json({ success: true, count: reports.length, data: reports });
});

// ── GET /security/scans/:id ───────────────────────────────────────────────────

router.get('/scans/:id', (req: Request, res: Response) => {
  const result = securityService.getScanReport(req.params.id);
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 404).json({
      success: false,
      error: result.error.message,
    });
  }
  return res.json({ success: true, data: result.value });
});

// ── GET /security/vulnerabilities ─────────────────────────────────────────────

router.get('/vulnerabilities', (req: Request, res: Response) => {
  const { severity, status, scanType, overdue } = req.query as {
    severity?: string;
    status?: string;
    scanType?: string;
    overdue?: string;
  };

  const vulns = securityService.listVulnerabilities({
    severity: severity as VulnerabilitySeverity | undefined,
    status: status as VulnerabilityStatus | undefined,
    scanType: scanType as ScanType | undefined,
    overdue: overdue === 'true',
  });

  return res.json({ success: true, count: vulns.length, data: vulns });
});

// ── GET /security/vulnerabilities/:id ────────────────────────────────────────

router.get('/vulnerabilities/:id', (req: Request, res: Response) => {
  const result = securityService.getVulnerability(req.params.id);
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 404).json({
      success: false,
      error: result.error.message,
    });
  }
  return res.json({ success: true, data: result.value });
});

// ── PATCH /security/vulnerabilities/:id/status ───────────────────────────────

router.patch('/vulnerabilities/:id/status', (req: Request, res: Response) => {
  const { status, notes } = req.body as { status?: string; notes?: string };
  if (!status) {
    return res.status(400).json({ success: false, error: 'status is required' });
  }

  const result = securityService.updateVulnerabilityStatus(
    req.params.id,
    status as VulnerabilityStatus,
    notes,
  );

  if (!result.ok) {
    return res.status(result.error.statusCode ?? 400).json({
      success: false,
      error: result.error.message,
    });
  }

  return res.json({ success: true, data: result.value });
});

// ── POST /security/vulnerabilities/:id/assign ────────────────────────────────

router.post('/vulnerabilities/:id/assign', (req: Request, res: Response) => {
  const { assignedTo, notes } = req.body as { assignedTo?: string; notes?: string };
  if (!assignedTo) {
    return res.status(400).json({ success: false, error: 'assignedTo is required' });
  }

  const result = securityService.assignRemediation(req.params.id, assignedTo, notes);
  if (!result.ok) {
    return res.status(result.error.statusCode ?? 400).json({
      success: false,
      error: result.error.message,
    });
  }

  return res.json({ success: true, data: result.value });
});

// ── GET /security/score ───────────────────────────────────────────────────────

router.get('/score', (_req: Request, res: Response) => {
  return res.json({ success: true, data: securityService.getCurrentScore() });
});

// ── GET /security/score/history ───────────────────────────────────────────────

router.get('/score/history', (req: Request, res: Response) => {
  const { days } = req.query as { days?: string };
  const history = securityService.getScoreHistory(days ? parseInt(days) : 30);
  return res.json({ success: true, count: history.length, data: history });
});

// ── GET /security/overdue ─────────────────────────────────────────────────────

router.get('/overdue', (_req: Request, res: Response) => {
  return res.json({ success: true, data: securityService.getOverdueSummary() });
});

export default router;
