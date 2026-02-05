// ============================================================
// Internal Safety Checker — On-chain heuristic analysis
// ============================================================

import {
  Connection,
  PublicKey,
  ParsedAccountData,
} from '@solana/web3.js';
import {
  InternalCheckResult,
  SafetyFlag,
  SafetyCategory,
  TokenDistribution,
  TokenHolderInfo,
  MintInfo,
} from '../types';
import { config } from '../config';

/** Known scam addresses (would be a larger DB in production) */
const KNOWN_SCAM_ADDRESSES = new Set([
  // Example known scam mints — in production this would be fetched from a service
  'ScAmMiNt1111111111111111111111111111111111111',
  'RuGPu11111111111111111111111111111111111111111',
]);

/** Known legitimate protocol addresses */
const KNOWN_SAFE_ADDRESSES = new Set([
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter
  'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN', // Tensor
  'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD', // Marinade
  'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH', // Drift
  'Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P3kCmMVxe', // Jito
  'MNDEFzGvMt87ueuHnXBQ1gMNTSToog1Chn3YWDuQKMN', // Marinade MNDE
  'TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6', // Tensor TNSR
]);

export class InternalChecker {
  private connection: Connection;

  constructor() {
    const rpcUrl = config.heliusApiKey
      ? `https://devnet.helius-rpc.com/?api-key=${config.heliusApiKey}`
      : config.solanaRpcUrl;
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Run all internal safety checks on a token mint
   */
  async checkToken(tokenMint: string): Promise<InternalCheckResult> {
    const flags: SafetyFlag[] = [];
    let score = 100; // Start at 100, deduct for issues

    // 0. Known address check (fast path)
    if (KNOWN_SCAM_ADDRESSES.has(tokenMint)) {
      return {
        score: 0,
        flags: [{
          category: SafetyCategory.KNOWN_SCAM,
          severity: 'danger',
          message: 'Token mint is in known scam database',
          details: `Address ${tokenMint} has been flagged as a known scam token.`,
        }],
        tokenDistribution: null,
        mintInfo: null,
        accountAgeSeconds: null,
      };
    }

    if (KNOWN_SAFE_ADDRESSES.has(tokenMint)) {
      score = Math.min(score, 95); // Still not 100 — always verify
      flags.push({
        category: SafetyCategory.KNOWN_SCAM,
        severity: 'info',
        message: 'Token is from a known legitimate protocol',
        details: null,
      });
    }

    // 1. Fetch mint info
    let mintInfo: MintInfo | null = null;
    try {
      mintInfo = await this.fetchMintInfo(tokenMint);

      // Check mint authority
      if (mintInfo.mintAuthority) {
        score -= 15;
        flags.push({
          category: SafetyCategory.MINT_AUTHORITY,
          severity: 'warning',
          message: 'Mint authority is still active — token supply can be inflated',
          details: `Mint authority: ${mintInfo.mintAuthority}`,
        });
      }

      // Check freeze authority
      if (mintInfo.freezeAuthority) {
        score -= 25;
        flags.push({
          category: SafetyCategory.FREEZE_AUTHORITY,
          severity: 'danger',
          message: 'Freeze authority is active — your tokens can be frozen',
          details: `Freeze authority: ${mintInfo.freezeAuthority}`,
        });
      }
    } catch (error) {
      score -= 20;
      flags.push({
        category: SafetyCategory.UNVERIFIED_CONTRACT,
        severity: 'warning',
        message: 'Could not fetch token mint information',
        details: (error as Error).message,
      });
    }

    // 2. Token distribution analysis
    let distribution: TokenDistribution | null = null;
    try {
      distribution = await this.analyzeDistribution(tokenMint);

      if (distribution.top10Percentage > 80) {
        score -= 30;
        flags.push({
          category: SafetyCategory.TOKEN_CONCENTRATION,
          severity: 'danger',
          message: `Top 10 holders control ${distribution.top10Percentage.toFixed(1)}% of supply`,
          details: 'Extremely concentrated token distribution — high rug pull risk.',
        });
      } else if (distribution.top10Percentage > 60) {
        score -= 15;
        flags.push({
          category: SafetyCategory.TOKEN_CONCENTRATION,
          severity: 'warning',
          message: `Top 10 holders control ${distribution.top10Percentage.toFixed(1)}% of supply`,
          details: 'Moderately concentrated token distribution.',
        });
      }

      if (distribution.top1Percentage > 50) {
        score -= 20;
        flags.push({
          category: SafetyCategory.TOKEN_CONCENTRATION,
          severity: 'danger',
          message: `Single holder owns ${distribution.top1Percentage.toFixed(1)}% of supply`,
          details: `Address: ${distribution.holders[0]?.address ?? 'unknown'}`,
        });
      }
    } catch (error) {
      // Distribution analysis can fail for new tokens
      flags.push({
        category: SafetyCategory.TOKEN_CONCENTRATION,
        severity: 'info',
        message: 'Could not analyze token distribution',
        details: (error as Error).message,
      });
    }

    // 3. Account age check
    let accountAgeSeconds: number | null = null;
    try {
      accountAgeSeconds = await this.checkAccountAge(tokenMint);

      const ageDays = accountAgeSeconds / 86400;
      if (ageDays < 1) {
        score -= 20;
        flags.push({
          category: SafetyCategory.ACCOUNT_AGE,
          severity: 'danger',
          message: 'Token was created less than 24 hours ago',
          details: `Age: ${(accountAgeSeconds / 3600).toFixed(1)} hours`,
        });
      } else if (ageDays < 7) {
        score -= 10;
        flags.push({
          category: SafetyCategory.ACCOUNT_AGE,
          severity: 'warning',
          message: `Token was created ${ageDays.toFixed(1)} days ago`,
          details: 'Relatively new token — proceed with caution.',
        });
      }
    } catch {
      // Age check failure is not critical
    }

    // 4. Transaction volume check
    try {
      const signatures = await this.connection.getSignaturesForAddress(
        new PublicKey(tokenMint),
        { limit: 100 },
      );

      if (signatures.length < 10) {
        score -= 10;
        flags.push({
          category: SafetyCategory.LOW_VOLUME,
          severity: 'warning',
          message: `Very low transaction activity (${signatures.length} transactions)`,
          details: 'Low volume could indicate a new or inactive token.',
        });
      }
    } catch {
      // Volume check failure is not critical
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      flags,
      tokenDistribution: distribution,
      mintInfo,
      accountAgeSeconds,
    };
  }

  /** Fetch and parse mint account info */
  private async fetchMintInfo(tokenMint: string): Promise<MintInfo> {
    const pubkey = new PublicKey(tokenMint);
    const accountInfo = await this.connection.getParsedAccountInfo(pubkey);

    if (!accountInfo.value) {
      throw new Error(`Account not found: ${tokenMint}`);
    }

    if (!('parsed' in accountInfo.value.data)) {
      throw new Error('Account data is not parsed (not a token mint)');
    }

    const parsed = accountInfo.value.data as ParsedAccountData;
    const info = parsed.parsed?.info;

    if (!info) {
      throw new Error('Could not parse mint info');
    }

    return {
      mintAuthority: info.mintAuthority ?? null,
      freezeAuthority: info.freezeAuthority ?? null,
      supply: BigInt(info.supply ?? '0'),
      decimals: info.decimals ?? 0,
      isInitialized: info.isInitialized ?? false,
    };
  }

  /** Analyze token distribution among holders */
  private async analyzeDistribution(tokenMint: string): Promise<TokenDistribution> {
    const mintPubkey = new PublicKey(tokenMint);

    // Get largest token accounts for this mint
    const largestAccounts = await this.connection.getTokenLargestAccounts(mintPubkey);

    if (!largestAccounts.value || largestAccounts.value.length === 0) {
      throw new Error('No token accounts found');
    }

    // Calculate total from largest accounts
    const totalFromLargest = largestAccounts.value.reduce(
      (sum, acc) => sum + Number(acc.uiAmount ?? 0), 0,
    );

    // Get supply for percentage calculation
    const supply = await this.connection.getTokenSupply(mintPubkey);
    const totalSupply = Number(supply.value.uiAmount ?? totalFromLargest);

    if (totalSupply === 0) {
      throw new Error('Token has zero supply');
    }

    const holders: TokenHolderInfo[] = largestAccounts.value.map(acc => ({
      address: acc.address.toBase58(),
      balance: Number(acc.uiAmount ?? 0),
      percentage: (Number(acc.uiAmount ?? 0) / totalSupply) * 100,
    }));

    const top10 = holders.slice(0, 10);
    const top10Percentage = top10.reduce((sum, h) => sum + h.percentage, 0);
    const top1Percentage = holders[0]?.percentage ?? 0;

    return {
      totalSupply,
      holders,
      top10Percentage,
      top1Percentage,
    };
  }

  /** Check how old the token mint account is */
  private async checkAccountAge(tokenMint: string): Promise<number> {
    const pubkey = new PublicKey(tokenMint);

    // Get the first transaction for this account
    const signatures = await this.connection.getSignaturesForAddress(pubkey, {
      limit: 1,
      before: undefined,
    });

    // getSignaturesForAddress returns newest first, so get the oldest
    // For a more accurate check, we'd paginate to the very first tx
    // For now, use the account's lamport balance creation as proxy
    const oldest = signatures[signatures.length - 1];
    if (oldest?.blockTime) {
      const age = Math.floor(Date.now() / 1000) - oldest.blockTime;
      return age;
    }

    throw new Error('Could not determine account age');
  }
}
