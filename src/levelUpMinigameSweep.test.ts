import { describe, expect, it } from "vitest";
import { sweepPosition } from "./levelUpMinigameSweep";

/**
 * Pins this client-side visual copy to the exact same values as
 * server/test/levelMinigame.test.ts asserts for the server's copy - the
 * whole point of duplicating the formula is that the two never drift apart.
 */
describe("sweepPosition (client visual mirror)", () => {
  it("starts at the left end", () => {
    expect(sweepPosition(0, 1000)).toBeCloseTo(-1);
  });

  it("reaches dead centre at a quarter period", () => {
    expect(sweepPosition(250, 1000)).toBeCloseTo(0);
  });

  it("reaches the right end at half period", () => {
    expect(sweepPosition(500, 1000)).toBeCloseTo(1);
  });

  it("returns to centre at three-quarters period", () => {
    expect(sweepPosition(750, 1000)).toBeCloseTo(0);
  });

  it("wraps back to the left end at a full period", () => {
    expect(sweepPosition(1000, 1000)).toBeCloseTo(-1);
  });

  it("wraps correctly for elapsed times well past one period", () => {
    expect(sweepPosition(4250, 1000)).toBeCloseTo(0);
  });

  it("is total for a non-positive period", () => {
    expect(sweepPosition(500, 0)).toBe(-1);
    expect(sweepPosition(500, -100)).toBe(-1);
  });
});
