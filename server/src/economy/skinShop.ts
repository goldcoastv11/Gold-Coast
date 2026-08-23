/**
 * Skin shop (Item Shop) backend - server-authoritative port of
 * casino-poc/src/economy/skinShop.ts.
 *
 * Economy rule: skins are purchased with TICKETS only - the arcade-prize
 * currency won from playing games (see ledger.ts's doc comment for the
 * full "arcade token" model: GC to play, TICKETS won from playing). This
 * used to be GC; changed so there's an actual reason to play the games
 * beyond chasing a bigger GC balance - TICKETS earned from winning are
 * what unlock real, spendable items. Never touches the GC column of
 * `balances`.
 */

import { applyTransaction, getBalance, TxClient } from "./ledger";
import { getSkin, SkinDef } from "../skinCatalog";

export type { SkinDef };

export async function ownsSkin(tx: TxClient, userId: string, id: string): Promise<boolean> {
  if (id === "player") return true; // Classic is always owned/free, never stored as a row.
  const row = await tx.skinOwned.findUnique({ where: { userId_skinId: { userId, skinId: id } } });
  return row !== null;
}

export async function listOwnedSkins(tx: TxClient, userId: string): Promise<string[]> {
  const rows = await tx.skinOwned.findMany({ where: { userId }, select: { skinId: true } });
  return ["player", ...rows.map((r) => r.skinId)];
}

export type PurchaseSkinOutcome =
  | { ok: true; skin: SkinDef; transaction: Awaited<ReturnType<typeof applyTransaction>> }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "ALREADY_OWNED"; skin: SkinDef }
  | { ok: false; reason: "INSUFFICIENT_TICKETS"; skin: SkinDef; balanceTickets: number };

/**
 * Attempts to buy skin `id` with TICKETS for `userId`. On success, debits
 * the ledger (SKIN_PURCHASE_TICKETS transaction), inserts a skins_owned
 * row, and equips it immediately (same transaction, so a purchase is
 * never left in an "owned but still wearing something else" state) - a
 * purchase is always also a wear, per product decision. Purely additive
 * to ownership; doesn't touch the GC balance beyond the purchase debit
 * itself.
 */
export async function purchaseSkin(tx: TxClient, userId: string, id: string): Promise<PurchaseSkinOutcome> {
  const skin = getSkin(id);
  if (!skin) return { ok: false, reason: "NOT_FOUND" };
  if (await ownsSkin(tx, userId, id)) return { ok: false, reason: "ALREADY_OWNED", skin };

  const balanceTickets = await getBalance(tx, userId, "TICKETS");
  if (balanceTickets < skin.price) {
    return { ok: false, reason: "INSUFFICIENT_TICKETS", skin, balanceTickets };
  }

  const transaction = await applyTransaction(tx, userId, "TICKETS", "SKIN_PURCHASE_TICKETS", -skin.price, {
    skinId: skin.id
  });
  await tx.skinOwned.create({ data: { userId, skinId: id } });
  await equipSkin(tx, userId, id);

  return { ok: true, skin, transaction };
}

export type EquipSkinOutcome =
  | { ok: true; skinId: string }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "NOT_OWNED"; skin: SkinDef };

/** Equips skin `id` for `userId`. Must already own it (or be the free "player" default). */
export async function equipSkin(tx: TxClient, userId: string, id: string): Promise<EquipSkinOutcome> {
  const skin = getSkin(id);
  if (!skin) return { ok: false, reason: "NOT_FOUND" };
  if (!(await ownsSkin(tx, userId, id))) return { ok: false, reason: "NOT_OWNED", skin };

  await tx.equippedSkin.upsert({
    where: { userId },
    create: { userId, skinId: id },
    update: { skinId: id }
  });

  return { ok: true, skinId: id };
}

export async function getEquippedSkin(tx: TxClient, userId: string): Promise<string> {
  const row = await tx.equippedSkin.findUnique({ where: { userId } });
  return row?.skinId ?? "player";
}
