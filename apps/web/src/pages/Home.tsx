import { useEffect, useState } from "react";
import { Mark } from "../Logo.js";
import { Workflow } from "../Workflow.js";

interface Stats {
  registry: { linkedAccounts: number; totalWrites: number };
  real: { checks: number; confirmed: number; denied: number; expired: number };
  demo: { checks: number; confirmed: number; denied: number; expired: number };
  refused: number;
  transactions: number;
}

/** The hero: a chat on a phone, the scam message, and the check turning red. A looping illustration, labelled as one. */
function ChatIllustration() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setStep((s) => (s + 1) % 4), 1700);
    return () => clearInterval(i);
  }, []);
  return (
    <figure className="phone" aria-label="Illustration: a scam message, then Alat's check turning red">
      <div className="phone-top">
        <span className="dot" /> Maya
      </div>
      <div className={`bubble in ${step >= 0 ? "show" : ""}`}>Hi, it's me. I'm stuck abroad and my card is blocked. Can you send 200 urgently?</div>
      <div className={`bubble out ${step >= 1 ? "show" : ""}`}>Checking with Alat first.</div>
      <div className={`mini-verdict ${step >= 2 ? "show" : ""} ${step >= 3 ? "stop" : "wait"}`}>
        {step >= 3 ? (
          <>
            <b>❌ The owner says this is NOT them.</b>
            <span>Don't send money. Answered with Maya's key, outside the chat.</span>
          </>
        ) : (
          <>
            <b>⏳ Waiting for the owner.</b>
            <span>Do not send money until this turns green.</span>
          </>
        )}
      </div>
      <figcaption>Illustration</figcaption>
    </figure>
  );
}

export function Home() {
  const [stats, setStats] = useState<Stats>();
  const [bot, setBot] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/stats").then((r) => r.json()).then(setStats, () => undefined);
    fetch("/api/info").then((r) => r.json()).then((i: { bot: string | null }) => setBot(i.bot), () => undefined);
  }, []);
  const n = (v: number | undefined) => (v === undefined ? "…" : v);

  return (
    <>
      <section className="hero">
        <div>
          <h1 style={{ marginTop: 24 }}>
            A hacked account can copy your words.
            <br />
            It can't copy your key.
          </h1>
          <p className="lede">
            When a friend's account asks you for money, Alat asks the only thing a hacker doesn't have: their QoreChain key. Green,
            send. Red, don't.
          </p>
          <div className="row">
            <a className="button" href="/demo">
              Watch it catch a hacker
            </a>
            <a className="button secondary" href="/start">
              Get started
            </a>
          </div>
          <p className="small muted" style={{ marginTop: 14 }}>
            Two minutes, no wallet needed. Every step is a real transaction on the QoreChain testnet.
            {bot && (
              <>
                {" "}
                Or open the bot: <a href={bot}>@{bot.replace(/^https:\/\/t\.me\//, "")}</a>.
              </>
            )}
          </p>
        </div>
        <ChatIllustration />
      </section>

      <section style={{ marginTop: 64 }}>
        <h2>The scam it stops</h2>
        <p className="muted" style={{ maxWidth: 640 }}>
          Someone takes over a Telegram account and messages every friend: <i>“I'm stuck, please send money.”</i> It works
          because the hacker has the name, the photo and the whole chat history. Friends have no way to check.
        </p>
      </section>

      <section style={{ marginTop: 40 }}>
        <h2>How it works, step by step</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Four lanes: the chat, Alat, the owner's QoreX wallet, and the QoreChain testnet. Click through each part.
        </p>
        <Workflow />
      </section>

      <section style={{ marginTop: 40 }} className="two">
        <div className="card">
          <h3>Why a hacker can't fake it</h3>
          <ul className="small muted tight">
            <li>Only a signature from the linked key counts. Chat messages count for nothing.</li>
            <li>Re-linking the account to a new key waits 7 days on chain, shows a warning on every check, and the real key can cancel it.</li>
            <li>Old answers can't be replayed, and an answer for one account can't be used for another.</li>
          </ul>
        </div>
        <div className="card">
          <h3>Why post-quantum</h3>
          <p className="small muted">
            Your key is a long-lived identity. Every answer is signed twice, with secp256k1 and with ML-DSA-87 (NIST FIPS 204).
            The chain checks both, and Alat re-checks the post-quantum signature against the key registered on chain.
          </p>
        </div>
      </section>

      <section style={{ marginTop: 40 }}>
        <h2>Live on the testnet</h2>
        <div className="strip">
          <div>
            <b className="mono">{n(stats?.registry.linkedAccounts)}</b>
            <span>accounts linked on chain</span>
          </div>
          <div>
            <b className="mono">{n(stats && stats.real.checks + stats.demo.checks)}</b>
            <span>checks run</span>
          </div>
          <div>
            <b className="mono">{n(stats?.refused)}</b>
            <span>forged answers refused</span>
          </div>
          <div>
            <b className="mono">{n(stats?.transactions)}</b>
            <span>testnet transactions</span>
          </div>
        </div>
        <p className="small muted">
          Read live from the registry contract and Alat's records. Details on the <a href="/demo">demo</a> and <a href="/status">status</a>{" "}
          pages.
        </p>
      </section>

      <section className="card closing" style={{ marginTop: 48 }}>
        <Mark size={36} />
        <div>
          <h3 style={{ margin: 0 }}>Ask the key, not the chat.</h3>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            Built for Build Before Q-Day, QoreChain Developer Fest · Quantum Pass. Open source (MIT).
          </p>
        </div>
        <a className="button" href="/demo">
          Try the demo
        </a>
      </section>
    </>
  );
}
