// ============================================================
// Demo Runner — Orchestrates the Agent-to-Agent demo
// ============================================================
//
// 1. Starts AirdropAlpha server in background
// 2. Waits for it to be ready
// 3. Runs the Portfolio Agent demo
// 4. Shuts down cleanly
//

import { ChildProcess, fork } from 'child_process';
import path from 'path';

const PORT = process.env.PORT || '3402';
const BASE_URL = `http://localhost:${PORT}`;
const MAX_WAIT_MS = 15_000;
const POLL_INTERVAL_MS = 500;

// ============================================================
// Utilities
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  const healthUrl = `${url}/health`;

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // Not ready yet
    }
    await sleep(POLL_INTERVAL_MS);
  }

  return false;
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  let serverProcess: ChildProcess | null = null;

  // Clean shutdown handler
  const cleanup = () => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      serverProcess = null;
    }
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);

  try {
    // ── Step 1: Check if server is already running ──
    console.log('\x1b[2m[runner] Checking for existing server...\x1b[0m');
    let serverAlreadyRunning = false;

    try {
      const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        console.log('\x1b[2m[runner] Server already running — skipping start.\x1b[0m');
        serverAlreadyRunning = true;
      }
    } catch {
      // Not running — we'll start it
    }

    // ── Step 2: Start server if needed ──
    if (!serverAlreadyRunning) {
      console.log('\x1b[2m[runner] Starting AirdropAlpha server...\x1b[0m');

      // Determine the entry point
      const isCompiled = __filename.endsWith('.js');
      const entryPoint = isCompiled
        ? path.resolve(__dirname, '..', 'index.js')
        : path.resolve(__dirname, '..', 'index.ts');

      const execArgv = isCompiled ? [] : ['--require', 'tsx/cjs'];

      serverProcess = fork(entryPoint, [], {
        env: {
          ...process.env,
          PORT,
          DEMO_MODE: 'true',
          NODE_ENV: 'development',
        },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        execArgv,
      });

      // Suppress server output during demo (capture but don't display)
      serverProcess.stdout?.on('data', () => {});
      serverProcess.stderr?.on('data', (chunk: Buffer) => {
        const msg = chunk.toString();
        // Only show critical errors
        if (msg.includes('Fatal') || msg.includes('EADDRINUSE')) {
          console.error('\x1b[31m[server] ' + msg.trim() + '\x1b[0m');
        }
      });

      serverProcess.on('error', (err) => {
        console.error(`\x1b[31m[runner] Server process error: ${err.message}\x1b[0m`);
      });

      serverProcess.on('exit', (code) => {
        if (code && code !== 0) {
          console.error(`\x1b[31m[runner] Server exited with code ${code}\x1b[0m`);
        }
        serverProcess = null;
      });

      // ── Step 3: Wait for server to be ready ──
      console.log('\x1b[2m[runner] Waiting for server to be ready...\x1b[0m');
      const ready = await waitForServer(BASE_URL, MAX_WAIT_MS);

      if (!ready) {
        console.error('\x1b[31m[runner] Server failed to start within timeout.\x1b[0m');
        cleanup();
        process.exit(1);
      }

      console.log('\x1b[2m[runner] Server is ready.\x1b[0m');
    }

    // Small delay to let demo data settle
    await sleep(500);

    // ── Step 4: Run the demo ──
    console.log('\x1b[2m[runner] Launching Portfolio Agent demo...\x1b[0m');
    console.log('');

    // Dynamic import to handle both compiled and tsx modes
    const { runPortfolioAgentDemo } = require('./agent-demo');
    await runPortfolioAgentDemo();

    // ── Step 5: Clean up ──
    if (serverProcess) {
      console.log('\x1b[2m[runner] Shutting down server...\x1b[0m');
      cleanup();
      await sleep(500);
    }

    console.log('\x1b[2m[runner] Done.\x1b[0m');
    process.exit(0);

  } catch (error) {
    console.error('\x1b[31m[runner] Demo failed:\x1b[0m', (error as Error).message);
    cleanup();
    process.exit(1);
  }
}

main();
