import { useEffect, useRef, useState } from "react";

/**
 * Who does what, where. A sequence diagram with four lanes; each step is an
 * arrow from one lane to another (or a note on one lane).
 */
const LANES = ["Telegram", "Alat", "QoreX wallet", "QoreChain"] as const;
type Lane = 0 | 1 | 2 | 3;
type Tone = "plain" | "go" | "stop" | "wait";
interface Step {
  from: Lane;
  to: Lane;
  text: string;
  detail?: string;
  tone?: Tone;
}

const FLOWS: { id: string; label: string; intro: string; steps: Step[] }[] = [
  {
    id: "link",
    label: "1. Link once",
    intro: "Before anything goes wrong, the owner binds their Telegram account to their QoreChain key.",
    steps: [
      { from: 0, to: 1, text: "Owner sends /link to @alatAppbot", detail: "The bot sees the real Telegram id. No screenshots, no codes." },
      { from: 1, to: 0, text: "Bot replies with a one-time link", detail: "Works for 10 minutes, only for this Telegram account." },
      { from: 1, to: 2, text: "Owner opens it and connects QoreX" },
      { from: 2, to: 3, text: "QoreX signs and sends a 1 uqor self-transfer", detail: "Signed twice: secp256k1 + ML-DSA-87. The memo names this link." },
      { from: 3, to: 1, text: "Alat reads it from the chain and checks both signatures" },
      { from: 1, to: 3, text: "AlatRegistry records: hash(Telegram id) → owner's key", detail: "A salted hash. The Telegram id and username never go on chain.", tone: "go" },
    ],
  },
  {
    id: "check",
    label: "2. A friend checks",
    intro: "The owner's account sends a money request. The friend asks Alat before paying.",
    steps: [
      { from: 0, to: 0, text: "Friend gets: “I'm stuck, send 200 urgently”" },
      { from: 0, to: 1, text: "Friend forwards it to the bot (or /check @name)" },
      { from: 1, to: 3, text: "Alat reads which key is linked to that account" },
      { from: 1, to: 0, text: "Bot answers ⏳ “Do not send money until this turns green”", detail: "One message. It changes in place when the answer comes. 15 minutes to answer.", tone: "wait" },
      { from: 1, to: 0, text: "Owner is told in their own chat: someone is checking" },
    ],
  },
  {
    id: "answer",
    label: "3. The owner answers",
    intro: "The answer comes from the owner's key, not from the chat. It works even if they're locked out of Telegram.",
    steps: [
      { from: 1, to: 2, text: "Owner opens alat /respond and connects QoreX", detail: "They see the request text and two buttons: Yes, that's me / No, that's not me." },
      { from: 2, to: 3, text: "QoreX signs the answer for this one check", detail: "Hybrid-signed self-transfer whose memo carries this check's single-use code." },
      { from: 3, to: 1, text: "Alat verifies: the linked key? this check? before expiry? ML-DSA-87 valid?" },
      { from: 1, to: 0, text: "Friend's message turns ✅ Confirmed by the real owner", tone: "go" },
      { from: 1, to: 0, text: "…or ❌ The owner says this is NOT them. Don't send money.", tone: "stop" },
    ],
  },
  {
    id: "hacker",
    label: "4. A hacker tries",
    intro: "The hacker has the Telegram account, the name and the chat history. Not the key.",
    steps: [
      { from: 0, to: 0, text: "Hacker types “yes it's really me” in the chat", detail: "Counts for nothing: chat messages are never an answer.", tone: "stop" },
      { from: 2, to: 3, text: "Hacker signs “yes” with their own QoreChain key" },
      { from: 3, to: 1, text: "Alat refuses it: signed by a different key than the one linked", tone: "stop" },
      { from: 0, to: 1, text: "Hacker sends /link to move the account to their key" },
      { from: 1, to: 3, text: "AlatRegistry makes it wait 7 days, in public", detail: "Every check shows ⚠️ link change pending. The old key keeps answering.", tone: "wait" },
      { from: 2, to: 3, text: "Real owner cancels it with their key", tone: "go" },
    ],
  },
];

const STEP_MS = 1400; // one arrow draws, the packet travels, the text fades in
const PAUSE_MS = 2600; // after the last step of a part, before the next part

function Arrow({ s, state }: { s: Step; state: "hidden" | "active" | "done" }) {
  const a = Math.min(s.from, s.to);
  const b = Math.max(s.from, s.to);
  const self = s.from === s.to;
  const right = s.to > s.from;
  return (
    <div className={`wf-row tone-${s.tone ?? "plain"} ${state}`}>
      <div className="wf-track">
        {LANES.map((_, i) => (
          <span key={i} className="wf-life" style={{ gridColumn: i + 1 }} />
        ))}
        {self ? (
          <span className="wf-dot" style={{ gridColumn: s.from + 1 }} />
        ) : (
          <span
            className={`wf-arrow ${right ? "right" : "left"}`}
            style={{ gridColumn: `${a + 1} / ${b + 2}`, ["--half" as string]: `${100 / (2 * (b - a + 1))}%` }}
            aria-hidden="true"
          >
            <span className="wf-packet" />
          </span>
        )}
      </div>
      <p className="wf-text">
        <span className="wf-who">{self ? LANES[s.from] : `${LANES[s.from]} → ${LANES[s.to]}`}</span>
        {s.text}
        {s.detail && <span className="wf-detail">{s.detail}</span>}
      </p>
    </div>
  );
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function Workflow() {
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(reducedMotion() ? 99 : 0); // how many steps are visible
  const [auto, setAuto] = useState(!reducedMotion()); // move on to the next part by itself
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const f = FLOWS[i]!;
  const done = shown >= f.steps.length;

  // Start playing only once the diagram is on screen.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return setVisible(true);
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setVisible(true), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || reducedMotion()) return;
    if (!done) {
      const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 300 : STEP_MS);
      return () => clearTimeout(t);
    }
    if (auto) {
      const t = setTimeout(() => go((i + 1) % FLOWS.length, true), PAUSE_MS);
      return () => clearTimeout(t);
    }
  }, [visible, shown, done, auto, i]);

  function go(n: number, keepAuto = false) {
    setI(n);
    setShown(reducedMotion() ? 99 : 0);
    if (!keepAuto) setAuto(false);
  }

  return (
    <section ref={ref} className="card wf" aria-label="How Alat works, step by step">
      <div className="wf-tabs" role="tablist">
        {FLOWS.map((x, n) => (
          <button key={x.id} role="tab" aria-selected={n === i} className={n === i ? "" : "secondary"} onClick={() => go(n)} type="button">
            {x.label}
          </button>
        ))}
      </div>
      <div className="wf-progress" aria-hidden="true">
        <span style={{ width: `${(Math.min(shown, f.steps.length) / f.steps.length) * 100}%` }} />
      </div>
      <p className="muted" style={{ margin: "14px 0 18px" }}>
        {f.intro}
      </p>
      <div className="wf-lanes">
        {LANES.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      {f.steps.map((s, n) => (
        <Arrow key={`${f.id}-${n}`} s={s} state={n < shown - 1 ? "done" : n === shown - 1 ? "active" : "hidden"} />
      ))}
      <div className="row" style={{ marginTop: 16, justifyContent: "space-between" }}>
        <div className="row">
          <button type="button" className="secondary" disabled={i === 0} onClick={() => go(i - 1)}>
            ← Back
          </button>
          <button type="button" className="secondary" onClick={() => go(i, auto)}>
            ↻ Replay
          </button>
        </div>
        {i < FLOWS.length - 1 ? (
          <button type="button" onClick={() => go(i + 1)}>
            Next: {FLOWS[i + 1]!.label.replace(/^\d\. /, "")} →
          </button>
        ) : (
          <a className="button" href="/demo">
            See it live on the testnet →
          </a>
        )}
      </div>
    </section>
  );
}
