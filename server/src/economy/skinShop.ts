/**
 * Skin shop backend - server-authoritative port of
 * casino-poc/src/economy/skinShop.ts.
 *
 * Economy rule: skins are purchased with GC only, never SC, and skin
 * purchase logic is kept fully separate from SC/redemption/playthrough
 * logic - this module never imports from playthrough.ts or redemption.ts,
 * and never touches the SC column of `balances`.
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
  | { ok: false; reason: "INSUFFICIENT_GC"; skin: SkinDef; balanceGc: number };

/**
 * Attempts to buy skin `id` with GC for `userId`. On success, debits the
 * ledger (SKIN_PURCHASE_GC transaction) and inserts a skins_owned row.
 */
export async function purchaseSkin(tx: TxClient, userId: string, id: string): Promise<PurchaseSkinOutcome> {
  const skin = getSkin(id);
  if (!skin) return { ok: false, reason: "NOT_FOUND" };
  if (await ownsSkin(tx, userId, id)) return { ok: false, reason: "ALREADY_OWNED", skin };

  const balanceGc = await getBalance(tx, userId, "GC");
  if (balanceGc < skin.price) {
    return { ok: false, reason: "INSUFFICIENT_GC", skin, balanceGc };
  }

  const transaction = await applyTransaction(tx, userId, "GC", "SKIN_PURCHASE_GC", -skin.price, {
    skinId: skin.id
  });
  await tx.skinOwned.create({ data: { userId, skinId: id } });

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
