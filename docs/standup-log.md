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
