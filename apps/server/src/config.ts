import { resolve } from "node:path";
// Inlined at build time, so the deployed function needs no file access.
import deploymentJson from "../../../contracts/deployments/testnet.json" with { type: "json" };

const deployment = deploymentJson as { AlatRegistry: `0x${string}`; deployTx: string };

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set (see .env.example)`);
  return v;
}

export interface Config {
  port: number;
  publicUrl: string;
  databaseUrl: string | undefined;
  localDbDir: string | undefined;
  salt: string;
  relayerMnemonic: string;
  demoOwnerMnemonic: string | undefined;
  botToken: string | undefined;
  botUsername: string | undefined;
  videoUrl: string | null;
  rest: string;
  rpc: string;
  evmRpc: string;
  chainId: string;
  registry: `0x${string}`;
  registryDeployTx: string;
  webDist: string;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 8787),
    publicUrl: (process.env.ALAT_PUBLIC_URL ?? "http://localhost:8787").replace(/\/$/, ""),
    // Vercel + Neon sets DATABASE_URL (or POSTGRES_URL). Without it: PGlite in a local folder.
    databaseUrl: process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || undefined,
    localDbDir: process.env.ALAT_LOCAL_DB_DIR ?? resolve(import.meta.dirname ?? ".", "../../../data/pglite"),
    salt: need("ALAT_ID_SALT"),
    relayerMnemonic: need("ALAT_RELAYER_MNEMONIC"),
    demoOwnerMnemonic: process.env.ALAT_DEMO_OWNER_MNEMONIC?.trim() || undefined,
    botToken: process.env.BOT_TOKEN?.trim() || undefined,
    botUsername: process.env.ALAT_BOT_USERNAME?.trim().replace(/^@/, "") || undefined,
    videoUrl: process.env.ALAT_VIDEO_URL?.trim() || null,
    rest: process.env.QORE_REST_URL ?? "https://api-testnet.qore.host",
    rpc: process.env.QORE_RPC_URL ?? "https://rpc-testnet.qore.host",
    evmRpc: process.env.QORE_EVM_RPC_URL ?? "https://evm-testnet.qore.host",
    chainId: "qorechain-diana",
    registry: deployment.AlatRegistry,
    registryDeployTx: deployment.deployTx,
    webDist: process.env.ALAT_WEB_DIST ?? resolve(import.meta.dirname ?? ".", "../../web/dist"),
  };
}
