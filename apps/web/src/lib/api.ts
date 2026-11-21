/** Alat's API. The server re-reads every transaction from the chain; the page only passes hashes. */
export interface LinkInfo {
  owner: string;
  linkedAtMs: number;
  evidenceTx: string;
}
export interface PendingInfo {
  newOwner: string | null;
  requestedAtMs: number;
  unlockAtMs: number;
  evidenceTx: string;
}
export interface CheckView {
  id: string;
  verdict: "waiting" | "confirmed" | "denied" | "expired" | "not-linked";
  account: string;
  createdAtMs: number;
  expiresAtMs: number;
  answerTx: string | null;
  link: LinkInfo | null;
  pending: PendingInfo | null;
  demo: boolean;
}
export interface LinkTokenInfo {
  account: string;
  username: string | null;
  expiresAtMs: number;
  state: "open" | "used" | "expired";
  result: string | null;
  usedTx: string | null;
  memo: string;
  link: LinkInfo | null;
  pending: PendingInfo | null;
}
export interface LinkResult {
  kind: "linked" | "already-linked" | "change-pending";
  evmTx?: string;
  unlockAtMs?: number;
  nativeTx: string;
  owner: string;
  account: string;
}
export interface OwnerView {
  checks: {
    account: string;
    username: string | null;
    pending: PendingInfo | null;
    checks: { id: string; requestText: string | null; expiresAtMs: number; createdAtMs: number; memoYes: string; memoNo: string }[];
  }[];
  accounts: { account: string; username: string | null; link: LinkInfo; pending: PendingInfo | null; cancelMemo: string }[];
}
export interface Info {
  chainId: string;
  evmChainId: number;
  registry: string;
  registryDeployTx: string;
  relayer: { native: string; evm: string };
  explorer: string;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(body.error ?? "server", body.message ?? `HTTP ${res.status}`);
  return body as T;
}

const post = <T,>(path: string, txHash: string) => call<T>(path, { method: "POST", body: JSON.stringify({ txHash }) });

/** Submit a hash; while the chain hasn't indexed it yet (409), wait and retry. */
async function submit<T>(path: string, txHash: string): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await post<T>(path, txHash);
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== "not-yet-on-chain" || i >= 5) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

export const api = {
  info: () => call<Info>("/api/info"),
  linkInfo: (t: string) => call<LinkTokenInfo>(`/api/link/${t}`),
  submitLink: (t: string, txHash: string) => submit<LinkResult>(`/api/link/${t}`, txHash),
  check: (id: string) => call<CheckView>(`/api/check/${id}`),
  owner: (address: string) => call<OwnerView>(`/api/owner/${address}`),
  answer: (txHash: string) => submit<CheckView>("/api/answer", txHash),
  cancel: (txHash: string) => submit<{ account: string; nativeTx: string; evmTx: string }>("/api/cancel", txHash),
};

export const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export const short = (s: string, n = 8) => (s.length > 2 * n + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);
