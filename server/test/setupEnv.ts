/**
 * Vitest `setupFiles` hook - runs before each test file's imports, in every
 * test worker. test/globalSetup.ts sets process.env.DATABASE_URL to the
 * throwaway test Postgres cluster's connection string before any worker is
 * forked, so workers inherit it directly - nothing to read here beyond
 * asserting it's actually there (a missing value almost certainly means
 * globalSetup didn't run, e.g. someone invoked vitest directly bypassing
 * vitest.config.ts, which is worth a clear error rather than a confusing
 * Prisma connection failure later).
 */

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set - test/globalSetup.ts should have set it before this ran. " +
      "Run tests via `npm test` (uses vitest.config.ts's globalSetup), not vitest directly " +
      "without that config."
  );
}

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret-do-not-use-in-prod";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";
