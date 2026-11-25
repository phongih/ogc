import { defineConfig } from "vitest/config";

// Backend tests run in a Node environment and exercise the real HTTP server.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // kernel.test.ts and seed.test.ts each stand up the global IIOS roles and the `dak`
    // database; running test files in parallel would race on those shared objects.
    fileParallelism: false,
  },
});
