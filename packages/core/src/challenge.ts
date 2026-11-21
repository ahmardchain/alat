import { createHash } from "node:crypto";
import { randomToken, type Hex32 } from "./ids.ts";
import type { OpenChallenge } from "./verify.ts";

export const CHECK_TTL_MS = 15 * 60_000;
export const LINK_TTL_MS = 10 * 60_000;

export interface Challenge extends OpenChallenge {
  id: string;
  /** SHA-256 of the pasted request text, or null when none was given. */
  requestHash: string | null;
  answerTx?: string;
  answeredAtMs?: number;
}

export function hashRequestText(text: string): string {
  return createHash("sha256").update(text.normalize("NFC").trim()).digest("hex");
}

export function createChallenge(account: Hex32, nowMs: number, requestText?: string, ttlMs = CHECK_TTL_MS): Challenge {
  return {
    id: randomToken(12),
    nonce: randomToken(20),
    account,
    requestHash: requestText ? hashRequestText(requestText) : null,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + ttlMs,
    status: "pending",
  };
}

/** The state a reader should see now. A pending check past its expiry is ❌. */
export function effectiveStatus(c: Pick<Challenge, "status" | "expiresAtMs">, nowMs: number): Challenge["status"] {
  if (c.status === "pending" && nowMs > c.expiresAtMs) return "expired";
  return c.status;
}
