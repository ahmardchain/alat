import { useCallback, useEffect, useState } from "react";
import { ConnectCard, Countdown, ErrorCard, PendingBanner, Tx, useQorexAccount } from "../components.js";
import { Mark } from "../Logo.js";
import { api, short, when, type CheckView, type OwnerView } from "../lib/api.js";
import { sendMemoTx } from "../lib/qorex.js";

/**
 * The owner answers here, outside the chat app. It works even when the owner is
 * locked out of Telegram: all it needs is their QoreX key.
 */
export function Respond() {
  const q = useQorexAccount();
  const [view, setView] = useState<OwnerView>();
  const [busy, setBusy] = useState<string>();
  const [done, setDone] = useState<CheckView[]>([]);
  const [cancelled, setCancelled] = useState<string>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (q.address) setView(await api.owner(q.address));
  }, [q.address]);

  useEffect(() => {
    void load();
    const i = setInterval(() => void load().catch(() => undefined), 5000);
    return () => clearInterval(i);
  }, [load]);

  async function act(key: string, memo: string, submit: (hash: string) => Promise<unknown>) {
    if (!q.address) return;
    setError(undefined);
    setBusy(key);
    try {
      const sent = await sendMemoTx(q.address, memo);
      if (sent.code !== 0) throw new Error(`QoreX: the transaction was refused (code ${sent.code}).`);
      await submit(sent.txHash);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  }

  const checks = view?.checks.flatMap((a) => a.checks.map((c) => ({ ...c, who: a.username ? `@${a.username}` : short(a.account) }))) ?? [];

  return (
    <>
      <h1>Answer a check</h1>
      <p className="lede">Someone asked whether a message really came from you. Answer with your key. Nothing you type in a chat counts.</p>

      <ConnectCard q={q} why="Use the QoreX account your chat account is linked to." />

      {view?.accounts.map((a) =>
        a.pending ? (
          <div key={a.account}>
            <PendingBanner p={a.pending} />
            <section className="card">
              <p style={{ marginTop: 0 }}>
                Someone asked to move {a.username ? `@${a.username}` : "your account"} to the key{" "}
                <code>{a.pending.newOwner ?? "(remove the link)"}</code>. If this wasn't you, cancel it now.
              </p>
              <button type="button" disabled={!!busy} onClick={() => act(`cancel-${a.account}`, a.cancelMemo, (h) => api.cancel(h).then((r) => setCancelled(r.nativeTx)))}>
                {busy === `cancel-${a.account}` ? "Approve in QoreX…" : "Cancel this change"}
              </button>
            </section>
          </div>
        ) : null,
      )}
      {cancelled && (
        <p className="card verdict go">
          Change cancelled. <Tx hash={cancelled} />
        </p>
      )}

      {q.address && view && (
        <>
          {checks.length === 0 ? (
            <section className="card" data-testid="empty" style={{ textAlign: "center" }}>
              <Mark size={40} />
              <p>No checks waiting.</p>
              {view.accounts.length === 0 && (
                <p className="muted small">This key isn't linked to any chat account yet. Send /link to the Alat bot.</p>
              )}
            </section>
          ) : (
            checks.map((c) => (
              <section key={c.id} className="card verdict wait" data-testid="pending-check">
                <p style={{ marginTop: 0 }}>
                  Someone asked if <b>{c.who}</b> sent this, at {when(c.createdAtMs)}:
                </p>
                <blockquote style={{ margin: "0 0 12px", fontSize: 18 }}>{c.requestText ? `“${c.requestText}”` : <i className="muted">(no text given)</i>}</blockquote>
                <p className="small muted">
                  Time left: <Countdown to={c.expiresAtMs} />
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <button type="button" disabled={!!busy} onClick={() => act(c.id, c.memoYes, (h) => api.answer(h).then((v) => setDone((d) => [...d, v])))}>
                    {busy === c.id ? "Approve in QoreX…" : "Yes, that's me"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    style={{ borderColor: "var(--stop)", color: "var(--stop)" }}
                    disabled={!!busy}
                    onClick={() => act(c.id, c.memoNo, (h) => api.answer(h).then((v) => setDone((d) => [...d, v])))}
                  >
                    No, that's not me
                  </button>
                </div>
              </section>
            ))
          )}
        </>
      )}

      {done.map((v) => (
        <p key={v.id} className={`card verdict ${v.verdict === "confirmed" ? "go" : "stop"}`} data-testid="answered">
          {v.verdict === "confirmed" ? "Sent: ✅ confirmed." : "Sent: ❌ not you. Your friend is told not to send money."}{" "}
          {v.answerTx && <Tx hash={v.answerTx} />}
        </p>
      ))}
      <ErrorCard error={error} />
    </>
  );
}
