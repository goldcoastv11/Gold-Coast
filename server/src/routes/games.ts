/**
 * #36: server-authoritative game routes. Single-shot games (bet resolved
 * in one request) each get one `POST /games/<name>/play` endpoint - see
 * games/shared.ts's settleSingleShotBet for the common wager->play->payout
 * shape they all share. Stateful games (Blackjack, Mines, Dragon Tower,
 * Hi-Lo, Video Poker - anything with hidden state that must survive
 * between player actions) get a small sequence of endpoints instead; see
 * games/roundStore.ts for how that state persists.
 *
 * Dice (single-shot) and Mines (stateful, reveal-repeatedly-cash-out-anytime)
 * are the two reference implementations - every other game follows one of
 * these two shapes.
 */

import { Router } from "express";
import { registerRoute } from "./registry";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { serializeMe } from "../serializers";
import { asyncHandler } from "../asyncHandler";
import { BetAmountSchema, settleSingleShotBet, placeWager, settlePayout } from "../games/shared";
import { applyTransaction } from "../economy/ledger";
import { DICE_TARGET_MIN, DICE_TARGET_MAX, playDice } from "../games/dice";
import { playCoinFlip } from "../games/coinflip";
import { playRoulette } from "../games/roulette";
import { LIMBO_TARGET_MIN, LIMBO_TARGET_MAX, playLimbo } from "../games/limbo";
import { playPlinko } from "../games/plinko";
import { playSlots } from "../games/slots";
import { KENO_MAX_PICKS, KENO_TOTAL_NUMBERS, playKeno } from "../games/keno";
import { playWheel } from "../games/wheel";
import { playBaccarat } from "../games/baccarat";
import { TRIPLE_CHANCE_MIN_AMOUNT, TRIPLE_CHANCE_MAX_AMOUNT, playTripleChance } from "../games/triplechance";
import {
  MINES_TOTAL_TILES,
  MinesRoundState,
  newMinesState,
  publicMinesState,
  applyMinesPick,
  minesMultiplier,
  InvalidMinesPickError
} from "../games/mines";
import {
  createRound,
  loadActiveRound,
  loadAnyActiveRound,
  updateRoundState,
  closeRound,
  RoundAlreadyActiveError,
  NoActiveRoundError
} from "../games/roundStore";
import {
  DRAGON_TOWER_TILES_PER_ROW,
  DRAGON_TOWER_MULTIPLIERS,
  DragonTowerRoundState,
  newDragonTowerState,
  publicDragonTowerState,
  applyDragonTowerPick,
  InvalidDragonTowerPickError
} from "../games/dragontower";
import {
  HiLoRoundState,
  HiLoGuess,
  newHiLoState,
  publicHiLoState,
  applyHiLoGuess,
  InvalidHiLoGuessError
} from "../games/hilo";
import {
  BlackjackRoundState,
  newBlackjackState,
  publicBlackjackState,
  isNaturalBlackjack,
  applyBlackjackHit,
  applyBlackjackStand,
  blackjackPayoutMultiplier
} from "../games/blackjack";
import {
  VideoPokerRoundState,
  newVideoPokerState,
  publicHand,
  applyVideoPokerDraw,
  InvalidHoldsError
} from "../games/videopoker";

const router = Router();

// ---------------------------------------------------------------------
// Dice (single-shot reference)
// ---------------------------------------------------------------------

const DicePlaySchema = z.object({
  betAmount: BetAmountSchema,
  target: z.number().int().min(DICE_TARGET_MIN).max(DICE_TARGET_MAX)
});

router.post(
  "/games/dice/play",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = DicePlaySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid dice play payload", code: "INVALID_INPUT" });
    }
    const { betAmount, target } = parsed.data;

    const result = playDice(betAmount, target);

    const me = await prisma.$transaction(async (tx) => {
      await settleSingleShotBet(tx, userId, "dice", betAmount, result.payout, {
        target,
        roll: result.roll
      });
      return serializeMe(tx, userId, username);
    });

    return res.json({ result, user: me });
  })
);

// ---------------------------------------------------------------------
// Mines (stateful reference: start / pick / cash-out)
// ---------------------------------------------------------------------

const MinesStartSchema = z.object({
  betAmount: BetAmountSchema
});

router.post(
  "/games/mines/start",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = MinesStartSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid mines start payload", code: "INVALID_INPUT" });
    }
    const { betAmount } = parsed.data;

    try {
      const [roundId, publicState, me] = await prisma.$transaction(async (tx) => {
        await placeWager(tx, userId, "mines", betAmount, {});
        const state = newMinesState();
        const id = await createRound(tx, userId, "mines", betAmount, "GC", state);
        const meResult = await serializeMe(tx, userId, username);
        return [id, publicMinesState(state), meResult] as const;
      });

      return res.json({ roundId, state: publicState, user: me });
    } catch (err) {
      if (err instanceof RoundAlreadyActiveError) {
        return res.status(409).json({ error: "A round is already active", code: "ROUND_ALREADY_ACTIVE" });
      }
      throw err;
    }
  })
);

const MinesPickSchema = z.object({
  roundId: z.string().min(1),
  tileIndex: z.number().int().min(0).max(MINES_TOTAL_TILES - 1)
});

router.post(
  "/games/mines/pick",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = MinesPickSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid mines pick payload", code: "INVALID_INPUT" });
    }
    const { roundId, tileIndex } = parsed.data;

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const round = await loadActiveRound<MinesRoundState>(tx, userId, "mines", roundId);
        const pick = applyMinesPick(round.state, tileIndex);

        if (pick.hitMine) {
          await closeRound(tx, roundId);
          const me = await serializeMe(tx, userId, username);
          return {
            hitMine: true,
            boardCleared: false,
            minePositions: round.state.minePositions,
            multiplier: 0,
            payout: 0,
            user: me
          };
        }

        await updateRoundState(tx, roundId, pick.state);
        const publicState = publicMinesState(pick.state);

        if (pick.boardCleared) {
          const payout = Math.round(round.betAmount * publicState.multiplier);
          await settlePayout(tx, userId, "mines", payout, { roundId, picksMade: publicState.picksMade });
          await closeRound(tx, roundId);
          const me = await serializeMe(tx, userId, username);
          return {
            hitMine: false,
            boardCleared: true,
            revealed: publicState.revealed,
            multiplier: publicState.multiplier,
            payout,
            user: me
          };
        }

        const me = await serializeMe(tx, userId, username);
        return {
          hitMine: false,
          boardCleared: false,
          revealed: publicState.revealed,
          multiplier: publicState.multiplier,
          user: me
        };
      });

      return res.json(outcome);
    } catch (err) {
      if (err instanceof NoActiveRoundError) {
        return res.status(404).json({ error: "No active mines round", code: "NO_ACTIVE_ROUND" });
      }
      if (err instanceof InvalidMinesPickError) {
        return res.status(400).json({ error: err.message, code: "INVALID_PICK" });
      }
      throw err;
    }
  })
);

const MinesCashOutSchema = z.object({ roundId: z.string().min(1) });

router.post(
  "/games/mines/cashout",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = MinesCashOutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid mines cashout payload", code: "INVALID_INPUT" });
    }
    const { roundId } = parsed.data;

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const round = await loadActiveRound<MinesRoundState>(tx, userId, "mines", roundId);
        const picksMade = round.state.revealed.length;

        if (picksMade < 1) {
          throw new InvalidMinesPickError("Cannot cash out before revealing at least one tile");
        }

        const multiplier = minesMultiplier(picksMade);
        const payout = Math.round(round.betAmount * multiplier);
        await settlePayout(tx, userId, "mines", payout, { roundId, picksMade });
        await closeRound(tx, roundId);

        const me = await serializeMe(tx, userId, username);
        return { multiplier, payout, minePositions: round.state.minePositions, user: me };
      });

      return res.json(outcome);
    } catch (err) {
      if (err instanceof NoActiveRoundError) {
        return res.status(404).json({ error: "No active mines round", code: "NO_ACTIVE_ROUND" });
      }
      if (err instanceof InvalidMinesPickError) {
        return res.status(400).json({ error: err.message, code: "INVALID_PICK" });
      }
      throw err;
    }
  })
);

// ---------------------------------------------------------------------
// CoinFlip (single-shot)
// ---------------------------------------------------------------------

const CoinFlipPlaySchema = z.object({
  betAmount: BetAmountSchema,
  guess: z.enum(["heads", "tails"])
});

router.post(
  "/games/coinflip/play",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = CoinFlipPlaySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid coinflip play payload", code: "INVALID_INPUT" });
    }
    const { betAmount, guess } = parsed.data;

    const result = playCoinFlip(betAmount, guess);

    const me = await prisma.$transaction(async (tx) => {
      await settleSingleShotBet(tx, userId, "coinflip", betAmount, result.payout, {
        guess,
        result: result.result
      });
      return serializeMe(tx, userId, username);
    });

    return res.json({ result, user: me });
  })
);

// ---------------------------------------------------------------------
// Roulette (single-shot)
// ---------------------------------------------------------------------

const RoulettePlaySchema = z.object({
  betAmount: BetAmountSchema,
  bet: z.enum(["red", "black", "green"])
});

router.post(
  "/games/roulette/play",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = RoulettePlaySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid roulette play payload", code: "INVALID_INPUT" });
    }
    const { betAmount, bet } = parsed.data;

    const result = playRoulette(betAmount, bet);

    const me = await prisma.$transaction(async (tx) => {
      await settleSingleShotBet(tx, userId, "roulette", betAmount, result.payout, {
        bet,
        number: result.number
      });
      return serializeMe(tx, userId, username);
    });

    return res.json({ result, user: me });
  })
);

// ---------------------------------------------------------------------
// Limbo (single-shot)
// ---------------------------------------------------------------------

const LimboPlaySchema = z.object({
  betAmount: BetAmountSchema,
  target: z.number().min(LIMBO_TARGET_MIN).max(LIMBO_TARGET_MAX)
});

router.post(
  "/games/limbo/play",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = LimboPlaySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid limbo play payload", code: "INVALID_INPUT" });
    }
    const { betAmount, target } = parsed.data;

    const result = playLimbo(betAmount, target);

    const me = await prisma.$transaction(async (tx) => {
      await settleSingleShotBet(tx, userId, "limbo", betAmount, result.payout, {
        target,
        crashPoint: result.crashPoint
      });
      return serializeMe(tx, userId, username);
    });

    return res.json({ result, user: me });
  })
);

// ---------------------------------------------------------------------
// Plinko (single-shot)
// ---------------------------------------------------------------------

const PlinkoPlaySchema = z.object({
  betAmount: BetAmountSchema
});

router.post(
  "/games/plinko/play",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = PlinkoPlaySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid plinko play payload", code: "INVALID_INPUT" });
    }
    const { betAmount } = parsed.data;

    const result = playPlinko(betAmount);

    const me = await prisma.$transaction(async (tx) => {
      await settleSingleShotBet(tx, userId, "plinko", betAmount, result.payout, {
        slotIndex: result.slotIndex
      });
      return serializeMe(tx, userId, username);
    });

    return res.json({ result, user: me });
  })
);

// ---------------------------------------------------------------------
// Slots (single-shot)
// ---------------------------------------------------------------------

const SlotsPlaySchema = z.object({
  betAmount: BetAmountSchema
});

router.post(
  "/games/slots/play",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = SlotsPlaySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid slots play payload", code: "INVALID_INPUT" });
    }
    const { betAmount } = parsed.data;

    const result = playSlots(betAmount);

    const me = await prisma.$transaction(async (tx) => {
      await settleSingleShotBet(tx, userId, "slots", betAmount, result.payout, {
        reels: result.reels
      });
      return serializeMe(tx, userId, username);
    });

    return res.json({ result, user: me });
  })
);

// ---------------------------------------------------------------------
// Keno (single-shot)
// ---------------------------------------------------------------------

const KenoPlaySchema = z.object({
  betAmount: BetAmountSchema,
  picks: z
    .array(z.number().int().min(0).max(KENO_TOTAL_NUMBERS - 1))
    .min(1)
    .max(KENO_MAX_PICKS)
    .refine((arr) => new Set(arr).size === arr.length, "picks must be distinct")
});

router.post(
  "/games/keno/play",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = KenoPlaySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid keno play payload", code: "INVALID_INPUT" });
    }
    const { betAmount, picks } = parsed.data;

    const result = playKeno(betAmount, picks);

    const me = await prisma.$transaction(async (tx) => {
      await settleSingleShotBet(tx, userId, "keno", betAmount, result.payout, {
        picks,
        hits: result.hits
      });
      return serializeMe(tx, userId, username);
    });

    return res.json({ result, user: me });
  })
);

// ---------------------------------------------------------------------
// Wheel (single-shot)
// ---------------------------------------------------------------------

const WheelPlaySchema = z.object({
  betAmount: BetAmountSchema,
  risk: z.enum(["low", "medium", "high"])
});

router.post(
  "/games/wheel/play",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = WheelPlaySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid wheel play payload", code: "INVALID_INPUT" });
    }
    const { betAmount, risk } = parsed.data;

    const result = playWheel(betAmount, risk);

    const me = await prisma.$transaction(async (tx) => {
      await settleSingleShotBet(tx, userId, "wheel", betAmount, result.payout, {
        risk,
        landingIndex: result.landingIndex
      });
      return serializeMe(tx, userId, username);
    });

    return res.json({ result, user: me });
  })
);

// ---------------------------------------------------------------------
// Baccarat (single-shot)
// ---------------------------------------------------------------------

const BaccaratPlaySchema = z.object({
  betAmount: BetAmountSchema,
  betType: z.enum(["player", "banker", "tie"])
});

router.post(
  "/games/baccarat/play",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = BaccaratPlaySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid baccarat play payload", code: "INVALID_INPUT" });
    }
    const { betAmount, betType } = parsed.data;

    const result = playBaccarat(betAmount, betType);

    const me = await prisma.$transaction(async (tx) => {
      await settleSingleShotBet(tx, userId, "baccarat", betAmount, result.payout, {
        betType,
        outcome: result.outcome
      });
      return serializeMe(tx, userId, username);
    });

    return res.json({ result, user: me });
  })
);

// ---------------------------------------------------------------------
// Dragon Tower (stateful: start / pick / cashout - same shape as Mines)
// ---------------------------------------------------------------------

const DragonTowerStartSchema = z.object({
  betAmount: BetAmountSchema
});

router.post(
  "/games/dragontower/start",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = DragonTowerStartSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid dragontower start payload", code: "INVALID_INPUT" });
    }
    const { betAmount } = parsed.data;

    try {
      const [roundId, publicState, me] = await prisma.$transaction(async (tx) => {
        await placeWager(tx, userId, "dragontower", betAmount, {});
        const state = newDragonTowerState();
        const id = await createRound(tx, userId, "dragontower", betAmount, "GC", state);
        const meResult = await serializeMe(tx, userId, username);
        return [id, publicDragonTowerState(state), meResult] as const;
      });

      return res.json({ roundId, state: publicState, user: me });
    } catch (err) {
      if (err instanceof RoundAlreadyActiveError) {
        return res.status(409).json({ error: "A round is already active", code: "ROUND_ALREADY_ACTIVE" });
      }
      throw err;
    }
  })
);

const DragonTowerPickSchema = z.object({
  roundId: z.string().min(1),
  col: z.number().int().min(0).max(DRAGON_TOWER_TILES_PER_ROW - 1)
});

router.post(
  "/games/dragontower/pick",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = DragonTowerPickSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid dragontower pick payload", code: "INVALID_INPUT" });
    }
    const { roundId, col } = parsed.data;

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const round = await loadActiveRound<DragonTowerRoundState>(tx, userId, "dragontower", roundId);
        const pick = applyDragonTowerPick(round.state, col);

        if (pick.isBad) {
          await closeRound(tx, roundId);
          const me = await serializeMe(tx, userId, username);
          return {
            isBad: true,
            reachedTop: false,
            badIndexPerRow: round.state.badIndexPerRow,
            multiplier: 0,
            payout: 0,
            user: me
          };
        }

        await updateRoundState(tx, roundId, pick.state);
        const publicState = publicDragonTowerState(pick.state);

        if (pick.reachedTop) {
          const payout = Math.round(round.betAmount * publicState.multiplier);
          await settlePayout(tx, userId, "dragontower", payout, {
            roundId,
            currentRow: publicState.currentRow
          });
          await closeRound(tx, roundId);
          const me = await serializeMe(tx, userId, username);
          return {
            isBad: false,
            reachedTop: true,
            currentRow: publicState.currentRow,
            multiplier: publicState.multiplier,
            badIndexPerRow: round.state.badIndexPerRow, // round is closed now - safe to reveal, matches the isBad/cashout responses
            payout,
            user: me
          };
        }

        const me = await serializeMe(tx, userId, username);
        return {
          isBad: false,
          reachedTop: false,
          currentRow: publicState.currentRow,
          multiplier: publicState.multiplier,
          user: me
        };
      });

      return res.json(outcome);
    } catch (err) {
      if (err instanceof NoActiveRoundError) {
        return res.status(404).json({ error: "No active dragontower round", code: "NO_ACTIVE_ROUND" });
      }
      if (err instanceof InvalidDragonTowerPickError) {
        return res.status(400).json({ error: err.message, code: "INVALID_PICK" });
      }
      throw err;
    }
  })
);

const DragonTowerCashOutSchema = z.object({ roundId: z.string().min(1) });

router.post(
  "/games/dragontower/cashout",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = DragonTowerCashOutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid dragontower cashout payload", code: "INVALID_INPUT" });
    }
    const { roundId } = parsed.data;

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const round = await loadActiveRound<DragonTowerRoundState>(tx, userId, "dragontower", roundId);
        if (round.state.currentRow < 1) {
          throw new InvalidDragonTowerPickError("Cannot cash out before clearing at least one row");
        }

        const multiplier = DRAGON_TOWER_MULTIPLIERS[round.state.currentRow - 1];
        const payout = Math.round(round.betAmount * multiplier);
        await settlePayout(tx, userId, "dragontower", payout, { roundId, currentRow: round.state.currentRow });
        await closeRound(tx, roundId);

        const me = await serializeMe(tx, userId, username);
        return { multiplier, payout, badIndexPerRow: round.state.badIndexPerRow, user: me };
      });

      return res.json(outcome);
    } catch (err) {
      if (err instanceof NoActiveRoundError) {
        return res.status(404).json({ error: "No active dragontower round", code: "NO_ACTIVE_ROUND" });
      }
      if (err instanceof InvalidDragonTowerPickError) {
        return res.status(400).json({ error: err.message, code: "INVALID_PICK" });
      }
      throw err;
    }
  })
);

// ---------------------------------------------------------------------
// Hi-Lo (stateful: start / guess / cashout - same shape as Mines)
// ---------------------------------------------------------------------

const HiLoStartSchema = z.object({
  betAmount: BetAmountSchema
});

router.post(
  "/games/hilo/start",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = HiLoStartSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid hilo start payload", code: "INVALID_INPUT" });
    }
    const { betAmount } = parsed.data;

    try {
      const [roundId, publicState, me] = await prisma.$transaction(async (tx) => {
        await placeWager(tx, userId, "hilo", betAmount, {});
        const state = newHiLoState();
        const id = await createRound(tx, userId, "hilo", betAmount, "GC", state);
        const meResult = await serializeMe(tx, userId, username);
        return [id, publicHiLoState(state), meResult] as const;
      });

      return res.json({ roundId, state: publicState, user: me });
    } catch (err) {
      if (err instanceof RoundAlreadyActiveError) {
        return res.status(409).json({ error: "A round is already active", code: "ROUND_ALREADY_ACTIVE" });
      }
      throw err;
    }
  })
);

const HiLoGuessSchema = z.object({
  roundId: z.string().min(1),
  direction: z.enum(["higher", "lower"])
});

router.post(
  "/games/hilo/guess",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = HiLoGuessSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid hilo guess payload", code: "INVALID_INPUT" });
    }
    const { roundId, direction } = parsed.data;
    const guess: HiLoGuess = direction;

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const round = await loadActiveRound<HiLoRoundState>(tx, userId, "hilo", roundId);
        const result = applyHiLoGuess(round.state, guess);

        if (!result.won) {
          await closeRound(tx, roundId);
          const me = await serializeMe(tx, userId, username);
          return { won: false, deckExhausted: false, nextCard: result.nextCard, multiplier: 0, payout: 0, user: me };
        }

        await updateRoundState(tx, roundId, result.state);
        const publicState = publicHiLoState(result.state);

        if (result.deckExhausted) {
          // Deck exhausted - nothing left to guess against, auto cash out.
          const payout = Math.round(round.betAmount * publicState.multiplier);
          await settlePayout(tx, userId, "hilo", payout, {
            roundId,
            correctGuesses: publicState.correctGuesses
          });
          await closeRound(tx, roundId);
          const me = await serializeMe(tx, userId, username);
          return { won: true, deckExhausted: true, state: publicState, payout, user: me };
        }

        const me = await serializeMe(tx, userId, username);
        return { won: true, deckExhausted: false, state: publicState, user: me };
      });

      return res.json(outcome);
    } catch (err) {
      if (err instanceof NoActiveRoundError) {
        return res.status(404).json({ error: "No active hilo round", code: "NO_ACTIVE_ROUND" });
      }
      if (err instanceof InvalidHiLoGuessError) {
        return res.status(400).json({ error: err.message, code: "INVALID_GUESS" });
      }
      throw err;
    }
  })
);

const HiLoCashOutSchema = z.object({ roundId: z.string().min(1) });

router.post(
  "/games/hilo/cashout",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = HiLoCashOutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid hilo cashout payload", code: "INVALID_INPUT" });
    }
    const { roundId } = parsed.data;

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const round = await loadActiveRound<HiLoRoundState>(tx, userId, "hilo", roundId);
        if (round.state.correctGuesses < 1) {
          throw new InvalidHiLoGuessError("Cannot cash out before at least one correct guess");
        }

        const publicState = publicHiLoState(round.state);
        const payout = Math.round(round.betAmount * publicState.multiplier);
        await settlePayout(tx, userId, "hilo", payout, { roundId, correctGuesses: round.state.correctGuesses });
        await closeRound(tx, roundId);

        const me = await serializeMe(tx, userId, username);
        return { multiplier: publicState.multiplier, payout, user: me };
      });

      return res.json(outcome);
    } catch (err) {
      if (err instanceof NoActiveRoundError) {
        return res.status(404).json({ error: "No active hilo round", code: "NO_ACTIVE_ROUND" });
      }
      if (err instanceof InvalidHiLoGuessError) {
        return res.status(400).json({ error: err.message, code: "INVALID_GUESS" });
      }
      throw err;
    }
  })
);

// ---------------------------------------------------------------------
// Blackjack (stateful: start / hit / stand - the fuller sequence flagged
// up front, since the dealer's hole card must stay genuinely hidden
// server-side until the player stands or busts)
// ---------------------------------------------------------------------

const BlackjackStartSchema = z.object({
  betAmount: BetAmountSchema
});

router.post(
  "/games/blackjack/start",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = BlackjackStartSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid blackjack start payload", code: "INVALID_INPUT" });
    }
    const { betAmount } = parsed.data;

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        await placeWager(tx, userId, "blackjack", betAmount, {});
        let state = newBlackjackState();

        if (isNaturalBlackjack(state)) {
          // Natural blackjack auto-stands - the dealer still plays out
          // their hand per standard rules (a natural doesn't skip the
          // dealer's turn, it just means the player can't hit).
          const standResult = applyBlackjackStand(state);
          state = standResult.state;
          const multiplier = blackjackPayoutMultiplier(standResult.outcome);
          const payout = Math.round(betAmount * multiplier);
          await settlePayout(tx, userId, "blackjack", payout, { outcome: standResult.outcome });

          const roundId = await createRound(tx, userId, "blackjack", betAmount, "GC", state);
          await closeRound(tx, roundId);
          const me = await serializeMe(tx, userId, username);
          return { roundId, state: publicBlackjackState(state, standResult.outcome), payout, user: me };
        }

        const roundId = await createRound(tx, userId, "blackjack", betAmount, "GC", state);
        const me = await serializeMe(tx, userId, username);
        return { roundId, state: publicBlackjackState(state), payout: null, user: me };
      });

      return res.json(outcome);
    } catch (err) {
      if (err instanceof RoundAlreadyActiveError) {
        return res.status(409).json({ error: "A round is already active", code: "ROUND_ALREADY_ACTIVE" });
      }
      throw err;
    }
  })
);

const BlackjackRoundIdSchema = z.object({ roundId: z.string().min(1) });

router.post(
  "/games/blackjack/hit",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = BlackjackRoundIdSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid blackjack hit payload", code: "INVALID_INPUT" });
    }
    const { roundId } = parsed.data;

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const round = await loadActiveRound<BlackjackRoundState>(tx, userId, "blackjack", roundId);
        const hit = applyBlackjackHit(round.state);

        if (hit.busted) {
          await closeRound(tx, roundId);
          const me = await serializeMe(tx, userId, username);
          // No payout to settle - a loss pays 0, and settlePayout is a no-op for <=0.
          return { state: publicBlackjackState(hit.state, "lose"), payout: 0, user: me };
        }

        await updateRoundState(tx, roundId, hit.state);
        const me = await serializeMe(tx, userId, username);
        return { state: publicBlackjackState(hit.state), payout: null, user: me };
      });

      return res.json(outcome);
    } catch (err) {
      if (err instanceof NoActiveRoundError) {
        return res.status(404).json({ error: "No active blackjack round", code: "NO_ACTIVE_ROUND" });
      }
      throw err;
    }
  })
);

router.post(
  "/games/blackjack/stand",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = BlackjackRoundIdSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid blackjack stand payload", code: "INVALID_INPUT" });
    }
    const { roundId } = parsed.data;

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const round = await loadActiveRound<BlackjackRoundState>(tx, userId, "blackjack", roundId);
        const standResult = applyBlackjackStand(round.state);
        const multiplier = blackjackPayoutMultiplier(standResult.outcome);
        const payout = Math.round(round.betAmount * multiplier);

        await settlePayout(tx, userId, "blackjack", payout, { roundId, outcome: standResult.outcome });
        await closeRound(tx, roundId);

        const me = await serializeMe(tx, userId, username);
        return { state: publicBlackjackState(standResult.state, standResult.outcome), payout, user: me };
      });

      return res.json(outcome);
    } catch (err) {
      if (err instanceof NoActiveRoundError) {
        return res.status(404).json({ error: "No active blackjack round", code: "NO_ACTIVE_ROUND" });
      }
      throw err;
    }
  })
);

// ---------------------------------------------------------------------
// Video Poker (stateful: deal / draw - a fixed 2-step sequence, the dealt
// hand and remaining deck can't be trusted to a client round-trip between them)
// ---------------------------------------------------------------------

const VideoPokerDealSchema = z.object({
  betAmount: BetAmountSchema
});

router.post(
  "/games/videopoker/deal",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = VideoPokerDealSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid videopoker deal payload", code: "INVALID_INPUT" });
    }
    const { betAmount } = parsed.data;

    try {
      const [roundId, hand, me] = await prisma.$transaction(async (tx) => {
        await placeWager(tx, userId, "videopoker", betAmount, {});
        const state = newVideoPokerState();
        const id = await createRound(tx, userId, "videopoker", betAmount, "GC", state);
        const meResult = await serializeMe(tx, userId, username);
        return [id, publicHand(state), meResult] as const;
      });

      return res.json({ roundId, hand, user: me });
    } catch (err) {
      if (err instanceof RoundAlreadyActiveError) {
        return res.status(409).json({ error: "A round is already active", code: "ROUND_ALREADY_ACTIVE" });
      }
      throw err;
    }
  })
);

const VideoPokerDrawSchema = z.object({
  roundId: z.string().min(1),
  holds: z.array(z.boolean()).length(5)
});

router.post(
  "/games/videopoker/draw",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = VideoPokerDrawSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid videopoker draw payload", code: "INVALID_INPUT" });
    }
    const { roundId, holds } = parsed.data;

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const round = await loadActiveRound<VideoPokerRoundState>(tx, userId, "videopoker", roundId);
        const draw = applyVideoPokerDraw(round.state, holds, round.betAmount);

        await settlePayout(tx, userId, "videopoker", draw.payout, { roundId, rank: draw.rank });
        await closeRound(tx, roundId);

        const me = await serializeMe(tx, userId, username);
        return { hand: publicHand(draw.state), rank: draw.rank, multiplier: draw.multiplier, payout: draw.payout, user: me };
      });

      return res.json(outcome);
    } catch (err) {
      if (err instanceof NoActiveRoundError) {
        return res.status(404).json({ error: "No active videopoker round", code: "NO_ACTIVE_ROUND" });
      }
      if (err instanceof InvalidHoldsError) {
        return res.status(400).json({ error: err.message, code: "INVALID_HOLDS" });
      }
      throw err;
    }
  })
);

// ---------------------------------------------------------------------
// Abandon (#42) - closes out whatever stateful round is currently active,
// forfeiting the bet (no refund). Fixes a soft-lock: with no way to close
// an active round, a WALK AWAY click or a crash/refresh mid-round left the
// user permanently stuck getting ROUND_ALREADY_ACTIVE from every stateful
// game's `start` endpoint (Mines, Dragon Tower, Hi-Lo, Blackjack, Video
// Poker all share one "one active round per user" check - see
// games/roundStore.ts's createRound).
//
// Deliberately takes no request body (no game name, no roundId): the whole
// point is to recover a user who may not know - or whose client no longer
// has state for - which round is stuck active. `loadAnyActiveRound` finds
// it purely from the authenticated userId.
//
// Forfeit = no payout. The bet was already debited at `start` via
// `placeWager`; that debit standing as the loss is the same ledger outcome
// as any other losing resolution (e.g. a Mines bust - see the `/pick`
// route above), so no additional ledger transaction is made here, only
// `closeRound`. Refunding would let a player peek at a bad board/hand and
// retry for free - a real exploit, not a UX nicety - so this is
// intentional, not a gap.
// ---------------------------------------------------------------------

router.post(
  "/games/abandon",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const round = await loadAnyActiveRound(tx, userId);
        await closeRound(tx, round.id);
        const me = await serializeMe(tx, userId, username);
        return {
          game: round.game,
          roundId: round.id,
          betAmount: round.betAmount,
          currency: round.currency,
          forfeited: true,
          user: me
        };
      });

      return res.json(outcome);
    } catch (err) {
      if (err instanceof NoActiveRoundError) {
        return res.status(404).json({ error: "No active round to abandon", code: "NO_ACTIVE_ROUND" });
      }
      throw err;
    }
  })
);

// ---------------------------------------------------------------------
// Triple Chance (#46, single-shot) - bonus round offered after every
// shuffle-cup GC win (signup bonus, attendant claim). GC in, GC out - NOT
// routed through games/shared.ts's settleSingleShotBet, because this round
// is double-or-nothing on GC the player just received from the Coin
// Kiosk's ad-gated shuffle-cup claim, not a player-configured wager on an
// independent game - see games/triplechance.ts's header for the full
// mechanic/trust-boundary writeup. Every other game is ALSO GC-in/GC-out
// now (2026-08-29 GC-only economy restructure - TICKETS is retired), so
// Triple Chance is no longer economically special, but it stays on its own
// direct ledger calls rather than being rewired through shared.ts: doing so
// would also pull it through shared.ts's challenge/progress tracking, which
// was deliberately scoped to exclude it, and changing that is a product
// call, not a side effect of a currency migration. betAmount intentionally
// uses its own bounds (not games/shared.ts's BET_MIN/BET_MAX), since a
// wager here is a shuffle-cup win (500-2000 GC to start) or a chained
// previous Triple Chance payout, not a player-configured bet-slider amount.
// ---------------------------------------------------------------------

const TripleChancePlaySchema = z.object({
  betAmount: z.number().int().min(TRIPLE_CHANCE_MIN_AMOUNT).max(TRIPLE_CHANCE_MAX_AMOUNT)
});

router.post(
  "/games/triplechance/play",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, username } = req as AuthedRequest;
    const parsed = TripleChancePlaySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid triplechance play payload", code: "INVALID_INPUT" });
    }
    const { betAmount } = parsed.data;

    const result = playTripleChance(betAmount);

    const me = await prisma.$transaction(async (tx) => {
      await applyTransaction(tx, userId, "GC", "WAGER_GC", -betAmount, { game: "triplechance", won: result.won });
      if (result.payout > 0) {
        // PAYOUT_GC - a GC game payout, exactly what this is (double-or-
        // nothing on GC just received from the Coin Kiosk). Distinct from
        // GAME_WIN_GC (what the other 14 games' shared.ts helpers use) so
        // Triple Chance's chained bonus-round payouts stay separable from a
        // real game win in the ledger and in any metrics query.
        await applyTransaction(tx, userId, "GC", "PAYOUT_GC", result.payout, {
          game: "triplechance",
          won: result.won
        });
      }
      return serializeMe(tx, userId, username);
    });

    return res.json({ result, user: me });
  })
);

registerRoute(router);

export default router;
