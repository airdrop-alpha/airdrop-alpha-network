# 🪂 AirdropAlpha — Solana Airdrop Intelligence Network

> AI-powered airdrop discovery, safety scanning, and auto-execution on Solana — monetized via x402 micropayments.

**Built for the [Solana Agent Hackathon](https://www.colosseum.org/) (Colosseum)**

---

## What is AirdropAlpha?

AirdropAlpha is an airdrop intelligence service for the Solana ecosystem. It continuously scans on-chain data to discover airdrop opportunities, runs dual-layer security analysis, and can auto-execute claims — all accessible through an x402-gated API that other AI agents can discover and use.

### Key Features

- **🔍 Airdrop Discovery** — Monitors Solana on-chain activity, known protocols (Jupiter, Tensor, Marinade, etc.), and token mints to find airdrop opportunities
- **🛡️ Dual-Layer Safety** — Internal heuristic analysis (token concentration, mint/freeze authority, account age) + external validation via [AgentShield](https://agentshield.lobsec.org)
- **⚡ Auto-Execution** — Claim airdrops automatically with pre-flight safety checks via AgentShield
- **💰 x402 Micropayments** — Pay-per-request API using USDC on Solana ([x402 protocol](https://www.x402.org/))
- **🤖 Agent-to-Agent** — Discoverable `skill.json` endpoint for AI agent interoperability

---

## Architecture

```
┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   Airdrop     │    │   Safety Layer    │    │  Auto-Execution  │
│   Scanner     │───▶│  Internal + AS    │───▶│  Engine          │
│   Engine      │    │                   │    │  Jupiter/Raydium │
└──────────────┘    └──────────────────┘    └──────────────────┘
       │                     │                       │
       ▼                     ▼                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Intelligence API (x402)                   │
│                   GET /airdrops · /safety · /execute         │
└─────────────────────────────────────────────────────────────┘
                             │
                    ┌────────┴────────┐
                    │  skill.json     │
                    │  Agent Interop  │
                    └─────────────────┘
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design document.

---

## API Documentation

### Endpoints

| Endpoint | Method | Price | Description |
|----------|--------|-------|-------------|
| `/` | GET | Free | API info |
| `/health` | GET | Free | Health check |
| `/skill.json` | GET | Free | Agent skill descriptor |
| `/airdrops` | GET | Free (top 3) / 0.01 USDC (all) | List airdrop opportunities |
| `/airdrops/:id` | GET | 0.05 USDC | Detailed analysis |
| `/airdrops/:id/safety` | GET | 0.10 USDC | Full safety report |
| `/airdrops/:id/execute` | POST | 1.00 USDC | Auto-execute claim |
| `/executions/:id` | GET | Free | Execution status |

### Free Tier

`GET /airdrops` without payment returns the top 3 opportunities with limited details — a preview to demonstrate value before purchase.

### x402 Payment Flow

1. **Request** a paid resource:
   ```bash
   curl http://localhost:3402/airdrops/abc123
   ```

2. **Receive** 402 Payment Required with payment details:
   ```json
   {
     "error": "Payment Required",
     "x402": {
       "version": "1",
       "network": "solana",
       "payTo": "<USDC_ADDRESS>",
       "maxAmountRequired": "50000",
       "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
     }
   }
   ```

3. **Pay** via Solana USDC transfer to the `payTo` address

4. **Retry** with payment proof:
   ```bash
   curl -H "X-Payment: eyJ2ZXJzaW9uIjoiMSIsIm5ldHdvcmsiOiJzb2xhbmEiLCJ0cmFuc2FjdGlvbiI6IjxTSUdOQVRVUkU+In0=" \
     http://localhost:3402/airdrops/abc123
   ```

### Example Responses

**GET /airdrops (free tier):**
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "name": "Jupiter Airdrop Round 2",
      "symbol": "JUP",
      "status": "ACTIVE",
      "estimatedValueUsd": 450,
      "safetyScore": 95,
      "riskLevel": "LOW",
      "effort": "EASY"
    }
  ],
  "total": 5,
  "notice": {
    "message": "Showing 3 of 5 opportunities. Pay 0.01 USDC via x402 for full access."
  }
}
```

**GET /airdrops/:id/safety:**
```json
{
  "success": true,
  "data": {
    "airdropName": "Jupiter Airdrop Round 2",
    "report": {
      "internalScore": 92,
      "agentShieldScore": 88,
      "combinedScore": 90,
      "riskLevel": "LOW",
      "flags": [
        {
          "category": "TOKEN_CONCENTRATION",
          "severity": "info",
          "message": "Top 10 holders control 35.2% of supply"
        }
      ]
    }
  }
}
```

---

## Safety Features

### Layer 1: Internal Heuristic Analysis

| Check | What We Look For | Risk Signal |
|-------|-----------------|-------------|
| Token Concentration | Top 10 holders' % of supply | > 80% = 🔴 High risk |
| Mint Authority | Can more tokens be created? | Active = ⚠️ Medium risk |
| Freeze Authority | Can tokens be frozen? | Active = 🔴 High risk |
| Account Age | When was the token created? | < 24h = 🔴, < 7d = ⚠️ |
| Transaction Volume | How active is the token? | < 10 tx = ⚠️ Low confidence |
| Known Scam DB | Is this a known scam? | Match = 🚨 Rejected |

### Layer 2: AgentShield External Validation

Integration with [AgentShield](https://agentshield.lobsec.org) provides:
- **Contract scanning** — Analyze program code for vulnerabilities
- **Address validation** — Check if addresses are flagged as malicious
- **Transaction pre-flight** — Simulate transactions before execution to detect traps

### Combined Score

```
finalScore = (internalScore × 0.6) + (agentShieldScore × 0.4)
```

| Score | Risk Level | Action |
|-------|-----------|--------|
| 75–100 | 🟢 LOW | Safe to proceed |
| 45–74 | 🟡 MEDIUM | Proceed with caution |
| 20–44 | 🔴 HIGH | Not recommended |
| 0–19 | 🚨 CRITICAL | Execution blocked |

---

## Quick Start

### Prerequisites

- Node.js 18+
- A Solana devnet RPC endpoint (free from [Helius](https://dashboard.helius.dev/agents))

### Setup

```bash
# Clone the repo
git clone <repo-url>
cd airdrop-alpha-network

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Run in development mode (with demo data)
npm run dev

# Or build and run
npm run build
npm start
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HELIUS_API_KEY` | Recommended | Helius RPC API key for enhanced Solana data |
| `SOLANA_RPC_URL` | No | Custom Solana RPC (defaults to devnet) |
| `AGENTSHIELD_API_URL` | No | AgentShield endpoint (defaults to production) |
| `AGENTSHIELD_API_KEY` | Recommended | AgentShield API key |
| `X402_PAYMENT_ADDRESS` | For payments | Solana address to receive USDC payments |
| `PORT` | No | Server port (default: 3402) |
| `EXECUTOR_PRIVATE_KEY` | For execution | Devnet wallet for auto-execution |

---

## For AI Agents

AirdropAlpha is designed to be consumed by other AI agents. Discover our capabilities via:

```
GET /skill.json
```

This returns a standard skill descriptor with all endpoints, pricing, parameters, and capabilities — enabling agent-to-agent communication via the x402 payment protocol.

### Integration Example

```typescript
// Another agent discovering and using AirdropAlpha
const skill = await fetch('http://airdrop-alpha:3402/skill.json').then(r => r.json());

// Check available airdrops (free tier)
const airdrops = await fetch('http://airdrop-alpha:3402/airdrops').then(r => r.json());

// Get detailed safety report (paid via x402)
const payment = await makeX402Payment(skill.pricing, 0.10);
const safety = await fetch('http://airdrop-alpha:3402/airdrops/abc/safety', {
  headers: { 'X-Payment': encodePayment(payment) }
}).then(r => r.json());
```

---

## Project Structure

```
src/
├── index.ts                  # Entry point — boots all components
├── config.ts                 # Environment config loader
├── types/
│   └── index.ts              # All TypeScript type definitions
├── scanner/
│   └── solana-scanner.ts     # On-chain airdrop discovery engine
├── safety/
│   ├── index.ts              # Combined safety module
│   ├── internal-checker.ts   # Internal heuristic analysis
│   └── agentshield-client.ts # AgentShield API integration
├── api/
│   ├── server.ts             # Express server setup
│   ├── routes.ts             # API route handlers
│   └── x402-middleware.ts    # x402 payment verification
├── executor/
│   └── executor.ts           # Auto-execution engine
└── skill/
    └── skill.ts              # skill.json generator
```

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js + TypeScript |
| API | Express.js |
| Blockchain | Solana (devnet) via @solana/web3.js |
| RPC | Helius |
| Payments | x402 (USDC on Solana) |
| Safety | Internal heuristics + AgentShield |
| DEX | Jupiter Aggregator (for token swaps) |

---

## License

MIT

---

*Built with 🪂 for the Solana Agent Hackathon by the AirdropAlpha Team*
