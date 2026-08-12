# Casino POC

A minimal, runnable proof of concept: log in with a username/password, then
walk around a Pokémon-style pixel-art casino floor with nine playable games,
an NPC to claim a Gold Coin bonus, and a skin shop.

Built with **Phaser 3** + **TypeScript** + **Vite**.

## What's here

- `src/main.ts` — Phaser game config, registers every scene
- `src/scenes/BootScene.ts` — generates placeholder pixel-art textures on the
  fly (no downloaded art needed to run this today)
- `src/scenes/LoginScene.ts` — the first screen after boot: username/password
  fields you click to focus, then type on the keyboard (Tab/Enter to move
  between fields, Enter on password to submit). An unrecognized username
  creates a fresh profile; an existing one checks the password. See
  "Login is NOT real security" below before relying on this for anything.
- `src/scenes/StartMenuScene.ts` — title screen showing who's logged in, an
  "Enter Casino" button, and a "Log Out" button (back to `LoginScene`)
- `src/scenes/OverworldScene.ts` — a large casino floor (80x56 tiles, roughly
  60% bigger than before) that the camera only shows a portion of at a time,
  so you have to walk around to see the whole room. Chip attendant sits in
  the center, the exit is on the bottom-middle wall, slot machines line the
  entire right wall, and blackjack/roulette/coin flip/dragon tower/mines/
  dice/limbo/plinko are spread out across the floor with generous, verified
  spacing so nothing feels cluttered or causes overlapping prompts. A coin
  tracker floats above the player's head. Remembers where the player was
  standing and respawns them there when they leave a game.
- `src/scenes/SlotsScene.ts` — slots with a real tiered paytable (2-of-a-kind
  and 3-of-a-kind both pay, common symbols pay small/often, rare symbols pay
  big/rare)
- `src/scenes/BlackjackScene.ts` — full blackjack (hit/stand/dealer AI/push)
- `src/scenes/RouletteScene.ts` — bet red/black/green against a spinning
  number, using the real roulette table art
- `src/scenes/CoinFlipScene.ts` — pick heads or tails, 2x payout
- `src/scenes/DragonTowerScene.ts` — climb a tower of tiles, cash out
  anytime, multiplier grows each level, one bad tile per row ends the run
- `src/scenes/MinesScene.ts` — 5x5 grid with 3 hidden mines, reveal gems to
  grow a fair (combinatorial) multiplier, cash out anytime, one mine ends
  the round
- `src/scenes/DiceScene.ts` — adjustable "roll under" target with a live
  win-chance/multiplier readout and a win/lose zone bar
- `src/scenes/LimboScene.ts` — pick a target multiplier, watch an animated
  number climb to a provably-fair-style crash point, win if it clears your
  target
- `src/scenes/PlinkoScene.ts` — drop a ball through an animated peg board
  into one of 9 multiplier slots
- Blackjack and Roulette now feature an animated dealer character (using
  the same 4-direction walk-cycle rig as the player/NPC) with a small
  instructions panel
- **Shared bet-size control** — every game now has a "Bet: N GC [-] [+]"
  stepper (`makeBetControl` in `src/ui/uiHelpers.ts`) backed by
  `gameState.betAmount`, so the size you pick carries over between games
  instead of each game hard-coding its own flat bet. Click the amount
  itself to type a custom number on the keyboard (digits, Backspace,
  Enter to confirm, Escape to cancel)
- `src/ui/Theme.ts` and `src/ui/uiHelpers.ts` — shared dark/neon color theme
  and reusable rounded-panel/pill-button/bet-control builders used by every
  game screen and the coin-claim panel, so they all look consistent
- `src/GameState.ts` — placeholder client-side Gold Coin / Stake Coin
  balances (see the warning in that file — this is NOT how a real build
  should handle money or RNG). Also holds the skin catalog: 17 purchasable
  skins plus the free "Classic" default, each with a random price. Every
  balance/skin change auto-saves to `localStorage` under the logged-in
  username, so progress survives a page reload or closing the tab.
- **Skin Attendant** (center-top of the map) — browse and buy skins you
  don't own yet, now with a small preview sprite next to each entry so you
  can see the outfit before buying
- **Clothes button** (top-right corner, always on screen) — switch between
  skins you already own without needing to find the attendant again, also
  with a preview sprite per entry
- **Exit** — now a drawn door instead of a flat sign

## Running it

You'll need [Node.js](https://nodejs.org) installed (v18+ recommended).

```bash
npm install
npm run dev
```

This opens the game at `http://localhost:3000`. Hot-reloads on save.

To build a static production bundle (deployable to Vercel/Netlify/any static
host):

```bash
npm run build
```

Output goes to `dist/`.

## Controls

- **Arrow keys / WASD** — move around
- **E** — interact (talk to the chip attendant, sit at the table)

## Art credits

The casino tileset (floor, walls, roulette table, slot machine, blackjack
table, plant) and the 17 purchasable character skins (`SKIN_CATALOG` in
`GameState.ts`) are from the **"2D Top-Down Pixel Art"** Casino tileset and
matching character pack by Jephed, Game Between The Lines
(https://gamebetweenthelines.com/), used under their free license. Per the
license terms, keep this credit somewhere visible in the project (e.g. an
in-game credits screen or your README) if you ship this publicly. (Task
#24: the base player/chip-attendant-NPC/dealer sprites moved off this pack
to Kenney's pack below as part of the "Bright Social-Hub" reskin — see
`STYLE_GUIDE.md`'s scope note. The 17 skins have not been redrawn to match
and still use this Jephed rig.)

The base player, chip attendant NPC, and dealer character sprites are from
the **"RPG Urban Pack"** by Kenney (https://kenney.nl/assets/rpg-urban-pack),
CC0 1.0 Universal — no attribution required, credited here anyway to stay
consistent with the project's other art credit. (Task #21/#24; see
`STYLE_GUIDE.md` for the full pack details, including its environment
tiles, which are a separate integration.)

## What's real vs. placeholder

This POC is intentionally minimal, to test one thing: does walking around a
pixel-art casino and sitting down at a table to play feel good.

**Real / production-shaped:**
- Scene architecture (overworld ↔ game transitions)
- Project structure, build tooling
- Real casino tile art (floor, walls, roulette table, slot machine, plants)
- Real animated character sprites (player + NPC), 4-directional walk cycles
- Blackjack (full hit/stand/dealer-AI/win-lose-push logic) and Slots
- Bonus coin claim with a confirm/cancel step before granting
- Mines' payout math is a real fair-odds formula (cumulative probability of
  safely revealing N tiles out of a fixed mine count), not an arbitrary
  table; Dice and Limbo similarly use house-edge-adjusted formulas instead
  of made-up numbers

**Placeholder — do not ship as-is:**
- Mines, Dice, Limbo, and Plinko's overworld furniture (`mines_machine`,
  `dice_table`, `limbo_machine`, `plinko_board`) are simple shapes drawn
  with Phaser Graphics in `BootScene.ts` (same technique as the exit door),
  not real tileset art — swap for real sprites once art is sourced
- **Login is NOT real security.** `LoginScene`/`GameState.login()` check a
  password against a hash stored in this browser's own `localStorage` —
  there is no server, no real password hashing (just a non-cryptographic
  checksum so it isn't literal plain text), and no protection against
  someone opening devtools and reading or editing any profile, including
  the "password" they'd need. It exists only so 2-3 people sharing a
  device/link don't stomp on each other's coins and skins. It also means
  progress lives in one specific browser on one specific device — clearing
  site data, using a different browser, or using incognito loses it, and
  it never syncs between devices. Fine for showing friends; do not build on
  top of this for anything real.
- Balances/skins persist to `localStorage`, but the values themselves are
  still entirely client-controlled — nothing stops a player from editing
  their own `localStorage` to give themselves coins. In a real build,
  **all currency balances and RNG outcomes must be computed server-side**
  — never trust the client. This matters even more here than in a typical
  game, since real regulatory scrutiny applies to how fairly/verifiably
  outcomes are generated.
- The bonus coin claim currently has no cooldown or limit — intentional
  for this POC stage, but a real version needs one
- **The dealer's "dealing" motion is the walk-cycle animation looping in
  place**, not a real dealing animation - there are no dedicated dealing
  frames yet, so this is a stand-in for "some idle motion" rather than an
  authentic gesture.
- No real backend, no database — everything lives in this one browser

## Next steps (once the core loop feels good)

1. **Swap in real art.** Grab a free top-down RPG tileset from
   [itch.io](https://itch.io/game-assets/free/tag-top-down) (search
   "top-down tileset" or "RPG pixel art"), lay out the casino floor in
   [Tiled](https://www.mapeditor.org/), and load the exported JSON with
   `this.load.tilemapTiledJSON(...)` in `BootScene` instead of the generated
   placeholder shapes.
2. **Add a real backend.** Node/Express + PostgreSQL, with auth, persisted
   balances, and server-authoritative spin/roll/drop results (client sends
   "I want to play", server computes the outcome and returns it — never the
   reverse).
3. **Remaining Stake Originals** not yet added: Keno, Wheel, Hi-Lo, and
   non-Original table games like Baccarat/Video Poker. Same pattern as
   Mines/Dice/Limbo/Plinko: a self-contained scene plus a drawn placeholder
   furniture texture.
4. Everything else (payments, compliance, multiplayer) comes later — see
   the roadmap discussion for sequencing.
