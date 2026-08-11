/**
 * Skin shop backend - the API the "floor" front-end should build against.
 *
 * Economy rule: skins are purchased with GC only, never SC, and skin
 * purchase logic is kept fully separate from SC/redemption/playthrough
 * logic - this module never imports from playthrough.ts or redemption.ts,
 * and never touches the SC side of a LedgerState.
 *
 * Ownership (`unlockedSkins: string[]`) is passed in and mutated in place,
 * same pattern as LedgerState - this module has no persistence/storage
 * concerns of its own, so it stays trivially unit-testable. GameState owns
 * calling `save()` after a purchase.
 *
 * ---- Usage for the "floor" front-end ----
 *   import {
 *     listSkins, getSkin, ownsSkin, canAffordSkin, purchaseSkin
 *   } from "../economy/skinShop";
 *
 *   listSkins()                          -> SkinDef[] (full catalog, in display order)
 *   getSkin(id)                          -> SkinDef | undefined
 *   ownsSkin(unlockedSkins, id)          -> boolean
 *   canAffordSkin(ledger, id)            -> boolean (ownership NOT checked - combine with ownsSkin)
 *   purchaseSkin(ledger, unlockedSkins, id) -> PurchaseSkinOutcome (see below; check `.ok`)
 *
 * `ledger` is the player's LedgerState (economy/ledger.ts) and
 * `unlockedSkins` is the player's owned-skin-id array - both live on
 * GameState and should be passed straight through, not copied.
 */

import { SKIN_CATALOG, SkinDef } from "../GameState";
import { LedgerState, Transaction, applyTransaction, getBalance } from "./ledger";

export type { SkinDef };

/** Full skin catalog, in display order. "player" (Classic) is the free default. */
export function listSkins(): readonly SkinDef[] {
  return SKIN_CATALOG;
}

export function getSkin(id: string): SkinDef | undefined {
  return SKIN_CATALOG.find((s) => s.id === id);
}

export function ownsSkin(unlockedSkins: readonly string[], id: string): boolean {
  return unlockedSkins.includes(id);
}

/** Whether the current GC balance covers this skin's price. Does not check ownership. */
export function canAffordSkin(ledger: LedgerState, id: string): boolean {
  const skin = getSkin(id);
  if (!skin) return false;
  return getBalance(ledger, "GC") >= skin.price;
}

export type PurchaseSkinOutcome =
  | { ok: true; skin: SkinDef; transaction: Transaction }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "ALREADY_OWNED"; skin: SkinDef }
  | { ok: false; reason: "INSUFFICIENT_GC"; skin: SkinDef; balanceGc: number };

/**
 * Attempts to buy skin `id` with GC. On success, debits the ledger
 * (SKIN_PURCHASE_GC transaction) and pushes `id` onto `unlockedSkins`.
 * Returns a discriminated result instead of throwing - check `.ok` and, on
 * failure, `.reason` to show the right UI state (already owned vs can't
 * afford vs unknown skin id).
 */
export function purchaseSkin(
  ledger: LedgerState,
  unlockedSkins: string[],
  id: string
): PurchaseSkinOutcome {
  const skin = getSkin(id);
  if (!skin) return { ok: false, reason: "NOT_FOUND" };
  if (ownsSkin(unlockedSkins, id)) return { ok: false, reason: "ALREADY_OWNED", skin };

  const balanceGc = getBalance(ledger, "GC");
  if (balanceGc < skin.price) {
    return { ok: false, reason: "INSUFFICIENT_GC", skin, balanceGc };
  }

  const transaction = applyTransaction(ledger, "GC", "SKIN_PURCHASE_GC", -skin.price, {
    skinId: skin.id
  });
  unlockedSkins.push(id);

  return { ok: true, skin, transaction };
}
