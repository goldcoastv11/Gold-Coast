/**
 * Thin fetch wrapper for casino-poc/server's HTTP API (see server/src/app.ts
 * for route wiring, server/.env.example for the default port/CORS origin).
 *
 * - Base URL defaults to http://localhost:8787 (the server's default PORT)
 *   and can be overridden with VITE_API_BASE_URL for other environments.
 * - The JWT is kept in memory for the running session AND mirrored to
 *   localStorage so a page reload doesn't force a re-login - LoginScene
 *   attempts a silent GET /me on boot if a token is present (see
 *   restoreSession()).
 * - Every authenticated call attaches `Authorization: Bearer <token>`
 *   automatically; callers never touch headers directly.
 */

const DEFAULT_BASE_URL = "http://localhost:8787";

function readBaseUrl(): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return env?.VITE_API_BASE_URL ?? DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

export const API_BASE_URL = readBaseUrl();

const TOKEN_STORAGE_KEY = "casinoPocToken";

let inMemoryToken: string | null = null;

/** Current JWT, if any (checks the in-memory cache first, then localStorage). */
export function getToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  try {
    inMemoryToken = localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    inMemoryToken = null;
  }
  return inMemoryToken;
}

export function setToken(token: string): void {
  inMemoryToken = token;
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) - the token
    // still works for the rest of this session via the in-memory cache.
  }
}

export function clearToken(): void {
  inMemoryToken = null;
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // no-op - see setToken.
  }
}

/**
 * Thrown for any non-2xx response. `code` is the server's stable error code
 * (see each route's `{ error, code }` body) when present - prefer switching
 * on `code` over parsing `message` for anything the UI needs to branch on.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body: unknown;

  constructor(status: number, code: string | undefined, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** Thrown when `fetch` itself fails (server unreachable, CORS, offline, timeout, etc.) - distinct from an ApiError (server responded, just not with 2xx). */
export class NetworkError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown, message = "Could not reach the server - check your connection and try again.") {
    super(message);
    this.name = "NetworkError";
    this.cause = cause;
  }
}

/** How long a request can hang before it's treated as failed (see `request()`'s AbortController). Every scene's existing NetworkError handling covers this automatically - no per-scene changes needed. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Called once (see main.ts) with a handler that clears the token and
 * returns the player to LoginScene. `request()` invokes it whenever an
 * *authenticated* call comes back 401 (expired/invalid JWT) - a session
 * that goes stale mid-game (idle too long, server restarted with a new
 * JWT_SECRET, etc.) now recovers instead of leaving every scene's catch
 * block showing a generic "something went wrong" forever. Never fires for
 * POST /auth/signup or /auth/login (auth:false) - a 401 there means wrong
 * credentials, not an expired session, and LoginScene already handles that
 * itself.
 */
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler;
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** Attach the Authorization header. Defaults to true. Set false for /auth/signup, /auth/login. */
  auth?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = options;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new NetworkError(err, "The server is taking too long to respond - please try again.");
    }
    throw new NetworkError(err);
  } finally {
    clearTimeout(timeoutId);
  }

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // No/invalid JSON body - fine for e.g. a 204, fatal for anything the
    // caller expected data from (that surfaces via the ok-check below).
  }

  if (!res.ok) {
    const errBody = (parsed ?? {}) as { error?: string; code?: string };
    if (res.status === 401 && auth) {
      unauthorizedHandler?.();
    }
    throw new ApiError(res.status, errBody.code, errBody.error ?? `Request failed (${res.status})`, parsed);
  }

  return parsed as T;
}

// ---- Auth ----

import type {
  SignupResponse,
  LoginResponse,
  MeResponse,
  PositionResponse,
  BuyWardrobePieceResponse,
  EquipWardrobePieceResponse,
  UnequipWardrobeSlotResponse,
  WardrobeSlot,
  BuyRoomPieceResponse,
  EquipRoomPieceResponse,
  BuyItemResponse,
  EquipItemResponse,
  UnequipItemResponse,
  ItemCategory,
  ClaimBonusResponse,
  ClaimAdRewardResponse,
  Currency,
  DicePlayResponse,
  MinesStartResponse,
  MinesPickResponse,
  MinesCashOutResponse,
  CoinSide,
  CoinFlipPlayResponse,
  RouletteColor,
  RoulettePlayResponse,
  LimboPlayResponse,
  PlinkoPlayResponse,
  SlotsPlayResponse,
  KenoPlayResponse,
  WheelRisk,
  WheelPlayResponse,
  BaccaratBetType,
  BaccaratPlayResponse,
  DragonTowerStartResponse,
  DragonTowerPickResponse,
  DragonTowerCashOutResponse,
  HiLoStartResponse,
  HiLoGuess,
  HiLoGuessResponse,
  HiLoCashOutResponse,
  BlackjackStartResponse,
  BlackjackHitResponse,
  BlackjackStandResponse,
  VideoPokerDealResponse,
  VideoPokerDrawResponse,
  AbandonRoundResponse,
  TripleChancePlayResponse,
  ChallengeBoardResponse,
  ClaimChallengeResponse,
  ProgressionResponse,
  LevelMinigameStartResponse,
  LevelMinigameStopResponse
} from "./types";

export function signup(username: string, password: string, email?: string): Promise<SignupResponse> {
  return request<SignupResponse>("/auth/signup", { method: "POST", auth: false, body: { username, password, email } });
}

export function login(username: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>("/auth/login", { method: "POST", auth: false, body: { username, password } });
}

export function getMe(): Promise<MeResponse> {
  return request<MeResponse>("/me", { method: "GET" });
}

// ---- Position ----

export function savePosition(x: number, y: number): Promise<PositionResponse> {
  return request<PositionResponse>("/position", { method: "POST", body: { x, y } });
}

// ---- Wardrobe (layered character pieces - replaced skins) ----

export function buyWardrobePiece(pieceId: string): Promise<BuyWardrobePieceResponse> {
  return request<BuyWardrobePieceResponse>("/wardrobe/buy", { method: "POST", body: { pieceId } });
}

export function equipWardrobePiece(pieceId: string): Promise<EquipWardrobePieceResponse> {
  return request<EquipWardrobePieceResponse>("/wardrobe/equip", { method: "POST", body: { pieceId } });
}

/** Takes off whatever is worn in `slot`. Rejected server-side for BODY, which can never be empty. */
export function unequipWardrobeSlot(slot: WardrobeSlot): Promise<UnequipWardrobeSlotResponse> {
  return request<UnequipWardrobeSlotResponse>("/wardrobe/unequip", { method: "POST", body: { slot } });
}

// ---- Player Room (wallpaper/flooring - see src/roomCatalog.ts) ----
// No client-side getRoomCatalog(): like the wardrobe, the catalogue is
// static data the client already has bundled (src/roomCatalog.ts) -
// GET /room/catalog exists server-side purely so a non-JS client could
// discover prices, same as GET /wardrobe/catalog.

export function buyRoomPiece(pieceId: string): Promise<BuyRoomPieceResponse> {
  return request<BuyRoomPieceResponse>("/room/buy", { method: "POST", body: { pieceId } });
}

export function equipRoomPiece(pieceId: string): Promise<EquipRoomPieceResponse> {
  return request<EquipRoomPieceResponse>("/room/equip", { method: "POST", body: { pieceId } });
}

// ---- Items (accessories/pets) ----

export function buyItem(itemId: string): Promise<BuyItemResponse> {
  return request<BuyItemResponse>("/items/buy", { method: "POST", body: { itemId } });
}

export function equipItem(itemId: string): Promise<EquipItemResponse> {
  return request<EquipItemResponse>("/items/equip", { method: "POST", body: { itemId } });
}

export function unequipItem(category: ItemCategory): Promise<UnequipItemResponse> {
  return request<UnequipItemResponse>("/items/unequip", { method: "POST", body: { category } });
}

// ---- Attendant claim ----

export function claimBonus(): Promise<ClaimBonusResponse> {
  return request<ClaimBonusResponse>("/claim-bonus", { method: "POST" });
}

// ---- Ad reward (simulated - see server/src/economy/adRewards.ts) ----

export function claimAdReward(): Promise<ClaimAdRewardResponse> {
  return request<ClaimAdRewardResponse>("/ads/claim", { method: "POST" });
}

// ---- Games (#36 - server-authoritative RNG/payout) ----
// Single-shot games (bet resolved in one request) each get one function
// hitting one `POST /games/<name>/play` endpoint. Stateful games get a
// small sequence of functions instead - see server/src/routes/games.ts's
// header for which games are which and why.

export function playDice(betAmount: number, currency: Currency, target: number): Promise<DicePlayResponse> {
  return request<DicePlayResponse>("/games/dice/play", { method: "POST", body: { betAmount, currency, target } });
}

export function startMines(betAmount: number, currency: Currency): Promise<MinesStartResponse> {
  return request<MinesStartResponse>("/games/mines/start", { method: "POST", body: { betAmount, currency } });
}

export function pickMinesTile(roundId: string, tileIndex: number): Promise<MinesPickResponse> {
  return request<MinesPickResponse>("/games/mines/pick", { method: "POST", body: { roundId, tileIndex } });
}

export function cashOutMines(roundId: string): Promise<MinesCashOutResponse> {
  return request<MinesCashOutResponse>("/games/mines/cashout", { method: "POST", body: { roundId } });
}

export function playCoinFlip(betAmount: number, currency: Currency, guess: CoinSide): Promise<CoinFlipPlayResponse> {
  return request<CoinFlipPlayResponse>("/games/coinflip/play", { method: "POST", body: { betAmount, currency, guess } });
}

export function playRoulette(betAmount: number, currency: Currency, bet: RouletteColor): Promise<RoulettePlayResponse> {
  return request<RoulettePlayResponse>("/games/roulette/play", { method: "POST", body: { betAmount, currency, bet } });
}

export function playLimbo(betAmount: number, currency: Currency, target: number): Promise<LimboPlayResponse> {
  return request<LimboPlayResponse>("/games/limbo/play", { method: "POST", body: { betAmount, currency, target } });
}

export function playPlinko(betAmount: number, currency: Currency): Promise<PlinkoPlayResponse> {
  return request<PlinkoPlayResponse>("/games/plinko/play", { method: "POST", body: { betAmount, currency } });
}

export function playSlots(betAmount: number, currency: Currency): Promise<SlotsPlayResponse> {
  return request<SlotsPlayResponse>("/games/slots/play", { method: "POST", body: { betAmount, currency } });
}

export function playKeno(betAmount: number, currency: Currency, picks: number[]): Promise<KenoPlayResponse> {
  return request<KenoPlayResponse>("/games/keno/play", { method: "POST", body: { betAmount, currency, picks } });
}

export function playWheel(betAmount: number, currency: Currency, risk: WheelRisk): Promise<WheelPlayResponse> {
  return request<WheelPlayResponse>("/games/wheel/play", { method: "POST", body: { betAmount, currency, risk } });
}

export function playBaccarat(
  betAmount: number,
  currency: Currency,
  betType: BaccaratBetType
): Promise<BaccaratPlayResponse> {
  return request<BaccaratPlayResponse>("/games/baccarat/play", { method: "POST", body: { betAmount, currency, betType } });
}

export function startDragonTower(betAmount: number, currency: Currency): Promise<DragonTowerStartResponse> {
  return request<DragonTowerStartResponse>("/games/dragontower/start", { method: "POST", body: { betAmount, currency } });
}

export function pickDragonTowerTile(roundId: string, col: number): Promise<DragonTowerPickResponse> {
  return request<DragonTowerPickResponse>("/games/dragontower/pick", { method: "POST", body: { roundId, col } });
}

export function cashOutDragonTower(roundId: string): Promise<DragonTowerCashOutResponse> {
  return request<DragonTowerCashOutResponse>("/games/dragontower/cashout", { method: "POST", body: { roundId } });
}

export function startHiLo(betAmount: number, currency: Currency): Promise<HiLoStartResponse> {
  return request<HiLoStartResponse>("/games/hilo/start", { method: "POST", body: { betAmount, currency } });
}

export function guessHiLo(roundId: string, direction: HiLoGuess): Promise<HiLoGuessResponse> {
  return request<HiLoGuessResponse>("/games/hilo/guess", { method: "POST", body: { roundId, direction } });
}

export function cashOutHiLo(roundId: string): Promise<HiLoCashOutResponse> {
  return request<HiLoCashOutResponse>("/games/hilo/cashout", { method: "POST", body: { roundId } });
}

export function startBlackjack(betAmount: number, currency: Currency): Promise<BlackjackStartResponse> {
  return request<BlackjackStartResponse>("/games/blackjack/start", { method: "POST", body: { betAmount, currency } });
}

export function hitBlackjack(roundId: string): Promise<BlackjackHitResponse> {
  return request<BlackjackHitResponse>("/games/blackjack/hit", { method: "POST", body: { roundId } });
}

export function standBlackjack(roundId: string): Promise<BlackjackStandResponse> {
  return request<BlackjackStandResponse>("/games/blackjack/stand", { method: "POST", body: { roundId } });
}

export function dealVideoPoker(betAmount: number, currency: Currency): Promise<VideoPokerDealResponse> {
  return request<VideoPokerDealResponse>("/games/videopoker/deal", { method: "POST", body: { betAmount, currency } });
}

export function drawVideoPoker(roundId: string, holds: boolean[]): Promise<VideoPokerDrawResponse> {
  return request<VideoPokerDrawResponse>("/games/videopoker/draw", { method: "POST", body: { roundId, holds } });
}

// ---- Abandon (#42/#43) ----
// Forfeits whatever stateful round is currently active for this user (any
// game - the server finds it, no roundId needed from the client). See
// LoginScene.ts's post-hydration reconciliation and each stateful scene's
// WALK AWAY handler / ROUND_ALREADY_ACTIVE auto-recovery.

export function abandonRound(): Promise<AbandonRoundResponse> {
  return request<AbandonRoundResponse>("/games/abandon", { method: "POST" });
}

// ---- Triple Chance (#46 - bonus round after a shuffle-cup GC win) ----
// GC only - no currency param, the server never reads one (see
// server/src/games/triplechance.ts). betAmount is whatever GC amount is at
// stake for this round (the shuffle-cup win, or - chained - the previous
// Triple Chance round's payout), not the player's normal bet-slider amount.

export function playTripleChance(betAmount: number): Promise<TripleChancePlayResponse> {
  return request<TripleChancePlayResponse>("/games/triplechance/play", { method: "POST", body: { betAmount } });
}

// ---- Challenges, XP and levels ----
// Read-and-claim only. There is deliberately no "report my progress"
// endpoint to call: progress is recorded server-side from real game
// settlement (see server/src/progression/progress.ts's TRUST BOUNDARY note),
// because completing a challenge pays real Gold Coins.

export function getChallenges(): Promise<ChallengeBoardResponse> {
  return request<ChallengeBoardResponse>("/challenges", { method: "GET" });
}

/**
 * Claims one completed challenge. Idempotent server-side (a second claim
 * returns 409 ALREADY_CLAIMED rather than paying twice), but callers should
 * still disable the button while this is in flight - see ChallengesPanel.ts.
 */
export function claimChallenge(challengeId: string): Promise<ClaimChallengeResponse> {
  return request<ClaimChallengeResponse>("/challenges/claim", { method: "POST", body: { challengeId } });
}

export function getProgression(): Promise<ProgressionResponse> {
  return request<ProgressionResponse>("/progression", { method: "GET" });
}

// ---- Level-up "stop the marker" minigame ----
// See src/scenes/LevelUpMinigameScene.ts and server/src/progression/
// levelMinigameSession.ts. Two requests, same as every other stateful game
// here: start creates/resumes the one session a player is owed, stop scores
// it - the client never sends an accuracy/elapsed-time number, only the
// sessionId (see types.ts's TRUST BOUNDARY note on these two responses).

/** Starts (or resumes) the level-up minigame currently owed, if any - a 409 NONE_PENDING means there is nothing to play (also what a forged call with no real level-up behind it gets). */
export function startLevelMinigame(): Promise<LevelMinigameStartResponse> {
  return request<LevelMinigameStartResponse>("/minigame/levelup/start", { method: "POST" });
}

/** Stops the marker and pays out. Idempotent server-side (a second call for the same sessionId returns 409 ALREADY_CLAIMED rather than paying twice). */
export function stopLevelMinigame(sessionId: string): Promise<LevelMinigameStopResponse> {
  return request<LevelMinigameStopResponse>("/minigame/levelup/stop", { method: "POST", body: { sessionId } });
}
