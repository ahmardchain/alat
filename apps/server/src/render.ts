import { PENDING_CHANGE_WARNING, VERDICT } from "@alat/core";
import { InlineKeyboard } from "grammy";
import type { CheckView } from "./service.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const day = (ms: number) => new Date(ms).toUTCString().replace(/:\d\d GMT$/, " UTC");
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

/**
 * The friend's message (Telegram HTML). One message, edited as the state changes.
 * `quote` is the money request itself, shown on demo checks.
 */
export function renderCheck(v: CheckView, publicUrl: string, who: string, quote?: string | null): string {
  const k = VERDICT[v.verdict];
  const lines: string[] = [];
  if (v.demo && quote) lines.push(`<i>Demo · ${esc(who)} wrote:</i>`, `“${esc(quote)}”`, "");
  lines.push(`${k.icon} <b>${esc(k.title)}</b>`, esc(k.body), "");
  lines.push(`Account: ${esc(who)}`);
  if (v.verdict === "waiting") lines.push(`Expires: ${day(v.expiresAtMs)}`);
  if (v.link) lines.push(`Linked to a QoreChain key on ${day(v.link.linkedAtMs)}.`, `Link tx: <code>${v.link.evidenceTx}</code>`);
  if (v.answerTx) lines.push(`Answer tx: <code>${v.answerTx}</code> (secp256k1 + ML-DSA-87)`);
  if (v.pending) {
    lines.push("", esc(PENDING_CHANGE_WARNING), `Takes effect: ${day(v.pending.unlockAtMs)} unless the current key cancels it.`);
  }
  if (v.demo && v.verdict === "waiting") lines.push("", "<i>Play each part with the buttons below. Every tap is a real testnet transaction.</i>");
  return lines.join("\n");
}

/** The buttons under a check message, for its current state. */
export function checkKeyboard(v: CheckView, publicUrl: string, opts: { forged?: boolean } = {}): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (v.demo && v.verdict === "waiting") {
    if (!opts.forged) kb.text("🕵️ Hacker answers with their own key", `d:${v.id}:f`).row();
    kb.text("✅ Owner: Yes, that's me", `d:${v.id}:y`).row();
    kb.text("❌ Owner: No, that's not me", `d:${v.id}:n`).row();
  } else if (v.verdict === "waiting") {
    kb.text("🔄 Refresh", `r:${v.id}`);
  }
  kb.url("Details", `${publicUrl}/c/${v.id}`);
  if (v.demo && v.verdict !== "waiting") kb.row().text("▶️ Run the demo again", "m:demo");
  return kb;
}

export function refusalText(message: string, tx: string): string {
  return `🛑 <b>Refused.</b> ${esc(message)}\nTheir transaction: <code>${tx}</code> (${short(tx)}, on the QoreChain testnet)\n\nThe check above is still ⏳. A hacker's key can't answer for this account.`;
}
