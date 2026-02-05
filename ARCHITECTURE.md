# AirdropAlpha — Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AirdropAlpha Network                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │   Airdrop     │    │   Safety Layer    │    │  Auto-Execution  │  │
│  │   Scanner     │───▶│                   │───▶│  Engine          │  │
│  │   Engine      │    │  ┌─────────────┐  │    │                  │  │
│  │              │    │  │  Internal    │  │    │  Jupiter DEX     │  │
│  │  On-chain    │    │  │  Checker     │  │    │  Raydium AMM     │  │
│  │  Social      │    │  ├─────────────┤  │    │  Token Claims    │  │
│  │  Protocol    │    │  │ AgentShield  │  │    │                  │  │
│  │  Monitoring  │    │  │  (External)  │  │    │                  │  │
│  └──────────────┘    │  └─────────────┘  │    └──────────────────┘  │
│         │            └──────────────────┘             │             │
│         │                     │                       │             │
│         ▼                     ▼                       ▼             │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Intelligence API (x402)                   │   │
│  │                                                              │   │
│  │  GET /airdrops          — List opportunities (free/paid)     │   │
│  │  GET /airdrops/:id      — Detailed analysis (paid)          │   │
│  │  GET /airdrops/:id/safety — Safety report (paid)            │   │
│  │  POST /airdrops/:id/execute — Auto-execute (premium)        │   │
│  │  GET /skill.json        — Agent skill descriptor             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                                                           │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Agent Skill Interface (skill.json)              │   │
│  │         — Discoverable by other AI agents via x402 —         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

External Dependencies:
  ├── Solana RPC (Helius)     — On-chain data, transaction submission
  ├── AgentShield API         — Scam detection, address validation
  ├── Jupiter Aggregator      — DEX swaps for auto-execution
  └── x402 Payment Protocol   — USDC micropayments on Solana
```

## Component Breakdown

### 1. Airdrop Scanner Engine (`src/scanner/`)

**Purpose:** Continuously discover and catalog new Solana airdrop opportunities.

**Data Sources:**
- **On-chain monitoring:** New token mints with airdrop-like distribution patterns (via Helius RPC + WebSocket)
- **Known protocols:** Track addresses of protocols known to do airdrops (Jupiter, Tensor, Marinade, etc.)
- **Eligibility detection:** Parse on-chain data for claim windows, snapshot dates, eligibility criteria

**Output:** `AirdropOpportunity` objects with:
- Token info (mint, name, symbol)
- Source protocol
- Estimated value
- Eligibility criteria
- Deadline / claim window
- Effort score (how hard to qualify)
- Raw confidence score

### 2. Safety Layer 1 — Internal Checker (`src/safety/internal-checker.ts`)

**Purpose:** First-pass security analysis using our own heuristics.

**Checks performed:**
| Check | Method | Red Flag Threshold |
|-------|--------|-------------------|
| Token concentration | Top 10 holders' % | > 80% = high risk |
| Mint authority | Is it revoked? | Active = medium risk |
| Freeze authority | Is it revoked? | Active = high risk |
| Account age | Program deploy date | < 7 days = medium risk |
| Transaction volume | Recent tx count | < 100 = low confidence |
| Known scam patterns | Address blacklist | Match = reject |

**Output:** `InternalSafetyScore` (0–100, higher = safer)

### 3. Safety Layer 2 — AgentShield (`src/safety/agentshield-client.ts`)

**Purpose:** External security validation via AgentShield API.

**Integration points:**
- `POST /api/scan` — Submit contract/program code for analysis
- `POST /api/address` — Validate token mint and deployer addresses
- `POST /api/transaction` — Pre-flight check on execution transactions

**Output:** `AgentShieldReport` with threat level, flags, and recommendations

**Combined Safety Rating:**
```
finalScore = (internalScore * 0.6) + (agentShieldScore * 0.4)
riskLevel = HIGH (< 30) | MEDIUM (30-70) | LOW (> 70)
```

### 4. Intelligence API (`src/api/`)

**Purpose:** x402-gated REST API for consuming airdrop intelligence.

**Payment tiers:**
| Endpoint | Price (USDC) | Description |
|----------|-------------|-------------|
| GET /airdrops | Free (top 3) | Preview of opportunities |
| GET /airdrops | 0.01 | Full list with scores |
| GET /airdrops/:id | 0.05 | Detailed analysis |
| GET /airdrops/:id/safety | 0.10 | Full safety report |
| POST /airdrops/:id/execute | 1.00 | Auto-execute claim |

**x402 flow:**
1. Client sends request
2. Server responds with `402 Payment Required` + payment details
3. Client pays via Solana USDC transfer
4. Client retries with payment proof in `X-Payment` header
5. Server verifies on-chain, serves response

### 5. Auto-Execution Engine (`src/executor/`)

**Purpose:** Automated airdrop claim and token swap execution.

**Capabilities:**
- Claim airdrop tokens via program instruction
- Swap received tokens via Jupiter aggregator
- Set stop-loss / take-profit via limit orders
- Track execution status and P&L

**Safety:** All transactions pass through AgentShield pre-flight check before submission.

### 6. Agent Skill Interface (`src/skill/`)

**Purpose:** Standard `skill.json` descriptor for agent-to-agent discovery.

**Protocol:** Follows emerging AI agent interop standards. Other agents can:
1. Discover AirdropAlpha via skill.json
2. Query available endpoints and pricing
3. Make x402-paid API calls programmatically
4. Chain with their own workflows (e.g., portfolio manager agent)

## Data Flow

```
1. Scanner discovers opportunity
       │
2. Internal checker scores safety
       │
3. AgentShield validates externally
       │
4. Opportunity stored with combined score
       │
5. API serves to clients (x402 gated)
       │
6. (Optional) Executor claims airdrop
       │
7. (Optional) Auto-swap via Jupiter
```

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js + TypeScript |
| Blockchain | Solana (devnet for demo) |
| RPC | Helius |
| API Framework | Express.js |
| Payments | x402 (USDC on Solana) |
| Security | AgentShield API + internal heuristics |
| DEX | Jupiter Aggregator API |
