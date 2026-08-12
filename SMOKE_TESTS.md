# Smoke Tests

Manual regression checklist for scene/UI-level work that isn't practical to
unit test (Phaser scenes, rendering, input). For pure-logic modules (ledger,
payout math, package tiers, playthrough tracking, skin shop backend), see the
automated suite instead: `npm test` (vitest, in `src/**/*.test.ts`).

Owner: qa. Run relevant sections whenever a feature in that area lands or
changes; check off items as they pass, and note the date + commit/build
you tested against.

## How to run

```
npm run dev
```

Open the printed local URL. Use a fresh browser profile / incognito window
when testing login or first-run flows so localStorage is empty.

### If your browser tool can't render/composite the page (headless environments)

Several of us have hit environments where the page loads but doesn't
visually render (screenshots time out, `document.hidden` is `true`,
`document.hasFocus()` is `false`). Confirmed reproducible 2026-08-10;
root-caused (incorrectly) 2026-08-12 after task #32; **corrected and
actually nailed down 2026-08-12 (later same day)** after games checked
Phaser's own source and did a joint follow-up - see below. Read this
version, not any earlier one you might recall.

**Precise mechanism (corrected, 2026-08-12):** an earlier version of this
note blamed `game.hasFocus`. **That was wrong** - games read Phaser's
actual bundled source (`node_modules/phaser/dist/phaser.js`) and found
`hasFocus`/`inFocus` is consumed in exactly one place,
`TimeStep.smoothDelta()`, purely to clamp the delta value after being
backgrounded - independently re-verified via the same grep, confirmed
`hasFocus`/`inFocus` appear nowhere in `InputManager` or `MouseManager`.
It does NOT gate input processing anywhere. Two separate signals were
being conflated:

- `game.hasFocus` (real, but a **red herring** for input - only affects
  delta smoothing).
- **The actual mechanism**: Phaser's `ScaleManager` sizes the canvas from
  its parent DOM element (`scale.parent`). When the browser pane isn't
  currently displayed/composited to the user, that parent element's live
  `clientWidth`/`clientHeight` measure `0` (confirmed directly:
  `gg.scale.parent.clientWidth === 0` at the exact moment a click fails)
  - so Phaser's own internal `scale.displaySize`/`scale.canvasBounds`
  stay stuck at `{width:0, height:0}`, and the `InputManager`'s
  pointer-to-world transform has nothing valid to work with, so
  `activePointer` never updates (stays `null`, not just `0`) no matter
  how the event is dispatched.
- This is why patching it from inside the page doesn't work, and *why* it
  doesn't work is itself informative: `canvas.style.width/height` can be
  set directly (and `getBoundingClientRect()` will honestly reflect that),
  but it doesn't help - `scale.displaySize` is Phaser's own cached number,
  not derived from a fresh `getBoundingClientRect()` read per event, and
  the moment anything triggers Phaser to recompute (even calling
  `scale.refresh()` or `scale.resize()` explicitly) it re-measures the
  still-zero parent and **overwrites your manual CSS fix back to 0x0**.
  There is no known in-page-JS fix - the parent's live layout size is a
  genuine reflection of whether the pane is actually displayed to the
  user right now, not spoofable from script.
- `gg.loop.step()` still works fine for advancing tweens/timers/scene
  transitions regardless of any of this - **that part of the existing
  workaround below is unaffected and still reliable.**
- **Consequence: `zone.emit("pointerdown")` (the technique used
  throughout most of this file) invokes a GameObject's listener directly
  and completely bypasses Phaser's hit-testing.** It correctly tells you
  "does the code behind this handler do the right thing" but CANNOT tell
  you "does a real click at this screen position actually reach this
  handler" - camera-scroll/scrollFactor/z-order/occlusion bugs in the hit
  path are invisible to it. This is exactly how task #32's scrollFactor
  bug (cups not clickable once the camera scrolled) survived earlier
  `emit()`-based testing undetected by both games and QA - see that
  task's entry below for the full story. If you want to at least confirm
  *whether* real hit-testing is even possible in your current session
  before relying on `emit()`, check `gg.scale.parent.clientWidth` (or
  `gg.scale.displaySize.width`) - if it's `0`, no dispatch technique will
  get you a real click, so don't spend time trying variations of it; say
  so explicitly and fall back to `emit()` with the "logic verified,
  hit-testing not verified" caveat from item 5 below.

Workaround that verifies real behavior instead of pixels:
1. `const gg = window.__game;` - the Phaser.Game instance (exposed as
   `window.__game` in main.ts).
2. Drive scenes directly instead of clicking: `gg.scene.getScene('KenoScene')`
   and call its methods. Scene class fields are "private" only at the
   TypeScript level - still readable/callable at runtime from devtools/JS eval.
3. Fast-forward the game loop (needed for anything on a `time.addEvent` timer
   or a tween, e.g. Keno's reveal, Wheel's spin) by manually pumping steps
   instead of waiting on rAF: `for (let i=0;i<N;i++) gg.loop.step(performance.now())`.
   Loop.step's delta doesn't cleanly map to wall-clock ms 1:1 in this mode -
   just call it in a loop (hundreds of times, cheap) until the state you're
   waiting on changes.
4. Assert against `localStorage.getItem('casinoPocProfiles')` (ledger/
   playthrough/unlockedSkins live there) and against the scene's own text
   objects (`scene.balanceText.text` etc.) rather than screenshots.
5. `zone.emit("pointerdown")` / `container.emit("pointerdown")` is fine for
   verifying handler *logic* (amounts, guards, sequencing) but is NOT
   evidence the real click-to-handler path works - see the `game.hasFocus`
   mechanism above. For anything involving a scrollable camera (i.e.
   OverworldScene, once the player has moved at all) plus nested
   interactive children in a container, treat `emit()`-based passes as
   "logic verified, hit-testing NOT verified" and say so explicitly rather
   than implying a full click-through happened.
6. If you truly need real hit-testing or pixels (verifying colors/layout/
   animation smoothness, camera-scroll-dependent click targets, not just
   logic outcomes), you need a tool session where the pane is actually
   focused/displayed to the user - flag that explicitly as unverified
   rather than reporting "looks fine" from an `emit()`-based check alone.

---

## Economy-rule tripwires (check on every economy/skin/ad-reward change)

These map directly to the CLAUDE.md rules — treat any failure here as a
blocking regression, not a nice-to-have:

- [x] GC and SC are visibly tracked as separate balances everywhere they're shown.
      *(2026-08-10: HUD/scene balance strings all show both; confirmed live.)*
- [x] No UI flow lets a player buy SC directly (with real money or GC). SC only
      appears as (a) a no-deposit signup bonus, or (b) a bonus gift attached to
      a GC purchase.
      *(2026-08-10: verified via src/economy/economy.qa.test.ts - grepped
      every SC-crediting applyTransaction call site in src/, only
      signupBonus.ts and packages.ts credit SC positively. See caveat below
      re: legacy `stakeCoins` setter - RESOLVED, see #16 note.)*
- [x] SC bonus amounts across GC package tiers are NOT a flat multiple of price
      (e.g. tier A and tier B shouldn't both be "GC price / 40").
      *(2026-08-10: SC-per-$ strictly increases 0.40→0.60→0.75→0.90→1.10→1.30
      across all 6 tiers; also checked no constant slope between any two
      tiers, ruling out a linear fit generally.)*
- [x] SC shows/enforces a 1x playthrough requirement before it's redeemable
      (can't redeem freshly-granted SC immediately).
      *(2026-08-10: tested full sequence - signup bonus → package top-up →
      still PLAYTHROUGH_INCOMPLETE with correct remaining amount even above
      minimum → wagering through clears it.)*
- [ ] Redemption is blocked below the minimum SC threshold, and the UI
      communicates why. *(economy backend logic verified 2026-08-10; no
      redemption UI exists yet to check the "communicates why" half.)*
- [x] Skin purchases only ever debit GC, never SC — and skin purchase code
      path doesn't touch playthrough/redemption state at all.
      *(2026-08-10: read skinShop.ts end-to-end - imports only GameState +
      ledger, never playthrough/redemption. Also purchased a skin live via
      OverworldScene's shop panel - SC balance untouched.)*
- [x] Ad-reward / "watch ad" refill buttons grant GC only, never SC.
      *(2026-08-10: read adRewards.ts - only ever calls applyTransaction with
      currency "GC".)*
      *(2026-08-10, UPDATED: repo-root CLAUDE.md now has a documented,
      narrowly-scoped exception - "Temporary POC exception — attendant SC
      test grant (user-approved 2026-08-10)". `src/economy/attendantClaim.ts`
      (only that file) is explicitly allowed to grant 1 SC alongside its GC,
      as a stand-in for the real GC-purchase bonus path until a payment
      gateway exists. This does NOT apply to adRewards.ts or anything else -
      QA independently read the CLAUDE.md diff before accepting this, did
      not just take a peer's word for it. When #18/#19 land, re-verify: (a)
      the SC grant is confined to attendantClaim.ts and nothing else calls
      it, (b) exactly 1 SC per claim, no more, (c) the 30s cooldown is
      actually enforced and persists across reload, (d) - important - the
      exception text only excepts the "SC only via signup/GC-purchase
      bonus" and "ad-reward is GC-only" rules specifically; it does NOT
      except playthrough-gating or the redemption minimum, so this SC must
      still register a normal 1x playthrough requirement and still be
      unredeemable below MIN_SC_REDEMPTION like any other SC. Faucet-math
      note kept for the record even though compliant: ~1 SC/30s of clicking
      is a real, if intentional, design tradeoff - worth revisiting once the
      real payment flow lands and this exception is supposed to be removed.)*
      *(2026-08-10, #18/#19 VERIFIED LANDED - all checks (a)-(d) above pass:
      wrote 5 new independent tests in economy.qa.test.ts (not reusing
      economy's own attendantClaim.test.ts) confirming ATTENDANT_CLAIM_PACKAGE
      is absent from GC_PACKAGES, scBonus is exactly 1, and - the two checks
      that matter most since the exception doesn't cover them - playthrough
      and the redemption minimum both still gate this SC exactly like any
      other source (tested via the real accumulate-by-claiming path, not
      pre-seeded balances). Also live-verified end-to-end through the actual
      running UI (real button pointerdown event, not a direct function call):
      claiming via the Chip Attendant grants exactly +1000 GC/+1 SC as
      PACKAGE_GC/PACKAGE_BONUS_SC transactions (not AD_REWARD_GC -
      adRewards.ts confirmed untouched and unaffected by this cooldown), the
      button shows a live "Available in Ns" countdown and is genuinely
      disabled during cooldown (second click while disabled is a no-op,
      balance unchanged), and - tested twice, once after the cooldown had
      naturally expired and once via an immediate reload while still
      mid-cooldown - the 30s cooldown survives a real page reload (not just
      logout/login in-session): timestamp persists unchanged in localStorage,
      remaining time reflects true elapsed wall-clock time, and a claim
      attempted immediately post-reload is still correctly blocked. Full
      suite 74/74 (69 from economy + 5 new), `npm run build` clean. Also
      confirmed #20 (betting.ts) is exactly what it claims - foundational
      ledger-only, no scene file imports placeBet/resolveBet yet.)*
- [x] Every balance change is traceable to a ledger transaction (no place in
      the UI where a balance changes without a corresponding entry).
      *(2026-08-10: GameState's legacy goldCoins/stakeCoins setters route
      through applyTransaction with an ADJUST_GC/ADJUST_SC type rather than
      mutating a number directly - confirmed by reading GameState.ts.)*

**Open risk (flagged to economy 2026-08-10) — RESOLVED 2026-08-10 via #16.**
economy removed the legacy `stakeCoins` setter entirely (`gameState.stakeCoins
= x` is now a TypeScript compile error - independently confirmed by QA with a
throwaway probe file: `tsc --noEmit` reports `TS2540: Cannot assign to
'stakeCoins' because it is a read-only property`) and hardened
`applyTransaction()` in ledger.ts to throw on any crediting (positive-amount)
`ADJUST_SC` call regardless of caller, as defense in depth. Both fixes
independently re-verified by QA: read the diffs in ledger.ts/GameState.ts,
confirmed no source file anywhere assigns to `.stakeCoins` (grep), ran the
full suite (46/46, includes economy's new tests for both fixes), ran
`npx tsc --noEmit` clean, ran `npm run build` clean.

## Boot / Login (`BootScene`, `LoginScene`)

- [ ] Game loads to the boot/loading screen without console errors.
- [ ] Fresh (no localStorage) load lands on login/signup, not a stale session.
- [ ] Creating a new username+password logs in and starts with the documented
      default balances (currently GC 1000 / SC 25 in the POC state).
- [ ] Logging in again with the same credentials restores the same balances
      and unlocked skins (persistence works).
- [ ] Wrong password for an existing username is rejected with a visible error.
- [ ] Empty username or empty password is rejected client-side.
- [ ] Logout returns to login screen and a subsequent login as a different
      user does not see the first user's balances/skins.

## Start Menu (`StartMenuScene`)

- [ ] All game entries listed navigate to the correct scene.
- [ ] Balance display (GC/SC) matches what was left in the overworld/last game.

## Overworld (`OverworldScene`)

- [ ] Player spawns, moves with expected controls, no collision/clipping into
      unwalkable areas.
- [ ] Re-entering the overworld from a game/menu drops the player back near
      where they left (per `lastPlayerPosition`), not a hard reset.
- [ ] Walking into each game's entrance/kiosk transitions to the right scene.
- [ ] Skin shop kiosk (if present) opens and reflects owned vs. lockable skins.

## Bet control (shared across all games)

- [ ] Bet stepper (+/-) clamps at BET_MIN (5) and BET_MAX (500), does not go
      negative or above max via rapid clicking.
- [ ] Typed/keyboard bet entry clamps the same way and ignores garbage input
      (letters, blank, negative).
- [ ] Bet amount persists across switching between games.

## Per-game happy path + edge case

For each game below: place a minimum bet and confirm balance debits
correctly on wager and credits correctly on a win; then hit at least one edge
case.

- [ ] **CoinFlip** — win and loss both settle balance correctly; can't wager
      more GC than currently held.
- [ ] **Dice** — result respects configured win chance/threshold; boundary
      roll (exact threshold value) resolves consistently with the stated rule.
- [ ] **Limbo** — cashout multiplier math checks out on at least one
      known-seed or repeated run; can't set a target below the game's minimum.
- [ ] **Mines** — revealing a mine ends the round and forfeits the bet;
      cashing out mid-round pays the currently-displayed multiplier, not a
      stale one.
- [ ] **Plinko** — ball drop always lands in a slot with a defined multiplier
      (no undefined/NaN payout); balance updates match the slot landed.
- [ ] **Roulette** — a straight-up win pays out at the correct odds; a loss on
      every placed bet type debits correctly.
- [ ] **Slots** — spin cost is debited before the result renders; a winning
      line pays the listed multiplier for that symbol combo.
- [ ] **Blackjack** — dealer follows stand/hit rules consistently; a push
      (tie) returns the original bet rather than crediting a win or debiting
      a loss; blackjack (natural 21) pays the stated bonus odds.
- [ ] **Dragon Tower** — cashing out at a given level pays that level's
      multiplier; picking the wrong tile ends the round and forfeits the bet.
- [x] **Video Poker** (#15) — 9/6 Jacks-or-Better. Games' write-up (known-hand
      tests + 500k-hand Monte Carlo + live play) requested and reviewed, but
      QA verified independently rather than trusting it: wrote a from-scratch
      reference hand evaluator (not reused from VideoPokerScene.ts) and ran
      it against 15 forced hands - one per paytable tier plus the trickiest
      edge cases (a *suited* A-2-3-4-5 wheel correctly resolves to Straight
      Flush 50x, not misfired as Royal; a *mixed-suit* wheel correctly
      resolves to plain Straight 4x; a pair of 10s correctly pays 0x, not
      Jacks-or-Better's 1x, since 10 < J; a gapped run 2-3-4-5-7 correctly
      pays 0x) - each forced through the real deal()→draw() pipeline (dealt
      normally, then hand overwritten with all 5 held so draw() evaluates
      exactly the crafted hand) so payout arithmetic was checked too, not
      just classification. All 15/15 matched exactly, including Royal Flush
      250x (+6250 on a 25 GC bet). Separately ran one real (non-forced)
      hand through the actual click-handler-equivalent path
      (deal→toggleHold(0)→toggleHold(2)→draw): deck went 47→44 (5 dealt,
      3 of the 5 replaced), and the two held cards were confirmed unchanged
      by reference after draw - held-card persistence and deck accounting
      both correct. Across the full test run (63 ledger transactions between
      this and the Baccarat pass), exactly 1 was ever SC (the original
      signup bonus) - GC-only confirmed empirically, not just by reading the
      source (which also shows `stakeCoins` is read-only there, same as
      Baccarat).
- [x] **Baccarat** (#14) — driven live 2026-08-10, ~20 rounds across all three
      bet types (Player/Banker/Tie), explicitly confirming GC-only (games'
      completion report didn't state this outright, so QA verified directly
      rather than assuming): read BaccaratScene.ts end-to-end - the only
      `stakeCoins` reference in the file is the read-only HUD string, and
      since #16 removed GameState's `stakeCoins` setter, any attempt to write
      it here would now be a `tsc` compile error, which this file doesn't
      hit. Live-verified every payout path: Player win pays 2.0x (+50 GC on a
      25 GC bet), Banker win pays 1.95x (+49 GC on 25 GC, correctly
      commission-adjusted), Tie win pays 9.0x (+225 GC on 25 GC), a tie
      result while betting Player/Banker pushes (bet returned, net GC delta
      0), and plain losses debit exactly the bet. SC balance (checked every
      round) never moved once across the whole run regardless of bet type or
      outcome.
- [x] **Keno** — driven live 2026-08-10 (quick-picked 10/10, played through the
      160ms-per-number reveal timer, resolved 2/10 matched → correctly "not
      enough to win" since minPayHits(10)=4; bet deducted before the reveal
      animation started, no payout added on the loss). GC only, SC untouched.
      Still want: a live run that actually hits a paying tier, to confirm the
      payout math end-to-end (only the loss path + the unit-tested paytable
      math have been checked so far).
- [x] **Wheel** — driven live 2026-08-10 (spin() on Low risk, fast-forwarded
      the 2600ms tween, landed 0.81x on a 25 GC bet → +20 GC, matches
      round(25*0.81)). GC only, SC untouched. Still want: one run on Medium
      and High risk each, and a 0x (loss) landing.
- [x] **Hi-Lo** — driven live 2026-08-10: one loss round (wrong first guess,
      bet forfeited) and one 5-correct-guess run cashed out for the right
      multiplier-based payout (25 GC bet → 117 GC payout). Also confirmed the
      double-cash-out guard - calling cashOut() again after an already-settled
      run is a no-op (balance unchanged). GC only, SC untouched.

## Skin shop (floor's #11 - OverworldScene's Skin Attendant panel)

- [x] Skin purchases debit GC only (verify against the economy-rule tripwire
      above); SC balance is unaffected by any skin purchase.
      *(2026-08-10: bought skin_000 live via `ow.openSkinPanel('shop')` +
      `gameState.purchaseSkin('skin_000')` - the same call the Buy button
      makes. GC 1000→600, SC unchanged at 25, HUD and re-rendered shop list
      both updated correctly, item dropped off the "unowned" list.)*
- [ ] Can't purchase a skin costing more GC than currently held. *(unit
      tested in economy.test.ts/economy.qa.test.ts; not re-driven live.)*
- [ ] Can't re-purchase an already-owned skin (no double debit). *(unit
      tested; not re-driven live.)*
- [x] Equipping a purchased skin persists across logout/login.
      *(2026-08-11, re-verified post-#24 reskin with the new mixed-rig
      system: bought skin_002 [legacy 21x32 rig] with the real "Buy" button,
      equipped it with the real "Wear" button, did a genuine full page
      reload, and confirmed both `unlockedSkins` and `currentSkin` persisted
      correctly and the player spawned already wearing it at the correct
      scale/size for that rig. See "Bright Social-Hub reskin" section below
      for the full #25 pass.)*
- [ ] **Not yet checked (needs a visually-composited browser, see note
      above)**: actual pixel-level click-through of the shop panel - button
      hover states, layout/pagination rendering, preview art. Everything
      above was verified by calling the exact same functions the UI wires up
      to, not by clicking the rendered panel, because synthetic pointer
      events don't register in this environment (see "If your browser tool
      can't render/composite" above).

## GC package purchase + SC bonus (once purchase flow lands)

- [ ] Every listed package is GC-for-money only; SC never appears as a
      directly purchasable line item.
- [ ] Each tier's SC bonus gift is present and the bonus scaling across tiers
      is visibly non-linear (spot-check at least 3 tiers against each other).
- [ ] Granted bonus SC is flagged not-yet-redeemable until 1x playthrough is
      met.
- [ ] Attempting redemption below the minimum SC threshold is blocked with a
      clear message.

## Shuffle-cup GC multiplier (#27-30, in progress)

economy's #27 landed early (gcMultiplier.ts + variable-GC legs on
signupBonus.ts/attendantClaim.ts, both defaulting to 1x for backward compat).
Full #30 pass is still blocked on #29 wiring the real mini-game in - this is
a preliminary independent check of the #27 foundation only.

- [x] Independently re-ran the suite: 90/90 (economy's 87 + 3 new QA tests
      below), `npx tsc --noEmit` clean. Confirmed both GameState.ts call
      sites (`login()`'s new-profile branch, `claimAttendantBonus()`) were
      correctly updated for attendantClaim.ts's reordered signature
      (`multiplier` inserted before `nowMs`) - checked this specifically
      since a positional-arg reorder like that is an easy way to silently
      break an existing caller; it wasn't.
- [x] Confirmed existing-profile login structurally cannot re-trigger the
      GC shuffle: the `if (existingRaw)` branch in `login()` returns before
      ever touching `grantSignupBonus`/`gcMultiplier` - not just "won't be
      called," actually can't reach that code on the existing-profile path.
- [x] SC legs (25 signup / 1 attendant) confirmed still flat and
      multiplier-independent, both in economy's tests and QA's own.
- [x] **Finding, RESOLVED same day**: `gcMultiplier.ts` exported
      `isValidGcMultiplier()` but nothing called it - the multiplier was
      only constrained at the TypeScript type level. economy fixed it by
      wiring the guard directly into `resolveGcAmount()` (the one
      chokepoint both `grantSignupBonus` and `claimAttendantBonus` use),
      throwing `InvalidGcMultiplierError` for anything outside
      {0.5, 1, 2} - so every caller, present and future (#29's mini-game
      output included), gets the guard automatically rather than needing
      to remember to call it. QA's 3 tripwire tests were flipped from
      "demonstrates the gap" to "asserts the rejection" (per the original
      finding's own note that they should be), plus a 4th confirming
      0.5/1/2 still work with zero throw - independently re-run (91/91),
      `tsc`/`build` clean. Independently live-verified against the running
      dev server (not just re-trusting the unit tests): `claimAttendantBonus(999)`
      and `claimAttendantBonus(-5)` both throw `InvalidGcMultiplierError`
      with balance completely untouched (1000/25 unchanged both times),
      then `claimAttendantBonus(2)` on the same session succeeds normally
      (2000 GC + 1 SC granted) - confirming the fix doesn't collaterally
      break the valid path. Also checked the signup-bonus path specifically
      (`login('user','pw', 42)`) - same `InvalidGcMultiplierError`, and a
      follow-up `login('user','pw', 0.5)` succeeds normally (500 GC, 25
      SC), confirming both call sites are protected identically, not just
      the one economy's own report focused on.
      **Very minor, currently-unreachable side-observation**: `login()` sets
      `this.activeUsername` *before* calling `grantSignupBonus`, so if that
      throws (only possible today via a manually-bad multiplier, since
      `LoginScene` never passes one), `GameState` is left "logged in" as a
      username with no persisted profile until the caller retries or calls
      `logout()`. Verified retrying with a valid multiplier recovers
      cleanly (no corrupted/partial profile gets written). Not flagging as
      an action item - not reachable from any current UI path - just noting
      in case #29's mini-game integration ever calls `login()` with an
      unvalidated resolved multiplier directly.

### #30 full pass (2026-08-12) - floor's #29 landed, all items closed

floor's browser pane was headless (zero-size canvas rect) so they could only
do a static read-through of the two wired entry points, and explicitly asked
QA to prioritize an actual live click-through - done, below, using the
scene-driving/loop-stepping technique (real Phaser pointerdown events on the
real buttons/hit-zones, not direct function calls, except where noted).

- [x] **Cup-outcome fairness/uniformity over many trials.** Didn't trust
      `ShuffleCupReveal.ts`'s own docstring claim of a 1M-trial simulation
      (the script isn't in this repo) - wrote an independent from-scratch
      reimplementation of its exact swap algorithm (SWAP_STEPS=18,
      NOOP_CHANCE=1/3, same random-transposition logic) and ran 2,000,000
      trials myself. Max deviation from perfectly uniform 33.333% across all
      9 (slot x multiplier) cells: 0.042 percentage points. Also confirmed
      all 6 of S3's permutations are reachable and roughly evenly
      distributed (~16.6-16.8% each vs. expected 16.67%) - matches the
      source's claim that the "lazy" no-op steps avoid parity-locking to a
      3-of-6 subset.
- [x] **Correct GC amount matches what's revealed**, both entry points,
      live: drove the real signup shuffle (LoginScene, real keyboard events
      + real hit-zone pointerdown) end to end for 3 separate new profiles,
      landing 1x/1x/2x - each time `ledger.gc === 1000 * resolved multiplier`
      exactly, transaction typed `SIGNUP_BONUS_GC` with the multiplier in
      `meta`. Same live check on the attendant claim (OverworldScene, real
      button clicks) landing 2x then 0.5x - `PACKAGE_GC` amount matched in
      both cases.
- [x] **SC portions unaffected, still register playthrough.** Both live
      runs above: signup SC stayed exactly 25, attendant SC stayed exactly
      1, regardless of the GC multiplier landed on. `playthrough.required`
      incremented by exactly the SC amount granted each time (25 on
      signup, +1 more to 26 after the attendant claim) - never by anything
      GC-multiplier-scaled.
- [x] **Attendant's 30s cooldown still enforced**, including the specific
      edge case that matters most (cooldown surviving a reload while
      *mid-window*, not just "eventually re-enables"): claimed live, noted
      the fresh timestamp, immediately did a genuine full page reload
      (~650ms later, well inside the 30s window), logged back in, opened
      the chip panel, and confirmed the button showed "Available in 1s"
      and clicking "Yes" did NOT start a new shuffle (no shuffle container
      ever got created, balance untouched, persisted timestamp unchanged).
      Also confirmed cooldown gates *starting* the shuffle specifically
      (not just the final grant) by clicking "Claim Again" immediately
      after a claim and confirming no shuffle spawned.
- [x] **Existing-profile login does NOT re-trigger the shuffle.** Live:
      logged into an already-created profile through the real LoginScene
      flow, landed on StartMenuScene within a handful of frames (no
      ~1000-frame shuffle-animation delay), no shuffle container was ever
      instantiated, GC and transaction count both completely unchanged.
      Backed by the structural read from the #27-level pass: `login()`'s
      existing-profile branch returns before the code that would even
      reference a multiplier is reached.
- [x] **No skip/exploit path.** Checked three angles:
      1. *Claiming without resolving a cup*: traced the only path to a
         grant (`completeLogin`/`completeAttendantClaim`) - both are only
         ever called from `onResolve`, which only ever fires from
         `pickSlot()`, which only exists to be called by a hit-zone's
         `pointerdown` (registered only after the shuffle animation
         finishes). No code path grants without a pick.
      2. *Double-grant via double-pick*: `pickSlot` guards on a `resolved`
         flag. Live-tested by emitting `pointerdown` on two different cup
         zones back-to-back on the same shuffle - confirmed exactly 2
         ledger transactions total (one GC, one SC), not 4.
      3. *Re-triggering a concurrent shuffle*: `OverworldScene.update()`
         returns early whenever `panelOpen` is true (blocks
         movement/proximity/interaction entirely), and `panelOpen` stays
         true continuously from the "Yes" click through the whole
         shuffle+result flow - so the NPC can't be re-interacted with to
         spawn a second concurrent shuffle. Confirmed live that
         `panelOpen` was `true` throughout an active shuffle.
- [x] **Applied identically at both call sites.** Both `LoginScene.ts` and
      `OverworldScene.ts` call the exact same `createShuffleCupReveal`
      (same `SWAP_STEPS`/`NOOP_CHANCE`/algorithm, no per-call-site
      parameters affecting fairness) with `GC_MULTIPLIER_BASE` as the base
      amount - not two independently-tuned copies. Only difference is
      cosmetic (panel copy/positioning) and what happens in `onResolve`
      (`completeLogin` vs. `completeAttendantClaim`), which is expected.
- [x] `npm test` (91/91), `npx tsc --noEmit`, `npm run build` all
      independently re-run and clean with #29 in place.

### #32 (2026-08-12) - cups not clickable once camera scrolled + amount-label/preview-sequence feature

**Important correction to my own #30 pass above**: my #30 "no skip/exploit"
and "live click-through" claims were verified via `zone.emit("pointerdown")`
and were **wrong to describe as click-through** - `emit()` invokes a
GameObject's listener directly and completely bypasses Phaser's real
hit-testing pipeline. games found (via a genuine `mousedown` dispatch with
the camera actually scrolled) that the attendant-claim shuffle's cups were
**not clickable at all** in real play once the player had walked anywhere -
`handle.container.setScrollFactor(0)` correctly fixes the outer container
on screen for *rendering*, but Phaser does not propagate scrollFactor to
interactive children nested inside a container for *hit-testing* - each
child still hit-tests at its own default scrollFactor (1) unless told
otherwise. LoginScene never surfaced this since it has no scrollable
camera. See "browser can't render/composite" section up top - this is
precisely the class of bug that testing methodology cannot catch, and this
task is the concrete example of it happening for real.

**Fix** (`src/ui/ShuffleCupReveal.ts`): every element the component creates
(cup containers, graphics, labels, hit zones, status text) now gets its own
explicit `.setScrollFactor(0)`, not just the outer wrapper - matches the
per-element pattern every other OverworldScene modal already used.

**Feature added alongside**: cups now show the actual resolved GC amount
("500"/"1000"/"2000") instead of a bare "0.5x/1x/2x" label, and `start()`
now runs preview (all 3 amounts shown ~1.4s) -> hide (cups close back to
identical unrevealed state) -> shuffle -> pick -> reveal, instead of
shuffling immediately.

**QA re-verification (2026-08-12), being explicit about what could and
couldn't be confirmed this time:**

- [x] Read the full diff. Confirmed every cup container/bg/label/hit-zone/
      status-text call now has `.setScrollFactor(0)`, matching the
      described mechanism exactly.
- [x] **Attempted to independently reproduce games' exact live-click
      methodology** (genuine `mousedown` dispatch, camera scrolled via
      real player movement - held `wasd.D`/`wasd.S` `.isDown = true`
      through real `handleMovement()` calls, not a teleport, confirmed the
      camera genuinely scrolled: scrollX 240 -> 480). Could NOT get a real
      click to register in this attempt: `game.hasFocus` was `false` in
      this tool session, which - confirmed by direct experiment - makes
      Phaser's entire real input pipeline inert (a genuine
      `canvas.dispatchEvent(new MouseEvent(...))`, and even calling
      `game.input.mouse.onMouseDown()` directly, both left `activePointer`
      unset). This is a non-spoofable browser-focus property, not
      something fixable from in-page JS - tried forcing the canvas back
      to a real CSS size (it had also collapsed to 0x0, a separate,
      apparently-related symptom of the same non-focused state) and
      `scale.refresh()`; neither changed `game.hasFocus`. **I could not
      personally confirm the exact hit-testing fix via a real click in
      this session** - flagging this honestly rather than either
      papering over it or re-using `emit()` and implying it's equivalent.
- [x] What I *could* still verify, precisely scoped: with the camera
      genuinely scrolled (scrollX 480), ran the full functional sequence
      via `emit()` (logic-only, see caveat above) end to end twice more
      (one fresh signup, one attendant claim) - preview correctly shows
      500/1000/2000, labels correctly hide during the shuffle, status text
      correctly reads "Pick a cup!", the resolved GC amount correctly
      matches the multiplier (2000 on signup, 500 on attendant claim this
      run), SC stayed flat, playthrough incremented correctly. This
      confirms the *feature* (amounts + preview sequence) and that #32
      didn't regress anything the #30 pass covered - it does NOT confirm
      the hit-testing fix itself.
- [x] `npm test` (91/91), `tsc`, `build` independently re-run, clean.
- [x] **Still open, as of the original entry above → now closed, two ways:**
      (1) the actual user personally tested the cup click and reveal
      sequence live and confirmed it's good - #32 is closed on the board.
      (2) **the `game.hasFocus` diagnosis two entries above was wrong**,
      corrected the same day after games checked Phaser's actual source:
      `hasFocus`/`inFocus` is only consumed by `TimeStep.smoothDelta()` for
      delta clamping and does not gate input anywhere - independently
      re-verified via the same grep. The real mechanism (also confirmed
      independently, including forcing `gg.scale.resize()` and watching it
      re-collapse) is that Phaser's `ScaleManager` derives
      `scale.displaySize`/`canvasBounds` from `scale.parent`'s live
      `clientWidth`/`clientHeight`, which read `0` while this tool's
      browser pane isn't displayed to the user - see the corrected,
      complete writeup in the "browser can't render/composite" section up
      top. `game.hasFocus` being `false` was real but a coincidental
      correlate, not the cause. Credit to games for not letting a
      plausible-sounding wrong explanation stand once something didn't add
      up (their own session also had `hasFocus: false` during their
      *successful* repro, which is what triggered them to actually go
      check).

## Bright Social-Hub reskin (#21-25, 2026-08-11)

Full reskin: art-director sourced Kenney's "RPG Urban Pack" (CC0) and wrote
`STYLE_GUIDE.md` (#21), chrome reworked `Theme.ts`/`uiHelpers.ts` + a
scene-wide hardcoded-color cleanup (#22), environment swapped
floor/wall/nature tiles + recolored BootScene's drawn cabinet placeholders +
OverworldScene's tooltip chips (#23), characters landed new player/NPC/dealer
spritesheets on a non-standard 4-col x 3-row frame layout (#24). This is QA's
#25 independent verification pass.

- [x] `npm test` (74/74), `npx tsc --noEmit`, and `npm run build` all clean
      with the full reskin in place.
- [x] **STYLE_GUIDE.md fidelity** - read the full guide and cross-checked
      `Theme.ts` against its sampled color table: all 8 tile-sampled colors
      present and correctly labeled (Primary #3BD2AB, Secondary #59B6D8,
      Accent-warm #F5AA57, Success #42DFAB, Danger #C2504D, Neutral sand
      #C6BC9F, plus the two chosen-not-sampled background/panel/text rows).
      One naming nuance, not a bug: `Theme.accent` holds STYLE_GUIDE's
      "Primary" role (mint-teal) rather than its "Accent" role
      (coral-orange #FF7143) - the coral value does exist and is used, just
      as a local `BootScene.PALETTE.coral` for cabinet-texture drawing
      rather than a shared `Theme.ts` token other scenes could reference as
      a general "hot CTA" color. Cosmetic/naming only, not incorrect, not
      raising as a blocker - noting in case a future screen wants a
      Theme-level coral CTA color and can't find one under an obvious name.
- [x] **Frame-index math for the new 4x3 character layout** (the thing
      specifically flagged as easy to get subtly wrong) - `BootScene.ts`'s
      `createKenneyWalkAnims`/`DIRECTION_FRAMES` matches STYLE_GUIDE.md's
      documented mapping exactly (left=[0,4,8], down=[1,5,9], up=[2,6,10],
      right=[3,7,11]), verified by direct comparison, not just "it renders
      something."
- [x] **Mixed-rig skin system** (Classic = new 16x16 Kenney rig, all 17
      purchased skins = old 21x32 Jephed rig, left un-redrawn per
      STYLE_GUIDE.md's explicit scope note) - dug into this hard since it's
      exactly the kind of thing that looks fine at a glance while being
      subtly wrong:
      - `applyPlayerBody()`/`applyPlayerScale()` correctly discriminate rig
        by native frame height (`.height <= 16`, confirmed this reads the
        *native* unscaled frame size in this Phaser setup, not
        display-scaled size - verified empirically, not assumed) and
        produce the right collision-body proportions and on-screen scale
        for both rigs, confirmed live for both Classic and a purchased
        skin.
      - **Investigated a suspected bug and disproved it**: the "Wear"
        handler does `player.setTexture(newTex, player.frame.name)`,
        reusing a raw frame index across two *differently laid-out* sheets
        (old: 3-contiguous-frames-per-direction; new: direction-interleaved,
        4 apart). Mapped all 12 frame indices and found 8 of them
        (0,2,3,5,6,8,9,11) genuinely resolve to a *different* direction
        under the two layouts - confirmed live that forcing the player onto
        one of those "bad" frames right before a real skin-swap does
        initially leave a wrong-direction frame set. **But** `handleMovement()`
        runs every game step regardless of input and its idle branch
        (`idleFrameForDir`) unconditionally overwrites the frame to match
        the player's actual current facing direction - confirmed live that
        the bad frame is corrected within the same/next game step, before
        any render. Net: not a real bug, just a non-obvious mitigation that
        held up under a deliberately adversarial test.
      - Skin shop purchase (GC-only, GC 1000→0 exact price, SC untouched)
        and equip verified end-to-end through the real UI buttons, plus
        persistence across a genuine full page reload (see "Skin shop"
        section above).
- [x] **Station spacing/interaction radii** - `registerStation`'s radius is
      computed from `sprite.displayWidth/Height` at registration time, and
      since all `GAME_STATIONS` furniture textures are explicitly untouched
      by this reskin (STYLE_GUIDE.md's scope note - no equivalent in the new
      pack), none of their radii changed. The one sprite that *did* rescale
      (the Chip Attendant NPC, new rig at scale 2) correctly calls
      `refreshBody()` after `setScale()` - a real Arcade Physics gotcha
      (static bodies don't auto-resync their collision box to a
      post-creation scale change, unlike dynamic bodies) that's easy to
      miss and was handled correctly. Live-verified: dumped all 25
      registered interactables' radii (sane values, e.g. NPC radius 32 =
      max(32,32)/2+16), and directly exercised `handleProximity()` at the
      NPC's exact position (prompt shows) and far away (prompts clears).
- [x] Confirmed `STYLE_GUIDE.md`'s required README.md credit line for Kenney
      RPG Urban Pack is present and correctly scoped (base player/NPC/dealer
      only, not the 17 still-Jephed skins).
- [ ] **Not yet checked (needs a visually-composited browser)**: actual
      pixel/visual confirmation that the palette *looks* like the intended
      "bright social-hub" mood, that outlines read as warm brown not black,
      that the new tiles don't have visible seams/misalignment against the
      old furniture art they sit next to, and that col1/col2/col3 of each
      of the 3 wired-up character sheets (green/gray/lavender) actually show
      the claimed down/up/left-right poses rather than something else -
      STYLE_GUIDE.md's author flagged they eyeballed this visually
      per-variant and asked implementers to re-check; QA could not
      independently re-verify that specific claim pixel-by-pixel in this
      environment (see the browser-pane-limitation note up top). Everything
      else in this section was verified functionally/structurally instead.
