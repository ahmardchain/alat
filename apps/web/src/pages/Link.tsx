import { useEffect, useState } from "react";
import { ConnectCard, ErrorCard, PendingBanner, Tx, useQorexAccount } from "../components.js";
import { pqcKeyRegistered } from "../lib/chain.js";
import { api, short, when, type LinkResult, type LinkTokenInfo } from "../lib/api.js";
import { sendMemoTx } from "../lib/qorex.js";

export function Link() {
  const token = new URLSearchParams(window.location.search).get("t") ?? "";
  const [info, setInfo] = useState<LinkTokenInfo>();
  const [loadError, setLoadError] = useState<string>();
  const q = useQorexAccount();
  const [pqc, setPqc] = useState<boolean>();
  const [busy, setBusy] = useState<string>();
  const [result, setResult] = useState<LinkResult>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!token) return setLoadError("This page needs the one-time link the Alat bot sent you. Send /link to the bot.");
    api.linkInfo(token).then(setInfo, (e: Error) => setLoadError(e.message === "not-found" ? "This link is not valid." : e.message));
  }, [token]);

  useEffect(() => {
    if (q.address) void pqcKeyRegistered(q.address).then(setPqc);
  }, [q.address]);

  async function link() {
    if (!q.address || !info) return;
    setError(undefined);
    try {
      setBusy("Approve in QoreX…");
      const sent = await sendMemoTx(q.address, info.memo);
      if (sent.code !== 0) throw new Error(`QoreX: the transaction was refused (code ${sent.code}).`);
      setBusy("Checking the transaction on chain and writing the link…");
      setResult(await api.submitLink(token, sent.txHash));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  }

  const who = info?.username ? `@${info.username}` : "your Telegram account";

  if (loadError) return <ErrorCard error={loadError} />;
  if (!info) return <p className="muted">Loading…</p>;

  return (
    <>
      <h1>Link {who} to your QoreChain key</h1>
      <p className="lede">
        After this, when someone gets a money request "from you", only your QoreX key can confirm it. A hacker who takes
        over your chat account won't have it.
      </p>

      {info.pending && <PendingBanner p={info.pending} />}

      {result ? (
        <section className={`card verdict ${result.kind === "change-pending" ? "wait" : "go"}`} data-testid="link-result">
          {result.kind === "linked" && (
            <>
              <h2>Linked.</h2>
              <p>Your friends can now check messages from you. Keep your QoreX key off the phone you chat on, if you can.</p>
            </>
          )}
          {result.kind === "already-linked" && <h2>Already linked to this key. Nothing changed.</h2>}
          {result.kind === "change-pending" && (
            <>
              <h2>Change requested. It waits 7 days.</h2>
              <p>
                This account is already linked to a different key. The new key takes over on{" "}
                <b>{when(result.unlockAtMs ?? 0)}</b> unless the current key cancels it. Every check shows a warning until
                then.
              </p>
            </>
          )}
          <dl className="kv">
            <dt>Key</dt>
            <dd>
              <code>{result.owner}</code>
            </dd>
            <dt>Signed tx</dt>
            <dd>
              <Tx hash={result.nativeTx} />
            </dd>
            {result.evmTx && (
              <>
                <dt>Registry tx</dt>
                <dd>
                  <code>{result.evmTx}</code>
                </dd>
              </>
            )}
          </dl>
        </section>
      ) : info.state !== "open" ? (
        <ErrorCard
          error={info.state === "used" ? `This link was already used (${info.result}).` : "This link expired. Send /link to the bot for a new one."}
        />
      ) : (
        <>
          <ConnectCard q={q} why="Use the QoreX account you want to answer for this chat account." />
          {q.address && (
            <section className="card">
              <h2>Sign the link</h2>
              <dl className="kv" style={{ marginBottom: 16 }}>
                <dt>Account id</dt>
                <dd>
                  <code>{short(info.account, 10)}</code> <span className="muted small">(salted hash, not your Telegram id)</span>
                </dd>
                <dt>Key</dt>
                <dd>
                  <code>{q.address}</code>
                </dd>
                <dt>ML-DSA-87</dt>
                <dd>{pqc === undefined ? "…" : pqc ? "registered" : "not registered yet: QoreX registers it in the same approval"}</dd>
                <dt>Link expires</dt>
                <dd>{when(info.expiresAtMs)}</dd>
              </dl>
              {info.link && (
                <p className="small">
                  This account is already linked to <code>{short(info.link.owner)}</code>. Linking a different key starts a
                  7-day wait the current key can cancel.
                </p>
              )}
              <p className="muted small">QoreX will ask you to approve a 1 uqor transfer to yourself with the memo:</p>
              <p>
                <code>{info.memo}</code>
              </p>
              <button type="button" onClick={link} disabled={!!busy}>
                {busy ?? "Sign and link"}
              </button>
            </section>
          )}
        </>
      )}
      <ErrorCard error={error} />
    </>
  );
}
