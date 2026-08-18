/**
 * Server-authoritative port of BlackjackScene.ts (#36) - the one game that
 * needs the fuller start/hit/stand sequence (flagged up front by
 * client-integration): the dealer's hole card must stay genuinely hidden
 * server-side until the player stands (or busts), which a single
 * bet+resolve endpoint can't do.
 *
 * Cards are stored as rank only (1=A, 2-10 face, 11=J, 12=Q, 13=K) - suit
 * doesn't affect blackjack scoring at all, so (same reasoning as
 * games/hilo.ts) it's left for the client to pick randomly for display,
 * both for simplicity and to avoid ever putting a non-ASCII suit glyph in
 * the JSONB round state (see hilo.ts's comment for why that's a real
 * problem, not a hypothetical one, on this stack).
 */

import { randInt } from "../rng";

function cardValue(rank: number): number {
  if (rank === 1) return 11; // Ace, softened below if it busts the hand
  if (rank >= 11) return 10; // J/Q/K
  return rank;
}

export function handValue(hand: number[]): number {
  let total = hand.reduce((sum, r) => sum + cardValue(r), 0);
  let aces = hand.filter((r) => r === 1).length;
  while (total > 21 && aces > 0) {
    total -= 10; // count an Ace as 1 instead of 11
    aces--;
  }
  return total;
}

function buildDeck(): number[] {
  const deck: number[] = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 1; rank <= 13; rank++) deck.push(rank);
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export type BlackjackStatus = "playing" | "resolved";
export type BlackjackOutcome = "win" | "push" | "lose";

export interface BlackjackRoundState {
  deck: number[];
  playerHand: number[];
  dealerHand: number[];
  status: BlackjackStatus;
}

/** Draws one card, reshuffling a fresh deck in the vanishingly-unlikely event the shoe runs out mid-hand (mirrors the client's own defensive fallback). */
function drawCard(state: BlackjackRoundState): number {
  let card = state.deck.pop();
  if (card === undefined) {
    state.deck = buildDeck();
    card = state.deck.pop()!;
  }
  return card;
}

export function newBlackjackState(): BlackjackRoundState {
  const state: BlackjackRoundState = { deck: buildDeck(), playerHand: [], dealerHand: [], status: "playing" };
  state.playerHand = [drawCard(state), drawCard(state)];
  state.dealerHand = [drawCard(state), drawCard(state)];
  return state;
}

export interface BlackjackPublicState {
  playerHand: number[];
  playerTotal: number;
  dealerUpCard: number; // dealer's first card only - the hole card stays server-side while status is "playing"
  dealerHand: number[] | null; // full hand, only once status is "resolved"
  dealerTotal: number | null;
  status: BlackjackStatus;
  outcome: BlackjackOutcome | null;
}

export function publicBlackjackState(state: BlackjackRoundState, outcome: BlackjackOutcome | null = null): BlackjackPublicState {
  const resolved = state.status === "resolved";
  return {
    playerHand: state.playerHand,
    playerTotal: handValue(state.playerHand),
    dealerUpCard: state.dealerHand[0],
    dealerHand: resolved ? state.dealerHand : null,
    dealerTotal: resolved ? handValue(state.dealerHand) : null,
    status: state.status,
    outcome
  };
}

/** True if the player's opening 2 cards total 21 (a natural blackjack) - checked right after dealing, before any hit is possible. */
export function isNaturalBlackjack(state: BlackjackRoundState): boolean {
  return state.playerHand.length === 2 && handValue(state.playerHand) === 21;
}

export interface BlackjackHitResult {
  state: BlackjackRoundState;
  busted: boolean;
}

export function applyBlackjackHit(state: BlackjackRoundState): BlackjackHitResult {
  const playerHand = [...state.playerHand, drawCard(state)];
  const busted = handValue(playerHand) > 21;
  return { state: { ...state, playerHand, status: busted ? "resolved" : "playing" }, busted };
}

export interface BlackjackStandResult {
  state: BlackjackRoundState;
  outcome: BlackjackOutcome;
}

/** Runs the dealer's fixed strategy (hit until >=17), then resolves win/push/lose. Also used to resolve a natural blackjack (dealer still plays out their hand per standard rules - a natural only auto-*stands* the player, it doesn't skip the dealer's turn). */
export function applyBlackjackStand(state: BlackjackRoundState): BlackjackStandResult {
  const dealerHand = [...state.dealerHand];
  const deck = [...state.deck];
  const workingState = { ...state, deck, dealerHand };
  while (handValue(workingState.dealerHand) < 17) {
    workingState.dealerHand.push(drawCard(workingState));
  }

  const playerTotal = handValue(workingState.playerHand);
  const dealerTotal = handValue(workingState.dealerHand);

  let outcome: BlackjackOutcome;
  if (dealerTotal > 21 || playerTotal > dealerTotal) outcome = "win";
  else if (playerTotal === dealerTotal) outcome = "push";
  else outcome = "lose";

  return { state: { ...workingState, status: "resolved" }, outcome };
}

/** Total return per unit bet for a given outcome - win pays 1:1 (2x), push returns the stake (1x), lose pays nothing. */
export function blackjackPayoutMultiplier(outcome: BlackjackOutcome): number {
  if (outcome === "win") return 2;
  if (outcome === "push") return 1;
  return 0;
}
