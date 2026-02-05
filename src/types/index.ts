// ============================================================
// AirdropAlpha — Core Type Definitions
// ============================================================

/** Risk level classification */
export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/** Status of an airdrop opportunity */
export enum AirdropStatus {
  DISCOVERED = 'DISCOVERED',
  VERIFIED = 'VERIFIED',
  ACTIVE = 'ACTIVE',
  CLAIMABLE = 'CLAIMABLE',
  EXPIRED = 'EXPIRED',
  SCAM = 'SCAM',
}

/** How hard it is to qualify for an airdrop */
export enum EffortLevel {
  TRIVIAL = 'TRIVIAL',       // Just hold a token or have used a protocol
  EASY = 'EASY',             // One or two simple actions
  MODERATE = 'MODERATE',     // Multiple interactions over time
  HARD = 'HARD',             // Complex criteria, capital required
}

/** Core airdrop opportunity record */
export interface AirdropOpportunity {
  id: string;
  name: string;
  symbol: string;
  tokenMint: string;
  sourceProtocol: string;
  description: string;
  status: AirdropStatus;

  // Value estimation
  estimatedValueUsd: number | null;
  confidence: number;         // 0–1, how confident we are in value estimate

  // Eligibility
  eligibilityCriteria: string[];
  snapshotDate: string | null;
  claimWindowStart: string | null;
  claimWindowEnd: string | null;
  effort: EffortLevel;

  // Safety
  safetyScore: number;        // 0–100, combined score
  riskLevel: RiskLevel;
  safetyReport: SafetyReport | null;

  // Metadata
  discoveredAt: string;
  updatedAt: string;
  sourceUrl: string | null;
  programId: string | null;
}

/** Combined safety report (internal + AgentShield) */
export interface SafetyReport {
  internalScore: number;       // 0–100
  agentShieldScore: number | null; // 0–100, null if not yet scanned
  combinedScore: number;       // 0–100
  riskLevel: RiskLevel;
  flags: SafetyFlag[];
  checkedAt: string;
}

/** Individual safety flag */
export interface SafetyFlag {
  category: SafetyCategory;
  severity: 'info' | 'warning' | 'danger';
  message: string;
  details: string | null;
}

export enum SafetyCategory {
  TOKEN_CONCENTRATION = 'TOKEN_CONCENTRATION',
  MINT_AUTHORITY = 'MINT_AUTHORITY',
  FREEZE_AUTHORITY = 'FREEZE_AUTHORITY',
  ACCOUNT_AGE = 'ACCOUNT_AGE',
  LOW_VOLUME = 'LOW_VOLUME',
  KNOWN_SCAM = 'KNOWN_SCAM',
  UNVERIFIED_CONTRACT = 'UNVERIFIED_CONTRACT',
  SUSPICIOUS_PATTERN = 'SUSPICIOUS_PATTERN',
  AGENTSHIELD_FLAG = 'AGENTSHIELD_FLAG',
}

// ============================================================
// Internal Safety Checker Types
// ============================================================

export interface TokenHolderInfo {
  address: string;
  balance: number;
  percentage: number;
}

export interface TokenDistribution {
  totalSupply: number;
  holders: TokenHolderInfo[];
  top10Percentage: number;
  top1Percentage: number;
}

export interface MintInfo {
  mintAuthority: string | null;
  freezeAuthority: string | null;
  supply: bigint;
  decimals: number;
  isInitialized: boolean;
}

export interface InternalCheckResult {
  score: number;               // 0–100
  flags: SafetyFlag[];
  tokenDistribution: TokenDistribution | null;
  mintInfo: MintInfo | null;
  accountAgeSeconds: number | null;
}

// ============================================================
// AgentShield Types
// ============================================================

export interface AgentShieldScanRequest {
  code?: string;
  address?: string;
  programId?: string;
}

export interface AgentShieldScanResponse {
  status: 'safe' | 'warning' | 'danger' | 'unknown';
  score: number;               // 0–100
  threats: AgentShieldThreat[];
  metadata: Record<string, unknown>;
}

export interface AgentShieldThreat {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

export interface AgentShieldAddressResponse {
  address: string;
  isMalicious: boolean;
  riskScore: number;
  labels: string[];
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface AgentShieldTransactionCheck {
  transaction: string;          // base64 encoded
  simulationResult: 'safe' | 'warning' | 'danger';
  estimatedChanges: BalanceChange[];
  flags: string[];
}

export interface BalanceChange {
  token: string;
  mint: string;
  before: number;
  after: number;
  change: number;
}

// ============================================================
// Execution Types
// ============================================================

export enum ExecutionStatus {
  PENDING = 'PENDING',
  SIMULATING = 'SIMULATING',
  EXECUTING = 'EXECUTING',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
}

export interface ExecutionResult {
  id: string;
  airdropId: string;
  status: ExecutionStatus;
  transactionSignature: string | null;
  tokensReceived: number | null;
  estimatedValueUsd: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

// ============================================================
// x402 Payment Types
// ============================================================

export interface X402PaymentRequired {
  version: '1';
  network: 'solana';
  payTo: string;
  maxAmountRequired: string;
  asset: string;               // USDC mint address
  resource: string;
  description: string;
  mimeType: string;
  outputSchema?: Record<string, unknown>;
}

export interface X402PaymentHeader {
  version: '1';
  network: 'solana';
  transaction: string;          // base58 encoded signed tx
}

// ============================================================
// API Types
// ============================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  offset: number;
  limit: number;
}

// ============================================================
// Skill Interface Types
// ============================================================

export interface SkillDescriptor {
  name: string;
  description: string;
  version: string;
  author: string;
  endpoints: SkillEndpoint[];
  pricing: {
    currency: string;
    network: string;
    paymentProtocol: string;
  };
  capabilities: string[];
}

export interface SkillEndpoint {
  path: string;
  method: string;
  description: string;
  priceUsdc: number;
  parameters?: SkillParameter[];
  responseSchema?: Record<string, unknown>;
}

export interface SkillParameter {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

// ============================================================
// Config
// ============================================================

export interface AppConfig {
  port: number;
  solanaRpcUrl: string;
  heliusApiKey: string;
  agentShieldUrl: string;
  agentShieldApiKey: string;
  paymentAddress: string;
  usdcMint: string;
  executorPrivateKey: string | null;
  nodeEnv: string;
}
