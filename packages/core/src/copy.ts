/** Words the friend sees. Shared by the bot and the site so they never disagree. */
export type VerdictKind = "waiting" | "confirmed" | "denied" | "expired" | "not-linked";

export const VERDICT: Record<VerdictKind, { icon: string; title: string; body: string }> = {
  waiting: {
    icon: "⏳",
    title: "Waiting for the owner.",
    body: "Do not send money until this turns green.",
  },
  confirmed: {
    icon: "✅",
    title: "Confirmed by the real owner.",
    body: "Signed by the key linked to this account.",
  },
  denied: {
    icon: "❌",
    title: "The owner says this is NOT them.",
    body: "Their account may be hacked. Don't send money. Tell them another way.",
  },
  expired: {
    icon: "❌",
    title: "Not confirmed.",
    body: "No answer from the owner's key before the check expired. Do not send money.",
  },
  "not-linked": {
    icon: "❔",
    title: "This account hasn't set up Alat.",
    body: "Call them on a number you already know. Don't use this chat.",
  },
};

export const PENDING_CHANGE_WARNING =
  "⚠️ Link change pending. Someone asked to move this account to a new key. Treat every check with care until the date below.";
