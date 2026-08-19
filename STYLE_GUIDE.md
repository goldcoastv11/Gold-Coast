# Style Guide — "Bright Social-Hub" Reskin

Task #21. Goal: restyle the whole game to evoke Animal Jam's aesthetic — bright,
saturated, playful, nature/social-hub vibe — **without copying any of Animal
Jam's proprietary art or IP** (owned by WildWorks/Netflix). Nothing here was
traced, referenced pixel-for-pixel, or derived from Animal Jam assets; this is
an independently-sourced, commercially-licensed tileset chosen to hit the same
*mood* (saturated nature colors, rounded friendly shapes, cheerful plaza/park
scenery). Characters stay human, per the brief — there is no animal-avatar
work here, just palette/environment/character-sprite mood.

## Chosen pack

**Kenney — "RPG Urban Pack"** (v1.0, 2019-01-05)

- Source / download: https://kenney.nl/assets/rpg-urban-pack
  (direct zip: `https://kenney.nl/media/pages/assets/rpg-urban-pack/0a097d1dc7-1677578575/kenney_rpg-urban-pack.zip`)
- Mirror listing: https://kenney-assets.itch.io/rpg-urban-kit and
  https://opengameart.org/content/rpg-urban-pack
- 486 sprites (16×16 tiles): plaza/park ground tiles, pools, buildings,
  fences, benches, lamp posts, market stalls, doors/windows, vehicles, trees
  (both a green summer palette and an orange/red autumn palette), and 6
  humanoid character color-variants with a genuine 4-direction, 3-frame walk
  cycle (see "Character sheet layout" below).

### Why this pack

- **CC0 — the single safest license for a project with real commercial
  intent** (this game sells GC packages with SC bonus gifts per
  `CLAUDE.md`). No attribution, share-alike, or "non-commercial unless you
  buy a tier" catches, unlike several popular itch.io "cute RPG" packs
  (e.g. LimeZu's or Kenmi's asset lines) which restrict commercial use
  behind a paid license — those were considered and rejected for that
  reason.
- **One cohesive pack** covers ground/plaza tiles, nature elements (grass,
  trees, water), decorative social-hub furniture (benches, lamp posts,
  market stalls, fences), and characters, all drawn by the same artist at
  the same scale/line-weight — so it reads as one consistent world instead
  of a patchwork of styles.
- The color palette (see below) is already saturated mint-teal, sky blue,
  coral/terracotta orange, and warm sand — independently a strong match for
  the "bright playful nature hub" mood without borrowing anyone's specific
  character designs, logos, or named locations.

### License (verbatim, from the pack's own `License.txt`)

```
	RPG Urban Pack 1.0

	Created/distributed by Kenney (www.kenney.nl)
	Creation date: 05-01-2019

			------------------------------

	License: (Creative Commons Zero, CC0)
	http://creativecommons.org/publicdomain/zero/1.0/

	This content is free to use in personal, educational and commercial projects.
	Support us by crediting Kenney or www.kenney.nl (this is not mandatory)

			------------------------------

	Donate:   http://support.kenney.nl
	Request:  http://request.kenney.nl
	Patreon:  http://patreon.com/kenney/

	Follow on Twitter for updates:
	http://twitter.com/KenneyNL
```

**Action for whoever lands the integration PR:** add a credit line to
`README.md`'s "Art credits" section, same pattern as the existing Jephed
credit — attribution isn't mandatory under CC0 but the project already
credits its other pack, so let's stay consistent:

> Environment tiles and character base sprites are from the **"RPG Urban
> Pack"** by Kenney (https://kenney.nl/assets/rpg-urban-pack), CC0 1.0
> Universal.

## Where the files landed

```
casino-poc/public/assets/kenney_rpg_urban_pack/     <- the pack, as downloaded, unmodified
  License.txt                                        <- verbatim license (source of truth)
  Preview.png                                         <- full labeled-by-eye sheet overview
  Sample.png
  Tilemap/
    tilemap.png            <- full sheet, tiles spaced 1px apart (17px stride)
    tilemap_packed.png      <- full sheet, tiles packed with NO spacing (432x288,
                                27 cols x 18 rows of 16x16 tiles) — use this one
                                for Phaser spritesheet loading, spacing-free
    tilemap.txt              <- "Tile width: 16px, Tile height: 16px, Margin: 0px, Spacing: 1px"
                                (spacing note applies to tilemap.png, NOT tilemap_packed.png)
  Tiles/
    tile_0000.png ... tile_0485.png   <- every tile pre-cut to its own 16x16 PNG,
                                          already exactly what the existing
                                          per-file convention (floor_tan.png,
                                          wall.png, plant.png, etc.) expects.
                                          Index formula: tile_NNNN = row*27 + col
                                          (0-indexed, row-major) against the
                                          tilemap_packed.png 27x18 grid — so to
                                          find the file for the tile at (col,row),
                                          NNNN = row*27 + col, zero-padded to 4
                                          digits. Cross-reference Preview.png or
                                          tilemap_packed.png visually to pick
                                          tile coordinates, then use this formula
                                          to grab the matching pre-cut file.

casino-poc/public/assets/characters/kenney/
  character_sheet_all6.png    <- all 6 character color-variants stacked, 64x288
  char_a_green.png             <- 6 individual 64x48 spritesheets, one per
  char_b_brick.png                character variant, each already cropped to
  char_c_lavender.png             just that character's 4x3 grid (below).
  char_d_hardhat.png              Suggested mapping: player = char_a_green,
  char_e_gray.png                 chip attendant NPC = char_e_gray or
  char_f_dark.png                 char_d_hardhat (distinct silhouette/hi-vis
                                   reads well as "staff"), dealer =
                                   char_c_lavender or char_b_brick. The
                                   remaining variants are free to use for
                                   skins/reserve NPCs.
```

The old placeholder-pack files in `public/assets/tiles/` and
`public/assets/characters/*.png` (the Jephed pack) are untouched — swap
happens in `BootScene.ts`/`OverworldScene.ts` per the "floor"/"characters"
tasks, not here.

**Update (characters polish pass):** the 3 variants that sat unused
(`char_b_brick`, `char_d_hardhat`, `char_f_dark`) are no longer free —
they're loaded as `npc2_sheet`/`npc3_sheet`/`npc4_sheet` in `BootScene.ts`
and placed as purely decorative, non-interactive "ambient bystander" NPCs
in `OverworldScene.ts` (`addAmbientNpc`, called near the Chip Attendant's
benches, the market stall/Skin Attendant, and the exit-path lamp posts) —
social-hub flavor per direction note 4 below, matching the Chip Attendant's
own static staticSprite + `setScale(2)` idle-pose pattern. All 6 character
variants are now in use. Player/NPC/dealer scale (`applyPlayerScale`/
`applyPlayerBody` in `OverworldScene.ts`) was audited against the new
floor/furniture pass and left as-is — the Kenney rig's 2x scale and the
legacy 21x32 skin rig's native scale already land at the same ~32px
on-screen height, so nothing needed adjusting.

## Character sheet layout (read this before touching `createWalkAnims`)

**This does NOT match the current 21×32, "3 cols (frames) × 4 rows
(direction)" layout `BootScene.ts` assumes.** It's transposed and a
different frame size. Verified by visually inspecting the cropped sheets at
15x zoom (col1/col4 are a mirrored left/right pair; col2 is a symmetric
front-on face; col3 shows only the back of the head, no face) — please
still eyeball `character_sheet_all6.png` yourself before wiring up
animations, in case a variant differs:

- **Frame size:** 16×16 px (not 21×32)
- **Grid:** 4 columns × 3 rows per character (not 3 cols × 4 rows)
- **Columns = direction, rows = walk frame** (opposite axis from today):
  - col 0 → **left**
  - col 1 → **down** (front-facing, symmetric)
  - col 2 → **up** (back-facing, no face visible)
  - col 3 → **right** (mirror of col 0)
- **Rows 0, 1, 2** → the 3 frames of that direction's walk cycle

Because Phaser's `generateFrameNumbers` indexes a spritesheet row-major
(frame = row × columnsPerRow + col, columnsPerRow = 4 here), each
direction's 3 frames are **not contiguous** — they're spaced 4 apart. Don't
reuse the old `start=row*3, end=start+2` range logic. Use explicit frame
arrays instead, e.g.:

```ts
this.load.spritesheet("player_sheet", "assets/characters/kenney/char_a_green.png", {
  frameWidth: 16,
  frameHeight: 16
});
// ...
const DIRECTION_FRAMES: Record<string, number[]> = {
  left:  [0, 4, 8],
  down:  [1, 5, 9],
  up:    [2, 6, 10],
  right: [3, 7, 11]
};
for (const [dir, frames] of Object.entries(DIRECTION_FRAMES)) {
  this.anims.create({
    key: `${prefix}_walk_${dir}`,
    frames: frames.map(frame => ({ key: sheetKey, frame })),
    frameRate: 8,
    repeat: -1
  });
}
```

Since native frames are 16×16 vs. the old 21×32, expect characters to
render smaller on-screen unless you scale the sprites up (e.g.
`setScale(1.5)`–`2` depending how big you want them relative to the new
16×16 tiles) — tune to taste once it's on screen next to the new tileset.

## UI color palette

Sampled directly from the actual tile pixels (not eyeballed), so these are
real in-pack colors — a UI dev can use these as-is without guessing:

| Role | Hex | Where it comes from |
|---|---|---|
| **Primary** (brand / main buttons) | `#3BD2AB` | mint-teal park grass tiles |
| **Secondary** (headers / secondary panels) | `#59B6D8` | sky-blue pool/water tiles |
| **Accent** (CTAs, highlights, "hot" actions) | `#FF7143` | bright coral-orange trim tiles |
| **Accent-warm** (alt accent, gold-orange) | `#F5AA57` | warm gold-orange roof tiles |
| **Success / positive** | `#42DFAB` | bright green tree-foliage highlight |
| **Danger / warning** | `#C2504D` | brick-red roof tiles |
| **Background (page/world backdrop)** | `#FFF6E9` | warm cream (not sampled — chosen to complement; pairs with the sandy `#C6BC9F` plaza tone) |
| **Background-alt (secondary panel fill)** | `#EAF7FB` | pale sky blue (chosen to complement `#59B6D8`) |
| **Panel / card fill** | `#FDF3E1` | warm off-white (chosen to complement) |
| **Text — primary** | `#2B2340` | deep plum-navy (chosen for contrast; not from the tileset) |
| **Text — secondary / muted** | `#6B5B73` | muted mauve-gray (chosen for contrast) |
| Neutral sand (borders, dividers) | `#C6BC9F` | tan plaza tiles |
| Character skin tone (for reference/UI avatars) | `#FFC999` | character sprite skin tone |

The **background/text/panel rows are deliberately not sampled from the
tileset** — the pack itself has no flat "UI-safe" fill color, those five
tiles are all textured. They're chosen to sit comfortably alongside the
sampled colors (warm, light, high contrast with the deep plum text) rather
than fight them. Whoever reworks `Theme.ts` should treat the tile-sampled
rows as the fixed anchor points and feel free to nudge the chosen ones
(background/panel/text) for contrast/accessibility as the actual screens
come together — just keep them warm and light, not the current dark/neon
palette, since a dark UI reads "casino at night," not "sunny social hub."

## Direction notes — what actually reads as "Animal Jam vibe"

Concrete, not vibes-only:

1. **Saturated, not pastel.** Animal Jam's Jamaa Township is bright and a
   little candy-colored — grass reads as a clean mint-teal (`#3BD2AB`), not
   a muted olive green. Avoid desaturating anything from this pack; if you
   need variety, shift hue, don't wash out saturation.
2. **Thick, consistent dark outlines, no harsh drop shadows.** Every sprite
   in this pack is outlined in a warm dark brown/maroon (~`#5C2E22`-ish),
   never pure black, and there's no baked-in directional shadow — shading
   is just a darker/lighter version of the base hue. Keep any
   Phaser-drawn UI (buttons, panels) consistent with that: rounded corners,
   a visible outline stroke, flat fills with at most a soft inner
   highlight — not the sharp bevel/glow look of the current neon dark
   theme.
3. **Rounded everything.** Park paths use rounded corner tiles, buildings
   have soft roof edges, characters have big rounded heads with no sharp
   angles. Carry this into UI chrome too — pill buttons (already used per
   `uiHelpers.ts`'s `makeBetControl` etc.) are exactly the right shape
   language, just needs the palette/outline treatment above.
4. **Nature woven into a social hub, not wilderness.** This pack's "town"
   framing — plazas, benches, lamp posts, market stalls, fenced-in grass
   patches, trees planted in rows — mirrors Jamaa Township's own
   plaza-with-nature-dressing feel much more closely than a pure forest
   tileset would. Lean on the plaza/bench/lamp-post/fence pieces for the
   casino floor's "social" areas (entrance, gathering spots near the
   attendant), and grass/tree pieces as accent dressing around the edges —
   not as a wall-to-wall lawn replacing the whole indoor floor.
5. **Warm wood + cheerful roofs for structure, not chrome/neon.** Building
   pieces are terracotta/orange roofs over cream walls — use these
   qualities (terracotta `#DC8652`/`#C77B47`, cream `#C6BC9F`) for any
   "building-like" furniture (attendant booths, shop counters) instead of
   the current dark-metal cabinet look in `BootScene.ts`'s drawn
   placeholders.
6. **Characters: soft, chibi-proportioned, big heads, simple 2-tone
   outfits.** The included character variants are a good template —
   single flat shirt color, simple pants, no texture noise. If custom
   skins get drawn later (matching the existing 17-skin shop), keep that
   same 2-tone-flat-color simplicity rather than the more detailed look of
   the current Jephed-pack characters.
7. **Avoid, specifically:** dark backgrounds, neon/glow edges, chrome/metal
   surfaces, black outlines, desaturated "realistic" textures, and
   anything with sharp right-angle geometry — those all read as "casino at
   night" (the current theme), which is the opposite of what we want here.

## Scope note

This covers environment tiles, decorative/nature elements, and a
placeholder-swap-ready character base. It does **not** include: game-table
furniture redesigns (roulette/blackjack/slot machine art — the existing
Jephed-pack furniture doesn't have a direct equivalent in this pack; floor
should either keep that furniture as-is against the new backdrop for now,
or a follow-up task should source table/machine-specific art), or new skin
artwork for the 17-skin shop (existing skins can stay on the old character
rig until/unless someone wants to redraw them to match).

**Decision (confirmed with the user):** for this pass, leave the existing
casino table/machine art as-is rather than force a mismatched swap. See
"Future: casino furniture" below for ongoing sourcing toward a later pass.

## Future: casino furniture (task #26 — research only, not integrated)

Sourcing candidates for a **future** pass that reskins the actual gambling
furniture (tables, machines, cabinets) so it stops being a dark-casino
island inside the new bright plaza. Nothing below has been downloaded,
placed in `public/assets`, or wired into any scene — this is candidate
research only, same CC0-or-equal commercial-use bar as the pack chosen for
task #21. **Do not integrate any of these without checking in first** — per
the coordinator, only proceed to real integration work after explicit
sign-off if one of these turns out to be genuinely great.

### Strongest candidate: Kenney "Board Game Pack" (CC0)

- https://kenney.nl/assets/boardgame-pack (direct zip:
  `https://kenney.nl/media/pages/assets/boardgame-pack/a1656828d2-1677667644/kenney_boardgame-pack.zip`)
- License: CC0 1.0 Universal — same license, same artist, same family as
  the task #21 pick, which means **guaranteed palette/line-weight/scale
  compatibility**, not just "similar style." That's the standout advantage
  here over any other candidate below.
- Contents: 490 assets — dice (24, in 2 colors), playing cards (68, with
  multiple card-back styles), board-game pieces (399, in 7 colors/3
  styles), plus bonus board-game sound effects. Covers: dice, cards,
  generic game pieces (could stand in for chips/markers on a table).
  **Does not cover:** actual table/cabinet furniture, a roulette wheel, or
  a slot-machine cabinet — still a gap, see below.
- Not yet downloaded/inspected at the pixel level (unlike task #21's pack)
  — exact frame/tile dimensions still need confirming before any
  integration attempt.

### Secondary candidate: Screaming Brain Studios "2D Poker Pack" (CC0)

- https://screamingbrainstudios.itch.io/ (studio profile — CC0 is a
  studio-wide policy per their own statement: "every asset pack ... has
  been released under the CC0/Public Domain license, free to use in any
  project, commercial or non-commercial, modified or unmodified"), pack
  page referenced via https://opengameart.org/content/2d-poker-pack
- Contents: 200 poker chips across 10 color variants, 52 playing cards per
  suit + jokers, both isometric and top-down angle variants, deliberately
  flat/solid-fill so they're easy to recolor to the palette in this guide.
- Gap: chips + cards only, no tables/machines. Also a different artist
  than Kenney, so palette/line-weight would need a manual match-up (their
  flat-fill style makes that plausible, just not automatic).

### Existing pack, revisit angle: Jephed / Game Between The Lines "2D Top-Down Pixel Art Tileset: Casino"

- This is the **same pack already partially used** in this project (see
  README "Art credits" — floor/wall/roulette table/slot machine/blackjack
  table/plant already come from it).
- https://gamebetweenthelines.itch.io/2d-top-down-pixel-art-tileset-casino
  — confirmed free for commercial and non-commercial use, attribution
  requested but not mandatory (matches what's already credited in
  README). 1,226 tiles total, 16×16 base tile size — **same grid scale as
  the Kenney pack**, confirmed directly against this repo's own files
  (`floor_tan.png`/`wall.png`/`carpet_*.png` are already exactly 16×16;
  `slot_machine.png`/`plant.png`/`dragon_pedestal.png` are 48×64 = 3×4
  tiles; `roulette_table.png` is 112×64 = 7×4 tiles).
- Worth checking before sourcing something new entirely: this project
  only pulled a subset of the full 1,226-tile pack. It's possible the
  full pack has lighter/brighter variant tiles not yet extracted, or —
  more likely — the existing dark furniture could be **recolored** (same
  shapes, shifted palette) rather than replaced, since the license already
  permits modification and it's already cleared/credited in this repo.
  Recoloring wasn't attempted here (out of scope for research-only), but
  it's a real option worth weighing against sourcing a brand-new pack.

### Rejected candidate: OpenGameArt "Casino Pack" (1001.com)

- https://opengameart.org/content/casino-pack — licensed **CC-BY-SA 3.0**,
  not CC0: requires attribution to 1001.com and share-alike on
  derivatives. Doesn't clear the same bar as the CC0 picks above, so not
  shortlisted, but noting it here so it isn't re-discovered and
  re-evaluated from scratch later.

### Borderline candidate: "Casino Night" SMS pack by chasersgaming

- https://chasersgaming.itch.io/asset-pack-casino-night-sms — CC0, public
  domain per the creator's own comment on the page ("the license for this
  asset is CC0, public domain").
- Free tier contents: full card deck (4 suits + jokers), a poker/
  blackjack table, chips, dice, an animated male dealer — i.e. it directly
  covers most of the actual furniture gap. Paid tier (name-your-price,
  ~£2 suggested) adds craps/roulette/baccarat tables, a female dealer.
  Everything in the free tier is enough for a first pass without paying.
- Caveat: deliberately built to the **Sega Master System 8-bit color
  palette** — a hard technical constraint (very limited simultaneous
  colors), so it reads as chunky retro-console pixel art. That's a
  meaningfully different look from both the existing Jephed casino art
  and the new Kenney pack's smoother pastel style; it would likely need
  real palette/style rework rather than a drop-in swap.

### Open gap

**No bright, CC0-or-equal, Kenney-palette-compatible slot-machine-cabinet
or roulette-wheel sprite has turned up yet.** Cards, chips, dice, and
generic tables all have at least one solid CC0 candidate above; a
proper cabinet-style slot machine and a spinning roulette wheel in a
matching bright/rounded style are the two pieces still worth actively
searching for in a follow-up pass.

## Furniture reskin (this gap, closed)

The "open gap" above never got a bright CC0 slot-machine/roulette-wheel
sprite pack, and the Kenney RPG Urban Pack itself is a town/plaza kit with
no table/cabinet equivalents either (per the scope note above). Rather than
keep waiting on a source pack, the gambling furniture went the other
route already established for the rest of the drawn UI: **procedural
`Phaser.Graphics` + `generateTexture()`**, same technique as the existing
game-cabinet placeholders in `BootScene.ts` (`createMinesTexture`,
`createDiceTexture`, etc.) - drawn flat/rounded/outlined to this doc's own
palette table and direction notes instead of imported pixel art. Also
brought the floor/wall/carpet ground tiles onto the palette in the same
pass, so the whole floor - ground plus furniture - now reads as one
consistent world instead of a bright plaza with a dark-casino island in
the middle of it.

### Ground tiles - `BootScene.ts` `preload()`

`floor_tan`/`carpet_red`/`carpet_blue`/`wall` moved off the old Jephed pack
onto four more pre-cut tiles from the same `kenney_rpg_urban_pack` already
in use for `bench_prop`/`lamp_post`/`market_stall`/`hedge`/`tree_accent`
(picked by eye against `Tilemap/tilemap_packed.png` and cross-checked
against individual `Tiles/tile_NNNN.png` crops, same method the "Where the
files landed" section above describes). All four are native 16x16, same as
the tiles they replace, so `OverworldScene.buildFloor()`/`buildWalls()`
needed no changes beyond the art living under each texture key:

| Key | Tile | Why |
|---|---|---|
| `floor_tan` | `tile_0109` | plain cream/tan plaza floor, subtle brick texture, no border artifacts to tile |
| `carpet_red` | `tile_0018` | warm red brick fill for the gaming-floor "rug" area (keeps the "red" in the key name literal) |
| `carpet_blue` | `tile_0036` | cool gray-blue flagstone, used as the existing 1-in-5-tile accent inside the rug |
| `wall` | `tile_0182` | terracotta brick - direction note 5's "warm terracotta ... for building-like pieces" applied to the perimeter walls |

### Drawn furniture - `BootScene.ts` `create()`

A shared `PALETTE` constant (module scope, top of `BootScene.ts`) maps this
doc's hex table plus the `#5C2E22`-ish warm-brown outline from direction
note 2 onto named fields (`outline`, `cabinet`, `cabinetDark`, `screen`,
`screenAlt`, `felt`, `mint`, `mintBright`, `sky`, `coral`, `gold`,
`danger`, `cream`) so every drawn texture pulls from one place instead of
repeating hex literals. Two small helpers, `drawCabinetBody`/
`drawCabinetBase`, factor out the rounded terracotta body + warm-brown
outline + base bar shared by the 48x64 "arcade cabinet" style textures.

- **Game-table furniture** (previously raw Jephed PNGs, now drawn,
  original footprints kept exactly so `OverworldScene`'s
  `sizeFracW/H`/`offsetFracX/Y` collision-box math and verified station
  spacing needed no changes): `roulette_table` (112x64 - terracotta rail,
  felt inset, a segmented wheel, betting-grid hints), `slot_machine`
  (48x64 - cream screen, three circular "reel" symbols, a gold lever),
  `blackjack_table` (96x112 - fanned mini cards over felt, a chip stack),
  `coinflip_machine` (49x64 - a big gold coin on a cream screen),
  `dragon_pedestal` (48x64 - a terracotta column topped with ascending
  mint/gold/coral "tower level" blocks and a gold finial gem).
- **Existing drawn cabinet games** (`mines_machine`, `dice_table`,
  `limbo_machine`, `plinko_board`, `keno_machine`, `wheel_machine`,
  `hilo_table`, `baccarat_table`, `video_poker_machine`,
  `coming_soon_sign`, `exit_door`) - same shapes/layouts as before, palette
  swapped off the old dark-navy/near-black cabinet colors onto `PALETTE`
  (saturated mint/coral/gold/danger accents on a terracotta body with a
  cream or pale-sky-blue screen, never pure black).
- **`plant`** (48x64, `OverworldScene.buildDecorations()`) - also moved off
  the old Jephed PNG onto a drawn terracotta pot with rounded mint-teal
  foliage clumps, same footprint so its placement/origin needed no scene
  changes.

Verified by rendering every texture key through the live Phaser texture
manager (`__game.textures.get(key).getSourceImage()`) rather than by eye
on the source only - caught and fixed one real bug this way (the dragon
pedestal's upper two tower-level blocks were being pushed off the top of
the 64px canvas by a stacking-math error; now fixed coordinates keep the
whole stack on-canvas).
