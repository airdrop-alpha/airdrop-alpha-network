/**
 * AirdropAlpha On-Chain Demo
 *
 * Demonstrates how to use the on-chain client to submit safety reports.
 * Run: npx ts-node src/demo.ts
 */

import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { AirdropRegistryClient, RiskLevel } from "./index";

async function main() {
  // Connect to devnet
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  // Load wallet from file system (or use env var)
  const walletKeyPath = process.env.WALLET_KEY || "~/.config/solana/id.json";
  console.log("Loading wallet from:", walletKeyPath);

  // For demo, generate a new keypair (in production, load from file)
  const keypair = Keypair.generate();
  const wallet = new anchor.Wallet(keypair);

  console.log("Wallet:", keypair.publicKey.toBase58());
  console.log("Requesting airdrop...");

  // Airdrop some SOL for transaction fees
  const airdropSig = await connection.requestAirdrop(
    keypair.publicKey,
    2 * 1_000_000_000 // 2 SOL
  );
  await connection.confirmTransaction(airdropSig);
  console.log("Airdrop confirmed");

  // Initialize client
  const client = new AirdropRegistryClient(connection, wallet);

  // Step 1: Initialize registry
  console.log("\n--- Initializing Registry ---");
  const initTx = await client.initializeRegistry();
  console.log("Registry TX:", initTx);

  // Step 2: Submit a safety report
  console.log("\n--- Submitting Safety Report ---");
  const tokenMint = Keypair.generate().publicKey; // In production, use actual token mint
  const submitTx = await client.submitReport(
    tokenMint,
    "JupiterExchange",
    92,
    RiskLevel.LOW,
    2
  );
  console.log("Submit TX:", submitTx);

  // Step 3: Read back the report
  console.log("\n--- Reading Report ---");
  const report = await client.getReport(tokenMint);
  if (report) {
    console.log("Protocol:", report.protocolName);
    console.log("Risk Score:", report.riskScore, "/ 100");
    console.log(
      "Risk Level:",
      report.riskLevel === 0 ? "HIGH" : report.riskLevel === 1 ? "MEDIUM" : "LOW"
    );
    console.log("Flags:", report.flagsCount);
    console.log("Timestamp:", new Date(report.timestamp * 1000).toISOString());
  }

  // Step 4: Update the report
  console.log("\n--- Updating Report ---");
  const updateTx = await client.updateReport(
    tokenMint,
    "JupiterExchange",
    95,
    RiskLevel.LOW,
    1
  );
  console.log("Update TX:", updateTx);

  // Step 5: Check registry stats
  console.log("\n--- Registry Stats ---");
  const registry = await client.getRegistry();
  if (registry) {
    console.log("Total Reports:", registry.totalReports);
  }

  console.log("\n✅ Demo complete!");
}

main().catch(console.error);
