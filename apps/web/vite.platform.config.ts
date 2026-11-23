/// <reference types="vitest" />
/*
 * OGC Platform web build (ADR-040): a separate entry from the demo. It talks to the Platform API
 * only (same origin, `/v1/…` proxied by nginx) and must never contain the demo's mock adapters or
 * synthetic fixtures — `ops/release/check-bundle.mjs` enforces that on `dist-platform/`.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function buildId(): string {
  try {
    return readFileSync(new URL("../../.release-sha", import.meta.url), "utf8")
      .trim()
      .slice(0, 7);
  } catch {
    try {
      return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      return "dev";
    }
  }
}

export default defineConfig({
  plugins: [react()],
  define: { __OGC_BUILD__: JSON.stringify(buildId()) },
  build: {
    outDir: "dist-platform",
    emptyOutDir: true,
    rollupOptions: { input: "platform.html" },
  },
  server: { host: "127.0.0.1", port: 5181 },
});
