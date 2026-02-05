// ============================================================
// Solana Airdrop Scanner — Real on-chain data + heuristic analysis
// ============================================================
//
// Phase 2: Replaces demo data with real Solana devnet queries.
// Supports graceful fallback to demo mode when network is unavailable.
//

import {
  Connection,
  PublicKey,
  ParsedAccountData,
  ConfirmedSignatureInfo,
} from '@solana/web3.js';
import { v4 as uuid } from 'uuid';
import {
  AirdropOpportunity,
  AirdropStatus,
  EffortLevel,
  RiskLevel,
  SignalSource,
  ProtocolScanResult,
} from '../types';
import { config } from '../config';

// ============================================================
// Known Protocol Registry
// ============================================================

interface ProtocolInfo {
  name: string;
  programId: string;
  category: string;
  tokenMint: string | null;
  description: string;
}

const KNOWN_PROTOCOLS: Record<string, ProtocolInfo> = {
  jupiter: {
    name: 'Jupiter',
    programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    category: 'DEX Aggregator',
    tokenMint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    description: 'JUP staking rewards and fee-sharing distributions',
  },
  marinade: {
    name: 'Marinade Finance',
    programId: 'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD',
    category: 'Liquid Staking',
    tokenMint: 'MNDEFzGvMt87ueuHnXBQ1gMNTSToog1Chn3YWDuQKMN',
    description: 'mSOL/MNDE staking reward distributions',
  },
  drift: {
    name: 'Drift Protocol',
    programId: 'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH',
    category: 'Perpetuals',
    tokenMint: 'DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7',
    description: 'Trading fee rebates and DRIFT token distributions',
  },
  jito: {
    name: 'Jito',
    programId: '4R3gSG8BpU4t19KYj8CfnbtRpnT8gtk4dvTHxVRwc2r7',
    category: 'MEV / Liquid Staking',
    tokenMint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
    description: 'MEV rewards and JitoSOL yield distributions',
  },
  tensor: {
    name: 'Tensor',
    programId: 'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN',
    category: 'NFT Marketplace',
    tokenMint: 'TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6',
    description: 'Tensor marketplace loyalty and trading rewards',
  },
  parcl: {
    name: 'Parcl',
    programId: 'PARCLcB1imF4iWt4GExy4hn51kqsKBgQbamv6dpGJwn',
    category: 'Real Estate Perps',
    tokenMint: null,
    description: 'Protocol incentive distributions for LP providers',
  },
};

// Solana Token Program
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// ============================================================
// Heuristic Thresholds
// ============================================================

const HEURISTICS = {
  /** Minimum unique recipients to consider a distribution as airdrop */
  MIN_DISTRIBUTION_RECIPIENTS: 5,
  /** Maximum holder concentration for healthy distribution */
  MAX_TOP10_CONCENTRATION: 0.80,
  /** Minimum supply for a real airdrop token (post-decimals) */
  MIN_SUPPLY: 1_000_000,
  /** How many recent signatures to fetch per protocol */
  PROTOCOL_SIG_LIMIT: 15,
  /** How many recent blocks to look back for token mints */
  MINT_LOOKBACK_SLOTS: 2000,
  /** Confidence boost when multiple signals align */
  MULTI_SIGNAL_BOOST: 0.15,
};

// ============================================================
// SolanaScanner
// ============================================================

export class SolanaScanner {
  private connection: Connection;
  private opportunities: Map<string, AirdropOpportunity> = new Map();
  private isRunning = false;
  private scanInterval: ReturnType<typeof setInterval> | null = null;
  private scanCount = 0;
  private lastScanError: string | null = null;
  private networkAvailable = true;

  constructor() {
    const rpcUrl = config.heliusApiKey
      ? `https://devnet.helius-rpc.com/?api-key=${config.heliusApiKey}`
      : config.solanaRpcUrl;
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  // ---- Public API ----

  /** Start periodic scanning */
  start(intervalMs: number = 60_000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[Scanner] Starting Solana airdrop scanner (interval: ${intervalMs / 1000}s)...`);

    // Initial scan
    this.runScan().catch(err =>
      console.error('[Scanner] Initial scan error:', (err as Error).message),
    );

    // Periodic scans
    this.scanInterval = setInterval(() => {
      this.runScan().catch(err =>
        console.error('[Scanner] Scan error:', (err as Error).message),
      );
    }, intervalMs);
  }

  /** Stop scanning */
  stop(): void {
    this.isRunning = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    console.log('[Scanner] Scanner stopped.');
  }

  /** Get all discovered opportunities (sorted by safety score descending) */
  getOpportunities(): AirdropOpportunity[] {
    return Array.from(this.opportunities.values())
      .sort((a, b) => b.safetyScore - a.safetyScore);
  }

  /** Get a single opportunity by ID */
  getOpportunity(id: string): AirdropOpportunity | undefined {
    return this.opportunities.get(id);
  }

  /** Update an opportunity (e.g., after safety scoring) */
  updateOpportunity(id: string, updates: Partial<AirdropOpportunity>): void {
    const existing = this.opportunities.get(id);
    if (existing) {
      this.opportunities.set(id, { ...existing, ...updates, updatedAt: new Date().toISOString() });
    }
  }

  /** Get scanner statistics */
  getStats(): {
    totalOpportunities: number;
    scanCount: number;
    networkAvailable: boolean;
    lastError: string | null;
    protocols: string[];
  } {
    return {
      totalOpportunities: this.opportunities.size,
      scanCount: this.scanCount,
      networkAvailable: this.networkAvailable,
      lastError: this.lastScanError,
      protocols: Object.keys(KNOWN_PROTOCOLS),
    };
  }

  // ---- Main Scan Cycle ----

  private async runScan(): Promise<void> {
    this.scanCount++;
    const startTime = Date.now();
    console.log(`[Scanner] ── Scan cycle #${this.scanCount} ──`);

    try {
      // Test network connectivity first
      await this.testConnection();
      this.networkAvailable = true;
      this.lastScanError = null;

      // Run all scan strategies in parallel
      const results = await Promise.allSettled([
        this.scanKnownProtocols(),
        this.scanRecentTokenMints(),
        this.scanProtocolSpecific(),
      ]);

      // Log results
      for (const [i, result] of results.entries()) {
        const name = ['protocols', 'token-mints', 'protocol-specific'][i];
        if (result.status === 'rejected') {
          console.warn(`[Scanner] ${name} scan failed:`, (result.reason as Error).message?.slice(0, 100));
        }
      }

      // Apply heuristic scoring to new discoveries
      this.applyHeuristicScoring();

      // Clean up expired
      this.cleanupExpired();

    } catch (error) {
      const msg = (error as Error).message;
      this.lastScanError = msg;
      this.networkAvailable = false;
      console.warn(`[Scanner] Network unavailable: ${msg.slice(0, 80)}`);

      // Fall back to demo data if we have nothing
      if (this.opportunities.size === 0 && config.demoMode) {
        console.log('[Scanner] No data available — loading demo data as fallback...');
        this.seedDemoData();
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Scanner] Scan complete. ${this.opportunities.size} opportunities (${elapsed}ms)`);
  }

  /** Quick connectivity test */
  private async testConnection(): Promise<void> {
    const slot = await this.connection.getSlot();
    if (!slot) throw new Error('Could not get slot');
  }

  // ============================================================
  // Strategy 1: Monitor known airdrop protocols
  // ============================================================

  private async scanKnownProtocols(): Promise<void> {
    // Run sequentially to avoid rate limiting on public devnet RPC
    for (const [key, protocol] of Object.entries(KNOWN_PROTOCOLS)) {
      try {
        await this.scanProtocolActivity(key, protocol);
      } catch (error) {
        // Individual protocol failure shouldn't stop others
        console.warn(`[Scanner] ${protocol.name} scan failed:`, (error as Error).message?.slice(0, 60));
      }
      await sleep(300);
    }
  }

  private async scanProtocolActivity(key: string, protocol: ProtocolInfo): Promise<void> {
    const pubkey = new PublicKey(protocol.programId);

    // Get recent signatures for this program
    let signatures: ConfirmedSignatureInfo[];
    try {
      signatures = await this.connection.getSignaturesForAddress(pubkey, {
        limit: HEURISTICS.PROTOCOL_SIG_LIMIT,
      });
    } catch {
      return; // Program not found on devnet is normal
    }

    if (signatures.length === 0) return;

    // Check first few transactions for distribution patterns (limit to avoid rate limits)
    const validSigs = signatures.filter(s => !s.err).slice(0, 3);
    for (const sig of validSigs) {
      try {
        await sleep(200);
        const tx = await this.connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx?.meta) continue;

        const postTokenBalances = tx.meta.postTokenBalances ?? [];
        const preTokenBalances = tx.meta.preTokenBalances ?? [];

        // Detect multi-recipient token distributions
        if (postTokenBalances.length >= HEURISTICS.MIN_DISTRIBUTION_RECIPIENTS) {
          const tokenMints = new Set(postTokenBalances.map(b => b.mint));

          for (const mint of tokenMints) {
            const mintBalances = postTokenBalances.filter(b => b.mint === mint);
            const preBalances = preTokenBalances.filter(b => b.mint === mint);

            // Check for new balance increases (distribution pattern)
            let newRecipients = 0;
            for (const post of mintBalances) {
              const pre = preBalances.find(p => p.accountIndex === post.accountIndex);
              const preBal = Number(pre?.uiTokenAmount?.uiAmount ?? 0);
              const postBal = Number(post.uiTokenAmount?.uiAmount ?? 0);
              if (postBal > preBal) newRecipients++;
            }

            if (newRecipients >= 3) {
              await this.registerOpportunity({
                tokenMint: mint,
                sourceProtocol: protocol.name,
                programId: protocol.programId,
                txSignature: sig.signature,
                recipientCount: newRecipients,
                signalSource: SignalSource.PROTOCOL_ACTIVITY,
                confidence: 0.5 + (newRecipients / 50), // More recipients = higher confidence
              });
            }
          }
        }
      } catch {
        // Individual tx parse failure is OK
      }
    }
  }

  // ============================================================
  // Strategy 2: Discover new token mints with airdrop patterns
  // ============================================================

  private async scanRecentTokenMints(): Promise<void> {
    // Use Helius enhanced API if available
    if (config.heliusApiKey) {
      await this.scanViaHeliusApi();
      return;
    }

    // Fallback: scan Token Program for recent large accounts
    try {
      const slot = await this.connection.getSlot();
      const lookback = Math.min(HEURISTICS.MINT_LOOKBACK_SLOTS, slot);

      // Get a recent block and look for Token Program instructions
      // Fetch recent confirmed signatures from Token Program instead of block
      const tokenProgramSigs = await this.connection.getSignaturesForAddress(
        TOKEN_PROGRAM_ID,
        { limit: 10 },
      );

      if (!tokenProgramSigs || tokenProgramSigs.length === 0) return;

      const sample = tokenProgramSigs
        .filter(s => !s.err)
        .map(s => s.signature)
        .slice(0, 10);

      for (const sig of sample) {
        try {
          const tx = await this.connection.getParsedTransaction(sig, {
            maxSupportedTransactionVersion: 0,
          });

          if (!tx?.meta) continue;

          const postBalances = tx.meta.postTokenBalances ?? [];
          if (postBalances.length >= HEURISTICS.MIN_DISTRIBUTION_RECIPIENTS) {
            const mints = new Set(postBalances.map(b => b.mint));
            for (const mint of mints) {
              const recipients = postBalances.filter(b => b.mint === mint).length;
              if (recipients >= HEURISTICS.MIN_DISTRIBUTION_RECIPIENTS) {
                await this.registerOpportunity({
                  tokenMint: mint,
                  sourceProtocol: 'Unknown',
                  programId: null,
                  txSignature: sig,
                  recipientCount: recipients,
                  signalSource: SignalSource.ON_CHAIN_MINT,
                  confidence: 0.3,
                });
              }
            }
          }
        } catch {
          // Individual tx parse failure is OK
        }
      }
    } catch (error) {
      console.warn('[Scanner] Recent mint scan limited:', (error as Error).message?.slice(0, 80));
    }
  }

  /** Use Helius enhanced API for richer airdrop detection */
  private async scanViaHeliusApi(): Promise<void> {
    if (!config.heliusApiKey) return;

    try {
      const dasUrl = `https://devnet.helius-rpc.com/?api-key=${config.heliusApiKey}`;

      const response = await fetchWithTimeout(dasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'airdrop-scan',
          method: 'searchAssets',
          params: {
            ownerAddress: null,
            tokenType: 'fungible',
            displayOptions: { showNativeBalance: false },
            sortBy: { sortBy: 'created', sortDirection: 'desc' },
            limit: 20,
          },
        }),
      }, 10_000);

      if (!response.ok) {
        console.warn('[Scanner] Helius DAS API returned', response.status);
        return;
      }

      const data = await response.json() as {
        result?: {
          items?: Array<{
            id: string;
            content?: { metadata?: { name?: string; symbol?: string; description?: string } };
            token_info?: {
              supply?: number;
              decimals?: number;
              mint_authority?: string;
              freeze_authority?: string;
            };
            authorities?: Array<{ address: string }>;
          }>;
        };
      };

      const items = data.result?.items ?? [];
      for (const asset of items) {
        const meta = asset.content?.metadata;
        const tokenInfo = asset.token_info;
        if (!meta?.name || !tokenInfo) continue;

        // Heuristic: check if token name/description suggests airdrop
        const nameLC = (meta.name ?? '').toLowerCase();
        const descLC = (meta.description ?? '').toLowerCase();
        const keywords = ['airdrop', 'drop', 'claim', 'reward', 'distribution', 'incentive'];
        const isLikelyAirdrop = keywords.some(kw => nameLC.includes(kw) || descLC.includes(kw));

        // Also check supply — high supply + recent creation = possible airdrop
        const highSupply = (tokenInfo.supply ?? 0) >= HEURISTICS.MIN_SUPPLY;

        if (isLikelyAirdrop || highSupply) {
          await this.registerOpportunity({
            tokenMint: asset.id,
            sourceProtocol: 'Helius Discovery',
            programId: null,
            txSignature: null,
            recipientCount: 0,
            name: meta.name,
            symbol: meta.symbol ?? 'UNKNOWN',
            description: meta.description ?? '',
            signalSource: SignalSource.ON_CHAIN_MINT,
            confidence: isLikelyAirdrop ? 0.5 : 0.2,
          });
        }
      }
    } catch (error) {
      console.warn('[Scanner] Helius API scan error:', (error as Error).message?.slice(0, 80));
    }
  }

  // ============================================================
  // Strategy 3: Protocol-specific scanning
  // ============================================================

  private async scanProtocolSpecific(): Promise<void> {
    // Run sequentially with delays to avoid rate limiting on public RPC
    const scans: Array<{ name: string; fn: () => Promise<void> }> = [
      { name: 'Jupiter', fn: () => this.scanJupiterRewards() },
      { name: 'Marinade', fn: () => this.scanMarinadeDistributions() },
      { name: 'Drift', fn: () => this.scanDriftRebates() },
      { name: 'Jito', fn: () => this.scanJitoRewards() },
    ];

    for (const scan of scans) {
      try {
        await scan.fn();
      } catch (error) {
        console.warn(`[Scanner] ${scan.name} specific scan skipped:`, (error as Error).message?.slice(0, 60));
      }
      // Small delay between protocol scans to avoid rate limiting
      await sleep(500);
    }
  }

  /** Jupiter: JUP staking rewards and fee-sharing */
  private async scanJupiterRewards(): Promise<void> {
    const jup = KNOWN_PROTOCOLS.jupiter;
    const jupPubkey = new PublicKey(jup.programId);

    try {
      const sigs = await this.connection.getSignaturesForAddress(jupPubkey, { limit: 5 });

      if (sigs.length > 0) {
        // Jupiter has activity — register as active protocol
        const recentActivity = sigs.some(s => {
          if (!s.blockTime) return false;
          const age = Math.floor(Date.now() / 1000) - s.blockTime;
          return age < 86400 * 7; // Active in last week
        });

        if (recentActivity) {
          await this.registerOpportunity({
            tokenMint: jup.tokenMint!,
            sourceProtocol: jup.name,
            programId: jup.programId,
            txSignature: sigs[0]?.signature ?? null,
            recipientCount: 0,
            name: 'Jupiter Staking Rewards',
            symbol: 'JUP',
            description: 'JUP staking rewards and fee-sharing for active Jupiter users. Stake JUP tokens to earn protocol revenue share.',
            signalSource: SignalSource.STAKING_REWARD,
            confidence: 0.7,
            eligibility: [
              'Stake JUP tokens via Jupiter governance',
              'Active swap usage increases allocation',
              'Fee-sharing proportional to staked amount',
            ],
          });
        }
      }
    } catch {
      // Jupiter not on devnet is expected
    }
  }

  /** Marinade: mSOL/MNDE staking distributions */
  private async scanMarinadeDistributions(): Promise<void> {
    const marinade = KNOWN_PROTOCOLS.marinade;
    const marinadePubkey = new PublicKey(marinade.programId);

    try {
      const sigs = await this.connection.getSignaturesForAddress(marinadePubkey, { limit: 5 });

      if (sigs.length > 0) {
        await this.registerOpportunity({
          tokenMint: marinade.tokenMint!,
          sourceProtocol: marinade.name,
          programId: marinade.programId,
          txSignature: sigs[0]?.signature ?? null,
          recipientCount: 0,
          name: 'Marinade MNDE Governance Rewards',
          symbol: 'MNDE',
          description: 'MNDE governance token distribution for mSOL stakers and native stake users. Participate in governance for bonus allocation.',
          signalSource: SignalSource.STAKING_REWARD,
          confidence: 0.65,
          eligibility: [
            'Stake SOL via Marinade (mSOL or native)',
            'Minimum 1 SOL staked for 30+ days',
            'Governance participation bonus',
          ],
        });
      }
    } catch {
      // Marinade not on devnet is expected
    }
  }

  /** Drift: Trading fee rebates */
  private async scanDriftRebates(): Promise<void> {
    const drift = KNOWN_PROTOCOLS.drift;
    const driftPubkey = new PublicKey(drift.programId);

    try {
      const sigs = await this.connection.getSignaturesForAddress(driftPubkey, { limit: 5 });

      if (sigs.length > 0) {
        await this.registerOpportunity({
          tokenMint: drift.tokenMint!,
          sourceProtocol: drift.name,
          programId: drift.programId,
          txSignature: sigs[0]?.signature ?? null,
          recipientCount: 0,
          name: 'Drift Trading Fee Rebates',
          symbol: 'DRIFT',
          description: 'DRIFT token rebates for active perpetual traders. Higher volume and market-making activity earn larger rebates.',
          signalSource: SignalSource.STAKING_REWARD,
          confidence: 0.6,
          eligibility: [
            'Active perpetual trading on Drift',
            'Minimum $1000 monthly trading volume',
            'Market-making activity (bonus)',
            'Insurance fund staking (bonus)',
          ],
        });
      }
    } catch {
      // Drift not on devnet is expected
    }
  }

  /** Jito: MEV rewards and JitoSOL yield */
  private async scanJitoRewards(): Promise<void> {
    const jito = KNOWN_PROTOCOLS.jito;
    const jitoPubkey = new PublicKey(jito.programId);

    try {
      const sigs = await this.connection.getSignaturesForAddress(jitoPubkey, { limit: 5 });

      if (sigs.length > 0) {
        await this.registerOpportunity({
          tokenMint: jito.tokenMint!,
          sourceProtocol: jito.name,
          programId: jito.programId,
          txSignature: sigs[0]?.signature ?? null,
          recipientCount: 0,
          name: 'Jito MEV Rewards',
          symbol: 'JTO',
          description: 'JTO token rewards from MEV redistribution. JitoSOL holders earn enhanced staking yield + MEV tips.',
          signalSource: SignalSource.STAKING_REWARD,
          confidence: 0.65,
          eligibility: [
            'Hold JitoSOL (liquid staking)',
            'Run Jito-Solana validator client',
            'Stake JTO in governance',
            'MEV tip redistribution to stakers',
          ],
        });
      }
    } catch {
      // Jito not on devnet is expected
    }
  }

  // ============================================================
  // Heuristic Scoring Engine
  // ============================================================

  /** Apply heuristic rules to score and classify opportunities */
  private applyHeuristicScoring(): void {
    for (const [id, opp] of this.opportunities) {
      // Skip already-scored opportunities (from demo data or manual update)
      if (opp.safetyReport !== null) continue;

      let score = opp.safetyScore;
      let confidence = opp.confidence;

      // Rule 1: Known protocols get a trust boost
      const isKnownProtocol = Object.values(KNOWN_PROTOCOLS).some(
        p => p.programId === opp.programId || p.tokenMint === opp.tokenMint,
      );
      if (isKnownProtocol) {
        score = Math.min(100, score + 20);
        confidence = Math.min(1, confidence + 0.2);
      }

      // Rule 2: Unknown source with no program ID = suspicious
      if (!opp.programId && opp.sourceProtocol === 'Unknown') {
        score = Math.max(0, score - 15);
        confidence = Math.max(0, confidence - 0.1);
      }

      // Rule 3: Trivial effort + high value = scam signal
      if (opp.effort === EffortLevel.TRIVIAL && (opp.estimatedValueUsd ?? 0) > 500) {
        score = Math.max(0, score - 25);
        opp.riskLevel = RiskLevel.HIGH;
      }

      // Rule 4: Multiple signal sources = more credible
      // (In future, track signal count per opportunity)

      // Update
      opp.safetyScore = Math.max(0, Math.min(100, score));
      opp.confidence = Math.max(0, Math.min(1, confidence));
      opp.riskLevel = this.scoreToRiskLevel(score);
      opp.updatedAt = new Date().toISOString();
      this.opportunities.set(id, opp);
    }
  }

  private scoreToRiskLevel(score: number): RiskLevel {
    if (score >= 75) return RiskLevel.LOW;
    if (score >= 45) return RiskLevel.MEDIUM;
    if (score >= 20) return RiskLevel.HIGH;
    return RiskLevel.CRITICAL;
  }

  // ============================================================
  // Opportunity Registration
  // ============================================================

  private async registerOpportunity(params: {
    tokenMint: string;
    sourceProtocol: string;
    programId: string | null;
    txSignature: string | null;
    recipientCount: number;
    name?: string;
    symbol?: string;
    description?: string;
    signalSource?: SignalSource;
    confidence?: number;
    eligibility?: string[];
  }): Promise<void> {
    // Skip if we already know about this token
    const existing = Array.from(this.opportunities.values())
      .find(o => o.tokenMint === params.tokenMint);
    if (existing) return;

    // Fetch token metadata if not provided
    let name = params.name ?? 'Unknown Token';
    let symbol = params.symbol ?? 'UNKNOWN';

    if (!params.name) {
      try {
        const mintPubkey = new PublicKey(params.tokenMint);
        const accountInfo = await this.connection.getParsedAccountInfo(mintPubkey);

        if (accountInfo.value?.data && 'parsed' in accountInfo.value.data) {
          const parsed = accountInfo.value.data as ParsedAccountData;
          const info = parsed.parsed?.info;
          if (info) {
            symbol = info.symbol ?? symbol;
          }
        }
      } catch {
        // Token metadata fetch failed — use defaults
      }
    }

    const confidence = params.confidence ?? 0.3;
    const safetyScore = this.estimateInitialSafety(params);

    const opportunity: AirdropOpportunity = {
      id: uuid(),
      name,
      symbol,
      tokenMint: params.tokenMint,
      sourceProtocol: params.sourceProtocol,
      description: params.description ?? `Airdrop opportunity detected from ${params.sourceProtocol}`,
      status: AirdropStatus.DISCOVERED,
      estimatedValueUsd: null,
      confidence,
      eligibilityCriteria: params.eligibility ?? ['Under investigation'],
      snapshotDate: null,
      claimWindowStart: null,
      claimWindowEnd: null,
      effort: this.estimateEffort(params),
      safetyScore,
      riskLevel: this.scoreToRiskLevel(safetyScore),
      safetyReport: null,
      discoveredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceUrl: params.txSignature
        ? `https://solscan.io/tx/${params.txSignature}?cluster=devnet`
        : null,
      programId: params.programId,
    };

    this.opportunities.set(opportunity.id, opportunity);
    console.log(`[Scanner] 🆕 ${name} (${symbol}) via ${params.sourceProtocol} [${params.signalSource ?? 'unknown'}]`);
  }

  /** Estimate initial safety score based on available signals */
  private estimateInitialSafety(params: {
    sourceProtocol: string;
    programId: string | null;
    recipientCount: number;
  }): number {
    let score = 50; // Neutral default

    // Known protocol = safer
    const isKnown = Object.values(KNOWN_PROTOCOLS).some(p => p.programId === params.programId);
    if (isKnown) score += 25;

    // High recipient count = more likely real airdrop
    if (params.recipientCount > 100) score += 15;
    else if (params.recipientCount > 20) score += 10;
    else if (params.recipientCount > 5) score += 5;

    // Unknown source with no program = risky
    if (params.sourceProtocol === 'Unknown' && !params.programId) score -= 15;

    return Math.max(0, Math.min(100, score));
  }

  /** Estimate effort level for an opportunity */
  private estimateEffort(params: {
    sourceProtocol: string;
    recipientCount: number;
  }): EffortLevel {
    const protocol = Object.values(KNOWN_PROTOCOLS).find(p => p.name === params.sourceProtocol);
    if (protocol) {
      // Known protocol staking rewards = easy-moderate
      return EffortLevel.EASY;
    }
    if (params.recipientCount > 50) {
      return EffortLevel.TRIVIAL; // Mass distribution
    }
    return EffortLevel.MODERATE; // Unknown = assume moderate
  }

  // ============================================================
  // Cleanup
  // ============================================================

  /** Remove expired opportunities */
  private cleanupExpired(): void {
    const now = new Date();
    for (const [id, opp] of this.opportunities) {
      if (opp.claimWindowEnd) {
        const end = new Date(opp.claimWindowEnd);
        if (end < now) {
          opp.status = AirdropStatus.EXPIRED;
          this.opportunities.set(id, opp);
        }
      }
    }
  }

  // ============================================================
  // Demo Data (fallback for offline/demo mode)
  // ============================================================

  /** Seed with realistic demo data — used as fallback when network is unavailable */
  seedDemoData(): void {
    const now = Date.now();

    const demoOpportunities: AirdropOpportunity[] = [
      {
        id: uuid(),
        name: 'Jupiter Staking Rewards — Season 2',
        symbol: 'JUP',
        tokenMint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
        sourceProtocol: 'Jupiter',
        description:
          'Jupiter DEX aggregator second round airdrop for active traders and JUP stakers. ' +
          'Based on swap volume, unique protocols used, and governance participation.',
        status: AirdropStatus.ACTIVE,
        estimatedValueUsd: 450,
        confidence: 0.85,
        eligibilityCriteria: [
          'Used Jupiter swap at least 5 times',
          'Minimum $500 total swap volume',
          'Active in last 6 months',
          'Used at least 3 different DEX routes',
          'JUP staking earns 2x allocation',
        ],
        snapshotDate: '2026-01-15T00:00:00Z',
        claimWindowStart: '2026-02-01T00:00:00Z',
        claimWindowEnd: '2026-04-01T00:00:00Z',
        effort: EffortLevel.EASY,
        safetyScore: 95,
        riskLevel: RiskLevel.LOW,
        safetyReport: null,
        discoveredAt: new Date(now - 86400000 * 3).toISOString(),
        updatedAt: new Date().toISOString(),
        sourceUrl: 'https://jup.ag/airdrop',
        programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      },
      {
        id: uuid(),
        name: 'Jito MEV Redistribution — Q1 2026',
        symbol: 'JTO',
        tokenMint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
        sourceProtocol: 'Jito',
        description:
          'JTO rewards from MEV tip redistribution to JitoSOL holders and validators. ' +
          'Enhanced yield on top of native staking returns.',
        status: AirdropStatus.VERIFIED,
        estimatedValueUsd: 220,
        confidence: 0.75,
        eligibilityCriteria: [
          'Hold JitoSOL in wallet',
          'Run Jito-Solana validator client (bonus)',
          'Stake JTO in governance (bonus)',
          'Minimum 1 SOL equivalent staked',
        ],
        snapshotDate: '2026-01-31T00:00:00Z',
        claimWindowStart: '2026-02-10T00:00:00Z',
        claimWindowEnd: '2026-05-01T00:00:00Z',
        effort: EffortLevel.EASY,
        safetyScore: 90,
        riskLevel: RiskLevel.LOW,
        safetyReport: null,
        discoveredAt: new Date(now - 86400000 * 2).toISOString(),
        updatedAt: new Date().toISOString(),
        sourceUrl: 'https://jito.network',
        programId: '4R3gSG8BpU4t19KYj8CfnbtRpnT8gtk4dvTHxVRwc2r7',
      },
      {
        id: uuid(),
        name: 'Marinade MNDE Governance Distribution',
        symbol: 'MNDE',
        tokenMint: 'MNDEFzGvMt87ueuHnXBQ1gMNTSToog1Chn3YWDuQKMN',
        sourceProtocol: 'Marinade Finance',
        description:
          'Governance token distribution for mSOL stakers and native stake users. ' +
          'Participate in Marinade governance votes for bonus allocation.',
        status: AirdropStatus.VERIFIED,
        estimatedValueUsd: 120,
        confidence: 0.65,
        eligibilityCriteria: [
          'Staked SOL via Marinade (mSOL or native)',
          'Minimum 1 SOL staked for 30+ days',
          'Participated in governance votes (bonus)',
        ],
        snapshotDate: '2026-02-01T00:00:00Z',
        claimWindowStart: '2026-02-10T00:00:00Z',
        claimWindowEnd: '2026-05-01T00:00:00Z',
        effort: EffortLevel.EASY,
        safetyScore: 82,
        riskLevel: RiskLevel.LOW,
        safetyReport: null,
        discoveredAt: new Date(now - 86400000 * 2).toISOString(),
        updatedAt: new Date().toISOString(),
        sourceUrl: 'https://marinade.finance/governance',
        programId: 'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD',
      },
      {
        id: uuid(),
        name: 'Drift Trading Fee Rebates — February',
        symbol: 'DRIFT',
        tokenMint: 'DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7',
        sourceProtocol: 'Drift Protocol',
        description:
          'Monthly DRIFT token rebates for active perpetual traders. ' +
          'Higher volume and market-making activity earn larger rebates.',
        status: AirdropStatus.ACTIVE,
        estimatedValueUsd: 85,
        confidence: 0.6,
        eligibilityCriteria: [
          'Active perpetual trading on Drift',
          'Minimum $1000 monthly trading volume',
          'Market-making activity (bonus)',
          'Insurance fund staking (bonus)',
        ],
        snapshotDate: null,
        claimWindowStart: '2026-02-05T00:00:00Z',
        claimWindowEnd: '2026-03-05T00:00:00Z',
        effort: EffortLevel.MODERATE,
        safetyScore: 78,
        riskLevel: RiskLevel.LOW,
        safetyReport: null,
        discoveredAt: new Date(now - 86400000 * 1).toISOString(),
        updatedAt: new Date().toISOString(),
        sourceUrl: 'https://drift.trade',
        programId: 'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH',
      },
      {
        id: uuid(),
        name: 'Tensor Season 3 Loyalty Rewards',
        symbol: 'TNSR',
        tokenMint: 'TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6',
        sourceProtocol: 'Tensor',
        description:
          'NFT marketplace loyalty rewards for active traders and listers. ' +
          'Tensorian NFT holders receive bonus allocation.',
        status: AirdropStatus.CLAIMABLE,
        estimatedValueUsd: 180,
        confidence: 0.72,
        eligibilityCriteria: [
          'Listed NFTs on Tensor marketplace',
          'Completed at least 3 trades',
          'Held Tensorian NFT (bonus)',
        ],
        snapshotDate: '2026-01-20T00:00:00Z',
        claimWindowStart: '2026-02-03T00:00:00Z',
        claimWindowEnd: '2026-03-15T00:00:00Z',
        effort: EffortLevel.MODERATE,
        safetyScore: 88,
        riskLevel: RiskLevel.LOW,
        safetyReport: null,
        discoveredAt: new Date(now - 86400000 * 1).toISOString(),
        updatedAt: new Date().toISOString(),
        sourceUrl: 'https://tensor.trade/rewards',
        programId: 'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN',
      },
      {
        id: uuid(),
        name: 'SolFi Yield Token',
        symbol: 'SOLFI',
        tokenMint: 'So1fi11111111111111111111111111111111111111',
        sourceProtocol: 'SolFi (Unverified)',
        description:
          'New DeFi protocol claiming free token distribution. ' +
          'Unverified team — high risk. Exercise extreme caution.',
        status: AirdropStatus.DISCOVERED,
        estimatedValueUsd: 25,
        confidence: 0.2,
        eligibilityCriteria: [
          'Connect wallet to claim page',
          'Share on Twitter',
          'Join Discord',
        ],
        snapshotDate: null,
        claimWindowStart: '2026-02-04T00:00:00Z',
        claimWindowEnd: '2026-02-28T00:00:00Z',
        effort: EffortLevel.TRIVIAL,
        safetyScore: 22,
        riskLevel: RiskLevel.HIGH,
        safetyReport: null,
        discoveredAt: new Date(now - 3600000).toISOString(),
        updatedAt: new Date().toISOString(),
        sourceUrl: null,
        programId: null,
      },
      {
        id: uuid(),
        name: 'PhantomDrop Mystery Token',
        symbol: 'PHDROP',
        tokenMint: 'PhDrop1111111111111111111111111111111111111',
        sourceProtocol: 'Unknown',
        description:
          'Suspicious token appearing in wallets without user action. ' +
          'Likely dust attack or phishing token. DO NOT interact.',
        status: AirdropStatus.SCAM,
        estimatedValueUsd: 0,
        confidence: 0.95,
        eligibilityCriteria: ['Unsolicited — appeared in wallet automatically'],
        snapshotDate: null,
        claimWindowStart: null,
        claimWindowEnd: null,
        effort: EffortLevel.TRIVIAL,
        safetyScore: 5,
        riskLevel: RiskLevel.CRITICAL,
        safetyReport: null,
        discoveredAt: new Date(now - 7200000).toISOString(),
        updatedAt: new Date().toISOString(),
        sourceUrl: null,
        programId: null,
      },
    ];

    for (const opp of demoOpportunities) {
      this.opportunities.set(opp.id, opp);
    }

    console.log(`[Scanner] Seeded ${demoOpportunities.length} demo opportunities.`);
  }
}

// ============================================================
// Utility
// ============================================================

/** Sleep helper */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Fetch with timeout — prevents hanging on network issues */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
