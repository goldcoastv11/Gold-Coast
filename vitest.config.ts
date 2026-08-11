import { defineConfig } from "vitest/config";

/**
 * Test config for pure-logic modules only (ledger, payout math, package
 * tiers, playthrough tracking, skin shop backend, etc.) as they land.
 * Scene/UI-level Phaser code is covered instead by the manual checklist in
 * SMOKE_TESTS.md - it's impractical (and low value) to unit test Phaser
 * scenes directly.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"]
  }
});
