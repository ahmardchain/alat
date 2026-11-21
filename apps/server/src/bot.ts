/**
 * The Telegram bot. It sees the real Telegram user id of whoever writes to it,
 * so linking needs no screenshots or bio codes. Everything is reachable with
 * buttons; the commands are there too.
 *
 *   /start                menu: check a message, link my account, try the demo
 *   /link                 the sender gets a one-time link (10 min) to bind their account to their QoreX key
 *   /check @username …    a friend asks whether a request came from the owner (or just send @username)
 *   (forward a message)   same as /check, for the forwarded message's sender
 *   /demo                 the hacker story on the demo account, played with buttons
 */
import { Bot, InlineKeyboard, type Context } from "grammy";
import { VERDICT, type Hex32 } from "@alat/core";
import { checkKeyboard, refusalText, renderCheck } from "./render.ts";
import type { CheckRow } from "./db.ts";
import type { Demo } from "./demo.ts";
import { AlatError, type Alat, type CheckView, type Notifier } from "./service.ts";

const WELCOME = [
  "<b>Alat</b> · ask the key, not the chat.",
  "",
  "A hacked account can copy your friend's words. It can't copy their key.",
  "",
  "🔍 <b>Got a money request?</b> Forward it to me before you pay.",
  "🔗 <b>Want friends to be able to check you?</b> Link your account once.",
  "▶️ <b>Just looking?</b> Try the demo: a hacker, caught in 30 seconds.",
].join("\n");

export const COMMANDS = [
  { command: "start", description: "Menu" },
  { command: "check", description: "Check a money request: /check @username" },
  { command: "link", description: "Link your account to your QoreX key" },
  { command: "demo", description: "Watch Alat catch a hacker" },
];

const USERNAME = /^@?([A-Za-z0-9_]{4,32})$/;

function menu(publicUrl: string) {
  return new InlineKeyboard()
    .text("🔍 Check a message", "m:check")
    .text("🔗 Link my account", "m:link")
    .row()
    .text("▶️ Try the demo", "m:demo")
    .url("🌐 Open Alat", publicUrl);
}

/** Telegram user ids and usernames that the bot has seen. */
function who(ctx: Context) {
  const u = ctx.from;
  if (!u) return undefined;
  return { userId: String(u.id), username: u.username ?? null, chatId: String(ctx.chat?.id ?? u.id) };
}

export class TelegramNotifier implements Notifier {
  constructor(
    private readonly bot: Bot,
    private readonly publicUrl: string,
    private readonly label: (account: Hex32) => Promise<string>,
  ) {}

  async checkChanged(check: CheckRow, view: CheckView): Promise<void> {
    if (!check.friendChatId || !check.friendMessageId) return;
    await this.bot.api.editMessageText(
      check.friendChatId,
      check.friendMessageId,
      renderCheck(view, this.publicUrl, await this.label(check.account), check.requestText),
      { parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: checkKeyboard(view, this.publicUrl) },
    );
  }

  async toOwner(chatId: string, text: string, url?: string): Promise<void> {
    await this.bot.api.sendMessage(chatId, text, url ? { reply_markup: new InlineKeyboard().url("Answer with my key", url) } : {});
  }
}

export function createBot(token: string, alat: Alat, publicUrl: string, demo?: Demo): Bot {
  // Node's built-in fetch, no keep-alive agent, and a short limit: on Vercel a
  // reused keep-alive socket can stall, and grammY's default limit (500 s) is
  // longer than the function's 300 s, which hung every request.
  const bot = new Bot(token, {
    client: { fetch: globalThis.fetch as never, baseFetchConfig: {}, timeoutSeconds: 15 },
  });

  // Every update refreshes the username → Telegram id map, so a renamed account
  // stays findable under its new name (the id, not the name, is what is linked).
  bot.use(async (ctx, next) => {
    const w = who(ctx);
    if (w) await alat.remember("telegram", w.userId, w.username, ctx.chat?.type === "private" ? w.chatId : null);
    await next();
  });

  const send = (ctx: Context, text: string, kb?: InlineKeyboard) =>
    ctx.reply(text, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...(kb ? { reply_markup: kb } : {}) });

  const showMenu = (ctx: Context) => send(ctx, WELCOME, menu(publicUrl));

  // ------------------------------------------------------------------ demo

  async function runDemo(ctx: Context) {
    if (!demo) return send(ctx, "The demo is not configured on this server.");
    const r = await demo.start("hacker", String(ctx.chat!.id));
    if (r.notLinked) return send(ctx, "The demo account is not linked yet. Try again in a minute.");
    const sent = await send(ctx, renderCheck(r.view, publicUrl, "@alat_demo", r.check.requestText), checkKeyboard(r.view, publicUrl));
    await alat.db.setFriendMessage(r.check.id, String(ctx.chat!.id), sent.message_id);
  }

  // ------------------------------------------------------------------ link

  async function runLink(ctx: Context) {
    if (ctx.chat?.type !== "private") return send(ctx, "Open a private chat with me to link your account.");
    const t = await alat.issueLinkToken({ platform: "telegram", ...who(ctx)! });
    await send(
      ctx,
      "🔗 <b>Your one-time link</b>\nIt works for 10 minutes, only for this Telegram account. Open it where QoreX is installed, then tap <b>Sign and link</b>.",
      new InlineKeyboard().url("Link with QoreX", t.url).row().url("How to set up QoreX", `${publicUrl}/start`),
    );
  }

  // ----------------------------------------------------------------- check

  async function runCheck(ctx: Context, account: Hex32, label: string, text?: string) {
    const r = await alat.startCheck({ account, friendChatId: String(ctx.chat!.id), requestText: text });
    if (r.notLinked) {
      const k = VERDICT["not-linked"];
      return send(ctx, `${k.icon} <b>${label} hasn't set up Alat.</b>\n${k.body}`);
    }
    const sent = await send(ctx, renderCheck(r.view, publicUrl, label), checkKeyboard(r.view, publicUrl));
    await alat.db.setFriendMessage(r.check.id, String(ctx.chat!.id), sent.message_id);
  }

  async function checkUsername(ctx: Context, username: string, text?: string) {
    const known = await alat.db.accountByUsername(username);
    if (!known) {
      const k = VERDICT["not-linked"];
      return send(ctx, `${k.icon} <b>@${username} hasn't set up Alat.</b>\n${k.body}`);
    }
    await runCheck(ctx, known.account, `@${username}`, text);
  }

  const askWhatToCheck = (ctx: Context) =>
    send(
      ctx,
      "🔍 <b>Forward me the message</b> that asks for money.\nOr type their username, like <code>@maya</code>.",
    );

  // -------------------------------------------------------------- commands

  bot.command(["start", "help"], (ctx) => (ctx.match === "demo" ? runDemo(ctx) : showMenu(ctx)));
  bot.command("demo", runDemo);
  bot.command("link", runLink);
  bot.command("check", async (ctx) => {
    const [first, ...rest] = ctx.match.trim().split(/\s+/);
    const m = first ? USERNAME.exec(first) : null;
    if (!m) return askWhatToCheck(ctx);
    await checkUsername(ctx, m[1]!, rest.join(" ") || undefined);
  });

  // --------------------------------------------------------------- buttons

  bot.callbackQuery("m:check", async (ctx) => {
    await ctx.answerCallbackQuery();
    await askWhatToCheck(ctx);
  });
  bot.callbackQuery("m:link", async (ctx) => {
    await ctx.answerCallbackQuery();
    await runLink(ctx);
  });
  bot.callbackQuery("m:demo", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Starting the demo…" });
    await runDemo(ctx);
  });

  // Refresh a check message.
  bot.callbackQuery(/^r:([a-z0-9]{12})$/, async (ctx) => {
    const v = await alat.checkView(ctx.match[1]!).catch(() => undefined);
    if (!v) return ctx.answerCallbackQuery({ text: "This check no longer exists." });
    await ctx.answerCallbackQuery({ text: v.verdict === "waiting" ? "Still waiting for the owner's key." : "Updated." });
    const row = await alat.db.check(v.id);
    const label = row ? ((await alat.db.account(row.account))?.username ?? null) : null;
    await ctx
      .editMessageText(renderCheck(v, publicUrl, label ? `@${label}` : "this account", row?.requestText), {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: checkKeyboard(v, publicUrl),
      })
      .catch(() => undefined); // "message is not modified" when nothing changed
  });

  // Demo actions: each one signs a real hybrid testnet transaction.
  bot.callbackQuery(/^d:([a-z0-9]{12}):([fyn])$/, async (ctx) => {
    if (!demo) return ctx.answerCallbackQuery();
    const [, id, action] = ctx.match as unknown as [string, string, "f" | "y" | "n"];
    await ctx.answerCallbackQuery({ text: "Signing on the QoreChain testnet… a few seconds." });
    try {
      if (action === "f") {
        const r = await demo.forge(id);
        const v = await alat.checkView(id);
        await ctx.editMessageReplyMarkup({ reply_markup: checkKeyboard(v, publicUrl, { forged: true }) }).catch(() => undefined);
        await send(ctx, refusalText(r.message, r.tx));
      } else {
        // The notifier edits the check message itself to ✅ or ❌.
        await demo.answer(id, action === "y" ? "yes" : "no");
      }
    } catch (e) {
      const msg = e instanceof AlatError ? e.message : "Something went wrong on Alat's side. Try again.";
      await send(ctx, `⚠️ ${msg}`);
    }
  });

  // ------------------------------------------------------------- messages

  // A forwarded message names its sender's id, unless the sender hides it.
  bot.on("message:forward_origin", async (ctx) => {
    const o = ctx.message.forward_origin;
    if (o.type !== "user") {
      return send(ctx, "Telegram hides who sent this message, so I can't check it. Type their username instead, like <code>@maya</code>.");
    }
    const account = alat.accountFor("telegram", o.sender_user.id);
    const label = o.sender_user.username ? `@${o.sender_user.username}` : o.sender_user.first_name;
    await runCheck(ctx, account, label, ctx.message.text ?? ctx.message.caption);
  });

  // "@maya" on its own is a check.
  bot.on("message:text", async (ctx) => {
    const m = USERNAME.exec(ctx.message.text.trim());
    if (m && ctx.message.text.trim().startsWith("@")) return checkUsername(ctx, m[1]!);
    return showMenu(ctx);
  });

  bot.catch((err) => console.error("bot error:", err.message));
  return bot;
}
