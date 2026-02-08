#!/usr/bin/env bash
# ============================================================
# AirdropAlpha — Setup Script
# ============================================================
set -euo pipefail

echo ""
echo "  🪂 AirdropAlpha Setup"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "❌ Node.js is required. Install from https://nodejs.org (v18+)"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ required. Current: $(node -v)"
  exit 1
fi
echo "✅ Node.js $(node -v)"

# Check npm
if ! command -v npm &>/dev/null; then
  echo "❌ npm is required."
  exit 1
fi
echo "✅ npm $(npm -v)"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Create .env if it doesn't exist
if [ ! -f .env ]; then
  echo ""
  echo "📝 Creating .env from .env.example..."
  cp .env.example .env
  echo "   Edit .env to add your API keys (optional)."
else
  echo "✅ .env already exists"
fi

# Build
echo ""
echo "🔨 Building TypeScript..."
npm run build

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Setup complete!"
echo ""
echo "Run the server:"
echo "  npm run dev      # Development (with hot reload)"
echo "  npm start        # Production (from build)"
echo ""
echo "API endpoints:"
echo "  http://localhost:3402                  # API info"
echo "  http://localhost:3402/health           # Health check"
echo "  http://localhost:3402/skill.json       # Agent skill descriptor"
echo "  http://localhost:3402/api/opportunities # All opportunities (free)"
echo "  http://localhost:3402/airdrops         # x402-gated list"
echo ""
echo "Optional: Set HELIUS_API_KEY in .env for enhanced scanning."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
