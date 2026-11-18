/**
 * QoreX on the QoreChain native lane.
 *
 * QoreX today signs native transactions only, through signAndBroadcast: the page
 * sends encoded messages, QoreX shows them, adds the ML-DSA-87 layer and
 * broadcasts. It cannot sign messages (signArbitrary) or EVM transactions yet.
 * See docs/FINDINGS.md (F1, F2).
 */
import { getQorexNative, hasCapability, qorexSignAndBroadcast, type QorexSignAndBroadcastResult } from "@qorechain/qorex-types";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";

export const CHAIN_ID = "qorechain-diana";
export const MSG_SEND = "/cosmos.bank.v1beta1.MsgSend";

export type QorexState =
  | { kind: "missing" }
  | { kind: "unsupported" }
  | { kind: "ready" };

export function qorexState(): QorexState {
  const native = getQorexNative();
  if (!native) return { kind: "missing" };
  if (!hasCapability(native, "signAndBroadcast")) return { kind: "unsupported" };
  return { kind: "ready" };
}

/** Wait briefly for the extension to inject window.qorex. */
export async function waitForQorex(timeoutMs = 1500): Promise<QorexState> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = qorexState();
    if (s.kind !== "missing") return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  return qorexState();
}

/** Ask QoreX to connect this site and return the selected qor1 address. */
export async function connectQorex(): Promise<string> {
  const native = getQorexNative();
  if (!native) throw new Error("QoreX was not found in this browser.");
  await native.enable(CHAIN_ID);
  const key = await native.getKey(CHAIN_ID);
  return key.bech32Address;
}

/**
 * Send 1 uqor to yourself with a memo. QoreX signs it hybrid (secp256k1 +
 * ML-DSA-87). Alat uses this for every action an owner takes, because the memo
 * is the only payload QoreX can sign today.
 */
export async function sendMemoTx(address: string, memo: string): Promise<QorexSignAndBroadcastResult> {
  if (new TextEncoder().encode(memo).length > 256) throw new Error("memo is longer than 256 bytes");
  const value = MsgSend.encode(
    MsgSend.fromPartial({ fromAddress: address, toAddress: address, amount: [{ denom: "uqor", amount: "1" }] }),
  ).finish();
  return qorexSignAndBroadcast({ chainId: CHAIN_ID, messages: [{ typeUrl: MSG_SEND, value }], memo });
}
