/**
 * Challenge definitions - the starter set.
 *
 * Code, not database rows (same call as wardrobeCatalog.ts and itemCatalog.ts):
 * adding, retiring or retuning a challenge is then a code change and a
 * deploy, never a seed script or a destructive enum migration, and the
 * definitions are reviewable in a diff alongside the logic that reads them.
 * The DB only ever stores a player's PROGRESS against an id.
 *
 * ECONOMY (hard rule, repo-root CLAUDE.md): every reward here is GOLD COINS
 * plus XP. Never TICKETS - TICKETS may only be credited by
 * GAME_WIN_TICKETS, an actual game win, and economy/ledger.ts enforces that
 * at runtime. Nothing here rewards spending real money, either: there is no
 * challenge for buying a GC package, and there never should be.
 *
 * All progress is driven from server-computed game settlement (see
 * progress.ts and games/shared.ts), never from client-reported activity.
 */

import { ChallengePeriod } from "./periods";

/**
 * What a challenge counts. Each maps to something the server itself
 * computed while settling a round - never anything a client asserted.
 *
 *   ROUNDS_PLAYED  - wagers placed (every round counts, win or lose)
 *   WINS           - rounds that paid out
 *   GC_WAGERED     - total Gold Coins bet
 *   TICKETS_WON    - total Tickets paid out
 *   DISTINCT_GAMES - how many different games have been played (a set, so
 *                    replaying the same game can't inflate it)
 */
export type ChallengeMetric =
  | "ROUNDS_PLAYED"
  | "WINS"
  | "GC_WAGERED"
  | "TICKETS_WON"
  | "DISTINCT_GAMES";

export interface ChallengeDef {
  id: string;
  period: ChallengePeriod;
  /** Short player-facing name. */
  name: string;
  /** One-line player-facing description. */
  description: string;
  metric: ChallengeMetric;
  /** Progress needed to complete. */
  target: number;
  /** Gold Coins paid on claim. NEVER Tickets - see this file's header. */
  rewardGc: number;
  /** XP granted on claim - this is the only source of XP in the game. */
  rewardXp: number;
  /** Optional: only count activity on this game id (e.g. "mines"). */
  game?: string;
  /** WINS only: only count wins paying at least this many Tickets. */
  minPayout?: number;
}

/**
 * Every game that routes through games/shared.ts, i.e. everything the
 * DISTINCT_GAMES metric can ever see. Triple Chance is deliberately absent:
 * it's a bonus round chained onto the Coin Kiosk claim with its own direct
 * ledger calls (repo-root CLAUDE.md), not an independently-wagered game, so
 * it neither counts toward challenges nor is required for "play them all".
 */
export const TRACKED_GAMES = [
  "dice",
  "coinflip",
  "roulette",
  "limbo",
  "plinko",
  "slots",
  "keno",
  "wheel",
  "baccarat",
  "mines",
  "dragontower",
  "hilo",
  "blackjack",
  "videopoker"
] as const;

export const CHALLENGE_CATALOG: ChallengeDef[] = [
  // ----- Daily: small, finishable in one sitting, back tomorrow ---------
  {
    id: "daily_play_10",
    period: "DAILY",
    name: "Warm Up",
    description: "Play 10 rounds of anything.",
    metric: "ROUNDS_PLAYED",
    target: 10,
    rewardGc: 150,
    rewardXp: 40
  },
  {
    id: "daily_win_3",
    period: "DAILY",
    name: "Three Up",
    description: "Win 3 rounds today.",
    metric: "WINS",
    target: 3,
    rewardGc: 200,
    rewardXp: 50
  },
  {
    id: "daily_wager_500",
    period: "DAILY",
    name: "High Roller",
    description: "Bet 500 Gold Coins in total today.",
    metric: "GC_WAGERED",
    target: 500,
    rewardGc: 150,
    rewardXp: 40
  },
  {
    id: "daily_variety_3",
    period: "DAILY",
    name: "Mix It Up",
    description: "Play 3 different games today.",
    metric: "DISTINCT_GAMES",
    target: 3,
    rewardGc: 250,
    rewardXp: 60
  },

  // ----- Weekly: a real week's worth of play ---------------------------
  {
    id: "weekly_play_100",
    period: "WEEKLY",
    name: "Regular",
    description: "Play 100 rounds this week.",
    metric: "ROUNDS_PLAYED",
    target: 100,
    rewardGc: 1000,
    rewardXp: 250
  },
  {
    id: "weekly_win_30",
    period: "WEEKLY",
    name: "On A Roll",
    description: "Win 30 rounds this week.",
    metric: "WINS",
    target: 30,
    rewardGc: 1200,
    rewardXp: 300
  },
  {
    id: "weekly_variety_8",
    period: "WEEKLY",
    name: "Around The Floor",
    description: "Play 8 different games this week.",
    metric: "DISTINCT_GAMES",
    target: 8,
    rewardGc: 1500,
    rewardXp: 350
  },
  {
    id: "weekly_big_win",
    period: "WEEKLY",
    name: "Big One",
    description: "Land a single win worth 1,000 Tickets or more.",
    metric: "WINS",
    target: 1,
    minPayout: 1000,
    rewardGc: 1000,
    rewardXp: 250
  },

  // ----- Lifetime achievements: permanent, one-off ---------------------
  {
    id: "ach_first_round",
    period: "LIFETIME",
    name: "First Pull",
    description: "Play your very first round.",
    metric: "ROUNDS_PLAYED",
    target: 1,
    rewardGc: 100,
    rewardXp: 25
  },
  {
    id: "ach_first_win",
    period: "LIFETIME",
    name: "Beginner's Luck",
    description: "Win a round for the first time.",
    metric: "WINS",
    target: 1,
    rewardGc: 150,
    rewardXp: 50
  },
  {
    id: "ach_grand_tour",
    period: "LIFETIME",
    name: "Grand Tour",
    description: "Play every game on the floor at least once.",
    metric: "DISTINCT_GAMES",
    target: TRACKED_GAMES.length,
    rewardGc: 5000,
    rewardXp: 1000
  },
  {
    id: "ach_rounds_1000",
    period: "LIFETIME",
    name: "Thousand Club",
    description: "Play 1,000 rounds.",
    metric: "ROUNDS_PLAYED",
    target: 1000,
    rewardGc: 5000,
    rewardXp: 1000
  },
  {
    id: "ach_tickets_50k",
    period: "LIFETIME",
    name: "Ticket Tycoon",
    description: "Win 50,000 Tickets in total.",
    metric: "TICKETS_WON",
    target: 50000,
    rewardGc: 4000,
    rewardXp: 800
  },
  {
    id: "ach_mines_100",
    period: "LIFETIME",
    name: "Minesweeper",
    description: "Play 100 rounds of Mines.",
    metric: "ROUNDS_PLAYED",
    game: "mines",
    target: 100,
    rewardGc: 1500,
    rewardXp: 300
  }
];

export function getChallenge(id: string): ChallengeDef | undefined {
  return CHALLENGE_CATALOG.find((c) => c.id === id);
}
