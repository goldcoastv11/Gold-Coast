/**
 * Placeholder client-side state for the POC only.
 *
 * IMPORTANT: In a real build, balances and game outcomes must be
 * authoritative on a server you control - never trust the client for
 * currency amounts or RNG results. This local state exists purely so
 * the POC is playable end-to-end without a backend yet.
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

class GameState {
  goldCoins = 1000;
  stakeCoins = 25;

  /** Current bet size, shared across every game so it only needs to be set
   * once. Adjusted via the +/- bet control on each game screen. */
  betAmount = 25;

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
   */
  lastPlayerPosition: { x: number; y: number } | null = null;

  /** Skin ids the player owns. "player" (Classic) is always owned/free. */
  unlockedSkins: string[] = ["player"];

  /** Currently equipped skin id. */
  currentSkin = "player";

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
    return true;
  }
}

export const gameState = new GameState();
