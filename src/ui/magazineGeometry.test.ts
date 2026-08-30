import { describe, expect, it } from "vitest";
import { fitRoomScale, wrapIndex } from "./magazineGeometry";
import { ROOM_PIXEL_H, ROOM_PIXEL_W } from "../roomRenderer";

describe("fitRoomScale", () => {
  it("scales down to fit a box smaller than the room, preserving aspect ratio", () => {
    const { scale, w, h } = fitRoomScale(400, 300);
    expect(scale).toBeCloseTo(300 / ROOM_PIXEL_H, 5);
    expect(w).toBeLessThanOrEqual(400);
    expect(h).toBeCloseTo(300, 5);
  });

  it("is width-constrained when the box is relatively short and wide", () => {
    const { scale } = fitRoomScale(200, 1000);
    expect(scale).toBeCloseTo(200 / ROOM_PIXEL_W, 5);
  });

  it("never upscales past 1x even for a huge box", () => {
    const { scale, w, h } = fitRoomScale(5000, 5000);
    expect(scale).toBe(1);
    expect(w).toBe(ROOM_PIXEL_W);
    expect(h).toBe(ROOM_PIXEL_H);
  });
});

describe("wrapIndex", () => {
  it("passes through an in-range index unchanged", () => {
    expect(wrapIndex(2, 5)).toBe(2);
  });

  it("wraps Next past the last room back to the first", () => {
    expect(wrapIndex(5, 5)).toBe(0);
  });

  it("wraps Prev past the first room back to the last", () => {
    expect(wrapIndex(-1, 5)).toBe(4);
  });

  it("returns 0 for an empty list", () => {
    expect(wrapIndex(3, 0)).toBe(0);
  });
});
