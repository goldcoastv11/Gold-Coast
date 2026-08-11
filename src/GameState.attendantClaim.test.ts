import { beforeEach, describe, expect, it } from "vitest";
import { gameState } from "./GameState";
import { ATTENDANT_CLAIM_COOLDOWN_MS, ATTENDANT_CLAIM_PACKAGE } from "./economy/attendantClaim";

/**
 * Integration tests for #18/#19: GameState.claimAttendantBonus() and its
 * persisted cooldown. Separate file from GameState.test.ts (qa's) and
 * economy/attendantClaim.test.ts (pure-function unit tests) on purpose -
 * this one is specifically about the GameState <-> localStorage wiring
 * (does the cooldown actually survive a reload, does SC show up on the
 * real ledger-backed getters).
 */
describe("GameState.claimAttendantBonus (#18/#19)", () => {
  beforeEach(() => {
    localStorage.clear();
    gameState.logout();
  });

  it("grants GC and SC together, unlike claimBonus() which is GC-only", () => {
    gameState.login("gina", "pw");
    const gcBefore = gameState.goldCoins;
    const scBefore = gameState.stakeCoins;

    const outcome = gameState.claimAttendantBonus();

    expect(outcome.ok).toBe(true);
    expect(gameState.goldCoins).toBe(gcBefore + ATTENDANT_CLAIM_PACKAGE.gcAmount);
    expect(gameState.stakeCoins).toBe(scBefore + ATTENDANT_CLAIM_PACKAGE.scBonus);
  });

  it("is available immediately for a brand-new profile", () => {
    gameState.login("harold", "pw");
    expect(gameState.attendantClaimCooldownRemainingMs).toBe(0);
  });

  it("enters cooldown right after a successful claim and blocks an immediate second claim", () => {
    gameState.login("ivy", "pw");
    gameState.claimAttendantBonus();

    expect(gameState.attendantClaimCooldownRemainingMs).toBeGreaterThan(0);
    expect(gameState.attendantClaimCooldownRemainingMs).toBeLessThanOrEqual(
      ATTENDANT_CLAIM_COOLDOWN_MS
    );

    const gcAfterFirst = gameState.goldCoins;
    const blocked = gameState.claimAttendantBonus();
    expect(blocked.ok).toBe(false);
    expect(gameState.goldCoins).toBe(gcAfterFirst); // second attempt granted nothing
  });

  it("persists the cooldown across a logout/login (simulating a page reload)", () => {
    gameState.login("jack", "pw");
    gameState.claimAttendantBonus();
    const remainingBeforeReload = gameState.attendantClaimCooldownRemainingMs;
    expect(remainingBeforeReload).toBeGreaterThan(0);

    gameState.logout();
    gameState.login("jack", "pw"); // re-login re-reads localStorage, like a fresh page load

    // Still on cooldown (reload cannot be used to bypass it), and roughly
    // the same remaining time (allow a little slack for real elapsed ms).
    expect(gameState.attendantClaimCooldownRemainingMs).toBeGreaterThan(0);
    expect(gameState.attendantClaimCooldownRemainingMs).toBeLessThanOrEqual(remainingBeforeReload);

    const gcBeforeBlockedClaim = gameState.goldCoins;
    const blocked = gameState.claimAttendantBonus();
    expect(blocked.ok).toBe(false);
    expect(gameState.goldCoins).toBe(gcBeforeBlockedClaim);
  });

  it("does not affect claimBonus()'s independent GC-only ad-reward path", () => {
    gameState.login("kim", "pw");
    gameState.claimAttendantBonus(); // now on cooldown
    const scBefore = gameState.stakeCoins;

    const adAmount = gameState.claimBonus(); // ad-reward path, unrelated cooldown/state
    expect(adAmount).toBeGreaterThan(0);
    expect(gameState.stakeCoins).toBe(scBefore); // ad reward never touches SC
  });
});
