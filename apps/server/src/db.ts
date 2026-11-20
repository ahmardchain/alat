/**
 * Alat's own records, in Postgres. The registry contract is the truth for who
 * owns an account; this database holds what the chain doesn't: link tokens,
 * checks, which chat to update, and Telegram ids (never written on chain).
 *
 * Production (Vercel): Neon over HTTP (DATABASE_URL). Tests and local runs:
 * PGlite, Postgres compiled to WebAssembly, in process. Same SQL for both.
 * Every write that must happen once is a single atomic statement.
 */
import type { Challenge, Hex32 } from "@alat/core";

export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

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

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS link_tokens (
    token TEXT PRIMARY KEY, account TEXT NOT NULL, platform TEXT NOT NULL, user_id TEXT NOT NULL,
    username TEXT, chat_id TEXT, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
    used_tx TEXT, result TEXT)`,
  `CREATE TABLE IF NOT EXISTS accounts (
    account TEXT PRIMARY KEY, platform TEXT NOT NULL, user_id TEXT NOT NULL,
    username TEXT, chat_id TEXT, updated_at BIGINT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS accounts_username ON accounts (lower(username))`,
  `CREATE TABLE IF NOT EXISTS checks (
    id TEXT PRIMARY KEY, nonce TEXT UNIQUE NOT NULL, account TEXT NOT NULL, request_hash TEXT,
    request_text TEXT, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, status TEXT NOT NULL,
    answer_tx TEXT, answered_at BIGINT, friend_chat_id TEXT, friend_message_id BIGINT, demo BOOLEAN NOT NULL DEFAULT FALSE)`,
  `CREATE INDEX IF NOT EXISTS checks_account ON checks (account, status)`,
  `CREATE TABLE IF NOT EXISTS used_txs (hash TEXT PRIMARY KEY, purpose TEXT NOT NULL, at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS refusals (
    id BIGSERIAL PRIMARY KEY, reason TEXT NOT NULL, tx TEXT, purpose TEXT NOT NULL, demo BOOLEAN NOT NULL DEFAULT FALSE, at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS chain_writes (
    id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, account TEXT, native_tx TEXT, evm_tx TEXT, at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS leases (name TEXT PRIMARY KEY, holder TEXT, until_ms BIGINT NOT NULL DEFAULT 0)`,
];

/** Neon (production) or PGlite (tests, local). */
export async function connect(databaseUrl: string | undefined, localDir?: string): Promise<Query> {
  if (databaseUrl) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(databaseUrl);
    return async (text, params = []) => (await sql.query(text, params)) as Record<string, unknown>[];
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(localDir);
  return async (text, params = []) => (await pg.query<Record<string, unknown>>(text, params)).rows;
}

const num = (v: unknown) => (v == null ? null : Number(v));
const str = (v: unknown) => (v == null ? null : String(v));

export class Db {
  private ready?: Promise<void>;

  constructor(readonly q: Query) {}

  /** Create the tables once per process (idempotent). */
  init(): Promise<void> {
    this.ready ??= (async () => {
      for (const s of SCHEMA) await this.q(s);
    })();
    return this.ready;
  }

  private async rows(text: string, params: unknown[] = []) {
    await this.init();
    return this.q(text, params);
  }

  private async one(text: string, params: unknown[] = []) {
    return (await this.rows(text, params))[0];
  }

  // ------------------------------------------------------------ accounts

  async rememberAccount(a: AccountRow): Promise<void> {
    await this.rows(
      `INSERT INTO accounts(account, platform, user_id, username, chat_id, updated_at) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT(account) DO UPDATE SET username = excluded.username,
         chat_id = COALESCE(excluded.chat_id, accounts.chat_id), updated_at = excluded.updated_at`,
      [a.account, a.platform, a.userId, a.username, a.chatId, Date.now()],
    );
  }

  async accountByUsername(username: string): Promise<AccountRow | undefined> {
    const r = await this.one(`SELECT * FROM accounts WHERE lower(username) = lower($1) ORDER BY updated_at DESC LIMIT 1`, [
      username.replace(/^@/, ""),
    ]);
    return r && toAccount(r);
  }

  async account(account: string): Promise<AccountRow | undefined> {
    const r = await this.one(`SELECT * FROM accounts WHERE account = $1`, [account]);
    return r && toAccount(r);
  }

  async allAccounts(): Promise<{ account: Hex32; username: string | null }[]> {
    return (await this.rows(`SELECT account, username FROM accounts`)).map((r) => ({ account: r.account as Hex32, username: str(r.username) }));
  }

  // --------------------------------------------------------- link tokens

  async insertLinkToken(t: LinkTokenRow): Promise<void> {
    await this.rows(
      `INSERT INTO link_tokens(token, account, platform, user_id, username, chat_id, created_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [t.token, t.account, t.platform, t.userId, t.username, t.chatId, t.createdAtMs, t.expiresAtMs],
    );
  }

  async linkToken(token: string): Promise<LinkTokenRow | undefined> {
    const r = await this.one(`SELECT * FROM link_tokens WHERE token = $1`, [token]);
    if (!r) return undefined;
    return {
      token: String(r.token),
      account: r.account as Hex32,
      platform: String(r.platform),
      userId: String(r.user_id),
      username: str(r.username),
      chatId: str(r.chat_id),
      createdAtMs: Number(r.created_at),
      expiresAtMs: Number(r.expires_at),
      usedTx: str(r.used_tx),
      result: str(r.result),
    };
  }

  async markLinkTokenUsed(token: string, tx: string, result: string): Promise<void> {
    await this.rows(`UPDATE link_tokens SET used_tx = $1, result = $2 WHERE token = $3`, [tx, result, token]);
  }

  // -------------------------------------------------------------- checks

  async insertCheck(c: CheckRow): Promise<void> {
    await this.rows(
      `INSERT INTO checks(id, nonce, account, request_hash, request_text, created_at, expires_at, status, friend_chat_id, friend_message_id, demo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [c.id, c.nonce, c.account, c.requestHash, c.requestText, c.createdAtMs, c.expiresAtMs, c.status, c.friendChatId, c.friendMessageId, c.demo],
    );
  }

  async check(id: string): Promise<CheckRow | undefined> {
    const r = await this.one(`SELECT * FROM checks WHERE id = $1`, [id]);
    return r && toCheck(r);
  }

  async checkByNonce(nonce: string): Promise<CheckRow | undefined> {
    const r = await this.one(`SELECT * FROM checks WHERE nonce = $1`, [nonce]);
    return r && toCheck(r);
  }

  async pendingChecks(account: string, nowMs: number): Promise<CheckRow[]> {
    return (
      await this.rows(`SELECT * FROM checks WHERE account = $1 AND status = 'pending' AND expires_at >= $2 ORDER BY created_at DESC`, [account, nowMs])
    ).map(toCheck);
  }

  async accountsWithPendingChecks(nowMs: number): Promise<Hex32[]> {
    return (await this.rows(`SELECT DISTINCT account FROM checks WHERE status = 'pending' AND expires_at >= $1`, [nowMs])).map(
      (r) => r.account as Hex32,
    );
  }

  async countPendingDemo(): Promise<number> {
    return Number((await this.one(`SELECT COUNT(*) AS n FROM checks WHERE demo AND status = 'pending'`))!.n);
  }

  async dueChecks(nowMs: number): Promise<CheckRow[]> {
    return (await this.rows(`SELECT * FROM checks WHERE status = 'pending' AND expires_at < $1`, [nowMs])).map(toCheck);
  }

  async setFriendMessage(id: string, chatId: string, messageId: number): Promise<void> {
    await this.rows(`UPDATE checks SET friend_chat_id = $1, friend_message_id = $2 WHERE id = $3`, [chatId, messageId, id]);
  }

  /** Close a check once. Returns false if it was no longer pending. */
  async closeCheck(id: string, status: "confirmed" | "denied" | "expired", answerTx: string | null, atMs: number): Promise<boolean> {
    const r = await this.rows(
      `UPDATE checks SET status = $1, answer_tx = $2, answered_at = $3 WHERE id = $4 AND status = 'pending' RETURNING id`,
      [status, answerTx, atMs, id],
    );
    return r.length === 1;
  }

  // ------------------------------------------------------------ used txs

  async usedTxs(): Promise<Set<string>> {
    return new Set((await this.rows(`SELECT hash FROM used_txs`)).map((r) => String(r.hash)));
  }

  /** Mark a tx used. Returns false when it was already used (atomic). */
  async useTx(hash: string, purpose: string): Promise<boolean> {
    const r = await this.rows(`INSERT INTO used_txs(hash, purpose, at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING hash`, [
      hash.toUpperCase(),
      purpose,
      Date.now(),
    ]);
    return r.length === 1;
  }

  /** Undo useTx when the action it guarded failed, so the owner can retry with the same transaction. */
  async releaseTx(hash: string): Promise<void> {
    await this.rows(`DELETE FROM used_txs WHERE hash = $1`, [hash.toUpperCase()]);
  }

  async logChainWrite(kind: string, account: string | null, nativeTx: string | null, evmTx: string | null): Promise<void> {
    await this.rows(`INSERT INTO chain_writes(kind, account, native_tx, evm_tx, at) VALUES ($1,$2,$3,$4,$5)`, [kind, account, nativeTx, evmTx, Date.now()]);
  }

  async logRefusal(reason: string, tx: string | null, purpose: string, demo: boolean): Promise<void> {
    await this.rows(`INSERT INTO refusals(reason, tx, purpose, demo, at) VALUES ($1,$2,$3,$4,$5)`, [reason, tx, purpose, demo, Date.now()]);
  }

  async recentRefusals(limit = 10): Promise<{ reason: string; tx: string | null; purpose: string; demo: boolean; at: number }[]> {
    return (await this.rows(`SELECT * FROM refusals WHERE tx IS NOT NULL ORDER BY at DESC LIMIT $1`, [limit])).map((r) => ({
      reason: String(r.reason),
      tx: str(r.tx),
      purpose: String(r.purpose),
      demo: Boolean(r.demo),
      at: Number(r.at),
    }));
  }

  // -------------------------------------------------------------- leases

  /**
   * A named lease across every running instance: one holder at a time, until
   * it releases or `ttlMs` passes. Used so only one relayer transaction is in
   * flight (native and EVM transactions share the relayer's nonce).
   */
  async withLease<T>(name: string, ttlMs: number, fn: () => Promise<T>, waitMs = 120_000): Promise<T> {
    const holder = `${process.pid}-${Math.random().toString(36).slice(2)}`;
    await this.rows(`INSERT INTO leases(name) VALUES ($1) ON CONFLICT DO NOTHING`, [name]);
    const start = Date.now();
    for (;;) {
      const got = await this.rows(
        `UPDATE leases SET holder = $1, until_ms = $2 WHERE name = $3 AND (holder IS NULL OR until_ms < $4) RETURNING name`,
        [holder, Date.now() + ttlMs, name, Date.now()],
      );
      if (got.length === 1) break;
      if (Date.now() - start > waitMs) throw new Error(`busy: could not take the ${name} lease`);
      await new Promise((r) => setTimeout(r, 500));
    }
    try {
      return await fn();
    } finally {
      await this.rows(`UPDATE leases SET holder = NULL, until_ms = 0 WHERE name = $1 AND holder = $2`, [name, holder]);
    }
  }

  // --------------------------------------------------------------- stats

  /** Live counts for /judge. Demo checks are counted apart from real ones. */
  async stats() {
    const count = async (demo: boolean) =>
      Object.fromEntries(
        (await this.rows(`SELECT status, COUNT(*) AS n FROM checks WHERE demo = $1 GROUP BY status`, [demo])).map((r) => [String(r.status), Number(r.n)]),
      ) as Record<string, number>;
    const shape = (by: Record<string, number>) => ({
      checks: Object.values(by).reduce((a, b) => a + b, 0),
      confirmed: by.confirmed ?? 0,
      denied: by.denied ?? 0,
      expired: by.expired ?? 0,
      pending: by.pending ?? 0,
    });
    const n = async (q: string) => Number((await this.one(q))!.n);
    return {
      real: shape(await count(false)),
      demo: shape(await count(true)),
      refused: await n(`SELECT COUNT(*) AS n FROM refusals WHERE tx IS NOT NULL`),
      // Distinct testnet transactions Alat sent or verified.
      transactions: await n(`SELECT COUNT(*) AS n FROM (
          SELECT hash AS h FROM used_txs
          UNION SELECT native_tx FROM chain_writes WHERE native_tx IS NOT NULL
          UNION SELECT evm_tx FROM chain_writes WHERE evm_tx IS NOT NULL
          UNION SELECT tx FROM refusals WHERE tx IS NOT NULL) t`),
    };
  }
}

function toAccount(r: Record<string, unknown>): AccountRow {
  return {
    account: r.account as Hex32,
    platform: String(r.platform),
    userId: String(r.user_id),
    username: str(r.username),
    chatId: str(r.chat_id),
  };
}

function toCheck(r: Record<string, unknown>): CheckRow {
  return {
    id: String(r.id),
    nonce: String(r.nonce),
    account: r.account as Hex32,
    requestHash: str(r.request_hash),
    requestText: str(r.request_text),
    createdAtMs: Number(r.created_at),
    expiresAtMs: Number(r.expires_at),
    status: r.status as CheckRow["status"],
    answerTx: str(r.answer_tx) ?? undefined,
    answeredAtMs: num(r.answered_at) ?? undefined,
    friendChatId: str(r.friend_chat_id),
    friendMessageId: num(r.friend_message_id),
    demo: Boolean(r.demo),
  };
}
