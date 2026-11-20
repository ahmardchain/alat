/**
 * Build for Vercel with the Build Output API (v3):
 *   .vercel/output/static/              the site (apps/web/dist)
 *   .vercel/output/functions/api.func/  one bundled Node function: the API and the Telegram webhook
 *   .vercel/output/config.json          /api/* and /lcd-testnet/* go to the function; other paths are the SPA
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, ".vercel/output");
rmSync(out, { recursive: true, force: true });

execSync("pnpm --filter @alat/web build", { cwd: root, stdio: "inherit" });
mkdirSync(resolve(out, "static"), { recursive: true });
cpSync(resolve(root, "apps/web/dist"), resolve(out, "static"), { recursive: true });

const fn = resolve(out, "functions/api.func");
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: [resolve(root, "apps/server/src/vercel.ts")],
  outfile: resolve(fn, "index.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // PGlite is only for tests and local runs (no DATABASE_URL); never loaded on Vercel.
  external: ["@electric-sql/pglite"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: "none",
  logLevel: "info",
});
writeFileSync(
  resolve(fn, ".vc-config.json"),
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", supportsResponseStreaming: true, maxDuration: 300 }, null, 2),
);
writeFileSync(resolve(fn, "package.json"), JSON.stringify({ type: "module" }));

writeFileSync(
  resolve(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "^/api/(.*)$", dest: "/api" },
        { src: "^/lcd-testnet/(.*)$", dest: "/api" },
        { handle: "filesystem" },
        { src: "^/(.*)$", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);
console.log("Vercel build output written to .vercel/output");
