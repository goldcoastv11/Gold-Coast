# Project Overview
Browser-based social casino game. Phaser.js + TypeScript + Vite.

# Economy Rules (critical — all teammates must follow)
- **GC ("Gold Coins") is the only currency** — this is the current **GC-only economy**, in effect
  since 2026-08-29 founder direction ("get rid of tickets, only GC, for games, prizes, everything").
  It replaced a two-currency GC/TICKETS "arcade-token" model, which itself had replaced the original
  GC/SC sweepstakes model — see Retired below for both.
- GC is spent on every bet, win or lose, like an arcade token (never staked-and-returned), and a win
  pays GC straight back out (`GAME_WIN_GC`) — the same balance the bet came out of, not a separate
  pool. GC also grows via the Coin Kiosk's free ad-gated claim (`AD_REWARD_GC`), a real-money GC
  package purchase (`PACKAGE_GC`), and challenge/level rewards (`CHALLENGE_REWARD_GC`/
  `LEVEL_REWARD_GC`).
- SC (Sweeps Coins) is retired — do not add new SC logic, grants, or references. See "Retired: the
  SC/playthrough/redemption model" below.
- TICKETS is retired — do not add new TICKETS logic, grants, or references. See "Retired: the
  GC/TICKETS arcade-token model" below.
- Skins/wardrobe pieces and Item Shop (accessories/pets) purchases are GC (`SHOP_PURCHASE_GC`) —
  the same currency as wagering, no longer a separate purchase currency.
- All balance changes must go through the transaction ledger — no direct balance mutations.

## Triple Chance — no longer a special case, but still its own code path
Triple Chance is a bonus round chained directly onto the Coin Kiosk's shuffle-cup GC win, not an
independently-wagered game. It settles GC-in/GC-out (bet GC, win GC) via its own direct ledger calls
in `server/src/routes/games.ts`, not through the shared `settleSingleShotBet`/`placeWager`/
`settlePayout` helpers in `server/src/games/shared.ts`. Before the 2026-08-29 GC-only restructure
this was the one deliberate GC-in/GC-out exception among 15 GC-wager/TICKETS-payout games; now that
every game pays GC, Triple Chance isn't economically special any more. It still isn't rewired
through `shared.ts`, though: doing so would also pull it through that file's challenge/progress
tracking, which was deliberately scoped to exclude Triple Chance, and changing that is a product
call, not a side effect of a currency migration. Don't merge it into the shared helpers without
explicit founder sign-off.

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

## Retired: the GC/TICKETS arcade-token model (removed 2026-08-29, the GC-only restructure)
This game used to run a two-currency GC/TICKETS "arcade-token" model: GC spent on every bet as the
play currency, and a separate TICKETS balance credited only by a game win (`GAME_WIN_TICKETS`) and
spent only in the Item Shop (`SKIN_PURCHASE_TICKETS`/wardrobe purchases). Per explicit founder
direction on 2026-08-29 ("get rid of tickets, only GC, for games, prizes, everything"), that whole
model is gone, replaced by the GC-only model described above: every game now pays its win in GC
(`GAME_WIN_GC`), and the wardrobe/Item Shop are priced and paid in GC (`SHOP_PURCHASE_GC`).

The `TICKETS` `Currency` enum value and the `GAME_WIN_TICKETS`/`SKIN_PURCHASE_TICKETS`
`TransactionType`s stay in the Prisma schema (marked retired in comments) rather than being removed,
same additive-only-migration precedent the SC retirement above already set — don't reintroduce
TICKETS logic against them. Every account's TICKETS balance was zeroed via a balancing
`TICKETS_RETIRED` ledger transaction (not a silent UPDATE), so old ledger rows stay honest and
readable rather than being deleted.

**Migration note:** `server/prisma/migrations/20260829120000_gc_only_economy` (adds the
`GAME_WIN_GC`/`SHOP_PURCHASE_GC`/`TICKETS_RETIRED` transaction types) and
`20260829120100_zero_tickets_balances` (zeroes every TICKETS balance) are **generated but NOT yet
deployed to production** as of this writing — check Railway before assuming they're live, and don't
run `prisma migrate deploy` against production yourself; flag it for the founder to run (see the
deploy note above for the correct command once it's time).

The client-side display-copy pass this used to leave outstanding (bet/win/shop wording, the
overworld HUD's second "🎟️ Tickets" figure) is done — every player-facing "Tickets" mention became
"Gold Coins," and the HUD's now-permanently-zero TICKETS figure was dropped rather than kept as a
second, always-zero wallet. Wardrobe/Item Shop prices (120–1,500 GC) were left numerically unchanged
from their TICKETS-era values — see `server/src/economy/wardrobe.ts`'s header comment for the
reasoning (checked against the Coin Kiosk's 500–2,000 GC/~30s claim and packages starting at 5,000
GC; still a real chunk of a claim or some bet turnover, not free, not unreachable).

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
`AD_REWARD_GC` — GC only, never TICKETS/SC, both retired (see above). `server/src/economy/adRewards.ts`
and its routes/DB table are unused now but deliberately left in place rather than deleted, to
avoid touching an already-applied migration for a pure cleanup with no functional benefit.

# Team Roles
- games: implements Stake Originals
- economy: GC/TICKETS ledger, packages, skin shop backend
- floor: casino floor UI, skin shop front-end
- qa: smoke tests, regression checks
- lead: coordinates team, reports progress
