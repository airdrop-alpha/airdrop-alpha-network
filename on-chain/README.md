# AirdropAlpha On-Chain Registry

Solana program for storing airdrop safety analysis results on-chain. Part of the AirdropAlpha intelligence platform.

## Architecture

```
┌─────────────────────────────────────────────────┐
│              AirdropAlpha Frontend               │
│         (Next.js / React Dashboard)              │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│           AirdropAlpha API Backend               │
│      (Safety Analysis Engine + Scoring)          │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│        On-Chain Client (TypeScript)              │
│    @airdrop-alpha/on-chain-client                │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│     Solana Program: airdrop_registry             │
│                                                  │
│  ┌──────────────┐  ┌─────────────────────────┐  │
│  │   Registry    │  │     SafetyReport        │  │
│  │  (per user)   │  │  (per token + analyst)  │  │
│  │               │  │                         │  │
│  │ authority     │  │ authority               │  │
│  │ total_reports │  │ token_mint              │  │
│  │ bump          │  │ risk_score (0-100)      │  │
│  └──────────────┘  │ risk_level (H/M/L)      │  │
│                     │ flags_count             │  │
│                     │ protocol_name           │  │
│                     │ timestamp               │  │
│                     │ bump                    │  │
│                     └─────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## Program

- **Language:** Rust + Anchor Framework
- **Network:** Solana Devnet (mainnet-ready)
- **Program ID:** See `Anchor.toml`

### Instructions

| Instruction | Description |
|---|---|
| `initialize_registry` | Create a registry for an analyst |
| `submit_report` | Submit a new safety analysis report for a token |
| `update_report` | Update an existing report with fresh analysis |

### Accounts (PDAs)

- **Registry** — `seeds = ["registry", authority]`
- **SafetyReport** — `seeds = ["safety_report", token_mint, authority]`

### Risk Levels

| Value | Level | Description |
|---|---|---|
| 0 | HIGH | Significant risk flags detected |
| 1 | MEDIUM | Some concerns identified |
| 2 | LOW | Appears safe based on analysis |

## Quick Start

### Build

```bash
cd on-chain
anchor build
```

### Test

```bash
anchor test
```

### Deploy to Devnet

```bash
solana config set --url devnet
solana airdrop 2
anchor deploy --provider.cluster devnet
```

## TypeScript Client

```typescript
import { AirdropRegistryClient, RiskLevel } from '@airdrop-alpha/on-chain-client';
import { Connection, clusterApiUrl } from '@solana/web3.js';

const connection = new Connection(clusterApiUrl('devnet'));
const client = new AirdropRegistryClient(connection, wallet);

// Initialize (once per analyst)
await client.initializeRegistry();

// Submit a report
await client.submitReport(
  tokenMintPubkey,
  'JupiterExchange',
  92,           // risk score
  RiskLevel.LOW,
  2             // flags count
);

// Read a report
const report = await client.getReport(tokenMintPubkey);
console.log(report.riskScore); // 92

// Get all reports
const allReports = await client.getAllReports();
```

## Integration with Main App

The main AirdropAlpha app uses the on-chain client after performing off-chain analysis:

1. **Analyze** — Backend runs safety checks (contract analysis, liquidity, team verification)
2. **Score** — Generate risk score (0-100) and risk level
3. **Store** — Submit report on-chain via `submitReport()`
4. **Verify** — Anyone can read reports directly from Solana
5. **Update** — Re-analyze periodically and update on-chain data

This creates an immutable, transparent record of safety analyses.
