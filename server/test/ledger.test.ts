import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { applyTransaction, getBalance, InsufficientBalanceError } from "../src/economy/ledger";
import { resetDb } from "./helpers";

async function makeUser(gc = 0, sc = 0) {
  const user = await prisma.user.create({
    data: {
      username: `ledger_user_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      passwordHash: "x",
      balance: { create: { goldCoins: gc, stakeCoins: sc } }
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

  it("keeps GC and SC as fully separate ledgers", async () => {
    const userId = await makeUser(1000, 0);
    await expect(prisma.$transaction((t) => applyTransaction(t, userId, "SC", "WAGER_SC", -1))).rejects.toThrow(
      InsufficientBalanceError
    );
    expect(await prisma.$transaction((t) => getBalance(t, userId, "GC"))).toBe(1000);
  });

  it("rejects a crediting ADJUST_SC outright - SC may only be minted via SIGNUP_BONUS_SC/PACKAGE_BONUS_SC", async () => {
    const userId = await makeUser(0, 100);
    await expect(prisma.$transaction((t) => applyTransaction(t, userId, "SC", "ADJUST_SC", 50))).rejects.toThrow(
      /ADJUST_SC cannot credit SC/
    );
    // Balance untouched.
    expect(await prisma.$transaction((t) => getBalance(t, userId, "SC"))).toBe(100);
  });

  it("allows a debiting ADJUST_SC (legacy bridge, debit-only)", async () => {
    const userId = await makeUser(0, 100);
    const tx = await prisma.$transaction((t) => applyTransaction(t, userId, "SC", "ADJUST_SC", -30));
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
