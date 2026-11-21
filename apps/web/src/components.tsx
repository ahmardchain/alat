import { useEffect, useState } from "react";
import { PENDING_CHANGE_WARNING, VERDICT } from "@alat/core/copy";
import { IconWarn, VerdictIcon } from "./Icons.js";
import { txJsonUrl, txUrl } from "./lib/chain.js";
import { when, type CheckView, type PendingInfo } from "./lib/api.js";
import { connectQorex, waitForQorex, type QorexState } from "./lib/qorex.js";

/** A native tx hash, in mono, with the explorer and raw JSON next to it. Chain values are always mono. */
export function Tx({ hash, label }: { hash: string; label?: string }) {
  return (
    <span>
      {label && <span className="muted">{label} </span>}
      <code>{hash}</code>{" "}
      <span className="small">
        <a href={txUrl(hash)} target="_blank" rel="noreferrer">
          explorer (select Testnet)
        </a>{" "}
        ·{" "}
        <a href={txJsonUrl(hash)} target="_blank" rel="noreferrer">
          raw
        </a>
      </span>
    </span>
  );
}

export function PendingBanner({ p }: { p: PendingInfo }) {
  return (
    <div className="card verdict wait" role="status">
      <b className="iconline">
        <IconWarn size={18} className="tone-wait-ink" /> {PENDING_CHANGE_WARNING.replace(/^\S+\s*/, "")}
      </b>
      <p className="small" style={{ margin: "8px 0 0" }}>
        Requested {when(p.requestedAtMs)}. Takes effect {when(p.unlockAtMs)} unless the current key cancels it.
      </p>
    </div>
  );
}

export function Countdown({ to }: { to: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const s = Math.max(0, Math.floor((to - now) / 1000));
  return (
    <span className="mono">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

const TONE = { waiting: "wait", confirmed: "go", denied: "stop", expired: "stop", "not-linked": "wait" } as const;

export function Verdict({ v, who }: { v: CheckView; who?: string }) {
  const k = VERDICT[v.verdict];
  return (
    <>
      {v.pending && <PendingBanner p={v.pending} />}
      <section className={`card verdict ${TONE[v.verdict]}`} data-testid="verdict" data-verdict={v.verdict}>
        <p style={{ fontSize: 28, lineHeight: 1.2, margin: "0 0 6px", fontWeight: 600 }}>
          <span className={`iconline ${v.verdict === "waiting" ? "pulse" : ""}`}>
            <VerdictIcon verdict={v.verdict} size={30} />
          </span>{" "}
          {k.title}
        </p>
        <p style={{ margin: "0 0 16px" }}>{k.body}</p>
        <dl className="kv">
          {who && (
            <>
              <dt>Account</dt>
              <dd>{who}</dd>
            </>
          )}
          {v.verdict === "waiting" && (
            <>
              <dt>Expires in</dt>
              <dd>
                <Countdown to={v.expiresAtMs} />
              </dd>
            </>
          )}
          {v.link && (
            <>
              <dt>Linked</dt>
              <dd>{when(v.link.linkedAtMs)}</dd>
              <dt>Link tx</dt>
              <dd>
                <Tx hash={v.link.evidenceTx} />
              </dd>
            </>
          )}
          {v.answerTx && (
            <>
              <dt>Answer tx</dt>
              <dd>
                <Tx hash={v.answerTx} />
              </dd>
            </>
          )}
        </dl>
      </section>
    </>
  );
}

/** Connect QoreX, with the states a person can actually be in. */
export function useQorexAccount() {
  const [state, setState] = useState<QorexState | null>(null);
  const [address, setAddress] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void waitForQorex().then(setState);
  }, []);
  async function connect() {
    setError(undefined);
    try {
      setAddress(await connectQorex());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return { state, address, error, connect };
}

export function ConnectCard({ q, why }: { q: ReturnType<typeof useQorexAccount>; why: string }) {
  return (
    <section className="card">
      <h2>Connect QoreX</h2>
      <p className="muted small">{why}</p>
      {q.state === null && <p className="muted">Looking for QoreX…</p>}
      {q.state?.kind === "missing" && (
        <p>
          QoreX was not found in this browser. Install the QoreX extension, switch it to testnet (tap the version number 7
          times, then <b>Switch to testnet (diana)</b>), and reload.
        </p>
      )}
      {q.state?.kind === "unsupported" && <p>This QoreX build can't send transactions from a website. Update QoreX.</p>}
      {q.state?.kind === "ready" && !q.address && (
        <button type="button" onClick={q.connect}>
          Connect QoreX
        </button>
      )}
      {q.address && (
        <p>
          Connected: <code data-testid="address">{q.address}</code>
        </p>
      )}
      {q.error && <p className="small" style={{ color: "var(--stop)" }}>{q.error}</p>}
    </section>
  );
}

export function ErrorCard({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p className="card verdict stop" role="alert">
      {error}
    </p>
  );
}
