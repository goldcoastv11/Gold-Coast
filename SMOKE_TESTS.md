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
`document.hasFocus()` is `false`) - Chromium throttles `requestAnimationFrame`
for a backgrounded/non-composited tab, which silently stalls Phaser's game
loop (queued scene transitions, tweens, and `time.addEvent` timers never
advance) and also breaks synthetic `PointerEvent` clicks (Phaser's input
manager never registers a position - `game.input.activePointer.x/y` stay
`0`). Confirmed reproducible 2026-08-10.

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
5. If you truly need pixels (verifying colors/layout/animation smoothness,
   not just outcomes), you need a tool where the pane is actually displayed/
   composited - flag that explicitly rather than reporting "looks fine" from
   a state check alone.

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
      currency "GC". OverworldScene's bonus-claim NPC uses this path.)*
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
- [ ] Equipping a purchased skin persists across logout/login.
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
