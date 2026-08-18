/**
 * Entrypoint. Boots in explicit numbered stages via dynamic import() rather
 * than static `import` at the top of the file.
 *
 * Why: static imports execute BEFORE any of this file's own top-level code
 * runs - so a console.log placed after a block of `import ... from` lines
 * does NOT run first; everything those modules (and everything THEY import
 * transitively - env validation, the Prisma client, every route file) do at
 * their own module scope runs first, silently, with no log line to show it
 * happened. On Railway, deploy logs have repeatedly gone completely silent
 * right after `prisma migrate deploy` finishes, even with an "early" log
 * line in this file and even after ruling out PORT, CHECKPOINT_DISABLE,
 * host binding, and npx overhead individually - none of those fixes could
 * have shown up in the logs anyway if something upstream of this file's own
 * code was the actual hang/crash, because a static-import version of this
 * file never gets to run its own console.log until AFTER that already
 * happened. Dynamic import() defers loading each module to a point we
 * control, with a log immediately before and after each one, so the next
 * deploy's log output pinpoints exactly which stage (or proves none of
 * them) is where this dies.
 */

process.on("uncaughtException", (err) => {
  console.error("boot: uncaughtException", err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error("boot: unhandledRejection", err);
  process.exit(1);
});

console.log("boot: entrypoint reached (stage 0)");

async function main() {
  console.log("boot: importing ./env (stage 1)");
  const { env } = await import("./env");
  console.log(`boot: env loaded (stage 1 done) - PORT=${env.PORT} CORS_ORIGIN=${env.CORS_ORIGIN}`);

  console.log("boot: importing ./db (stage 2)");
  await import("./db");
  console.log("boot: PrismaClient constructed (stage 2 done)");

  console.log("boot: importing ./app (stage 3 - registers all routes)");
  const { app } = await import("./app");
  console.log("boot: app module loaded (stage 3 done)");

  console.log("boot: calling app.listen (stage 4)");
  app.listen(env.PORT, "0.0.0.0", () => {
    console.log(`casino-poc server listening on http://0.0.0.0:${env.PORT} (stage 4 done)`);
  });
}

main().catch((err) => {
  console.error("boot: fatal error during startup", err);
  process.exit(1);
});
