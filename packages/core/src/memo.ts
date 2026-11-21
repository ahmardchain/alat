/**
 * Every action an owner takes is a hybrid-signed native transaction whose memo
 * says what it is. QoreX signs memos, not messages (docs/FINDINGS.md, F1).
 *
 *   alat1:link:<accountHash>:<token>          link this chat account to me
 *   alat1:ans:<nonce>:yes|no                  answer a check
 *   alat1:cancel:<accountHash>                cancel a pending link change
 *
 * Memos are public on chain. They hold no names, usernames or request text.
 */
import { isToken, type Hex32 } from "./ids.ts";

export type Answer = "yes" | "no";

export type Memo =
  | { kind: "link"; account: Hex32; token: string }
  | { kind: "answer"; nonce: string; answer: Answer }
  | { kind: "cancel"; account: Hex32 };

const HASH = /^0x[0-9a-f]{64}$/;

export function linkMemo(account: Hex32, token: string): string {
  return `alat1:link:${account}:${token}`;
}
export function answerMemo(nonce: string, answer: Answer): string {
  return `alat1:ans:${nonce}:${answer}`;
}
export function cancelMemo(account: Hex32): string {
  return `alat1:cancel:${account}`;
}

/** Parse a memo strictly: anything else is not an Alat action. */
export function parseMemo(memo: string): Memo | undefined {
  const p = memo.split(":");
  if (p[0] !== "alat1") return undefined;
  if (p[1] === "link" && p.length === 4 && HASH.test(p[2]!) && isToken(p[3]!)) {
    return { kind: "link", account: p[2] as Hex32, token: p[3]! };
  }
  if (p[1] === "ans" && p.length === 4 && isToken(p[2]!) && (p[3] === "yes" || p[3] === "no")) {
    return { kind: "answer", nonce: p[2]!, answer: p[3] };
  }
  if (p[1] === "cancel" && p.length === 3 && HASH.test(p[2]!)) {
    return { kind: "cancel", account: p[2] as Hex32 };
  }
  return undefined;
}
