/**
 * Client-side state, now backed by casino-poc/server (task #37).
 *
 * Task #37 status: LoginScene now calls the real POST /auth/signup and
 * POST /auth/login endpoints (see src/api/client.ts) instead of the old
 * localStorage-hashed fake auth, and hydrates this class from the server's
 * response (or GET /me on a silent session restore) via
 * `hydrateFromServer()` below - balances/skins/position/attendant-claim
 * cooldown are now server-authoritative for a logged-in session. Position
 * saves, skin buy/equip, and the attendant claim are likewise wired to
 * their real endpoints from OverworldScene.ts.
 *
 * What's still local/placeholder: the legacy `login()`/`purchaseSkin()`/
 * `claimAttendantBonus()` methods and the economy/*.ts ledger they call
 * still exist below, still fully functional, and are still covered by
 * GameState.test.ts etc - they're kept as-is (not removed) because (a) the
 * 14 game scenes still wager/pay out locally via the legacy `goldCoins`
 * setter until "games" lands each backend game endpoint (task #36) and
 * this class is their bridge in the meantime, and (b) removing them would
 * break the existing unit tests that intentionally still exercise the
 * pre-server behavior. Once every game is migrated, this class can drop
 * the local ledger entirely in favor of always reading server state.
 *
 * IMPORTANT: for any interaction NOT yet wired to the server (the
 * remaining local game scenes), balances/outcomes are still computed
 * client-side and are not authoritative - see repo-root CLAUDE.md and the
 * warnings historically in this file for why that's not acceptable beyond
 * a POC.
 *
 * Economy note ("arcade token" model - see ledger.ts's doc comment and
 * repo-root CLAUDE.md): GC (what you spend to play) and TICKETS (what
 * winning a game pays out, spent in the Item Shop) live behind the
 * transaction ledger in src/economy/ledger.ts. GameState is the
 * persistence + convenience layer on top; it should never assign to a
 * balance number directly - everything routes through applyTransaction
 * (or the dedicated economy/*.ts helpers that call it).
 */

import { Currency, LedgerState, Transaction, applyTransaction, createLedger, getBalance } from "./economy/ledger";
import { grantSignupBonus } from "./economy/signupBonus";
import { GcMultiplier } from "./economy/gcMultiplier";
import {
  PackagePurchaseOutcome,
  purchasePackage as purchasePackageInternal
} from "./economy/packages";
import { claimAdRewardGc } from "./economy/adRewards";
import {
  AttendantClaimOutcome,
  attendantClaimCooldownRemaining,
  claimAttendantBonus as claimAttendantBonusInternal
} from "./economy/attendantClaim";
import {
  PurchaseSkinOutcome,
  purchaseSkin as purchaseSkinInternal
} from "./economy/skinShop";
import {
  PlaceBetOutcome,
  ResolveBetOutcome,
  placeBet as placeBetInternal,
  resolveBet as resolveBetInternal
} from "./economy/betting";
import { clearToken } from "./api/client";
import type { MeResponse } from "./api/types";

export type { Currency, GcMultiplier };

export interface SkinDef {
  id: string; // also used as the animation prefix, e.g. "skin_000"
  textureKey: string;
  name: string;
  price: number; // 0 = free/default
}

/** Every skin available in the game. "player_sheet" is the free default. */
export const SKIN_CATALOG: SkinDef[] = [
  { id: "player", textureKey: "player_sheet", name: "Classic", price: 0 },
  { id: "skin_000", textureKey: "skin_000", name: "Outfit 1", price: 400 },
  { id: "skin_001", textureKey: "skin_001", name: "Outfit 2", price: 250 },
  { id: "skin_002", textureKey: "skin_002", name: "Outfit 3", price: 1000 },
  { id: "skin_003", textureKey: "skin_003", name: "Outfit 4", price: 900 },
  { id: "skin_004", textureKey: "skin_004", name: "Outfit 5", price: 900 },
  { id: "skin_005", textureKey: "skin_005", name: "Outfit 6", price: 500 },
  { id: "skin_006", textureKey: "skin_006", name: "Outfit 7", price: 400 },
  { id: "skin_007", textureKey: "skin_007", name: "Outfit 8", price: 350 },
  { id: "skin_008", textureKey: "skin_008", name: "Outfit 9", price: 2500 },
  { id: "skin_009", textureKey: "skin_009", name: "Outfit 10", price: 300 },
  { id: "skin_010", textureKey: "skin_010", name: "Outfit 11", price: 250 },
  { id: "skin_011", textureKey: "skin_011", name: "Outfit 12", price: 350 },
  { id: "skin_012", textureKey: "skin_012", name: "Outfit 13", price: 750 },
  { id: "skin_013", textureKey: "skin_013", name: "Outfit 14", price: 900 },
  { id: "skin_014", textureKey: "skin_014", name: "Outfit 15", price: 4000 },
  { id: "skin_015", textureKey: "skin_015", name: "Outfit 16", price: 250 },
  { id: "skin_016", textureKey: "skin_016", name: "Outfit 17", price: 750 }
];

/** Shared bet-size stepper used by every game screen. */
export const BET_MIN = 5;
export const BET_MAX = 500;
export const BET_STEP = 5;

const PROFILES_KEY = "casinoPocProfiles";

interface StoredProfile {
  passwordHash: string;
  ledger: LedgerState;
  betAmount: number;
  currentSkin: string;
  unlockedSkins: string[];
  /**
   * ms-since-epoch of the last successful attendant-claim (#18/#19), or
   * null/absent if never claimed. Optional because profiles saved before
   * #19 shipped won't have this key - always read it via `?? null`.
   */
  attendantClaimedAt?: number | null;
}

/** Shape of profiles written before the ledger existed (flat goldCoins/stakeCoins numbers - "stakeCoins" predates the "arcade token" rebrand, back when the second currency was SC/"Sweeps Coins"). */
interface LegacyStoredProfile {
  passwordHash: string;
  goldCoins: number;
  stakeCoins: number;
  betAmount: number;
  currentSkin: string;
  unlockedSkins: string[];
}

type ProfileStore = Record<string, StoredProfile | LegacyStoredProfile>;

function isLegacyProfile(p: StoredProfile | LegacyStoredProfile): p is LegacyStoredProfile {
  return typeof (p as LegacyStoredProfile).goldCoins === "number";
}

/**
 * Migrates a pre-ledger profile (flat goldCoins/stakeCoins numbers) into
 * the ledger shape. The old "stakeCoins" balance (SC, under the retired
 * two-currency sweepstakes model) carries straight over into the new
 * TICKETS balance 1:1, purely so an old local profile doesn't lose its
 * balance outright in the migration - the two currencies meant different
 * things, but there's no more meaningful mapping available than a direct
 * numeric carry-over for a POC's local-only save data. Never claimed the
 * attendant bonus under this shape, so its cooldown starts fresh (null -
 * available immediately).
 */
function migrateLegacyProfile(legacy: LegacyStoredProfile): StoredProfile {
  return {
    passwordHash: legacy.passwordHash,
    ledger: createLedger(legacy.goldCoins, legacy.stakeCoins),
    betAmount: legacy.betAmount,
    currentSkin: legacy.currentSkin,
    unlockedSkins: legacy.unlockedSkins,
    attendantClaimedAt: null
  };
}

/**
 * Trivial, non-cryptographic string hash (FNV-1a). This is NOT secure - it
 * only exists so a password isn't sitting in localStorage as plain text
 * next to the username. See the file-level warning above.
 */
function weakHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function loadProfiles(): ProfileStore {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    return raw ? (JSON.parse(raw) as ProfileStore) : {};
  } catch {
    return {};
  }
}

function writeProfiles(profiles: ProfileStore) {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) - progress
    // just won't persist this session, which is an acceptable POC fallback.
  }
}

export type LoginResult =
  | { ok: true; isNew: boolean }
  | { ok: false; error: string };

class GameState {
  private _ledger: LedgerState = createLedger(0, 0);
  private _currentSkin = "player";
  private _betAmount = 25;
  /** ms-since-epoch of the last successful attendant claim (#18/#19), or null if never claimed. */
  private _attendantClaimedAt: number | null = null;
  /**
   * ms-since-epoch of the last successful ad-reward claim, or null if never
   * claimed. Server-hydrated only (see hydrateFromServer) - this is a new,
   * fully server-authoritative feature with no pre-backend local-ledger
   * equivalent, unlike attendantClaimedAt above, so there's no matching
   * legacy claim method/local persistence for it - only the read side lives
   * here, purely for optimistic "is the button enabled" UI display before
   * the real POST /ads/claim call, which is the actual source of truth.
   */
  private _adRewardClaimedAt: number | null = null;

  /** Skin ids the player owns. "player" (Classic) is always owned/free. */
  unlockedSkins: string[] = ["player"];

  /** Username of the currently logged-in profile, or null before login. */
  activeUsername: string | null = null;

  get goldCoins() {
    return getBalance(this._ledger, "GC");
  }
  /**
   * Legacy-compatible setter used by existing game scenes
   * (`gameState.goldCoins -= bet` / `+= payout`). Still routes through the
   * ledger - computes the delta and applies it as an ADJUST_GC
   * transaction - so "no direct balance mutation" holds even for call
   * sites that haven't migrated to explicit WAGER_GC/PAYOUT_GC calls yet.
   */
  set goldCoins(v: number) {
    const delta = v - this.goldCoins;
    if (delta === 0) return;
    try {
      applyTransaction(this._ledger, "GC", "ADJUST_GC", delta);
    } catch {
      // Would have gone negative - clamp to 0 instead of throwing out of a
      // scene's render loop. Scenes are expected to check affordability
      // before deducting, so this is a defensive fallback only.
      const remaining = -this.goldCoins;
      if (remaining !== 0) applyTransaction(this._ledger, "GC", "ADJUST_GC", remaining);
    }
    this.save();
  }

  /**
   * Read-only by design (economy rule: TICKETS are NEVER sold/minted -
   * they're only ever won by playing a game, see ledger.ts's "arcade
   * token" model doc comment). No legacy `set tickets` bridge - a
   * generic delta-based setter would let a future `gameState.tickets +=
   * X` silently mint TICKETS with no ledger-level guard.
   *
   * To move TICKETS, use the dedicated ledger-backed methods below:
   * credit via `resolveBet()` (a game round's win); debit via
   * `purchaseSkin()` (the Item Shop).
   */
  get tickets() {
    return getBalance(this._ledger, "TICKETS");
  }

  get currentSkin() {
    return this._currentSkin;
  }
  set currentSkin(v: string) {
    this._currentSkin = v;
    this.save();
  }

  /** Current bet size, shared across every game so it only needs to be set
   * once. Adjusted via the +/- bet control on each game screen. */
  get betAmount() {
    return this._betAmount;
  }
  set betAmount(v: number) {
    this._betAmount = v;
    this.save();
  }

  /** Nudges betAmount by delta (can be negative), clamped to [BET_MIN, BET_MAX]. */
  adjustBet(delta: number) {
    this.betAmount = Math.max(BET_MIN, Math.min(BET_MAX, this.betAmount + delta));
  }

  /** Directly sets betAmount (e.g. from typed keyboard input), clamped to
   * [BET_MIN, BET_MAX]. Ignores non-finite input instead of throwing. */
  setBet(amount: number) {
    if (!Number.isFinite(amount)) return;
    this.betAmount = Math.max(BET_MIN, Math.min(BET_MAX, Math.round(amount)));
  }

  /** Where the player was standing in the overworld before entering a game
   * or the start menu, so returning drops them back in the same spot
   * instead of resetting to the default spawn. Null until first recorded.
   * Intentionally not persisted - just a same-session convenience.
   */
  lastPlayerPosition: { x: number; y: number } | null = null;

  /**
   * Onboarding tutorial cross-scene coordination (see ui/TutorialGuide.ts
   * and OverworldScene's hands-on tutorial steps). The tutorial's
   * "Play a Game" step sends the player into a real game scene (Dice) -
   * a real scene transition, not just an overlay panel like the Chip/Skin
   * Attendant steps - so it needs *some* state that survives the scene
   * boundary. Deliberately NOT using Phaser's own scene-data mechanism for
   * this (`scene.start(key, data)`): `Systems.start()` only overwrites
   * `settings.data` `if (data)` is truthy, so a later `scene.start(key)`
   * call with no data (which is what every single game scene's exit
   * button does) silently keeps whatever data was passed the LAST time
   * that scene started - confirmed directly in Phaser's own source. That
   * bug is exactly why the tutorial was re-triggering after playing any
   * game. A plain gameState field, read once and explicitly cleared by
   * whichever scene consumes it, has no equivalent footgun. Neither field
   * is persisted (matching TutorialGuide.ts's whole "not persisted
   * anywhere" design) - they only need to survive within one continuous
   * play session, never across a reload.
   */
  /** True while the tutorial's "Play a Game" step is waiting for the player to enter and complete one real Coin Flip round - CoinFlipScene.create() checks this to show its own highlight/instruction, and clears it once a real round resolves (or the player walks away without playing). */
  tutorialAwaitingGamePlay = false;
  /** Set by CoinFlipScene right before returning to the Overworld after a tutorial-triggered round resolves, so OverworldScene resumes the tutorial at the Skin Attendant step instead of doing nothing. Read-and-cleared exactly once, by OverworldScene.create(). */
  tutorialResumeAtSkinAttendant = false;

  // ---- Economy: ledger-backed operations ----
  // These delegate to src/economy/*.ts (pure, unit-testable) and persist
  // afterwards. Prefer these over the legacy goldCoins setter for any new
  // call site.

  /** Read-only view of every transaction recorded for the active profile. */
  get transactions(): readonly Transaction[] {
    return this._ledger.transactions;
  }

  /**
   * #20 - bet lifecycle, "arcade token" model. See src/economy/betting.ts
   * for the full integration guide; short version:
   *   const bet = gameState.placeBet(amount);
   *   if (!bet.ok) {/* show why, don't start the round *\/ }
   *   // ...run the round...
   *   gameState.resolveBet(ticketsPayout); // 0 payout = total loss, valid
   *
   * placeBet always debits GC (the only wagerable currency now); resolveBet
   * always credits TICKETS (the only currency a round can win). Not wired
   * into any game scene yet - that integration is a follow-up for
   * games/floor (real gameplay already goes through the server-
   * authoritative equivalent, server/src/games/shared.ts).
   */
  placeBet(amount: number): PlaceBetOutcome {
    const outcome = placeBetInternal(this._ledger, amount);
    if (outcome.ok) this.save();
    return outcome;
  }

  /** See `placeBet` above. Credits the round's TICKETS payout; pass 0 for a total loss. */
  resolveBet(ticketsPayout: number): ResolveBetOutcome {
    const outcome = resolveBetInternal(this._ledger, ticketsPayout);
    if (outcome.transaction) this.save();
    return outcome;
  }

  /** Buys a GC package tier (see economy/packages.ts). */
  purchasePackage(packageId: string): PackagePurchaseOutcome {
    const result = purchasePackageInternal(this._ledger, packageId);
    if (result.ok) this.save();
    return result;
  }

  /** GC-only ad-reward refill claim. */
  claimAdReward(): Transaction {
    const tx = claimAdRewardGc(this._ledger);
    this.save();
    return tx;
  }

  ownsSkin(id: string): boolean {
    return this.unlockedSkins.includes(id);
  }

  /** Attempts to purchase a skin with TICKETS. Returns false if already owned or can't afford it (see economy/skinShop.ts for the detailed-reason version). */
  purchaseSkin(id: string): boolean {
    const outcome: PurchaseSkinOutcome = purchaseSkinInternal(
      this._ledger,
      this.unlockedSkins,
      id
    );
    if (outcome.ok) this.save();
    return outcome.ok;
  }

  /**
   * Grants a Gold Coin bonus via the GC-only ad-reward path. No cooldown
   * for this POC - always available. Kept for a future real "watch an ad"
   * feature; the overworld Coin Kiosk no longer calls this (see
   * `claimAttendantBonus` below, #18/#19) - it has its own ad-gated flow.
   */
  claimBonus(): number {
    const tx = this.claimAdReward();
    return tx.amount;
  }

  /** ms remaining before `claimAttendantBonus()` can succeed again. 0 = available now. */
  get attendantClaimCooldownRemainingMs(): number {
    return attendantClaimCooldownRemaining(this._attendantClaimedAt);
  }

  /**
   * ms remaining before the ad-reward claim (POST /ads/claim,
   * AD_REWARD_COOLDOWN_MS = 60s server-side - see
   * server/src/economy/adRewards.ts) can succeed again, based on the last
   * server-hydrated value. 0 = available now. Optimistic only - the server
   * re-checks this on every claim regardless of what this says.
   */
  get adRewardCooldownRemainingMs(): number {
    if (this._adRewardClaimedAt === null) return 0;
    const AD_REWARD_COOLDOWN_MS = 60_000; // keep in sync with server/src/economy/adRewards.ts
    return Math.max(0, AD_REWARD_COOLDOWN_MS - (Date.now() - this._adRewardClaimedAt));
  }

  /**
   * The overworld Coin Kiosk's free GC claim (formerly the "Chip
   * Attendant's", #18/#19) - watch a simulated ad, then a shuffle-cup
   * mini-game reveals the (server-resolved) multiplier. GC-only, no SC leg
   * (removed - see src/economy/attendantClaim.ts's doc comment for why),
   * granted via `AD_REWARD_GC`, same in kind as an ad-reward refill just
   * with a variable multiplier and its own separately-tracked cooldown.
   * Gated by a persisted 30s cooldown - check
   * `attendantClaimCooldownRemainingMs` before showing a claim button as
   * enabled, or just call this and handle the `COOLDOWN` outcome.
   *
   * `multiplier` (#27) is the resolved shuffle-cup outcome (0.5x/1x/2x,
   * see economy/gcMultiplier.ts) that games/floor's mini-game (#28/#29)
   * produces. Defaults to 1 (= 1000 GC).
   */
  claimAttendantBonus(multiplier: GcMultiplier = 1): AttendantClaimOutcome {
    const now = Date.now();
    const outcome = claimAttendantBonusInternal(this._ledger, this._attendantClaimedAt, multiplier, now);
    if (outcome.ok) {
      this._attendantClaimedAt = now;
      this.save();
    }
    return outcome;
  }

  /**
   * True if `username` (trimmed) has no existing profile - i.e. calling
   * `login()` with it would create a new one and run the signup bonus.
   * Read-only, no side effects. #29: LoginScene calls this before deciding
   * whether to play the shuffle-cup mini-game (new profiles only) or just
   * log in directly (existing profiles never get the mini-game/a resolved
   * multiplier - see login()'s doc comment).
   */
  isNewUsername(usernameRaw: string): boolean {
    const username = usernameRaw.trim();
    if (!username) return false;
    return !loadProfiles()[username];
  }

  /**
   * Logs into (or creates, if the username is new) a local profile. On
   * success, every persisted field above is loaded from - or initialized
   * and saved to - localStorage under this username.
   *
   * `gcMultiplier` (#27) only matters for brand-new profiles: it's the
   * resolved shuffle-cup outcome (0.5x/1x/2x, see economy/gcMultiplier.ts)
   * for the signup bonus's GC leg, from games/floor's mini-game (#28/#29).
   * Defaults to 1 (= 1000 GC, the pre-#27 fixed amount), so existing call
   * sites (e.g. LoginScene.ts) work unchanged until that's wired up.
   * Ignored when logging into an existing profile (no new bonus is
   * granted on re-login).
   */
  login(usernameRaw: string, password: string, gcMultiplier: GcMultiplier = 1): LoginResult {
    const username = usernameRaw.trim();
    if (!username) return { ok: false, error: "Enter a username" };
    if (!password) return { ok: false, error: "Enter a password" };

    const profiles = loadProfiles();
    const existingRaw = profiles[username];
    const hash = weakHash(password);

    if (existingRaw) {
      if (existingRaw.passwordHash !== hash) {
        return { ok: false, error: "Wrong password for that username" };
      }
      const existing = isLegacyProfile(existingRaw)
        ? migrateLegacyProfile(existingRaw)
        : existingRaw;

      this._ledger = createLedger(existing.ledger.gc, existing.ledger.tickets);
      this._ledger.transactions = [...existing.ledger.transactions];
      this._betAmount = existing.betAmount;
      this._currentSkin = existing.currentSkin;
      this.unlockedSkins = [...existing.unlockedSkins];
      this._attendantClaimedAt = existing.attendantClaimedAt ?? null;
      this.activeUsername = username;
      this.save(); // persist migration (if any) immediately
      return { ok: true, isNew: false };
    }

    // New username - create a fresh profile with default starting state,
    // including the no-deposit signup bonus (#27: GC leg resolved from
    // gcMultiplier).
    this._ledger = createLedger(0, 0);
    this._betAmount = 25;
    this._currentSkin = "player";
    this.unlockedSkins = ["player"];
    this._attendantClaimedAt = null;
    this.activeUsername = username;
    grantSignupBonus(this._ledger, gcMultiplier);

    profiles[username] = {
      passwordHash: hash,
      ledger: this._ledger,
      betAmount: this._betAmount,
      currentSkin: this._currentSkin,
      unlockedSkins: this.unlockedSkins,
      attendantClaimedAt: this._attendantClaimedAt
    };
    writeProfiles(profiles);
    return { ok: true, isNew: true };
  }

  /**
   * Task #37: loads this class's in-memory/read cache from a server
   * MeResponse (the `user` field of POST /auth/signup, POST /auth/login,
   * POST /skins/buy|equip, POST /claim-bonus, or a plain GET /me) instead
   * of a localStorage profile. Call this after every one of those calls
   * succeeds so every getter below (goldCoins, tickets, unlockedSkins,
   * currentSkin, lastPlayerPosition, attendantClaim*) reflects the
   * server's authoritative state.
   *
   * Deliberately does NOT call `save()` - there is no more local profile to
   * write; the server is the source of truth for a hydrated session. The
   * local ledger is still populated (via createLedger, not applyTransaction
   * - these are absolute values, not deltas) purely so unmigrated game
   * scenes' legacy `gameState.goldCoins -= bet` / `+= payout` calls keep
   * working against a real starting balance until they're migrated (task
   * #36) - those local mutations are NOT sent back to the server.
   */
  hydrateFromServer(me: MeResponse) {
    this.activeUsername = me.username;
    this._ledger = createLedger(me.goldCoins, me.tickets);
    this.unlockedSkins = [...me.skinsOwned];
    this._currentSkin = me.equippedSkin;
    this.lastPlayerPosition = me.lastPosition ? { x: me.lastPosition.x, y: me.lastPosition.y } : null;
    this._attendantClaimedAt = me.attendantClaim.lastClaimedAt
      ? Date.parse(me.attendantClaim.lastClaimedAt)
      : null;
    this._adRewardClaimedAt = me.adReward.lastClaimedAt ? Date.parse(me.adReward.lastClaimedAt) : null;
  }

  /** Clears the active session (including the stored JWT - see src/api/client.ts). Local profile data in localStorage is untouched. */
  logout() {
    this.activeUsername = null;
    this.lastPlayerPosition = null;
    clearToken();
  }

  /** Persists the active profile's current state to localStorage. No-op if not logged in. */
  private save() {
    if (!this.activeUsername) return;
    const profiles = loadProfiles();
    const existingRaw = profiles[this.activeUsername];
    const passwordHash = existingRaw?.passwordHash ?? weakHash("");
    profiles[this.activeUsername] = {
      passwordHash,
      ledger: this._ledger,
      betAmount: this._betAmount,
      currentSkin: this._currentSkin,
      unlockedSkins: this.unlockedSkins,
      attendantClaimedAt: this._attendantClaimedAt
    };
    writeProfiles(profiles);
  }
}

export const gameState = new GameState();
