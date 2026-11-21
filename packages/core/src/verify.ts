/**
 * The checks every owner transaction must pass before Alat believes it.
 *
 * Inputs come from the chain (ObservedTx, read by observe.ts) and from Alat's
 * own records (the challenge, the link token, the owner read from the registry
 * contract). Nothing here is taken from the browser that submitted the hash.
 */
import { parseMemo, type Answer } from "./memo.ts";
import type { Hex32 } from "./ids.ts";

/** What the chain says about one transaction. */
export interface ObservedTx {
  hash: string;
  /** 0 = included and succeeded. */
  code: number;
  /** Block time, ms since epoch. */
  timeMs: number;
  /** The fee payer / first signer, qor1… */
  signer: string;
  memo: string;
  /** Exactly one MsgSend from the signer to itself. */
  selfSendOnly: boolean;
  /** The chain's own pqc_hybrid_verify event said "verified". */
  chainVerifiedHybrid: boolean;
  /** QoreSign re-checked the ML-DSA-87 layer against the key registered on chain for `signer`. */
  pqLayerMatchesRegisteredKey: boolean;
}

export type Refusal =
  | "tx-failed"
  | "not-alat-memo"
  | "not-self-send"
  | "not-hybrid"
  | "pq-key-mismatch"
  | "wrong-signer"
  | "wrong-account"
  | "wrong-challenge"
  | "wrong-token"
  | "before-challenge"
  | "expired"
  | "already-used"
  | "challenge-closed";

export type Verdict<T> = { ok: true; value: T } | { ok: false; reason: Refusal };

const refuse = <T>(reason: Refusal): Verdict<T> => ({ ok: false, reason });

/** Clock skew allowed between Alat's clock and block time. */
export const SKEW_MS = 30_000;

/** The checks shared by every action: a real, successful, hybrid-signed self-send. */
function baseChecks(tx: ObservedTx, usedHashes: ReadonlySet<string>): Refusal | undefined {
  if (usedHashes.has(tx.hash.toUpperCase())) return "already-used";
  if (tx.code !== 0) return "tx-failed";
  if (!tx.chainVerifiedHybrid) return "not-hybrid";
  if (!tx.pqLayerMatchesRegisteredKey) return "pq-key-mismatch";
  if (!tx.selfSendOnly) return "not-self-send";
  return undefined;
}

export interface OpenChallenge {
  nonce: string;
  account: Hex32;
  createdAtMs: number;
  expiresAtMs: number;
  status: "pending" | "confirmed" | "denied" | "expired";
}

/**
 * An answer to a check. `linkedOwner` is the qor1 owner of `challenge.account`
 * read from the registry contract when the answer arrives.
 */
export function verifyAnswer(args: {
  tx: ObservedTx;
  challenge: OpenChallenge;
  linkedOwner: string | undefined;
  usedHashes?: ReadonlySet<string>;
}): Verdict<Answer> {
  const { tx, challenge, linkedOwner } = args;
  const base = baseChecks(tx, args.usedHashes ?? new Set());
  if (base) return refuse(base);
  const memo = parseMemo(tx.memo);
  if (!memo || memo.kind !== "answer") return refuse("not-alat-memo");
  // A signature made for another check (older or newer) never answers this one.
  if (memo.nonce !== challenge.nonce) return refuse("wrong-challenge");
  // Block time decides, not when Alat happened to hear about it.
  if (tx.timeMs > challenge.expiresAtMs) return refuse("expired");
  if (challenge.status !== "pending") return refuse("challenge-closed");
  // The key must be the one linked to the account this check is about.
  if (!linkedOwner) return refuse("wrong-account");
  if (tx.signer !== linkedOwner) return refuse("wrong-signer");
  if (tx.timeMs + SKEW_MS < challenge.createdAtMs) return refuse("before-challenge");
  return { ok: true, value: memo.answer };
}

export interface PendingLinkToken {
  token: string;
  account: Hex32;
  createdAtMs: number;
  expiresAtMs: number;
  usedTx?: string;
}

/** The owner's link transaction for a token the bot issued. */
export function verifyLink(args: {
  tx: ObservedTx;
  token: PendingLinkToken;
  usedHashes?: ReadonlySet<string>;
}): Verdict<{ owner: string; account: Hex32 }> {
  const { tx, token } = args;
  const base = baseChecks(tx, args.usedHashes ?? new Set());
  if (base) return refuse(base);
  if (token.usedTx) return refuse("already-used");
  const memo = parseMemo(tx.memo);
  if (!memo || memo.kind !== "link") return refuse("not-alat-memo");
  if (memo.token !== token.token) return refuse("wrong-token");
  if (memo.account !== token.account) return refuse("wrong-account");
  if (tx.timeMs + SKEW_MS < token.createdAtMs) return refuse("before-challenge");
  if (tx.timeMs > token.expiresAtMs) return refuse("expired");
  return { ok: true, value: { owner: tx.signer, account: token.account } };
}

/** The current owner cancels a pending link change. */
export function verifyCancel(args: {
  tx: ObservedTx;
  account: Hex32;
  linkedOwner: string | undefined;
  changeRequestedAtMs: number;
  usedHashes?: ReadonlySet<string>;
}): Verdict<Hex32> {
  const { tx } = args;
  const base = baseChecks(tx, args.usedHashes ?? new Set());
  if (base) return refuse(base);
  const memo = parseMemo(tx.memo);
  if (!memo || memo.kind !== "cancel") return refuse("not-alat-memo");
  if (memo.account !== args.account) return refuse("wrong-account");
  if (!args.linkedOwner || tx.signer !== args.linkedOwner) return refuse("wrong-signer");
  // A cancel signed before the change was asked for can't be replayed against it.
  if (tx.timeMs + SKEW_MS < args.changeRequestedAtMs) return refuse("before-challenge");
  return { ok: true, value: args.account };
}

export const REFUSAL_TEXT: Record<Refusal, string> = {
  "tx-failed": "The transaction failed on chain.",
  "not-alat-memo": "The transaction is not an Alat answer.",
  "not-self-send": "The transaction must be a 1 uqor transfer to yourself and nothing else.",
  "not-hybrid": "The chain did not verify a hybrid (secp256k1 + ML-DSA-87) signature on it.",
  "pq-key-mismatch": "The ML-DSA-87 signature does not match the key registered for this account.",
  "wrong-signer": "It was signed by a different key than the one linked to this account.",
  "wrong-account": "It is for a different account.",
  "wrong-challenge": "It answers a different check.",
  "wrong-token": "It is for a different link request.",
  "before-challenge": "It was signed before this request existed.",
  expired: "It was signed after the check expired.",
  "already-used": "This transaction was already used.",
  "challenge-closed": "This check is already closed.",
};
