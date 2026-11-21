/**
 * Vercel function entry: every /api request. The site itself is served as
 * static files. Built into one bundle by scripts/vercel-build.mjs.
 */
import { build } from "./app.ts";

let ready: ReturnType<typeof build> | undefined;

const handler = {
  async fetch(request: Request): Promise<Response> {
    ready ??= build({ serveWeb: false }).catch((e) => {
      ready = undefined;
      throw e;
    });
    const { app } = await ready;
    return app.fetch(request);
  },
};

export default handler;

// The same handler under the method names Vercel's Node runtime looks for.
export const GET = (request: Request) => handler.fetch(request);
export const POST = (request: Request) => handler.fetch(request);
