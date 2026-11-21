import type { Page } from "@playwright/test";

/**
 * The real QoreX extension talks to the QoreChain REST API from its own context.
 * The wallet mock runs inside the page, where the public API's missing CORS
 * headers block it. This test-only shim fetches those requests outside the page
 * and adds the headers. The app itself never calls the API directly.
 */
export async function allowQoreRestFromPage(page: Page) {
  await page.route("https://api-testnet.qore.host/**", async (route) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), ...cors } });
  });
}
