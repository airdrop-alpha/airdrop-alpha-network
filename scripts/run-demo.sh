#!/bin/bash
# ============================================================
# AirdropAlpha — Agent-to-Agent Demo Runner
# ============================================================
#
# One-command demo: builds, starts server, runs demo, stops server.
#
# Usage:
#   bash scripts/run-demo.sh              # Full build + demo
#   DEMO_MODE=true bash scripts/run-demo.sh  # Explicit demo mode
#   SKIP_BUILD=1 bash scripts/run-demo.sh    # Skip build step
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# ── Environment ──
export DEMO_MODE="${DEMO_MODE:-true}"
export NODE_ENV="${NODE_ENV:-development}"
export PORT="${PORT:-3402}"

# ── Colors ──
DIM='\033[2m'
BOLD='\033[1m'
GREEN='\033[32m'
CYAN='\033[36m'
RED='\033[31m'
RESET='\033[0m'

log() { echo -e "${DIM}[demo]${RESET} $1"; }
err() { echo -e "${RED}[demo] ERROR:${RESET} $1"; }

# ── Step 1: Install dependencies if needed ──
if [ ! -d "node_modules" ]; then
  log "Installing dependencies..."
  npm install --silent
fi

# ── Step 2: Build (unless skipped) ──
if [ "${SKIP_BUILD:-}" != "1" ]; then
  log "Building TypeScript..."
  npx tsc 2>/dev/null || {
    log "TypeScript build had warnings — trying tsx runner instead..."
  }
fi

# ── Step 3: Run demo ──
log "Starting agent-to-agent demo..."
echo ""

# Prefer tsx for direct TS execution (no build needed)
if command -v npx &> /dev/null; then
  npx tsx src/demo/demo-runner.ts
elif [ -f "dist/demo/demo-runner.js" ]; then
  node dist/demo/demo-runner.js
else
  err "Cannot run demo — install tsx or build first"
  exit 1
fi

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo ""
  log "${GREEN}Demo completed successfully.${RESET}"
else
  echo ""
  err "Demo exited with code $EXIT_CODE"
fi

exit $EXIT_CODE
