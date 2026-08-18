/** Server-authoritative port of BaccaratScene.ts's drawing rules + paytable (#36) - see that file's comments for the full derivation/rationale (real published baccarat odds, standard third-card tableau). */

import { randInt } from "../rng";

export const PLAYER_WIN_MULT = 2.0;
export const BANKER_WIN_MULT = 1.95;
export const TIE_WIN_MULT = 9.0;
const PUSH_MULT = 1.0;

interface Card {
  rank: number; // 1-13 (A-K)
  value: number; // baccarat point value: A=1, 2-9 face, 10/J/Q/K=0
}

function drawCard(): Card {
  const rank = randInt(1, 13);
  return { rank, value: rank >= 10 ? 0 : rank };
}

function handTotal(cards: Card[]): number {
  return cards.reduce((sum, c) => sum + c.value, 0) % 10;
}

export type BaccaratOutcome = "player" | "banker" | "tie";
export type BaccaratBetType = "player" | "banker" | "tie";

export interface BaccaratRoundResult {
  playerCards: number[]; // ranks, for the client to render
  bankerCards: number[];
  playerTotal: number;
  bankerTotal: number;
  outcome: BaccaratOutcome;
}

/** Standard baccarat tableau (third-card drawing rules). */
function playRound(): BaccaratRoundResult {
  const playerCards = [drawCard(), drawCard()];
  const bankerCards = [drawCard(), drawCard()];
  let playerTotal = handTotal(playerCards);
  let bankerTotal = handTotal(bankerCards);

  if (playerTotal < 8 && bankerTotal < 8) {
    let playerThird: Card | null = null;
    if (playerTotal <= 5) {
      playerThird = drawCard();
      playerCards.push(playerThird);
      playerTotal = handTotal(playerCards);
    }

    let bankerDraws: boolean;
    if (playerThird === null) {
      bankerDraws = bankerTotal <= 5;
    } else if (bankerTotal <= 2) {
      bankerDraws = true;
    } else if (bankerTotal === 3) {
      bankerDraws = playerThird.value !== 8;
    } else if (bankerTotal === 4) {
      bankerDraws = playerThird.value >= 2 && playerThird.value <= 7;
    } else if (bankerTotal === 5) {
      bankerDraws = playerThird.value >= 4 && playerThird.value <= 7;
    } else if (bankerTotal === 6) {
      bankerDraws = playerThird.value === 6 || playerThird.value === 7;
    } else {
      bankerDraws = false; // bankerTotal === 7
    }

    if (bankerDraws) {
      bankerCards.push(drawCard());
      bankerTotal = handTotal(bankerCards);
    }
  }

  const outcome: BaccaratOutcome = playerTotal > bankerTotal ? "player" : bankerTotal > playerTotal ? "banker" : "tie";
  return {
    playerCards: playerCards.map((c) => c.rank),
    bankerCards: bankerCards.map((c) => c.rank),
    playerTotal,
    bankerTotal,
    outcome
  };
}

export interface BaccaratResult extends BaccaratRoundResult {
  betType: BaccaratBetType;
  multiplier: number;
  payout: number;
}

export function playBaccarat(betAmount: number, betType: BaccaratBetType): BaccaratResult {
  const round = playRound();

  let multiplier = 0;
  if (betType === "player") {
    if (round.outcome === "player") multiplier = PLAYER_WIN_MULT;
    else if (round.outcome === "tie") multiplier = PUSH_MULT;
  } else if (betType === "banker") {
    if (round.outcome === "banker") multiplier = BANKER_WIN_MULT;
    else if (round.outcome === "tie") multiplier = PUSH_MULT;
  } else {
    if (round.outcome === "tie") multiplier = TIE_WIN_MULT;
  }

  const payout = Math.round(betAmount * multiplier);
  return { ...round, betType, multiplier, payout };
}
