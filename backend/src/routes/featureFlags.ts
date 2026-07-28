import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { featureFlagEngine } from '../services/featureFlags.js';

export const featureFlagsRouter = Router();

// Get all flags
featureFlagsRouter.get('/', asyncHandler(async (_req: Request, res: Response) => {
    const flags = featureFlagEngine.getAllFlags();
    res.json({
        flags: flags.map(f => ({
            name: f.name,
            enabled: f.enabled,
            rolloutPercentage: f.rolloutPercentage,
            targetedUsers: Array.from(f.targetedUsers),
            metrics: f.metrics,
        })),
    });
}));

// Get a specific flag
featureFlagsRouter.get('/:name', asyncHandler(async (req: Request, res: Response) => {
    const flag = featureFlagEngine.getFlag(req.params.name);
    if (!flag) {
        res.status(404).json({ error: 'Flag not found' });
        return;
    }
    res.json({
        name: flag.name,
        enabled: flag.enabled,
        rolloutPercentage: flag.rolloutPercentage,
        targetedUsers: Array.from(flag.targetedUsers),
        metrics: flag.metrics,
    });
}));

// Create or update a flag
featureFlagsRouter.put('/:name', asyncHandler(async (req: Request, res: Response) => {
    const { name } = req.params;
    const { enabled, rolloutPercentage, targetedUsers } = req.body;

    if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled (boolean) is required' });
        return;
    }

    featureFlagEngine.upsertFlag(
        name,
        enabled,
        rolloutPercentage ?? 0,
        targetedUsers ?? [],
    );

    res.json({ success: true, name });
}));

// Delete a flag
featureFlagsRouter.delete('/:name', asyncHandler(async (req: Request, res: Response) => {
    const flag = featureFlagEngine.getFlag(req.params.name);
    if (!flag) {
        res.status(404).json({ error: 'Flag not found' });
        return;
    }
    featureFlagEngine.deleteFlag(req.params.name);
    res.json({ success: true });
}));

// Evaluate a flag for a user
featureFlagsRouter.post('/:name/evaluate', asyncHandler(async (req: Request, res: Response) => {
    const { name } = req.params;
    const { identifier } = req.body;

    if (!identifier) {
        res.status(400).json({ error: 'identifier (string) is required' });
        return;
    }

    const result = featureFlagEngine.evaluate(name, identifier);
    const flag = featureFlagEngine.getFlag(name);

    res.json({
        flag: name,
        identifier,
        enabled: result,
        rolloutPercentage: flag?.rolloutPercentage ?? 0,
        targeted: flag?.targetedUsers.has(identifier) ?? false,
    });
}));

// Get flag metrics
featureFlagsRouter.get('/:name/metrics', asyncHandler(async (req: Request, res: Response) => {
    const flag = featureFlagEngine.getFlag(req.params.name);
    if (!flag) {
        res.status(404).json({ error: 'Flag not found' });
        return;
    }
    res.json({
        name: flag.name,
        metrics: flag.metrics,
        totalEvaluations: flag.metrics.servedTrue + flag.metrics.servedFalse,
        truePercentage: flag.metrics.servedTrue + flag.metrics.servedFalse > 0
            ? (flag.metrics.servedTrue / (flag.metrics.servedTrue + flag.metrics.servedFalse)) * 100
            : 0,
    });
}));