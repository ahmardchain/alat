import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { keccak256, toHex, zeroAddress } from "viem";

const DAY = 24n * 60n * 60n;
const acct = keccak256(toHex("alat:test:telegram:1001"));
const other = keccak256(toHex("alat:test:telegram:2002"));
const ev = (s: string) => keccak256(toHex(s));

describe("AlatRegistry", async () => {
  const { viem, networkHelpers } = await network.create();
  const [relayer, owner, newOwner, hacker] = await viem.getWalletClients();

  async function deploy() {
    const keys = await viem.deployContract("MockPqcKeyStatus");
    for (const w of [owner, newOwner, hacker]) await keys.write.set([w.account.address, true, 1, true]);
    const reg = await viem.deployContract("AlatRegistry", [relayer.account.address, keys.address]);
    const asHacker = await viem.getContractAt("AlatRegistry", reg.address, { client: { wallet: hacker } });
    return { keys, reg, asHacker };
  }

  async function linked() {
    const d = await deploy();
    await d.reg.write.link([acct, owner.account.address, ev("link-tx")]);
    return d;
  }

  type Registry = Awaited<ReturnType<typeof deploy>>["reg"];
  const ownerOf = async (reg: Registry, a: `0x${string}` = acct) => (await reg.read.linkOf([a]))[0].toLowerCase();

  describe("first link", () => {
    it("links an account at once and records the evidence transaction", async () => {
      const { reg } = await linked();
      const [o, at, e] = await reg.read.linkOf([acct]);
      assert.equal(o.toLowerCase(), owner.account.address.toLowerCase());
      assert.ok(at > 0n);
      assert.equal(e, ev("link-tx"));
      assert.equal(await reg.read.linkedAccounts(), 1n);
    });

    it("refuses a second link of the same account", async () => {
      const { reg } = await linked();
      await viem.assertions.revertWithCustomError(reg.write.link([acct, hacker.account.address, ev("x")]), reg, "AlreadyLinked");
    });

    it("refuses an owner without a registered ML-DSA-87 key", async () => {
      const { reg, keys } = await deploy();
      await keys.write.set([owner.account.address, false, 0, false]);
      await viem.assertions.revertWithCustomError(reg.write.link([acct, owner.account.address, ev("x")]), reg, "NoPqcKey");
    });

    it("refuses a key registered without proof of possession", async () => {
      const { reg, keys } = await deploy();
      await keys.write.set([owner.account.address, true, 1, false]);
      await viem.assertions.revertWithCustomError(reg.write.link([acct, owner.account.address, ev("x")]), reg, "NoPqcKey");
    });

    it("refuses writes from anyone but the relayer", async () => {
      const { asHacker } = await deploy();
      await viem.assertions.revertWithCustomError(
        asHacker.write.link([acct, hacker.account.address, ev("x")]),
        asHacker,
        "NotRelayer",
      );
    });

    it("refuses a write without evidence", async () => {
      const { reg } = await deploy();
      await viem.assertions.revertWithCustomError(reg.write.link([acct, owner.account.address, `0x${"00".repeat(32)}`]), reg, "NoEvidence");
    });
  });

  describe("re-link without the old key (the hacker case)", () => {
    it("stays pending for 7 days and the old owner stays linked", async () => {
      const { reg } = await linked();
      await reg.write.requestChange([acct, hacker.account.address, ev("tg-only-request")]);
      const [p, , unlockAt] = await reg.read.pendingOf([acct]);
      assert.equal(p.toLowerCase(), hacker.account.address.toLowerCase());
      assert.equal(await ownerOf(reg), owner.account.address.toLowerCase());

      await networkHelpers.time.increase(7n * DAY - 60n);
      await viem.assertions.revertWithCustomError(reg.write.finalizeChange([acct]), reg, "TooEarly");
      assert.equal(await ownerOf(reg), owner.account.address.toLowerCase());
      assert.ok(unlockAt > 0n);
    });

    it("the old owner can cancel it during the wait", async () => {
      const { reg } = await linked();
      await reg.write.requestChange([acct, hacker.account.address, ev("tg-only-request")]);
      await reg.write.cancelChange([acct, ev("owner-cancel-tx")]);
      const [, , unlockAt] = await reg.read.pendingOf([acct]);
      assert.equal(unlockAt, 0n);
      await networkHelpers.time.increase(8n * DAY);
      await viem.assertions.revertWithCustomError(reg.write.finalizeChange([acct]), reg, "NoChangePending");
      assert.equal(await ownerOf(reg), owner.account.address.toLowerCase());
    });

    it("applies after 7 days if nobody cancels, and anyone can finalize", async () => {
      const { reg, asHacker } = await linked();
      await reg.write.requestChange([acct, newOwner.account.address, ev("request")]);
      await networkHelpers.time.increase(7n * DAY);
      await asHacker.write.finalizeChange([acct]);
      assert.equal(await ownerOf(reg), newOwner.account.address.toLowerCase());
    });

    it("refuses a second request while one is pending", async () => {
      const { reg } = await linked();
      await reg.write.requestChange([acct, hacker.account.address, ev("a")]);
      await viem.assertions.revertWithCustomError(reg.write.requestChange([acct, newOwner.account.address, ev("b")]), reg, "ChangePending");
    });

    it("removing a link also waits 7 days", async () => {
      const { reg } = await linked();
      await reg.write.requestChange([acct, zeroAddress, ev("remove")]);
      assert.equal(await ownerOf(reg), owner.account.address.toLowerCase());
      await networkHelpers.time.increase(7n * DAY);
      await reg.write.finalizeChange([acct]);
      assert.equal(await ownerOf(reg), zeroAddress);
      assert.equal(await reg.read.linkedAccounts(), 0n);
    });
  });

  describe("change with the old owner's consent", () => {
    it("moves the link at once and clears any pending request", async () => {
      const { reg } = await linked();
      await reg.write.requestChange([acct, hacker.account.address, ev("hacker")]);
      await reg.write.changeWithConsent([acct, newOwner.account.address, ev("owner-consent-tx")]);
      assert.equal(await ownerOf(reg), newOwner.account.address.toLowerCase());
      const [, , unlockAt] = await reg.read.pendingOf([acct]);
      assert.equal(unlockAt, 0n);
    });

    it("still requires the new owner to have an ML-DSA-87 key", async () => {
      const { reg, keys } = await linked();
      await keys.write.set([newOwner.account.address, false, 0, false]);
      await viem.assertions.revertWithCustomError(
        reg.write.changeWithConsent([acct, newOwner.account.address, ev("c")]),
        reg,
        "NoPqcKey",
      );
    });
  });

  it("keeps accounts separate", async () => {
    const { reg } = await linked();
    assert.equal(await ownerOf(reg, other), zeroAddress);
    await viem.assertions.revertWithCustomError(reg.write.requestChange([other, hacker.account.address, ev("x")]), reg, "NotLinked");
  });
});
