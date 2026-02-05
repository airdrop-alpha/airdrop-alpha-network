// ============================================================
// API Routes — x402-gated airdrop intelligence endpoints
// ============================================================

import { Router, Request, Response } from 'express';
import {
  AirdropOpportunity,
  AirdropStatus,
  RiskLevel,
  ApiResponse,
  PaginatedResponse,
} from '../types';
import { SolanaScanner } from '../scanner/solana-scanner';
import { SafetyModule } from '../safety';
import { Executor } from '../executor/executor';
import { generateSkillDescriptor } from '../skill/skill';

const FREE_TIER_LIMIT = 3;

export function createRoutes(
  scanner: SolanaScanner,
  safety: SafetyModule,
  executor: Executor,
): Router {
  const router = Router();

  // ---- Health Check ----
  router.get('/health', (_req: Request, res: Response) => {
    const stats = scanner.getStats();
    const response: ApiResponse<{
      status: string;
      version: string;
      opportunities: number;
      scanner: typeof stats;
      executorReady: boolean;
      uptime: number;
    }> = {
      success: true,
      data: {
        status: 'healthy',
        version: '0.2.0',
        opportunities: scanner.getOpportunities().length,
        scanner: stats,
        executorReady: executor.isReady(),
        uptime: process.uptime(),
      },
      timestamp: new Date().toISOString(),
    };
    res.json(response);
  });

  // ---- Skill Descriptor ----
  router.get('/skill.json', (_req: Request, res: Response) => {
    res.json(generateSkillDescriptor());
  });

  // ---- Convenience alias: /api/opportunities ----
  router.get('/api/opportunities', (req: Request, res: Response) => {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50')), 100);
    const offset = parseInt(String(req.query.offset ?? '0'));
    const minSafety = parseInt(String(req.query.minSafety ?? '0'));
    const statusFilter = req.query.status ? String(req.query.status) : undefined;
    const protocol = req.query.protocol ? String(req.query.protocol) : undefined;

    let opportunities = scanner.getOpportunities();

    // Apply filters
    if (minSafety > 0) {
      opportunities = opportunities.filter(o => o.safetyScore >= minSafety);
    }

    if (statusFilter) {
      const statuses = statusFilter.split(',').map(s => s.trim().toUpperCase());
      opportunities = opportunities.filter(o => statuses.includes(o.status));
    }

    if (protocol) {
      const protocolLC = protocol.toLowerCase();
      opportunities = opportunities.filter(o =>
        o.sourceProtocol.toLowerCase().includes(protocolLC),
      );
    }

    // Exclude SCAM by default
    if (!statusFilter) {
      opportunities = opportunities.filter(o => o.status !== AirdropStatus.SCAM);
    }

    const total = opportunities.length;
    opportunities = opportunities.slice(offset, offset + limit);

    const response: PaginatedResponse<AirdropOpportunity> = {
      success: true,
      data: opportunities,
      total,
      offset,
      limit,
      timestamp: new Date().toISOString(),
    };

    res.json(response);
  });

  // ---- Scanner Stats ----
  router.get('/api/scanner/stats', (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: scanner.getStats(),
      timestamp: new Date().toISOString(),
    });
  });

  // ---- List Airdrops (x402-gated) ----
  router.get('/airdrops', (req: Request, res: Response) => {
    const isPaid = (req as any).x402?.paid === true;

    // Query params
    const limit = Math.min(parseInt(String(req.query.limit ?? '20')), 100);
    const offset = parseInt(String(req.query.offset ?? '0'));
    const minSafety = parseInt(String(req.query.minSafety ?? '0'));
    const statusFilter = req.query.status ? String(req.query.status) : undefined;

    let opportunities = scanner.getOpportunities();

    // Apply filters
    if (minSafety > 0) {
      opportunities = opportunities.filter(o => o.safetyScore >= minSafety);
    }

    if (statusFilter) {
      const statuses = statusFilter.split(',').map(s => s.trim().toUpperCase());
      opportunities = opportunities.filter(o => statuses.includes(o.status));
    }

    // Exclude SCAM from default listings (unless explicitly requested)
    if (!statusFilter) {
      opportunities = opportunities.filter(o => o.status !== AirdropStatus.SCAM);
    }

    const total = opportunities.length;

    // Free tier: limit to top 3 with redacted details
    if (!isPaid) {
      opportunities = opportunities.slice(0, FREE_TIER_LIMIT).map(o => ({
        ...o,
        // Redact detailed info for free tier
        eligibilityCriteria: o.eligibilityCriteria.slice(0, 1),
        safetyReport: null,
        sourceUrl: null,
      }));
    } else {
      opportunities = opportunities.slice(offset, offset + limit);
    }

    const response: PaginatedResponse<AirdropOpportunity> = {
      success: true,
      data: opportunities,
      total,
      offset: isPaid ? offset : 0,
      limit: isPaid ? limit : FREE_TIER_LIMIT,
      timestamp: new Date().toISOString(),
    };

    // Add upgrade hint for free tier
    if (!isPaid) {
      (response as any).notice = {
        message: `Showing ${FREE_TIER_LIMIT} of ${total} opportunities. Pay 0.01 USDC via x402 for full access.`,
        upgrade: 'Include X-Payment header with USDC payment proof',
      };
    }

    res.json(response);
  });

  // ---- Get Airdrop Details ----
  router.get('/airdrops/:id', (req: Request, res: Response) => {
    const opportunity = scanner.getOpportunity(String(req.params.id));

    if (!opportunity) {
      res.status(404).json({
        success: false,
        error: 'Airdrop opportunity not found',
        timestamp: new Date().toISOString(),
      } as ApiResponse<null>);
      return;
    }

    const response: ApiResponse<AirdropOpportunity> = {
      success: true,
      data: opportunity,
      timestamp: new Date().toISOString(),
    };

    res.json(response);
  });

  // ---- Get Safety Report ----
  router.get('/airdrops/:id/safety', async (req: Request, res: Response) => {
    const opportunity = scanner.getOpportunity(String(req.params.id));

    if (!opportunity) {
      res.status(404).json({
        success: false,
        error: 'Airdrop opportunity not found',
        timestamp: new Date().toISOString(),
      } as ApiResponse<null>);
      return;
    }

    try {
      // Run safety analysis (or return cached if recent)
      const cacheAgeMs = opportunity.safetyReport
        ? Date.now() - new Date(opportunity.safetyReport.checkedAt).getTime()
        : Infinity;

      let report = opportunity.safetyReport;

      // Re-analyze if no report or older than 1 hour
      if (!report || cacheAgeMs > 3600_000) {
        report = await safety.analyze(opportunity.tokenMint, opportunity.programId);

        // Update the opportunity with new safety data
        scanner.updateOpportunity(opportunity.id, {
          safetyReport: report,
          safetyScore: report.combinedScore,
          riskLevel: report.riskLevel,
        });
      }

      res.json({
        success: true,
        data: {
          airdropId: opportunity.id,
          airdropName: opportunity.name,
          tokenMint: opportunity.tokenMint,
          report,
        },
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

  // ---- Execute Airdrop Claim ----
  router.post('/airdrops/:id/execute', async (req: Request, res: Response) => {
    const opportunity = scanner.getOpportunity(String(req.params.id));

    if (!opportunity) {
      res.status(404).json({
        success: false,
        error: 'Airdrop opportunity not found',
        timestamp: new Date().toISOString(),
      } as ApiResponse<null>);
      return;
    }

    // Validate opportunity is executable
    if (opportunity.status === AirdropStatus.EXPIRED) {
      res.status(400).json({
        success: false,
        error: 'Airdrop has expired',
        timestamp: new Date().toISOString(),
      } as ApiResponse<null>);
      return;
    }

    if (opportunity.status === AirdropStatus.SCAM) {
      res.status(400).json({
        success: false,
        error: 'Airdrop has been flagged as a scam — execution blocked',
        timestamp: new Date().toISOString(),
      } as ApiResponse<null>);
      return;
    }

    if (opportunity.safetyScore < 30) {
      res.status(400).json({
        success: false,
        error: `Safety score too low (${opportunity.safetyScore}/100). Minimum 30 required for execution.`,
        timestamp: new Date().toISOString(),
      } as ApiResponse<null>);
      return;
    }

    try {
      const result = await executor.executeAirdropClaim(opportunity);

      res.json({
        success: result.status !== 'FAILED',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Execution failed',
        details: (error as Error).message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ---- Get Execution Status ----
  router.get('/executions/:id', (req: Request, res: Response) => {
    const execution = executor.getExecution(String(req.params.id));

    if (!execution) {
      res.status(404).json({
        success: false,
        error: 'Execution not found',
        timestamp: new Date().toISOString(),
      } as ApiResponse<null>);
      return;
    }

    res.json({
      success: true,
      data: execution,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
