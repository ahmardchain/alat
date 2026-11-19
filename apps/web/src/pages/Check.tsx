import { useEffect, useState } from "react";
import { ErrorCard, Verdict } from "../components.js";
import { api, type CheckView } from "../lib/api.js";

/** The friend's view of one check, refreshed until it closes. */
export function Check({ id }: { id: string }) {
  const [v, setV] = useState<CheckView>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const next = await api.check(id);
        if (!stop) setV(next);
        if (next.verdict !== "waiting") return;
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : String(e));
        return;
      }
      if (!stop) setTimeout(tick, 3000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [id]);
  if (error) return <ErrorCard error={error === "not-found" ? "No check with this id." : error} />;
  if (!v) return <p className="muted">Loading…</p>;
  return (
    <>
      <h1 style={{ fontSize: 32 }}>Is this message really from them?</h1>
      <Verdict v={v} />
    </>
  );
}
