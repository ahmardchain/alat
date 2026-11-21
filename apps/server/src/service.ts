/**
 * Alat's rules, wired to storage, the chain and the chat. Kept free of HTTP and
 * Telegram specifics so the refusal tests can drive it directly.
 */
import {
  LINK_TTL_MS,
  answerMemo,
  cancelMemo,
  REFUSAL_TEXT,
  accountHash,
  createChallenge,
  effectiveStatus,
  isToken,
  linkMemo,
  parseMemo,
  randomToken,
  verifyAnswer,
  verifyCancel,
  verifyLink,
  type Hex32,
  type ObservedTx,
  type Refusal,
  type VerdictKind,
} from "@alat/core";
import type { CheckRow, Db } from "./db.ts";
import type { LinkInfo, PendingInfo } from "./chain.ts";

export interface ChainPort {
  linkOf(account: Hex32): Promise<LinkInfo | undefined>;
  pendingOf(account: Hex32): Promise<PendingInfo | undefined>;
  link(account: Hex32, owner: string, nativeTx: string): Promise<{ evmTx: string }>;
  requestChange(account: Hex32, newOwner: string | null, nativeTx: string): Promise<{ evmTx: string }>;
  cancelChange(account: Hex32, nativeTx: string): Promise<{ evmTx: string }>;
  observe(hash: string): Promise<ObservedTx | undefined>;
}

export interface Notifier {
  /** Update the friend's message for this check (Telegram: edit in place). */
  checkChanged(check: CheckRow, view: CheckView): Promise<void>;
  /** Tell the account owner something in their own chat, when Alat knows it. */
  toOwner(chatId: string, text: string, url?: string): Promise<void>;
}

export interface CheckView {
  id: string;
  verdict: VerdictKind;
  account: Hex32;
  createdAtMs: number;
  expiresAtMs: number;
  answerTx: string | null;
  link: LinkInfo | null;
  pending: PendingInfo | null;
  demo: boolean;
}

export class AlatError extends Error {
  constructor(
    readonly code: Refusal | "not-found" | "not-yet-on-chain" | "bad-request" | "not-linked",
    message?: string,
  ) {
    super(message ?? (code in REFUSAL_TEXT ? REFUSAL_TEXT[code as Refusal] : code));
  }
}

export interface Options {
  salt: string;
  publicUrl: string;
  now?: () => number;
  /** How long to wait for a submitted hash to appear on chain. */
  observeAttempts?: number;
  observeDelayMs?: number;
}

const VERDICT_OF: Record<CheckRow["status"], VerdictKind> = {
  pending: "waiting",
  confirmed: "confirmed",
  denied: "denied",
  expired: "expired",
};

export class Alat {
  private readonly now: () => number;

  constructor(
    readonly db: Db,
    readonly chain: ChainPort,
    readonly notifier: Notifier,
    readonly opts: Options,
  ) {
    this.now = opts.now ?? Date.now;
  }

  /** Record a refused transaction (shown on /judge) and return the error to throw. */
  private async refused(reason: Refusal, tx: string, purpose: string, demo: boolean): Promise<AlatError> {
    await this.db.logRefusal(reason, tx, purpose, demo);
    return new AlatError(reason);
  }

  accountFor(platform: "telegram" | "demo", userId: string | number): Hex32 {
    return accountHash(this.opts.salt, platform, userId);
  }

  /** Remember who is behind an account hash so `/check @username` can find it. */
  async remember(platform: "telegram" | "demo", userId: string | number, username: string | null, chatId: string | null): Promise<Hex32> {
    const account = this.accountFor(platform, userId);
    await this.db.rememberAccount({ account, platform, userId: String(userId), username, chatId });
    return account;
  }

  // ------------------------------------------------------------- link

  async issueLinkToken(u: { platform: "telegram" | "demo"; userId: string | number; username: string | null; chatId: string | null }) {
    const account = await this.remember(u.platform, u.userId, u.username, u.chatId);
    const t = this.now();
    const token = randomToken();
    await this.db.insertLinkToken({
      token,
      account,
      platform: u.platform,
      userId: String(u.userId),
      username: u.username,
      chatId: u.chatId,
      createdAtMs: t,
      expiresAtMs: t + LINK_TTL_MS,
      usedTx: null,
      result: null,
    });
    return { token, account, url: `${this.opts.publicUrl}/link?t=${token}`, expiresAtMs: t + LINK_TTL_MS };
  }

  async linkInfo(token: string) {
    if (!isToken(token)) throw new AlatError("bad-request");
    const t = await this.db.linkToken(token);
    if (!t) throw new AlatError("not-found");
    const [link, pending] = await Promise.all([this.chain.linkOf(t.account), this.chain.pendingOf(t.account)]);
    return {
      account: t.account,
      username: t.username,
      expiresAtMs: t.expiresAtMs,
      state: t.usedTx ? "used" : this.now() > t.expiresAtMs ? "expired" : "open",
      result: t.result,
      usedTx: t.usedTx,
      memo: linkMemo(t.account, t.token),
      link: link ?? null,
      pending: pending ?? null,
    };
  }

  private async observe(hash: string): Promise<ObservedTx> {
    const attempts = this.opts.observeAttempts ?? 20;
    for (let i = 0; i < attempts; i++) {
      const tx = await this.chain.observe(hash);
      if (tx) return tx;
      await new Promise((r) => setTimeout(r, this.opts.observeDelayMs ?? 1500));
    }
    throw new AlatError("not-yet-on-chain", "The transaction is not on chain yet. Try again in a few seconds.");
  }

  async submitLink(token: string, txHash: string) {
    if (!isToken(token)) throw new AlatError("bad-request");
    const t = await this.db.linkToken(token);
    if (!t) throw new AlatError("not-found");
    const tx = await this.observe(txHash);
    const v = verifyLink({
      tx,
      token: { token: t.token, account: t.account, createdAtMs: t.createdAtMs, expiresAtMs: t.expiresAtMs, usedTx: t.usedTx ?? undefined },
      usedHashes: await this.db.usedTxs(),
    });
    if (!v.ok) throw await this.refused(v.reason, tx.hash, "link", t.platform === "demo");
    if (!(await this.db.useTx(tx.hash, "link"))) throw await this.refused("already-used", tx.hash, "link", t.platform === "demo");

    let result: { kind: "linked" | "already-linked" | "change-pending"; evmTx?: string; unlockAtMs?: number };
    try {
      const current = await this.chain.linkOf(t.account);
      if (!current) {
        const w = await this.chain.link(t.account, tx.signer, tx.hash);
        result = { kind: "linked", evmTx: w.evmTx };
      } else if (current.owner === tx.signer) {
        result = { kind: "already-linked" };
      } else {
        // A new key from the chat account alone: the contract makes it wait 7 days.
        const w = await this.chain.requestChange(t.account, tx.signer, tx.hash);
        const p = await this.chain.pendingOf(t.account);
        result = { kind: "change-pending", evmTx: w.evmTx, unlockAtMs: p?.unlockAtMs };
      }
    } catch (e) {
      await this.db.releaseTx(tx.hash);
      throw e;
    }
    await this.db.markLinkTokenUsed(token, tx.hash, result.kind);
    if (t.chatId) {
      const text =
        result.kind === "linked"
          ? "Linked. Your friends can now check messages from you. Keep your QoreX key off this phone if you can."
          : result.kind === "already-linked"
            ? "This account was already linked to that key. Nothing changed."
            : `A link to a NEW key was requested. It takes effect on ${new Date(result.unlockAtMs ?? 0).toUTCString()} unless the current key cancels it. If this wasn't you, open Alat and cancel it with your current key.`;
      await this.notifier.toOwner(t.chatId, text, `${this.opts.publicUrl}/respond`).catch(() => undefined);
    }
    return { ...result, nativeTx: tx.hash, owner: tx.signer, account: t.account };
  }

  // ------------------------------------------------------------ check

  async startCheck(args: { account: Hex32; friendChatId: string | null; requestText?: string; demo?: boolean; ttlMs?: number }) {
    const [link, pending] = await Promise.all([this.chain.linkOf(args.account), this.chain.pendingOf(args.account)]);
    if (!link) return { notLinked: true as const };
    const c = createChallenge(args.account, this.now(), args.requestText, args.ttlMs);
    const row: CheckRow = {
      ...c,
      requestText: args.requestText?.slice(0, 500) ?? null,
      friendChatId: args.friendChatId,
      friendMessageId: null,
      demo: args.demo ?? false,
    };
    await this.db.insertCheck(row);
    const owner = await this.db.account(args.account);
    if (owner?.chatId && !row.demo) {
      await this.notifier
        .toOwner(owner.chatId, "Someone is checking a message sent from your account. Answer with your QoreX key, not from this chat.", `${this.opts.publicUrl}/respond`)
        .catch(() => undefined);
    }
    return { notLinked: false as const, check: row, view: this.view(row, link, pending) };
  }

  private view(c: CheckRow, link: LinkInfo | undefined, pending: PendingInfo | undefined): CheckView {
    return {
      id: c.id,
      verdict: VERDICT_OF[effectiveStatus(c, this.now())],
      account: c.account,
      createdAtMs: c.createdAtMs,
      expiresAtMs: c.expiresAtMs,
      answerTx: c.answerTx ?? null,
      link: link ?? null,
      pending: pending ?? null,
      demo: c.demo,
    };
  }

  async checkView(id: string): Promise<CheckView> {
    const c = await this.db.check(id);
    if (!c) throw new AlatError("not-found");
    const [link, pending] = await Promise.all([this.chain.linkOf(c.account), this.chain.pendingOf(c.account)]);
    return this.view(c, link, pending);
  }

  /** Pending checks for the accounts this address owns (owner read from the registry). */
  async pendingFor(address: string) {
    const accounts = await this.db.accountsWithPendingChecks(this.now());
    const out: {
      account: Hex32;
      username: string | null;
      checks: { id: string; requestText: string | null; expiresAtMs: number; createdAtMs: number; memoYes: string; memoNo: string }[];
      pending: PendingInfo | null;
    }[] = [];
    for (const account of accounts) {
      const link = await this.chain.linkOf(account);
      if (link?.owner !== address) continue;
      const pending = await this.chain.pendingOf(account);
      out.push({
        account,
        username: (await this.db.account(account))?.username ?? null,
        pending: pending ?? null,
        checks: (await this.db.pendingChecks(account, this.now())).map((c) => ({
          id: c.id,
          requestText: c.requestText,
          expiresAtMs: c.expiresAtMs,
          createdAtMs: c.createdAtMs,
          memoYes: answerMemo(c.nonce, "yes"),
          memoNo: answerMemo(c.nonce, "no"),
        })),
      });
    }
    return out;
  }

  /** Accounts known to Alat whose link this address owns, with any pending change. */
  async ownedAccounts(address: string) {
    const rows = await this.db.allAccounts();
    const out: { account: Hex32; username: string | null; link: LinkInfo; pending: PendingInfo | null; cancelMemo: string }[] = [];
    for (const r of rows) {
      const link = await this.chain.linkOf(r.account);
      if (link?.owner !== address) continue;
      out.push({
        account: r.account,
        username: r.username,
        link,
        pending: (await this.chain.pendingOf(r.account)) ?? null,
        cancelMemo: cancelMemo(r.account),
      });
    }
    return out;
  }

  async submitAnswer(txHash: string) {
    const tx = await this.observe(txHash);
    const memo = parseMemo(tx.memo);
    if (!memo || memo.kind !== "answer") throw new AlatError("not-alat-memo");
    const c = await this.db.checkByNonce(memo.nonce);
    if (!c) throw new AlatError("wrong-challenge");
    const link = await this.chain.linkOf(c.account);
    const v = verifyAnswer({ tx, challenge: c, linkedOwner: link?.owner, usedHashes: await this.db.usedTxs() });
    if (!v.ok) throw await this.refused(v.reason, tx.hash, "answer", c.demo);
    if (!(await this.db.useTx(tx.hash, "answer"))) throw await this.refused("already-used", tx.hash, "answer", c.demo);
    const status = v.value === "yes" ? "confirmed" : "denied";
    if (!(await this.db.closeCheck(c.id, status, tx.hash, this.now()))) throw new AlatError("challenge-closed");
    const closed = (await this.db.check(c.id))!;
    const view = this.view(closed, link, await this.chain.pendingOf(c.account));
    await this.notifier.checkChanged(closed, view).catch(() => undefined);
    return view;
  }

  async submitCancel(txHash: string) {
    const tx = await this.observe(txHash);
    const memo = parseMemo(tx.memo);
    if (!memo || memo.kind !== "cancel") throw new AlatError("not-alat-memo");
    const [link, pending] = await Promise.all([this.chain.linkOf(memo.account), this.chain.pendingOf(memo.account)]);
    if (!pending) throw new AlatError("bad-request", "There is no pending change to cancel.");
    const v = verifyCancel({
      tx,
      account: memo.account,
      linkedOwner: link?.owner,
      changeRequestedAtMs: pending.requestedAtMs,
      usedHashes: await this.db.usedTxs(),
    });
    if (!v.ok) throw await this.refused(v.reason, tx.hash, "cancel", false);
    if (!(await this.db.useTx(tx.hash, "cancel"))) throw await this.refused("already-used", tx.hash, "cancel", false);
    let w: { evmTx: string };
    try {
      w = await this.chain.cancelChange(memo.account, tx.hash);
    } catch (e) {
      await this.db.releaseTx(tx.hash);
      throw e;
    }
    return { account: memo.account, nativeTx: tx.hash, evmTx: w.evmTx };
  }

  /** Close checks whose time ran out: they stay ❌. */
  async expireDue(): Promise<number> {
    const due = await this.db.dueChecks(this.now());
    for (const c of due) {
      if (!(await this.db.closeCheck(c.id, "expired", null, this.now()))) continue;
      const closed = (await this.db.check(c.id))!;
      const [link, pending] = await Promise.all([this.chain.linkOf(c.account), this.chain.pendingOf(c.account)]);
      await this.notifier.checkChanged(closed, this.view(closed, link, pending)).catch(() => undefined);
    }
    return due.length;
  }
}
