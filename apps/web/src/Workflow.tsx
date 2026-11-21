import { useEffect, useState } from "react";

/** How it works, in three plain steps that light up one after another. */
const STEPS = [
  { icon: "💬", title: "A message asks you for money", body: "It comes from your friend's account. But is it really them?" },
  { icon: "🔍", title: "Forward it to the Alat bot", body: "One tap in Telegram. Don't pay yet." },
  { icon: "🔑", title: "Your friend's key answers", body: "Only the real owner has it." },
];

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function Workflow() {
  // 0..2 = that step is lit; 3 = the answer is shown. Loops.
  const [at, setAt] = useState(reducedMotion() ? 3 : 0);
  const [ok, setOk] = useState(false); // alternate ❌ and ✅ on each loop
  useEffect(() => {
    if (reducedMotion()) return;
    const t = setTimeout(
      () => {
        if (at === 3) setOk((x) => !x);
        setAt((a) => (a + 1) % 4);
      },
      at === 3 ? 3200 : 1600,
    );
    return () => clearTimeout(t);
  }, [at]);

  return (
    <div className="hiw">
      <div className="hiw-steps">
        {STEPS.map((s, n) => (
          <div key={s.title} className={`hiw-step ${at >= n ? "on" : ""} ${at === n ? "now" : ""}`}>
            <span className="hiw-icon" aria-hidden="true">
              {s.icon}
            </span>
            <b>{s.title}</b>
            <span className="muted small">{s.body}</span>
            {n === 2 && (
              <span className={`hiw-answer ${at === 3 ? "show" : ""} ${ok ? "go" : "stop"}`}>
                {ok ? "✅ It's them. Safe to send." : "❌ Not them. Don't pay."}
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="hiw-line">A hacker can take the account. Not the key.</p>
    </div>
  );
}
