/**
 * The whole flow on the QoreChain testnet, against a running Alat server
 * (pnpm --filter @alat/server dev). The QoreX wallet mock plays the owner and
 * signs for real (hybrid secp256k1 + ML-DSA-87). Opt in with ALAT_LIVE=1.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { createQorexMock } from "@qorechain/qorex-wallet-mock";
import { allowQoreRestFromPage } from "./cors.ts";

const live = process.env.ALAT_LIVE === "1";
const server = process.env.ALAT_SERVER ?? "http://localhost:8787";
const owner = process.env.ALAT_E2E_MNEMONIC;
const tgUser = process.env.ALAT_E2E_TG_USER ?? String(900_000 + Math.floor(Math.random() * 99_999));

function devtool(...args: string[]): Record<string, unknown> {
  const out = execFileSync("pnpm", ["-s", "devtool", ...args], {
    cwd: resolve(import.meta.dirname, "../../server"),
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  }).toString();
  return JSON.parse(out.trim().split("\n").at(-1)!);
}

test.describe.configure({ mode: "serial" });
test.skip(!live || !owner, "set ALAT_LIVE=1 and ALAT_E2E_MNEMONIC (a funded testnet mnemonic)");
test.use({ baseURL: server });
test.setTimeout(240_000);

test("link once with QoreX: hybrid tx, then AlatRegistry write", async ({ page }) => {
  const t = devtool("link-token", tgUser, `e2e_${tgUser}`);
  await allowQoreRestFromPage(page);
  await page.addInitScript({ content: createQorexMock({ profile: "current", mnemonic: owner }).initScript() });
  await page.goto(String(t.url).replace(/^https?:\/\/[^/]+/, server));
  await page.getByRole("button", { name: "Connect QoreX" }).click();
  await page.getByRole("button", { name: "Sign and link" }).click();
  await expect(page.getByTestId("link-result")).toContainText("Linked.", { timeout: 180_000 });
  console.log("linked:", await page.getByTestId("link-result").innerText());
});

test("hacker scenario: owner answers 'No, that's not me' → ❌", async ({ page }) => {
  const c = devtool("check", tgUser, "I'm stuck, please send 200 urgently");
  await allowQoreRestFromPage(page);
  await page.addInitScript({ content: createQorexMock({ profile: "current", mnemonic: owner }).initScript() });
  await page.goto("/respond");
  await page.getByRole("button", { name: "Connect QoreX" }).click();
  await expect(page.getByTestId("pending-check")).toContainText("send 200 urgently", { timeout: 30_000 });
  await page.getByRole("button", { name: "No, that's not me" }).click();
  await expect(page.getByTestId("answered")).toContainText("not you", { timeout: 120_000 });
  await page.goto(`/c/${c.id}`);
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "denied");
});

test("refuses a signature from a different key, then ✅ from the owner", async ({ page, request }) => {
  const c = devtool("check", tgUser, "can you lend me 50");
  // The relayer's key is a real, registered ML-DSA-87 key, but not the one linked to this account.
  const forged = devtool("sign-answer", "relayer", String(c.nonce), "yes");
  let res = await request.post("/api/answer", { data: { txHash: forged.hash } });
  for (let i = 0; res.status() === 409 && i < 10; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    res = await request.post("/api/answer", { data: { txHash: forged.hash } });
  }
  expect(res.status()).toBe(422);
  expect((await res.json()).error).toBe("wrong-signer");
  console.log("refused tx (wrong key):", forged.hash);

  await allowQoreRestFromPage(page);
  await page.addInitScript({ content: createQorexMock({ profile: "current", mnemonic: owner }).initScript() });
  await page.goto("/respond");
  await page.getByRole("button", { name: "Connect QoreX" }).click();
  await page.getByRole("button", { name: "Yes, that's me" }).click();
  await expect(page.getByTestId("answered")).toContainText("confirmed", { timeout: 120_000 });
  await page.goto(`/c/${c.id}`);
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "confirmed");
});

test("re-link from Telegram alone: waits 7 days, flagged on every check, the old key cancels it", async ({ page, request }) => {
  // The "hacker" controls the Telegram account and asks for a link to their own key.
  const t = devtool("link-token", tgUser, `e2e_${tgUser}`);
  const hackerTx = devtool("sign-link", "relayer", String(t.token));
  let res = await request.post(`/api/link/${t.token}`, { data: { txHash: hackerTx.hash } });
  for (let i = 0; res.status() === 409 && i < 10; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    res = await request.post(`/api/link/${t.token}`, { data: { txHash: hackerTx.hash } });
  }
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.kind).toBe("change-pending");
  console.log("hacker re-link request:", hackerTx.hash, "registry:", body.evmTx, "unlocks:", new Date(body.unlockAtMs).toISOString());

  // Every check now carries the warning, and the old key still answers.
  const c = devtool("check", tgUser, "new phone, send money here");
  const v = await (await request.get(`/api/check/${c.id}`)).json();
  expect(v.pending?.newOwner).toBe(hackerTx.signer);

  // The real owner cancels with their key.
  await allowQoreRestFromPage(page);
  await page.addInitScript({ content: createQorexMock({ profile: "current", mnemonic: owner }).initScript() });
  await page.goto("/respond");
  await page.getByRole("button", { name: "Connect QoreX" }).click();
  await page.getByRole("button", { name: "Cancel this change" }).click();
  await expect(page.getByText("Change cancelled.")).toBeVisible({ timeout: 120_000 });
  const after = await (await request.get(`/api/check/${c.id}`)).json();
  expect(after.pending).toBeNull();
  expect(after.link.owner).not.toBe(hackerTx.signer);
});
