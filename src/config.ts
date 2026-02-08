import { AppConfig } from './types';

function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function envBool(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

export function loadConfig(): AppConfig {
  return {
    port: parseInt(env('PORT', '3402'), 10),
    solanaRpcUrl: env('SOLANA_RPC_URL', 'https://api.devnet.solana.com'),
    heliusApiKey: env('HELIUS_API_KEY', ''),
    agentShieldUrl: env('AGENTSHIELD_API_URL', 'https://agentshield.lobsec.org'),
    agentShieldApiKey: env('AGENTSHIELD_API_KEY', ''),
    paymentAddress: env('X402_PAYMENT_ADDRESS', ''),
    usdcMint: env('USDC_MINT', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    executorPrivateKey: process.env.EXECUTOR_PRIVATE_KEY ?? null,
    nodeEnv: env('NODE_ENV', 'development'),
    demoMode: envBool('DEMO_MODE', true),
  };
}

export const config = loadConfig();
