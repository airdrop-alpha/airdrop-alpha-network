// ============================================================
// Express Server — x402-gated API with CORS and error handling
// ============================================================

import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
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

  // ---- Dashboard (static files) ----
  // Serve the dashboard at root — resolve from source or dist location
  const dashboardDir = path.resolve(__dirname, '..', 'dashboard');
  const dashboardDirSrc = path.resolve(__dirname, '..', '..', 'src', 'dashboard');
  // Try source dir first (dev), fall back to relative to compiled output
  const fs = require('fs');
  const serveDashDir = fs.existsSync(dashboardDirSrc) ? dashboardDirSrc : dashboardDir;
  app.use(express.static(serveDashDir));

  // ---- Routes ----

  // API info (moved from / to /api/info so dashboard can serve at root)
  app.get('/api/info', (_req: Request, res: Response) => {
    res.json({
      name: 'AirdropAlpha',
      version: '0.2.0',
      description: 'AI-powered Solana airdrop intelligence with real on-chain data, safety scanning, and auto-execution',
      phase: 'Phase 2 — Real Solana Data Integration',
      endpoints: {
        'GET /health': 'Health check + scanner stats (free)',
        'GET /skill.json': 'Agent skill descriptor (free)',
        'GET /api/opportunities': 'All opportunities — no paywall (free)',
        'GET /api/scanner/stats': 'Scanner statistics (free)',
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
      dataSource: {
        network: 'Solana Devnet',
        protocols: ['Jupiter', 'Marinade', 'Drift', 'Jito', 'Tensor', 'Parcl'],
        scanning: 'Real on-chain data + heuristic analysis',
      },
    });
  });

  // Agent info endpoint (for dashboard)
  app.get('/api/agent/info', (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        name: 'AirdropAlpha',
        version: '0.2.0',
        description: 'AI-powered Solana airdrop intelligence with real on-chain data, safety scanning, and auto-execution',
        phase: 'Phase 2 — Real Solana Data Integration',
        demoMode: config.demoMode,
        protocols: ['Jupiter', 'Marinade', 'Drift', 'Jito', 'Tensor', 'Parcl'],
        payment: {
          protocol: 'x402',
          currency: 'USDC',
          network: 'solana',
        },
      },
      timestamp: new Date().toISOString(),
    });
  });

  // Safety scanner endpoint (for dashboard — analyze any address)
  app.get('/api/safety/:address', async (req: Request, res: Response) => {
    const address = String(req.params.address);
    try {
      const report = await safety.analyze(address);
      res.json({
        success: true,
        data: report,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Safety analysis failed',
        details: (error as Error).message,
        timestamp: new Date().toISOString(),
      });
    }
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
