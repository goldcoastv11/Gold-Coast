# Audio Guide

User direction: "Add sounds to the arcade floor, item shop, coin kiosk, and
games." Same asset-sourcing bar as `STYLE_GUIDE.md`'s visual packs: CC0
only, no attribution/share-alike/non-commercial catches, since this game
sells GC packages (see `CLAUDE.md`).

## Chosen packs

Both by **Kenney** (www.kenney.nl), same artist/family already used for the
visual "RPG Urban Pack" (`STYLE_GUIDE.md`), so there's no new
license-compliance surface to track — same CC0 terms, same donation-not-
mandatory attribution note.

### 1. Casino Audio (1.1)

- Source: https://kenney.nl/assets/casino-audio
  (direct zip: `https://kenney.nl/media/pages/assets/casino-audio/2472606a04-1721639069/kenney_casino-audio.zip`,
  ~856 KB)
- 54 files: card sounds (fan, place, shove, shuffle, slide, pack open/take
  out), chip sounds (lay, collide, handle, stack), dice/die sounds (grab,
  shake, throw).
- Used for game-specific flavor: card deals (Blackjack/Video
  Poker/Baccarat/Hi-Lo), the Coin Kiosk's chip-lay claim result, Dice's
  roll.

### 2. Interface Sounds (1.0)

- Source: https://kenney.nl/assets/interface-sounds
  (direct zip: `https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip`,
  ~815 KB)
- 100 files: back, bong, click, close, confirmation, drop, error, glass,
  glitch, maximize, minimize, open, pluck, question, scratch, scroll,
  select, switch, tick, toggle.
- Used for generic UI: every button click (via `uiHelpers.ts`'s
  `makeButton`), floor-station interaction (walking up + pressing E), panel
  open (Item Shop / Coin Kiosk), win confirmation (pairs with
  `WinCelebration.ts`), and errors (insufficient balance / failed
  requests).

### License (verbatim, from each pack's own `License.txt`)

```
	Casino Audio (1.1)
	by  Kenney Vleugels (Kenney.nl)
	------------------------------
	License (Creative Commons Zero, CC0)
	http://creativecommons.org/publicdomain/zero/1.0/
	You may use these assets in personal and commercial projects.
	Credit (Kenney or www.kenney.nl) would be nice but is not mandatory.
```

```
	Interface Sounds (1.0)
	Created/distributed by Kenney (www.kenney.nl)
	Creation date: 11-02-2020
	------------------------------
	License: (Creative Commons Zero, CC0)
	http://creativecommons.org/publicdomain/zero/1.0/
	This content is free to use in personal, educational and commercial projects.
	Support us by crediting Kenney or www.kenney.nl (this is not mandatory)
```

## Where the files landed

```
casino-poc/public/assets/kenney_casino_audio/      <- as downloaded, unmodified
  License.txt
  Audio/*.ogg                                        <- 54 files, kebab-case names (card-slide-3.ogg, etc.)

casino-poc/public/assets/kenney_interface_sounds/   <- as downloaded, unmodified
  License.txt
  Audio/*.ogg                                        <- 100 files, snake_case names (confirmation_002.ogg, etc.)
```

Only a curated subset of the 154 available files is actually wired up (see
`src/ui/SoundManager.ts`'s `SOUND_ASSETS` map) — the rest of each pack is
landed but unused, left in place for future sound work rather than
cherry-picked out, same "keep the pack intact" approach `STYLE_GUIDE.md`
takes with the visual tileset.

## How it's wired (`src/ui/SoundManager.ts`)

Same "load once in `BootScene.preload()`, play by key from any scene"
pattern this project already uses for every image/spritesheet — Phaser's
sound cache is shared game-wide, not per-scene, so no scene needs its own
`load.audio()` call. `preloadSounds(scene)` queues every key in
`SOUND_ASSETS`; `playSfx(scene, key)` plays one, and never throws (a
missing/not-yet-decoded sound should never break gameplay over an SFX).

| Key | File | Where it fires |
|---|---|---|
| `click` | `kenney_interface_sounds/.../click_003.ogg` | Every button press — `uiHelpers.ts`'s `makeButton`, so this alone covers every Bet/Cash Out/Walk Away/+/-/½/2x button in all 14 games, plus every Item Shop/Coin Kiosk/floor-panel button. |
| `select` | `.../select_004.ogg` | Walking up to any floor station and pressing E (`OverworldScene.handleInteraction`) — covers "the arcade floor" itself. |
| `open` | `.../open_002.ogg` | The Item Shop and Coin Kiosk panels opening. |
| `confirm` | `.../confirmation_002.ogg` | A real win in any of the 14 games (`WinCelebration.ts`, paired with the gold-flash celebration), and a confirmed Item Shop purchase. |
| `error` | `.../error_003.ogg` | A failed Item Shop purchase (insufficient TICKETS, etc.). |
| `chipLay` | `kenney_casino_audio/.../chip-lay-2.ogg` | The Coin Kiosk's claim result panel. |
| `cardSlide` | `.../card-slide-3.ogg` | Dealing a hand — Blackjack, Video Poker, Baccarat, Hi-Lo. |
| `diceThrow` | `.../dice-throw-2.ogg` | Dice's roll. |

## Scope note

This covers the four surfaces asked for (floor, Item Shop, Coin Kiosk,
games) via a small set of high-leverage central hooks (button clicks, floor
interaction, wins) plus a light dusting of per-game flavor (cards/dice) on
the games where it reads most naturally. It does **not** cover: a
loss/insufficient-balance sound in every one of the 14 games individually
(only the Item Shop's purchase-failure path uses `error` today), background
music, or footstep sounds while walking — no good CC0 footstep pack
matching this project's floor was found during sourcing (see the earlier
proposal in chat); worth a follow-up if wanted.
