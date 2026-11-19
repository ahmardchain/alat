/**
 * Alat's own records (node:sqlite). The registry contract is the truth for who
 * owns an account; this database holds what the chain doesn't: link tokens,
 * checks, which chat to update, and Telegram ids (never written on chain).
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Challenge, Hex32 } from "@alat/core";

export interface LinkTokenRow {
  token: string;
  account: Hex32;
  platform: string;
  userId: string;
  username: string | null;
  chatId: string | null;
  createdAtMs: number;
  expiresAtMs: number;
  usedTx: string | null;
  result: string | null;
}

export interface AccountRow {
  account: Hex32;
  platform: string;
  userId: string;
  username: string | null;
  chatId: string | null;
}

export interface CheckRow extends Challenge {
  requestText: string | null;
  friendChatId: string | null;
  friendMessageId: number | null;
  demo: boolean;
}

export class Db {
  readonly sql: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.sql = new DatabaseSync(path);
    this.sql.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS link_tokens (
        token TEXT PRIMARY KEY, account TEXT NOT NULL, platform TEXT NOT NULL, user_id TEXT NOT NULL,
        username TEXT, chat_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        used_tx TEXT, result TEXT);
      CREATE TABLE IF NOT EXISTS accounts (
        account TEXT PRIMARY KEY, platform TEXT NOT NULL, user_id TEXT NOT NULL,
        username TEXT, chat_id TEXT, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS accounts_username ON accounts(lower(username));
      CREATE TABLE IF NOT EXISTS checks (
        id TEXT PRIMARY KEY, nonce TEXT UNIQUE NOT NULL, account TEXT NOT NULL, request_hash TEXT,
        request_text TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL,
        answer_tx TEXT, answered_at INTEGER, friend_chat_id TEXT, friend_message_id INTEGER, demo INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS checks_account ON checks(account, status);
      CREATE TABLE IF NOT EXISTS used_txs (hash TEXT PRIMARY KEY, purpose TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS chain_writes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, account TEXT, native_tx TEXT, evm_tx TEXT, at INTEGER NOT NULL);
    `);
  }

  // ------------------------------------------------------------ accounts

  rememberAccount(a: AccountRow): void {
    this.sql
      .prepare(
        `INSERT INTO accounts(account, platform, user_id, username, chat_id, updated_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(account) DO UPDATE SET username=excluded.username, chat_id=COALESCE(excluded.chat_id, accounts.chat_id), updated_at=excluded.updated_at`,
      )
      .run(a.account, a.platform, a.userId, a.username, a.chatId, Date.now());
  }

  accountByUsername(username: string): AccountRow | undefined {
    const r = this.sql
      .prepare(`SELECT * FROM accounts WHERE lower(username) = lower(?) ORDER BY updated_at DESC LIMIT 1`)
      .get(username.replace(/^@/, "")) as Record<string, unknown> | undefined;
    return r && toAccount(r);
  }

  account(account: string): AccountRow | undefined {
    const r = this.sql.prepare(`SELECT * FROM accounts WHERE account = ?`).get(account) as Record<string, unknown> | undefined;
    return r && toAccount(r);
  }

  // --------------------------------------------------------- link tokens

  insertLinkToken(t: LinkTokenRow): void {
    this.sql
      .prepare(
        `INSERT INTO link_tokens(token, account, platform, user_id, username, chat_id, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(t.token, t.account, t.platform, t.userId, t.username, t.chatId, t.createdAtMs, t.expiresAtMs);
  }

  linkToken(token: string): LinkTokenRow | undefined {
    const r = this.sql.prepare(`SELECT * FROM link_tokens WHERE token = ?`).get(token) as Record<string, unknown> | undefined;
    if (!r) return undefined;
    return {
      token: String(r.token),
      account: r.account as Hex32,
      platform: String(r.platform),
      userId: String(r.user_id),
      username: (r.username as string | null) ?? null,
      chatId: (r.chat_id as string | null) ?? null,
      createdAtMs: Number(r.created_at),
      expiresAtMs: Number(r.expires_at),
      usedTx: (r.used_tx as string | null) ?? null,
      result: (r.result as string | null) ?? null,
    };
  }

  markLinkTokenUsed(token: string, tx: string, result: string): void {
    this.sql.prepare(`UPDATE link_tokens SET used_tx = ?, result = ? WHERE token = ?`).run(tx, result, token);
  }

  // -------------------------------------------------------------- checks

  insertCheck(c: CheckRow): void {
    this.sql
      .prepare(
        `INSERT INTO checks(id, nonce, account, request_hash, request_text, created_at, expires_at, status, friend_chat_id, friend_message_id, demo)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        c.id,
        c.nonce,
        c.account,
        c.requestHash,
        c.requestText,
        c.createdAtMs,
        c.expiresAtMs,
        c.status,
        c.friendChatId,
        c.friendMessageId,
        c.demo ? 1 : 0,
      );
  }

  check(id: string): CheckRow | undefined {
    const r = this.sql.prepare(`SELECT * FROM checks WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return r && toCheck(r);
  }

  checkByNonce(nonce: string): CheckRow | undefined {
    const r = this.sql.prepare(`SELECT * FROM checks WHERE nonce = ?`).get(nonce) as Record<string, unknown> | undefined;
    return r && toCheck(r);
  }

  pendingChecks(account: string, nowMs: number): CheckRow[] {
    return (
      this.sql
        .prepare(`SELECT * FROM checks WHERE account = ? AND status = 'pending' AND expires_at >= ? ORDER BY created_at DESC`)
        .all(account, nowMs) as Record<string, unknown>[]
    ).map(toCheck);
  }

  dueChecks(nowMs: number): CheckRow[] {
    return (
      this.sql.prepare(`SELECT * FROM checks WHERE status = 'pending' AND expires_at < ?`).all(nowMs) as Record<string, unknown>[]
    ).map(toCheck);
  }

  setFriendMessage(id: string, chatId: string, messageId: number): void {
    this.sql.prepare(`UPDATE checks SET friend_chat_id = ?, friend_message_id = ? WHERE id = ?`).run(chatId, messageId, id);
  }

  /** Close a check once. Returns false if it was no longer pending. */
  closeCheck(id: string, status: "confirmed" | "denied" | "expired", answerTx: string | null, atMs: number): boolean {
    const r = this.sql
      .prepare(`UPDATE checks SET status = ?, answer_tx = ?, answered_at = ? WHERE id = ? AND status = 'pending'`)
      .run(status, answerTx, atMs, id);
    return Number(r.changes) === 1;
  }

  // ------------------------------------------------------------ used txs

  usedTxs(): Set<string> {
    return new Set((this.sql.prepare(`SELECT hash FROM used_txs`).all() as { hash: string }[]).map((r) => r.hash));
  }

  /** Mark a tx used. Returns false when it was already used (atomic). */
  useTx(hash: string, purpose: string): boolean {
    const r = this.sql.prepare(`INSERT OR IGNORE INTO used_txs(hash, purpose, at) VALUES (?,?,?)`).run(hash.toUpperCase(), purpose, Date.now());
    return Number(r.changes) === 1;
  }

  /** Undo useTx when the action it guarded failed, so the owner can retry with the same transaction. */
  releaseTx(hash: string): void {
    this.sql.prepare(`DELETE FROM used_txs WHERE hash = ?`).run(hash.toUpperCase());
  }

  logChainWrite(kind: string, account: string | null, nativeTx: string | null, evmTx: string | null): void {
    this.sql.prepare(`INSERT INTO chain_writes(kind, account, native_tx, evm_tx, at) VALUES (?,?,?,?,?)`).run(kind, account, nativeTx, evmTx, Date.now());
  }

  // --------------------------------------------------------------- stats

  stats(): { checks: number; confirmed: number; denied: number; expired: number; pending: number } {
    const rows = this.sql.prepare(`SELECT status, COUNT(*) AS n FROM checks WHERE demo = 0 GROUP BY status`).all() as {
      status: string;
      n: number;
    }[];
    const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    const checks = rows.reduce((s, r) => s + Number(r.n), 0);
    return { checks, confirmed: by.confirmed ?? 0, denied: by.denied ?? 0, expired: by.expired ?? 0, pending: by.pending ?? 0 };
  }
}

function toAccount(r: Record<string, unknown>): AccountRow {
  return {
    account: r.account as Hex32,
    platform: String(r.platform),
    userId: String(r.user_id),
    username: (r.username as string | null) ?? null,
    chatId: (r.chat_id as string | null) ?? null,
  };
}

function toCheck(r: Record<string, unknown>): CheckRow {
  return {
    id: String(r.id),
    nonce: String(r.nonce),
    account: r.account as Hex32,
    requestHash: (r.request_hash as string | null) ?? null,
    requestText: (r.request_text as string | null) ?? null,
    createdAtMs: Number(r.created_at),
    expiresAtMs: Number(r.expires_at),
    status: r.status as CheckRow["status"],
    answerTx: (r.answer_tx as string | null) ?? undefined,
    answeredAtMs: r.answered_at == null ? undefined : Number(r.answered_at),
    friendChatId: (r.friend_chat_id as string | null) ?? null,
    friendMessageId: r.friend_message_id == null ? null : Number(r.friend_message_id),
    demo: Number(r.demo) === 1,
  };
}
