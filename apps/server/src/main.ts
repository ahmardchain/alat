import { serve } from "@hono/node-server";
import type { Hex32 } from "@alat/core";
import { createBot, TelegramNotifier } from "./bot.ts";
import { createApp } from "./http.ts";
import { wire } from "./wire.ts";

const { cfg, db, chain, alat, holder } = await wire();
const relayer = await chain.relayer();

const label = (account: Hex32) => {
  const a = db.account(account);
  return a?.username ? `@${a.username}` : a?.platform === "demo" ? "the demo account" : "this account";
};

if (cfg.botToken) {
  const b = createBot(cfg.botToken, alat, cfg.publicUrl);
  holder.notifier = new TelegramNotifier(b, cfg.publicUrl, label);
  await b.init();
  void b.start({ onStart: (me) => console.log(`bot @${me.username} running`) });
} else {
  console.log("BOT_TOKEN not set: running without Telegram (site and API only).");
}

setInterval(() => void alat.expireDue().catch((e) => console.error("expiry:", e)), 10_000);

const info = {
  chainId: cfg.chainId,
  evmChainId: 9800,
  registry: cfg.registry,
  registryDeployTx: cfg.registryDeployTx,
  relayer: { native: relayer.cosmos, evm: relayer.evm },
  explorer: "https://explore.qore.network",
};

const app = createApp(alat, {
  rest: cfg.rest,
  webDist: cfg.webDist,
  info,
  stats: async () => ({ ...(await chain.registryCounts()), ...db.stats(), readAt: new Date().toISOString() }),
});

serve({ fetch: app.fetch, port: cfg.port }, (i) => console.log(`Alat on http://localhost:${i.port} (public URL ${cfg.publicUrl})`));
