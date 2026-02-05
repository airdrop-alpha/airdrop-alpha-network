import { AppConfig } from './types';

function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
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
  };
}

export const config = loadConfig();
