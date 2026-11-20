import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { parseMemo } from "@alat/core";
import { Demo } from "../src/demo.ts";
import { Alat, AlatError } from "../src/service.ts";
import { FakeChain, Inbox, memDb } from "./fakes.ts";

const DEMO_KEY = "qor1psnx8dzwy3trwqg279zzr93l5ksd2ktgnsgp40";
const OTHER_KEY = "qor1md44fjsld8rjzx2r2hhyquw2wldm60a2dqlalk";

let t: number;
let chain: FakeChain;
let demo: Demo;
let alat: Alat;

beforeEach(async () => {
  t = Date.parse("2026-11-20T12:00:00Z");
  chain = new FakeChain(() => t);
  alat = new Alat(await memDb(), chain, new Inbox(), {
    salt: "demo-test-salt-demo-test-salt-demo-test",
    publicUrl: "https://alat.example",
    now: () => t,
    observeAttempts: 1,
    observeDelayMs: 0,
  });
  demo = new Demo(alat, {
    async sign(who, memo) {
      assert.ok(parseMemo(memo), `demo signs only Alat memos, got ${memo}`);
      return chain.sign(who === "demo" ? DEMO_KEY : OTHER_KEY, memo);
    },
    async demoAddress() {
      return DEMO_KEY;
    },
  });
  await demo.setup();
});

describe("judge demo", () => {
  it("links the demo account once, through the normal link path", async () => {
    assert.equal((await chain.linkOf(demo.account))?.owner, DEMO_KEY);
    assert.deepEqual(await demo.setup(), { state: "already-linked" });
  });

  it("hacker scenario: another key is refused, then the owner says not me → ❌", async () => {
    const r = await demo.start("hacker");
    assert.equal(r.notLinked, false);
    if (r.notLinked) return;
    assert.equal(r.view.verdict, "waiting");
    const forged = await demo.forge(r.check.id);
    assert.equal(forged.reason, "wrong-signer");
    assert.equal((await alat.checkView(r.check.id)).verdict, "waiting");
    const v = await demo.answer(r.check.id, "no");
    assert.equal(v.verdict, "denied");
    await assert.rejects(demo.answer(r.check.id, "yes"), (e: unknown) => e instanceof AlatError && e.code === "challenge-closed");
  });

  it("real scenario: the owner says yes → ✅; demo checks are counted apart", async () => {
    const r = await demo.start("real");
    if (r.notLinked) throw new Error("not linked");
    assert.equal((await demo.answer(r.check.id, "yes")).verdict, "confirmed");
    const s = await alat.db.stats();
    assert.equal(s.demo.confirmed, 1);
    assert.equal(s.real.checks, 0);
  });

  it("demo endpoints only act on demo checks", async () => {
    const real = await alat.startCheck({ account: demo.account, friendChatId: null });
    if (real.notLinked) throw new Error("not linked");
    await assert.rejects(demo.answer(real.check.id, "yes"), (e: unknown) => e instanceof AlatError && e.code === "not-found");
  });
});
