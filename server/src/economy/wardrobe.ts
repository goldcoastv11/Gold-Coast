/**
 * Layered wardrobe backend - server-authoritative, replacing skinShop.ts.
 *
 * Shape is deliberately itemShop.ts's, generalized from two fixed
 * categories (ACCESSORY/PET) to the wardrobe's six slots: own a piece, wear
 * at most one piece per slot, buying also wears. Anyone who can read
 * itemShop.ts can read this.
 *
 * ## Economy
 *
 * GC only, always through the ledger, never a direct balance mutation -
 * repo-root CLAUDE.md's rule. As of the 2026-08-29 GC-only economy
 * restructure, Gold Coins buy both plays AND looks - TICKETS (the old,
 * separate win/spend currency this used to be priced in) is retired.
 *
 * The debit uses SHOP_PURCHASE_GC rather than a new enum value, which is
 * the same call itemShop.ts already made and documented: that type's own
 * doc comment in schema.prisma defines it as "an Item Shop purchase", and a
 * wardrobe piece is exactly that - the panel is the Item Shop. Reusing it
 * also avoids a per-shop enum migration. Which piece and slot was bought is
 * recorded in the transaction's `meta` for audit, same as items record
 * itemId/itemCategory.
 *
 * Prices (wardrobeLpcPieces.ts, 120-1500) were originally tuned against
 * TICKETS - a currency a player could only ever accumulate by winning
 * rounds. They're left numerically unchanged now that they're GC: the
 * Coin Kiosk's ad-gated claim already grants 500-2000 GC per ~30s wait
 * (economy/attendantClaim.ts) and packages start at 5,000 GC
 * (economy/packages.ts), so the same price band still costs a player a
 * real chunk of a claim (or some actual bet turnover) without being
 * unreachable - it isn't free, but it also isn't gated behind grinding.
 * Re-tune here if that balance ever feels off in practice.
 *
 * ## The never-invisible-player invariant
 *
 * The free default body (wardrobeCatalog.ts's DEFAULT_BODY_PIECE_ID) is
 * owned implicitly by everyone and never written as an ownership row, the
 * same way the old free "player" skin worked. `unequipSlot` refuses to
 * clear BODY at all. Between those two rules and resolveLayers' fallback on
 * the client, there is no sequence of API calls that leaves an account
 * without a body to draw.
 */

import { applyTransaction, getBalance, TxClient } from "./ledger";
import {
  DEFAULT_BODY_PIECE_ID,
  getPiece,
  getSlotDef,
  isDefaultPiece,
  WardrobePieceDef,
  WardrobeSlot
} from "../wardrobeCatalog";

export type { WardrobePieceDef, WardrobeSlot };

/** Owned pieces as stored. The free default body is implicit and never a row. */
export async function ownsPiece(tx: TxClient, userId: string, id: string): Promise<boolean> {
  if (isDefaultPiece(id)) return true; // free default - always owned, never stored.
  const row = await tx.wardrobeOwned.findUnique({ where: { userId_pieceId: { userId, pieceId: id } } });
  return row !== null;
}

/** Every piece id the player owns, with the implicit free default included. */
export async function listOwnedPieces(tx: TxClient, userId: string): Promise<string[]> {
  const rows = await tx.wardrobeOwned.findMany({ where: { userId }, select: { pieceId: true } });
  return [DEFAULT_BODY_PIECE_ID, ...rows.map((r) => r.pieceId)];
}

/**
 * What the player is wearing, as a slot -> pieceId map.
 *
 * BODY is always present in the result: an account that has never equipped
 * anything (or whose stored body is a piece that no longer exists in the
 * catalogue) reports the free default rather than an absent body.
 */
export async function getEquippedWardrobe(
  tx: TxClient,
  userId: string
): Promise<Partial<Record<WardrobeSlot, string>>> {
  const rows = await tx.equippedWardrobe.findMany({
    where: { userId },
    select: { slot: true, pieceId: true }
  });

  const equipped: Partial<Record<WardrobeSlot, string>> = {};
  for (const row of rows) {
    // Skip a stored piece that has since been retired from the catalogue -
    // the client would ignore it anyway, and reporting it invites a panel
    // to render a piece it has no definition for.
    if (getPiece(row.pieceId)) equipped[row.slot as WardrobeSlot] = row.pieceId;
  }

  if (!equipped.BODY) equipped.BODY = DEFAULT_BODY_PIECE_ID;
  return equipped;
}

export type PurchasePieceOutcome =
  | { ok: true; piece: WardrobePieceDef; transaction: Awaited<ReturnType<typeof applyTransaction>> }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "ALREADY_OWNED"; piece: WardrobePieceDef }
  | { ok: false; reason: "INSUFFICIENT_GC"; piece: WardrobePieceDef; balanceGc: number };

/**
 * Buys wardrobe piece `id` with GC and wears it immediately, in one DB
 * transaction - the same "a purchase is always also a wear" product
 * decision skins and items both made, so a purchase can never land in an
 * "owned but still wearing something else" state.
 *
 * Wearing it replaces whatever was in that piece's slot, which is what
 * makes buying a second shirt feel like changing shirts rather than
 * silently doing nothing visible.
 */
export async function purchasePiece(
  tx: TxClient,
  userId: string,
  id: string
): Promise<PurchasePieceOutcome> {
  const piece = getPiece(id);
  if (!piece) return { ok: false, reason: "NOT_FOUND" };
  if (await ownsPiece(tx, userId, id)) return { ok: false, reason: "ALREADY_OWNED", piece };

  const balanceGc = await getBalance(tx, userId, "GC");
  if (balanceGc < piece.price) {
    return { ok: false, reason: "INSUFFICIENT_GC", piece, balanceGc };
  }

  const transaction = await applyTransaction(tx, userId, "GC", "SHOP_PURCHASE_GC", -piece.price, {
    wardrobePieceId: piece.id,
    wardrobeSlot: piece.slot
  });
  await tx.wardrobeOwned.create({ data: { userId, pieceId: id } });
  await equipPiece(tx, userId, id);

  return { ok: true, piece, transaction };
}

export type EquipPieceOutcome =
  | { ok: true; piece: WardrobePieceDef }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "NOT_OWNED"; piece: WardrobePieceDef };

/** Wears an owned piece, replacing whatever occupied its slot. */
export async function equipPiece(tx: TxClient, userId: string, id: string): Promise<EquipPieceOutcome> {
  const piece = getPiece(id);
  if (!piece) return { ok: false, reason: "NOT_FOUND" };
  if (!(await ownsPiece(tx, userId, id))) return { ok: false, reason: "NOT_OWNED", piece };

  await tx.equippedWardrobe.upsert({
    where: { userId_slot: { userId, slot: piece.slot } },
    create: { userId, slot: piece.slot, pieceId: id },
    update: { pieceId: id }
  });

  return { ok: true, piece };
}

export type UnequipSlotOutcome = { ok: true } | { ok: false; reason: "SLOT_NOT_OPTIONAL" };

/**
 * Takes off whatever is worn in `slot`.
 *
 * Refuses on BODY - the one non-optional slot. A player may swap their body
 * for another one, but "no body" is not a look, and allowing it here would
 * be the one API call that could produce an invisible character.
 */
export async function unequipSlot(
  tx: TxClient,
  userId: string,
  slot: WardrobeSlot
): Promise<UnequipSlotOutcome> {
  const slotDef = getSlotDef(slot);
  if (!slotDef?.optional) return { ok: false, reason: "SLOT_NOT_OPTIONAL" };

  await tx.equippedWardrobe.deleteMany({ where: { userId, slot } });
  return { ok: true };
}
