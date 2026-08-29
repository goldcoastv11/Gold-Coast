import { beforeEach, describe, expect, it } from "vitest";
import { BET_MAX, BET_MIN, gameState } from "./GameState";
import { DEFAULT_BODY_PIECE_ID } from "./wardrobeCatalog";

/**
 * Smoke tests for the current (pre-ledger) client-side GameState.
 *
 * NOTE for future maintainers: per CLAUDE.md, GC (spend to play) and
 * TICKETS (won from playing, spent in the Item Shop) are separate
 * ledgers, TICKETS must never be sold directly, wardrobe purchases must use
 * TICKETS only, and all balance changes must go through a transaction
 * ledger. This file currently exercises the placeholder POC state module
 * as-is (it predates the economy team's ledger work - see file header
 * comment in GameState.ts). When economy's ledger (#1) lands, these tests
 * should be revisited/moved to target the ledger module directly, and this
 * file should start asserting the ledger-backed invariants above rather
 * than just current behavior.
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
    it("creates a new profile with default starting balances - GC only, no starting TICKETS", () => {
      const result = gameState.login("alice", "hunter2");
      expect(result).toEqual({ ok: true, isNew: true });
      expect(gameState.goldCoins).toBe(1000);
      expect(gameState.tickets).toBe(0);
      // Every player starts owning and wearing the free default body - the
      // layered wardrobe's never-invisible-player guarantee (see
      // src/wardrobeCatalog.ts). Everything else is bought a piece at a
      // time with TICKETS, server-side.
      expect(gameState.ownedWardrobe).toEqual([DEFAULT_BODY_PIECE_ID]);
      expect(gameState.wornInSlot("BODY")).toBe(DEFAULT_BODY_PIECE_ID);
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

  /**
   * The old `purchaseSkin - TICKETS only` block lived here. It covered
   * GameState's LOCAL skin-purchase path, which no longer exists: the
   * layered wardrobe that replaced skins is server-authoritative end to
   * end, so buying a piece is an HTTP call (POST /wardrobe/buy) and its
   * TICKETS-only, ledger-backed, GC-never-touched behaviour is proved
   * against the real ledger in server/test/wardrobe.test.ts instead.
   * Re-adding a local debit path here would be re-adding a way to spend
   * TICKETS that the server never sees.
   */
  describe("wardrobe state", () => {
    beforeEach(() => {
      gameState.login("erin", "pw");
    });

    it("owns and wears the free default body before any server hydration", () => {
      expect(gameState.ownsWardrobePiece(DEFAULT_BODY_PIECE_ID)).toBe(true);
      expect(gameState.wornInSlot("BODY")).toBe(DEFAULT_BODY_PIECE_ID);
    });

    it("does not claim to own a piece that was never bought", () => {
      expect(gameState.ownsWardrobePiece("torso_suit")).toBe(false);
    });

    it("reports nothing worn in an empty optional slot", () => {
      expect(gameState.wornInSlot("HAT")).toBeNull();
    });
  });

  describe("claimBonus", () => {
    it("grants GC only, never TICKETS (economy rule: ad/bonus refills are GC-only)", () => {
      gameState.login("frank", "pw");
      const gcBefore = gameState.goldCoins;
      const ticketsBefore = gameState.tickets;
      const amount = gameState.claimBonus();
      expect(gameState.goldCoins).toBe(gcBefore + amount);
      expect(gameState.tickets).toBe(ticketsBefore);
    });
  });
});
