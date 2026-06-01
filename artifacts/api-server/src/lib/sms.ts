// Twilio SMS provider. Reads credentials from env, sends via the Twilio
// REST API directly (no SDK needed). Returns { ok, sid?, error? }.
//
// If credentials are missing the function logs a warning and returns
// ok: true with id "no-op" so callers can be wired the same way as
// email.ts and degrade gracefully in dev.

import { logger } from "./logger.js";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

export interface SmsResult {
  ok: boolean;
  sid?: string;
  error?: string;
}

export function isSmsConfigured(): boolean {
  return Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER);
}

/**
 * Normalize a free-form phone number to E.164. If the input already starts
 * with "+", we keep that prefix. Otherwise we assume US (+1) for any 10-digit
 * number. Returns null if we can't form a plausible E.164 string.
 */
export function toE164(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return null;
    return `+${digits}`;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const dest = toE164(to);
  if (!dest) {
    return { ok: false, error: "Invalid phone number" };
  }
  if (!isSmsConfigured()) {
    logger.warn({ to: dest }, "[sms] Twilio not configured — message not sent");
    return { ok: true, sid: "no-op" };
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const params = new URLSearchParams();
    params.set("To", dest);
    params.set("From", TWILIO_FROM_NUMBER!);
    // Hard cap; SMS body limit is 1600 chars and longer messages segment.
    params.set("Body", body.slice(0, 1500));
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      logger.warn({ status: res.status, body: text.slice(0, 500) }, "[sms] Twilio error");
      return { ok: false, error: `Twilio ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { sid?: string };
    return { ok: true, sid: data.sid };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, "[sms] sendSms failed");
    return { ok: false, error: msg };
  }
}
