# Overnight Work Queue

The `overnight-build` scheduled task reads this file, picks the **first item not marked DONE or
IN PROGRESS**, does it, and updates the entry. One item per run. Runs happen at roughly 12:23am,
2:23am, 4:23am and 6:23am; the morning standup reports on whatever landed.

**On pace:** founder directive 2026-08-27 — *"forget about the timeline, we will work as hard and
fast as possible, that is why we have the check-ins."* So there are no hour estimates or dates
here. Work through the queue in order, as far as it gets. Getting one item right beats getting two
items half-done.

**Rules for whoever works this queue:**
- Do exactly ONE item per run. Finish it properly rather than starting two.
- Mark an item `IN PROGRESS` with a timestamp **before** starting, and `DONE` with the PR link when
  finished. If you fail or run out of room, mark it `BLOCKED` with the reason — never leave an item
  silently half-done.
- Every item ships as its own PR on its own branch. **Never push to `main`, never merge, never
  deploy, never run a migration against production.**
- Full test suite must pass before you open the PR. Report the count in the PR.
- If an item turns out to be bigger or riskier than its description suggests, do the safe subset,
  say so plainly in the PR, and add a follow-up item to the bottom of this queue rather than
  forcing the whole thing through unattended.
- If the item conflicts with uncommitted local changes in the working tree (the founder may have
  been editing), skip it, mark it BLOCKED with that reason, and move to the next item.

---

## 1. Add the daily metrics script — STATUS: DONE (merged, main)

Copy the reviewed script into `server/scripts/metrics.js` (the founder's session has it staged; if
it is not already at `server/scripts/metrics.js`, it needs writing from scratch — see the spec
below) and verify it runs.

It powers the CTO's daily numbers rundown. Requirements:
- **Read-only.** Every query a SELECT. It runs unattended against production; a write here is a
  write nobody reviewed.
- `node scripts/metrics.js` runs against the local dev database; `--prod` resolves the production
  connection string via `railway variables --service Postgres --kv` → `DATABASE_PUBLIC_URL`
  (Railway's private URL is unreachable from a local machine — see CLAUDE.md).
- Reports: total and new accounts; players active in last 24h and 7d; how many of yesterday's
  players came back; **rounds played broken down by game**, including how many games got zero;
  Coin Kiosk claims; Item Shop and skin purchases; ledger movements as a cross-check.
- Always prints raw counts next to percentages, and warns when a denominator is too small to be
  meaningful. Tracking only began 2026-08-27, so early figures are noise and must be labelled.

Verify by running it against the LOCAL database only. Do not run `--prod` unattended.

## 2. Client display-copy pass — STATUS: DONE (PR #4, merged & live)

CLAUDE.md flags this as outstanding: on-screen wording never caught up to the GC/TICKETS currency
split, so some text says "Tickets" where it means Gold Coins.

Correct across all 14 game screens and the shared UI:
- Bet-amount labels should say **"Gold Coins"** (bets are always GC)
- Win/payout text should say **"Tickets"** with the real TICKETS figure
- Item Shop prices should say **"Tickets"**
- Coin Kiosk claim results should say **"Gold Coins"** (it grants GC)

This is player-facing text about players' own money, so accuracy matters. Read
`server/src/games/shared.ts` to confirm which currency each path actually moves before changing a
label — **do not assume from the existing wording, which is exactly what is wrong.** Where a label
is genuinely ambiguous, leave it and note it in the PR rather than guessing.

Note: Triple Chance is deliberately GC-in/GC-out (see CLAUDE.md) — its wording should say Gold
Coins on both sides. Do not "fix" that to Tickets.

## 3. Split the shop panels out of OverworldScene — STATUS: DONE (PR #6, merged)

Roadmap Leg 2, first half. `src/scenes/OverworldScene.ts` is ~2,400 lines and is simultaneously the
casino floor, the tutorial, the Coin Kiosk, the shuffle mini-game, the skin panel and the item
panel. Every new feature lands here, so it is the main structural risk in the codebase.

Extract the skin and item shop panels into `src/ui/ShopPanel.ts`. `openItemPanel` alone is ~230
lines. **Pure move — no behaviour change.** The panels must look and behave identically; this is
about where the code lives, nothing else.

Verify by reading carefully and by typechecking. State clearly in the PR that this is a
no-behaviour-change move and that the founder should click through the shop once after merging.

## 4. Split the Coin Kiosk out of OverworldScene — STATUS: TODO

Roadmap Leg 2, second half. Same exercise: move the Coin Kiosk flow (the simulated ad, the
shuffle-cup mini-game, the GC grant, and the Triple Chance bonus round chained onto it) into its own
module.

Target after items 3 and 4: `OverworldScene.ts` under 1,200 lines.

Same rule — pure move, no behaviour change. Be especially careful with Triple Chance: it is a
deliberate GC-in/GC-out exception settled through its own ledger calls in
`server/src/routes/games.ts`, NOT through the shared helpers. Moving code must not change that.

## 5. Stake-style visual overhaul — foundation + one game — STATUS: DONE (PR #5, merged & live; founder approved the direction, rollout to the other 13 games in progress)

The founder wants the whole product moved off its current 8-bit/pixel look. Two target styles, and
this item is **only the first**:
- **The games → look like Stake** (stake.com): flat, minimal, dark. Precise spacing, restrained
  colour, clean typography, subtle motion. **This needs almost no art assets** — it is shapes,
  spacing, colour and type, all drawable in code. That is why it goes first.
- The walk-around overworld → look like **Adventure Academy**. Not this item, not yet: it needs
  real illustrated artwork that has to be generated outside this repo.

**Do this, and stop there:**
1. Build a design-token system — colour, spacing, type scale, corner radii, elevation — expressed
   once and consumed everywhere. Ground it in Stake's actual visual language: dark desaturated
   navy/slate surfaces, a restrained accent, generous whitespace, flat panels without heavy
   ornament, type that is clean and tightly set.
2. Rebuild `src/ui/uiHelpers.ts`'s `makeGameShell()` against those tokens. It is used by **all 14
   game scenes**, so this is the single highest-leverage file in the visual overhaul — the sidebar,
   balance display, bet stepper, message line and Walk Away button all come from it.
3. Apply it to **exactly ONE game** as a worked example. Pick a visually simple one — Coin Flip,
   Dice or Limbo — so the shell does the talking rather than game-specific art.

**Deliberately DO NOT** convert the other 13 games in this run. The founder needs to look at the
direction on one screen and react before it propagates everywhere. Converting all 14 unattended and
getting the direction wrong is a large mess to unpick.

Take a screenshot of the converted game if you can run the app; otherwise say plainly in the PR
that the direction has not been visually confirmed and should be looked at before merging.

Do not touch `BootScene.ts`'s procedural texture generators in this run — they draw the overworld
art and are a separate, larger problem.

---

## Explicitly NOT on this queue

- **Dragon Tower's 213.6% payout.** Deferred by founder decision 2026-08-27 — it needs a design
  change, not a numbers change, and will come with a wider game-mechanics pass.
- **Anything legal or compliance-driven** — age gating, account deletion, event retention limits.
  Founder directive 2026-08-27: no legal work until a CLO agent exists. Do not pick these up.
- **Anything requiring a merge, a deploy, or a production migration.** Those need the founder.
- **Anything needing an external account or credential** (error-monitoring signup, ad networks).
- **New games.** The roadmap is deliberate about this: 14 games exist and nobody knows which are
  played. Not until there is data.
