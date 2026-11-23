import { defineConfig } from "vitest/config";

// Backend tests run in a Node environment and exercise the real HTTP server.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
