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

**Update (sound pass #2 — background music + richer per-game SFX):** the
two gaps called out above ("background music" and "a loss sound in every
game individually") are now closed — see the two sections below. Every
game beyond the loss-sound gap now also has at least one extra flavor cue
beyond click/confirm/lose.

## Background music (`MUSIC_ASSETS` in `src/ui/SoundManager.ts`)

A third pack, **Kenney's "Music Loops"** (v1.1, 2015-07-31), same CC0 1.0
license and same artist as the two packs above. Unlike Casino Audio/
Interface Sounds, this pack predates Kenney's current kenney.nl catalog (it
isn't in the site's live asset nav any more as of 2026) — it was pulled
from `gamesounds.xyz`, a long-standing public mirror of Kenney's CC0
catalog, rather than a kenney.nl direct-zip link. Same license either way;
see `public/assets/kenney_music_loops/License.txt` for the verbatim text.

24 tracks landed (19 in `Loops/`, 5 in `Retro/`, ~5.2MB total) — short
(15-30s), jaunty/lighthearted loops, matching the "Arcade Nights" upbeat
vibe. 15 are wired up (1 lobby + 1 per game, picked by name/mood where a
track's title suggested a fit — e.g. `sad-descent` for Limbo's "how low can
you go" multiplier, `infinite-descent` for Hi-Lo); the other 9
(`farm-frolics`, `game-over`, `night-at-the-beach`, `sad-town`,
`space-cadet`, `time-driving`, `retro-comedy`, `retro-reggae`) are landed
but unused, same "keep the pack intact" convention as the SFX packs.

| Scene | Track |
|---|---|
| Overworld (lobby) | `alpha-dance` |
| Slots | `wacky-waiting` |
| Roulette | `polka-train` |
| Blackjack | `mission-plausible` |
| Baccarat | `italian-mom` |
| Video Poker | `swinging-pants` |
| Hi-Lo | `infinite-descent` |
| Dice | `drumming-sticks` |
| Coin Flip | `cheerful-annoyance` |
| Limbo | `sad-descent` |
| Mines | `retro-mystic` |
| Plinko | `flowing-rocks` |
| Dragon Tower | `retro-beat` |
| Wheel | `retro-polka` |
| Keno | `german-virtue` |

`playMusic(scene, key)` crossfades (400ms) from whatever's currently
playing to the new track, looped, at a fixed low volume (0.22, well under
SFX's ~0.45) so it never competes with click/win/lose cues. Every scene
that has one calls it once, unconditionally, at the top of its own
`create()` (right after `fadeInOnCreate(this)`) — it's a no-op if that
track is already playing, so no scene needs its own "is this already
running" guard. Because every Overworld <-> game transition goes through a
fresh `scene.start()` (never sleep/wake — see `sceneTransition.ts`'s doc
comment), the next scene's own `create()` is always what swaps the track;
nothing needs an explicit stop on the way out. `stopMusic(scene)` exists
for the rarer case of wanting silence (e.g. a future modal) but nothing
calls it today.

## Richer per-game SFX (sound pass #2)

All eight of these reuse files that were already sitting unused on disk in
the two existing packs (see "Where the files landed" above) — no new
downloads needed for any of it:

| Key | File | Where it fires |
|---|---|---|
| `reelSpin` | `kenney_interface_sounds/.../switch_003.ogg` | A spin/roll starting — Slots' reels, Wheel, Roulette |
| `reelStop` | `.../tick_002.ogg` | A spin/roll landing — Slots' reels, Wheel, Roulette |
| `chipBet` | `kenney_casino_audio/.../chips-handle-2.ogg` | Roulette's spin start (a bet physically "placed") |
| `ballDrop` | `kenney_interface_sounds/.../drop_002.ogg` | Plinko's ball release, Roulette's ball drop |
| `cardShuffle` | `kenney_casino_audio/.../card-shuffle.ogg` | Layered before `cardSlide` on every card game's deal (Blackjack/Baccarat/Video Poker/Hi-Lo) |
| `reveal` | `kenney_interface_sounds/.../pluck_001.ogg` | A safe/good pick — Mines' gem tile, Dragon Tower's climb, Keno's per-number hit |
| `bust` | `.../glitch_002.ogg` | A bad pick — Mines' mine tile, Dragon Tower's fall — layered with the existing `lose` |
| `bigWin` | `.../bong_001.ogg` | `WinCelebration.ts` layers this on top of `confirm` for any payout >= 500 TICKETS — a jackpot-feel accent, benefits all 14 games automatically since they all route through `showWinCelebration` |
