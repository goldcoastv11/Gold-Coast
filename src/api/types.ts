/**
 * Response/request shapes for casino-poc/server's HTTP API.
 *
 * Mirrors server/src/serializers.ts (MeResponse) and each route file's
 * response shape 1:1 - see casino-poc/server/src/routes/*.ts for the source
 * of truth. Keep these in sync by hand (server has no shared package the
 * client can import from).
 */

/** GET /me, and embedded as `user` in most economy/auth responses. */
export interface MeResponse {
  username: string;
  goldCoins: number;
  tickets: number;
  skinsOwned: string[];
  equippedSkin: string;
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

export interface SkinDto {
  id: string;
  textureKey: string;
  name: string;
  price: number;
}

/** POST /skins/buy */
export interface BuySkinResponse {
  skin: SkinDto;
  user: MeResponse;
}

/** POST /skins/equip */
export interface EquipSkinResponse {
  equippedSkin: string;
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

/** Every `payout` field below is now TICKETS, not GC - see repo-root CLAUDE.md's "arcade token" model. */
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
