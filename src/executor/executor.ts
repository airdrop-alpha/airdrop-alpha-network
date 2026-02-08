// ============================================================
// Auto-Execution Engine — Claim airdrops and swap tokens
// ============================================================

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { v4 as uuid } from 'uuid';
import {
  ExecutionResult,
  ExecutionStatus,
  AirdropOpportunity,
} from '../types';
import { config } from '../config';
import { AgentShieldClient } from '../safety/agentshield-client';

/** Jupiter quote API base (v6) */
const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6';

export class Executor {
  private connection: Connection;
  private wallet: Keypair | null = null;
  private agentShield: AgentShieldClient;
  private executions: Map<string, ExecutionResult> = new Map();

  constructor() {
    const rpcUrl = config.heliusApiKey
      ? `https://devnet.helius-rpc.com/?api-key=${config.heliusApiKey}`
      : config.solanaRpcUrl;
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.agentShield = new AgentShieldClient();

    // Load wallet if configured
    if (config.executorPrivateKey) {
      try {
        const decoded = bs58.decode(config.executorPrivateKey);
        this.wallet = Keypair.fromSecretKey(decoded);
        console.log(`[Executor] Wallet loaded: ${this.wallet.publicKey.toBase58()}`);
      } catch (error) {
        console.error('[Executor] Failed to load wallet:', (error as Error).message);
      }
    } else {
      console.log('[Executor] No wallet configured — execution will be simulated.');
    }
  }

  /** Check if executor has a wallet configured */
  isReady(): boolean {
    return this.wallet !== null;
  }

  /** Get execution result by ID */
  getExecution(id: string): ExecutionResult | undefined {
    return this.executions.get(id);
  }

  /**
   * Execute an airdrop claim
   * Flow: Build tx → AgentShield pre-flight → Simulate → Submit
   */
  async executeAirdropClaim(opportunity: AirdropOpportunity): Promise<ExecutionResult> {
    const executionId = uuid();
    const result: ExecutionResult = {
      id: executionId,
      airdropId: opportunity.id,
      status: ExecutionStatus.PENDING,
      transactionSignature: null,
      tokensReceived: null,
      estimatedValueUsd: null,
      error: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    this.executions.set(executionId, result);

    try {
      // Safety gate: reject high-risk opportunities
      if (opportunity.safetyScore < 30) {
        throw new Error(`Safety score too low (${opportunity.safetyScore}/100). Refusing to execute.`);
      }

      if (!this.wallet) {
        // Simulation mode
        return await this.simulateExecution(result, opportunity);
      }

      result.status = ExecutionStatus.SIMULATING;
      this.executions.set(executionId, { ...result });

      // Build the claim transaction
      const transaction = await this.buildClaimTransaction(opportunity);

      // AgentShield pre-flight check
      const preflightResult = await this.agentShield.checkTransaction(
        opportunity.tokenMint,
        0,
        opportunity.symbol,
        `airdrop-claim:${opportunity.name}`,
      );

      if (preflightResult.simulationResult === 'danger') {
        throw new Error(
          `AgentShield flagged transaction as dangerous: ${preflightResult.flags.join(', ')}`,
        );
      }

      if (preflightResult.simulationResult === 'warning') {
        console.warn('[Executor] AgentShield warning:', preflightResult.flags.join(', '));
      }

      // Simulate on-chain
      const simulation = await this.connection.simulateTransaction(transaction);
      if (simulation.value.err) {
        throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`);
      }

      // Execute
      result.status = ExecutionStatus.EXECUTING;
      this.executions.set(executionId, { ...result });

      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.wallet],
        { commitment: 'confirmed' },
      );

      result.status = ExecutionStatus.CONFIRMED;
      result.transactionSignature = signature;
      result.completedAt = new Date().toISOString();

      console.log(`[Executor] Claim confirmed: ${signature}`);

    } catch (error) {
      result.status = ExecutionStatus.FAILED;
      result.error = (error as Error).message;
      result.completedAt = new Date().toISOString();
      console.error(`[Executor] Execution failed:`, (error as Error).message);
    }

    this.executions.set(executionId, result);
    return result;
  }

  /**
   * Swap received tokens via Jupiter aggregator
   */
  async swapTokens(
    inputMint: string,
    outputMint: string,
    amount: number,
  ): Promise<{ signature: string | null; outputAmount: number | null }> {
    try {
      // Get Jupiter quote
      const quote = await this.getJupiterQuote(inputMint, outputMint, amount);

      if (!quote) {
        throw new Error('No Jupiter route found');
      }

      if (!this.wallet) {
        console.log(`[Executor] Simulated swap: ${amount} ${inputMint} → ${quote.outAmount} ${outputMint}`);
        return {
          signature: `simulated_swap_${uuid()}`,
          outputAmount: Number(quote.outAmount) / 1e6, // Assume 6 decimals
        };
      }

      // Get swap transaction from Jupiter
      const swapResponse = await fetch(`${JUPITER_QUOTE_API}/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: this.wallet.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
        }),
      });

      if (!swapResponse.ok) {
        throw new Error(`Jupiter swap API error: ${swapResponse.status}`);
      }

      const swapData = await swapResponse.json() as { swapTransaction?: string };
      if (!swapData.swapTransaction) {
        throw new Error('No swap transaction returned');
      }

      // Deserialize and sign
      const swapTx = Transaction.from(
        Buffer.from(swapData.swapTransaction, 'base64'),
      );
      swapTx.sign(this.wallet);

      const signature = await this.connection.sendRawTransaction(swapTx.serialize());
      await this.connection.confirmTransaction(signature, 'confirmed');

      return {
        signature,
        outputAmount: Number(quote.outAmount) / 1e6,
      };
    } catch (error) {
      console.error('[Executor] Swap failed:', (error as Error).message);
      return { signature: null, outputAmount: null };
    }
  }

  // ---- Private helpers ----

  /** Build a claim transaction (protocol-specific, simplified for demo) */
  private async buildClaimTransaction(opportunity: AirdropOpportunity): Promise<Transaction> {
    if (!this.wallet) throw new Error('No wallet configured');

    const tx = new Transaction();

    // In production, this would use protocol-specific claim instructions
    // For demo, we create a minimal transaction that interacts with the program
    if (opportunity.programId) {
      const programId = new PublicKey(opportunity.programId);
      const instruction = new TransactionInstruction({
        keys: [
          { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: new PublicKey(opportunity.tokenMint), isSigner: false, isWritable: true },
        ],
        programId,
        data: Buffer.from([0x01]), // Claim instruction discriminator (protocol-specific)
      });
      tx.add(instruction);
    } else {
      // Fallback: just a memo-style transaction for demo
      tx.add(
        SystemProgram.transfer({
          fromPubkey: this.wallet.publicKey,
          toPubkey: this.wallet.publicKey,
          lamports: 0,
        }),
      );
    }

    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.wallet.publicKey;

    return tx;
  }

  /** Get a Jupiter quote for a token swap */
  private async getJupiterQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
  ): Promise<Record<string, unknown> | null> {
    try {
      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: amount.toString(),
        slippageBps: '100', // 1% slippage
      });

      const response = await fetch(`${JUPITER_QUOTE_API}/quote?${params}`);
      if (!response.ok) return null;

      return await response.json() as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /** Simulate an execution (no wallet mode) */
  private async simulateExecution(
    result: ExecutionResult,
    opportunity: AirdropOpportunity,
  ): Promise<ExecutionResult> {
    console.log(`[Executor] Simulating execution for: ${opportunity.name}`);

    result.status = ExecutionStatus.SIMULATING;
    this.executions.set(result.id, { ...result });

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 1500));

    result.status = ExecutionStatus.CONFIRMED;
    result.transactionSignature = `simulated_${uuid()}`;
    result.tokensReceived = Math.floor(Math.random() * 1000) + 100;
    result.estimatedValueUsd = opportunity.estimatedValueUsd
      ? opportunity.estimatedValueUsd * (0.8 + Math.random() * 0.4)
      : null;
    result.completedAt = new Date().toISOString();

    this.executions.set(result.id, result);
    return result;
  }
}
