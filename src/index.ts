// ============================================================
// AirdropAlpha — Entry Point
// ============================================================
//
// AI-powered Solana airdrop intelligence service with:
// - On-chain airdrop discovery
// - Dual-layer safety scanning (internal + AgentShield)
// - x402-gated REST API
// - Auto-execution engine
// - Agent skill interface (skill.json)
//

import { SolanaScanner } from './scanner/solana-scanner';
import { SafetyModule } from './safety';
import { Executor } from './executor/executor';
import { createServer, startServer } from './api/server';
import { config } from './config';

async function main(): Promise<void> {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║         🪂  AirdropAlpha  v0.1.0         ║');
  console.log('  ║   Solana Airdrop Intelligence Network     ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');

  // Initialize components
  console.log('[Boot] Initializing components...');

  const scanner = new SolanaScanner();
  const safety = new SafetyModule();
  const executor = new Executor();

  // Seed demo data for hackathon
  if (config.nodeEnv === 'development') {
    console.log('[Boot] Development mode — seeding demo data...');
    scanner.seedDemoData();
  }

  // Start the scanner
  const scanIntervalMs = config.nodeEnv === 'development' ? 120_000 : 60_000;
  scanner.start(scanIntervalMs);

  // Run initial safety analysis on demo data
  if (config.nodeEnv === 'development') {
    console.log('[Boot] Running initial safety analysis on demo data...');
    const opportunities = scanner.getOpportunities();
    for (const opp of opportunities.slice(0, 3)) {
      try {
        const report = await safety.analyze(opp.tokenMint, opp.programId);
        scanner.updateOpportunity(opp.id, {
          safetyReport: report,
          safetyScore: report.combinedScore,
          riskLevel: report.riskLevel,
        });
      } catch (error) {
        console.warn(`[Boot] Safety analysis failed for ${opp.name}:`, (error as Error).message);
      }
    }
  }

  // Create and start API server
  const app = createServer(scanner, safety, executor);
  await startServer(app);

  console.log('');
  console.log('[Boot] ✅ AirdropAlpha is running!');
  console.log(`[Boot]    API:      http://localhost:${config.port}`);
  console.log(`[Boot]    Skill:    http://localhost:${config.port}/skill.json`);
  console.log(`[Boot]    Network:  Solana ${config.nodeEnv === 'development' ? 'Devnet' : 'Mainnet'}`);
  console.log(`[Boot]    Payment:  x402 (USDC)`);
  console.log(`[Boot]    Executor: ${executor.isReady() ? 'Ready' : 'Simulation mode'}`);
  console.log('');

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[Shutdown] Stopping AirdropAlpha...');
    scanner.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[Fatal] Failed to start AirdropAlpha:', error);
  process.exit(1);
});
