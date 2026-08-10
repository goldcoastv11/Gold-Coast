/**
 * Placeholder client-side state for the POC only.
 *
 * IMPORTANT: In a real build, balances and game outcomes must be
 * authoritative on a server you control - never trust the client for
 * currency amounts or RNG results. This local state exists purely so
 * the POC is playable end-to-end without a backend yet.
 *
 * The "login" system below is the same story: it's a username/password
 * screen that checks against a hash stored in this browser's own
 * localStorage - there is no server, so it is NOT real authentication.
 * Anyone with devtools access to this browser can read or edit every
 * profile. It exists purely so coins/skins survive a page reload and so
 * a couple of people sharing one device don't stomp on each other's
 * progress. Do not reuse this pattern for anything that matters.
 */

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
  goldCoins: number;
  stakeCoins: number;
  betAmount: number;
  currentSkin: string;
  unlockedSkins: string[];
}

type ProfileStore = Record<string, StoredProfile>;

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
  private _goldCoins = 1000;
  private _stakeCoins = 25;
  private _currentSkin = "player";
  private _betAmount = 25;

  /** Skin ids the player owns. "player" (Classic) is always owned/free. */
  unlockedSkins: string[] = ["player"];

  /** Username of the currently logged-in profile, or null before login. */
  activeUsername: string | null = null;

  get goldCoins() {
    return this._goldCoins;
  }
  set goldCoins(v: number) {
    this._goldCoins = v;
    this.save();
  }

  get stakeCoins() {
    return this._stakeCoins;
  }
  set stakeCoins(v: number) {
    this._stakeCoins = v;
    this.save();
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

  /** Grants a Gold Coin bonus. No cooldown for this POC - always available. */
  claimBonus(): number {
    const amount = 1000;
    this.goldCoins += amount;
    return amount;
  }

  ownsSkin(id: string): boolean {
    return this.unlockedSkins.includes(id);
  }

  /** Attempts to purchase a skin. Returns false if already owned or can't afford it. */
  purchaseSkin(id: string): boolean {
    const def = SKIN_CATALOG.find((s) => s.id === id);
    if (!def) return false;
    if (this.ownsSkin(id)) return false;
    if (this.goldCoins < def.price) return false;

    this.goldCoins -= def.price;
    this.unlockedSkins.push(id);
    this.save();
    return true;
  }

  /**
   * Logs into (or creates, if the username is new) a local profile. On
   * success, every persisted field above is loaded from - or initialized
   * and saved to - localStorage under this username.
   */
  login(usernameRaw: string, password: string): LoginResult {
    const username = usernameRaw.trim();
    if (!username) return { ok: false, error: "Enter a username" };
    if (!password) return { ok: false, error: "Enter a password" };

    const profiles = loadProfiles();
    const existing = profiles[username];
    const hash = weakHash(password);

    if (existing) {
      if (existing.passwordHash !== hash) {
        return { ok: false, error: "Wrong password for that username" };
      }
      this._goldCoins = existing.goldCoins;
      this._stakeCoins = existing.stakeCoins;
      this._betAmount = existing.betAmount;
      this._currentSkin = existing.currentSkin;
      this.unlockedSkins = [...existing.unlockedSkins];
      this.activeUsername = username;
      return { ok: true, isNew: false };
    }

    // New username - create a fresh profile with default starting state
    this._goldCoins = 1000;
    this._stakeCoins = 25;
    this._betAmount = 25;
    this._currentSkin = "player";
    this.unlockedSkins = ["player"];
    this.activeUsername = username;

    profiles[username] = {
      passwordHash: hash,
      goldCoins: this._goldCoins,
      stakeCoins: this._stakeCoins,
      betAmount: this._betAmount,
      currentSkin: this._currentSkin,
      unlockedSkins: this.unlockedSkins
    };
    writeProfiles(profiles);
    return { ok: true, isNew: true };
  }

  /** Clears the active session. Local profile data in localStorage is untouched. */
  logout() {
    this.activeUsername = null;
    this.lastPlayerPosition = null;
  }

  /** Persists the active profile's current state to localStorage. No-op if not logged in. */
  private save() {
    if (!this.activeUsername) return;
    const profiles = loadProfiles();
    const existing = profiles[this.activeUsername];
    profiles[this.activeUsername] = {
      passwordHash: existing?.passwordHash ?? weakHash(""),
      goldCoins: this._goldCoins,
      stakeCoins: this._stakeCoins,
      betAmount: this._betAmount,
      currentSkin: this._currentSkin,
      unlockedSkins: this.unlockedSkins
    };
    writeProfiles(profiles);
  }
}

export const gameState = new GameState();
