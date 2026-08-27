# Project Overview
Browser-based social casino game. Phaser.js + TypeScript + Vite.

# Economy Rules (critical — all teammates must follow)
- GC ("Gold Coins") and TICKETS ("Tickets") are separate ledgers — this is the current
  **arcade-token economy** (replaced the old GC/SC sweepstakes model — see Retired below). Both
  names are real, displayed-to-players currency names now; there is no display-only renaming layer
  any more (that reverses the earlier Gold Coast Arcade rebrand's "GC displays as Tickets" rule —
  TICKETS is a real, separate currency now and needed the "Tickets" name for itself).
- GC is the **play** currency: spent on every bet, win or lose, like an arcade token (never
  staked-and-returned). GC only ever grows via the Coin Kiosk's free ad-gated claim
  (`AD_REWARD_GC`) or a real-money GC package purchase (`PACKAGE_GC`) — never from playing a game.
- TICKETS is the **win** currency: credited ONLY by a game win (`GAME_WIN_TICKETS` — the ledger
  hard-enforces this as the one legal credit path) and spent ONLY in the Item Shop
  (`SKIN_PURCHASE_TICKETS`). No real-money value, no playthrough requirement, no redemption —
  TICKETS can't be sold, gifted, or cashed out for anything.
- SC (Sweeps Coins) is retired — do not add new SC logic, grants, or references. See "Retired: the
  SC/playthrough/redemption model" below.
- Skins are purchased with TICKETS only — never GC. Keep skin purchase logic fully separate from GC
  wagering logic.
- Ad-reward refills grant GC only — never TICKETS.
- All balance changes must go through the transaction ledger — no direct balance mutations.

## Triple Chance exception — stays GC-in/GC-out
Triple Chance isn't one of "the games" for economy purposes: it's a bonus round chained directly
onto the Coin Kiosk's shuffle-cup GC win, not an independently-wagered game. It intentionally stays
GC-in/GC-out (bet GC, win GC) rather than paying TICKETS like the other 14 games — settled via its
own direct ledger calls in `server/src/routes/games.ts`, not through the shared
`settleSingleShotBet`/`placeWager`/`settlePayout` helpers in `server/src/games/shared.ts` (which
hardcode the GC wager / TICKETS payout split for everything else). Don't "fix" this to pay TICKETS
without explicit user sign-off — it matches the user's own framing that the shuffle game's currency
is Gold Coins, not Tickets.

## Retired: the SC / playthrough / redemption model (removed 2026-08-23, the arcade-token restructure)
This game used to run a two-currency GC/SC sweepstakes model: GC plus a non-linearly-scaled SC bonus
gift on package purchase, a 1x SC playthrough requirement, and a minimum-threshold real-money SC
redemption route. That whole model is gone, replaced by the GC/TICKETS arcade-token model described
above. `economy/playthrough.ts`, `economy/redemption.ts`, and the `POST /redeem` route were deleted
outright, not just deprecated. The `SC` `Currency` enum value and every SC-era `TransactionType`
stay in the Prisma schema (marked retired in comments) rather than being removed, matching this
repo's additive-only-migration precedent — don't reintroduce SC logic against them.
**Migration note:** `server/prisma/migrations/20260823182508_arcade_token_economy` (adds the
`TICKETS` currency and `GAME_WIN_TICKETS`/`SKIN_PURCHASE_TICKETS` transaction types) is **applied
in production** as of 2026-08-26. All 7 migrations are live on the Railway database.

**Deploying migrations to prod:** `railway run npx prisma migrate deploy` does NOT work — Railway
injects the private `DATABASE_URL` (`postgres.railway.internal`), which is unreachable from a local
machine. The Postgres service now has a **TCP proxy** enabled, exposing `DATABASE_PUBLIC_URL`.
Deploy with that variable instead:
`DATABASE_URL="$(railway variables --service Postgres --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)" npx prisma migrate deploy`

## Pending: client display text hasn't fully caught up to the new currency split
The field-level rename (`gameState.tickets`, etc.) is done everywhere, but a pass to fix the actual
on-screen wording is still outstanding: bet-amount labels across the 14 games should say "Gold
Coins", win/payout text should say "Tickets" with the real TICKETS amount, Item Shop prices should
say "Tickets", and Coin Kiosk claim results should say "Gold Coins" (it grants GC). Until that pass
lands, some UI copy may still read "Tickets" where it actually means GC — a leftover from the
earlier rebrand's now-reversed GC→"Tickets" display rename.

## Retired: attendant SC test grant exception (was in effect 2026-08-10 through the Arcade rebrand)
The overworld Chip Attendant (now the "Coin Kiosk" — see below) used to carry a narrow,
user-approved exception granting 1 SC alongside its GC, as a stand-in for a future real
GC-purchase bonus-gift path. As part of the Gold Coast Arcade rebrand (user direction), that SC
grant was removed entirely — the claim is GC-only now, same as an ad-reward refill, and this
exception no longer applies to anything. Kept here as a historical record; do not treat this as
license to add a new SC exception elsewhere without its own explicit sign-off. (SC itself is now
fully retired regardless — see above.)

## Coin Kiosk (formerly "Chip Attendant" + the separate standalone "Ad Kiosk")
The two former free-claim stations were consolidated into one: the Coin Kiosk. Watching a
simulated ad (the old Ad Kiosk's mechanic) now gates entry into the shuffle-cup mini-game (the
old Chip Attendant's mechanic), which grants a variable amount of GC ("Gold Coins") via
`AD_REWARD_GC` — no TICKETS/SC (see the retired-exception note above). `server/src/economy/adRewards.ts`
and its routes/DB table are unused now but deliberately left in place rather than deleted, to
avoid touching an already-applied migration for a pure cleanup with no functional benefit.

# Team Roles
- games: implements Stake Originals
- economy: GC/TICKETS ledger, packages, skin shop backend
- floor: casino floor UI, skin shop front-end
- qa: smoke tests, regression checks
- lead: coordinates team, reports progress
