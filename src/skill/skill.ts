// ============================================================
// Agent Skill Interface — skill.json generation
// ============================================================

import { SkillDescriptor } from '../types';
import { config } from '../config';

/**
 * Generate the skill.json descriptor for agent-to-agent discovery
 */
export function generateSkillDescriptor(): SkillDescriptor {
  const baseUrl = `http://localhost:${config.port}`;

  return {
    name: 'AirdropAlpha',
    description:
      'Solana airdrop intelligence service with real on-chain data discovery, ' +
      'protocol-specific scanning (Jupiter, Marinade, Drift, Jito), ' +
      'dual-layer safety scanning (internal heuristics + AgentShield), ' +
      'and automated claim execution. Monetized via x402 micropayments (USDC on Solana).',
    version: '0.2.0',
    author: 'AirdropAlpha Team',
    endpoints: [
      {
        path: '/airdrops',
        method: 'GET',
        description:
          'List current airdrop opportunities with risk scores. ' +
          'Free tier returns top 3 opportunities. Paid tier returns all.',
        priceUsdc: 0.01,
        parameters: [
          {
            name: 'limit',
            type: 'number',
            required: false,
            description: 'Maximum number of results (default: 20)',
          },
          {
            name: 'offset',
            type: 'number',
            required: false,
            description: 'Pagination offset (default: 0)',
          },
          {
            name: 'minSafety',
            type: 'number',
            required: false,
            description: 'Minimum safety score filter (0-100)',
          },
          {
            name: 'status',
            type: 'string',
            required: false,
            description: 'Filter by status: DISCOVERED, VERIFIED, ACTIVE, CLAIMABLE',
          },
        ],
      },
      {
        path: '/airdrops/:id',
        method: 'GET',
        description:
          'Get detailed analysis of a specific airdrop opportunity, ' +
          'including eligibility criteria, value estimation, and full metadata.',
        priceUsdc: 0.05,
        parameters: [
          {
            name: 'id',
            type: 'string',
            required: true,
            description: 'Airdrop opportunity ID',
          },
        ],
      },
      {
        path: '/airdrops/:id/safety',
        method: 'GET',
        description:
          'Get comprehensive safety report including internal heuristic analysis ' +
          'and AgentShield external validation. Returns detailed flags and risk assessment.',
        priceUsdc: 0.10,
        parameters: [
          {
            name: 'id',
            type: 'string',
            required: true,
            description: 'Airdrop opportunity ID',
          },
        ],
      },
      {
        path: '/airdrops/:id/execute',
        method: 'POST',
        description:
          'Auto-execute an airdrop claim. Builds the claim transaction, ' +
          'runs AgentShield pre-flight check, simulates, then submits. ' +
          'Only available for opportunities with safety score >= 30.',
        priceUsdc: 1.00,
        parameters: [
          {
            name: 'id',
            type: 'string',
            required: true,
            description: 'Airdrop opportunity ID',
          },
        ],
      },
      {
        path: '/health',
        method: 'GET',
        description: 'Health check endpoint. Always free.',
        priceUsdc: 0,
      },
    ],
    pricing: {
      currency: 'USDC',
      network: 'solana',
      paymentProtocol: 'x402',
    },
    capabilities: [
      'airdrop-discovery',
      'real-onchain-data',
      'protocol-specific-scanning',
      'heuristic-analysis',
      'safety-scanning',
      'agentshield-integration',
      'auto-execution',
      'token-swap',
      'risk-scoring',
      'x402-payments',
    ],
  };
}
