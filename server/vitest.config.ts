import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/globalSetup.ts"],
    setupFiles: ["./test/setupEnv.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false
  }
});
