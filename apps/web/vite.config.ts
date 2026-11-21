/// <reference types="vitest" />
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build id shown in the app footer, so a stale browser tab is easy to spot (21/11: a tab kept the
// pre-deploy JS). Release snapshots carry `.release-sha` (release-checkout.sh); dev uses git.
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
  server: { host: "127.0.0.1", port: 5180 }, // container localhost only
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
