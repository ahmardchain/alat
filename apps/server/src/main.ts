import { serve } from "@hono/node-server";
import type { Hex32 } from "@alat/core";
import { createBot, TelegramNotifier } from "./bot.ts";
import { createApp } from "./http.ts";
import { wire } from "./wire.ts";

const { cfg, db, chain, alat, holder, demo } = await wire();
const relayer = await chain.relayer();

const label = (account: Hex32) => {
  const a = db.account(account);
  return a?.username ? `@${a.username}` : a?.platform === "demo" ? "the demo account" : "this account";
};

let botUsername = cfg.botUsername;
if (cfg.botToken) {
  const b = createBot(cfg.botToken, alat, cfg.publicUrl, demo);
  holder.notifier = new TelegramNotifier(b, cfg.publicUrl, label);
  await b.init();
  botUsername = b.botInfo.username;
  void b.start({ onStart: (me) => console.log(`bot @${me.username} running`) });
} else {
  console.log("BOT_TOKEN not set: running without Telegram (site and API only).");
}

if (cfg.demoOwnerMnemonic) {
  demo.setup().then(
    (r) => console.log(`demo account: ${r.state}${r.nativeTx ? ` (${r.nativeTx})` : ""}`),
    (e) => console.error("demo setup failed:", e instanceof Error ? e.message : e),
  );
}

setInterval(() => void alat.expireDue().catch((e) => console.error("expiry:", e)), 10_000);

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
  firstHybridTx: "D17E9DDC1DAD4D8AEF248B6E1C3EC46C43076DF81A8705BB8D8476CC8B1D8162",
  demoOwner: (await chain.demoOwner())?.cosmos ?? null,
  demoUsername: "alat_demo",
};

const app = createApp(alat, demo, {
  rest: cfg.rest,
  webDist: cfg.webDist,
  info,
  stats: async () => ({
    registry: await chain.registryCounts(),
    ...db.stats(),
    recentRefusals: db.recentRefusals(8),
    readAt: new Date().toISOString(),
  }),
});

serve({ fetch: app.fetch, port: cfg.port }, (i) => console.log(`Alat on http://localhost:${i.port} (public URL ${cfg.publicUrl})`));
