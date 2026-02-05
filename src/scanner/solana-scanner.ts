// ============================================================
// Solana Airdrop Scanner — Discovers airdrop opportunities
// ============================================================

import {
  Connection,
  PublicKey,
  ParsedAccountData,
} from '@solana/web3.js';
import { v4 as uuid } from 'uuid';
import {
  AirdropOpportunity,
  AirdropStatus,
  EffortLevel,
  RiskLevel,
} from '../types';
import { config } from '../config';

/** Known protocols that frequently do airdrops */
const KNOWN_AIRDROP_PROTOCOLS: Record<string, { name: string; programId: string }> = {
  jupiter: {
    name: 'Jupiter',
    programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  },
  tensor: {
    name: 'Tensor',
    programId: 'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN',
  },
  marinade: {
    name: 'Marinade Finance',
    programId: 'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD',
  },
  drift: {
    name: 'Drift Protocol',
    programId: 'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH',
  },
  jito: {
    name: 'Jito',
    programId: 'Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P3kCmMVxe',
  },
  parcl: {
    name: 'Parcl',
    programId: 'PARCLcB1imF4iWt4GExy4hn51kqsKBgQbamv6dpGJwn',
  },
};

/** Patterns that suggest a token mint is part of an airdrop */
const AIRDROP_INDICATORS = {
  MIN_HOLDER_COUNT: 100,        // Airdrops distribute to many holders
  MAX_HOLDER_CONCENTRATION: 0.5, // Top holder shouldn't own > 50%
  MIN_SUPPLY: 1_000_000,        // Reasonable minimum supply
  RECENT_WINDOW_HOURS: 168,     // Look back 7 days
};

export class SolanaScanner {
  private connection: Connection;
  private opportunities: Map<string, AirdropOpportunity> = new Map();
  private isRunning = false;
  private scanInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const rpcUrl = config.heliusApiKey
      ? `https://devnet.helius-rpc.com/?api-key=${config.heliusApiKey}`
      : config.solanaRpcUrl;
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /** Start periodic scanning */
  start(intervalMs: number = 60_000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[Scanner] Starting Solana airdrop scanner...');

    // Initial scan
    this.runScan().catch(err => console.error('[Scanner] Initial scan error:', err));

    // Periodic scans
    this.scanInterval = setInterval(() => {
      this.runScan().catch(err => console.error('[Scanner] Scan error:', err));
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

  /** Get all discovered opportunities */
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

  /** Main scan cycle */
  private async runScan(): Promise<void> {
    console.log('[Scanner] Running scan cycle...');

    try {
      // 1. Monitor known airdrop protocols for new activity
      await this.scanKnownProtocols();

      // 2. Discover new token mints with airdrop characteristics
      await this.scanRecentTokenMints();

      // 3. Clean up expired opportunities
      this.cleanupExpired();

      console.log(`[Scanner] Scan complete. ${this.opportunities.size} active opportunities.`);
    } catch (error) {
      console.error('[Scanner] Scan cycle error:', error);
    }
  }

  /** Monitor known airdrop protocol addresses for new activity */
  private async scanKnownProtocols(): Promise<void> {
    for (const [key, protocol] of Object.entries(KNOWN_AIRDROP_PROTOCOLS)) {
      try {
        const pubkey = new PublicKey(protocol.programId);

        // Get recent signatures for this program
        const signatures = await this.connection.getSignaturesForAddress(pubkey, {
          limit: 10,
        });

        if (signatures.length === 0) continue;

        // Check if there are new token distributions
        for (const sig of signatures) {
          if (sig.err) continue;

          const tx = await this.connection.getParsedTransaction(sig.signature, {
            maxSupportedTransactionVersion: 0,
          });

          if (!tx?.meta) continue;

          // Look for token transfer patterns indicative of airdrops
          // (many outgoing transfers of the same token)
          const postTokenBalances = tx.meta.postTokenBalances ?? [];
          const preTokenBalances = tx.meta.preTokenBalances ?? [];

          // If there are multiple token balance changes to different accounts,
          // this could be an airdrop distribution
          if (postTokenBalances.length > 5) {
            const tokenMints = new Set(postTokenBalances.map(b => b.mint));

            for (const mint of tokenMints) {
              const mintBalances = postTokenBalances.filter(b => b.mint === mint);
              if (mintBalances.length >= 3) {
                // Potential airdrop distribution detected
                await this.registerOpportunity({
                  tokenMint: mint,
                  sourceProtocol: protocol.name,
                  programId: protocol.programId,
                  txSignature: sig.signature,
                  recipientCount: mintBalances.length,
                });
              }
            }
          }
        }
      } catch (error) {
        console.error(`[Scanner] Error scanning ${protocol.name}:`, error);
      }
    }
  }

  /** Scan for recently created token mints that look like airdrops */
  private async scanRecentTokenMints(): Promise<void> {
    try {
      // Use getRecentBlockhash to get current slot, then look back
      const slot = await this.connection.getSlot();
      const lookbackSlots = 1000; // ~6-7 minutes of slots

      // Get recent blocks and look for token program instructions
      const block = await this.connection.getBlock(slot - lookbackSlots, {
        maxSupportedTransactionVersion: 0,
        transactionDetails: 'signatures',
      });

      if (!block) return;

      // For Helius-enhanced RPC, we could use getAssetsByGroup or similar
      // For standard RPC, we check recent token program activity
      // This is intentionally lightweight for demo purposes
      if (config.heliusApiKey) {
        await this.scanViaHeliusApi();
      }
    } catch (error) {
      // getBlock can fail on devnet — that's OK
      console.warn('[Scanner] Recent mint scan limited:', (error as Error).message?.slice(0, 80));
    }
  }

  /** Use Helius enhanced API for richer airdrop detection */
  private async scanViaHeliusApi(): Promise<void> {
    if (!config.heliusApiKey) return;

    try {
      const url = `https://api.helius.xyz/v0/token-metadata?api-key=${config.heliusApiKey}`;

      // Query for recently created tokens on devnet
      // Helius DAS API — search for recent fungible tokens
      const dasUrl = `https://devnet.helius-rpc.com/?api-key=${config.heliusApiKey}`;
      const response = await fetch(dasUrl, {
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
      });

      if (!response.ok) {
        console.warn('[Scanner] Helius DAS API returned', response.status);
        return;
      }

      const data = await response.json() as { result?: { items?: Array<{
        id: string;
        content?: { metadata?: { name?: string; symbol?: string; description?: string } };
        token_info?: { supply?: number; decimals?: number; mint_authority?: string; freeze_authority?: string };
        authorities?: Array<{ address: string }>;
      }> } };

      const items = data.result?.items ?? [];
      for (const asset of items) {
        const meta = asset.content?.metadata;
        const tokenInfo = asset.token_info;
        if (!meta?.name || !tokenInfo) continue;

        // Check if this looks like an airdrop token
        const nameLC = (meta.name ?? '').toLowerCase();
        const descLC = (meta.description ?? '').toLowerCase();
        const isLikelyAirdrop =
          nameLC.includes('airdrop') ||
          nameLC.includes('drop') ||
          descLC.includes('airdrop') ||
          descLC.includes('claim') ||
          descLC.includes('reward');

        if (isLikelyAirdrop) {
          await this.registerOpportunity({
            tokenMint: asset.id,
            sourceProtocol: 'Unknown',
            programId: null,
            txSignature: null,
            recipientCount: 0,
            name: meta.name,
            symbol: meta.symbol ?? 'UNKNOWN',
            description: meta.description ?? '',
          });
        }
      }
    } catch (error) {
      console.warn('[Scanner] Helius API scan error:', (error as Error).message);
    }
  }

  /** Register a newly discovered airdrop opportunity */
  private async registerOpportunity(params: {
    tokenMint: string;
    sourceProtocol: string;
    programId: string | null;
    txSignature: string | null;
    recipientCount: number;
    name?: string;
    symbol?: string;
    description?: string;
  }): Promise<void> {
    // Skip if we already know about this token
    const existing = Array.from(this.opportunities.values())
      .find(o => o.tokenMint === params.tokenMint);
    if (existing) return;

    // Fetch token metadata if not provided
    let name = params.name ?? 'Unknown Token';
    let symbol = params.symbol ?? 'UNKNOWN';

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

    const opportunity: AirdropOpportunity = {
      id: uuid(),
      name,
      symbol,
      tokenMint: params.tokenMint,
      sourceProtocol: params.sourceProtocol,
      description: params.description ?? `Airdrop opportunity from ${params.sourceProtocol}`,
      status: AirdropStatus.DISCOVERED,
      estimatedValueUsd: null,
      confidence: 0.3,
      eligibilityCriteria: ['Under investigation'],
      snapshotDate: null,
      claimWindowStart: null,
      claimWindowEnd: null,
      effort: EffortLevel.MODERATE,
      safetyScore: 50,  // Default until scanned
      riskLevel: RiskLevel.MEDIUM,
      safetyReport: null,
      discoveredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceUrl: params.txSignature
        ? `https://solscan.io/tx/${params.txSignature}?cluster=devnet`
        : null,
      programId: params.programId,
    };

    this.opportunities.set(opportunity.id, opportunity);
    console.log(`[Scanner] New opportunity: ${name} (${symbol}) — ${params.sourceProtocol}`);
  }

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

  /** Seed with demo data for hackathon presentation */
  seedDemoData(): void {
    const demoOpportunities: AirdropOpportunity[] = [
      {
        id: uuid(),
        name: 'Jupiter Airdrop Round 2',
        symbol: 'JUP',
        tokenMint: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
        sourceProtocol: 'Jupiter',
        description: 'Jupiter DEX aggregator second round airdrop for active traders. Based on swap volume and unique protocols used.',
        status: AirdropStatus.ACTIVE,
        estimatedValueUsd: 450,
        confidence: 0.85,
        eligibilityCriteria: [
          'Used Jupiter swap at least 5 times',
          'Minimum $500 total swap volume',
          'Active in last 6 months',
          'Used at least 3 different DEX routes',
        ],
        snapshotDate: '2026-01-15T00:00:00Z',
        claimWindowStart: '2026-02-01T00:00:00Z',
        claimWindowEnd: '2026-04-01T00:00:00Z',
        effort: EffortLevel.EASY,
        safetyScore: 95,
        riskLevel: RiskLevel.LOW,
        safetyReport: null,
        discoveredAt: new Date(Date.now() - 86400000 * 3).toISOString(),
        updatedAt: new Date().toISOString(),
        sourceUrl: 'https://jup.ag/airdrop',
        programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      },
      {
        id: uuid(),
        name: 'Tensor Season 3 Rewards',
        symbol: 'TNSR',
        tokenMint: 'TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6',
        sourceProtocol: 'Tensor',
        description: 'Tensor NFT marketplace loyalty rewards for active traders and listers.',
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
        discoveredAt: new Date(Date.now() - 86400000 * 1).toISOString(),
        updatedAt: new Date().toISOString(),
        sourceUrl: 'https://tensor.trade/rewards',
        programId: 'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN',
      },
      {
        id: uuid(),
        name: 'SolFi Yield Token',
        symbol: 'SOLFI',
        tokenMint: 'So1fi1111111111111111111111111111111111111',
        sourceProtocol: 'SolFi (Unverified)',
        description: 'New DeFi protocol claiming free token distribution. Unverified team.',
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
        discoveredAt: new Date(Date.now() - 3600000).toISOString(),
        updatedAt: new Date().toISOString(),
        sourceUrl: null,
        programId: null,
      },
      {
        id: uuid(),
        name: 'Marinade Governance Tokens',
        symbol: 'MNDE',
        tokenMint: 'MNDEFzGvMt87ueuHnXBQ1gMNTSToog1Chn3YWDuQKMN',
        sourceProtocol: 'Marinade Finance',
        description: 'Governance token distribution for mSOL stakers and native stake users.',
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
        discoveredAt: new Date(Date.now() - 86400000 * 2).toISOString(),
        updatedAt: new Date().toISOString(),
        sourceUrl: 'https://marinade.finance/governance',
        programId: 'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD',
      },
      {
        id: uuid(),
        name: 'PhantomDrop Mystery Token',
        symbol: 'PHDROP',
        tokenMint: 'PhDr0p1111111111111111111111111111111111111',
        sourceProtocol: 'Unknown',
        description: 'Suspicious token appearing in wallets without user action. Likely dust attack or phishing.',
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
        discoveredAt: new Date(Date.now() - 7200000).toISOString(),
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
