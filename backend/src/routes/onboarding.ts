import { Router } from 'express';
import { OnboardingService } from '../services/onboarding.js';
import { validate } from '../middleware/validate.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import {
  createOnboardingSchema,
  updateOnboardingTaskSchema,
  submitDocumentSchema,
  skipTaskSchema,
  adminReviewSchema,
} from '../schemas/index.js';

export const onboardingRouter = Router();

// Create new merchant onboarding
onboardingRouter.post(
  '/',
  validate(createOnboardingSchema),
  asyncHandler(async (req, res) => {
    const onboarding = await OnboardingService.createOnboarding(req.body);
    res.status(201).json({
      success: true,
      data: onboarding,
    });
  })
);

// Get onboarding by ID
onboardingRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const onboarding = await OnboardingService.getOnboarding(id);

    if (!onboarding) {
      throw new AppError(404, 'Onboarding not found', 'ONBOARDING_NOT_FOUND');
    }

    res.json({
      success: true,
      data: onboarding,
    });
  })
);

// Get onboarding by merchant ID
onboardingRouter.get(
  '/merchant/:merchantId',
  asyncHandler(async (req, res) => {
    const { merchantId } = req.params;
    const onboarding = await OnboardingService.getOnboardingByMerchant(merchantId);

    if (!onboarding) {
      throw new AppError(404, 'Onboarding not found for merchant', 'ONBOARDING_NOT_FOUND');
    }

    res.json({
      success: true,
      data: onboarding,
    });
  })
);

// Update task status
onboardingRouter.patch(
  '/:id/task',
  validate(updateOnboardingTaskSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const onboarding = await OnboardingService.updateTask(id, req.body);

    res.json({
      success: true,
      data: onboarding,
    });
  })
);

// Submit document for task
onboardingRouter.post(
  '/:id/document',
  validate(submitDocumentSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const onboarding = await OnboardingService.submitDocument(id, req.body);

    res.json({
      success: true,
      data: onboarding,
    });
  })
);

// Skip optional task
onboardingRouter.post(
  '/:id/skip',
  validate(skipTaskSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const onboarding = await OnboardingService.skipTask(id, req.body);

    res.json({
      success: true,
      data: onboarding,
    });
  })
);

// Submit onboarding for review
onboardingRouter.post(
  '/:id/submit',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const onboarding = await OnboardingService.submitForReview(id);

    res.json({
      success: true,
      data: onboarding,
    });
  })
);

// Admin review onboarding (requires admin auth - simplified for now)
onboardingRouter.post(
  '/:id/review',
  validate(adminReviewSchema),
  asyncHandler(async (req, res) => {
    const onboarding = await OnboardingService.adminReview(req.body);

    res.json({
      success: true,
      data: onboarding,
    });
  })
);

// Get all onboardings (admin endpoint)
onboardingRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status } = req.query as { status?: string };
    const onboardings = await OnboardingService.getAllOnboardings(
      status as any // Type assertion for simplicity
    );

    res.json({
      success: true,
      data: onboardings,
      count: onboardings.length,
    });
  })
);