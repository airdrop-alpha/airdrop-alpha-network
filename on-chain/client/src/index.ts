/**
 * AirdropAlpha On-Chain Client
 *
 * TypeScript client for interacting with the airdrop_registry Solana program.
 * Used by the main AirdropAlpha app to submit safety reports on-chain.
 */

import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

// Program ID — will be updated after deployment
export const PROGRAM_ID = new PublicKey(
  "11111111111111111111111111111111" // TODO: Replace with actual deployed program ID
);

// Risk level enum matching on-chain representation
export enum RiskLevel {
  HIGH = 0,
  MEDIUM = 1,
  LOW = 2,
}

// Safety report data structure
export interface SafetyReportData {
  authority: PublicKey;
  tokenMint: PublicKey;
  riskScore: number;
  riskLevel: RiskLevel;
  flagsCount: number;
  protocolName: string;
  timestamp: number;
  bump: number;
}

// Registry data structure
export interface RegistryData {
  authority: PublicKey;
  totalReports: number;
  bump: number;
}

/**
 * AirdropRegistryClient — Main client for on-chain interactions.
 *
 * Usage:
 *   const client = new AirdropRegistryClient(connection, wallet);
 *   await client.initializeRegistry();
 *   await client.submitReport(tokenMint, "Protocol", 85, RiskLevel.LOW, 3);
 */
export class AirdropRegistryClient {
  private connection: Connection;
  private provider: anchor.AnchorProvider;
  private program: anchor.Program;

  constructor(
    connection: Connection,
    wallet: anchor.Wallet,
    programId: PublicKey = PROGRAM_ID
  ) {
    this.connection = connection;
    this.provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });

    // Load IDL dynamically or use a pre-generated one
    this.program = new anchor.Program(IDL as any, programId, this.provider);
  }

  // ========================================================================
  // PDA Derivation
  // ========================================================================

  /**
   * Derive the Registry PDA for a given authority.
   */
  getRegistryPda(authority: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("registry"), authority.toBuffer()],
      this.program.programId
    );
  }

  /**
   * Derive the SafetyReport PDA for a given token mint and authority.
   */
  getReportPda(
    tokenMint: PublicKey,
    authority: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("safety_report"),
        tokenMint.toBuffer(),
        authority.toBuffer(),
      ],
      this.program.programId
    );
  }

  // ========================================================================
  // Instructions
  // ========================================================================

  /**
   * Initialize a registry for the connected wallet.
   */
  async initializeRegistry(): Promise<string> {
    const authority = this.provider.wallet.publicKey;
    const [registryPda] = this.getRegistryPda(authority);

    const tx = await this.program.methods
      .initializeRegistry()
      .accounts({
        registry: registryPda,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`Registry initialized: ${registryPda.toBase58()}`);
    console.log(`Transaction: ${tx}`);
    return tx;
  }

  /**
   * Submit a new safety report for a token.
   */
  async submitReport(
    tokenMint: PublicKey,
    protocolName: string,
    riskScore: number,
    riskLevel: RiskLevel,
    flagsCount: number
  ): Promise<string> {
    const authority = this.provider.wallet.publicKey;
    const [registryPda] = this.getRegistryPda(authority);
    const [reportPda] = this.getReportPda(tokenMint, authority);

    const tx = await this.program.methods
      .submitReport(protocolName, riskScore, riskLevel, flagsCount)
      .accounts({
        safetyReport: reportPda,
        registry: registryPda,
        tokenMint,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`Report submitted for ${tokenMint.toBase58()}`);
    console.log(`Report PDA: ${reportPda.toBase58()}`);
    console.log(`Transaction: ${tx}`);
    return tx;
  }

  /**
   * Update an existing safety report.
   */
  async updateReport(
    tokenMint: PublicKey,
    protocolName: string,
    riskScore: number,
    riskLevel: RiskLevel,
    flagsCount: number
  ): Promise<string> {
    const authority = this.provider.wallet.publicKey;
    const [reportPda] = this.getReportPda(tokenMint, authority);

    const tx = await this.program.methods
      .updateReport(protocolName, riskScore, riskLevel, flagsCount)
      .accounts({
        safetyReport: reportPda,
        authority,
      })
      .rpc();

    console.log(`Report updated for ${tokenMint.toBase58()}`);
    console.log(`Transaction: ${tx}`);
    return tx;
  }

  // ========================================================================
  // Read Operations
  // ========================================================================

  /**
   * Fetch a safety report by token mint.
   */
  async getReport(
    tokenMint: PublicKey,
    authority?: PublicKey
  ): Promise<SafetyReportData | null> {
    const auth = authority || this.provider.wallet.publicKey;
    const [reportPda] = this.getReportPda(tokenMint, auth);

    try {
      const report = await this.program.account.safetyReport.fetch(reportPda);
      return {
        authority: report.authority as PublicKey,
        tokenMint: report.tokenMint as PublicKey,
        riskScore: report.riskScore as number,
        riskLevel: report.riskLevel as number,
        flagsCount: report.flagsCount as number,
        protocolName: report.protocolName as string,
        timestamp: (report.timestamp as any).toNumber(),
        bump: report.bump as number,
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetch registry info for an authority.
   */
  async getRegistry(authority?: PublicKey): Promise<RegistryData | null> {
    const auth = authority || this.provider.wallet.publicKey;
    const [registryPda] = this.getRegistryPda(auth);

    try {
      const registry = await this.program.account.registry.fetch(registryPda);
      return {
        authority: registry.authority as PublicKey,
        totalReports: (registry.totalReports as any).toNumber(),
        bump: registry.bump as number,
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetch all safety reports (paginated).
   */
  async getAllReports(): Promise<SafetyReportData[]> {
    const reports = await this.program.account.safetyReport.all();
    return reports.map((r) => ({
      authority: r.account.authority as PublicKey,
      tokenMint: r.account.tokenMint as PublicKey,
      riskScore: r.account.riskScore as number,
      riskLevel: r.account.riskLevel as number,
      flagsCount: r.account.flagsCount as number,
      protocolName: r.account.protocolName as string,
      timestamp: (r.account.timestamp as any).toNumber(),
      bump: r.account.bump as number,
    }));
  }
}

// ========================================================================
// IDL (will be auto-generated after anchor build, this is a placeholder)
// ========================================================================
const IDL = {
  version: "0.1.0",
  name: "airdrop_registry",
  instructions: [
    {
      name: "initializeRegistry",
      accounts: [
        { name: "registry", isMut: true, isSigner: false },
        { name: "authority", isMut: true, isSigner: true },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: "submitReport",
      accounts: [
        { name: "safetyReport", isMut: true, isSigner: false },
        { name: "registry", isMut: true, isSigner: false },
        { name: "tokenMint", isMut: false, isSigner: false },
        { name: "authority", isMut: true, isSigner: true },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "protocolName", type: "string" },
        { name: "riskScore", type: "u8" },
        { name: "riskLevel", type: "u8" },
        { name: "flagsCount", type: "u8" },
      ],
    },
    {
      name: "updateReport",
      accounts: [
        { name: "safetyReport", isMut: true, isSigner: false },
        { name: "authority", isMut: true, isSigner: true },
      ],
      args: [
        { name: "protocolName", type: "string" },
        { name: "riskScore", type: "u8" },
        { name: "riskLevel", type: "u8" },
        { name: "flagsCount", type: "u8" },
      ],
    },
  ],
  accounts: [
    {
      name: "SafetyReport",
      type: {
        kind: "struct",
        fields: [
          { name: "authority", type: "publicKey" },
          { name: "tokenMint", type: "publicKey" },
          { name: "riskScore", type: "u8" },
          { name: "riskLevel", type: "u8" },
          { name: "flagsCount", type: "u8" },
          { name: "protocolName", type: "string" },
          { name: "timestamp", type: "i64" },
          { name: "bump", type: "u8" },
        ],
      },
    },
    {
      name: "Registry",
      type: {
        kind: "struct",
        fields: [
          { name: "authority", type: "publicKey" },
          { name: "totalReports", type: "u64" },
          { name: "bump", type: "u8" },
        ],
      },
    },
  ],
  errors: [
    { code: 6000, name: "InvalidRiskScore", msg: "Risk score must be between 0 and 100" },
    { code: 6001, name: "InvalidRiskLevel", msg: "Risk level must be 0 (HIGH), 1 (MEDIUM), or 2 (LOW)" },
    { code: 6002, name: "ProtocolNameTooLong", msg: "Protocol name must be 32 characters or less" },
  ],
};

export { IDL };
export default AirdropRegistryClient;
