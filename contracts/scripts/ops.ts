/**
 * ops.ts - Alat's operator accounts on the QoreChain testnet.
 *
 *   pnpm ops keys      create the relayer and demo-owner mnemonics in ../.env (once)
 *   pnpm ops status    addresses, balances, PQC key status
 *   pnpm ops register  register the ML-DSA-87 key of an account (once per account)
 *   pnpm ops hello     send a hybrid-signed (secp256k1 + ML-DSA-87) self-transfer with a memo
 *   pnpm ops fund-demo send 5 QOR from the relayer to the demo owner
 *   pnpm ops window    open an EVM authorisation window for the relayer
 *   pnpm ops deploy    deploy AlatRegistry to the testnet EVM (writes deployments/testnet.json)
 *
 * Account selection: ALAT_ACCOUNT=relayer (default) or demo.
 * Secrets live only in the repository-root .env, which is git-ignored.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { StargateClient } from "@cosmjs/stargate";
import {
  EthNativeSigner,
  buildRegisterPqcKeyMsg,
  deriveUnifiedAccount,
  fetchPqcStatus,
  generateMnemonic,
  getNetwork,
  isRegisteredPqcKey,
  msg,
  signProofOfPossession,
  openEvmWindowMsg,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { evmWindowCost, evmWindowStatus } from "@qorechain/evm";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ENV_PATH = resolve(import.meta.dirname, "../../.env");
const net = getNetwork("testnet");
const REST = net.endpoints.rest;
const RPC = net.endpoints.rpc;
const CHAIN_ID = net.chainId;
const FEE = { amount: [{ denom: "uqor", amount: "120000" }], gas: "800000" };

function loadEnv(): void {
  if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);
}

async function accountFor(which: string): Promise<UnifiedAccount> {
  const key = which === "demo" ? "ALAT_DEMO_OWNER_MNEMONIC" : "ALAT_RELAYER_MNEMONIC";
  const m = process.env[key]?.trim();
  if (!m) throw new Error(`${key} is not set in ${ENV_PATH}: run \`pnpm ops keys\` first`);
  return deriveUnifiedAccount(m, 0);
}

async function accountSequence(address: string): Promise<{ accountNumber: bigint; sequence: bigint }> {
  const res = await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${address}`);
  if (res.status === 404) throw new Error(`${address} does not exist on chain yet: fund it from the faucet first`);
  if (!res.ok) throw new Error(`account query failed: HTTP ${res.status}`);
  const body = (await res.json()) as { account?: Record<string, unknown> };
  const acc = (body.account?.base_account ?? body.account ?? {}) as Record<string, string>;
  return { accountNumber: BigInt(acc.account_number ?? "0"), sequence: BigInt(acc.sequence ?? "0") };
}

async function balance(address: string): Promise<string> {
  const res = await fetch(`${REST}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=uqor`);
  if (!res.ok) return "0";
  const body = (await res.json()) as { balance?: { amount?: string } };
  return body.balance?.amount ?? "0";
}

async function broadcast(
  acc: UnifiedAccount,
  mode: "hybrid" | "classical",
  messages: Parameters<EthNativeSigner["sign"]>[0]["messages"],
  memo = "",
): Promise<string> {
  const { accountNumber, sequence } = await accountSequence(acc.cosmos);
  const signer = new EthNativeSigner(acc, { signMode: mode, rest: REST });
  const transport = await StargateClient.connect(RPC);
  try {
    const res = await signer.signAndBroadcast(transport, {
      chainId: CHAIN_ID,
      accountNumber,
      sequence,
      fee: FEE,
      messages,
      memo,
    });
    if (res.code !== 0) throw new Error(`tx ${res.transactionHash} failed with code ${res.code}: ${res.rawLog ?? ""}`);
    return res.transactionHash;
  } finally {
    transport.disconnect();
  }
}

async function keys(): Promise<void> {
  const have = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
  for (const key of ["ALAT_RELAYER_MNEMONIC", "ALAT_DEMO_OWNER_MNEMONIC"]) {
    if (new RegExp(`^${key}=.+`, "m").test(have)) {
      console.log(`${key} already set; keeping it`);
      continue;
    }
    appendFileSync(ENV_PATH, `${key}="${generateMnemonic(256)}"\n`);
    console.log(`${key} written to ${ENV_PATH}`);
  }
  loadEnv();
  await status();
}

async function status(): Promise<void> {
  for (const which of ["relayer", "demo"]) {
    const acc = await accountFor(which);
    const pqc = await fetchPqcStatus({ rest: REST, address: acc.cosmos });
    const mine = pqc.registered ? isRegisteredPqcKey(pqc, acc.pqc.publicKey) : false;
    console.log(`${which.padEnd(8)} ${acc.cosmos}  ${acc.evm}`);
    console.log(
      `         balance ${await balance(acc.cosmos)} uqor; PQC key: ${
        pqc.registered ? (mine === false ? "registered, but NOT this key" : "registered") : "not registered"
      }`,
    );
  }
}

async function register(): Promise<void> {
  const acc = await accountFor(process.env.ALAT_ACCOUNT ?? "relayer");
  const pqc = await fetchPqcStatus({ rest: REST, address: acc.cosmos });
  if (pqc.registered) {
    console.log("PQC key already registered; nothing to do.");
    return;
  }
  // Registration is the one message the chain accepts signed classically.
  const proofOfPossession = signProofOfPossession({ chainId: CHAIN_ID, account: acc.cosmos, keypair: acc.pqc });
  const m = buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession });
  console.log(`registered: ${await broadcast(acc, "classical", [m])}`);
}

async function hello(): Promise<void> {
  const acc = await accountFor(process.env.ALAT_ACCOUNT ?? "relayer");
  const send = msg.bank.send({
    fromAddress: acc.cosmos,
    toAddress: acc.cosmos,
    amount: [{ denom: "uqor", amount: "1" }],
  });
  const hash = await broadcast(acc, "hybrid", [send], "alat: first hybrid-signed transaction");
  console.log(`hybrid tx: ${hash}`);
  console.log(`check: ${REST}/cosmos/tx/v1beta1/txs/${hash}`);
}

async function fundDemo(): Promise<void> {
  const relayer = await accountFor("relayer");
  const demo = await accountFor("demo");
  const send = msg.bank.send({
    fromAddress: relayer.cosmos,
    toAddress: demo.cosmos,
    amount: [{ denom: "uqor", amount: "5000000" }],
  });
  console.log(`funded demo owner: ${await broadcast(relayer, "hybrid", [send], "alat: fund demo owner")}`);
}

const PQC_KEY_STATUS = "0x0000000000000000000000000000000000000a02";
const EVM_RPC = net.endpoints.evmRpc ?? "https://evm-testnet.qore.host";

async function openWindow(acc: UnifiedAccount, blocks = 3000n, maxTxs = 10n): Promise<string> {
  const perTx = evmWindowCost({ gas: 3_000_000n, maxFeePerGas: 250_000_000_000n });
  const m = openEvmWindowMsg({ sender: acc.cosmos, blocks, maxTxs, maxValue: perTx * maxTxs });
  const hash = await broadcast(acc, "hybrid", [m], "alat: open EVM window");
  // Wait until the window is visible to the EVM lane.
  for (let i = 0; i < 20; i++) {
    const w = await evmWindowStatus({ rest: REST, address: acc.cosmos });
    if (w.found && w.live) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return hash;
}

async function window_(): Promise<void> {
  const acc = await accountFor(process.env.ALAT_ACCOUNT ?? "relayer");
  console.log(`window opened: ${await openWindow(acc)}`);
}

async function deploy(): Promise<void> {
  const acc = await accountFor("relayer");
  const windowTx = await openWindow(acc, 600n, 2n);
  console.log(`window opened: ${windowTx}`);
  const artifact = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../artifacts/contracts/AlatRegistry.sol/AlatRegistry.json"), "utf8"),
  ) as { abi: unknown[]; bytecode: Hex };
  const account = privateKeyToAccount(acc.privateKey as Hex);
  const chain = {
    id: 9800,
    name: "QoreChain testnet",
    nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
    rpcUrls: { default: { http: [EVM_RPC] } },
  } as const;
  const wallet = createWalletClient({ account, chain, transport: http(EVM_RPC) });
  const pub = createPublicClient({ chain, transport: http(EVM_RPC) });
  const hash = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [acc.evm, PQC_KEY_STATUS],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deploy failed: ${hash}`);
  const out = {
    network: "qorechain-diana",
    evmChainId: 9800,
    AlatRegistry: receipt.contractAddress,
    deployTx: hash,
    deployBlock: receipt.blockNumber.toString(),
    relayer: { evm: acc.evm, native: acc.cosmos },
    pqcKeyStatus: PQC_KEY_STATUS,
    windowTx,
    deployedAt: new Date().toISOString(),
  };
  mkdirSync(resolve(import.meta.dirname, "../deployments"), { recursive: true });
  writeFileSync(resolve(import.meta.dirname, "../deployments/testnet.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(out);
}

loadEnv();
const commands: Record<string, () => Promise<void>> = {
  keys,
  status,
  register,
  hello,
  "fund-demo": fundDemo,
  window: window_,
  deploy,
};
const cmd = process.argv[2] ?? "status";
const run = commands[cmd];
if (!run) {
  console.error(`Unknown command "${cmd}". Use: ${Object.keys(commands).join(" | ")}`);
  process.exit(1);
}
run().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
