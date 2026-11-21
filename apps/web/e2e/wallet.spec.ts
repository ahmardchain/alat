import { expect, test } from "@playwright/test";
import { createQorexMock } from "@qorechain/qorex-wallet-mock";
import { allowQoreRestFromPage } from "./cors.ts";

// The mock injects the same window.qorex objects QoreX injects and signs for real
// (hybrid secp256k1 + ML-DSA-87). Its default mnemonic is the public test phrase.
test("connects QoreX and shows the qor1 account", async ({ page }) => {
  const mock = createQorexMock({ profile: "current" });
  await page.addInitScript({ content: mock.initScript() });
  await page.goto("/wallet");
  await page.getByRole("button", { name: "Connect QoreX" }).click();
  await expect(page.getByTestId("address")).toHaveText(/^qor1[02-9ac-hj-np-z]{38}$/);
});

test("says so when QoreX is not installed", async ({ page }) => {
  await page.goto("/wallet");
  await expect(page.getByText("QoreX was not found in this browser.")).toBeVisible();
});

// A real broadcast needs a funded mnemonic: ALAT_E2E_MNEMONIC (never the public phrase).
test("signs and broadcasts a hybrid transaction", async ({ page }) => {
  const mnemonic = process.env.ALAT_E2E_MNEMONIC;
  test.skip(!mnemonic, "set ALAT_E2E_MNEMONIC to a funded testnet mnemonic");
  const mock = createQorexMock({ profile: "current", mnemonic });
  await allowQoreRestFromPage(page);
  await page.addInitScript({ content: mock.initScript() });
  await page.goto("/wallet");
  await page.getByRole("button", { name: "Connect QoreX" }).click();
  await page.getByRole("button", { name: "Sign with QoreX" }).click();
  await expect(page.getByTestId("result")).toHaveText("included", { timeout: 60_000 });
  await expect(page.getByText("shielded")).toBeVisible();
});
