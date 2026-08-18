/**
 * Local dev Postgres, no Docker/cloud account required.
 *
 * Uses `embedded-postgres` (downloads real Postgres binaries for this
 * platform once, via npm postinstall) to run a genuine local Postgres
 * cluster in casino-poc/server/.pgdata, matching .env.example's
 * DATABASE_URL exactly. This is dev/test tooling only - production
 * (Railway or similar) uses a real managed Postgres instance, see
 * ../DEPLOYMENT.md.
 *
 * Usage:
 *   node scripts/dev-db.js up      - initialise (first run only) + start.
 *                                     Starts postgres via `pg_ctl start`
 *                                     directly (see the comment inside `up`
 *                                     for why, instead of embedded-postgres's
 *                                     own `.start()`) and returns as soon as
 *                                     it's confirmed ready - it does NOT need
 *                                     to be run in the background/kept open.
 *   node scripts/dev-db.js down    - stops it.
 *   node scripts/dev-db.js restart - down + up. The known fix for the
 *                                     Windows ASLR "could not reserve shared
 *                                     memory region" issue below - see that
 *                                     comment for what this is and isn't a
 *                                     fix for.
 *
 * Exposed as `npm run db:up` / `npm run db:down` / `npm run db:restart`.
 *
 * ---- Known issue: intermittent "could not reserve shared memory region"
 * ---- (error code 487) in pg-dev.log, connections/queries start 500ing
 *
 * This is a long-standing upstream PostgreSQL-on-Windows bug, not something
 * specific to this project or to embedded-postgres - Windows doesn't have
 * fork(), so Postgres re-execs a fresh postgres.exe process per connection
 * on Windows and has to remap the postmaster's shared memory segment at the
 * *identical* virtual address in that new process; Windows' ASLR
 * (address-space layout randomization, present since Windows 8/2012)
 * sometimes hands the new process a layout where that exact address is
 * already occupied, and the connection fails. It's occasionally-recurring
 * by nature (each new connection re-rolls the dice), not a one-time crash -
 * see pg-dev.log for a burst of these if it's happening. Documented
 * upstream since ~2012, e.g.
 * https://www.postgresql.org/message-id/5046CAEB.4010600@grammatech.com -
 * the real fixes require relinking postgres.exe with different flags
 * (`/highentropyva:no` / `/dynamicbase:no`), which isn't possible here
 * since embedded-postgres ships prebuilt binaries we don't control the
 * build of.
 *
 * What actually works, in order of how much it costs to do:
 *   1. `npm run db:restart` (or `db:down` then `db:up`) - a fresh postmaster
 *      renegotiates its address layout and is typically fine again for a
 *      while. This is the fix qa already found and used - no data lost
 *      (same persistent .pgdata dir).
 *   2. If it recurs often enough to be annoying: an admin can disable ASLR
 *      specifically for postgres.exe (not system-wide) via, in an elevated
 *      PowerShell, one time:
 *        Set-ProcessMitigation -Name postgres.exe -Disable ForceRelocateImages
 *      This is a real Windows security-mitigation setting change, so it's
 *      deliberately NOT something this script (or any agent working on this
 *      repo) applies automatically - it's a manual, opt-in step for whoever
 *      owns the machine, documented here rather than silently done. See
 *      README.md's troubleshooting section too.
 */

const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const { spawnSync } = require("node:child_process");

const DATA_DIR = path.join(__dirname, "..", ".pgdata");
const PORT = 54329;
const USER = "casino";
const PASSWORD = "casino";
const DB_NAME = "casino_poc";
const LOG_FILE = path.join(__dirname, "..", "pg-dev.log");

async function loadEmbeddedPostgres() {
  // embedded-postgres is ESM-only; this script is CommonJS, so a dynamic
  // import is required to load it.
  const mod = await import("embedded-postgres");
  return mod.default;
}

function resolvePgBinary(name) {
  const scopeDir = path.join(__dirname, "..", "node_modules", "@embedded-postgres");
  if (!fs.existsSync(scopeDir)) {
    throw new Error("embedded-postgres not installed - run `npm install` first.");
  }
  const platformPkg = fs.readdirSync(scopeDir)[0];
  const bin = path.join(
    scopeDir,
    platformPkg,
    "native",
    "bin",
    process.platform === "win32" ? `${name}.exe` : name
  );
  if (!fs.existsSync(bin)) {
    throw new Error(`Could not find bundled ${name} binary at ${bin}`);
  }
  return bin;
}

function isPortOpen(port, host = "127.0.0.1", timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const finish = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function printConnectionInfo() {
  const url = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}?schema=public`;
  console.log(`\nPostgres is up on 127.0.0.1:${PORT}, database "${DB_NAME}".`);
  console.log(`DATABASE_URL=${url}`);
  console.log("(matches .env.example's default - copy .env.example to .env and you're set)");
  console.log("It's running as an independent daemon - this command has already returned,");
  console.log('no terminal needs to stay open for it. Run "npm run db:down" to stop it.\n');
}

async function up() {
  const EmbeddedPostgres = await loadEmbeddedPostgres();
  // Only used for `.initialise()` (initdb - a short-lived, one-shot step)
  // and `.getPgClient()` below. Starting/stopping the long-lived server
  // itself goes through `pg_ctl` directly further down, not this object's
  // own `.start()`/`.stop()` - see the comment there for why.
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true
  });

  const alreadyInitialised = fs.existsSync(DATA_DIR) && fs.readdirSync(DATA_DIR).length > 0;
  if (!alreadyInitialised) {
    await pg.initialise();
  }

  if (await isPortOpen(PORT)) {
    console.log(`Postgres already up on 127.0.0.1:${PORT} - nothing to do.`);
    printConnectionInfo();
    return;
  }

  // A postmaster.pid left over from an instance that got killed hard
  // (SIGKILL/taskkill, not a clean `pg_ctl stop`) makes the next start
  // attempt refuse to run ("lock file already exists") even though nothing
  // is actually listening on PORT (just confirmed above) - clear it first.
  // Been bitten by exactly this after a background task got reaped taking
  // Postgres down with it - see team chat around 2026-08-15.
  const pidFile = path.join(DATA_DIR, "postmaster.pid");
  if (fs.existsSync(pidFile)) {
    console.log("Found a stale postmaster.pid (previous instance didn't shut down cleanly) - clearing it.");
    fs.rmSync(pidFile, { force: true });
  }

  const pgCtl = resolvePgBinary("pg_ctl");

  // Deliberately NOT embedded-postgres's own `.start()` (which spawns
  // postgres as a child process tied to *this* Node process's lifetime and
  // stops it when that process exits/dies). `pg_ctl start` daemonizes
  // postgres as a genuinely independent process and this command returns
  // once it's confirmed ready - so the cluster survives regardless of what
  // happens to whatever shell/task ran `db:up`, instead of dying whenever
  // that task gets torn down (observed happening more than once with a
  // long-lived `db:up` process kept alive as a background task).
  const result = spawnSync(pgCtl, ["start", "-D", DATA_DIR, "-o", `-p ${PORT}`, "-l", LOG_FILE, "-w"], {
    stdio: "inherit"
  });
  if (result.status !== 0) {
    console.error(`pg_ctl start failed (exit ${result.status}) - see ${LOG_FILE}`);
    process.exit(result.status ?? 1);
  }

  // Not `pg.createDatabase()` - that method guards on `this.process` being
  // set by this object's own `.start()`, which we deliberately didn't call.
  // `.getPgClient()` has no such guard, so use it directly instead.
  const client = pg.getPgClient();
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${client.escapeIdentifier(DB_NAME)}`);
  } catch (err) {
    if (!/already exists/i.test(String(err && err.message))) throw err;
  } finally {
    await client.end();
  }

  printConnectionInfo();
}

async function down() {
  if (!fs.existsSync(DATA_DIR)) {
    console.log("No data directory found - nothing to stop.");
    return;
  }
  const pgCtl = resolvePgBinary("pg_ctl");
  const result = spawnSync(pgCtl, ["stop", "-D", DATA_DIR, "-m", "fast"], { stdio: "inherit" });
  if (result.status === 0) {
    console.log("Postgres stopped.");
  } else {
    console.log("pg_ctl stop reported a problem (see above) - it may already not have been running.");
  }
}

async function restart() {
  await down();
  await up();
}

const cmd = process.argv[2];
if (cmd === "up") {
  up().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else if (cmd === "down") {
  down().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else if (cmd === "restart") {
  restart().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  console.error("Usage: node scripts/dev-db.js <up|down|restart>");
  process.exit(1);
}
