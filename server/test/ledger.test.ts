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
    await expect(
      prisma.$transaction((t) => applyTransaction(t, userId, "TICKETS", "SKIN_PURCHASE_TICKETS", -1))
    ).rejects.toThrow(InsufficientBalanceError);
    expect(await prisma.$transaction((t) => getBalance(t, userId, "GC"))).toBe(1000);
  });

  it("rejects crediting TICKETS via anything other than GAME_WIN_TICKETS", async () => {
    const userId = await makeUser(0, 100);
    await expect(
      prisma.$transaction((t) => applyTransaction(t, userId, "TICKETS", "ADJUST_GC" as never, 50))
    ).rejects.toThrow(/TICKETS may only be credited via GAME_WIN_TICKETS/);
    // Balance untouched.
    expect(await prisma.$transaction((t) => getBalance(t, userId, "TICKETS"))).toBe(100);
  });

  it("allows crediting TICKETS via GAME_WIN_TICKETS - the one sanctioned path", async () => {
    const userId = await makeUser(0, 0);
    const tx = await prisma.$transaction((t) => applyTransaction(t, userId, "TICKETS", "GAME_WIN_TICKETS", 250));
    expect(tx.balanceAfter).toBe(250);
  });

  it("allows debiting TICKETS via SKIN_PURCHASE_TICKETS", async () => {
    const userId = await makeUser(0, 100);
    const tx = await prisma.$transaction((t) => applyTransaction(t, userId, "TICKETS", "SKIN_PURCHASE_TICKETS", -30));
    expect(tx.balanceAfter).toBe(70);
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
