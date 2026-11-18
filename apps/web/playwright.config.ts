import { defineConfig } from "@playwright/test";

// In a sandbox whose outbound traffic goes through a proxy, give it to the browser
// too, so the wallet mock can reach the testnet.
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  use: { baseURL: "http://localhost:5179", launchOptions: proxy ? { proxy } : {} },
  webServer: { command: "pnpm vite --port 5179 --strictPort", url: "http://localhost:5179", reuseExistingServer: true },
});
