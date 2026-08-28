#!/usr/bin/env node
/**
 * Daily metrics rundown, for the CTO's standup (founder directive 2026-08-27).
 *
 * READ-ONLY. Every query here is a SELECT. This script must never write to,
 * migrate, or otherwise mutate the database - it is run unattended against
 * PRODUCTION every morning, so a write here would be a write nobody reviewed.
 *
 * Usage, from server/:
 *   node scripts/metrics.js              # against DATABASE_URL (.env - local dev DB)
 *   node scripts/metrics.js --prod       # against production via DATABASE_PUBLIC_URL
 *
 * --prod resolves the production connection string through the Railway CLI
 * (`railway variables --service Postgres --kv`), the same route CLAUDE.md
 * documents for migrations. Railway's private DATABASE_URL is unreachable
 * from a local machine, which is why the public proxy URL is used instead.
 *
 * A NOTE ON READING THESE NUMBERS: player activity tracking only went live
 * on 2026-08-27. Any "came back the next day" figure computed over a handful
 * of accounts and a couple of days is noise, not a trend. The script prints
 * the size of every denominator for exactly that reason - report the raw
 * counts, not just the percentages.
 */

const { execSync } = require("child_process");

function resolveProdUrl() {
  try {
    const out = execSync("railway variables --service Postgres --kv", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const line = out.split(/\r?\n/).find((l) => l.startsWith("DATABASE_PUBLIC_URL="));
    if (!line) throw new Error("DATABASE_PUBLIC_URL not found in Railway variables");
    return line.slice("DATABASE_PUBLIC_URL=".length).trim();
  } catch (err) {
    console.error("Could not resolve the production database URL via the Railway CLI.");
    console.error("Is `railway` installed and linked? (`railway status` to check.)");
    console.error(String(err.message || err));
    process.exit(1);
  }
}

if (process.argv.includes("--prod")) {
  process.env.DATABASE_URL = resolveProdUrl();
}

// Loaded after DATABASE_URL is set, so Prisma picks up the right target.
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const pct = (n, d) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

function heading(text) {
  console.log("");
  console.log(text);
  console.log("-".repeat(text.length));
}

async function main() {
  const target = /@([^/]+)\//.exec(process.env.DATABASE_URL || "");
  console.log(`Gold Coast metrics — ${new Date().toISOString().slice(0, 10)}`);
  console.log(`Database: ${target ? target[1] : "(unknown)"}`);

  // ---- Accounts -----------------------------------------------------------
  const [totalUsers, newUsers24h, newUsers7d] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: new Date(Date.now() - 864e5) } } }),
    prisma.user.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 864e5) } } })
  ]);

  heading("Accounts");
  console.log(`Total accounts:        ${totalUsers}`);
  console.log(`Created last 24h:      ${newUsers24h}`);
  console.log(`Created last 7 days:   ${newUsers7d}`);

  // ---- Did tracking actually capture anything? ----------------------------
  const totalEvents = await prisma.event.count();
  const firstEvent = await prisma.event.findFirst({
    orderBy: { createdAt: "asc" },
    select: { createdAt: true }
  });

  heading("Tracking coverage");
  console.log(`Events recorded:       ${totalEvents}`);
  if (firstEvent) {
    const days = (Date.now() - firstEvent.createdAt.getTime()) / 864e5;
    console.log(`Tracking since:        ${firstEvent.createdAt.toISOString().slice(0, 10)} (${days.toFixed(1)} days)`);
    if (days < 7) {
      console.log(`NOTE: under a week of data. Return-rate figures below are indicative only.`);
    }
  } else {
    console.log(`No events recorded yet — nothing below will have data.`);
  }

  // ---- Active players -----------------------------------------------------
  const activeRows = await prisma.$queryRaw`
    SELECT
      COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS active_24h,
      COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')   AS active_7d,
      COUNT(DISTINCT session_id) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS sessions_24h
    FROM events
    WHERE user_id IS NOT NULL
  `;
  const active = activeRows[0] || {};

  heading("Who is actually playing");
  console.log(`Played in last 24h:    ${Number(active.active_24h || 0)}`);
  console.log(`Played in last 7 days: ${Number(active.active_7d || 0)}`);
  console.log(`Visits in last 24h:    ${Number(active.sessions_24h || 0)}`);

  // ---- Came back ----------------------------------------------------------
  // Of the accounts that did something yesterday, how many did something today.
  const returnRows = await prisma.$queryRaw`
    WITH yesterday AS (
      SELECT DISTINCT user_id FROM events
      WHERE user_id IS NOT NULL
        AND created_at >= CURRENT_DATE - INTERVAL '1 day'
        AND created_at <  CURRENT_DATE
    ),
    today AS (
      SELECT DISTINCT user_id FROM events
      WHERE user_id IS NOT NULL AND created_at >= CURRENT_DATE
    )
    SELECT
      (SELECT COUNT(*) FROM yesterday) AS played_yesterday,
      (SELECT COUNT(*) FROM yesterday y JOIN today t USING (user_id)) AS came_back
  `;
  const ret = returnRows[0] || {};
  const playedYesterday = Number(ret.played_yesterday || 0);
  const cameBack = Number(ret.came_back || 0);

  heading("Coming back");
  console.log(`Played yesterday:      ${playedYesterday}`);
  console.log(`...of whom returned:   ${cameBack}  (${pct(cameBack, playedYesterday)})`);
  if (playedYesterday > 0 && playedYesterday < 20) {
    console.log(`NOTE: only ${playedYesterday} accounts — too few for the percentage to mean much.`);
  }

  // ---- Which games get played --------------------------------------------
  const gameRows = await prisma.$queryRaw`
    SELECT props->>'game' AS game, COUNT(*)::int AS rounds
    FROM events
    WHERE name = 'game.round_played'
      AND created_at >= NOW() - INTERVAL '7 days'
      AND props->>'game' IS NOT NULL
    GROUP BY 1
    ORDER BY rounds DESC
  `;

  heading("Rounds played by game (last 7 days)");
  if (gameRows.length === 0) {
    console.log("No rounds recorded yet.");
  } else {
    const total = gameRows.reduce((s, r) => s + r.rounds, 0);
    const width = Math.max(...gameRows.map((r) => r.game.length));
    for (const r of gameRows) {
      console.log(`${r.game.padEnd(width)}  ${String(r.rounds).padStart(6)}  ${pct(r.rounds, total)}`);
    }
    console.log(`${"TOTAL".padEnd(width)}  ${String(total).padStart(6)}`);
    const played = new Set(gameRows.map((r) => r.game));
    console.log(`Games with zero rounds this week: ${14 - played.size} of 14`);
  }

  // ---- The economy --------------------------------------------------------
  const [kioskClaims, itemBuys, skinBuys] = await Promise.all([
    prisma.event.count({ where: { name: "kiosk.claim", createdAt: { gte: new Date(Date.now() - 7 * 864e5) } } }),
    prisma.event.count({ where: { name: "shop.item_purchased", createdAt: { gte: new Date(Date.now() - 7 * 864e5) } } }),
    prisma.event.count({ where: { name: "shop.skin_purchased", createdAt: { gte: new Date(Date.now() - 7 * 864e5) } } })
  ]);

  // Ledger truth, independent of the event stream - these are the authoritative
  // balances, so they're worth showing next to the event counts as a cross-check.
  const ledgerRows = await prisma.$queryRaw`
    SELECT type::text AS type, COUNT(*)::int AS n, SUM(amount)::bigint AS total
    FROM transactions
    WHERE created_at >= NOW() - INTERVAL '7 days'
    GROUP BY 1
    ORDER BY n DESC
  `;

  heading("Economy (last 7 days)");
  console.log(`Coin Kiosk claims:     ${kioskClaims}`);
  console.log(`Item Shop purchases:   ${itemBuys}`);
  console.log(`Skin purchases:        ${skinBuys}`);
  if (ledgerRows.length > 0) {
    console.log("");
    console.log("Ledger movements:");
    const width = Math.max(...ledgerRows.map((r) => r.type.length));
    for (const r of ledgerRows) {
      console.log(`  ${r.type.padEnd(width)}  ${String(r.n).padStart(5)} txns  net ${String(r.total)}`);
    }
  }

  console.log("");
}

main()
  .catch((err) => {
    console.error("Metrics query failed:", err.message || err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
