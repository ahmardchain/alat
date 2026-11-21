/**
 * The whole server as one fetch handler, used by the local Node server
 * (main.ts) and by the Vercel function (vercel.ts).
 *
 * Telegram reaches it by webhook (POST /api/tg/<secret>), so it also runs where
 * no process stays up between requests.
 */
import { createHash } from "node:crypto";
import type { Hex32 } from "@alat/core";
import { Bot, webhookCallback } from "grammy";
import { createBot, TelegramNotifier } from "./bot.ts";
import { createApp } from "./http.ts";
import { wire } from "./wire.ts";

export const FIRST_HYBRID_TX = "D17E9DDC1DAD4D8AEF248B6E1C3EC46C43076DF81A8705BB8D8476CC8B1D8162";

/** The webhook path secret and the header Telegram echoes back, both derived from the bot token. */
export function webhookSecrets(botToken: string) {
  const h = createHash("sha256").update(`alat-webhook:${botToken}`).digest("hex");
  return { path: h.slice(0, 32), header: h.slice(32, 64) };
}

/** Resolve `p`, or give up after `ms` (the caller decides what giving up means). */
async function within<T>(p: Promise<T>, ms: number, what: string): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t0 = Date.now();
  try {
    return await Promise.race([p, new Promise<undefined>((r) => { timer = setTimeout(() => r(undefined), ms); })]);
  } catch (e) {
    console.error(`${what} failed after ${Date.now() - t0} ms:`, e instanceof Error ? e.message : e);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export async function build(opts: { serveWeb: boolean }) {
  const { cfg, db, chain, alat, holder, demo } = await wire();
  const relayer = await chain.relayer();

  const label = async (account: Hex32) => {
    const a = await db.account(account);
    return a?.username ? `@${a.username}` : "this account";
  };

  let bot: Bot | undefined;
  let botUsername = cfg.botUsername;
  if (cfg.botToken) {
    bot = createBot(cfg.botToken, alat, cfg.publicUrl, demo);
    holder.notifier = new TelegramNotifier(bot, cfg.publicUrl, label);
    // Never let Telegram hold up the site: if it doesn't answer in time, the bot
    // initialises on its first webhook instead.
    await within(bot.init(), 8_000, "telegram getMe");
    if (bot.isInited()) botUsername = bot.botInfo.username;
  }

  const info = {
    chainId: cfg.chainId,
    evmChainId: 9800,
    registry: cfg.registry,
    registryDeployTx: cfg.registryDeployTx,
    relayer: { native: relayer.cosmos, evm: relayer.evm },
    explorer: "https://explore.qore.network",
    github: "https://github.com/ahmardchain/alat",
    bot: botUsername ? `https://t.me/${botUsername}` : null,
    video: cfg.videoUrl,
    firstHybridTx: FIRST_HYBRID_TX,
    demoOwner: (await chain.demoOwner())?.cosmos ?? null,
    demoUsername: "alat_demo",
  };

  const tg =
    bot && cfg.botToken
      ? {
          ...webhookSecrets(cfg.botToken),
          handle: webhookCallback(bot, "std/http", {
            secretToken: webhookSecrets(cfg.botToken).header,
            onTimeout: "return",
            timeoutMilliseconds: 55_000,
          }),
          async setWebhook() {
            const s = webhookSecrets(cfg.botToken!);
            await bot!.api.setWebhook(`${cfg.publicUrl}/api/tg/${s.path}`, {
              secret_token: s.header,
              allowed_updates: ["message"],
              drop_pending_updates: false,
            });
            return bot!.api.getWebhookInfo();
          },
        }
      : undefined;

  const app = createApp(alat, demo, {
    rest: cfg.rest,
    webDist: opts.serveWeb ? cfg.webDist : undefined,
    info,
    tg,
    stats: async () => ({
      registry: await chain.registryCounts(),
      ...(await db.stats()),
      recentRefusals: await db.recentRefusals(8),
      readAt: new Date().toISOString(),
    }),
  });
  // Point Telegram at this deployment when it isn't already (once per cold start).
  if (tg && opts.serveWeb === false && cfg.publicUrl.startsWith("https://")) {
    const want = `${cfg.publicUrl}/api/tg/${tg.path}`;
    const current = await within(bot!.api.getWebhookInfo(), 8_000, "telegram getWebhookInfo");
    if (current && current.url !== want) {
      const set = await within(tg.setWebhook(), 8_000, "telegram setWebhook");
      console.log(`telegram webhook ${set ? "set" : "NOT set"}: ${want.replace(tg.path, "<secret>")}`);
    }
  }
  return { app, cfg, alat, demo, bot };
}
