import { observeTx, type Hex32 } from "@alat/core";
import { Chain } from "./chain.ts";
import { loadConfig } from "./config.ts";
import { Db } from "./db.ts";
import { Alat, type ChainPort, type Notifier } from "./service.ts";

/** Build Alat from the environment. The notifier can be swapped once the bot is up. */
export async function wire() {
  const cfg = loadConfig();
  const db = new Db(cfg.dbPath);
  const chain = new Chain(cfg);
  const port: ChainPort = {
    linkOf: (a: Hex32) => chain.linkOf(a),
    pendingOf: (a: Hex32) => chain.pendingOf(a),
    link: (a, o, t) => chain.link(a, o, t),
    requestChange: (a, o, t) => chain.requestChange(a, o, t),
    cancelChange: (a, t) => chain.cancelChange(a, t),
    observe: (hash) => observeTx({ rest: cfg.rest, chainId: cfg.chainId, hash }),
  };
  const holder: { notifier: Notifier } = {
    notifier: {
      async checkChanged(c, v) {
        console.log(`check ${c.id}: ${v.verdict}`);
      },
      async toOwner(chatId, text) {
        console.log(`to ${chatId}: ${text}`);
      },
    },
  };
  const alat = new Alat(
    db,
    port,
    { checkChanged: (c, v) => holder.notifier.checkChanged(c, v), toOwner: (a, b, u) => holder.notifier.toOwner(a, b, u) },
    { salt: cfg.salt, publicUrl: cfg.publicUrl },
  );
  return { cfg, db, chain, alat, holder };
}
