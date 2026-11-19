/**
 * Read a committed transaction from the chain and turn it into an ObservedTx.
 *
 * Two independent checks of the post-quantum half:
 *  1. the chain's own `pqc_hybrid_verify` event for the signer reads "verified";
 *  2. QoreSign `inspectTransaction` re-verifies the ML-DSA-87 layer against the
 *     key registered on chain for the signer (never a key from the client).
 */
import { inspectTransaction } from "@qorechain/qoresign/network";
import type { ObservedTx } from "./verify.ts";

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface RestTx {
  tx_response?: {
    txhash: string;
    code: number;
    timestamp: string;
    events?: { type: string; attributes: { key: string; value: string }[] }[];
    tx?: {
      body?: {
        memo?: string;
        messages?: { "@type": string; from_address?: string; to_address?: string; amount?: { denom: string; amount: string }[] }[];
      };
    };
  };
}

export async function observeTx(opts: {
  rest: string;
  chainId: string;
  hash: string;
  fetch?: FetchLike;
}): Promise<ObservedTx | undefined> {
  const hash = opts.hash.replace(/^0x/, "").toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hash)) throw new Error("not a transaction hash");
  const f: FetchLike = opts.fetch ?? ((u, i) => fetch(u, i));
  const res = await f(`${opts.rest}/cosmos/tx/v1beta1/txs/${hash}`);
  if (res.status === 404 || res.status === 400) return undefined;
  if (!res.ok) throw new Error(`tx query failed: HTTP ${res.status}`);
  const body = (await res.json()) as RestTx;
  const r = body.tx_response;
  if (!r) return undefined;

  const inspected = await inspectTransaction({ rest: opts.rest, chainId: opts.chainId, txhash: hash, fetch: f });
  const signer = inspected?.signer?.address ?? "";
  const msgs = r.tx?.body?.messages ?? [];
  const selfSendOnly =
    msgs.length === 1 &&
    msgs[0]!["@type"] === "/cosmos.bank.v1beta1.MsgSend" &&
    msgs[0]!.from_address === signer &&
    msgs[0]!.to_address === signer;

  const chainVerifiedHybrid = (r.events ?? []).some(
    (e) =>
      e.type === "pqc_hybrid_verify" &&
      e.attributes.some((a) => a.key === "address" && a.value === signer) &&
      e.attributes.some((a) => a.key === "status" && a.value === "verified"),
  );

  return {
    hash: r.txhash.toUpperCase(),
    code: r.code,
    timeMs: Date.parse(r.timestamp),
    signer,
    memo: r.tx?.body?.memo ?? "",
    selfSendOnly,
    chainVerifiedHybrid,
    pqLayerMatchesRegisteredKey: inspected?.pqLayer.present === true && inspected.pqLayer.verified === true,
  };
}
