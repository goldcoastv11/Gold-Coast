/**
 * Vitest global setup: spins up a throwaway embedded Postgres cluster (real
 * Postgres binaries, no Docker/cloud needed - see scripts/dev-db.js for the
 * persistent dev equivalent) in its own temp data directory/port, separate
 * from the dev cluster, runs `prisma db push` against it to create the
 * schema, and sets `process.env.DATABASE_URL` so test/setupEnv.ts (a
 * per-file `setupFiles` hook, running in each forked worker process) can
 * just read it off `process.env` before any test imports the Prisma
 * client.
 *
 * That last part used to go through a shared file (test/.test-db-url.json)
 * instead of `process.env` directly, based on an untested assumption that
 * env vars set here wouldn't propagate to workers. That assumption was
 * wrong - Vitest doesn't spawn the worker pool until this whole `setup()`
 * resolves, and workers inherit this process's env at fork time same as
 * any other Node child process, so a plain `process.env.DATABASE_URL =`
 * here reaches them fine. Found while investigating a real, confirmed bug
 * the file-based version had: the file's path was fixed/shared, not
 * per-invocation, so two `npm test` runs overlapping in time (e.g. two
 * teammates running it at once against this same shared checkout) would
 * stomp on each other's connection info mid-run - a worker in one run
 * could read the other run's URL, or one already torn down, producing
 * exactly the "works standalone, flakes intermittently, exit code
 * sometimes looks fine despite real failures" symptom this was reported
 * as. Reading `process.env` instead has no shared mutable state on disk at
 * all, so no cross-invocation collision is possible regardless of timing.
 *
 * Runs once for the whole `vitest run` invocation; torn down in `teardown`.
 */

import EmbeddedPostgres from "embedded-postgres";
import asyncExitHook from "async-exit-hook";
import { execSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

// CRITICAL, non-obvious: importing `embedded-postgres` (above) has a
// module-level side effect - it calls into `async-exit-hook` (a transitive
// dependency, not something we call ourselves), which registers several
// `process.on(...)` handlers on THIS process, including
// `process.on('beforeExit', () => process.exit(0))`. `globalSetup` runs in
// the same process as the `vitest` CLI itself (not a forked child), so
// those handlers land on vitest's own process. Node's `beforeExit` fires
// whenever the event loop naturally goes idle - i.e. exactly what happens
// right as a normal `vitest run` finishes and is about to exit with
// whatever code it computed from the test results. That handler firing
// FIRST forces `process.exit(0)`, silently discarding vitest's real exit
// code - confirmed by direct reproduction: a run with exactly one
// deliberately-failing test, correctly reported by vitest's own summary
// ("1 failed | N passed"), still exited 0 both via `npm test` and via
// `npx vitest run` directly. Real and deterministic given the import, not
// a fluke - it races with vitest's own shutdown path (whichever gets to
// call `process.exit` first wins), which is presumably why it was
// reported as intermittent rather than every single time.
//
// First attempt was surgical - unhook only `beforeExit`, leave
// SIGINT/SIGTERM/etc. (which run `pg.stop()` for crash-safety) alone. That
// uncovered a SECOND bug: with `beforeExit` gone, Node's plain `'exit'`
// event becomes the first thing to trigger async-exit-hook's internal
// dispatch, and for that specific event async-exit-hook always invokes
// hooks *synchronously*, with no callback - but embedded-postgres's
// registered hook is an async function expecting one, so it throws
// ("done is not a function") as an unhandled rejection right as the
// process exits. That's not merely cosmetic: it flips a genuinely
// all-passing run's exit code to 1 too (confirmed - reproduced a clean
// 117/117 run still exiting 1 because of this), which is a *worse* bug
// than the one being fixed (a false failure signal, not just a false
// success one).
//
// Fix: don't try to keep any part of async-exit-hook's hook active here.
// Its only job for our EmbeddedPostgres instance is calling `.stop()`,
// which `teardown()` below already does explicitly and unconditionally
// once vitest finishes - there's nothing left for a crash-safety net to
// add for OUR instance specifically in the one scenario it could still
// matter (a graceful Ctrl+C mid-run), and `.stop()` is idempotent (a
// no-op if already stopped) so even that overlap was always harmless.
// Losing that safety net for a hard kill mid-run is an acceptable
// trade-off - it just leaves one throwaway, uniquely-per-PID-named data
// directory behind (no stale-conflict risk next run, see DATA_DIR below)
// rather than corrupting the actually-important thing here, the exit code.
for (const event of asyncExitHook.hookedEvents()) {
  asyncExitHook.unhookEvent(event);
}

// NOTE: the data dir is suffixed with this process's PID rather than a fixed
// name. On Windows, embedded-postgres/initdb derives its shared-memory
// segment key from the data directory path; a run that gets force-killed
// mid-`initdb` (e.g. by a CI/tool timeout) can leave that OS-level segment
// orphaned, and every subsequent run reusing the same fixed path then fails
// immediately with "pre-existing shared memory block is still in use" even
// though no live Postgres process actually holds it. A unique-per-run path
// sidesteps collision with any such leaked segment from a prior aborted run.
const DATA_DIR = path.join(__dirname, "..", `.pgdata-test-${process.pid}`);
const USER = "casino_test";
const PASSWORD = "casino_test";
const DB_NAME = "casino_poc_test";

/**
 * Asks the OS for a free TCP port by binding to port 0 and reading back
 * whatever it assigned, then releasing it. Used instead of a hardcoded port
 * constant.
 *
 * History: this was a fixed port (54330, then bumped to 54331 after 54330
 * got stuck) before this fix. A test run that gets force-killed mid-suite
 * can leave Windows' TCP table with a stale LISTEN/CLOSE_WAIT entry for
 * whatever port embedded-postgres had bound, owned by a PID that no longer
 * exists (confirmed repeatedly via Get-NetTCPConnection + Get-Process - not
 * a live process, just a leaked kernel-level table entry) - and unlike a
 * stale `postmaster.pid` lock file (see scripts/dev-db.js's `up`), there's
 * no user-mode fix for that: no process to stop, no file to delete, just
 * an OS TCP table entry that isn't ours to clear without admin rights.
 * Bumping the hardcoded constant by hand each time this recurred wasn't a
 * fix, just a delay until the next occurrence (happened twice). Asking the
 * OS for whatever's actually free right now, every run, sidesteps the
 * entire failure mode permanently instead of chasing individual stuck
 * ports - the same "stop hand-managing a fixed resource, self-heal
 * instead" spirit as scripts/dev-db.js's stale-lock-file handling.
 */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address && typeof address === "object") {
        const { port } = address;
        probe.close(() => resolve(port));
      } else {
        probe.close(() => reject(new Error("findFreePort: could not read back the assigned port")));
      }
    });
  });
}

export async function setup() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  const PORT = await findFreePort();

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: false
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB_NAME);

  const url = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}?schema=public`;
  process.env.DATABASE_URL = url;

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit"
  });

  return async function teardown() {
    await pg.stop();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  };
}
