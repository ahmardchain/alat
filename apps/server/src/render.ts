import { PENDING_CHANGE_WARNING, VERDICT } from "@alat/core";
import type { CheckView } from "./service.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const day = (ms: number) => new Date(ms).toUTCString().replace(/:\d\d GMT$/, " UTC");

/** The friend's message (Telegram HTML). One message, edited as the state changes. */
export function renderCheck(v: CheckView, publicUrl: string, who: string): string {
  const k = VERDICT[v.verdict];
  const lines = [`${k.icon} <b>${esc(k.title)}</b>`, esc(k.body), ""];
  lines.push(`Account: ${esc(who)}`);
  if (v.verdict === "waiting") lines.push(`Expires: ${day(v.expiresAtMs)}`);
  if (v.link) {
    lines.push(`Linked to a QoreChain key on ${day(v.link.linkedAtMs)}.`);
    lines.push(`Link transaction: <code>${v.link.evidenceTx}</code>`);
  }
  if (v.answerTx) lines.push(`Answer transaction: <code>${v.answerTx}</code>`);
  if (v.pending) {
    lines.push("", esc(PENDING_CHANGE_WARNING), `Takes effect: ${day(v.pending.unlockAtMs)} unless the current key cancels it.`);
  }
  lines.push("", `Details: ${publicUrl}/c/${v.id}`);
  return lines.join("\n");
}
