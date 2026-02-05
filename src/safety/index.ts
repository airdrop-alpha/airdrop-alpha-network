// ============================================================
// Safety Module — Combines internal + AgentShield checks
// ============================================================

import { InternalChecker } from './internal-checker';
import { AgentShieldClient } from './agentshield-client';
import {
  SafetyReport,
  SafetyFlag,
  RiskLevel,
} from '../types';

const INTERNAL_WEIGHT = 0.6;
const AGENTSHIELD_WEIGHT = 0.4;

export class SafetyModule {
  private internalChecker: InternalChecker;
  private agentShield: AgentShieldClient;

  constructor() {
    this.internalChecker = new InternalChecker();
    this.agentShield = new AgentShieldClient();
  }

  /**
   * Run full safety analysis on a token
   */
  async analyze(tokenMint: string, programId?: string | null): Promise<SafetyReport> {
    console.log(`[Safety] Analyzing token: ${tokenMint}`);

    // Run both checks in parallel
    const [internalResult, agentShieldResult] = await Promise.allSettled([
      this.internalChecker.checkToken(tokenMint),
      this.runAgentShieldChecks(tokenMint, programId ?? null),
    ]);

    // Extract results
    const internal = internalResult.status === 'fulfilled' ? internalResult.value : null;
    const shield = agentShieldResult.status === 'fulfilled' ? agentShieldResult.value : null;

    const internalScore = internal?.score ?? 50;
    const agentShieldScore = shield?.score ?? null;

    // Combine scores
    let combinedScore: number;
    if (agentShieldScore !== null) {
      combinedScore = Math.round(
        (internalScore * INTERNAL_WEIGHT) + (agentShieldScore * AGENTSHIELD_WEIGHT),
      );
    } else {
      // AgentShield unavailable — use internal only with penalty
      combinedScore = Math.round(internalScore * 0.85);
    }

    combinedScore = Math.max(0, Math.min(100, combinedScore));

    // Merge flags
    const allFlags: SafetyFlag[] = [
      ...(internal?.flags ?? []),
      ...(shield?.flags ?? []),
    ];

    const riskLevel = this.scoreToRiskLevel(combinedScore);

    const report: SafetyReport = {
      internalScore,
      agentShieldScore,
      combinedScore,
      riskLevel,
      flags: allFlags,
      checkedAt: new Date().toISOString(),
    };

    console.log(`[Safety] Result: score=${combinedScore}, risk=${riskLevel}, flags=${allFlags.length}`);
    return report;
  }

  /** Run AgentShield checks */
  private async runAgentShieldChecks(
    tokenMint: string,
    programId: string | null,
  ): Promise<{ score: number; flags: SafetyFlag[] }> {
    // Run address validation and (if we have a program ID) scan in parallel
    const checks = [
      this.agentShield.validateAddress(tokenMint),
    ];

    const addressResult = await this.agentShield.validateAddress(tokenMint);

    let scanResult = null;
    if (programId) {
      scanResult = await this.agentShield.scanProgram(programId);
    }

    return this.agentShield.convertToFlags(scanResult, addressResult);
  }

  /** Convert numeric score to risk level */
  private scoreToRiskLevel(score: number): RiskLevel {
    if (score >= 75) return RiskLevel.LOW;
    if (score >= 45) return RiskLevel.MEDIUM;
    if (score >= 20) return RiskLevel.HIGH;
    return RiskLevel.CRITICAL;
  }
}
