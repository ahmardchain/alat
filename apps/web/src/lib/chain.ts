/**
 * Chain reads through the site's own /lcd-testnet proxy (the public REST API
 * sends no CORS headers). Every value here comes from the chain, never from
 * the page.
 */
export const REST = "/lcd-testnet";
export const EXPLORER = "https://explore.qore.network";

// The explorer picks the network from a cookie, not the URL: a link opens on
// mainnet until the reader selects Testnet once (docs/FINDINGS.md, F5).
export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const txJsonUrl = (hash: string) => `https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/${hash}`;

export async function pqcKeyRegistered(address: string): Promise<boolean | undefined> {
  const res = await fetch(`${REST}/qorechain/pqc/v1/account/${address}`);
  if (!res.ok) return undefined;
  const body = (await res.json()) as { found?: boolean; account?: { public_key?: string } | null };
  return Boolean(body.found && body.account?.public_key);
}

export async function balanceUqor(address: string): Promise<bigint | undefined> {
  const res = await fetch(`${REST}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=uqor`);
  if (!res.ok) return undefined;
  const body = (await res.json()) as { balance?: { amount?: string } };
  return BigInt(body.balance?.amount ?? "0");
}

export const formatQor = (uqor: bigint) => {
  const whole = uqor / 1_000_000n;
  const frac = (uqor % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac} QOR` : `${whole} QOR`;
};
