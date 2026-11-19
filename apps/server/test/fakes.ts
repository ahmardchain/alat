import { randomBytes } from "node:crypto";
import type { Hex32, ObservedTx } from "@alat/core";
import type { LinkInfo, PendingInfo } from "../src/chain.ts";
import type { ChainPort, CheckView, Notifier } from "../src/service.ts";

export const DAY = 86_400_000;

/** An in-memory registry with AlatRegistry's rules, and a ledger of "on chain" transactions. */
export class FakeChain implements ChainPort {
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

export class Inbox implements Notifier {
  changes: CheckView[] = [];
  owner: string[] = [];
  async checkChanged(_c: unknown, v: CheckView) {
    this.changes.push(v);
  }
  async toOwner(_chat: string, text: string) {
    this.owner.push(text);
  }
}

