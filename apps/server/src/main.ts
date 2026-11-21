/**
 * Local server: the site, the API and the Telegram bot by long polling.
 * On Vercel the same app runs as a function (vercel.ts) and the bot by webhook.
 */
import { serve } from "@hono/node-server";
import { build } from "./app.ts";
import { COMMANDS } from "./bot.ts";

const { app, cfg, bot } = await build({ serveWeb: true });

if (bot) {
  // Long polling locally: a webhook set by a deployment would steal the updates, so remove it.
  await bot.api.deleteWebhook();
  await bot.api.setMyCommands(COMMANDS).catch(() => undefined);
  void bot.start({ onStart: (me) => console.log(`bot @${me.username} running (long polling)`) });
} else {
  console.log("BOT_TOKEN not set: running without Telegram (site and API only).");
}

serve({ fetch: app.fetch, port: cfg.port }, (i) => console.log(`Alat on http://localhost:${i.port} (public URL ${cfg.publicUrl})`));
