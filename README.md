# 🪂 AirdropAlpha — Solana Airdrop Intelligence Network

> AI-powered airdrop discovery with **real on-chain data**, dual-layer safety scanning, and auto-execution on Solana — monetized via x402 micropayments.

**Built for the [Solana Agent Hackathon](https://www.colosseum.org/) (Colosseum)**

🔗 **[Live Demo](https://advantage-nottingham-survive-manufacturers.trycloudflare.com)** | 📺 **[Demo Video](https://github.com/airdrop-alpha/airdrop-alpha-network#demo)** | 🏆 **[Colosseum Project](https://colosseum.com/agent-hackathon/projects/airdropalpha)**

---

## What is AirdropAlpha?

AirdropAlpha is an airdrop intelligence service for the Solana ecosystem. It continuously scans **real on-chain data** from Solana devnet to discover airdrop opportunities, runs dual-layer security analysis, and can auto-execute claims — all accessible through an x402-gated API that other AI agents can discover and use.

### Key Features

- **🔗 Real On-Chain Data** — Queries Solana devnet for live token mints, distributions, and protocol activity
- **🔍 Protocol-Specific Scanning** — Dedicated scanners for Jupiter, Marinade, Drift, Jito, Tensor, Parcl
- **🧠 Heuristic Analysis** — AI-powered scoring: distribution patterns, token concentration, multi-signal correlation
- **🛡️ Dual-Layer Safety** — Internal heuristic analysis + external [AgentShield](https://agentshield.lobsec.org) validation
- **⚡ Auto-Execution** — Claim airdrops automatically with pre-flight safety checks
- **💰 x402 Micropayments** — Pay-per-request API using USDC on Solana ([x402 protocol](https://www.x402.org/))
- **🤖 Agent-to-Agent** — Discoverable `skill.json` endpoint for AI agent interoperability
- **🎯 Demo Mode** — Works out of the box with zero configuration

---

## Architecture

```
                        ┌──────────────────────────────────────────┐
                        │         AirdropAlpha v0.2.0               │
                        │      Real Solana Data Integration         │
                        └──────────────────────────────────────────┘
                                         │
          ┌──────────────────────────────┼──────────────────────────────┐
          ▼                              ▼                              ▼
┌──────────────────┐    ┌──────────────────────────┐    ┌──────────────────┐
│  Airdrop Scanner  │    │     Safety Layer          │    │  Auto-Execution  │
│  Engine           │    │                           │    │  Engine          │
│                   │    │  ┌──────────────────────┐ │    │                  │
│  ┌─────────────┐  │    │  │  Internal Checker    │ │    │  Jupiter DEX     │
│  │ On-Chain     │  │───▶│  │  - Token conc.      │ │───▶│  Simulation      │
│  │ Scanning     │  │    │  │  - Mint/Freeze auth  │ │    │  AgentShield     │
│  ├─────────────┤  │    │  │  - Account age       │ │    │  Pre-flight      │
│  │ Protocol     │  │    │  ├──────────────────────┤ │    │                  │
│  │ Specific     │  │    │  │  AgentShield         │ │    └──────────────────┘
│  │ JUP/MNDE/   │  │    │  │  (External API)      │ │
│  │ DRIFT/JTO   │  │    │  └──────────────────────┘ │
│  ├─────────────┤  │    │                           │
│  │ Heuristic   │  │    │  Score = 0.6×Internal     │
│  │ Analysis    │  │    │        + 0.4×AgentShield  │
│  └─────────────┘  │    └──────────────────────────┘
└──────────────────┘
          │                              │                              │
          ▼                              ▼                              ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                         Intelligence API (Express.js)                      │
│                                                                            │
│  FREE:                                                                     │
│    GET /                           API info + endpoint listing             │
│    GET /health                     Health check + scanner stats            │
│    GET /skill.json                 Agent skill descriptor                  │
│    GET /api/opportunities          Full opportunity list (no paywall)      │
│    GET /api/scanner/stats          Scanner statistics                      │
│                                                                            │
│  x402 GATED:                                                               │
│    GET /airdrops                   List (free: top 3, paid: all)           │
│    GET /airdrops/:id               Detailed analysis (0.05 USDC)          │
│    GET /airdrops/:id/safety        Safety report (0.10 USDC)              │
│    POST /airdrops/:id/execute      Auto-execute (1.00 USDC)               │
│    GET /executions/:id             Execution status                        │
└────────────────────────────────────────────────────────────────────────────┘
                                         │
                               ┌─────────┴─────────┐
                               │    skill.json      │
                               │  Agent-to-Agent    │
                               │   Interop (x402)   │
                               └───────────────────┘
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design document.

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm

### Run in 30 seconds (zero config)

```bash
# Clone and enter
git clone <repo-url>
cd airdrop-alpha-network

# Setup (installs deps, creates .env, builds)
./scripts/setup.sh

# Run
npm run dev
```

The server starts with demo mode enabled — **no API keys needed**.

### Manual Setup

```bash
npm install
cp .env.example .env    # Edit to add optional API keys
npm run dev             # Development with hot reload
# or
npm run build && npm start  # Production
```

### Test the API

```bash
# API info
curl http://localhost:3402/

# All opportunities (free, no paywall)
curl http://localhost:3402/api/opportunities

# Scanner health + stats
curl http://localhost:3402/health

# Agent skill descriptor
curl http://localhost:3402/skill.json

# Filter by protocol
curl "http://localhost:3402/api/opportunities?protocol=jupiter"

# Filter by minimum safety score
curl "http://localhost:3402/api/opportunities?minSafety=70"
```

---

## How It Works

### 1. Real On-Chain Scanning

AirdropAlpha connects to Solana devnet (or Helius enhanced RPC) and scans:

- **Token Program activity** — Detects new token mints with multi-recipient distributions
- **Protocol signatures** — Monitors known DeFi protocol addresses for distribution transactions
- **Distribution patterns** — Identifies transactions where tokens flow to many recipients (airdrop fingerprint)

### 2. Protocol-Specific Scanners

Dedicated logic for major Solana protocols:

| Protocol | What We Scan | Token |
|----------|-------------|-------|
| **Jupiter** | JUP staking rewards, fee-sharing distributions | JUP |
| **Marinade** | mSOL/MNDE staking reward distributions | MNDE |
| **Drift** | Trading fee rebates, DRIFT distributions | DRIFT |
| **Jito** | MEV rewards, JitoSOL yield | JTO |
| **Tensor** | NFT marketplace loyalty rewards | TNSR |
| **Parcl** | LP provider incentive distributions | — |

### 3. Heuristic Intelligence

After discovery, opportunities are scored by:

- **Known protocol bonus** — Recognized protocols get +20 trust score
- **Recipient count** — More recipients = more likely genuine airdrop
- **Effort vs value analysis** — Trivial effort + high value = scam signal
- **Token concentration** — High concentration in few wallets = rug risk
- **Multi-signal correlation** — Multiple independent signals boost confidence

### 4. Dual-Layer Safety

Every opportunity gets a combined safety score:

```
finalScore = (internalScore × 0.6) + (agentShieldScore × 0.4)
```

**Internal Checker:**
| Check | Red Flag |
|-------|----------|
| Token concentration | Top 10 holders > 80% |
| Mint authority | Still active (can inflate supply) |
| Freeze authority | Still active (can freeze your tokens) |
| Account age | < 24h = danger, < 7d = warning |
| Transaction volume | < 10 tx = low confidence |
| Known scam DB | Direct match = rejected |

**AgentShield (External):**
- Contract code vulnerability scanning
- Address validation against scam databases
- Pre-flight transaction simulation

### 5. Demo Mode

When `DEMO_MODE=true` (default), the system seeds realistic demo data from known protocols (Jupiter, Jito, Marinade, Drift, Tensor) while still running real on-chain scans. Real data overlays demo data as it arrives.

---

## API Documentation

### Free Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | API info with all endpoint listings |
| `GET /health` | Health check + scanner statistics |
| `GET /skill.json` | Agent skill descriptor for interop |
| `GET /api/opportunities` | **Full list** of all opportunities |
| `GET /api/scanner/stats` | Scanner metrics |

### x402 Gated Endpoints

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /airdrops` | Free (top 3) / 0.01 USDC | List with free tier |
| `GET /airdrops/:id` | 0.05 USDC | Detailed analysis |
| `GET /airdrops/:id/safety` | 0.10 USDC | Full safety report |
| `POST /airdrops/:id/execute` | 1.00 USDC | Auto-execute claim |
| `GET /executions/:id` | Free | Execution status |

### Example: GET /api/opportunities

```json
{
  "success": true,
  "data": [
    {
      "id": "abc-123",
      "name": "Jupiter Staking Rewards — Season 2",
      "symbol": "JUP",
      "tokenMint": "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
      "sourceProtocol": "Jupiter",
      "status": "ACTIVE",
      "estimatedValueUsd": 450,
      "confidence": 0.85,
      "safetyScore": 95,
      "riskLevel": "LOW",
      "effort": "EASY",
      "eligibilityCriteria": [
        "Used Jupiter swap at least 5 times",
        "Minimum $500 total swap volume",
        "JUP staking earns 2x allocation"
      ]
    }
  ],
  "total": 7,
  "offset": 0,
  "limit": 50
}
```

### Example: GET /health

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "version": "0.2.0",
    "opportunities": 7,
    "scanner": {
      "totalOpportunities": 7,
      "scanCount": 3,
      "networkAvailable": true,
      "lastError": null,
      "protocols": ["jupiter", "marinade", "drift", "jito", "tensor", "parcl"]
    },
    "executorReady": false,
    "uptime": 42.5
  }
}
```

### x402 Payment Flow

```
Client                              AirdropAlpha
  │                                      │
  │  GET /airdrops/abc123                │
  │ ──────────────────────────────────▶  │
  │                                      │
  │  402 Payment Required                │
  │  { payTo, amount, asset }            │
  │ ◀──────────────────────────────────  │
  │                                      │
  │  (Pay USDC on Solana)                │
  │                                      │
  │  GET /airdrops/abc123                │
  │  X-Payment: <payment-proof>          │
  │ ──────────────────────────────────▶  │
  │                                      │
  │  200 OK { data: ... }               │
  │ ◀──────────────────────────────────  │
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3402 | Server port |
| `NODE_ENV` | No | development | Environment |
| `DEMO_MODE` | No | true | Seed demo data on startup |
| `SOLANA_RPC_URL` | No | devnet | Custom Solana RPC |
| `HELIUS_API_KEY` | No | — | Helius enhanced RPC (recommended) |
| `AGENTSHIELD_API_KEY` | No | — | AgentShield safety validation |
| `X402_PAYMENT_ADDRESS` | No | — | USDC payment address |
| `EXECUTOR_PRIVATE_KEY` | No | — | Auto-execution wallet (simulation if empty) |

---

## For AI Agents

AirdropAlpha is designed for agent-to-agent consumption:

```
GET /skill.json  →  Discover capabilities, endpoints, and pricing
```

### Integration Example

```typescript
// 1. Discover AirdropAlpha
const skill = await fetch('http://airdrop-alpha:3402/skill.json').then(r => r.json());

// 2. Get opportunities (free)
const opps = await fetch('http://airdrop-alpha:3402/api/opportunities').then(r => r.json());

// 3. Get safety report (paid via x402)
const payment = await makeX402Payment(skill.pricing, 0.10);
const safety = await fetch(`http://airdrop-alpha:3402/airdrops/${opps.data[0].id}/safety`, {
  headers: { 'X-Payment': encodePayment(payment) }
}).then(r => r.json());
```

---

## Project Structure

```
airdrop-alpha-network/
├── src/
│   ├── index.ts                  # Entry point (Phase 2 boot)
│   ├── config.ts                 # Environment config + demo mode
│   ├── types/
│   │   └── index.ts              # All TypeScript types
│   ├── scanner/
│   │   └── solana-scanner.ts     # Real on-chain scanning engine
│   │                               ├── Protocol-specific scanners
│   │                               ├── Heuristic scoring engine
│   │                               └── Demo data fallback
│   ├── safety/
│   │   ├── index.ts              # Combined safety module
│   │   ├── internal-checker.ts   # On-chain heuristic analysis
│   │   └── agentshield-client.ts # AgentShield API integration
│   ├── api/
│   │   ├── server.ts             # Express server setup
│   │   ├── routes.ts             # API routes (/api/opportunities, etc.)
│   │   └── x402-middleware.ts    # x402 payment verification
│   ├── executor/
│   │   └── executor.ts           # Auto-execution engine
│   └── skill/
│       └── skill.ts              # skill.json generator
├── scripts/
│   └── setup.sh                  # One-command setup
├── .env.example                  # Environment template
├── ARCHITECTURE.md               # Full design document
└── package.json
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js + TypeScript |
| API | Express.js |
| Blockchain | Solana Devnet via @solana/web3.js |
| Enhanced RPC | Helius (optional) |
| Payments | x402 (USDC on Solana) |
| Safety | Internal heuristics + AgentShield |
| DEX | Jupiter Aggregator (token swaps) |
| Execution | Simulation mode (devnet) |

---

## What's New in Phase 2

| Feature | v0.1.0 | v0.2.0 |
|---------|--------|--------|
| Data source | Demo data only | **Real Solana devnet** |
| Protocol scanning | Generic | **Jupiter, Marinade, Drift, Jito** |
| Token discovery | None | **Token Program + Helius DAS** |
| Heuristic analysis | None | **Multi-signal scoring** |
| Demo mode | Always on | **Configurable (graceful fallback)** |
| Free API | None | **GET /api/opportunities** |
| Scanner stats | None | **GET /api/scanner/stats** |
| Rate limiting | None | **Sequential scanning with delays** |
| Setup | Manual | **One-command setup script** |

---

## License

MIT

---

*Built with 🪂 for the Solana Agent Hackathon by the AirdropAlpha Team*
