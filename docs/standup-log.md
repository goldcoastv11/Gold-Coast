# Gold Coast Daily Standup Log

The running record of daily standups. Newest entries at the bottom.

Process: the COO task runs at ~7:05 AM and posts the day's priority, the CTO task runs at ~7:17 AM
and builds it, and the daily meeting task runs at ~7:39 AM and synthesizes both into
`docs/meetings/YYYY-MM-DD.md`.

---

## Overnight session — 2026-08-27 (00:00–01:00)

Worked live with the founder rather than via the scheduled tasks, which had not yet run for the
first time. Recorded here so the morning meeting has the history.

**Context:** The game development roadmap was approved earlier the same evening
(https://claude.ai/code/artifact/858ce8b4-21a1-415f-87b4-24b919085487). Build order: (1) player
activity tracking → (2) split up `OverworldScene.ts` → (3) login streak + daily challenges → (4) the
Home space → (5) one match-3 game → (6) test launch (~Feb 2027).

### CTO Update — 2026-08-27 (overnight)

**Shipped:** [PR #2](https://github.com/goldcoastv11/Gold-Coast/pull/2) — Leg 1 of the roadmap,
self-hosted player activity tracking. Open for review, not merged.

**What it does:** The game now records what players actually do — signup, login, which game they
opened, each round played, kiosk claims, and cosmetic purchases — plus when each account was last
used. Before this, the project recorded nothing about activity, so "how many of yesterday's players
came back today?" had no answer.

**Technical notes:**
- New `events` table (nullable user, so pre-login activity counts) with three composite indexes;
  `lastLoginAt` added to `User`.
- `POST /events` takes a batch, works logged-in or anonymous. Identity comes only from a verified
  token, never the request body. Event properties are capped flat scalars — a privacy control as
  much as a size one.
- Client `src/api/track.ts` buffers and flushes on interval, at capacity, and on page-hide. Every
  entry point is synchronous and cannot throw; sends are fire-and-forget. **Tracking cannot break
  the game.**
- Session id is random per page load and never persisted, so it identifies a visit, not a person.
- 152/152 tests passing (was 139). Client and server typecheck clean.

**Needs founder decision:** The migration is applied locally only and needs deploying to Railway
after merge — see CLAUDE.md for the `DATABASE_PUBLIC_URL` command. Until then the tracking endpoint
errors in production; nothing else is affected.

### COO Update — 2026-08-27 (overnight)

**Shipped:** Four Phase 1 compliance drafts in `docs/legal/` — Terms of Service, Privacy Policy, a
full odds disclosure covering all 14 games plus Triple Chance, and a consolidated open-questions
list. All marked draft-pending-lawyer.

**Significant finding — four games are badly mis-tuned.** Computed from the actual game code and
independently verified:

| Game | Expected return | Should be |
|---|---|---|
| Dragon Tower | **213.6%** | under 100% |
| Plinko | **190.2%** | under 100% |
| Slots | **151%** | under 100% |
| Roulette (green) | **54%** | closer to the rest |

Everything else sits between 94% and 100%, which is healthy. Dragon Tower is the worst case: every
cash-out row above row 1 is profitable, so climbing to the top is both the obvious play and hugely
+EV — there is no way to play it badly. This is not a legal or money problem, since Tickets cannot
be cashed out, but it directly undermines the Phase 1 goal of a balanced economy: players who
notice can buy out the Item Shop far faster than intended.

**Needs founder decision:**
1. **No age gate exists anywhere in the product** — signup never asks for age. Any Terms with a
   minimum age is unenforced today. Highest-priority gap.
2. **No way for a player to delete their own account** — no route exists; deletion is currently a
   manual database operation. The cascade behaviour is correct, it just isn't exposed.
3. **Gameplay events are never deleted** — no expiry job. Either state "indefinitely" honestly or
   pick a period and actually enforce it.
4. Blackjack and Video Poker return figures were deliberately **not** published — they depend on
   how well the player plays, and a wrong number in a compliance document is worse than an honest
   "being verified."
5. Needs a lawyer: governing jurisdiction, liability caps, whether GDPR/US state privacy laws
   apply, and explicit confirmation that the "not a sweepstakes" position holds up as built.

See `docs/legal/open-questions.md` for the full list.

---

## Session — 2026-08-28 (evening, live with founder)

**Merged and live on goldcoastv1.netlify.app:**
- Player activity tracking (PR #2) — migration deployed to prod, verified serving
- Game payout rebalance (PR #3) — Plinko 190%→97%, Slots 151%→96%, Roulette green 54%→97%
- Currency wording (PR #4) — Triple Chance and shuffle-cup now name Gold Coins
- Shop panels extracted from OverworldScene (PR #6) — 2,401 → 1,885 lines
- Stake visual foundation (PR #5) — design tokens, rebuilt game shell, Limbo converted
- Warm overworld palette + Baloo 2 font (PR #7) — also fixed a pre-existing contrast failure on the BET button (white-on-orange, 2.41:1)

**Founder decisions this session:**
- Approved the Stake look on Limbo → rolling out to the other 13 games
- All 14 games are being KEPT — no cutting underperformers
- Dragon Tower's 213.6% payout deferred to a later game-mechanics pass
- Legal/compliance work paused entirely until a CLO agent exists
- No timeline estimates — check-ins are the control
- Art: AI-generated, $0 budget, games before overworld

**In progress:**
- Converting the remaining 13 games to the Stake look (also fixes them being wrongly warm — they share the palette that was warmed for the overworld)
- Character rig foundation: one base character with swappable outfits, via the LPC generator. Code side is agent work; the art itself needs the founder (agents cannot generate images).

**Known open items:**
- Dragon Tower still returns 213.6% — deliberate, deferred
- Overworld station name-tags and bench/hedge tints still cold blue — one-line fixes, were in a file under concurrent edit
- Ground shadows and larger characters — the other two "free" visual wins from the art review, not yet done
- Coin Kiosk still to be extracted from OverworldScene (Leg 2, second half)

## Session continued — 2026-08-28 (late)

**Also merged and live:**
- All 14 games converted to the Stake look (PR #8). Also fixed three real bugs found on the way: Slots' paytable text and Roulette's/Blackjack's dealer sprites sat outside the mobile safe zone and were cropped on a phone.
- Challenges, XP and 50 levels — backend (PR #9) and UI (PR #11). Migration deployed to production and verified serving.
- Character rig foundation (PR #10) — explicit rig descriptors replacing frame-height guessing, LPC 64x64 format supported alongside the three existing rigs.

**Challenge system as shipped:** 14 starter challenges (daily, weekly, permanent achievements), all paying Gold Coins + XP and never Tickets. 50 levels, GC at each, free cosmetics at 8 milestones. Progress is recorded from server-side game settlement, never from client-reported events — a test forges 100 fake wins and asserts nothing moves.

**Waiting on the founder:** `docs/character-art-spec.md` — a few minutes at the LPC generator to produce the outfit sheets. All code is ready for them.

**Known open items:**
- Nothing has been visually confirmed on a real screen. Screenshots do not work in this environment (the Browser pane cannot composite this canvas game), so every visual change this session was verified structurally — scenes load, colours resolve to tokens, nothing outside the safe zone — never by looking. Worth a pass on a phone.
- `OverworldScene.ts` still guesses character rig from frame height. An LPC sheet will load and animate but must NOT be equipped as the player skin until that is pointed at the rig descriptors.
- Dragon Tower still returns 213.6% — deferred by founder decision.
- Coin Kiosk still to be extracted from OverworldScene.
- Overworld station name-tags and bench/hedge tints still cold blue.
- Ground shadows and larger characters — the remaining two "free" visual wins from the art review.

---

## Session — 2026-08-29 (live with founder)

**Merged and live:**
- Higher detail pass (PR #13) — the real 64x64 LPC character body now renders at 1:1 instead of being shrunk to 70%, which had been destroying the detail it was adopted for. Casino textures gained shading, bevels, cabinet glass and floor tile variation, added WITHIN existing texture sizes so the floor plan didn't shift.
- LPC wardrobe import (PR #14) — 56 real clothing pieces: 13 hair, 12 shirts, 10 trousers, 9 shoes, 10 hats, 2 body tones. Bought with TICKETS. Replaces the placeholder coloured blocks.

**On the wardrobe import — the part that mattered:** the source repo is GPL-licensed as *code*, but each art asset carries its own licence, mixed within the same folders. Only CC0 and OGA-BY assets were imported, filtered per-asset and verified independently. Attribution ships in `public/assets/characters/lpc/CREDITS.txt` — an OGA-BY condition, not optional. A test asserts every piece has both its file and its credits entry.

**Founder decisions this session:**
- Replace the 17 monolithic skins with a layered wardrobe — buy hair/shirts/trousers separately with TICKETS. Old skins kept rather than deleted; founder confirmed it doesn't matter.
- Whole game should have more visual detail, character and casino both.

**Environment limits learned — worth not rediscovering:**
- **Local dev servers started from this session are NOT reachable from the founder's browser.** Commands run in a sandbox with its own network, so `127.0.0.1` here is not theirs. Local review is impossible; use the live site.
- Screenshots of the game fail in the in-app Browser pane (it doesn't composite frames while hidden). Chrome via the extension works, but only when that tab is the *foreground* tab — Phaser pauses rendering on hidden tabs.
- Consequence: **no visual change this session or the last has actually been looked at by anyone before merging.** Everything was verified structurally. That is the standing risk.

**Still open:**
- Nobody has visually reviewed the new character, wardrobe, or casino detail in-game.
- Dragon Tower still returns 213.6% — deferred by founder decision.
- Coin Kiosk still to be extracted from OverworldScene.
- Overworld station name-tags and bench/hedge tints still cold blue.
- Ground shadows and larger characters — remaining items from the art review.
