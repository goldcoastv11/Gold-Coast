/**
 * Server-authoritative port of HiLoScene.ts (#36) - same "reveal
 * repeatedly, cash out anytime" shape as Mines/Dragon Tower, a shrinking
 * 52-card deck instead of a fixed grid.
 *
 * Only a card's rank *value* (2-14, Ace high) matters for higher/lower
 * comparisons - suit is purely cosmetic and, like Baccarat, is left for
 * the client to pick randomly for display (see BaccaratScene.ts's
 * displayCard()). Two reasons beyond consistency with Baccarat: (1) it
 * keeps round state simpler (a deck is just 52 numbers, each value 2-14
 * appearing exactly 4 times), and (2) round state is stored as Postgres
 * JSONB - the dev/test embedded-postgres cluster's database encoding
 * defaults to WIN1252 (Windows-1252), which can't represent the Unicode
 * suit glyphs (♠♥♦♣) at all and throws a hard encoding error the moment
 * they're written; discovered exactly that way while writing this file's
 * tests. Keeping suits out of anything that touches the DB sidesteps it
 * entirely rather than special-casing storage encoding.
 */

import { randInt } from "../rng";

const HOUSE_EDGE = 0.02; // 2%, same edge as Mines
const MAX_MULTIPLIER = 100000;

function buildDeck(): number[] {
  const deck: number[] = [];
  for (let value = 2; value <= 14; value++) {
    for (let suit = 0; suit < 4; suit++) deck.push(value);
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export interface HiLoRoundState {
  deck: number[]; // remaining undrawn card values
  currentCard: number;
  cumulativeFair: number; // running product of fair (1/P) factors, house edge applied only at display/payout time
  correctGuesses: number;
}

export function newHiLoState(): HiLoRoundState {
  const deck = buildDeck();
  const currentCard = deck.pop()!;
  return { deck, currentCard, cumulativeFair: 1, correctGuesses: 0 };
}

function countOutcomes(current: number, deck: number[]): { higher: number; lower: number; total: number } {
  let higher = 0;
  let lower = 0;
  for (const v of deck) {
    if (v > current) higher++;
    else if (v < current) lower++;
  }
  return { higher, lower, total: deck.length };
}

export interface HiLoPublicState {
  currentCard: number;
  deckRemaining: number;
  correctGuesses: number;
  multiplier: number;
  higherCount: number;
  lowerCount: number;
}

function currentMultiplier(state: HiLoRoundState): number {
  return Math.min(MAX_MULTIPLIER, Math.round(state.cumulativeFair * (1 - HOUSE_EDGE) * 100) / 100);
}

export function publicHiLoState(state: HiLoRoundState): HiLoPublicState {
  const { higher, lower } = countOutcomes(state.currentCard, state.deck);
  return {
    currentCard: state.currentCard,
    deckRemaining: state.deck.length,
    correctGuesses: state.correctGuesses,
    multiplier: currentMultiplier(state),
    higherCount: higher,
    lowerCount: lower
  };
}

export type HiLoGuess = "higher" | "lower";

export class InvalidHiLoGuessError extends Error {}

export interface HiLoGuessResult {
  state: HiLoRoundState;
  won: boolean;
  nextCard: number;
  deckExhausted: boolean;
}

export function applyHiLoGuess(state: HiLoRoundState, guess: HiLoGuess): HiLoGuessResult {
  const { higher, lower, total } = countOutcomes(state.currentCard, state.deck);
  const favorable = guess === "higher" ? higher : lower;
  if (favorable <= 0 || total <= 0) {
    throw new InvalidHiLoGuessError("No cards remain that could win this guess");
  }

  const p = favorable / total;
  const fairFactor = 1 / p;

  const deck = [...state.deck];
  const nextCard = deck.pop()!;
  const won = guess === "higher" ? nextCard > state.currentCard : nextCard < state.currentCard;

  if (!won) {
    return { state: { ...state, deck, currentCard: nextCard }, won: false, nextCard, deckExhausted: false };
  }

  const newState: HiLoRoundState = {
    deck,
    currentCard: nextCard,
    cumulativeFair: state.cumulativeFair * fairFactor,
    correctGuesses: state.correctGuesses + 1
  };
  return { state: newState, won: true, nextCard, deckExhausted: deck.length === 0 };
}
