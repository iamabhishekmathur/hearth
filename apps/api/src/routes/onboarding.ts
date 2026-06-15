import { Router } from 'express';
import { isOnboardingStep, type OnboardingPatchRequest } from '@hearth/shared';
import { requireAuth } from '../middleware/auth.js';
import * as onboardingService from '../services/onboarding-service.js';

const router: ReturnType<typeof Router> = Router();

/**
 * GET /onboarding — current onboarding status for the authenticated user.
 * Returns { state, nextStep, needsOnboarding }.
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const status = await onboardingService.getStatus(req.user!.id);
    res.json({ data: status });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /onboarding — advance onboarding.
 * Body: { action: 'start' | 'welcome' | 'complete' | 'dismiss', step?, goal? }
 * Returns the updated { state, nextStep, needsOnboarding }.
 */
router.patch('/', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { action, step, goal } = (req.body ?? {}) as OnboardingPatchRequest;

    switch (action) {
      case 'start':
        await onboardingService.startOnboarding(userId);
        break;
      case 'welcome':
        await onboardingService.setWelcome(userId, { goal });
        break;
      case 'complete':
        if (!isOnboardingStep(step)) {
          res.status(400).json({ error: 'A valid `step` is required for action=complete' });
          return;
        }
        await onboardingService.markStepComplete(userId, step);
        break;
      case 'dismiss':
        await onboardingService.dismiss(userId);
        break;
      default:
        res.status(400).json({
          error: 'action must be one of: start, welcome, complete, dismiss',
        });
        return;
    }

    const status = await onboardingService.getStatus(userId);
    res.json({ data: status });
  } catch (err) {
    next(err);
  }
});

export default router;
