import { Router, type Router as RouterType } from 'express';
import type { HealthResponse } from '@hearth/shared';

const router: RouterType = Router();

router.get('/health', (_req, res) => {
  const response: HealthResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
  };
  res.json(response);
});

export default router;
