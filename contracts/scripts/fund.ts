/** pnpm tsx scripts/fund.ts <qor1 address> <uqor>: send testnet QOR from the relayer (hybrid-signed). */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { StargateClient } from "@cosmjs/stargate";
import { EthNativeSigner, deriveNativeAccount, deriveUnifiedAccount, getNetwork, msg } from "@qorechain/sdk";

const env = resolve(import.meta.dirname, "../../.env");
if (existsSync(env)) process.loadEnvFile(env);
const net = getNetwork("testnet");
const [to, amount] = process.argv.slice(2);
if (to === "mock-address") {
  // The account the QoreX wallet mock (and QoreX) derives from the demo mnemonic: m/44'/118'/0'/0/0.
  console.log((await deriveNativeAccount(process.env.ALAT_DEMO_OWNER_MNEMONIC!)).address);
  process.exit(0);
}
const acc = await deriveUnifiedAccount(process.env.ALAT_RELAYER_MNEMONIC!, 0);
const r = await fetch(`${net.endpoints.rest}/cosmos/auth/v1beta1/accounts/${acc.cosmos}`);
const a = ((await r.json()) as { account: Record<string, string> }).account;
const t = await StargateClient.connect(net.endpoints.rpc);
const res = await new EthNativeSigner(acc, { rest: net.endpoints.rest }).signAndBroadcast(t, {
  chainId: net.chainId,
  accountNumber: BigInt(a.account_number ?? "0"),
  sequence: BigInt(a.sequence ?? "0"),
  fee: { amount: [{ denom: "uqor", amount: "120000" }], gas: "800000" },
  messages: [msg.bank.send({ fromAddress: acc.cosmos, toAddress: to!, amount: [{ denom: "uqor", amount: amount! }] })],
  memo: "alat: fund test account",
});
t.disconnect();
console.log(res.code, res.transactionHash);
