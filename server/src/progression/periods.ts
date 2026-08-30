/**
 * Period keys - how daily and weekly challenges reset WITHOUT a cron job.
 *
 * This project has no job scheduler (no cron, no queue worker, no Railway
 * scheduled task), and adding one purely to zero some counters at midnight
 * would be a new always-on piece of infrastructure that can silently stop
 * firing - and when it does, every player either keeps yesterday's progress
 * or loses today's. So nothing is ever reset.
 *
 * Instead, a challenge's progress row is ADDRESSED by a key derived from
 * the current UTC instant:
 *   DAILY    -> "2026-08-28"  (UTC calendar date)
 *   WEEKLY   -> "2026-W35"    (ISO-8601 week-numbering year + week, UTC)
 *   LIFETIME -> "all"         (one row forever - permanent achievements)
 *
 * When the UTC day rolls over, a daily challenge starts addressing a row
 * that doesn't exist yet, which reads as zero progress. Yesterday's row is
 * left in place as inert history. There is no scheduled job to miss, no
 * catch-up logic after downtime, and a server restarted at 00:00:01 behaves
 * identically to one that has been up for a month.
 *
 * UTC, not local time, deliberately: players are in whatever timezone they
 * are in, and the server is on Railway in whatever region it is in. A
 * single, fixed, globally-agreed rollover instant is the only version of
 * this that is reproducible in a test, comparable across players, and
 * immune to daylight-saving. The cost is that "day" means UTC day rather
 * than the player's own midnight - a well-understood trade every live-ops
 * daily system makes.
 *
 * TRADE-OFF worth naming: a daily completed but never claimed before the
 * UTC rollover becomes unclaimable, because the claim path addresses
 * today's row. That's the standard behaviour for daily challenges
 * everywhere, and the alternative (claimable forever) would turn dailies
 * into a stockpile rather than a reason to come back tomorrow, which is the
 * entire point of the feature.
 */

export type ChallengePeriod = "DAILY" | "WEEKLY" | "LIFETIME";

/** The single key every lifetime achievement's progress row lives under. */
export const LIFETIME_PERIOD_KEY = "all";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** UTC calendar date, "YYYY-MM-DD". */
export function dailyPeriodKey(now: Date): string {
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
}

/**
 * ISO-8601 week key, "YYYY-Www", in UTC. Weeks start Monday, and the
 * week-numbering YEAR is not always the calendar year (e.g. 2027-01-01 is
 * in week 53 of 2026) - hence the standard "shift to the Thursday of this
 * week, then count weeks from that year's first Thursday" construction
 * rather than a naive day-of-year division, which is off by one for a
 * couple of days most years.
 */
export function weeklyPeriodKey(now: Date): string {
  // Midnight UTC on the given day, so time-of-day can't affect the maths.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // ISO weekday: Monday = 1 ... Sunday = 7 (JS gives Sunday = 0).
  const isoWeekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  // Move to the Thursday of this ISO week - the day that decides which
  // year the week belongs to.
  d.setUTCDate(d.getUTCDate() + 4 - isoWeekday);
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstIsoWeekday = firstThursday.getUTCDay() === 0 ? 7 : firstThursday.getUTCDay();
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstIsoWeekday);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${isoYear}-W${pad2(week)}`;
}

/**
 * Midnight UTC on the same calendar day as `now` - the start of the window
 * `dailyPeriodKey(now)` addresses. Added for the GC-earned leaderboard
 * (economy/leaderboard.ts), which needs an actual instant to filter
 * `transactions.created_at >= ...` by rather than a string key (the ledger
 * already has a real timestamp per row, unlike challenge progress which has
 * no timestamp of its own and is addressed by key alone) - same UTC-day
 * definition as dailyPeriodKey, just expressed as a Date instead of a
 * string, so the two can never drift apart on what "today" means.
 */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Midnight UTC on the Monday of the same ISO week as `now` - the start of
 * the window `weeklyPeriodKey(now)` addresses. Same reasoning as
 * startOfUtcDay above; the Monday-start math mirrors periodEndsAt's
 * "daysUntilNextMonday" construction below, just walking backward to the
 * start of the current week instead of forward to the start of the next
 * one.
 */
export function startOfUtcWeek(now: Date): Date {
  const day = startOfUtcDay(now);
  const isoWeekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  day.setUTCDate(day.getUTCDate() - (isoWeekday - 1));
  return day;
}

/** The period key a challenge of `period` addresses at instant `now`. */
export function periodKeyFor(period: ChallengePeriod, now: Date = new Date()): string {
  switch (period) {
    case "DAILY":
      return dailyPeriodKey(now);
    case "WEEKLY":
      return weeklyPeriodKey(now);
    case "LIFETIME":
      return LIFETIME_PERIOD_KEY;
  }
}

/**
 * When the current period ends (exclusive), so the client can show a
 * "resets in 4h 12m" countdown without re-deriving the calendar rules.
 * Null for LIFETIME - achievements never expire.
 */
export function periodEndsAt(period: ChallengePeriod, now: Date = new Date()): Date | null {
  if (period === "LIFETIME") return null;
  if (period === "DAILY") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  }
  const isoWeekday = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
  const daysUntilNextMonday = 8 - isoWeekday;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilNextMonday));
}
