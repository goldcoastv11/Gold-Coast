import { beforeEach, describe, expect, it } from "vitest";
import { BET_MAX, BET_MIN, gameState } from "./GameState";

/**
 * Smoke tests for the current (pre-ledger) client-side GameState.
 *
 * NOTE for future maintainers: per CLAUDE.md, GC and SC are separate
 * ledgers, SC must never be sold directly, skin purchases must use GC only,
 * and all balance changes must go through a transaction ledger. This file
 * currently exercises the placeholder POC state module as-is (it predates
 * the economy team's ledger work - see file header comment in GameState.ts).
 * When economy's ledger (#1) lands, these tests should be revisited/moved
 * to target the ledger module directly, and this file should start
 * asserting the ledger-backed invariants above rather than just current
 * behavior.
 */
describe("GameState", () => {
  beforeEach(() => {
    localStorage.clear();
    gameState.logout();
  });

  describe("betAmount clamping", () => {
    it("clamps setBet within [BET_MIN, BET_MAX]", () => {
      gameState.setBet(BET_MAX + 1000);
      expect(gameState.betAmount).toBe(BET_MAX);

      gameState.setBet(BET_MIN - 1000);
      expect(gameState.betAmount).toBe(BET_MIN);
    });

    it("ignores non-finite input to setBet", () => {
      const before = gameState.betAmount;
      gameState.setBet(NaN);
      expect(gameState.betAmount).toBe(before);
      gameState.setBet(Infinity);
      expect(gameState.betAmount).toBe(before);
    });

    it("adjustBet clamps at the boundaries", () => {
      gameState.setBet(BET_MIN);
      gameState.adjustBet(-9999);
      expect(gameState.betAmount).toBe(BET_MIN);

      gameState.setBet(BET_MAX);
      gameState.adjustBet(9999);
      expect(gameState.betAmount).toBe(BET_MAX);
    });
  });

  describe("login/logout", () => {
    it("creates a new profile with default starting balances", () => {
      const result = gameState.login("alice", "hunter2");
      expect(result).toEqual({ ok: true, isNew: true });
      expect(gameState.goldCoins).toBe(1000);
      expect(gameState.stakeCoins).toBe(25);
      expect(gameState.unlockedSkins).toEqual(["player"]);
    });

    it("rejects an empty username or password", () => {
      expect(gameState.login("", "pw").ok).toBe(false);
      expect(gameState.login("bob", "").ok).toBe(false);
    });

    it("logs back into an existing profile and restores its balances", () => {
      gameState.login("carol", "pw1");
      gameState.goldCoins = 4242;
      gameState.logout();

      const result = gameState.login("carol", "pw1");
      expect(result).toEqual({ ok: true, isNew: false });
      expect(gameState.goldCoins).toBe(4242);
    });

    it("rejects a wrong password for an existing username", () => {
      gameState.login("dave", "correct");
      gameState.logout();

      const result = gameState.login("dave", "wrong");
      expect(result).toEqual({ ok: false, error: "Wrong password for that username" });
    });
  });

  describe("purchaseSkin", () => {
    beforeEach(() => {
      gameState.login("erin", "pw");
    });

    it("deducts GC and unlocks the skin on a successful purchase", () => {
      gameState.goldCoins = 1000;
      const ok = gameState.purchaseSkin("skin_001"); // price 250
      expect(ok).toBe(true);
      expect(gameState.goldCoins).toBe(750);
      expect(gameState.ownsSkin("skin_001")).toBe(true);
    });

    it("fails and leaves balance untouched when GC is insufficient", () => {
      gameState.goldCoins = 100;
      const ok = gameState.purchaseSkin("skin_002"); // price 1000
      expect(ok).toBe(false);
      expect(gameState.goldCoins).toBe(100);
      expect(gameState.ownsSkin("skin_002")).toBe(false);
    });

    it("fails on an unknown skin id", () => {
      gameState.goldCoins = 999999;
      expect(gameState.purchaseSkin("not_a_real_skin")).toBe(false);
    });

    it("fails to re-purchase an already-owned skin", () => {
      gameState.goldCoins = 1000;
      expect(gameState.purchaseSkin("skin_001")).toBe(true);
      const before = gameState.goldCoins;
      expect(gameState.purchaseSkin("skin_001")).toBe(false);
      expect(gameState.goldCoins).toBe(before);
    });
  });

  describe("claimBonus", () => {
    it("grants GC only, never SC (economy rule: ad/bonus refills are GC-only)", () => {
      gameState.login("frank", "pw");
      const gcBefore = gameState.goldCoins;
      const scBefore = gameState.stakeCoins;
      const amount = gameState.claimBonus();
      expect(gameState.goldCoins).toBe(gcBefore + amount);
      expect(gameState.stakeCoins).toBe(scBefore);
    });
  });
});
