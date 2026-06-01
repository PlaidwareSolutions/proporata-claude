import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { stripeConfigTable } from "@workspace/db/schema";
import { logger } from "./logger.js";

interface StripeConfig {
  secretKey: string | null;
  publishableKey: string | null;
  webhookSecret: string | null;
}

let _config: StripeConfig = {
  secretKey: process.env["STRIPE_SECRET_KEY"] ?? null,
  publishableKey: process.env["STRIPE_PUBLISHABLE_KEY"] ?? null,
  webhookSecret: process.env["STRIPE_WEBHOOK_SECRET"] ?? null,
};
let _stripe: Stripe | null = null;
let _stripeKeyCached: string | null = null;
let _loaded = false;

function envFallback(key: keyof StripeConfig): string | null {
  switch (key) {
    case "secretKey":
      return process.env["STRIPE_SECRET_KEY"] ?? null;
    case "publishableKey":
      return process.env["STRIPE_PUBLISHABLE_KEY"] ?? null;
    case "webhookSecret":
      return process.env["STRIPE_WEBHOOK_SECRET"] ?? null;
  }
}

/**
 * Load the active Stripe configuration from the database. DB values take
 * precedence over environment variables. Safe to call repeatedly; callers
 * should invoke this when applying a change request so the in-memory cache
 * picks up the new values without restarting the server.
 */
export async function refreshStripeConfig(): Promise<void> {
  try {
    const [row] = await db
      .select()
      .from(stripeConfigTable)
      .where(eq(stripeConfigTable.id, 1));
    _config = {
      secretKey: row?.secretKey ?? envFallback("secretKey"),
      publishableKey: row?.publishableKey ?? envFallback("publishableKey"),
      webhookSecret: row?.webhookSecret ?? envFallback("webhookSecret"),
    };
    _loaded = true;
  } catch (err) {
    logger.warn({ err }, "Failed to load stripe_config from DB; falling back to env");
    _config = {
      secretKey: envFallback("secretKey"),
      publishableKey: envFallback("publishableKey"),
      webhookSecret: envFallback("webhookSecret"),
    };
  }
}

export function isStripeConfigLoaded(): boolean {
  return _loaded;
}

export function getStripe(): Stripe | null {
  const key = _config.secretKey;
  if (!key) {
    _stripe = null;
    _stripeKeyCached = null;
    return null;
  }
  if (_stripe && _stripeKeyCached === key) return _stripe;
  _stripe = new Stripe(key);
  _stripeKeyCached = key;
  return _stripe;
}

export function getStripeOrThrow(): Stripe {
  const s = getStripe();
  if (!s) {
    const err: Error & { status?: number } = new Error(
      "Stripe is not configured. A board member must propose Stripe keys in Settings → Online Payments and have all board members approve.",
    );
    err.status = 503;
    throw err;
  }
  return s;
}

export function getPublishableKey(): string | null {
  return _config.publishableKey;
}

export function getWebhookSecret(): string | null {
  return _config.webhookSecret;
}

export function isStripeConfigured(): boolean {
  return !!_config.secretKey;
}

export function logStripeWarning(): void {
  if (!isStripeConfigured()) {
    logger.warn(
      "Stripe is not configured. Online payments are disabled. A board member must propose keys in Settings → Online Payments.",
    );
  }
}
