# AirdropAlpha On-Chain Registry

Solana program for storing airdrop safety analysis results and managing user subscriptions on-chain. Part of the AirdropAlpha intelligence platform.

## 🚀 Deployed

- **Network:** Solana Devnet
- **Program ID:** `38CFzCb11EneZMQujTVZqJmXU7mXLxMg9fsS9hSZgnsC`
- **Explorer:** [View on Solscan](https://solscan.io/account/38CFzCb11EneZMQujTVZqJmXU7mXLxMg9fsS9hSZgnsC?cluster=devnet)

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
│  ┌──────────────────────────────────────────┐   │
│  │           SAFETY REPORTS                  │   │
│  │                                           │   │
│  │  Registry (per analyst)                   │   │
│  │  └─ SafetyReport (per token + analyst)    │   │
│  │                                           │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │         SUBSCRIPTIONS (NEW)               │   │
│  │                                           │   │
│  │  SubscriptionConfig (global)              │   │
│  │  └─ Subscription (per user)               │   │
│  │                                           │   │
│  │  Tiers: Basic / Pro / Alpha               │   │
│  │  Payment: SOL (USDC support coming)       │   │
│  │                                           │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

## Features

### 🔍 Safety Reports
- Store on-chain safety analysis results
- Risk scores (0-100), risk levels (HIGH/MEDIUM/LOW)
- Protocol name and risk flag tracking
- Immutable audit trail

### 💳 Subscription System (v0.2.0)
- **Tier 1 (Basic):** Access to basic safety reports
- **Tier 2 (Pro):** Advanced analysis + alerts
- **Tier 3 (Alpha):** Full access + early signals
- SOL payments with automatic expiry
- On-chain verification for access control

## Instructions

### Safety Reports

| Instruction | Description |
|---|---|
| `initialize_registry` | Create a registry for an analyst |
| `submit_report` | Submit a new safety analysis report |
| `update_report` | Update an existing report |

### Subscriptions

| Instruction | Description |
|---|---|
| `initialize_subscription_config` | Admin: Set up pricing and treasury |
| `subscribe` | User: Purchase a new subscription |
| `renew_subscription` | User: Extend or upgrade subscription |
| `verify_subscription` | Check if user has required tier |
| `update_pricing` | Admin: Update subscription prices |

## Accounts (PDAs)

```
Registry:            seeds = ["registry", authority]
SafetyReport:        seeds = ["safety_report", token_mint, authority]
SubscriptionConfig:  seeds = ["subscription_config"]
Subscription:        seeds = ["subscription", user]
```

## Risk Levels

| Value | Level | Description |
|---|---|---|
| 0 | HIGH | Significant risk flags detected |
| 1 | MEDIUM | Some concerns identified |
| 2 | LOW | Appears safe based on analysis |

## Subscription Tiers

| Tier | Name | Access |
|---|---|---|
| 1 | Basic | Basic safety reports |
| 2 | Pro | Advanced analysis + alerts |
| 3 | Alpha | Full access + early signals |

## Quick Start

### Build

```bash
cd on-chain

# Build program
cargo build-sbf --manifest-path programs/airdrop_registry/Cargo.toml

# Or with Anchor (requires version 0.29.0)
anchor build
```

### Deploy to Devnet

```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

solana config set --url devnet
solana airdrop 2

# Deploy (or upgrade)
solana program deploy --program-id 38CFzCb11EneZMQujTVZqJmXU7mXLxMg9fsS9hSZgnsC \
  target/deploy/airdrop_registry.so
```

## TypeScript Client

```typescript
import { AirdropRegistryClient, RiskLevel } from '@airdrop-alpha/on-chain-client';
import { Connection, clusterApiUrl, LAMPORTS_PER_SOL } from '@solana/web3.js';

const connection = new Connection(clusterApiUrl('devnet'));
const client = new AirdropRegistryClient(connection, wallet);

// ─────────────────────────────────────────────
// Safety Reports
// ─────────────────────────────────────────────

// Initialize (once per analyst)
await client.initializeRegistry();

// Submit a report
await client.submitReport(
  tokenMintPubkey,
  'JupiterExchange',
  92,             // risk score (0-100)
  RiskLevel.LOW,  // 0=HIGH, 1=MEDIUM, 2=LOW
  2               // flags count
);

// Read a report
const report = await client.getReport(tokenMintPubkey);
console.log(report.riskScore); // 92

// ─────────────────────────────────────────────
// Subscriptions
// ─────────────────────────────────────────────

// Admin: Initialize subscription config
await client.initializeSubscriptionConfig(
  treasuryPubkey,
  0.5 * LAMPORTS_PER_SOL,  // Basic: 0.5 SOL
  1 * LAMPORTS_PER_SOL,    // Pro: 1 SOL
  2 * LAMPORTS_PER_SOL,    // Alpha: 2 SOL
  30 * 24 * 60 * 60        // 30 days
);

// User: Subscribe to Pro tier
await client.subscribe(2); // tier 2 = Pro

// Check subscription
const sub = await client.getSubscription(userPubkey);
console.log(`Tier: ${sub.tier}, Expires: ${new Date(sub.expiresAt * 1000)}`);

// Verify access (throws if insufficient)
await client.verifySubscription(2); // requires Pro or higher
```

## Integration with Main App

1. **Analyze** — Backend runs safety checks (contract, liquidity, team)
2. **Score** — Generate risk score and level
3. **Store** — Submit report on-chain via `submitReport()`
4. **Gate** — Check subscription tier before showing premium data
5. **Verify** — Anyone can read public reports from Solana

## Roadmap

- [x] Safety report storage
- [x] Subscription management
- [x] SOL payments
- [ ] USDC payments (SPL Token)
- [ ] Subscription NFTs
- [ ] Referral rewards
- [ ] DAO governance

## License

MIT
