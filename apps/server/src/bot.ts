/**
 * The Telegram bot. It sees the real Telegram user id of whoever writes to it,
 * so linking needs no screenshots or bio codes.
 *
 *   /link                 the sender gets a one-time link (10 min) to bind their account to their QoreX key
 *   /check @username …    a friend asks whether a request came from the owner
 *   (forward a message)   same as /check, for the forwarded message's sender
 */
import { Bot, InlineKeyboard, type Context } from "grammy";
import { VERDICT, type Hex32 } from "@alat/core";
import { renderCheck } from "./render.ts";
import type { CheckRow } from "./db.ts";
import type { Demo } from "./demo.ts";
import type { Alat, CheckView, Notifier } from "./service.ts";

const HELP = [
  "<b>Alat</b> — ask the key, not the chat.",
  "",
  "<b>Got a money request from a friend?</b>",
  "Send <code>/check @their_username</code>, optionally followed by the message, or forward their message to me.",
  "",
  "<b>Want friends to be able to check you?</b>",
  "Send /link once and connect your QoreX wallet. Your key, not this chat, will answer.",
  "",
  "<b>Just looking?</b> Send /demo.",
].join("\n");

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
    await this.bot.api.editMessageText(check.friendChatId, check.friendMessageId, renderCheck(view, this.publicUrl, await this.label(check.account)), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  }

  async toOwner(chatId: string, text: string, url?: string): Promise<void> {
    await this.bot.api.sendMessage(chatId, text, url ? { reply_markup: new InlineKeyboard().url("Open Alat", url) } : {});
  }
}

export function createBot(token: string, alat: Alat, publicUrl: string, demo?: Demo): Bot {
  const bot = new Bot(token);

  // Every update refreshes the username → Telegram id map, so a renamed account
  // stays findable under its new name (the id, not the name, is what is linked).
  bot.use(async (ctx, next) => {
    const w = who(ctx);
    if (w) await alat.remember("telegram", w.userId, w.username, ctx.chat?.type === "private" ? w.chatId : null);
    await next();
  });

  // Judges: t.me/<bot>?start=demo, or /demo. Runs a check on the pre-linked demo account;
  // the demo owner's answer is given on the site, and this message changes in place.
  async function runDemo(ctx: Context) {
    if (!demo) return ctx.reply("The demo is not configured on this server.");
    const r = await demo.start("hacker", String(ctx.chat!.id));
    if (r.notLinked) return ctx.reply("The demo account is not linked yet. Try again in a minute.");
    const sent = await ctx.reply(
      `<i>Demo: you just got this from @alat_demo:</i>\n“${r.check.requestText}”\n\n` + renderCheck(r.view, publicUrl, "@alat_demo"),
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );
    await alat.db.setFriendMessage(r.check.id, String(ctx.chat!.id), sent.message_id);
    await ctx.reply("Now play the owner. Answer with the demo key, and watch the message above change:", {
      reply_markup: new InlineKeyboard().url("Answer as the owner", `${publicUrl}/judge?c=${r.check.id}`),
    });
  }

  bot.command("demo", runDemo);
  bot.command(["start", "help"], (ctx) => (ctx.match === "demo" ? runDemo(ctx) : ctx.reply(HELP, { parse_mode: "HTML" })));

  bot.command("link", async (ctx) => {
    if (ctx.chat.type !== "private") return ctx.reply("Send /link to me in a private chat.");
    const w = who(ctx)!;
    const t = await alat.issueLinkToken({ platform: "telegram", ...w });
    await ctx.reply(
      "Here is your one-time link. It works for 10 minutes and only for this Telegram account.\n\nOpen it on the device where QoreX is installed.",
      { reply_markup: new InlineKeyboard().url("Link with QoreX", t.url) },
    );
  });

  async function runCheck(ctx: Context, account: Hex32, label: string, text?: string) {
    const r = await alat.startCheck({ account, friendChatId: String(ctx.chat!.id), requestText: text });
    if (r.notLinked) {
      const k = VERDICT["not-linked"];
      return ctx.reply(`${k.icon} <b>${label} hasn't set up Alat.</b>\n${k.body}`, { parse_mode: "HTML" });
    }
    const sent = await ctx.reply(renderCheck(r.view, publicUrl, label), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    await alat.db.setFriendMessage(r.check.id, String(ctx.chat!.id), sent.message_id);
  }

  bot.command("check", async (ctx) => {
    const [first, ...rest] = ctx.match.trim().split(/\s+/);
    const username = first?.replace(/^@/, "");
    if (!username || !/^[A-Za-z0-9_]{4,32}$/.test(username)) {
      return ctx.reply("Send /check @username, optionally followed by the message you received.");
    }
    const known = await alat.db.accountByUsername(username);
    if (!known) {
      const k = VERDICT["not-linked"];
      return ctx.reply(`${k.icon} <b>@${username} hasn't set up Alat.</b>\n${k.body}`, { parse_mode: "HTML" });
    }
    await runCheck(ctx, known.account, `@${username}`, rest.join(" ") || undefined);
  });

  // A forwarded message names its sender's id, unless the sender hides it.
  bot.on("message:forward_origin", async (ctx) => {
    const o = ctx.message.forward_origin;
    if (o.type !== "user") {
      return ctx.reply("Telegram hides who sent this message, so I can't check it. Use /check @username instead.");
    }
    const account = alat.accountFor("telegram", o.sender_user.id);
    const label = o.sender_user.username ? `@${o.sender_user.username}` : o.sender_user.first_name;
    const text = ctx.message.text ?? ctx.message.caption;
    await runCheck(ctx, account, label, text);
  });

  bot.on("message:text", (ctx) => ctx.reply(HELP, { parse_mode: "HTML" }));
  bot.catch((err) => console.error("bot error:", err.message));
  return bot;
}
