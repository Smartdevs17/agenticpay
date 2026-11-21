/**
 * OnboardingController.ts — Issue #597
 *
 * HTTP layer for onboarding wizard API.
 * Handles request/response only — no business logic here.
 */

import { Request, Response, NextFunction } from 'express';
import { BaseController } from './BaseController.js';
import { OnboardingService } from '../services/onboarding.js';
import { OnboardingAnalyticsService } from '../services/onboardingAnalytics.js';
import { AppError } from '../middleware/errorHandler.js';

export class OnboardingController extends BaseController {
  constructor(
    private readonly onboardingService: typeof OnboardingService,
    private readonly analyticsService: typeof OnboardingAnalyticsService,
  ) {
    super();
  }

  createOnboarding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      this.validateRequired(req.body, ['merchantId', 'businessName', 'businessType', 'contactEmail']);
      const onboarding = await this.onboardingService.createOnboarding(req.body);
      res.status(201).json({ success: true, data: onboarding });
    });
  };

  getOnboarding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const onboarding = await this.onboardingService.getOnboarding(String(req.params.id));
      if (!onboarding) throw new AppError(404, 'Onboarding not found', 'ONBOARDING_NOT_FOUND');
      res.status(200).json({ success: true, data: onboarding });
    });
  };

  getByMerchant = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const onboarding = await this.onboardingService.getOnboardingByMerchant(String(req.params.merchantId));
      if (!onboarding) throw new AppError(404, 'Onboarding not found for merchant', 'ONBOARDING_NOT_FOUND');
      res.status(200).json({ success: true, data: onboarding });
    });
  };

  updateTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const onboarding = await this.onboardingService.updateTask(String(req.params.id), req.body);
      res.status(200).json({ success: true, data: onboarding });
    });
  };

  submitDocument = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const onboarding = await this.onboardingService.submitDocument(String(req.params.id), req.body);
      res.status(200).json({ success: true, data: onboarding });
    });
  };

  skipTask = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const onboarding = await this.onboardingService.skipTask(String(req.params.id), req.body);
      res.status(200).json({ success: true, data: onboarding });
    });
  };

  submitForReview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const onboarding = await this.onboardingService.submitForReview(String(req.params.id));
      res.status(200).json({ success: true, data: onboarding });
    });
  };

  adminReview = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const onboarding = await this.onboardingService.adminReview(req.body);
      res.status(200).json({ success: true, data: onboarding });
    });
  };

  listOnboardings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const { status } = req.query as { status?: string };
      const onboardings = await this.onboardingService.getAllOnboardings(status as any);
      res.status(200).json({ success: true, data: onboardings, count: onboardings.length });
    });
  };

  // ─── Analytics ────────────────────────────────────────────────────────────────

  upsertAnalyticsSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const session = this.analyticsService.upsertSession(req.body);
      res.status(200).json({ success: true, data: session });
    });
  };

  getAnalyticsSummary = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(_req, res, next, async (_req, res) => {
      const summary = this.analyticsService.getSummary();
      res.status(200).json({ success: true, data: summary });
    });
  };

  listAnalyticsSessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const { role, variant } = req.query as { role?: string; variant?: string };
      const sessionList = this.analyticsService.listSessions({ role: role as any, variant: variant as any });
      res.status(200).json({ success: true, data: sessionList, count: sessionList.length });
    });
  };

  getAnalyticsSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const session = this.analyticsService.getSession(String(req.params.sessionId));
      if (!session) throw new AppError(404, 'Session not found', 'SESSION_NOT_FOUND');
      res.status(200).json({ success: true, data: session });
    });
  };
}
