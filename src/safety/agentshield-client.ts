// ============================================================
// AgentShield Client — External security validation
// ============================================================
//
// AgentShield API (https://agentshield.lobsec.org/api):
//   POST /api/scan         — Scan code or plugins for malicious patterns
//   GET  /api/check/:addr  — Check address against scam databases
//   POST /api/validate-tx  — Validate a transaction before execution
//   POST /api/score        — Score an AI agent's security posture
//   GET  /api/threats      — Recent threat intelligence
//

import {
  AgentShieldScanResponse,
  AgentShieldAddressResponse,
  AgentShieldTransactionCheck,
  SafetyFlag,
  SafetyCategory,
} from '../types';
import { config } from '../config';

const DEFAULT_TIMEOUT = 15_000;

export class AgentShieldClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = config.agentShieldUrl.replace(/\/$/, '');
    this.apiKey = config.agentShieldApiKey;
  }

  /**
   * Scan code/URL for malicious patterns
   * POST /api/scan — { "url": "..." } or { "code": "..." }
   */
  async scanProgram(programIdOrUrl: string): Promise<AgentShieldScanResponse> {
    try {
      // AgentShield scan endpoint expects a URL or code snippet
      const body = programIdOrUrl.startsWith('http')
        ? { url: programIdOrUrl }
        : { code: `// Solana program: ${programIdOrUrl}`, context: 'solana-program' };

      const response = await this.post('/api/scan', body);
      return this.parseScanResponse(response);
    } catch (error) {
      console.error('[AgentShield] Scan error:', (error as Error).message);
      return this.fallbackScanResponse('scan_failed');
    }
  }

  /**
   * Check a Solana address against scam databases
   * GET /api/check/:address
   */
  async validateAddress(address: string): Promise<AgentShieldAddressResponse> {
    try {
      const response = await this.get(`/api/check/${address}`);
      return this.parseAddressResponse(response, address);
    } catch (error) {
      console.error('[AgentShield] Address check error:', (error as Error).message);
      return {
        address,
        isMalicious: false,
        riskScore: 50,
        labels: ['check_unavailable'],
        firstSeen: null,
        lastSeen: null,
      };
    }
  }

  /**
   * Pre-flight check on a transaction before submission
   * POST /api/validate-tx — { destination, amount, token, context }
   */
  async checkTransaction(
    destination: string,
    amount: number = 0,
    token: string = 'SOL',
    context: string = 'airdrop-claim',
  ): Promise<AgentShieldTransactionCheck> {
    try {
      const response = await this.post('/api/validate-tx', {
        destination,
        amount,
        token,
        context,
      });
      return this.parseTransactionResponse(response, destination);
    } catch (error) {
      console.error('[AgentShield] Transaction check error:', (error as Error).message);
      return {
        transaction: destination,
        simulationResult: 'warning',
        estimatedChanges: [],
        flags: ['pre_flight_check_unavailable'],
      };
    }
  }

  /**
   * Get recent threat intelligence
   * GET /api/threats?since=<ISO>&limit=<n>
   */
  async getThreats(limit: number = 10): Promise<Array<{ type: string; description: string; severity: string }>> {
    try {
      const response = await this.get(`/api/threats?limit=${limit}`);
      const data = response as Record<string, unknown>;
      return Array.isArray(data.threats) ? data.threats : [];
    } catch (error) {
      console.warn('[AgentShield] Threats fetch error:', (error as Error).message);
      return [];
    }
  }

  /**
   * Convert AgentShield results to our unified safety flags
   */
  convertToFlags(
    scanResult: AgentShieldScanResponse | null,
    addressResult: AgentShieldAddressResponse | null,
  ): { score: number; flags: SafetyFlag[] } {
    const flags: SafetyFlag[] = [];
    let score = 100;

    // Process scan results
    if (scanResult) {
      if (scanResult.status === 'danger') {
        score -= 40;
      } else if (scanResult.status === 'warning') {
        score -= 20;
      }

      for (const threat of scanResult.threats) {
        const severity = threat.severity === 'critical' || threat.severity === 'high'
          ? 'danger' as const
          : threat.severity === 'medium'
            ? 'warning' as const
            : 'info' as const;

        const deduction = severity === 'danger' ? 15 : severity === 'warning' ? 8 : 2;
        score -= deduction;

        flags.push({
          category: SafetyCategory.AGENTSHIELD_FLAG,
          severity,
          message: `[AgentShield] ${threat.type}: ${threat.description}`,
          details: `Severity: ${threat.severity}`,
        });
      }
    }

    // Process address results
    if (addressResult) {
      if (addressResult.isMalicious) {
        score -= 50;
        flags.push({
          category: SafetyCategory.AGENTSHIELD_FLAG,
          severity: 'danger',
          message: '[AgentShield] Address flagged as malicious',
          details: `Labels: ${addressResult.labels.join(', ')}`,
        });
      }

      if (addressResult.riskScore > 70) {
        score -= 20;
        flags.push({
          category: SafetyCategory.AGENTSHIELD_FLAG,
          severity: 'warning',
          message: `[AgentShield] High risk score: ${addressResult.riskScore}/100`,
          details: `Labels: ${addressResult.labels.join(', ')}`,
        });
      }
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      flags,
    };
  }

  // ---- HTTP helpers ----

  private async get(path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'User-Agent': 'AirdropAlpha/0.1.0',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
      headers['X-API-Key'] = this.apiKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (!response.ok) {
        const text = await response.text().catch(() => 'no body');
        throw new Error(`AgentShield API ${response.status}: ${text.slice(0, 200)}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'AirdropAlpha/0.1.0',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
      headers['X-API-Key'] = this.apiKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => 'no body');
        throw new Error(`AgentShield API ${response.status}: ${text.slice(0, 200)}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---- Response parsers ----

  private parseScanResponse(raw: unknown): AgentShieldScanResponse {
    const data = raw as Record<string, unknown>;

    // AgentShield returns: { safe: boolean, riskScore: 0-100, detections: [...], summary: "..." }
    const safe = Boolean(data.safe);
    const riskScore = typeof data.riskScore === 'number' ? data.riskScore : 50;

    const status = safe ? 'safe' : riskScore > 70 ? 'danger' : riskScore > 40 ? 'warning' : 'safe';

    const detections = Array.isArray(data.detections) ? data.detections : [];
    const threats = detections.map((d: Record<string, unknown>) => ({
      type: String(d.type ?? d.pattern ?? 'unknown'),
      severity: (['low', 'medium', 'high', 'critical'].includes(String(d.severity))
        ? String(d.severity)
        : 'medium') as 'low' | 'medium' | 'high' | 'critical',
      description: String(d.description ?? d.message ?? data.summary ?? ''),
    }));

    return {
      status,
      score: 100 - riskScore, // Convert risk score to safety score
      threats,
      metadata: { summary: data.summary, raw: data },
    };
  }

  private parseAddressResponse(raw: unknown, address: string): AgentShieldAddressResponse {
    const data = raw as Record<string, unknown>;

    // AgentShield returns: { address, safe: boolean, riskScore: 0-100, flags: [...] }
    return {
      address,
      isMalicious: !Boolean(data.safe),
      riskScore: typeof data.riskScore === 'number' ? data.riskScore : 50,
      labels: Array.isArray(data.flags) ? data.flags.map(String) : [],
      firstSeen: typeof data.firstSeen === 'string' ? data.firstSeen : null,
      lastSeen: typeof data.lastSeen === 'string' ? data.lastSeen : null,
    };
  }

  private parseTransactionResponse(raw: unknown, destination: string): AgentShieldTransactionCheck {
    const data = raw as Record<string, unknown>;

    // AgentShield returns: { safe: boolean, riskScore: 0-100, recommendation: "proceed|review|block" }
    const safe = Boolean(data.safe);
    const recommendation = String(data.recommendation ?? 'review');

    const simulationResult = safe ? 'safe'
      : recommendation === 'block' ? 'danger'
        : 'warning';

    return {
      transaction: destination,
      simulationResult: simulationResult as 'safe' | 'warning' | 'danger',
      estimatedChanges: [],
      flags: Array.isArray(data.flags) ? data.flags.map(String) : [],
    };
  }

  private fallbackScanResponse(reason: string): AgentShieldScanResponse {
    return {
      status: 'unknown',
      score: 50,
      threats: [],
      metadata: { fallback: true, reason },
    };
  }
}
