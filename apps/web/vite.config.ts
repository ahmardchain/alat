import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the Alat server (apps/server, port 8787) answers /api and
// /lcd-testnet; in production it serves this build itself.
const proxy = {
  "/api": "http://localhost:8787",
  "/lcd-testnet": "http://localhost:8787",
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { proxy },
});
