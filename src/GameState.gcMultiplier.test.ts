import { beforeEach, describe, expect, it } from "vitest";
import { gameState } from "./GameState";
import { GC_MULTIPLIER_BASE } from "./economy/gcMultiplier";

/**
 * GameState-level integration tests for #27 (resolved GC multiplier on the
 * signup bonus and attendant claim). Pure-function behavior is already
 * covered by economy/attendantClaim.test.ts and economy.test.ts's signup
 * bonus tests - this file is specifically about GameState wiring the
 * multiplier through correctly and defaulting safely when a caller (e.g.
 * an existing scene call site) doesn't pass one.
 */
describe("GameState #27 GC multiplier passthrough", () => {
  beforeEach(() => {
    localStorage.clear();
    gameState.logout();
  });

  it("login() with no multiplier grants the pre-#27 default of 1000 GC", () => {
    const result = gameState.login("liam", "pw");
    expect(result).toEqual({ ok: true, isNew: true });
    expect(gameState.goldCoins).toBe(GC_MULTIPLIER_BASE);
    expect(gameState.stakeCoins).toBe(25); // SC leg unaffected
  });

  it("login() with an explicit multiplier scales the signup GC grant", () => {
    gameState.login("mia", "pw", 2);
    expect(gameState.goldCoins).toBe(GC_MULTIPLIER_BASE * 2);
    expect(gameState.stakeCoins).toBe(25); // SC leg still flat
  });

  it("the multiplier is ignored on re-login (no repeat signup grant)", () => {
    gameState.login("noah", "pw", 2);
    const gcAfterSignup = gameState.goldCoins;
    gameState.logout();

    const result = gameState.login("noah", "pw", 0.5); // different multiplier, should have zero effect
    expect(result).toEqual({ ok: true, isNew: false });
    expect(gameState.goldCoins).toBe(gcAfterSignup);
  });

  it("claimAttendantBonus() with no multiplier defaults to 1x (1000 GC), unchanged from #18/#19", () => {
    gameState.login("olivia", "pw");
    const gcBefore = gameState.goldCoins;
    const outcome = gameState.claimAttendantBonus();
    expect(outcome.ok).toBe(true);
    expect(gameState.goldCoins).toBe(gcBefore + GC_MULTIPLIER_BASE);
  });

  it("claimAttendantBonus() with an explicit multiplier scales the GC grant, SC bonus stays flat", () => {
    gameState.login("peter", "pw");
    const gcBefore = gameState.goldCoins;
    const scBefore = gameState.stakeCoins;
    const outcome = gameState.claimAttendantBonus(0.5);
    expect(outcome.ok).toBe(true);
    expect(gameState.goldCoins).toBe(gcBefore + GC_MULTIPLIER_BASE * 0.5);
    expect(gameState.stakeCoins).toBe(scBefore + 1); // flat SC bonus, unaffected by multiplier
  });
});
