/**
 * Icons from Lucide (lucide.dev, ISC licence): one line weight, currentColor.
 * Wrapped so the rest of the site asks for an icon by meaning, not by name.
 */
import {
  CircleCheck,
  CircleHelp,
  CircleX,
  Clock,
  Forward,
  KeyRound,
  MessageCircleWarning,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

type P = { size?: number; className?: string; label?: string };

const wrap = (I: LucideIcon) =>
  function Icon({ size = 22, className, label }: P) {
    return (
      <I
        size={size}
        strokeWidth={1.9}
        className={`icon ${className ?? ""}`}
        aria-hidden={label ? undefined : true}
        aria-label={label}
        role={label ? "img" : undefined}
      />
    );
  };

export const IconChat = wrap(MessageCircleWarning);
export const IconForward = wrap(Forward);
export const IconKey = wrap(KeyRound);
export const IconCheck = wrap(CircleCheck);
export const IconCross = wrap(CircleX);
export const IconClock = wrap(Clock);
export const IconWarn = wrap(TriangleAlert);
export const IconQuestion = wrap(CircleHelp);

/** The mark for a verdict, coloured by it. */
export function VerdictIcon({ verdict, size = 22 }: { verdict: "waiting" | "confirmed" | "denied" | "expired" | "not-linked"; size?: number }) {
  if (verdict === "confirmed") return <IconCheck size={size} className="tone-go-ink" label="Confirmed" />;
  if (verdict === "denied" || verdict === "expired") return <IconCross size={size} className="tone-stop-ink" label="Not confirmed" />;
  if (verdict === "waiting") return <IconClock size={size} className="tone-wait-ink" label="Waiting" />;
  return <IconQuestion size={size} className="muted" label="Not set up" />;
}
