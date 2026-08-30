/**
 * Response/request shapes for casino-poc/server's HTTP API.
 *
 * Mirrors server/src/serializers.ts (MeResponse) and each route file's
 * response shape 1:1 - see casino-poc/server/src/routes/*.ts for the source
 * of truth. Keep these in sync by hand (server has no shared package the
 * client can import from).
 */

import type { WardrobeSlot } from "../wardrobeCatalog";
import type { RoomSlot } from "../roomCatalog";
import type { FurnitureSlotId } from "../furnitureCatalog";

// Re-exported so api/client.ts and its callers can name a slot without also
// importing the catalog - the catalog is the definition, this is the wire type.
export type { WardrobeSlot };
export type { RoomSlot };
export type { FurnitureSlotId };

/** GET /me, and embedded as `user` in most economy/auth responses. */
export interface MeResponse {
  username: string;
  goldCoins: number;
  /**
   * Retired (GC-only economy, 2026-08-29 restructure - see repo-root
   * CLAUDE.md). Always 0 now and never grows; kept on the wire only because
   * the server's Balance/serializer still sends it and dropping the field
   * would be a needless wire-shape change for a value nothing reads any
   * more. Don't display this - see ShopPanel.ts/uiHelpers.ts's formatBalance
   * for what replaced the old two-currency display.
   */
  tickets: number;
  /**
   * The layered wardrobe (see server/src/economy/wardrobe.ts) - what
   * replaced the old `skinsOwned`/`equippedSkin` pair when the 17
   * monolithic skins were removed. `owned` always contains the free default
   * body and `equipped.BODY` is always set, so a character can be rendered
   * from this alone with no special-casing for a new account.
   */
  wardrobe: {
    owned: string[];
    equipped: Partial<Record<WardrobeSlot, string>>;
  };
  /**
   * The Player Room's wallpaper + flooring (see
   * server/src/economy/room.ts) - furniture is a separate `furniture`
   * field below, a different enough shape to not live in this one (see
   * furnitureCatalog.ts's header). `owned` always contains both free
   * defaults; `equipped` always has a WALLPAPER and FLOORING entry.
   */
  room: {
    owned: string[];
    equipped: Partial<Record<RoomSlot, string>>;
  };
  /**
   * The Player Room's furniture (see server/src/economy/furniture.ts) -
   * the third decor category. Unlike `room` above, `owned` has no free
   * defaults and `placed` only has a key for slots actually occupied - a
   * missing key means genuinely empty, not "fell back to a default."
   */
  furniture: {
    owned: string[];
    placed: Partial<Record<FurnitureSlotId, string>>;
  };
  /** Accessory/pet ids owned (see server/src/economy/itemShop.ts). */
  ownedItems: string[];
  equippedAccessory: string | null;
  equippedPet: string | null;
  lastPosition: { x: number; y: number } | null;
  attendantClaim: { lastClaimedAt: string | null };
  adReward: { lastClaimedAt: string | null };
  /**
   * The user's currently-active stateful-game round (Mines/Dragon Tower/
   * Hi-Lo/Blackjack/Video Poker), or null if none (#42/#43). Present on
   * every response that embeds MeResponse - a client that lost its local
   * roundId (reload, crash, or re-authenticating after the 401-auto-logout
   * path) can discover an orphaned round here and call POST /games/abandon
   * to forfeit it and unblock starting a new one. See LoginScene.ts's
   * post-hydration reconciliation.
   */
  activeRound: { game: string; roundId: string } | null;
  /**
   * The player's level ("prestige number") and total XP - mirrors
   * server/src/serializers.ts, which embeds it on every authenticated
   * response rather than leaving it to GET /progression so the level can be
   * shown anywhere the player is shown (e.g. the overworld HUD) without a
   * second request. Degrades to `{ level: 1, xp: 0 }` server-side on an
   * environment that has not had the progression migration applied.
   */
  progression: { level: number; xp: number };
}

/** The closed set of GC multipliers the shuffle-cup mini-game can land on (server-resolved). */
export type GcMultiplier = 0.5 | 1 | 2;

export interface SignupBonusInfo {
  gcMultiplier: GcMultiplier;
  gcAmount: number;
}

/** POST /auth/signup */
export interface SignupResponse {
  token: string;
  user: MeResponse;
  signupBonus: SignupBonusInfo;
}

/** POST /auth/login */
export interface LoginResponse {
  token: string;
  user: MeResponse;
}

/** POST /position */
export interface PositionResponse {
  ok: true;
  x: number;
  y: number;
}

/** One wardrobe piece as the server describes it (server/src/wardrobeCatalog.ts). */
export interface WardrobePieceDto {
  id: string;
  slot: WardrobeSlot;
  name: string;
  price: number;
}

/** POST /wardrobe/buy */
export interface BuyWardrobePieceResponse {
  piece: WardrobePieceDto;
  user: MeResponse;
}

/** POST /wardrobe/equip */
export interface EquipWardrobePieceResponse {
  piece: WardrobePieceDto;
  user: MeResponse;
}

/** POST /wardrobe/unequip */
export interface UnequipWardrobeSlotResponse {
  user: MeResponse;
}

/** One room decor piece as the server describes it (server/src/roomCatalog.ts). */
export interface RoomPieceDto {
  id: string;
  slot: RoomSlot;
  name: string;
  price: number;
}

/** GET /room/catalog */
export interface RoomCatalogResponse {
  slots: { slot: RoomSlot; name: string; optional: boolean }[];
  pieces: RoomPieceDto[];
}

/** POST /room/buy */
export interface BuyRoomPieceResponse {
  piece: RoomPieceDto;
  user: MeResponse;
}

/** POST /room/equip */
export interface EquipRoomPieceResponse {
  piece: RoomPieceDto;
  user: MeResponse;
}

/** One furniture piece as the server describes it (server/src/furnitureCatalog.ts). No `slot` - unlike a room piece, a furniture piece isn't tied to one category, it can go in any slot. */
export interface FurniturePieceDto {
  id: string;
  name: string;
  price: number;
}

/** One fixed placement position (server/src/furnitureCatalog.ts). */
export interface FurnitureSlotDto {
  id: FurnitureSlotId;
  name: string;
}

/** GET /furniture/catalog */
export interface FurnitureCatalogResponse {
  slots: FurnitureSlotDto[];
  pieces: FurniturePieceDto[];
}

/** POST /furniture/buy - does NOT place the piece, see server/src/economy/furniture.ts's header. */
export interface BuyFurnitureResponse {
  piece: FurniturePieceDto;
  user: MeResponse;
}

/** POST /furniture/place */
export interface PlaceFurnitureResponse {
  piece: FurniturePieceDto;
  slot: FurnitureSlotId;
  user: MeResponse;
}

/** POST /furniture/remove */
export interface RemoveFurnitureResponse {
  user: MeResponse;
}

export type ItemCategory = "ACCESSORY" | "PET";

export interface ItemDto {
  id: string;
  category: ItemCategory;
  name: string;
  price: number;
  emoji?: string;
  textureKey?: string;
}

/** POST /items/buy */
export interface BuyItemResponse {
  item: ItemDto;
  user: MeResponse;
}

/** POST /items/equip */
export interface EquipItemResponse {
  item: ItemDto;
  user: MeResponse;
}

/** POST /items/unequip */
export interface UnequipItemResponse {
  user: MeResponse;
}

export interface AttendantClaimGrant {
  gcMultiplier: GcMultiplier;
  gcAmount: number;
}

/** POST /claim-bonus (200) */
export interface ClaimBonusResponse {
  granted: AttendantClaimGrant;
  user: MeResponse;
}

/** POST /claim-bonus (429 COOLDOWN) */
export interface ClaimBonusCooldownError {
  error: string;
  code: "COOLDOWN";
  remainingMs: number;
}

/** POST /ads/claim (200) - simulated ad-reward GC refill, see server/src/economy/adRewards.ts. */
export interface ClaimAdRewardResponse {
  granted: { gcAmount: number };
  user: MeResponse;
}

/** POST /ads/claim (429 COOLDOWN) - same shape as ClaimBonusCooldownError. */
export interface ClaimAdRewardCooldownError {
  error: string;
  code: "COOLDOWN";
  remainingMs: number;
}

/** Generic error body every non-2xx response uses (see server/src/app.ts's error handler + each route). */
export interface ApiErrorBody {
  error: string;
  code?: string;
  [key: string]: unknown;
}

// ---- Games (#36 - server-authoritative RNG/payout) ----

/**
 * Every `payout` field below is GC (GC-only economy, 2026-08-29 restructure
 * - see repo-root CLAUDE.md). Before that restructure, a payout used to be
 * TICKETS, a separate currency; that's retired now, but the union below
 * keeps the "TICKETS" member for wire-shape compatibility with old
 * historical data, not because a response can still report it.
 */
export type Currency = "GC" | "TICKETS";

/** POST /games/dice/play */
export interface DicePlayResult {
  roll: number;
  target: number;
  won: boolean;
  multiplier: number;
  payout: number;
}

export interface DicePlayResponse {
  result: DicePlayResult;
  user: MeResponse;
}

/** Client-safe slice of a Mines round's state - never includes minePositions while the round is still active. */
export interface MinesPublicState {
  revealed: number[];
  picksMade: number;
  multiplier: number;
}

/** POST /games/mines/start */
export interface MinesStartResponse {
  roundId: string;
  state: MinesPublicState;
  user: MeResponse;
}

/** POST /games/mines/pick */
export interface MinesPickResponse {
  hitMine: boolean;
  boardCleared: boolean;
  revealed?: number[];
  multiplier: number;
  minePositions?: number[]; // present only once the round has ended (hit a mine, or cleared the board)
  payout?: number; // present only when boardCleared auto-resolved the round
  user: MeResponse;
}

/** POST /games/mines/cashout */
export interface MinesCashOutResponse {
  multiplier: number;
  payout: number;
  minePositions: number[];
  user: MeResponse;
}

export type CoinSide = "heads" | "tails";

/** POST /games/coinflip/play */
export interface CoinFlipPlayResponse {
  result: { guess: CoinSide; result: CoinSide; won: boolean; payout: number };
  user: MeResponse;
}

export type RouletteColor = "red" | "black" | "green";

/** POST /games/roulette/play */
export interface RoulettePlayResponse {
  result: { bet: RouletteColor; number: number; color: RouletteColor; won: boolean; payout: number };
  user: MeResponse;
}

/** POST /games/limbo/play */
export interface LimboPlayResponse {
  result: { target: number; crashPoint: number; won: boolean; payout: number };
  user: MeResponse;
}

/** POST /games/plinko/play */
export interface PlinkoPlayResponse {
  result: { slotIndex: number; multiplier: number; payout: number; path: number[] };
  user: MeResponse;
}

/** POST /games/slots/play */
export interface SlotsPlayResponse {
  result: { reels: string[]; payout: number; winKey: string | null; winCount: 2 | 3 | null };
  user: MeResponse;
}

/** POST /games/keno/play */
export interface KenoPlayResponse {
  result: { picks: number[]; drawn: number[]; hits: number; multiplier: number; payout: number };
  user: MeResponse;
}

export type WheelRisk = "low" | "medium" | "high";

/** POST /games/wheel/play */
export interface WheelPlayResponse {
  result: { risk: WheelRisk; segments: number[]; landingIndex: number; multiplier: number; payout: number };
  user: MeResponse;
}

export type BaccaratBetType = "player" | "banker" | "tie";
export type BaccaratOutcome = "player" | "banker" | "tie";

/** POST /games/baccarat/play */
export interface BaccaratPlayResponse {
  result: {
    playerCards: number[];
    bankerCards: number[];
    playerTotal: number;
    bankerTotal: number;
    outcome: BaccaratOutcome;
    betType: BaccaratBetType;
    multiplier: number;
    payout: number;
  };
  user: MeResponse;
}

// ---- Dragon Tower (stateful: start / pick / cashout) ----

export interface DragonTowerPublicState {
  currentRow: number;
  multiplier: number;
}

/** POST /games/dragontower/start */
export interface DragonTowerStartResponse {
  roundId: string;
  state: DragonTowerPublicState;
  user: MeResponse;
}

/** POST /games/dragontower/pick */
export interface DragonTowerPickResponse {
  isBad: boolean;
  reachedTop: boolean;
  currentRow?: number; // absent when isBad
  multiplier: number;
  badIndexPerRow?: number[]; // present once the round has ended (hit the bad tile, or reached the top)
  payout?: number; // present only when isBad, or reachedTop auto-resolved the round
  user: MeResponse;
}

/** POST /games/dragontower/cashout */
export interface DragonTowerCashOutResponse {
  multiplier: number;
  payout: number;
  badIndexPerRow: number[];
  user: MeResponse;
}

// ---- Hi-Lo (stateful: start / guess / cashout) ----

export interface HiLoPublicState {
  currentCard: number;
  deckRemaining: number;
  correctGuesses: number;
  multiplier: number;
  higherCount: number;
  lowerCount: number;
}

/** POST /games/hilo/start */
export interface HiLoStartResponse {
  roundId: string;
  state: HiLoPublicState;
  user: MeResponse;
}

export type HiLoGuess = "higher" | "lower";

/** POST /games/hilo/guess */
export interface HiLoGuessResponse {
  won: boolean;
  deckExhausted: boolean;
  nextCard?: number; // present only on a loss (a win's next card is state.currentCard)
  state?: HiLoPublicState; // present only on a win
  multiplier?: number; // present only on a loss (always 0)
  payout?: number; // present on a loss (0), or a win that auto-cashed out (deck exhausted)
  user: MeResponse;
}

/** POST /games/hilo/cashout */
export interface HiLoCashOutResponse {
  multiplier: number;
  payout: number;
  user: MeResponse;
}

// ---- Blackjack (stateful: start / hit / stand) ----

export type BlackjackStatus = "playing" | "resolved";
export type BlackjackOutcome = "win" | "push" | "lose";

export interface BlackjackPublicState {
  playerHand: number[]; // rank only, 1=A, 11=J, 12=Q, 13=K - client picks a random cosmetic suit for display
  playerTotal: number;
  dealerUpCard: number;
  dealerHand: number[] | null; // revealed only once status is "resolved"
  dealerTotal: number | null;
  status: BlackjackStatus;
  outcome: BlackjackOutcome | null;
}

/** POST /games/blackjack/start */
export interface BlackjackStartResponse {
  roundId: string;
  state: BlackjackPublicState;
  payout: number | null; // present only if a natural blackjack auto-resolved the round
  user: MeResponse;
}

/** POST /games/blackjack/hit */
export interface BlackjackHitResponse {
  state: BlackjackPublicState;
  payout: number | null; // present (0) only if the hit busted and resolved the round
  user: MeResponse;
}

/** POST /games/blackjack/stand */
export interface BlackjackStandResponse {
  state: BlackjackPublicState;
  payout: number;
  user: MeResponse;
}

// ---- Video Poker (deal / draw) ----

/** POST /games/videopoker/deal */
export interface VideoPokerDealResponse {
  roundId: string;
  hand: number[]; // rank only, 2-14 (Ace high) - client picks cosmetic suits for display
  user: MeResponse;
}

// ---- Triple Chance (#46 - bonus round after a shuffle-cup GC win) ----

/** POST /games/triplechance/play - GC only, no currency param (see server/src/games/triplechance.ts). */
export interface TripleChancePlayResponse {
  result: { won: boolean; multiplier: 0 | 3; payout: number };
  user: MeResponse;
}

/** POST /games/videopoker/draw */
export interface VideoPokerDrawResponse {
  hand: number[];
  rank: string;
  multiplier: number;
  payout: number;
  user: MeResponse;
}

// ---- Abandon (#42/#43: forfeit whatever stateful round is active, any game) ----

/** POST /games/abandon (200) - finds the user's active round (any game), forfeits it (no payout - the bet was already debited at start), and closes it. */
export interface AbandonRoundResponse {
  game: string;
  roundId: string;
  betAmount: number;
  currency: Currency;
  forfeited: true;
  user: MeResponse;
}

/** POST /games/abandon (404) - the user has no active round to abandon. */
export interface AbandonRoundNotFoundError {
  error: string;
  code: "NO_ACTIVE_ROUND";
}

// ---- Challenges, XP and levels ----
// Mirrors server/src/progression/* and server/src/routes/progression.ts.
// ECONOMY: every reward below is GOLD COINS plus XP - the only currency
// there is now (TICKETS is retired; the ledger no longer credits it at all
// - see repo-root CLAUDE.md).

export type ChallengePeriod = "DAILY" | "WEEKLY" | "LIFETIME";

/** One challenge as the player sees it - see server/src/progression/progress.ts's ChallengeView. */
export interface ChallengeView {
  id: string;
  period: ChallengePeriod;
  name: string;
  description: string;
  /** Already clamped to `target` server-side. */
  progress: number;
  target: number;
  complete: boolean;
  claimed: boolean;
  /** Gold Coins paid on claim - the only currency there is now. */
  rewardGc: number;
  rewardXp: number;
  /** ISO instant this challenge's period rolls over, or null for lifetime achievements. */
  periodEndsAt: string | null;
}

/** GET /challenges */
export interface ChallengeBoardResponse {
  /** False on an environment that has not had the progression migration applied - render an unavailable state, not an error. */
  available: boolean;
  daily: ChallengeView[];
  weekly: ChallengeView[];
  achievements: ChallengeView[];
}

/** The level/XP block returned inside a claim response (server: ProgressionState). */
export interface ProgressionState {
  xp: number;
  level: number;
  /** XP earned since reaching the current level. */
  xpIntoLevel: number;
  /** XP the current level costs in total, or 0 at max level. */
  xpForNextLevel: number;
  atMaxLevel: boolean;
  /** Highest level already paid out - exposed for QA/debugging. */
  rewardedLevel: number;
}

/**
 * GET /progression - the claim response's `ProgressionState` plus the ladder
 * facts the client needs to render "what's next" without re-deriving the XP
 * curve or the unlock table locally (both live on the server and stay there).
 */
export interface ProgressionResponse extends ProgressionState {
  maxLevel: number;
  /** Gold Coins the NEXT level pays, or 0 at max level. */
  nextLevelRewardGc: number;
  /** Level -> itemCatalog id granted at that level. JSON object keys are strings even though the server's are numbers. */
  cosmeticUnlocks: Record<string, string>;
  /**
   * Non-null when a level-up "stop the marker" minigame is owed and not
   * yet played - see PendingLevelMinigame below. Optional (not just
   * nullable) purely so existing test fixtures built before this field
   * existed (e.g. ui/challengeDisplay.test.ts's `progression()` helper)
   * don't have to be touched to keep compiling; every real server response
   * always sends it (see routes/progression.ts's GET /progression).
   */
  pendingLevelMinigame?: PendingLevelMinigame;
}

/** One level's payout, returned when a claim's XP pushed the player over a level boundary. */
export interface LevelGrant {
  level: number;
  rewardGc: number;
  /** Item granted outright at this level (see server/src/progression/levels.ts), if any. */
  cosmeticItemId: string | null;
}

/** POST /challenges/claim (200) */
export interface ClaimChallengeResponse {
  claimed: { challengeId: string; rewardGc: number; rewardXp: number };
  progression: ProgressionState;
  /** Empty unless this claim's XP crossed one or more level boundaries. */
  levelsGained: LevelGrant[];
  /**
   * Non-null when this claim's level-up(s) now owe a "stop the marker"
   * minigame (see PendingLevelMinigame below) - the trigger point for
   * src/scenes/LevelUpMinigameScene.ts. A multi-level jump (a big
   * achievement claim) still only ever owes ONE game, anchored to the
   * highest level reached - see schema.prisma's PlayerProgress.pendingMinigameLevel
   * doc comment for why.
   */
  pendingLevelMinigame: PendingLevelMinigame;
  user: MeResponse;
}

// ---- Level-up "stop the marker" timing minigame ----
// Mirrors server/src/progression/levelMinigame.ts + levelMinigameSession.ts +
// the /minigame/levelup/* routes in server/src/routes/progression.ts.
//
// ECONOMY: this pays Gold Coins only, never Tickets (repo-root CLAUDE.md) -
// same rule as every other level/challenge reward.
//
// TRUST BOUNDARY: the client never reports an accuracy or elapsed-time
// number to the server. `POST /minigame/levelup/stop` takes only the
// sessionId; the server computes elapsed time from its OWN clock
// (`now() - session.startedAt`, the session's row in the DB) and derives
// accuracy/reward from that alone. See levelMinigameSession.ts's header
// comment for the full writeup and its one disclosed caveat: network
// latency between the player's tap and the request landing shifts the
// scored moment slightly later than the tap itself, which can cost a
// hair of accuracy, but gives no way to fabricate a better-than-real
// result.

/** Owed-but-not-yet-played minigame, or null if nothing is owed. Read from GET /progression and from a challenge claim response. */
export type PendingLevelMinigame = { level: number } | null;

/** POST /minigame/levelup/start (200) */
export interface LevelMinigameStartResponse {
  session: {
    sessionId: string;
    /** The level this session's payout is anchored to. */
    level: number;
    /** How long one full sweep (end-to-end-to-end) takes, in ms - the client renders its own sweep animation from this, seeded at session receipt. */
    sweepPeriodMs: number;
    /** ISO instant the SERVER's clock started this session - lets the client re-derive true elapsed time on RESUMPTION (a reload mid-game re-fetches the same still-running session). */
    startedAt: string;
  };
}

/** POST /minigame/levelup/start (409) - nothing owed right now (also what a forged call with no real level-up gets). */
export interface LevelMinigameNonePendingError {
  error: string;
  code: "NONE_PENDING";
}

/** POST /minigame/levelup/stop (200) */
export interface LevelMinigameStopResponse {
  result: {
    level: number;
    /** 0 (stopped at either extreme) to 1 (dead centre), as scored by the SERVER's own clock - never the client's. */
    accuracy: number;
    /** Gold Coins credited by this result. Never Tickets. */
    rewardGc: number;
    /** Where the marker actually was at the server-scored instant, in [-1, 1] (0 = dead centre) - purely for rendering the result, already baked into rewardGc/accuracy. */
    position: number;
  };
  user: MeResponse;
}

/** POST /minigame/levelup/stop (409) - this session was already completed (a retry/double-tap/replay); nothing was credited. */
export interface LevelMinigameAlreadyClaimedError {
  error: string;
  code: "ALREADY_CLAIMED";
}

// ---- GC-earned leaderboard ----
// Mirrors server/src/economy/leaderboard.ts. Usernames are shown - explicit
// founder call ("they accepted that usernames become publicly visible").

/** One ranked row - see server/src/economy/leaderboard.ts's LeaderboardEntry for what "rank" means with ties. */
export interface LeaderboardEntry {
  userId: string;
  username: string;
  earnedGc: number;
  rank: number;
  /** What this player currently has equipped, keyed by slot - just enough for ui/LeaderboardPanel.ts to draw a small portrait (see LayeredCharacter.ts). No balances, no email, no progression. BODY is always present. */
  wardrobe: Partial<Record<WardrobeSlot, string>>;
}

export interface LeaderboardBoard {
  /** Top ~10 by GC earned in this window. */
  top: LeaderboardEntry[];
  /** The caller's own row + rank, even outside `top` - null means they haven't earned anything in this window yet (a real state, not missing data). */
  me: LeaderboardEntry | null;
}

/** GET /leaderboard */
export interface LeaderboardResponse {
  daily: LeaderboardBoard;
  weekly: LeaderboardBoard;
  allTime: LeaderboardBoard;
}

// ---- The Magazine (roadmap/magazine) ----
// Mirrors server/src/economy/magazine.ts. Read-only: a room lookalike
// (wallpaper/flooring/furniture) belonging to a random-but-daily-stable
// set of other players, plus their usernames - and deliberately nothing
// else (no balances, no email, no progression - see that file's own
// MagazineRoomEntry doc comment).

/** One player's room, exactly as much as ui/MagazinePanel.ts needs to draw it. */
export interface MagazineRoomEntry {
  username: string;
  wallpaperId: string;
  flooringId: string;
  furniture: Partial<Record<FurnitureSlotId, string>>;
}

/** GET /magazine */
export interface MagazineResponse {
  /** UTC calendar date this selection is stable for - changes at UTC midnight, same clock progression's daily challenges use. */
  dateKey: string;
  /** 0-5 rooms - fewer than 5 if there aren't yet 5 decorated rooms to show (see server's isRoomWorthShowing); never padded, never fabricated. */
  rooms: MagazineRoomEntry[];
}
