#!/bin/bash
# AirdropAlpha Production Startup Script
# Starts the Node.js server and Cloudflare tunnel with auto-restart

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🪂 AirdropAlpha Production Launcher${NC}"
echo "Project: $PROJECT_DIR"
echo ""

# Kill any existing processes
echo "[Cleanup] Stopping existing processes..."
pkill -f "node $PROJECT_DIR/dist/index.js" 2>/dev/null || true
pkill -f "cloudflared tunnel --url http://localhost:3000" 2>/dev/null || true
sleep 2

# Build if needed
if [ ! -f "$PROJECT_DIR/dist/index.js" ]; then
    echo "[Build] Compiling TypeScript..."
    cd "$PROJECT_DIR" && npm run build
fi

# Start Node.js server
echo "[Server] Starting AirdropAlpha server..."
cd "$PROJECT_DIR"
DEMO_MODE=true PORT=3000 NODE_ENV=production nohup node dist/index.js > "$LOG_DIR/server.log" 2>&1 &
SERVER_PID=$!
echo "[Server] PID: $SERVER_PID"

# Wait for server to be ready
echo "[Server] Waiting for server to be ready..."
for i in $(seq 1 30); do
    if curl -s http://localhost:3000/ > /dev/null 2>&1; then
        echo -e "[Server] ${GREEN}✅ Server is ready${NC}"
        break
    fi
    sleep 1
done

# Start Cloudflare tunnel
echo "[Tunnel] Starting Cloudflare tunnel..."
nohup cloudflared tunnel --url http://localhost:3000 > "$LOG_DIR/tunnel.log" 2>&1 &
TUNNEL_PID=$!
echo "[Tunnel] PID: $TUNNEL_PID"

# Wait for tunnel URL
echo "[Tunnel] Waiting for tunnel URL..."
TUNNEL_URL=""
for i in $(seq 1 30); do
    TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG_DIR/tunnel.log" 2>/dev/null | head -1)
    if [ -n "$TUNNEL_URL" ]; then
        break
    fi
    sleep 1
done

if [ -n "$TUNNEL_URL" ]; then
    echo ""
    echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  🪂 AirdropAlpha is LIVE!${NC}"
    echo -e "${GREEN}  Local:  http://localhost:3000${NC}"
    echo -e "${GREEN}  Public: $TUNNEL_URL${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
    echo ""
    echo "$TUNNEL_URL" > "$LOG_DIR/tunnel-url.txt"
    echo "Server PID: $SERVER_PID" > "$LOG_DIR/pids.txt"
    echo "Tunnel PID: $TUNNEL_PID" >> "$LOG_DIR/pids.txt"
else
    echo -e "${YELLOW}⚠️  Could not detect tunnel URL. Check $LOG_DIR/tunnel.log${NC}"
fi

# Monitor loop (optional, run with --monitor flag)
if [ "$1" = "--monitor" ]; then
    echo "[Monitor] Watching processes..."
    while true; do
        if ! kill -0 $SERVER_PID 2>/dev/null; then
            echo "[Monitor] Server died! Restarting..."
            cd "$PROJECT_DIR"
            DEMO_MODE=true PORT=3000 NODE_ENV=production nohup node dist/index.js > "$LOG_DIR/server.log" 2>&1 &
            SERVER_PID=$!
            echo "[Monitor] New server PID: $SERVER_PID"
        fi
        if ! kill -0 $TUNNEL_PID 2>/dev/null; then
            echo "[Monitor] Tunnel died! Restarting..."
            nohup cloudflared tunnel --url http://localhost:3000 > "$LOG_DIR/tunnel.log" 2>&1 &
            TUNNEL_PID=$!
            echo "[Monitor] New tunnel PID: $TUNNEL_PID"
            sleep 10
            NEW_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG_DIR/tunnel.log" 2>/dev/null | head -1)
            if [ -n "$NEW_URL" ]; then
                echo "[Monitor] New tunnel URL: $NEW_URL"
                echo "$NEW_URL" > "$LOG_DIR/tunnel-url.txt"
            fi
        fi
        sleep 30
    done
fi
