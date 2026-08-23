/**
 * Skin shop (Item Shop) backend - the API the "floor" front-end should
 * build against.
 *
 * Economy rule: skins are purchased with TICKETS only - the arcade-prize
 * currency won from playing games (see ledger.ts's doc comment for the
 * full "arcade token" model: GC to play, TICKETS won from playing). This
 * used to be GC; changed so there's an actual reason to play the games
 * beyond chasing a bigger GC balance - TICKETS earned from winning are
 * what unlock real, spendable items.
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

/** Whether the current TICKETS balance covers this skin's price. Does not check ownership. */
export function canAffordSkin(ledger: LedgerState, id: string): boolean {
  const skin = getSkin(id);
  if (!skin) return false;
  return getBalance(ledger, "TICKETS") >= skin.price;
}

export type PurchaseSkinOutcome =
  | { ok: true; skin: SkinDef; transaction: Transaction }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "ALREADY_OWNED"; skin: SkinDef }
  | { ok: false; reason: "INSUFFICIENT_TICKETS"; skin: SkinDef; balanceTickets: number };

/**
 * Attempts to buy skin `id` with TICKETS. On success, debits the ledger
 * (SKIN_PURCHASE_TICKETS transaction) and pushes `id` onto `unlockedSkins`.
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

  const balanceTickets = getBalance(ledger, "TICKETS");
  if (balanceTickets < skin.price) {
    return { ok: false, reason: "INSUFFICIENT_TICKETS", skin, balanceTickets };
  }

  const transaction = applyTransaction(ledger, "TICKETS", "SKIN_PURCHASE_TICKETS", -skin.price, {
    skinId: skin.id
  });
  unlockedSkins.push(id);

  return { ok: true, skin, transaction };
}
