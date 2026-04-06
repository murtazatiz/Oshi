import { Router, type Request, type Response } from 'express';

// ─────────────────────────────────────────────────────────────────────────────
// Health check endpoint
// PRD §1.4: Railway auto-scaling uses this endpoint to verify the service is up.
// GET /health → 200 { status: 'ok', timestamp: ISO8601, environment: string }
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

interface HealthResponse {
  status: 'ok';
  timestamp: string;
  environment: string;
  version: string;
}

router.get('/', (_req: Request, res: Response<HealthResponse>) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development',
    version: process.env.npm_package_version ?? '1.0.0',
  });
});

export default router;
