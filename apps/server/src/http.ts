import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { Hono } from "hono";
import { isQorAddress } from "@alat/core";
import { SCENARIOS, type Demo } from "./demo.ts";
import { AlatError, type Alat } from "./service.ts";

const TX = /^(0x)?[0-9a-fA-F]{64}$/;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

/** Read-only REST paths the site may reach through /lcd-testnet (the public API sends no CORS headers). */
const LCD_ALLOWED = [/^\/cosmos\/bank\/v1beta1\/balances\//, /^\/qorechain\/pqc\/v1\/account\//, /^\/cosmos\/tx\/v1beta1\/txs\/[0-9A-Fa-f]{64}$/];

export function createApp(alat: Alat, demo: Demo, opts: { rest: string; webDist: string; info: Record<string, unknown>; stats: () => Promise<unknown> }) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof AlatError) {
      const status = err.code === "not-found" ? 404 : err.code === "not-yet-on-chain" ? 409 : 422;
      return c.json({ error: err.code, message: err.message }, status);
    }
    console.error(err);
    return c.json({ error: "server", message: "Something went wrong on Alat's side. Try again." }, 500);
  });

  const txBody = async (c: { req: { json(): Promise<unknown> } }) => {
    const b = (await c.req.json().catch(() => ({}))) as { txHash?: unknown };
    if (typeof b.txHash !== "string" || !TX.test(b.txHash)) throw new AlatError("bad-request", "txHash must be a transaction hash.");
    return b.txHash.replace(/^0x/, "").toUpperCase();
  };

  app.get("/api/info", (c) => c.json(opts.info));
  app.get("/api/stats", async (c) => c.json(await opts.stats()));

  app.get("/api/link/:token", async (c) => c.json(await alat.linkInfo(c.req.param("token"))));
  app.post("/api/link/:token", async (c) => c.json(await alat.submitLink(c.req.param("token"), await txBody(c))));

  app.get("/api/check/:id", async (c) => c.json(await alat.checkView(c.req.param("id"))));

  app.get("/api/owner/:address", async (c) => {
    const a = c.req.param("address");
    if (!isQorAddress(a)) throw new AlatError("bad-request", "Not a qor1 address.");
    const [checks, accounts] = await Promise.all([alat.pendingFor(a), alat.ownedAccounts(a)]);
    return c.json({ checks, accounts });
  });
  app.post("/api/answer", async (c) => c.json(await alat.submitAnswer(await txBody(c))));
  app.post("/api/cancel", async (c) => c.json(await alat.submitCancel(await txBody(c))));

  // The judge demo. Answers are real hybrid-signed testnet transactions by the demo key.
  app.get("/api/demo", (c) => c.json({ scenarios: SCENARIOS, account: demo.account }));
  app.post("/api/demo/check", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { scenario?: string };
    if (b.scenario !== "hacker" && b.scenario !== "real") throw new AlatError("bad-request", "scenario must be hacker or real");
    const r = await demo.start(b.scenario);
    return c.json(r.notLinked ? { notLinked: true } : { id: r.check.id, view: r.view });
  });
  app.post("/api/demo/:id/answer", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { answer?: string };
    if (b.answer !== "yes" && b.answer !== "no") throw new AlatError("bad-request", "answer must be yes or no");
    return c.json(await demo.answer(c.req.param("id"), b.answer));
  });
  app.post("/api/demo/:id/forge", async (c) => c.json(await demo.forge(c.req.param("id"))));

  app.get("/lcd-testnet/*", async (c) => {
    const url = new URL(c.req.url);
    const path = url.pathname.replace(/^\/lcd-testnet/, "");
    if (!LCD_ALLOWED.some((r) => r.test(path))) return c.json({ error: "not allowed" }, 403);
    const res = await fetch(`${opts.rest}${path}${url.search}`);
    return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
  });

  // The built site, with every unknown path served the SPA's index.html.
  app.get("*", (c) => {
    const p = normalize(decodeURIComponent(new URL(c.req.url).pathname)).replace(/^(\.\.[/\\])+/, "");
    const file = join(opts.webDist, p);
    if (file.startsWith(opts.webDist) && extname(file) && existsSync(file)) {
      return new Response(readFileSync(file), {
        headers: { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "public, max-age=3600" },
      });
    }
    const index = join(opts.webDist, "index.html");
    if (!existsSync(index)) return c.text("The site is not built. Run pnpm --filter @alat/web build.", 503);
    return c.html(readFileSync(index, "utf8"));
  });

  return app;
}
