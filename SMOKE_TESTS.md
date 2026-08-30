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

## Quickplay (`ui/QuickplayPanel.ts`, roadmap/quickplay-grid)

- [ ] The "🎮 Quickplay" corner button (stacked under Clothes/Challenges)
      opens a scrollable grid of cards, one per game - 14 cards, no
      duplicates even though several games (Slots, Blackjack, Roulette,
      Coin Flip, Dragon Tower) have more than one floor cabinet.
- [ ] No "N playing" or any player-count text anywhere on the grid -
      deliberate, per founder direction (see QuickplayPanel.ts's doc
      comment) - flag it as a regression if one ever appears here.
- [ ] On a touch device (or Chrome DevTools' touch emulation), dragging a
      finger up/down inside the grid scrolls it; a light tap that barely
      moves still opens the tapped game instead of being swallowed as a
      drag.
- [ ] Mouse wheel also scrolls the grid (desktop convenience, not the
      primary input).
- [ ] Tapping a card fades into that game; that game's own Walk Away
      button returns to the plain casino floor (not back into Quickplay -
      this is intentional, see the panel's `goToGame` doc comment).
- [ ] Close returns to the floor with the player able to move immediately -
      no softlock. Specifically: open Quickplay, close it without tapping a
      game, and confirm WASD/touch-joystick movement still works (this is
      the exact bug class `panelOpen` was already patched for once).
- [ ] Opening Quickplay, then tapping a card, never leaves the player
      unable to move after later leaving that game and returning to the
      floor.

## Player Room (`RoomScene`, roadmap/player-room-v2)

- [ ] Walking to the Overworld's Exit door and pressing E leads to the Room,
      not the title screen.
- [ ] The player's character (body + worn wardrobe) looks the same in the
      Room as it does on the casino floor.
- [ ] The Room starts sparsely decorated (plain wallpaper, bare wood floor)
      on a brand-new account - this is intentional, not a bug (see
      roomCatalog.ts's header on the "visibly incomplete" design point).
- [ ] "🎨 Decorate" opens a Wallpaper/Flooring picker; buying an unowned
      piece deducts Gold Coins, applies it immediately, and the room's
      wall/floor visibly repaints without a scene reload.
- [ ] Switching back to an already-owned piece ("Apply") is free and instant.
- [ ] An unaffordable piece's Buy button is disabled/shows the right price;
      attempting it anyway (e.g. two tabs) surfaces "Not enough Gold Coins."
      rather than silently charging.
- [ ] Reloading the page (or logging out and back in) keeps whatever
      wallpaper/flooring was last applied - this is server-persisted, not
      local-only.
- [ ] Walking to the Room's own door and pressing E returns to the Overworld
      at the same spot the player left it from.

## Player Room furniture (`RoomScene`, `ui/FurniturePanel.ts`, roadmap/room-furniture)

- [ ] The Room starts with all four furniture spots empty on a brand-new
      account - this is intentional (furniture has no free default, unlike
      wallpaper/flooring - see furnitureCatalog.ts's header).
- [ ] "🪑 Furniture" (stacked under "🎨 Decorate") opens a picker listing the
      four spots (Left Wall, Right Wall, Corner, By the Door) and what, if
      anything, is in each.
- [ ] Tapping a spot opens the shared piece list (Armchair, Floor Lamp,
      Bookshelf, Potted Plant, Side Table). Buying an unowned piece deducts
      Gold Coins and adds it to inventory - it does NOT appear in the room
      yet (this is deliberate, unlike wallpaper/flooring's buy-applies-
      immediately behavior - see economy/furniture.ts's header).
- [ ] After buying, the same piece's row now shows "Place" instead of
      "Buy"; tapping it makes the piece appear in the room at that spot
      without a scene reload.
- [ ] Placing an owned piece into a spot that already has something in it
      replaces the occupant - the replaced piece stays owned (visible again
      next time its row is opened) but disappears from the room.
- [ ] Placing an already-placed piece into a DIFFERENT spot moves it - it
      disappears from its old spot and appears at the new one, never both.
- [ ] "Remove from this spot" (only shown when the spot is occupied) clears
      it back to empty - the piece stays owned.
- [ ] An unaffordable piece's Buy button is disabled/shows the right price;
      attempting it anyway (e.g. two tabs) surfaces "Not enough Gold Coins."
      rather than silently charging.
- [ ] Reloading the page (or logging out and back in) keeps whatever was
      placed where - this is server-persisted, not local-only.
- [ ] Furniture is purely decorative - walking through a placed piece's
      position does not block movement (see RoomScene.ts's buildFurniture
      comment on why collision was deliberately skipped).

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

## Layered wardrobe (Item Shop → Clothing)

Replaced the skin shop below. A character is a stack of pieces over one
shared body now, bought a layer at a time.

- [ ] Item Shop → Clothing lists all six slots (Body, Trousers, Shoes,
      Shirt, Hair, Hat), each showing what's currently worn.
- [ ] Buying a piece debits TICKETS only and leaves Gold Coins unchanged
      (server-side equivalent is asserted in `server/test/wardrobe.test.ts`).
- [ ] A bought piece is worn immediately, and the player sprite visibly
      changes on the floor without a reload.
- [ ] Buying pieces for different slots layers them — a shirt AND trousers
      AND a hat all show at once, in that draw order.
- [ ] "Take Off" clears an optional slot; the piece stays owned.
- [ ] The Body slot has no "Take Off" button and the player is never
      invisible.
- [ ] Pieces with no real art yet show generated placeholder art (flat
      coloured blocks), not a missing-texture checkerboard.
- [ ] Walking: every worn layer stays locked to the body through the whole
      walk cycle, in all four directions — no layer lagging a frame behind.
- [ ] An equipped accessory (hat badge) sits on the head, not floating above
      it or sunk into the chest.

## Skin shop (SUPERSEDED - floor's #11, the old Skin Attendant panel)

**This whole section is historical.** The 17 monolithic skins, their
catalog, shop module, routes and panel were all removed when the layered
wardrobe above replaced them. The dated results below are kept as the record
of what was verified at the time; do not re-run them.

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

**Partially superseded 2026-08-13 by #41 (environment) - see note at the top
of this section before trusting the sign-off below as describing current
behavior.** #41 reverted the casino floor/wall/carpet/furniture art back to
the original pre-reskin Jephed assets. `Theme.ts`/`uiHelpers.ts` (#22),
character/NPC/dealer sprites (#24), and #23's decorative props
(bench/lamp post/market stall/hedge/tree) were left on the Kenney assets -
so `BootScene.ts`/`OverworldScene.ts`'s floor/furniture rendering no longer
matches what was verified below (there's now a deliberate-for-now partial
mismatch: bright Kenney props sitting on the reverted dark floor). Flagged
by coordinator as an open question to main, not yet resolved, and I haven't
been asked to re-verify - flagging here defensively so this section isn't
read as still-accurate for the floor/furniture rendering specifically. The
frame-index math, mixed-rig skin system, and station-spacing findings below
are about character/furniture-hitbox code that #41 didn't touch, and remain
valid.

Full reskin (original scope before #41's partial revert): art-director
sourced Kenney's "RPG Urban Pack" (CC0) and wrote `STYLE_GUIDE.md` (#21),
chrome reworked `Theme.ts`/`uiHelpers.ts` + a scene-wide hardcoded-color
cleanup (#22), environment swapped floor/wall/nature tiles + recolored
BootScene's drawn cabinet placeholders + OverworldScene's tooltip chips
(#23), characters landed new player/NPC/dealer spritesheets on a
non-standard 4-col x 3-row frame layout (#24). This is QA's #25 independent
verification pass.

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

## Real backend (#33-43, 2026-08-15, in progress) - task #38

Full migration off client-side-only balances/RNG to a real Node/Express/
Postgres backend (`casino-poc/server/`, Prisma, JWT auth). backend-lead built
the scaffold/auth/economy port/deployment prep, games ported all 14 game's
RNG+payout math server-side (single-shot: one `/play` endpoint each;
stateful - Mines/Dragon Tower/Hi-Lo/Blackjack/Video Poker - start/action/
cashout sequences backed by `game_rounds`), client-integration rewired every
scene to call the real API instead of local math. This is QA's #38 pass,
in progress - not all of it is closed yet, see open items at the bottom.

### Confirmed clean (independently re-run, not just trusted from reports)

- [x] `npm test` in `server/` - 104/104, real ephemeral Postgres test DB
      (`casino_poc_test`), not mocked. `npm run typecheck` and `npm run
      build` both clean.
- [x] `npm test` in `casino-poc/` (client) - 91/91, `npx tsc --noEmit` clean.
- [x] **Every one of the 14 game scenes is genuinely wired to the real API**,
      not just some: grepped all 14 scene files for `import * as api from
      "../api/client"` (14/14 present) and for any leftover
      `gameState.goldCoins -=`/`+=` local mutation (0/14 present). Didn't
      trust the "10 of 14, then the last 4" progress narrative - checked the
      end state directly once the "done" message came in.
      *(Housekeeping note, not a bug: `GameState.ts`'s file-header comment
      still describes the pre-migration state as if some scenes might still
      be doing local math - now stale given the above, worth a quick doc
      pass whenever convenient.)*

### Security/tamper testing (live, via real HTTP requests against the running server - not unit tests)

- [x] **Cross-user round access is blocked.** Created two real users via
      `POST /auth/signup`, started a Mines round as user A, attempted
      `POST /games/mines/pick` for that same roundId as user B - got 404
      `NO_ACTIVE_ROUND`, not a 403 or a leak of "this round exists but isn't
      yours" (matches `loadActiveRound`'s doc comment - not-found/not-yours/
      already-resolved/wrong-game all look identical to the client, by
      design).
- [x] **Negative/tampered bet amounts are rejected** by the Zod schema
      (400 `INVALID_INPUT`) before touching the ledger.
- [x] **Insufficient balance is rejected safely** - attempted a 500 SC bet
      with a 25 SC balance, got a clear 400 with the real current balance in
      the message (own balance, own authenticated request - not a leak).
- [x] **Invalid/malformed JWT is rejected** - 401 `UNAUTHORIZED`, confirmed
      via `requireAuth`'s catch-all around `verifyToken`.
- [x] **Round lifecycle + replay protection**, live, full cycle on a real
      Mines round: start (debits bet) -> pick (updates state) -> cashout
      (credits payout, closes round) -> replay pick attempt on the
      now-closed round (404) -> replay cashout attempt (404, no
      double-payout).
- [x] **The `POST /games/abandon` soft-lock fix (#42)**, live: started Mines,
      confirmed DragonTower blocked with 409 `ROUND_ALREADY_ACTIVE` (the
      original bug - one active round blocks *every* stateful game, not
      just its own), called abandon, confirmed the bet is genuinely
      forfeited (balance does NOT refund), confirmed DragonTower could then
      start normally, abandoned that too, confirmed a third abandon attempt
      cleanly 404s (`NO_ACTIVE_ROUND`) rather than double-forfeiting.
      **Forfeit-always is the final, deliberate design** - a refund-on-
      discovered-via-session-restore alternative was considered and
      rejected by main specifically because it's exploitable (a player can
      deliberately manufacture the "accident" - e.g. logging out on purpose
      on a bad board instead of clicking WALK AWAY - to convert what should
      be a loss into a refund). Applying that same lens elsewhere in #38 as
      a general check: any recovery/session-restore path that grants or
      restores something the normal-loss path wouldn't is worth the same
      scrutiny, regardless of which feature it's in.
- [x] `GET /me`'s `activeRound: {game, roundId} | null` field (added
      alongside #42) means a client that lost its local roundId - reload,
      crash, or re-authenticating after the 401 auto-logout path - can
      always discover an orphaned round rather than being stuck with no
      diagnostic info anywhere in the API surface. Confirmed present and
      correct in live responses (`null` when no round, populated during an
      active one, `null` again immediately after abandon/cashout).
- [x] Read `prisma/schema.prisma`'s `ROUND_REFUND_GC`/`ROUND_REFUND_SC`
      enum values - confirmed genuinely unused (zero references anywhere in
      `server/src/`) leftovers from the rejected refund-split design,
      correctly commented as "do not wire up without fresh sign-off," not
      an unexplained loose end.

### Economy-rule compliance (server-side port)

- [x] Read `server/src/economy/{ledger,packages,playthrough,redemption,
      signupBonus,attendantClaim,skinShop,gcMultiplier}.ts` in full - all
      faithful ports of the client rules (GC/SC separation, the #16
      crediting-ADJUST_SC guard ported verbatim, non-linear package SC
      scaling, 1x playthrough gate, minimum redemption threshold, skin
      purchases GC-only and isolated from SC/playthrough).
- [x] Two real security improvements over the client-only version, both
      things I'd flagged as accepted-limitations earlier in this project and
      are now genuinely closed: the shuffle-cup GC multiplier is resolved
      server-side via `node:crypto`'s CSPRNG (`pickRandomGcMultiplier`) -
      the client can no longer claim "I picked the 2x cup" via `/claim-bonus`
      or `/auth/signup`, it doesn't even take a multiplier parameter. And
      the attendant-claim cooldown is now a single atomic UPSERT with a
      conditional `WHERE` (DB-enforced, can't be reset via
      client-localStorage-clearing, and closes a check-then-write race
      between two concurrent claim requests).
- [x] Confirmed no real payment gateway exists yet server-side either
      (`packages.ts`'s own comment says so) - the CLAUDE.md attendant-claim
      exception's sunset condition hasn't been prematurely triggered.

### Live end-to-end (real browser, real backend, real network round-trips)

- [x] Full signup flow through the actual `LoginScene` UI (real keyboard
      events, not devtools shortcuts) against the live server: typed a new
      username/password, confirmed a genuine `POST /auth/signup` round-trip
      happened (not mocked - the shuffle-cup reveal only appears after it
      resolves), advanced through the shuffle, picked a cup, confirmed the
      *server's* resolved multiplier (not a client-guessed one) is what got
      reconciled and credited (0.5x -> 500 GC this run), landed on
      `StartMenuScene`. `ShuffleCupReveal`'s `forcedMultiplier` param means
      the animation is purely cosmetic now regardless of which cup is
      clicked - confirmed structurally, not just from the code comment.

### Still open

- [ ] **401/session-expiry UX live check** - in progress, blocked mid-check
      by the server being briefly unreachable (unrelated `prisma generate`
      pause from another teammate, not a bug) - will finish once it's back.
      Checklist: does an authenticated call with a corrupted/expired token
      actually invoke the client's `unauthorizedHandler` and land back on
      `LoginScene`; does `/auth/signup`/`/auth/login`'s own 401
      (bad credentials) correctly NOT trigger that same handler.
- [ ] Slow/hung server -> `NetworkError`/timeout UX (the 15s
      `AbortController` in `src/api/client.ts`) - not yet live-tested (hard
      to simulate a genuine hang against a real server without instrumenting
      it - may end up being a code-review-only confirmation rather than a
      live repro).
- [ ] Per-game payout math spot-checks beyond Dice/Mines (the two reference
      implementations, both covered above) - haven't independently
      re-derived the odds/multiplier math for the other 12 games yet (games'
      own 104 server tests cover this at the unit level; whether to redo
      that independently or treat it as sufficiently covered is a judgment
      call for the rest of this pass).
- [ ] Client-side `#43` WALK AWAY -> `/games/abandon` wiring - confirmed not
      yet landed as of this pass (grepped scene files, only the button
      exists, no call to the endpoint yet). Re-check once it lands:
      button actually calls abandon (not just navigating away), and the
      "exploit pattern" lens above applies to however the auto-recovery
      end of it gets built too.
- [x] **Applying the "recovery path grants what the loss path wouldn't" lens
      to the other games - general structural argument, not just Mines.**
      Read `blackjack.ts` and `videopoker.ts` in full (both match the math I
      already independently re-derived/verified against the client version
      earlier in this project - Blackjack win/push/lose = 2x/1x/0x with the
      dealer still playing out a natural, Video Poker's paytable and the
      tricky wheel/low-pair edge cases). The general argument for why
      forfeit-always is exploit-safe across *every* stateful game, not
      coincidentally safe per-game: abandon always yields exactly 0 payout,
      which is also the worst possible outcome of playing a round out
      normally (a bust, a loss, a bad final hand all also pay 0) - so
      abandon can never be *strictly better* than continuing for a rational
      player, at best it ties the worst normal outcome. There's no game
      here where continuing has a *guaranteed-worse-than-abandon* path (every
      game retains some nonzero win probability until it actually resolves),
      so "abandon before a bad outcome lands" is never +EV relative to just
      playing it out. This is a structural property of forfeit-always, not
      something that needs a fresh proof per game.
- [x] **#43 live-verified end to end through the real UI** (real signup,
      real button clicks via the scene-driving technique, real network
      round-trips - confirmed via `read_network_requests`, not inferred):
      - WALK AWAY on an active Mines round: network trace shows
        `POST /games/abandon → 200`; balance unchanged before/after
        (forfeit confirmed, not refund); navigated to Overworld; starting
        DragonTower immediately afterward succeeded with no 409 - the round
        is genuinely closed server-side, not just abandoned client-side.
      - Auto-recovery, precisely: force-orphaned a DragonTower round
        (abrupt scene switch bypassing `leaveGame()`, simulating a crash),
        then attempted to start Mines. Full trace:
        `mines/start → 409`, `abandon → 200`, `mines/start → 200`. Exactly
        one abandon call, exactly one retry, the new round's bet debited
        exactly once - genuinely one-shot, not a loop that happened to
        resolve quickly.
      - No new exploit shape found in *when* the client calls
        abandon - it's only ever reachable via an explicit WALK AWAY click
        or the automatic 409-triggered recovery, both of which forfeit
        identically; there's no client-controlled parameter that changes
        the outcome.
- [x] **401/session-expiry UX - mostly confirmed, one new finding.**
      Corrupted the stored token while an authenticated round was active,
      triggered a 401 on a real API call: confirmed `ApiError{status:401,
      code:"UNAUTHORIZED"}`, confirmed the token is cleared
      (`getToken()` → `null` after), confirmed `/auth/signup` and
      `/auth/login`'s own 401s (bad credentials) do NOT route through this
      same handler (verified via `describeSignupValidationError`'s code
      path and the `auth:false` flag on those two calls - a real signup
      earlier in this session hit real validation without ever
      auto-logging-out).
      **New finding**: `main.ts`'s `setUnauthorizedHandler` callback calls
      `game.scene.start("LoginScene")` from the *global* scene manager, not
      from inside a scene - so it does NOT implicitly stop whatever scene
      the player was on (that implicit-stop behavior only happens when
      `.start()` is called from *within* a scene, as every other
      scene-to-scene transition in this codebase does). Live-verified: the
      previously-active scene (`MinesScene`, mid-round) stays genuinely
      `isActive() === true` after the 401 fires, alongside the freshly-
      started `LoginScene` - its `roundId`/`active` fields are still set
      and its update loop/tile-click handlers are still live, not just
      visually stale underneath the login panel. Probably not exploitable
      (the orphaned scene's own handlers would just fail their API calls
      against the now-cleared token, same as any other 401), but it
      contradicts the code comment's own stated intent ("drops the player
      back to LoginScene instead of leaving whatever scene they were on")
      and is real wasted-resource/confusing-state sloppiness worth a fix -
      reported to the team.
- [x] **15s timeout/`NetworkError` UX - live-verified with a genuine real-time
      wait, not just code review** (per main's explicit direction - this is
      the corrected version of the earlier "code looks right, not
      live-tested" note). Technique: faithfully simulated a genuinely hung
      connection by swapping `window.fetch` for a promise that never
      resolves on its own and only rejects with a real `AbortError`
      `DOMException` when the request's `AbortSignal` fires - exactly what a
      real browser's `fetch()` does on a real hung connection being
      aborted. This exercises the actual unmodified `request()`/
      `AbortController`/timeout code in `src/api/client.ts`; only the
      transport primitive is stood in for, since arranging a genuine 15s+
      network hang against the shared dev server isn't practical. Called
      the real `getMe()` and waited it out for real (18 real seconds via
      the tool, not simulated/fast-forwarded time). Result: rejected at
      **15,993ms** - essentially exactly the configured 15,000ms threshold
      plus a small real overhead margin - with `NetworkError` and the exact
      message `"The server is taking too long to respond - please try
      again."`, correctly distinct from the generic `NetworkError` message
      used for other failure types. Confirms the mechanism genuinely works
      in real time, not just that the code shape looks right.
- [x] **Baccarat/Keno independent payout math re-derivation** (per main's
      direction: spot-check the highest-complexity 2-3 games for extra
      confidence rather than redo all 10 remaining games from scratch;
      trust the rest on games' own unit-test coverage - see the explicit
      per-game breakdown at the end of this section).
      - **Baccarat: clean.** Wrote an independent implementation of the
        standard baccarat third-card tableau from QA's own knowledge of the
        real rules (not copied from `baccarat.ts`), ran 3,000,000 simulated
        rounds. Outcome frequencies matched published real-baccarat odds
        within noise: Player 44.605% (ref ~44.62%), Banker 45.861%
        (ref ~45.86%), Tie 9.534% (ref ~9.52%). House edges computed from
        those frequencies against the server's actual payout multipliers
        (2.0x/1.95x/9.0x) also matched real-world reference figures closely:
        Player 1.26% (ref ~1.24%), Banker 1.04% (ref ~1.06%), Tie 14.19%
        (ref ~14.36% for a 9x tie payout). Real, non-invented odds,
        confirmed independently.
      - **Keno: real finding, not a security bug.** Independently
        re-derived the hypergeometric combinatorics from scratch (own
        `comb`/`hyperProb` implementation) and verified `C(40,10) =
        847,660,528` (known-correct value) and that per-pick-count hit
        probabilities sum to exactly 1.0. Then checked the specific
        invariant the client's own code comments claim
        ("the whole paytable's expected return is exactly (1-HOUSE_EDGE)"
        - i.e. RTP should be ~94% for every `picks` count 1-10): true for
        picks 1-6 (93.9-94.1%, confirmed both theoretically and via a
        2,000,000-round empirical simulation), but **RTP drops sharply for
        picks 7-10** - 81.7%, 75.8%, 67.6%, 67.5% respectively - because
        `MAX_MULTIPLIER = 10,000` caps the rare top-hit jackpot tiers,
        silently breaking the tier-distribution formula's assumption that
        multipliers are uncapped. This is **not a security/exploit issue**
        (a lower-than-documented RTP favors the house, not the player - the
        opposite of a money-printing bug) and it's **not something the
        server port introduced** - confirmed the client's `KenoScene.ts`
        has byte-identical constants (`MAX_MULTIPLIER=10000`,
        `HOUSE_EDGE=0.06`, etc.) and the exact same "expected return is
        exactly (1-HOUSE_EDGE)" claim in its own comments, so this is a
        **pre-existing characteristic of the original client-side design
        that predates this project's #38 backend work** and apparently
        wasn't caught by this project's earlier client-side-only testing
        either (my own earlier Keno smoke-testing checked functional
        correctness, not a full per-pick-count RTP audit). Worth a decision
        from the team: is a sharply higher effective house edge on
        high-pick Keno bets an acceptable, semi-realistic "real Keno
        jackpot-cap" characteristic (real-world Keno does have this same
        shape), or should the multiplier formula account for the cap when
        redistributing edge-adjusted value so RTP stays consistent across
        all pick counts as the comment claims? Not blocking #38 on this -
        flagging as a design question, not a defect to fix before ship.

### #45 (2026-08-16) - Keno RTP fix, independently re-verified

games fixed the above as #45: root cause confirmed exactly as diagnosed
(equal-split RTP allocation didn't account for `MAX_MULTIPLIER` clipping the
rare top tiers, so a capped tier still got *counted* as if it paid its full
uncapped share). Fix: iterative water-filling in `buildPayoutTable()` - cap
any tier whose fair share exceeds the max, subtract its actual (smaller)
contribution from the RTP budget, redistribute the remainder across
whatever's left, repeat until stable. Same fix mirrored byte-for-byte in the
client's preview-only copy (`KenoScene.ts` - cosmetic only, never settles a
real round).

- [x] Read the actual fix in full (`server/src/games/keno.ts`) - matches the
      described algorithm exactly, well-commented, references this finding
      by name.
- [x] **Independently re-implemented water-filling from scratch** (own code,
      different shape from `buildPayoutTable`, not a copy) to cross-check
      both the resulting tables and - most importantly - the safety-critical
      property that RTP must never exceed 100% for any pick count (unlike
      the original bug, which was RTP too *low*, a much-worse-than-100%-RTP
      table would be a genuine money-losing exploit for the house). Result
      for all 10 pick counts: RTP lands 93.92-94.08% for every one of them
      (max observed 94.078%), zero pick counts exceed 100%, zero tier
      multipliers exceed the documented cap. Cross-checked with a fresh
      2,000,000-round empirical simulation for the three worst pre-fix cases
      (picks 7/9/10, previously 81.7%/67.6%/67.5%) - empirical RTP now lands
      93.85-96.44% (the 9-picks figure runs a bit hot at 2M trials purely
      from rare-tier sampling variance at that picks-count's low hit-rate,
      not a formula problem - the theoretical/exact value for picks=9 is
      93.955%).
- [x] Confirmed the client's `KenoScene.ts` mirrors the same fix (grepped
      for `buildPayoutTable`/water-filling markers - present, and the file's
      own comment states it matches the server "byte-for-byte").
- [x] Client suite re-run independently: 91/91, `tsc --noEmit` clean.
- [x] **Server suite - independently re-run, port blocker now resolved.**
      backend-lead's fix (`test/globalSetup.ts`) replaces the hardcoded port
      constant with `findFreePort()` (binds to port 0, lets the OS assign a
      genuinely free ephemeral port, reads it back, releases it, then starts
      embedded-Postgres on that port) - read the fix in full, it's the
      standard "ask the OS for whatever's free right now" pattern and
      correctly sidesteps the whole class of stale-listener-entry failures
      (there's no fixed number to get stuck anymore). Ran `npm test` 5 times
      back-to-back: 4/5 clean at 117/117, no port errors at all across any
      of the 5 - the port fix itself is confirmed solid.

### New finding while re-running: a real (pre-existing, unrelated) test flake

1 of the 5 `npm test` runs (and a 2nd one in an earlier batch of 3, so 2
failures in 7 total runs) failed with:
```
test/games4.test.ts > POST /games/blackjack/* (stateful: start / hit / stand)
  > start debits the wager, deals 2+2 cards, and hides the dealer's hole card
    unless it's a natural
AssertionError: expected 1020 to be 980
```
Root cause (confirmed by reading `server/src/games/blackjack.ts`): a natural
blackjack (2-card 21) auto-resolves **inside the same `/start` call** - dealer
plays out immediately, win/push/lose settles, payout is paid - so
`res.body.user.goldCoins` at that point already reflects both the wager debit
*and* the resolution payout. The test's assertion at `games4.test.ts:21`
(`expect(res.body.user.goldCoins).toBe(before.body.goldCoins - 20)`) runs
*before* the natural/non-natural branch and is unconditional, so it's only
correct for the non-natural and natural-push cases. On a natural **win**
(pays 40 on a 20 wager per line 29), the real balance is
`before - 20 + 40 = before + 20`, e.g. `1000 - 20 + 40 = 1020` - exactly the
observed mismatch. This is a **test bug** (missing case in the assertion),
not a backend/economy bug: the server's payout math and settlement timing
are correct per the game's own documented rules; the test just didn't
account for the rare branch. Natural-blackjack-win is roughly a
4-5%-per-deal event, consistent with the ~1-in-3.5 observed flake rate this
pass.
- Not a port-fix regression, not a Keno-fix regression, not an economy-rule
  violation - flagging to games (owner of `blackjack.ts` and its tests) to
  fix the assertion (branch on `res.body.state.playerTotal === 21 &&
  res.body.state.outcome === "win"` and expect `before - 20 +
  res.body.payout` in that case, same as the later "standing..." test at
  line 129 already does correctly).
- Separately worth a look: one of the runs that hit this failure reported
  shell `exit: 0` from `npm test` despite `1 failed | 116 passed` in its own
  summary output - i.e. the process exit code didn't reflect the failure.
  Didn't dig into whether that's a vitest/npm-script/Windows quirk; flagging
  since a CI gate keyed off exit code alone would have silently passed a
  failing run.

### Exit-code finding - traced and fixed by backend-lead, independently re-verified

backend-lead confirmed the exit-code oddity above was real and root-caused
it (not a fluke, not a tooling artifact on my end): `embedded-postgres`
transitively pulls in `async-exit-hook`, which registers a
`process.on('beforeExit', () => process.exit(0))` handler on the *vitest CLI
process itself* (globalSetup runs there, not in a forked worker). Node's
`beforeExit` fires as the event loop goes idle - i.e. right as `vitest run`
is about to exit with its real computed code - and that handler wins the
race and forces exit 0 regardless of actual results. A first surgical fix
(unhooking only `beforeExit`) uncovered a second, worse bug: with that gone,
Node's plain `'exit'` event became the next thing to trigger
async-exit-hook's dispatch, which for `'exit'` runs hooks synchronously with
no callback - but the registered hook is async and expects one, so it threw
("done is not a function") as an unhandled rejection right at process exit,
flipping even a clean 117/117 run to exit 1 (confirmed by reproduction - a
false-failure signal, worse than the original false-success one). Final fix:
unhook every event `async-exit-hook` registered (`asyncExitHook.unhookEvent`
in a loop over `hookedEvents()`) and rely entirely on `teardown()`'s own
explicit `pg.stop()` for cleanup - nothing else needed it. They also caught
and fixed a related latent bug from their own earlier port-fix: DB
connection info used to pass through a shared, fixed-path file
(`test/.test-db-url.json`); two `npm test` invocations overlapping in time
could stomp on each other's file mid-run. Fixed by setting
`process.env.DATABASE_URL` directly on the parent (vitest) process instead -
Vitest doesn't fork its worker pool until `setup()` resolves, so workers
inherit it at fork time same as any other env var, no shared mutable state
on disk at all.

Independently re-verified all three claims, not trusted from the report:
- [x] Read `test/globalSetup.ts` in full - the fix matches the above
      description exactly, thoroughly commented, references the
      investigation.
- [x] **3 clean `npm test` runs**: exit 0 all 3, 117/117 all 3.
- [x] **2 deliberately-failing runs**: added a temporary throwaway test file
      (`test/__qa_temp_fail.test.ts`, one test, `expect(1).toBe(2)`), ran
      `npm test` twice - both correctly exited 1 (`1 failed | 117 passed`
      both times) - then deleted the file and confirmed a follow-up clean
      run was back to exit 0 / 117/117. Exit code now reliably reflects real
      results in both directions, matching backend-lead's own "verified
      both directions x2" claim.
- [x] **Concurrency race fix**: launched two `npm test` invocations at the
      same time (backgrounded, `wait`ed on both). Both completed
      independently at 117/117, exit 0, no cross-run interference - the
      `process.env`-based fix holds under genuine concurrent invocation, not
      just in theory.

This closes out both the exit-code oddity and the concurrency race as
independently confirmed fixed. Combined with the port-fix re-verification
above, the port/exit-code/concurrency thread is closed - but see below, the
"whole thread ... fully closed" claim relayed via coordinator was premature
on the blackjack piece specifically.

### Correction (2026-08-17): the blackjack natural-win fix is real, but a sibling test has the identical unaddressed bug

coordinator relayed a claim that the `games4.test.ts` natural-win assertion
bug was "fixed and verified... nothing outstanding from the whole test-infra
thread... now fully closed." Independently checked rather than accepted:

- [x] **The originally-flagged fix is real and correct.** Read the updated
      `games4.test.ts` - the assertion is now properly branched
      (`before - 20 + res.body.payout` on a natural win, unchanged flat
      `before - 20` otherwise). Ran it in isolation and as part of the full
      suite ~10 times total; that specific assertion never failed again.
- [ ] **But the "fully closed" claim is wrong**: the very next test in the
      same `describe` block, `"rejects a second start while a round is
      active"` (`games4.test.ts:40-45`), has the *identical* root-cause
      vulnerability and was not touched by the fix. It starts a blackjack
      round, immediately starts a second one, and unconditionally expects
      `409` (round-already-active). But if the *first* start happens to
      deal a natural blackjack, that round auto-resolves inside the same
      `/start` call (same mechanism as the other bug) - so there's no
      active round left to block the second `start`, which legitimately
      returns `200`, not `409`. Reproduced this directly, twice, in
      independent runs:
      ```
      test/games4.test.ts > rejects a second start while a round is active
      AssertionError: expected 200 to be 409
        ❯ test/games4.test.ts:44:27
      ```
      (2 reproductions in 8 isolated single-file runs this pass, consistent
      with the ~4.8%-per-deal natural-blackjack rate.) This is a test gap,
      not a backend bug - same category as the original finding, just an
      untouched sibling. Re-flagging to games: needs the same treatment as
      the "busting on hit" test elsewhere in this file (retry-until-non-natural
      on the *first* start before asserting the second start is rejected).

### Incidental finding while re-running (out of current scope, flagging only): new #46 Triple Chance RTP test looks statistically underpowered

Noticed a new game/test file, `test/games5.test.ts` (Triple Chance, #46 -
bonus round after a shuffle-cup GC win), landed since my last full-suite
pass (suite grew 117→125 tests). Not assigned to review #46 yet, but hit a
real failure in it during a routine full-suite re-run:
```
test/games5.test.ts:64 > real RTP ... is exactly 100% within statistical tolerance
AssertionError: expected 0.5454545454545454 to be greater than 0.8
```
The test's own comment claims the ±20% band is "~5 SD - astronomically
unlikely to flake," derived assuming all 1200 trials execute. But the loop
breaks early ("Balance can't go negative - stop early") whenever the next
bet would exceed the current balance, and Triple Chance is a deliberate 0%-
house-edge game (mean net per trial 0, but per-trial SD ≈70.7 on a 50-unit
bet: -50 w.p. 2/3, +100 w.p. 1/3) - a mean-zero, real-variance random walk
against a *finite* starting balance (signup grants 500/1000/2000 GC,
uniform, per `gcMultiplier.ts`) will hit its floor and truncate the loop
long before 1200 trials in a meaningful fraction of runs, especially at the
500 GC tier (walk's cumulative SD reaches ~500 by roughly trial 50). That
invalidates the "assumes n=1200" tolerance math and makes the test
genuinely flaky under realistic conditions, not astronomically rare -
matches the observed 1-in-6 fail rate this pass. Test-design issue (small-n
tolerance band), not necessarily an economy-rule violation on its own -
flagging to whoever owns Triple Chance (games or economy, unclear from a
first look) rather than fixing myself since it's outside what I was asked
to verify this pass.

### #46/#47 (2026-08-17) - Triple Chance bonus round, independently verified end-to-end

games fixed both regressions found above (retry-until-non-natural pattern
for the blackjack "second start" test; `topUpGold()` via a real
`applyTransaction(..., "ADJUST_GC", ...)` call for the Triple Chance RTP
test's early-insolvency flaw), games finished the rest of #46 (server route,
`games/triplechance.ts`), and client-integration finished #47 (client
wiring: `ShuffleCupReveal`'s new `possibleMultipliers` param,
`ui/TripleChanceOffer.ts`, both call sites, `api/client.ts` additions).
Independently re-verified rather than trusted from either report:

- [x] **Both test fixes read and confirmed correct.** `games4.test.ts`'s
      "rejects a second start" test now retries the first `start` until
      `status !== "resolved"` before asserting the second is blocked -
      matches this file's own established "busting on hit" pattern.
      `games5.test.ts`'s RTP test now calls a `topUpGold()` helper that goes
      through the real ledger (`applyTransaction(..., "ADJUST_GC", ...)`,
      not a raw balance write) to grant 5,000,000 GC bankroll before the
      1200-trial loop - ~2,000 SDs above the walk's plausible range, so the
      loop can't truncate early in practice. Ran the full suite 5x after
      restarting from the blackjack-fix pass, ran `games4.test.ts` and
      `games5.test.ts` in isolation ~8x more each: no recurrence of either
      original failure.
- [x] **Read `server/src/games/triplechance.ts`, its route in
      `server/src/routes/games.ts`, and `games/shared.ts`'s
      `settleSingleShotBet` in full.** GC is hardcoded at the route (no
      `currency` param accepted from the client at all, unlike every other
      single-shot game) - confirmed this is the actual enforcement point,
      not just a doc comment. `betAmount` is `z.number().int()`-validated
      and the win multiplier is always exactly the integer `3`, so
      `Math.round(betAmount * 3)` has zero rounding leakage at any bet size.
- [x] **Read `client/src/ui/TripleChanceOffer.ts` and both call sites**
      (`LoginScene.ts`'s signup-bonus leg, `OverworldScene.ts`'s
      attendant-claim leg) **in full.** Client never computes its own
      win/loss - reconciles entirely to the server's `result.multiplier`/
      `result.payout` via `ShuffleCupReveal`'s forced-outcome mode, same
      trust-boundary shape as the original shuffle-cup GC multiplier.
      Chased down one suspected bug (`LoginScene.submit()` calls
      `reconcileAndEnter(signupRes.user)` - a *pre*-Triple-Chance snapshot -
      *after* `runTripleChanceOffer()` runs, which looked like it could
      stomp the fresher post-Triple-Chance `gameState` hydration) but ruled
      it out on closer read: `reconcileAndEnter` only reads `me.activeRound`
      from that snapshot (irrelevant here - Triple Chance is stateless, not
      a round) and never re-hydrates the balance from it directly. Not a
      bug - noting the chase for the record since it looked real at first
      glance.
- [x] **Live end-to-end verification via real HTTP against the actual
      running dev server** (`server/src/routes/games.ts`'s live instance),
      not curl-once-and-trust: signed up a fresh account, played 25 real
      `POST /games/triplechance/play` rounds at betAmount=100, checked the
      ledger math (`before - 100 + payout`) after every single round via a
      separate `GET /me` - 25/25 correct, 8 wins/17 losses (close to the
      1/3 odds), SC balance provably untouched every round. Then a battery
      of exploit-injection attempts, each confirmed a true no-op (balance
      unchanged across the whole battery): client-supplied `currency: "SC"`
      silently ignored (settles GC regardless, SC balance genuinely
      unchanged - not just unreported), negative/zero/fractional/over-max
      `betAmount` all correctly 400 `INVALID_INPUT`, no-auth correctly 401.
- [x] **Exploit-surface question from coordinator, addressed specifically:**
      "can repeated Triple Chance attempts combine with anything else
      (redemption, playthrough, etc.) for unintended leverage, given it's a
      driftless walk not a house-edged game?" Read `economy/playthrough.ts`,
      `economy/redemption.ts`, and `economy/ledger.ts` in full to check
      cross-contamination, not just Triple Chance's own file:
  - Playthrough tracking (`recordScWager`) is only ever called from
    `settleSingleShotBet`/`placeWager` when `currency === "SC"` - Triple
    Chance's route hardcodes `"GC"`, so it structurally cannot touch
    playthrough progress. Confirmed by reading the actual call site, not
    inferring from the doc comment.
  - Redemption eligibility (`checkRedemptionEligibility`) checks only SC
    playthrough state and SC balance - no GC reference anywhere in that
    file. Triple Chance winnings (GC) cannot influence SC redemption in any
    way.
  - `ledger.ts`'s `applyTransaction` confirms GC/SC are structurally
    separate columns with no conversion path either direction (and
    `ADJUST_SC` is explicitly blocked from crediting - SC can only be
    credited via `SIGNUP_BONUS_SC`/`PACKAGE_BONUS_SC`, both unrelated to
    Triple Chance).
  - **One real, previously-undocumented structural finding, distinct from a
    code bug - status: known, deferred (main's call, 2026-08-17)**: within a
    single account, Triple Chance's math is exactly fair (confirmed above)
    and fully isolated from SC. But combined with (a) signup granting a
    free, uncapped, repeatable GC bonus, and (b) zero
    rate-limiting/CAPTCHA/IP-or-fingerprint checks anywhere in the signup
    path (grepped `server/src/` for `rateLimit|throttle|captcha|IP address|
    fingerprint` - nothing), an attacker isn't limited to the odds of a
    single account's chain: they can create free accounts at will, run the
    Triple-Chance chain on each, and keep only the accounts that got a
    lucky streak while abandoning (at zero cost) every account that didn't.
    Each individual play is fair, but the *selection* step (discard losers,
    keep winners, repeat) extracts positive expected GC per real-world
    attempt in a way a single non-repeatable account couldn't. This isn't a
    Triple Chance bug and doesn't cross into SC/redemption/playthrough
    directly - it's a question of whether GC itself is worth farming this
    way (this is a CS:GO-skin-themed casino where GC is the skin-shop
    currency), and whether multi-accounting is meant to be in scope for
    this POC at all. Raised to main as a structural/business-logic question
    rather than fixed unilaterally (not an in-account exploit, and CLAUDE.md
    doesn't currently address multi-accounting either way). **Decision**:
    not a priority for this POC - same category as "no real payment gateway
    yet" (see CLAUDE.md's attendant-claim POC-exception note for the
    precedent of an explicitly-scoped, revisit-later stopgap). Accepted as a
    known limitation; revisit if/when this becomes a real product with real
    users and multi-accounting has actual monetizable consequences. Not an
    open item - no further action expected unless the product picture
    changes.
  - Chain-cap edge case (not a bug, just noting): `TRIPLE_CHANCE_MAX_AMOUNT`
    (100,000,000) would only ever bind after ~11-12 consecutive wins in a
    single chain (probability ≈ (1/3)^11, astronomically rare per chain,
    though not literally impossible at scale) - a chained bet that size
    would 400 and the client would need to let the player stop rather than
    continue chaining. Not exploitable (no money is lost or fabricated
    either way), just a UX edge the client should already handle gracefully
    via its existing `ApiError` catch path in `playRound()`.

### #48 (2026-08-17) - Triple Chance HUD-refresh gap, code-verified only (accepted, per main)

client-integration fix for a cosmetic gap games found during their own #46/#47
self-check: `OverworldScene`'s corner HUD coin counter only refreshed once,
at the very end of the whole Triple Chance offer/play/chain sequence
(inside `showClaimResultFromServer`), not per round during it - the real
balance (`gameState`) was always correct at every step since
`hydrateFromServer` already ran inside `playRound` regardless, this was
purely the on-screen counter lagging behind it until the sequence ended.

- [x] **Read the fix in full** (`src/ui/TripleChanceOffer.ts`,
      `src/scenes/OverworldScene.ts`) - matches the reported description
      exactly: `offerTripleChance` takes a new optional `onBalanceChange`
      callback, threaded through `showOffer`/`playRound`, fired right after
      each round's `gameState.hydrateFromServer(res.user)` call (not before
      - confirmed the ordering, so the callback only ever reads
      already-hydrated state). `OverworldScene.runTripleChanceOffer` passes
      `() => this.updateHud()`; `LoginScene`'s call site correctly omits it
      (no persistent HUD at that point in its flow, matches the doc
      comment's stated reasoning).
- [ ] **Live visual click-through (does the HUD number actually visibly
      tick up mid-chain) - not independently verified.** main's call: given
      this is cosmetic-only (balance was never actually wrong underneath)
      and low priority, "code-verified, not visually confirmed" is
      sufficient to close - not worth a dedicated live-verification pass
      (this environment's headless-canvas limitation would make that pass
      slower/less conclusive than the code-read above already is for
      something this low-stakes anyway). Leaving this checkbox honestly
      unchecked rather than implying more verification happened than
      actually did - if a real click-through later shows the counter still
      lagging, it's a quick fix from here since the callback wiring itself
      is already confirmed correct by inspection.

### Infra note: shared dev Postgres needed a restart mid-session

While setting up live verification, `POST /auth/signup` against the shared
dev server (`localhost:8787`) was 500ing. Root cause in `server/pg-dev.log`:
the dev Postgres daemon (a long-lived process, distinct from the per-test-run
embedded instance) had been logging `could not reserve shared memory region
... error code 487` repeatedly since ~13:27 today - a Windows-specific
ASLR/memory-mapping conflict that prevents Postgres from forking new backend
processes for new connections, so anything opening a fresh connection (like
signup) failed while already-open connections may have kept working. Fixed
via the project's own documented recovery path (`node scripts/dev-db.js
down` then `up` again - a clean restart, no data lost, persistent volume
untouched). Confirmed working immediately after (signup succeeded, live
verification above all ran against the restarted instance). Flagging since
other teammates' sessions sharing this same persistent dev DB may have hit
the same 500s before this restart, and it's a Windows-specific failure mode
that could recur - not something introduced by #46/#47's changes.

**Per-game payout math verification level, made explicit per main's
direction (not all games got the same treatment):**
- Independently re-derived/verified this pass: Dice, Mines (#38 baseline
  pass), Blackjack, Video Poker (read in full, matches earlier independent
  client-side verification), Baccarat, Keno (both above, this pass).
- Trusted on games' own unit-test coverage (104→115 server tests) plus
  everything else already verified in #38 (auth, ledger, round-ownership,
  tamper-resistance) - not independently re-derived this pass: CoinFlip,
  Roulette, Limbo, Plinko, Slots, Wheel, Dragon Tower, Hi-Lo.
