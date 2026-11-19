/**
 * The whole flow (link, check, answer, cancel) through the service, with an
 * in-memory registry that follows AlatRegistry's rules (7-day wait, consent,
 * cancel). The contract's own tests are in contracts/test/AlatRegistry.ts; the
 * same flow against the real testnet is in test/flow.live.test.ts.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { beforeEach, describe, it } from "node:test";

import { answerMemo, cancelMemo, linkMemo, type Hex32, type ObservedTx } from "@alat/core";
import { Db } from "../src/db.ts";
import { Alat, AlatError, type ChainPort, type CheckView, type Notifier } from "../src/service.ts";
import type { LinkInfo, PendingInfo } from "../src/chain.ts";

const SALT = "service-test-salt-service-test-salt-0000";
const OWNER = "qor1md44fjsld8rjzx2r2hhyquw2wldm60a2dqlalk";
const HACKER = "qor1psnx8dzwy3trwqg279zzr93l5ksd2ktgnsgp40";
const DAY = 86_400_000;

class FakeChain implements ChainPort {
  links = new Map<Hex32, LinkInfo>();
  pending = new Map<Hex32, PendingInfo>();
  txs = new Map<string, ObservedTx>();
  writes: string[] = [];
  constructor(private readonly now: () => number) {}

  async linkOf(a: Hex32) {
    return this.links.get(a);
  }
  async pendingOf(a: Hex32) {
    return this.pending.get(a);
  }
  async link(a: Hex32, owner: string, tx: string) {
    if (this.links.has(a)) throw new Error("AlreadyLinked");
    this.links.set(a, { owner, linkedAtMs: this.now(), evidenceTx: tx });
    this.writes.push(`link ${owner}`);
    return { evmTx: "0xlink" };
  }
  async requestChange(a: Hex32, newOwner: string | null, tx: string) {
    if (!this.links.has(a)) throw new Error("NotLinked");
    if (this.pending.has(a)) throw new Error("ChangePending");
    this.pending.set(a, { newOwner, requestedAtMs: this.now(), unlockAtMs: this.now() + 7 * DAY, evidenceTx: tx });
    this.writes.push(`request ${newOwner}`);
    return { evmTx: "0xrequest" };
  }
  async cancelChange(a: Hex32, tx: string) {
    if (!this.pending.delete(a)) throw new Error("NoChangePending");
    this.writes.push(`cancel ${tx}`);
    return { evmTx: "0xcancel" };
  }
  async observe(hash: string) {
    return this.txs.get(hash);
  }

  /** Put a hybrid-signed self-send from `signer` with `memo` "on chain". */
  sign(signer: string, memo: string, timeMs = this.now(), over: Partial<ObservedTx> = {}): string {
    const hash = randomBytes(32).toString("hex").toUpperCase();
    this.txs.set(hash, {
      hash,
      code: 0,
      timeMs,
      signer,
      memo,
      selfSendOnly: true,
      chainVerifiedHybrid: true,
      pqLayerMatchesRegisteredKey: true,
      ...over,
    });
    return hash;
  }
}

class Inbox implements Notifier {
  changes: CheckView[] = [];
  owner: string[] = [];
  async checkChanged(_c: unknown, v: CheckView) {
    this.changes.push(v);
  }
  async toOwner(_chat: string, text: string) {
    this.owner.push(text);
  }
}

let t: number;
let chain: FakeChain;
let inbox: Inbox;
let alat: Alat;

beforeEach(() => {
  t = Date.parse("2026-11-19T12:00:00Z");
  chain = new FakeChain(() => t);
  inbox = new Inbox();
  alat = new Alat(new Db(":memory:"), chain, inbox, {
    salt: SALT,
    publicUrl: "https://alat.example",
    now: () => t,
    observeAttempts: 1,
    observeDelayMs: 0,
  });
});

async function linkAs(userId: number, signer: string) {
  const tok = alat.issueLinkToken({ platform: "telegram", userId, username: `user${userId}`, chatId: String(userId) });
  t += 30_000;
  const hash = chain.sign(signer, linkMemo(tok.account, tok.token));
  return alat.submitLink(tok.token, hash);
}

async function check(account: Hex32) {
  const r = await alat.startCheck({ account, friendChatId: "friend", requestText: "I'm stuck, send 200" });
  assert.equal(r.notLinked, false);
  if (r.notLinked) throw new Error("unreachable");
  return r.check;
}

const refusal = async (p: Promise<unknown>, code: string) => {
  await assert.rejects(p, (e: unknown) => e instanceof AlatError && e.code === code);
};

describe("link", () => {
  it("links the account to the key that signed the link transaction", async () => {
    const r = await linkAs(1001, OWNER);
    assert.equal(r.kind, "linked");
    assert.equal((await chain.linkOf(r.account))?.owner, OWNER);
    assert.match(inbox.owner.at(-1)!, /^Linked\./);
  });

  it("refuses a link transaction used twice, or signed after the token expired", async () => {
    const tok = alat.issueLinkToken({ platform: "telegram", userId: 7, username: null, chatId: null });
    const late = chain.sign(OWNER, linkMemo(tok.account, tok.token), t + 11 * 60_000);
    await refusal(alat.submitLink(tok.token, late), "expired");
    const ok = chain.sign(OWNER, linkMemo(tok.account, tok.token));
    await alat.submitLink(tok.token, ok);
    await refusal(alat.submitLink(tok.token, ok), "already-used");
  });
});

describe("check and answer: what Alat refuses", () => {
  it("✅ when the linked key says yes, ❌ when it says no", async () => {
    const { account } = await linkAs(1001, OWNER);
    const c1 = await check(account);
    const v1 = await alat.submitAnswer(chain.sign(OWNER, answerMemo(c1.nonce, "yes")));
    assert.equal(v1.verdict, "confirmed");
    const c2 = await check(account);
    const v2 = await alat.submitAnswer(chain.sign(OWNER, answerMemo(c2.nonce, "no")));
    assert.equal(v2.verdict, "denied");
    assert.deepEqual(inbox.changes.map((v) => v.verdict), ["confirmed", "denied"]);
  });

  it("not linked → tells the friend to call", async () => {
    const r = await alat.startCheck({ account: alat.accountFor("telegram", 404), friendChatId: "f" });
    assert.equal(r.notLinked, true);
  });

  it("refuses a signature from a different key", async () => {
    const { account } = await linkAs(1001, OWNER);
    const c = await check(account);
    await refusal(alat.submitAnswer(chain.sign(HACKER, answerMemo(c.nonce, "yes"))), "wrong-signer");
    assert.equal((await alat.checkView(c.id)).verdict, "waiting");
  });

  it("refuses a replayed signature from an older challenge", async () => {
    const { account } = await linkAs(1001, OWNER);
    const old = await check(account);
    const oldAnswer = chain.sign(OWNER, answerMemo(old.nonce, "yes"));
    await alat.submitAnswer(oldAnswer);
    const fresh = await check(account);
    await refusal(alat.submitAnswer(oldAnswer), "already-used");
    assert.equal((await alat.checkView(fresh.id)).verdict, "waiting");
  });

  it("refuses a signature valid for one account used on another", async () => {
    const alice = await linkAs(1001, OWNER);
    await linkAs(2002, HACKER);
    const bobAccount = alat.accountFor("telegram", 2002);
    const bobs = await check(bobAccount);
    // Alice's key answers Bob's check: refused, Bob's key is the only one that counts.
    await refusal(alat.submitAnswer(chain.sign(OWNER, answerMemo(bobs.nonce, "yes"))), "wrong-signer");
    assert.notEqual(alice.account, bobAccount);
  });

  it("keeps an expired challenge answered late at ❌", async () => {
    const { account } = await linkAs(1001, OWNER);
    const c = await check(account);
    t = c.expiresAtMs + 1000;
    await alat.expireDue();
    assert.equal((await alat.checkView(c.id)).verdict, "expired");
    const late = chain.sign(OWNER, answerMemo(c.nonce, "yes"), t);
    await refusal(alat.submitAnswer(late), "expired");
    assert.equal((await alat.checkView(c.id)).verdict, "expired");
  });

  it("refuses an answer the chain did not verify as hybrid", async () => {
    const { account } = await linkAs(1001, OWNER);
    const c = await check(account);
    const h = chain.sign(OWNER, answerMemo(c.nonce, "yes"), t, { chainVerifiedHybrid: false });
    await refusal(alat.submitAnswer(h), "not-hybrid");
  });
});

describe("re-link from Telegram alone (the hacker has the chat account)", () => {
  it("stays pending 7 days, is flagged on every check, and the old key can cancel it", async () => {
    const { account } = await linkAs(1001, OWNER);
    // The hacker controls Telegram user 1001 and links it to their own key.
    const r = await linkAs(1001, HACKER);
    assert.equal(r.kind, "change-pending");
    assert.equal((await chain.linkOf(account))?.owner, OWNER, "the old key stays linked");
    assert.equal(r.unlockAtMs, t + 7 * DAY);

    // Every check shows the warning, and only the OLD key can answer.
    const c = await check(account);
    const v = await alat.checkView(c.id);
    assert.ok(v.pending, "flagged: link change pending");
    await refusal(alat.submitAnswer(chain.sign(HACKER, answerMemo(c.nonce, "yes"))), "wrong-signer");
    const denied = await alat.submitAnswer(chain.sign(OWNER, answerMemo(c.nonce, "no")));
    assert.equal(denied.verdict, "denied");
    assert.ok(denied.pending);

    // The hacker can't cancel; the owner can.
    await refusal(alat.submitCancel(chain.sign(HACKER, cancelMemo(account))), "wrong-signer");
    await alat.submitCancel(chain.sign(OWNER, cancelMemo(account)));
    assert.equal(await chain.pendingOf(account), undefined);
  });

  it("an old cancel transaction can't cancel a newer request", async () => {
    const { account } = await linkAs(1001, OWNER);
    const early = chain.sign(OWNER, cancelMemo(account), t);
    t += DAY;
    await linkAs(1001, HACKER);
    await refusal(alat.submitCancel(early), "before-challenge");
  });
});
