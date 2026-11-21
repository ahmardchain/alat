/**
 * The /demo page against a running server on the testnet. No wallet in the
 * browser: the demo owner's key is held by the server, and every answer is a
 * real hybrid-signed transaction. Opt in with ALAT_LIVE=1.
 */
import { expect, test } from "@playwright/test";

test.skip(process.env.ALAT_LIVE !== "1", "set ALAT_LIVE=1");
test.use({ baseURL: process.env.ALAT_SERVER ?? "http://localhost:8787" });
test.setTimeout(240_000);

test("demo: hacker message, hacker's key refused, owner says not me (❌), then a real request (✅)", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByTestId("stats")).not.toContainText("…", { timeout: 30_000 });

  await page.getByRole("button", { name: "Get the hacker's message" }).click();
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "waiting", { timeout: 60_000 });

  await page.getByRole("button", { name: "Answer “yes” with the hacker's key" }).click();
  await expect(page.getByTestId("forged")).toContainText("different key", { timeout: 120_000 });
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "waiting");
  console.log("forged:", await page.getByTestId("forged").innerText());

  await page.getByRole("button", { name: "No, that's not me" }).click();
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "denied", { timeout: 120_000 });

  await page.getByRole("button", { name: "A real request from the owner" }).click();
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "waiting", { timeout: 60_000 });
  await page.getByRole("button", { name: "Yes, that's me" }).click();
  await expect(page.getByTestId("verdict")).toHaveAttribute("data-verdict", "confirmed", { timeout: 120_000 });
  console.log("verdict:", await page.getByTestId("verdict").innerText());
});
