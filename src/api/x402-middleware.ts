// ============================================================
// x402 Payment Middleware — USDC micropayments on Solana
// ============================================================
//
// Implements the x402 payment protocol:
// 1. Client requests a paid resource
// 2. Server returns 402 + payment requirements
// 3. Client pays and retries with X-Payment header
// 4. Server verifies payment on-chain and serves response
//
// Reference: https://www.x402.org/

import { Request, Response, NextFunction } from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config';
import { X402PaymentRequired } from '../types';

/** Pricing table: path pattern → price in USDC */
const PRICING: Record<string, number> = {
  'GET:/airdrops':            0.01,
  'GET:/airdrops/:id':        0.05,
  'GET:/airdrops/:id/safety': 0.10,
  'POST:/airdrops/:id/execute': 1.00,
};

/** Free endpoints that never require payment */
const FREE_ENDPOINTS = new Set([
  'GET:/health',
  'GET:/skill.json',
  'GET:/',
]);

/** Parse the X-Payment header */
function parsePaymentHeader(header: string): { version: string; network: string; transaction: string } | null {
  try {
    // x402 header format: base64 encoded JSON
    const decoded = Buffer.from(header, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    return {
      version: parsed.version ?? '1',
      network: parsed.network ?? 'solana',
      transaction: parsed.transaction ?? '',
    };
  } catch {
    // Try plain JSON
    try {
      const parsed = JSON.parse(header);
      return {
        version: parsed.version ?? '1',
        network: parsed.network ?? 'solana',
        transaction: parsed.transaction ?? '',
      };
    } catch {
      return null;
    }
  }
}

/** Match a request path to a pricing key */
function matchPricingKey(method: string, path: string): string | null {
  const normalizedPath = path.replace(/\/+$/, '');

  // Exact matches first
  const exactKey = `${method}:${normalizedPath}`;
  if (PRICING[exactKey] !== undefined) return exactKey;

  // Pattern matches (replace UUIDs and IDs with :id)
  const parameterized = normalizedPath.replace(
    /\/airdrops\/[^/]+/,
    '/airdrops/:id',
  );
  const patternKey = `${method}:${parameterized}`;
  if (PRICING[patternKey] !== undefined) return patternKey;

  return null;
}

/**
 * x402 Payment Middleware
 *
 * For free tier: GET /airdrops returns top 3 without payment
 * For paid access: returns 402 with payment requirements
 * With valid X-Payment header: verifies and proceeds
 */
export function x402PaymentMiddleware() {
  const connection = new Connection(config.solanaRpcUrl, 'confirmed');

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const method = req.method;
    const path = req.path;

    // Check if this is a free endpoint
    const freeKey = `${method}:${path}`;
    if (FREE_ENDPOINTS.has(freeKey)) {
      return next();
    }

    // Find price for this endpoint
    const pricingKey = matchPricingKey(method, path);

    if (!pricingKey) {
      // No pricing defined → free access
      return next();
    }

    const price = PRICING[pricingKey]!;

    // Free tier: GET /airdrops without payment returns limited results
    if (pricingKey === 'GET:/airdrops' && !req.headers['x-payment']) {
      // Mark as free tier — route handler will limit results
      (req as any).x402 = { paid: false, tier: 'free' };
      return next();
    }

    // Check for payment header
    const paymentHeader = req.headers['x-payment'] as string | undefined;

    if (!paymentHeader) {
      // Return 402 Payment Required
      const paymentRequired: X402PaymentRequired = {
        version: '1',
        network: 'solana',
        payTo: config.paymentAddress,
        maxAmountRequired: (price * 1_000_000).toString(), // USDC has 6 decimals
        asset: config.usdcMint,
        resource: `${method} ${path}`,
        description: `Access to ${pricingKey} — ${price} USDC`,
        mimeType: 'application/json',
      };

      res.status(402).json({
        error: 'Payment Required',
        x402: paymentRequired,
        instructions: {
          step1: 'Send USDC payment to the payTo address',
          step2: 'Include payment proof in X-Payment header (base64 JSON with transaction signature)',
          step3: 'Retry your request',
          example: 'X-Payment: eyJ2ZXJzaW9uIjoiMSIsIm5ldHdvcmsiOiJzb2xhbmEiLCJ0cmFuc2FjdGlvbiI6IjxzaWduYXR1cmU+In0=',
        },
      });
      return;
    }

    // Verify payment
    const payment = parsePaymentHeader(paymentHeader);

    if (!payment || !payment.transaction) {
      res.status(400).json({
        error: 'Invalid X-Payment header',
        details: 'Expected base64-encoded JSON with version, network, and transaction fields',
      });
      return;
    }

    // Verify the transaction on-chain
    const isValid = await verifyPayment(connection, payment.transaction, price);

    if (!isValid) {
      res.status(402).json({
        error: 'Payment verification failed',
        details: 'Transaction not found, not confirmed, or incorrect amount',
      });
      return;
    }

    // Payment verified — proceed
    (req as any).x402 = { paid: true, tier: 'premium', transaction: payment.transaction };
    return next();
  };
}

/**
 * Verify a payment transaction on Solana
 * In production, this would check:
 * 1. Transaction exists and is confirmed
 * 2. It transfers the correct USDC amount
 * 3. It transfers to our payment address
 * 4. It hasn't been used before (replay protection)
 */
async function verifyPayment(
  connection: Connection,
  txSignature: string,
  expectedUsdcAmount: number,
): Promise<boolean> {
  try {
    // In development mode, accept any non-empty transaction signature
    if (config.nodeEnv === 'development') {
      console.log(`[x402] Dev mode: accepting payment ${txSignature.slice(0, 16)}...`);
      return txSignature.length > 10;
    }

    // Production verification
    const tx = await connection.getParsedTransaction(txSignature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!tx || !tx.meta) {
      console.warn(`[x402] Transaction not found: ${txSignature}`);
      return false;
    }

    if (tx.meta.err) {
      console.warn(`[x402] Transaction failed: ${JSON.stringify(tx.meta.err)}`);
      return false;
    }

    // Check for USDC transfer to our address
    const postTokenBalances = tx.meta.postTokenBalances ?? [];
    const preTokenBalances = tx.meta.preTokenBalances ?? [];

    const paymentAddress = config.paymentAddress;
    const usdcMint = config.usdcMint;

    // Find USDC balance change for our payment address
    for (const postBalance of postTokenBalances) {
      if (postBalance.mint !== usdcMint) continue;
      if (postBalance.owner !== paymentAddress) continue;

      const preBalance = preTokenBalances.find(
        b => b.accountIndex === postBalance.accountIndex,
      );

      const pre = Number(preBalance?.uiTokenAmount?.uiAmount ?? 0);
      const post = Number(postBalance.uiTokenAmount?.uiAmount ?? 0);
      const received = post - pre;

      if (received >= expectedUsdcAmount) {
        console.log(`[x402] Payment verified: ${received} USDC received`);
        return true;
      }
    }

    console.warn(`[x402] Payment amount not found in transaction`);
    return false;
  } catch (error) {
    console.error(`[x402] Verification error:`, (error as Error).message);
    return false;
  }
}
