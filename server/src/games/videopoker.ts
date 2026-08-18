/**
 * Server-authoritative port of VideoPokerScene.ts (#36) - standard "9/6
 * Jacks or Better" paytable, real published numbers (see that file's
 * comments for the full rationale). Not open-ended like Mines/Dragon
 * Tower/Hi-Lo, but still needs 2 steps (deal, then draw) since the dealt
 * hand and remaining deck can't be trusted to a client round-trip between
 * them - client-integration's callout up front about Blackjack needing a
 * fuller sequence applies here too, just a fixed 2 steps instead of an
 * open-ended one.
 *
 * Cards are stored as rank only (2-14, Ace high) - suit is cosmetic and
 * left to the client, same reasoning as games/hilo.ts (keeps Unicode suit
 * glyphs out of JSONB round state entirely).
 */

import { randInt } from "../rng";

interface PaytableEntry {
  rank: string;
  mult: number;
  test: (h: HandInfo) => boolean;
}

export const VIDEO_POKER_PAYTABLE: PaytableEntry[] = [
  { rank: "Royal Flush", mult: 250, test: (h) => h.isFlush && h.isStraight && h.highCard === 14 && !h.isWheel },
  { rank: "Straight Flush", mult: 50, test: (h) => h.isFlush && h.isStraight },
  { rank: "Four of a Kind", mult: 25, test: (h) => h.counts[0] === 4 },
  { rank: "Full House", mult: 9, test: (h) => h.counts[0] === 3 && h.counts[1] === 2 },
  { rank: "Flush", mult: 6, test: (h) => h.isFlush },
  { rank: "Straight", mult: 4, test: (h) => h.isStraight },
  { rank: "Three of a Kind", mult: 3, test: (h) => h.counts[0] === 3 },
  { rank: "Two Pair", mult: 2, test: (h) => h.counts[0] === 2 && h.counts[1] === 2 },
  { rank: "Jacks or Better", mult: 1, test: (h) => h.counts[0] === 2 && h.pairValue >= 11 },
  { rank: "Nothing", mult: 0, test: () => true }
];

interface HandInfo {
  isFlush: boolean;
  isStraight: boolean;
  isWheel: boolean;
  highCard: number;
  counts: number[];
  pairValue: number;
}

interface Card {
  value: number; // 2-14, Ace high
  suit: number; // 0-3, needed here (unlike Hi-Lo/Blackjack) since Flush/Straight-Flush detection depends on suit
}

function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (let value = 2; value <= 14; value++) {
    for (let suit = 0; suit < 4; suit++) deck.push({ value, suit });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function evaluateHand(cards: Card[]): PaytableEntry {
  const values = cards.map((c) => c.value).sort((a, b) => a - b);
  const isFlush = cards.every((c) => c.suit === cards[0].suit);

  const isWheel = values.join(",") === "2,3,4,5,14";
  let isStraight: boolean;
  let highCard = values[4];
  if (isWheel) {
    isStraight = true;
    highCard = 5;
  } else {
    isStraight = values.every((v, i) => i === 0 || v === values[i - 1] + 1);
  }

  const countMap = new Map<number, number>();
  for (const v of values) countMap.set(v, (countMap.get(v) ?? 0) + 1);
  const entries = Array.from(countMap.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);
  const counts = entries.map((e) => e.count);
  const pairValue = entries.length > 0 ? entries[0].value : 0;

  const info: HandInfo = { isFlush, isStraight, isWheel, highCard, counts, pairValue };
  for (const entry of VIDEO_POKER_PAYTABLE) {
    if (entry.test(info)) return entry;
  }
  return VIDEO_POKER_PAYTABLE[VIDEO_POKER_PAYTABLE.length - 1];
}

export type VideoPokerStage = "holding" | "resolved";

export interface VideoPokerRoundState {
  deck: Card[]; // remaining undealt cards
  hand: Card[]; // current 5-card hand
  stage: VideoPokerStage;
}

export function newVideoPokerState(): VideoPokerRoundState {
  const deck = buildDeck();
  const hand = deck.splice(0, 5);
  return { deck, hand, stage: "holding" };
}

/** Client-safe hand view - just ranks, since suit only matters for server-side scoring (see evaluateHand). */
export function publicHand(state: VideoPokerRoundState): number[] {
  return state.hand.map((c) => c.value);
}

export class InvalidHoldsError extends Error {}

export interface VideoPokerDrawResult {
  state: VideoPokerRoundState;
  rank: string;
  multiplier: number;
  payout: number;
}

export function applyVideoPokerDraw(state: VideoPokerRoundState, holds: boolean[], betAmount: number): VideoPokerDrawResult {
  if (holds.length !== 5) {
    throw new InvalidHoldsError("holds must have exactly 5 entries");
  }

  const deck = [...state.deck];
  const hand = state.hand.map((card, i) => {
    if (holds[i]) return card;
    const next = deck.shift();
    if (!next) throw new InvalidHoldsError("Deck exhausted - should be unreachable (only ever draws up to 5 cards)");
    return next;
  });

  const result = evaluateHand(hand);
  const payout = Math.round(betAmount * result.mult);

  return { state: { deck, hand, stage: "resolved" }, rank: result.rank, multiplier: result.mult, payout };
}
