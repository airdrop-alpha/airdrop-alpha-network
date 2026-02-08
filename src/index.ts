// ============================================================
// AirdropAlpha — Entry Point (Phase 2)
// ============================================================
//
// AI-powered Solana airdrop intelligence service with:
// - Real on-chain airdrop discovery (Solana devnet)
// - Protocol-specific scanning (Jupiter, Marinade, Drift, Jito)
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
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║         🪂  AirdropAlpha  v0.2.0              ║');
  console.log('  ║   Solana Airdrop Intelligence Network          ║');
  console.log('  ║   Phase 2 — Real On-Chain Data                 ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');

  // Initialize components
  console.log('[Boot] Initializing components...');

  const scanner = new SolanaScanner();
  const safety = new SafetyModule();
  const executor = new Executor();

  // Boot strategy:
  // 1. Always seed demo data first (ensures API has data immediately)
  // 2. Start scanner to overlay real data on top
  // 3. Real data replaces demo data as it arrives

  if (config.demoMode) {
    console.log('[Boot] Demo mode enabled — seeding baseline data...');
    scanner.seedDemoData();
  }

  // Start the scanner (real on-chain scanning)
  const scanIntervalMs = config.nodeEnv === 'development' ? 120_000 : 60_000;
  console.log(`[Boot] Starting scanner (interval: ${scanIntervalMs / 1000}s)...`);
  scanner.start(scanIntervalMs);

  // Create and start API server (don't block on safety analysis)
  const app = createServer(scanner, safety, executor);
  await startServer(app);

  // Run initial safety analysis in background (non-blocking)
  setTimeout(async () => {
    console.log('[Boot] Running background safety analysis on top opportunities...');
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
        console.warn(`[Safety] Background analysis skipped for ${opp.name}:`, (error as Error).message?.slice(0, 60));
      }
    }
    console.log('[Safety] Background analysis complete.');
  }, 2000);

  // Print boot summary
  const stats = scanner.getStats();
  console.log('');
  console.log('[Boot] ✅ AirdropAlpha is running!');
  console.log(`[Boot]    Version:      v0.2.0 (Phase 2)`);
  console.log(`[Boot]    API:          http://localhost:${config.port}`);
  console.log(`[Boot]    Skill:        http://localhost:${config.port}/skill.json`);
  console.log(`[Boot]    Opportunities: http://localhost:${config.port}/api/opportunities`);
  console.log(`[Boot]    Network:      Solana ${config.nodeEnv === 'development' ? 'Devnet' : 'Mainnet'}`);
  console.log(`[Boot]    RPC:          ${config.heliusApiKey ? 'Helius (enhanced)' : 'Public devnet'}`);
  console.log(`[Boot]    Demo mode:    ${config.demoMode ? 'ON' : 'OFF'}`);
  console.log(`[Boot]    Opportunities: ${stats.totalOpportunities}`);
  console.log(`[Boot]    Protocols:    ${stats.protocols.join(', ')}`);
  console.log(`[Boot]    Payment:      x402 (USDC)`);
  console.log(`[Boot]    Executor:     ${executor.isReady() ? 'Ready' : 'Simulation mode'}`);
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
