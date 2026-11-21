import { useEffect, useState } from "react";
import { ErrorCard, Tx, Verdict } from "../components.js";
import { api, ApiError, when, type CheckView, type Info } from "../lib/api.js";
import { EXPLORER } from "../lib/chain.js";

const REPO = "https://github.com/ahmardchain/alat/blob/main";

interface Stats {
  registry: { linkedAccounts: number; totalWrites: number };
  real: { checks: number; confirmed: number; denied: number; expired: number };
  demo: { checks: number; confirmed: number; denied: number; expired: number };
  refused: number;
  transactions: number;
  recentRefusals: { reason: string; tx: string | null; purpose: string; demo: boolean; at: number }[];
  readAt: string;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(j.error ?? "server", j.message ?? `HTTP ${res.status}`);
  return j as T;
}

function useLive<T>(load: () => Promise<T>, ms: number) {
  const [v, setV] = useState<T>();
  useEffect(() => {
    let on = true;
    const tick = () => load().then((x) => on && setV(x), () => undefined);
    void tick();
    const i = setInterval(tick, ms);
    return () => {
      on = false;
      clearInterval(i);
    };
  }, []);
  return v;
}

function Num({ n, label }: { n: number | undefined; label: string }) {
  return (
    <div className="card" style={{ margin: 0, padding: 16 }}>
      <div className="mono" style={{ fontSize: 30, fontWeight: 500 }}>
        {n ?? "…"}
      </div>
      <div className="small muted">{label}</div>
    </div>
  );
}

const REFUSALS: [string, string, string][] = [
  ["A signature from a different key", "packages/core/test/verify.test.ts", "refuses a signature from a different key"],
  ["A replayed signature from an older check", "packages/core/test/verify.test.ts", "refuses a replayed signature from an older challenge (nonce)"],
  ["A signature for one account used on another", "packages/core/test/verify.test.ts", "refuses a signature valid for one account used on another"],
  ["Re-link from Telegram alone, without the old key", "contracts/test/AlatRegistry.ts", "stays pending for 7 days and the old owner stays linked"],
  ["Every check during a pending re-link shows the warning", "apps/server/test/service.test.ts", "stays pending 7 days, is flagged on every check, and the old key can cancel it"],
  ["An expired check answered late", "apps/server/test/service.test.ts", "keeps an expired challenge answered late at ❌"],
  ["A transaction the chain did not verify as hybrid", "packages/core/test/observe.live.test.ts", "sees that a classical transaction carries no hybrid layer"],
  ["The same transaction used twice", "apps/server/test/service.test.ts", "refuses a replayed signature from an older challenge"],
];

type Step = { id: string; scenario: "hacker" | "real"; text: string };

export function Demo() {
  const info = useLive(() => api.info() as Promise<Info & { github: string; bot: string | null; video: string | null; firstHybridTx: string; demoUsername: string }>, 60_000);
  const stats = useLive(() => fetch("/api/stats").then((r) => r.json() as Promise<Stats>), 5000);
  const [step, setStep] = useState<Step>();
  const [view, setView] = useState<CheckView>();
  const [busy, setBusy] = useState<string>();
  const [forged, setForged] = useState<{ reason: string; message: string; tx: string }>();
  const [error, setError] = useState<string>();

  // Opened from the bot (/demo in Telegram): ?c=<check id>
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("c");
    if (c && /^[a-z0-9]{12}$/.test(c)) setStep({ id: c, scenario: "hacker", text: "" });
  }, []);

  useEffect(() => {
    if (!step) return;
    let on = true;
    const tick = async () => {
      const v = await api.check(step.id).catch(() => undefined);
      if (on && v) setView(v);
      if (on && (!v || v.verdict === "waiting")) setTimeout(tick, 2500);
    };
    void tick();
    return () => {
      on = false;
    };
  }, [step?.id]);

  async function run<T>(key: string, fn: () => Promise<T>) {
    setError(undefined);
    setBusy(key);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  }

  const start = (scenario: "hacker" | "real") =>
    run(`start-${scenario}`, async () => {
      setForged(undefined);
      setView(undefined);
      const demo = (await fetch("/api/demo").then((r) => r.json())) as { scenarios: Record<string, string> };
      const r = await post<{ id: string; view: CheckView }>("/api/demo/check", { scenario });
      setStep({ id: r.id, scenario, text: demo.scenarios[scenario]! });
      setView(r.view);
    });

  const answer = (a: "yes" | "no") => run(`answer-${a}`, async () => setView(await post<CheckView>(`/api/demo/${step!.id}/answer`, { answer: a })));
  const forge = () => run("forge", async () => setForged(await post(`/api/demo/${step!.id}/forge`)));

  const waiting = view?.verdict === "waiting";

  return (
    <>
      <h1>Watch Alat catch a hacker</h1>
      <p className="lede">
        A hacked account asks you for money. Only the owner's QoreChain key can confirm it. Two minutes, no wallet
        needed, every step a real testnet transaction.
      </p>

      <p className="small muted">
        @alat_demo is a demo chat account linked to a key the Alat server holds for this demo. Answers are still hybrid-signed
        (secp256k1 + ML-DSA-87) and checked like any owner's.
        {info?.bot && (
          <>
            {" "}
            Prefer Telegram? Open <a href={`${info.bot}?start=demo`}>the bot</a> and send /demo.
          </>
        )}
      </p>

      <section className="card">
        <h2>1. A hacker messages you from @alat_demo</h2>
        <div className="row">
          <button type="button" onClick={() => start("hacker")} disabled={!!busy}>
            {busy === "start-hacker" ? "Starting…" : "Get the hacker's message"}
          </button>
        </div>
      </section>

      {step && (
        <>
          {step.text && (
            <p className="card" style={{ fontSize: 18, borderRadius: "16px 16px 16px 4px", maxWidth: 520 }}>
              <span className="small muted">@alat_demo</span>
              <br />
              {step.text}
            </p>
          )}
          {view && <Verdict v={view} who="@alat_demo" />}

          {waiting && step.scenario === "hacker" && (
            <section className="card">
              <h2>2. The hacker tries to answer</h2>
              <p className="muted small">
                They control the chat account, so they try to confirm with their own QoreChain key. (Stand-in: Alat's relayer account, a
                real account with a registered ML-DSA-87 key that isn't linked to @alat_demo.)
              </p>
              <button type="button" className="secondary" onClick={forge} disabled={!!busy || !!forged}>
                {busy === "forge" ? "Signing on testnet…" : "Answer “yes” with the hacker's key"}
              </button>
              {forged && (
                <p className="card verdict stop" style={{ marginTop: 12 }} data-testid="forged">
                  Refused: {forged.message} <br />
                  <Tx hash={forged.tx} label="Their transaction:" />
                </p>
              )}
            </section>
          )}

          {waiting && (
            <section className="card">
              <h2>{step.scenario === "hacker" ? "3." : "2."} The real owner answers, from their key</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <button type="button" onClick={() => answer("yes")} disabled={!!busy}>
                  {busy === "answer-yes" ? "Signing…" : "Yes, that's me"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  style={{ borderColor: "var(--stop)", color: "var(--stop)" }}
                  onClick={() => answer("no")}
                  disabled={!!busy}
                >
                  {busy === "answer-no" ? "Signing…" : "No, that's not me"}
                </button>
              </div>
            </section>
          )}

          {view && !waiting && (
            <section className="card">
              <p style={{ marginTop: 0 }}>
                {view.verdict === "denied"
                  ? "That's the hacker caught. Now see a real request:"
                  : "Run it again, or try the other scenario:"}
              </p>
              <div className="row">
                <button type="button" onClick={() => start("real")} disabled={!!busy}>
                  {busy === "start-real" ? "Starting…" : "A real request from the owner"}
                </button>
                <button type="button" className="secondary" onClick={() => start("hacker")} disabled={!!busy}>
                  Hacker scenario again
                </button>
              </div>
            </section>
          )}
        </>
      )}
      <ErrorCard error={error} />

      <h2 style={{ marginTop: 40 }}>Live on the testnet</h2>
      <p className="small muted">
        From AlatRegistry on the testnet and Alat's own records{stats ? `, read ${when(Date.parse(stats.readAt))}` : ""}. Demo checks are counted
        apart.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 16 }} data-testid="stats">
        <Num n={stats?.registry.linkedAccounts} label="accounts linked (on chain)" />
        <Num n={stats && stats.real.checks + stats.demo.checks} label={`checks run (${stats?.demo.checks ?? "…"} demo)`} />
        <Num n={stats && stats.real.confirmed + stats.demo.confirmed} label="✅ confirmed by the owner" />
        <Num n={stats && stats.real.denied + stats.demo.denied + stats.real.expired + stats.demo.expired} label="❌ not me, or expired" />
        <Num n={stats?.refused} label="transactions refused" />
        <Num n={stats?.transactions} label="testnet transactions sent or verified" />
      </div>

      <h2 style={{ marginTop: 40 }}>Links</h2>
      <section className="card">
        <dl className="kv">
          <dt>Registry contract</dt>
          <dd>
            {info ? (
              <>
                <code>{info.registry}</code>{" "}
                <a className="small" href={`${EXPLORER}/address/${info.registry}`} target="_blank" rel="noreferrer">
                  explorer (select Testnet)
                </a>
              </>
            ) : (
              "…"
            )}
          </dd>
          <dt>Hybrid-signed tx</dt>
          <dd>{info ? <Tx hash={info.firstHybridTx} /> : "…"}</dd>
          <dt>Demo binding tx</dt>
          <dd>{view?.link ? <Tx hash={view.link.evidenceTx} /> : <span className="muted">shown once you start the demo</span>}</dd>
          <dt>Relayer</dt>
          <dd>{info ? <code>{info.relayer.native}</code> : "…"}</dd>
          <dt>Source</dt>
          <dd>
            <a href={info?.github ?? "https://github.com/ahmardchain/alat"}>GitHub</a> · <a href="/status">Status</a>
          </dd>
          <dt>Video</dt>
          <dd>{info?.video ? <a href={info.video}>Watch (under 3 minutes)</a> : <span className="muted">not published yet</span>}</dd>
        </dl>
      </section>

      <h2 style={{ marginTop: 40 }}>What Alat refuses</h2>
      <section className="card" style={{ overflowX: "auto" }}>
        <table className="small" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 8px 6px 0" }}>Refused</th>
              <th style={{ textAlign: "left", padding: 6 }}>Test</th>
            </tr>
          </thead>
          <tbody>
            {REFUSALS.map(([what, file, name]) => (
              <tr key={name} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "8px 8px 8px 0", verticalAlign: "top" }}>{what}</td>
                <td style={{ padding: 8 }}>
                  <a href={`${REPO}/${file}`}>
                    <code>{file}</code>
                  </a>
                  <br />
                  <span className="muted">“{name}”</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {stats && stats.recentRefusals.length > 0 && (
          <>
            <p className="small" style={{ marginBottom: 4 }}>
              Latest refusals on the testnet:
            </p>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {stats.recentRefusals.map((r) => (
                <li key={`${r.tx}-${r.at}`}>
                  <code>{r.reason}</code> ({r.purpose}
                  {r.demo ? ", demo" : ""}) <code>{r.tx}</code>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <h2 style={{ marginTop: 40 }}>Limits</h2>
      <section className="card small">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Telegram only. WhatsApp and Instagram are not built.</li>
          <li>
            QoreX can't sign messages yet, so owners answer with a 1 uqor self-transfer whose memo carries the answer. Each answer
            costs a testnet fee and one block.
          </li>
          <li>
            QoreX can't sign EVM transactions yet, so Alat's relayer writes the registry. The contract enforces the 7-day wait and
            the ML-DSA-87 key check itself; the relayer is trusted to submit only consents and cancels it verified, and each write
            stores the transaction it is based on.
          </li>
          <li>
            <code>/check @username</code> only finds people who have written to the bot. Forwarding the message is stronger, unless
            the sender hides forwards.
          </li>
          <li>On the demo account above, the server holds the key. Real owners hold theirs in QoreX.</li>
          <li>Testnet only. No real funds.</li>
        </ul>
      </section>
    </>
  );
}
