/**
 * Everything Alat's server does on chain.
 *
 * - Registry reads: the owner of an account always comes from AlatRegistry.
 * - The relayer: the only account that writes AlatRegistry. It keeps an EVM
 *   authorisation window open (opened by a hybrid-signed native message) and
 *   runs one write at a time, because native and EVM transactions share its nonce.
 * - Native self-sends with a memo, for the demo owner on /demo.
 */
import { StargateClient } from "@cosmjs/stargate";
import { bytes32ToTxHash, evmToQor, qorToEvm, txHashToBytes32, type Hex32 } from "@alat/core";
import { evmWindowCost, evmWindowStatus } from "@qorechain/evm";
import {
  EthNativeSigner,
  buildRegisterPqcKeyMsg,
  deriveUnifiedAccount,
  msg,
  openEvmWindowMsg,
  signProofOfPossession,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { createPublicClient, createWalletClient, http, parseAbi, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "./config.ts";

export const REGISTRY_ABI = parseAbi([
  "function linkOf(bytes32 account) view returns (address owner, uint64 linkedAt, bytes32 evidence)",
  "function pendingOf(bytes32 account) view returns (address newOwner, uint64 requestedAt, uint64 unlockAt, bytes32 evidence)",
  "function linkedAccounts() view returns (uint256)",
  "function totalWrites() view returns (uint256)",
  "function link(bytes32 account, address owner, bytes32 evidence)",
  "function requestChange(bytes32 account, address newOwner, bytes32 evidence)",
  "function cancelChange(bytes32 account, bytes32 evidence)",
  "function changeWithConsent(bytes32 account, address newOwner, bytes32 evidence)",
  "function finalizeChange(bytes32 account)",
  "error NotRelayer()",
  "error AlreadyLinked()",
  "error NotLinked()",
  "error ChangePending()",
  "error NoChangePending()",
  "error TooEarly(uint64 unlockAt)",
  "error NoPqcKey(address owner)",
  "error SameOwner()",
  "error NoEvidence()",
]);

export interface LinkInfo {
  owner: string; // qor1…
  linkedAtMs: number;
  evidenceTx: string;
}

export interface PendingInfo {
  newOwner: string | null; // null = removal
  requestedAtMs: number;
  unlockAtMs: number;
  evidenceTx: string;
}

const FEE = { amount: [{ denom: "uqor", amount: "120000" }], gas: "800000" };

export class Chain {
  readonly pub;
  private relayerAccount?: UnifiedAccount;
  private demoAccount?: UnifiedAccount;
  private queue: Promise<unknown> = Promise.resolve();
  /** Called for every transaction Alat sends, so /demo can count them. */
  onTx: (kind: string, nativeTx: string | null, evmTx: string | null) => void = () => undefined;
  private readonly evmChain;

  /**
   * Runs relayer work one at a time across every instance (on Vercel, many
   * functions can run at once and they share the relayer's nonce).
   */
  lock: <T>(fn: () => Promise<T>) => Promise<T> = (fn) => fn();

  constructor(private readonly cfg: Config) {
    this.evmChain = {
      id: 9800,
      name: "QoreChain testnet",
      nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
      rpcUrls: { default: { http: [cfg.evmRpc] } },
    } as const;
    this.pub = createPublicClient({ chain: this.evmChain, transport: http(cfg.evmRpc) });
  }

  async relayer(): Promise<UnifiedAccount> {
    this.relayerAccount ??= await deriveUnifiedAccount(this.cfg.relayerMnemonic, 0);
    return this.relayerAccount;
  }

  async demoOwner(): Promise<UnifiedAccount | undefined> {
    if (!this.cfg.demoOwnerMnemonic) return undefined;
    this.demoAccount ??= await deriveUnifiedAccount(this.cfg.demoOwnerMnemonic, 0);
    return this.demoAccount;
  }

  // ------------------------------------------------------------- reads

  async linkOf(account: Hex32): Promise<LinkInfo | undefined> {
    const [owner, linkedAt, evidence] = await this.pub.readContract({
      address: this.cfg.registry,
      abi: REGISTRY_ABI,
      functionName: "linkOf",
      args: [account],
    });
    if (owner === zeroAddress) return undefined;
    return { owner: evmToQor(owner), linkedAtMs: Number(linkedAt) * 1000, evidenceTx: bytes32ToTxHash(evidence) };
  }

  async pendingOf(account: Hex32): Promise<PendingInfo | undefined> {
    const [newOwner, requestedAt, unlockAt, evidence] = await this.pub.readContract({
      address: this.cfg.registry,
      abi: REGISTRY_ABI,
      functionName: "pendingOf",
      args: [account],
    });
    if (unlockAt === 0n) return undefined;
    return {
      newOwner: newOwner === zeroAddress ? null : evmToQor(newOwner),
      requestedAtMs: Number(requestedAt) * 1000,
      unlockAtMs: Number(unlockAt) * 1000,
      evidenceTx: bytes32ToTxHash(evidence),
    };
  }

  async registryCounts(): Promise<{ linkedAccounts: number; totalWrites: number }> {
    const [a, w] = await Promise.all([
      this.pub.readContract({ address: this.cfg.registry, abi: REGISTRY_ABI, functionName: "linkedAccounts" }),
      this.pub.readContract({ address: this.cfg.registry, abi: REGISTRY_ABI, functionName: "totalWrites" }),
    ]);
    return { linkedAccounts: Number(a), totalWrites: Number(w) };
  }

  async pqcKeyRegistered(address: string): Promise<boolean> {
    const res = await fetch(`${this.cfg.rest}/qorechain/pqc/v1/account/${address}`);
    if (!res.ok) return false;
    const body = (await res.json()) as { found?: boolean };
    return body.found === true;
  }

  // ------------------------------------------------------- native lane

  private async sequence(address: string): Promise<{ accountNumber: bigint; sequence: bigint }> {
    const res = await fetch(`${this.cfg.rest}/cosmos/auth/v1beta1/accounts/${address}`);
    if (!res.ok) throw new Error(`account query failed for ${address}: HTTP ${res.status}`);
    const body = (await res.json()) as { account?: Record<string, unknown> };
    const acc = (body.account?.base_account ?? body.account ?? {}) as Record<string, string>;
    return { accountNumber: BigInt(acc.account_number ?? "0"), sequence: BigInt(acc.sequence ?? "0") };
  }

  /** Register an account's ML-DSA-87 key once (the one transaction the chain accepts signed classically). */
  ensurePqcRegistered(acc: UnifiedAccount): Promise<string | undefined> {
    return this.serial(async () => {
      if (await this.pqcKeyRegistered(acc.cosmos)) return undefined;
      const pop = signProofOfPossession({ chainId: this.cfg.chainId, account: acc.cosmos, keypair: acc.pqc });
      const m = buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession: pop });
      const hash = await this.nativeBroadcast(acc, [m], "alat: register ML-DSA-87 key", "classical");
      for (let i = 0; i < 20 && !(await this.pqcKeyRegistered(acc.cosmos)); i++) await new Promise((r) => setTimeout(r, 1500));
      return hash;
    });
  }

  private async nativeBroadcast(
    acc: UnifiedAccount,
    messages: Parameters<EthNativeSigner["sign"]>[0]["messages"],
    memo: string,
    signMode: "hybrid" | "classical" = "hybrid",
  ) {
    const { accountNumber, sequence } = await this.sequence(acc.cosmos);
    const signer = new EthNativeSigner(acc, { signMode, rest: this.cfg.rest });
    const transport = await StargateClient.connect(this.cfg.rpc);
    try {
      const res = await signer.signAndBroadcast(transport, {
        chainId: this.cfg.chainId,
        accountNumber,
        sequence,
        fee: FEE,
        messages,
        memo,
      });
      if (res.code !== 0) throw new Error(`native tx ${res.transactionHash} failed: code ${res.code} ${res.rawLog ?? ""}`);
      this.onTx(memo.startsWith("alat1:") ? memo.split(":")[1]! : memo.replace(/^alat: /, ""), res.transactionHash, null);
      return res.transactionHash;
    } finally {
      transport.disconnect();
    }
  }

  /** A hybrid-signed 1 uqor self-send with a memo, the same shape QoreX sends for owners. */
  selfMemo(acc: UnifiedAccount, memo: string): Promise<string> {
    const send = msg.bank.send({ fromAddress: acc.cosmos, toAddress: acc.cosmos, amount: [{ denom: "uqor", amount: "1" }] });
    return this.serial(() => this.nativeBroadcast(acc, [send], memo));
  }

  // ---------------------------------------------------- relayer writes

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const locked = () => this.lock(fn);
    const run = this.queue.then(locked, locked);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async ensureWindow(acc: UnifiedAccount): Promise<string | undefined> {
    const w = await evmWindowStatus({ rest: this.cfg.rest, address: acc.cosmos });
    const perTx = evmWindowCost({ gas: 3_000_000n, maxFeePerGas: 250_000_000_000n });
    if (w.found && w.live && w.remainingTxs >= 1n && w.remainingBlocks > 30n && BigInt(w.remainingValue) >= perTx) return undefined;
    const m = openEvmWindowMsg({ sender: acc.cosmos, blocks: 3000n, maxTxs: 10n, maxValue: perTx * 10n });
    const hash = await this.nativeBroadcast(acc, [m], "alat: open EVM window");
    for (let i = 0; i < 20; i++) {
      const s = await evmWindowStatus({ rest: this.cfg.rest, address: acc.cosmos });
      if (s.found && s.live) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return hash;
  }

  private write(
    fn: "link" | "requestChange" | "cancelChange" | "changeWithConsent" | "finalizeChange",
    args: readonly unknown[],
  ): Promise<{ evmTx: Hex; windowTx?: string }> {
    return this.serial(async () => {
      const acc = await this.relayer();
      const windowTx = await this.ensureWindow(acc);
      const wallet = createWalletClient({
        account: privateKeyToAccount(acc.privateKey as Hex),
        chain: this.evmChain,
        transport: http(this.cfg.evmRpc),
      });
      // Simulate first: a contract refusal surfaces as a named error, not a spent window slot.
      const { request } = await this.pub.simulateContract({
        account: wallet.account,
        address: this.cfg.registry,
        abi: REGISTRY_ABI,
        functionName: fn,
        args: args as never,
      });
      const evmTx = await wallet.writeContract(request);
      const receipt = await this.pub.waitForTransactionReceipt({ hash: evmTx });
      if (receipt.status !== "success") throw new Error(`registry ${fn} reverted: ${evmTx}`);
      this.onTx(`registry ${fn}`, null, evmTx);
      return { evmTx, windowTx };
    });
  }

  link(account: Hex32, owner: string, nativeTx: string) {
    return this.write("link", [account, qorToEvm(owner), txHashToBytes32(nativeTx)]);
  }
  requestChange(account: Hex32, newOwner: string | null, nativeTx: string) {
    return this.write("requestChange", [account, newOwner ? qorToEvm(newOwner) : zeroAddress, txHashToBytes32(nativeTx)]);
  }
  cancelChange(account: Hex32, nativeTx: string) {
    return this.write("cancelChange", [account, txHashToBytes32(nativeTx)]);
  }
  finalizeChange(account: Hex32) {
    return this.write("finalizeChange", [account]);
  }
}
