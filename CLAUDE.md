# Gold Coast Arcade

Browser-based social casino / gamified arcade. Phaser.js + TypeScript + Vite, Express + Prisma +
Postgres. Live at goldcoastv1.netlify.app (Netlify frontend, Railway backend), both auto-deploying
from `main`.

Landscape, **mobile-first**. Most bugs that reach players are mobile layout bugs — see Traps below.

---

# Economy — hard rules

- **Gold Coins (GC) are the only currency.** Bet GC, win GC, buy cosmetics with GC.
- **Every balance change goes through the transaction ledger** (`server/src/economy/ledger.ts`).
  Never write a direct balance mutation. Ever.
- Rewards from challenges, levels and the level-up minigame each use their own clearly-named
  `TransactionType`, so the ledger stays readable. Add a new type rather than overloading one.
- Purchases are cosmetic only. Nothing has cash value; nothing is redeemable.

**Retired, kept in the schema as inert history** (this repo is additive-only — never drop a column
or table for cleanliness): SC and its playthrough/redemption model; the GC/TICKETS two-currency
model. Do not build against either.

**Also removed as dead code** (2026-08-30 roadmap/deadcode — confirmed zero real callers before
deleting, not assumed): the accessories/pets Item Shop's buy/equip/unequip backend
(`routes/items.ts`, `economy/itemShop.ts`'s write functions) and its browsing UI
(`ShopPanel.ts`'s `openItemPanel`) — the founder pulled its only menu entry point, so nothing could
reach it. The read side (`economy/itemShop.ts`'s `listOwnedItems`/`getEquippedItem`,
`itemCatalog.ts` on both sides) stays: an already-equipped accessory/pet still renders in the
overworld, and `progression/levels.ts`'s level-up cosmetic grants still write ownership rows
directly. Also removed: the standalone, never-wired-up "Ad Kiosk" (`economy/adRewards.ts` and
`routes/ads.ts` on both client and server, `POST /ads/claim`) — a claim mechanic the Coin Kiosk
superseded before anything in the client ever called it. Underlying DB tables
(`items_owned`/`equipped_items`/`ad_reward_claim`) are untouched, same additive-only precedent as
the SC/TICKETS retirements above.

---

# Traps — every one of these has caused a real, reported bug

## 1. The canvas is NOT 800x600
`src/main.ts` keeps height at 600 but **widens the logical canvas to match the device's aspect
ratio**, so a phone in landscape gets 1300+ width. **Never hardcode 800 / 600 / 400 / a screen
position.** `src/ui/Layout.ts` is the single source of truth for screen geometry (design
constants, live-canvas helpers, the safe zone, and `makeGameShell`'s design-block centering) - read
its header and use it instead of a literal. Converted so far: the 14 game scenes (already routed
through the shared game shell), the level-up minigame, LoginScene, StartMenuScene, and every panel
players actually open (Item Shop/Wardrobe, Room, Furniture, Challenges, Magazine, Leaderboard,
Quickplay, Tutorial). `OverworldScene.ts`/`RoomScene.ts` were left untouched (their own ad hoc
`this.scale.width / 2` calls are already correct, and that file is flagged as under separate
restructuring elsewhere in this repo) - a residual number of stray literal 400/800/600s may remain
in less-visited corners; treat any you find as a latent bug, not precedent.

## 2. Two cameras, and creation ORDER decides which one draws you
`OverworldScene`/`RoomScene` zoom their main camera on touch devices and render screen-fixed UI
through a second unzoomed camera (`src/ui/sceneCameraSplit.ts`). Which bucket an object lands in is
decided **purely by whether it was created before or after the `worldContentSoFar` snapshot** in
`create()`. Get it wrong and the object silently scrolls and zooms off-screen — this is exactly how
the joystick and interact button vanished on phones.

## 3. Phaser reuses the scene INSTANCE between visits
`create()` re-runs but class fields do not re-initialise. Any field holding a game object still
points at one destroyed with the previous visit; touching it throws and aborts `create()`, leaving a
blank screen with the old music playing. `OverworldScene.create()` clears these deliberately — keep
that up to date when adding a field.

## 4. `panelOpen` freezes the player
While a panel is open the player cannot move. If a flow changes scene without the panel's close
handler running, the flag stays set and the player is **permanently stuck**. `create()` resets it,
but any new panel must still clear its own.

## 5. Mobile safe zone
`SAFE_ZONE_TOP`/`SAFE_ZONE_BOTTOM` (=130/470) in `src/ui/Layout.ts` (re-exported from
`src/ui/uiHelpers.ts` too, so existing imports keep working). Elements outside get cropped on real
phones.

---

# Verification — what actually works here

- **Screenshots of the game usually fail.** The canvas doesn't composite in the in-app browser. Say
  so plainly rather than claiming a visual check. Assert on the live Phaser object tree instead.
- **Dev servers started from an agent are unreachable from the founder's browser** — different
  network namespace. Never hand out a localhost link; verify against the live site instead.
- The founder and two others play-test nightly on the live site and report real defects. Those
  reports are the highest-quality signal available — treat them as the priority queue.

---

# Shipping

- Work on a branch, open a PR. **Never push to `main`. Never merge your own work. Never deploy.**
- **Never run a migration against production** — generate it locally and flag it in the PR.
- Migrations are additive only.
- Tests must pass and both typechecks must be clean before opening a PR. State the numbers.
- Deploying migrations to prod needs the public URL, not Railway's internal one:
  `DATABASE_URL="$(railway variables --service Postgres --kv | grep '^DATABASE_PUBLIC_URL=' | cut -d= -f2-)" npx prisma migrate deploy`

---

# Where things live

| Area | Path |
|---|---|
| Game screens (14) | `src/scenes/*Scene.ts` |
| Casino floor / player room | `src/scenes/OverworldScene.ts`, `RoomScene.ts` |
| All procedural art | `src/scenes/BootScene.ts` (thin loader) calling generators under `src/scenes/bootScene/`, grouped by domain (characters/wardrobe, game cabinets, UI stations, room decor, floor/wall tiles, shared palette/cabinet-shell helpers) |
| Screen geometry (canvas width/center/safe zone) | `src/ui/Layout.ts` |
| Shared UI + game shell | `src/ui/uiHelpers.ts`, `src/ui/DesignTokens.ts` |
| Panels | `src/ui/*Panel.ts` |
| Character layering | `src/ui/LayeredCharacter.ts`, `src/characterRig.ts` |
| Currency ledger | `server/src/economy/ledger.ts` |
| Game payout logic | `server/src/games/`, settle helpers in `shared.ts` |
| Challenges / XP / levels | `server/src/progression/` |

**Catalogs are duplicated client-side and server-side, not shared** (`wardrobeCatalog`,
`furnitureCatalog`, `roomCatalog`, `itemCatalog`) - the server's Docker build context is scoped to
`server/` alone (Railway's Root Directory, see server/DEPLOYMENT.md), so a shared module outside
`server/` genuinely can't be imported by both sides; investigated 2026-08-30 (roadmap/deadcode)
before concluding that. All four currently agree (verified, not assumed) and are guarded by a
same-named "client and server catalogues agree" test in each of
`src/{wardrobe,furniture,room,item}Catalog.test.ts`, which fails loudly if only one side is edited -
run those (or the whole suite) after changing either one, and change both files together.

---

# Style

Write for a founder who is a CPA, not a game developer: plain English in PRs and reports, no
unexplained jargon, short. Say what a player will notice. Be explicit about what you could not
verify.
