// ============================================================
// Agent-to-Agent Demo: Portfolio Agent ↔ AirdropAlpha
// ============================================================
//
// A simulated "Portfolio Agent" that discovers, evaluates, and
// executes airdrop claims via AirdropAlpha's agent skill interface.
//
// This demonstrates the power of agent composability:
// → Any agent can discover AirdropAlpha via skill.json
// → Read its capabilities programmatically
// → Query for opportunities, assess risk, and execute — all via API
//

const BASE_URL = process.env.DEMO_BASE_URL || 'http://localhost:3402';

// ============================================================
// Types for responses
// ============================================================

interface SkillDescriptor {
  name: string;
  description: string;
  version: string;
  author: string;
  endpoints: Array<{
    path: string;
    method: string;
    description: string;
    priceUsdc: number;
  }>;
  capabilities: string[];
  pricing: {
    currency: string;
    network: string;
    paymentProtocol: string;
  };
}

interface Opportunity {
  id: string;
  name: string;
  symbol: string;
  tokenMint: string;
  sourceProtocol: string;
  description: string;
  status: string;
  estimatedValueUsd: number | null;
  confidence: number;
  eligibilityCriteria: string[];
  effort: string;
  safetyScore: number;
  riskLevel: string;
  programId: string | null;
}

interface SafetyReport {
  internalScore: number;
  agentShieldScore: number | null;
  combinedScore: number;
  riskLevel: string;
  flags: Array<{
    category: string;
    severity: string;
    message: string;
  }>;
}

interface ExecutionResult {
  id: string;
  airdropId: string;
  status: string;
  transactionSignature: string | null;
  tokensReceived: number | null;
  estimatedValueUsd: number | null;
}

// ============================================================
// Formatting Utilities
// ============================================================

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  red: '\x1b[31m',
};

function c(color: keyof typeof COLORS, text: string): string {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function timestamp(startMs: number): string {
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  return c('dim', `[${elapsed.padStart(5)}s]`);
}

function header(text: string): void {
  const line = '═'.repeat(58);
  console.log('');
  console.log(c('cyan', line));
  console.log(c('cyan', '  ') + c('bold', text));
  console.log(c('cyan', line));
  console.log('');
}

function subHeader(text: string): void {
  const line = '─'.repeat(50);
  console.log(c('dim', `  ${line}`));
  console.log(c('bold', `  ${text}`));
  console.log(c('dim', `  ${line}`));
}

function step(ts: string, emoji: string, message: string): void {
  console.log(`${ts} ${emoji} ${c('bold', message)}`);
}

function detail(arrow: string, text: string): void {
  console.log(`         ${c('dim', arrow)} ${text}`);
}

function success(text: string): void {
  console.log(`         ${c('green', '✅')} ${c('green', text)}`);
}

function warn(text: string): void {
  console.log(`         ${c('yellow', '⚠️')} ${c('yellow', text)}`);
}

function info(text: string): void {
  console.log(`         ${c('dim', '   ')} ${c('dim', text)}`);
}

// ============================================================
// HTTP Client (simulated agent-to-agent calls)
// ============================================================

async function agentCall<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ data: T; status: number; durationMs: number }> {
  const url = `${BASE_URL}${path}`;
  const start = Date.now();

  const opts: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'PortfolioAgent/1.0 (agent-to-agent)',
    },
  };

  if (body) {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const data = (await res.json()) as T;
  const durationMs = Date.now() - start;

  return { data, status: res.status, durationMs };
}

// ============================================================
// Portfolio Agent — Main Demo Flow
// ============================================================

export async function runPortfolioAgentDemo(): Promise<void> {
  const startTime = Date.now();

  header('🤖 Agent-to-Agent Demo: AirdropAlpha Composability');

  console.log(c('dim', '  Scenario: A Portfolio Management Agent discovers and uses'));
  console.log(c('dim', '  AirdropAlpha to find, evaluate, and claim airdrops for its user.'));
  console.log(c('dim', '  All communication happens via standard HTTP skill interface.'));
  console.log('');

  // ─── Phase 1: Discovery ───────────────────────────────────

  subHeader('Phase 1: Agent Discovery');
  console.log('');

  // Step 1: Discover skill.json
  step(timestamp(startTime), '🔍', 'Portfolio Agent discovers AirdropAlpha...');
  detail('→', `GET ${c('cyan', '/api/skill.json')}`);

  const { data: skill, durationMs: skillMs } = await agentCall<SkillDescriptor>(
    'GET',
    '/api/skill.json',
  );

  success(
    `Found: ${c('bold', skill.name)} v${skill.version}`,
  );
  info(`"${skill.description.slice(0, 80)}..."`);
  info(`${skill.endpoints.length} endpoints · ${skill.capabilities.length} capabilities · ${skillMs}ms`);
  console.log('');

  // Step 2: Read agent info
  step(timestamp(startTime), '📡', 'Querying agent metadata...');
  detail('→', `GET ${c('cyan', '/api/agent/info')}`);

  const { data: agentInfo, durationMs: infoMs } = await agentCall<{
    success: boolean;
    data: {
      name: string;
      version: string;
      capabilities: string[];
      protocols: string[];
      totalOpportunities: number;
      payment: { protocol: string; currency: string; network: string };
    };
  }>('GET', '/api/agent/info');

  const ai = agentInfo.data;
  success(`${ai.name} is online — ${ai.totalOpportunities} opportunities tracked`);
  info(`Protocols: ${ai.protocols.join(', ')}`);
  info(`Payment: ${ai.payment.protocol} (${ai.payment.currency} on ${ai.payment.network}) · ${infoMs}ms`);
  console.log('');

  // Step 3: Check pricing
  step(timestamp(startTime), '💰', 'Checking x402 payment pricing...');
  detail('→', `POST ${c('cyan', '/api/x402/quote')}`);

  const { data: quote, durationMs: quoteMs } = await agentCall<{
    success: boolean;
    data: {
      endpoints: Array<{ endpoint: string; priceUsdc: number; description: string }>;
      freeEndpoints: string[];
    };
  }>('POST', '/api/x402/quote');

  const freeCount = quote.data.freeEndpoints.length;
  const paidCount = quote.data.endpoints.length;
  success(`${freeCount} free endpoints + ${paidCount} paid premium endpoints`);
  for (const ep of quote.data.endpoints) {
    info(`${ep.endpoint}: ${ep.priceUsdc} USDC — ${ep.description}`);
  }
  info(`${quoteMs}ms`);
  console.log('');

  // ─── Phase 2: Opportunity Analysis ────────────────────────

  subHeader('Phase 2: Opportunity Analysis');
  console.log('');

  // Step 4: Query opportunities
  step(timestamp(startTime), '📋', 'Querying available airdrop opportunities...');
  detail('→', `GET ${c('cyan', '/api/opportunities')}`);

  const { data: oppsResponse, durationMs: oppsMs } = await agentCall<{
    success: boolean;
    data: Opportunity[];
    total: number;
  }>('GET', '/api/opportunities');

  const opportunities = oppsResponse.data;
  success(`Found ${c('bold', String(oppsResponse.total))} opportunities`);
  info(`${oppsMs}ms`);
  console.log('');

  // Display all opportunities as a table
  console.log(c('dim', '         ┌─────────────────────────────────────────────────────┐'));
  console.log(
    c('dim', '         │') +
    ' ' + c('bold', 'Name'.padEnd(32)) +
    c('bold', 'Score'.padEnd(8)) +
    c('bold', 'Value'.padEnd(10)) +
    c('dim', '│'),
  );
  console.log(c('dim', '         ├─────────────────────────────────────────────────────┤'));

  for (const opp of opportunities) {
    const scoreColor = opp.safetyScore >= 80 ? 'green' : opp.safetyScore >= 50 ? 'yellow' : 'red';
    const name = opp.name.length > 30 ? opp.name.slice(0, 28) + '..' : opp.name;
    const value = opp.estimatedValueUsd ? `$${opp.estimatedValueUsd}` : 'N/A';
    console.log(
      c('dim', '         │') +
      ' ' + name.padEnd(32) +
      c(scoreColor, String(opp.safetyScore).padStart(3) + '/100') + '  ' +
      value.padEnd(8) +
      c('dim', '│'),
    );
  }
  console.log(c('dim', '         └─────────────────────────────────────────────────────┘'));
  console.log('');

  // Step 5: Filter safe opportunities (score > 70)
  step(timestamp(startTime), '🧠', 'Portfolio Agent filtering: safetyScore > 70...');

  const safeOpps = opportunities.filter(o => o.safetyScore > 70);
  const riskyOpps = opportunities.filter(o => o.safetyScore <= 70);

  success(`${c('green', String(safeOpps.length))} safe opportunities pass threshold`);
  if (riskyOpps.length > 0) {
    warn(`${riskyOpps.length} opportunities rejected (too risky)`);
    for (const r of riskyOpps) {
      info(`❌ ${r.name} — score ${r.safetyScore}/100 (${r.riskLevel})`);
    }
  }
  console.log('');

  // Step 6: Pick the best opportunity
  const bestOpp = safeOpps.sort((a, b) => {
    // Sort by: value descending, then safety descending
    const valueA = a.estimatedValueUsd ?? 0;
    const valueB = b.estimatedValueUsd ?? 0;
    if (valueB !== valueA) return valueB - valueA;
    return b.safetyScore - a.safetyScore;
  })[0];

  if (!bestOpp) {
    console.log(c('red', '  ❌ No safe opportunities found. Demo cannot continue.'));
    return;
  }

  step(timestamp(startTime), '🎯', `Selected best opportunity: ${c('bold', bestOpp.name)}`);
  info(`Protocol: ${bestOpp.sourceProtocol} · Symbol: ${bestOpp.symbol}`);
  info(`Value: $${bestOpp.estimatedValueUsd ?? 'N/A'} · Safety: ${bestOpp.safetyScore}/100 · Status: ${bestOpp.status}`);
  info(`Token: ${bestOpp.tokenMint.slice(0, 16)}...${bestOpp.tokenMint.slice(-6)}`);
  console.log('');

  // Step 7: Get detailed opportunity info
  step(timestamp(startTime), '🔎', 'Fetching detailed opportunity analysis...');
  detail('→', `GET ${c('cyan', `/api/opportunities/${bestOpp.id.slice(0, 8)}...`)}`);

  const { data: detailResp, durationMs: detailMs } = await agentCall<{
    success: boolean;
    data: Opportunity;
  }>('GET', `/api/opportunities/${bestOpp.id}`);

  const det = detailResp.data;
  success(`Full analysis retrieved`);
  info(`Eligibility criteria:`);
  for (const crit of det.eligibilityCriteria.slice(0, 3)) {
    info(`  • ${crit}`);
  }
  if (det.eligibilityCriteria.length > 3) {
    info(`  + ${det.eligibilityCriteria.length - 3} more...`);
  }
  info(`${detailMs}ms`);
  console.log('');

  // ─── Phase 3: Safety Verification ─────────────────────────

  subHeader('Phase 3: Safety Verification');
  console.log('');

  // Step 8: Run safety analysis
  const shortMint = `${bestOpp.tokenMint.slice(0, 12)}...`;
  step(timestamp(startTime), '🛡️', `Running safety analysis on ${c('cyan', shortMint)}`);
  detail('→', `GET ${c('cyan', `/api/safety/${bestOpp.tokenMint.slice(0, 16)}...`)}`);

  const { data: safetyResp, durationMs: safetyMs } = await agentCall<{
    success: boolean;
    data: {
      address: string;
      matchedOpportunity: { id: string; name: string } | null;
      report: SafetyReport;
    };
  }>('GET', `/api/safety/${bestOpp.tokenMint}`);

  const report = safetyResp.data.report;
  const riskEmoji = report.riskLevel === 'LOW' ? '🟢' : report.riskLevel === 'MEDIUM' ? '🟡' : '🔴';
  const scoreLabel = report.combinedScore >= 75 ? 'SAFE' : report.combinedScore >= 45 ? 'CAUTION' : 'DANGER';

  success(`Risk Score: ${c('bold', `${report.combinedScore}/100`)} ${riskEmoji} (${scoreLabel})`);
  info(`Internal:     ${report.internalScore}/100`);
  info(`AgentShield:  ${report.agentShieldScore !== null ? report.agentShieldScore + '/100' : 'N/A (offline)'}`);
  info(`Combined:     ${report.combinedScore}/100 · Risk: ${report.riskLevel}`);

  if (report.flags.length > 0) {
    info(`Flags (${report.flags.length}):`);
    for (const flag of report.flags.slice(0, 4)) {
      const sev = flag.severity === 'danger' ? '🔴' : flag.severity === 'warning' ? '🟡' : '🔵';
      info(`  ${sev} ${flag.message}`);
    }
    if (report.flags.length > 4) {
      info(`  + ${report.flags.length - 4} more flags...`);
    }
  }
  info(`${safetyMs}ms`);
  console.log('');

  // Decision gate
  step(timestamp(startTime), '🧠', 'Portfolio Agent making execution decision...');

  if (report.combinedScore < 50) {
    warn('Safety score below threshold. Aborting execution.');
    info('Portfolio Agent chose NOT to execute — protecting user funds.');
    console.log('');
    header('⚠️  Demo Complete — Agent chose safety over profit');
    return;
  }

  success(`Score ${report.combinedScore}/100 ≥ 50 threshold → ${c('green', 'APPROVED for execution')}`);
  console.log('');

  // ─── Phase 4: Execution ───────────────────────────────────

  subHeader('Phase 4: Airdrop Execution');
  console.log('');

  step(timestamp(startTime), '⚡', `Executing airdrop claim: ${c('bold', bestOpp.name)}`);
  detail('→', `GET ${c('cyan', `/api/execute/${bestOpp.id.slice(0, 8)}...`)}`);
  info('Building transaction → AgentShield pre-flight → Simulate → Submit');
  console.log('');

  const { data: execResp, durationMs: execMs } = await agentCall<{
    success: boolean;
    data: ExecutionResult;
  }>('GET', `/api/execute/${bestOpp.id}`);

  const exec = execResp.data;

  if (exec.status === 'CONFIRMED' || execResp.success) {
    const txShort = exec.transactionSignature
      ? exec.transactionSignature.slice(0, 16) + '...'
      : 'simulated';

    success(`${c('bold', 'Claimed!')} TX: ${c('cyan', txShort)}`);
    if (exec.tokensReceived) {
      info(`Tokens received: ${exec.tokensReceived.toLocaleString()} ${bestOpp.symbol}`);
    }
    if (exec.estimatedValueUsd) {
      info(`Estimated value: $${exec.estimatedValueUsd.toFixed(2)}`);
    }
    info(`Status: ${exec.status} · ${execMs}ms`);
  } else {
    warn(`Execution status: ${exec.status}`);
    if (exec.status === 'FAILED') {
      info(`Note: Expected in demo mode — no real wallet configured`);
    }
    info(`${execMs}ms`);
  }

  console.log('');

  // ─── Summary ──────────────────────────────────────────────

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const apiCalls = 7; // skill + info + quote + opps + detail + safety + execute

  header(`✅ Demo Complete — Full agent-to-agent flow in ${totalTime}s`);

  console.log(c('dim', '  Summary:'));
  console.log(c('dim', `  ─────────────────────────────────────────────────`));
  console.log(`  ${c('bold', 'Agent-to-Agent calls:')}  ${apiCalls} API requests`);
  console.log(`  ${c('bold', 'Discovery:')}             skill.json → agent/info → x402/quote`);
  console.log(`  ${c('bold', 'Analysis:')}              ${oppsResponse.total} opportunities scanned`);
  console.log(`  ${c('bold', 'Filtered:')}              ${safeOpps.length} safe / ${riskyOpps.length} rejected`);
  console.log(`  ${c('bold', 'Safety verified:')}       ${report.combinedScore}/100 (${report.riskLevel})`);
  console.log(`  ${c('bold', 'Executed:')}              ${bestOpp.name}`);
  console.log(`  ${c('bold', 'Total time:')}            ${totalTime}s`);
  console.log('');
  console.log(c('dim', '  This demonstrates how any AI agent can discover, evaluate,'));
  console.log(c('dim', '  and use AirdropAlpha as a composable building block — '));
  console.log(c('dim', '  no SDK needed, just standard HTTP + skill.json.'));
  console.log('');
  console.log(c('cyan', '  Built for Solana Breakpoint Hackathon 2026'));
  console.log(c('cyan', '  Agent Protocol: skill.json · Payment: x402 (USDC)'));
  console.log('');
}

// ============================================================
// Direct execution
// ============================================================

if (require.main === module) {
  runPortfolioAgentDemo().catch((err) => {
    console.error('Demo failed:', err);
    process.exit(1);
  });
}
