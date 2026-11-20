/**
 * Development stand-in for the Telegram bot, for testing without a bot token.
 *   node --import tsx src/devtool.ts link-token <telegramUserId> <username>
 *   node --import tsx src/devtool.ts check <telegramUserId> [request text…]
 *   node --import tsx src/devtool.ts sign-answer relayer|demo <nonce> yes|no
 *   node --import tsx src/devtool.ts sign-link relayer|demo <token>
 * Writes to the same database as the running server.
 */
import { answerMemo } from "@alat/core";
import { wire } from "./wire.ts";

const { alat, chain } = await wire();
const [cmd, id, ...rest] = process.argv.slice(2);
if (cmd === "link-token" && id) {
  const t = await alat.issueLinkToken({ platform: "telegram", userId: id, username: rest[0] ?? null, chatId: null });
  console.log(JSON.stringify(t));
} else if (cmd === "check" && id) {
  const r = await alat.startCheck({ account: alat.accountFor("telegram", id), friendChatId: null, requestText: rest.join(" ") || undefined });
  console.log(JSON.stringify(r.notLinked ? { notLinked: true } : { id: r.check.id, nonce: r.check.nonce, expiresAtMs: r.check.expiresAtMs }));
} else if (cmd === "sign-answer" && id && rest.length === 2) {
  // Sign an answer with a server-held key (relayer or demo), for refusal tests: id = relayer | demo.
  const acc = id === "demo" ? await chain.demoOwner() : await chain.relayer();
  const hash = await chain.selfMemo(acc!, answerMemo(rest[0]!, rest[1] as "yes" | "no"));
  console.log(JSON.stringify({ hash, signer: acc!.cosmos }));
} else if (cmd === "sign-link" && id && rest.length === 1) {
  // Sign a link memo for an issued token with a server-held key (the "hacker" in the re-link test).
  const acc = id === "demo" ? await chain.demoOwner() : await chain.relayer();
  const info = await alat.linkInfo(rest[0]!);
  const hash = await chain.selfMemo(acc!, info.memo);
  console.log(JSON.stringify({ hash, signer: acc!.cosmos }));
} else {
  console.error("usage: devtool link-token <userId> <username> | check <userId> [text]");
  process.exit(1);
}
