import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import {
  accountHash,
  answerMemo,
  cancelMemo,
  createChallenge,
  effectiveStatus,
  linkMemo,
  parseMemo,
  randomToken,
  verifyAnswer,
  verifyCancel,
  verifyLink,
  type ObservedTx,
} from "../src/index.ts";

const SALT = "test-salt-test-salt-test-salt-test-salt";
const OWNER = "qor1md44fjsld8rjzx2r2hhyquw2wldm60a2dqlalk";
const OTHER_KEY = "qor1psnx8dzwy3trwqg279zzr93l5ksd2ktgnsgp40";
const ALICE = accountHash(SALT, "telegram", 1001);
const BOB = accountHash(SALT, "telegram", 2002);
const T0 = Date.parse("2026-11-19T12:00:00Z");

function tx(over: Partial<ObservedTx>): ObservedTx {
  return {
    hash: randomBytes(32).toString("hex").toUpperCase(),
    code: 0,
    timeMs: T0 + 60_000,
    signer: OWNER,
    memo: "",
    selfSendOnly: true,
    chainVerifiedHybrid: true,
    pqLayerMatchesRegisteredKey: true,
    ...over,
  };
}

describe("account ids", () => {
  it("are stable, salted and differ per account", () => {
    assert.equal(accountHash(SALT, "telegram", 1001), ALICE);
    assert.notEqual(ALICE, BOB);
    assert.notEqual(accountHash(`${SALT}x`, "telegram", 1001), ALICE);
    assert.match(ALICE, /^0x[0-9a-f]{64}$/);
  });
  it("refuse a short salt", () => {
    assert.throws(() => accountHash("short", "telegram", 1));
  });
});

describe("memos", () => {
  it("round-trip and refuse anything else", () => {
    const n = randomToken();
    assert.deepEqual(parseMemo(answerMemo(n, "no")), { kind: "answer", nonce: n, answer: "no" });
    assert.deepEqual(parseMemo(cancelMemo(ALICE)), { kind: "cancel", account: ALICE });
    assert.equal(parseMemo(`alat1:ans:${n}:maybe`), undefined);
    assert.equal(parseMemo(`alat1:ans:${n}:yes:extra`), undefined);
    assert.equal(parseMemo("hello"), undefined);
    assert.ok(new TextEncoder().encode(linkMemo(ALICE, randomToken())).length <= 256);
  });
});

describe("answers: what Alat refuses (prompt 4.4)", () => {
  const challenge = { ...createChallenge(ALICE, T0, "I'm stuck, send 200"), status: "pending" as const };
  const yes = answerMemo(challenge.nonce, "yes");

  it("accepts a valid answer from the linked key", () => {
    assert.deepEqual(verifyAnswer({ tx: tx({ memo: yes }), challenge, linkedOwner: OWNER }), { ok: true, value: "yes" });
    const no = verifyAnswer({ tx: tx({ memo: answerMemo(challenge.nonce, "no") }), challenge, linkedOwner: OWNER });
    assert.deepEqual(no, { ok: true, value: "no" });
  });

  it("refuses a signature from a different key", () => {
    const v = verifyAnswer({ tx: tx({ memo: yes, signer: OTHER_KEY }), challenge, linkedOwner: OWNER });
    assert.deepEqual(v, { ok: false, reason: "wrong-signer" });
  });

  it("refuses a replayed signature from an older challenge (nonce)", () => {
    const older = createChallenge(ALICE, T0 - 3_600_000);
    const v = verifyAnswer({ tx: tx({ memo: answerMemo(older.nonce, "yes") }), challenge, linkedOwner: OWNER });
    assert.deepEqual(v, { ok: false, reason: "wrong-challenge" });
  });

  it("refuses the same transaction twice", () => {
    const t = tx({ memo: yes });
    const v = verifyAnswer({ tx: t, challenge, linkedOwner: OWNER, usedHashes: new Set([t.hash]) });
    assert.deepEqual(v, { ok: false, reason: "already-used" });
  });

  it("refuses a signature valid for one account used on another", () => {
    // Bob's check, answered with a transaction signed by Alice's linked key.
    const bobs = createChallenge(BOB, T0);
    const bobOwner = OTHER_KEY;
    const v = verifyAnswer({ tx: tx({ memo: answerMemo(bobs.nonce, "yes"), signer: OWNER }), challenge: bobs, linkedOwner: bobOwner });
    assert.deepEqual(v, { ok: false, reason: "wrong-signer" });
    // And Alice's answer can't be pointed at Bob's check.
    const w = verifyAnswer({ tx: tx({ memo: yes }), challenge: bobs, linkedOwner: OWNER });
    assert.deepEqual(w, { ok: false, reason: "wrong-challenge" });
  });

  it("refuses a check on an account with no link", () => {
    const v = verifyAnswer({ tx: tx({ memo: yes }), challenge, linkedOwner: undefined });
    assert.deepEqual(v, { ok: false, reason: "wrong-account" });
  });

  it("keeps an expired challenge answered late at ❌", () => {
    const late = tx({ memo: yes, timeMs: challenge.expiresAtMs + 1 });
    assert.deepEqual(verifyAnswer({ tx: late, challenge, linkedOwner: OWNER }), { ok: false, reason: "expired" });
    assert.equal(effectiveStatus(challenge, challenge.expiresAtMs + 1), "expired");
    assert.equal(effectiveStatus(challenge, challenge.expiresAtMs), "pending");
  });

  it("refuses an answer to a closed check", () => {
    const closed = { ...challenge, status: "confirmed" as const };
    assert.deepEqual(verifyAnswer({ tx: tx({ memo: yes }), challenge: closed, linkedOwner: OWNER }), {
      ok: false,
      reason: "challenge-closed",
    });
  });

  it("refuses transactions the chain did not verify as hybrid, or whose ML-DSA-87 key is not the registered one", () => {
    assert.deepEqual(verifyAnswer({ tx: tx({ memo: yes, chainVerifiedHybrid: false }), challenge, linkedOwner: OWNER }), {
      ok: false,
      reason: "not-hybrid",
    });
    assert.deepEqual(
      verifyAnswer({ tx: tx({ memo: yes, pqLayerMatchesRegisteredKey: false }), challenge, linkedOwner: OWNER }),
      { ok: false, reason: "pq-key-mismatch" },
    );
  });

  it("refuses failed transactions and anything but a self-send", () => {
    assert.deepEqual(verifyAnswer({ tx: tx({ memo: yes, code: 5 }), challenge, linkedOwner: OWNER }), { ok: false, reason: "tx-failed" });
    assert.deepEqual(verifyAnswer({ tx: tx({ memo: yes, selfSendOnly: false }), challenge, linkedOwner: OWNER }), {
      ok: false,
      reason: "not-self-send",
    });
  });
});

describe("links", () => {
  const token = { token: randomToken(), account: ALICE, createdAtMs: T0, expiresAtMs: T0 + 600_000 };
  const memo = linkMemo(ALICE, token.token);

  it("accepts the owner's link transaction for the issued token", () => {
    assert.deepEqual(verifyLink({ tx: tx({ memo }), token }), { ok: true, value: { owner: OWNER, account: ALICE } });
  });
  it("refuses another token, another account, a used token and a late link", () => {
    assert.deepEqual(verifyLink({ tx: tx({ memo: linkMemo(ALICE, randomToken()) }), token }), { ok: false, reason: "wrong-token" });
    assert.deepEqual(verifyLink({ tx: tx({ memo: linkMemo(BOB, token.token) }), token }), { ok: false, reason: "wrong-account" });
    assert.deepEqual(verifyLink({ tx: tx({ memo }), token: { ...token, usedTx: "X" } }), { ok: false, reason: "already-used" });
    assert.deepEqual(verifyLink({ tx: tx({ memo, timeMs: token.expiresAtMs + 1 }), token }), { ok: false, reason: "expired" });
  });
});

describe("cancel a pending change", () => {
  it("only the currently linked key can cancel, and not with an old transaction", () => {
    const base = { account: ALICE, linkedOwner: OWNER, changeRequestedAtMs: T0 };
    assert.deepEqual(verifyCancel({ ...base, tx: tx({ memo: cancelMemo(ALICE) }) }), { ok: true, value: ALICE });
    assert.deepEqual(verifyCancel({ ...base, tx: tx({ memo: cancelMemo(ALICE), signer: OTHER_KEY }) }), {
      ok: false,
      reason: "wrong-signer",
    });
    assert.deepEqual(verifyCancel({ ...base, tx: tx({ memo: cancelMemo(ALICE), timeMs: T0 - 3_600_000 }) }), {
      ok: false,
      reason: "before-challenge",
    });
    assert.deepEqual(verifyCancel({ ...base, tx: tx({ memo: cancelMemo(BOB) }) }), { ok: false, reason: "wrong-account" });
  });
});
