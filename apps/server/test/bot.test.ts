/**
 * The Telegram bot, driven with real grammY handlers and simulated updates.
 * Outgoing Bot API calls are captured instead of sent.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { answerMemo, linkMemo } from "@alat/core";
import type { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";
import { createBot, TelegramNotifier } from "../src/bot.ts";
import { Alat } from "../src/service.ts";
import { FakeChain, memDb } from "./fakes.ts";

const SALT = "bot-test-salt-bot-test-salt-bot-test-salt";
const OWNER = "qor1md44fjsld8rjzx2r2hhyquw2wldm60a2dqlalk";
const HACKER = "qor1psnx8dzwy3trwqg279zzr93l5ksd2ktgnsgp40";
const ALICE = { id: 1001, is_bot: false, first_name: "Alice", username: "alice_k" };
const FRIEND = { id: 3003, is_bot: false, first_name: "Sam", username: "sam_r" };
const botInfo: UserFromGetMe = {
  id: 42,
  is_bot: true,
  first_name: "Alat",
  username: "alat_test_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
} as UserFromGetMe;

type Call = { method: string; payload: Record<string, unknown> };

let t: number;
let chain: FakeChain;
let alat: Alat;
let bot: Bot;
let calls: Call[];
let nextMessageId: number;
let updateId = 1;

beforeEach(async () => {
  t = Date.parse("2026-11-19T12:00:00Z");
  chain = new FakeChain(() => t);
  calls = [];
  nextMessageId = 500;
  const holder = { n: undefined as TelegramNotifier | undefined };
  alat = new Alat(
    await memDb(),
    chain,
    { checkChanged: (c, v) => holder.n!.checkChanged(c, v), toOwner: (a, b, u) => holder.n!.toOwner(a, b, u) },
    { salt: SALT, publicUrl: "https://alat.example", now: () => t, observeAttempts: 1, observeDelayMs: 0 },
  );
  bot = createBot("1:test", alat, "https://alat.example");
  bot.botInfo = botInfo;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const result =
      method === "sendMessage" ? { message_id: nextMessageId++, date: 0, chat: { id: (payload as { chat_id: number }).chat_id, type: "private" } } : true;
    return { ok: true, result } as never;
  });
  holder.n = new TelegramNotifier(bot, "https://alat.example", async (a) => {
    const r = await alat.db.account(a);
    return r?.username ? `@${r.username}` : "this account";
  });
});

function message(from: typeof ALICE, text: string, extra: Record<string, unknown> = {}): Update {
  const entities = text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0]!.length }] : undefined;
  return {
    update_id: updateId++,
    message: { message_id: updateId, date: 0, chat: { id: from.id, type: "private", first_name: from.first_name }, from, text, entities, ...extra },
  } as unknown as Update;
}

const last = (method: string) => [...calls].reverse().find((c) => c.method === method)!;
const text = (c: Call) => String(c.payload.text);

async function linkAlice(signer = OWNER) {
  await bot.handleUpdate(message(ALICE, "/link"));
  const url = JSON.stringify(last("sendMessage").payload.reply_markup);
  const token = /t=([a-z0-9]{20})/.exec(url)![1]!;
  const account = alat.accountFor("telegram", ALICE.id);
  return alat.submitLink(token, chain.sign(signer, linkMemo(account, token)));
}

describe("bot", () => {
  it("/link sends a one-time link bound to the sender's Telegram id", async () => {
    await bot.handleUpdate(message(ALICE, "/link"));
    const c = last("sendMessage");
    assert.match(text(c), /one-time link/);
    assert.match(JSON.stringify(c.payload.reply_markup), /https:\/\/alat\.example\/link\?t=[a-z0-9]{20}/);
  });

  it("/check on an account that never set up Alat says to call them", async () => {
    await bot.handleUpdate(message(FRIEND, "/check @nobody_here"));
    assert.match(text(last("sendMessage")), /hasn't set up Alat[\s\S]*Call them on a number you already know/);
  });

  it("/check sends ⏳ once, then edits that same message to ❌ when the owner says not me", async () => {
    await linkAlice();
    await bot.handleUpdate(message(FRIEND, "/check @alice_k I'm stuck, send 200 urgently"));
    const waiting = last("sendMessage");
    assert.match(text(waiting), /⏳ <b>Waiting for the owner\.<\/b>/);
    assert.match(text(waiting), /Do not send money until this turns green/);
    assert.match(text(waiting), /Link transaction: <code>[0-9A-F]{64}<\/code>/);

    // The owner was told in their own chat, with the respond link.
    assert.ok(calls.some((c) => c.method === "sendMessage" && c.payload.chat_id === String(ALICE.id) && /checking a message/.test(text(c))));

    const row = (await alat.db.q("SELECT nonce FROM checks"))[0] as { nonce: string };
    await alat.submitAnswer(chain.sign(OWNER, answerMemo(row.nonce, "no")));
    const edit = last("editMessageText");
    assert.equal(edit.payload.chat_id, String(FRIEND.id));
    assert.equal(edit.payload.message_id, 500 + calls.filter((c) => c.method === "sendMessage").length - 1);
    assert.match(text(edit), /❌ <b>The owner says this is NOT them\.<\/b>/);
  });

  it("a forwarded message is checked against its sender's Telegram id, not the name shown", async () => {
    await linkAlice();
    await bot.handleUpdate(
      message(FRIEND, "please send money", { forward_origin: { type: "user", date: 0, sender_user: ALICE } }),
    );
    assert.match(text(last("sendMessage")), /⏳/);
    const row = (await alat.db.q("SELECT account, request_text FROM checks"))[0] as { account: string; request_text: string };
    assert.equal(row.account, alat.accountFor("telegram", ALICE.id));
    assert.equal(row.request_text, "please send money");
  });

  it("a forward with a hidden sender can't be checked", async () => {
    await bot.handleUpdate(message(FRIEND, "x", { forward_origin: { type: "hidden_user", date: 0, sender_user_name: "Alice" } }));
    assert.match(text(last("sendMessage")), /Telegram hides who sent this message/);
  });

  it("an expired check is edited to ❌ Not confirmed", async () => {
    await linkAlice();
    await bot.handleUpdate(message(FRIEND, "/check @alice_k"));
    t += 16 * 60_000;
    await alat.expireDue();
    assert.match(text(last("editMessageText")), /❌ <b>Not confirmed\.<\/b>/);
  });

  it("a hacker's /link from the same Telegram account starts a 7-day wait and every check shows the warning", async () => {
    await linkAlice(OWNER);
    const r = await linkAlice(HACKER);
    assert.equal(r.kind, "change-pending");
    assert.match(text(last("sendMessage")), /NEW key was requested/);
    await bot.handleUpdate(message(FRIEND, "/check @alice_k"));
    assert.match(text(last("sendMessage")), /⚠️ Link change pending/);
  });
});
