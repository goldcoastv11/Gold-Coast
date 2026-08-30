import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { applyTransaction, getBalance, InsufficientBalanceError } from "../src/economy/ledger";
import { resetDb } from "./helpers";

async function makeUser(gc = 0, tickets = 0) {
  const user = await prisma.user.create({
    data: {
      username: `ledger_user_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      passwordHash: "x",
      balance: { create: { goldCoins: gc, tickets } }
    }
  });
  return user.id;
}

beforeEach(resetDb);

describe("applyTransaction (core ledger)", () => {
  it("credits a balance and records a transaction row with the correct balanceAfter", async () => {
    const userId = await makeUser(100, 0);

    const tx = await prisma.$transaction((t) => applyTransaction(t, userId, "GC", "PACKAGE_GC", 500, { note: "test" }));

    expect(tx.amount).toBe(500);
    expect(tx.balanceAfter).toBe(600);
    expect(await prisma.$transaction((t) => getBalance(t, userId, "GC"))).toBe(600);

    const row = await prisma.transaction.findUnique({ where: { id: tx.id } });
    expect(row).not.toBeNull();
    expect(row!.balanceAfter).toBe(600);
    expect(row!.meta).toEqual({ note: "test" });
  });

  it("debits a balance", async () => {
    const userId = await makeUser(100, 0);
    const tx = await prisma.$transaction((t) => applyTransaction(t, userId, "GC", "WAGER_GC", -40));
    expect(tx.balanceAfter).toBe(60);
  });

  it("throws InsufficientBalanceError rather than allowing a negative balance, and writes nothing", async () => {
    const userId = await makeUser(10, 0);

    await expect(prisma.$transaction((t) => applyTransaction(t, userId, "GC", "WAGER_GC", -50))).rejects.toThrow(
      InsufficientBalanceError
    );

    expect(await prisma.$transaction((t) => getBalance(t, userId, "GC"))).toBe(10);
    const txs = await prisma.transaction.findMany({ where: { userId } });
    expect(txs).toHaveLength(0);
  });

  it("keeps GC and TICKETS as fully separate ledgers", async () => {
    const userId = await makeUser(1000, 0);
    // TICKETS_RETIRED is the one legal TICKETS transaction left (see the
    // retirement tests below) - debiting 1 from a 0 balance still hits the
    // ordinary InsufficientBalanceError path, same as any other currency.
    await expect(
      prisma.$transaction((t) => applyTransaction(t, userId, "TICKETS", "TICKETS_RETIRED", -1))
    ).rejects.toThrow(InsufficientBalanceError);
    expect(await prisma.$transaction((t) => getBalance(t, userId, "GC"))).toBe(1000);
  });

  // ---------------------------------------------------------------------
  // TICKETS is retired (2026-08-29 GC-only economy restructure). These
  // replace the old "TICKETS has exactly one sanctioned credit path" tests -
  // now nothing may touch TICKETS at all, except the one-time balance
  // zero-out.
  // ---------------------------------------------------------------------

  it("rejects crediting TICKETS via GAME_WIN_TICKETS - that path is retired too, not just every other type", async () => {
    const userId = await makeUser(0, 100);
    await expect(
      prisma.$transaction((t) => applyTransaction(t, userId, "TICKETS", "GAME_WIN_TICKETS", 50))
    ).rejects.toThrow(/TICKETS is retired/);
    expect(await prisma.$transaction((t) => getBalance(t, userId, "TICKETS"))).toBe(100);
  });

  it("rejects debiting TICKETS via SKIN_PURCHASE_TICKETS - the old purchase path is retired too", async () => {
    const userId = await makeUser(0, 100);
    await expect(
      prisma.$transaction((t) => applyTransaction(t, userId, "TICKETS", "SKIN_PURCHASE_TICKETS", -30))
    ).rejects.toThrow(/TICKETS is retired/);
    expect(await prisma.$transaction((t) => getBalance(t, userId, "TICKETS"))).toBe(100);
  });

  it("allows the one-time TICKETS_RETIRED debit to zero a balance", async () => {
    const userId = await makeUser(0, 250);
    const tx = await prisma.$transaction((t) => applyTransaction(t, userId, "TICKETS", "TICKETS_RETIRED", -250));
    expect(tx.balanceAfter).toBe(0);
  });

  it("rejects a positive (crediting) TICKETS_RETIRED amount - it may only ever zero out, never credit", async () => {
    const userId = await makeUser(0, 100);
    await expect(
      prisma.$transaction((t) => applyTransaction(t, userId, "TICKETS", "TICKETS_RETIRED", 50))
    ).rejects.toThrow(/TICKETS_RETIRED may only debit/);
    expect(await prisma.$transaction((t) => getBalance(t, userId, "TICKETS"))).toBe(100);
  });

  it("rejects a zero amount", async () => {
    const userId = await makeUser(100, 0);
    await expect(prisma.$transaction((t) => applyTransaction(t, userId, "GC", "ADJUST_GC", 0))).rejects.toThrow();
  });

  it("two concurrent debits against the same balance never both succeed past the real balance (no lost-update race)", async () => {
    const userId = await makeUser(100, 0);

    const results = await Promise.allSettled([
      prisma.$transaction((t) => applyTransaction(t, userId, "GC", "WAGER_GC", -70)),
      prisma.$transaction((t) => applyTransaction(t, userId, "GC", "WAGER_GC", -70))
    ]);

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const finalBalance = await prisma.$transaction((t) => getBalance(t, userId, "GC"));
    expect(finalBalance).toBe(30);
  });
});
