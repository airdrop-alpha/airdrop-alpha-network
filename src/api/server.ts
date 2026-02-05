// ============================================================
// Express Server — x402-gated API with CORS and error handling
// ============================================================

import express, { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { x402PaymentMiddleware } from './x402-middleware';
import { createRoutes } from './routes';
import { SolanaScanner } from '../scanner/solana-scanner';
import { SafetyModule } from '../safety';
import { Executor } from '../executor/executor';

export function createServer(
  scanner: SolanaScanner,
  safety: SafetyModule,
  executor: Executor,
): express.Application {
  const app = express();

  // ---- Middleware ----

  // Parse JSON bodies
  app.use(express.json());

  // CORS — allow all origins for hackathon demo
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Payment, Authorization');
    res.header('Access-Control-Expose-Headers', 'X-Payment-Required');

    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const start = Date.now();
    _res.on('finish', () => {
      const duration = Date.now() - start;
      const payment = req.headers['x-payment'] ? ' [x402]' : '';
      console.log(
        `[API] ${req.method} ${req.path} → ${_res.statusCode} (${duration}ms)${payment}`,
      );
    });
    next();
  });

  // x402 payment middleware
  app.use(x402PaymentMiddleware());

  // ---- Routes ----

  // Root — API info
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      name: 'AirdropAlpha',
      version: '0.1.0',
      description: 'Solana airdrop intelligence with safety scanning and auto-execution',
      endpoints: {
        'GET /health': 'Health check (free)',
        'GET /skill.json': 'Agent skill descriptor (free)',
        'GET /airdrops': 'List opportunities (free tier: top 3, paid: all)',
        'GET /airdrops/:id': 'Detailed analysis (0.05 USDC)',
        'GET /airdrops/:id/safety': 'Safety report (0.10 USDC)',
        'POST /airdrops/:id/execute': 'Auto-execute claim (1.00 USDC)',
        'GET /executions/:id': 'Execution status (free)',
      },
      payment: {
        protocol: 'x402',
        currency: 'USDC',
        network: 'solana',
        docs: 'https://www.x402.org/',
      },
      safety: {
        internal: 'On-chain heuristic analysis',
        external: 'AgentShield integration (https://agentshield.lobsec.org)',
      },
    });
  });

  // API routes
  app.use(createRoutes(scanner, safety, executor));

  // ---- Error Handling ----

  // 404
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'Not found',
      timestamp: new Date().toISOString(),
    });
  });

  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[API] Unhandled error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}

/**
 * Start the API server
 */
export function startServer(app: express.Application): Promise<void> {
  return new Promise((resolve) => {
    app.listen(config.port, () => {
      console.log(`[API] AirdropAlpha API running on http://localhost:${config.port}`);
      console.log(`[API] Skill descriptor: http://localhost:${config.port}/skill.json`);
      console.log(`[API] Health check: http://localhost:${config.port}/health`);
      resolve();
    });
  });
}
