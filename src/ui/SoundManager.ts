import Phaser from "phaser";

/**
 * Central sound-effect registry. Every key here is preloaded exactly once,
 * by `preloadSounds(this)` in BootScene.preload() (same "load once in
 * BootScene, use the key from any later scene" pattern this project
 * already uses for every image/spritesheet - Phaser's sound cache is
 * shared game-wide, not per-scene, so this doesn't need re-loading
 * anywhere else). Any scene can then just call `playSfx(this, "click")`
 * with no load boilerplate of its own.
 *
 * Assets are unmodified files from two Kenney CC0 packs - see
 * AUDIO_GUIDE.md for the full source/license/attribution, same
 * documentation pattern STYLE_GUIDE.md already uses for the visual packs.
 */
export const SOUND_ASSETS = {
  // --- Interface Sounds pack: generic UI, used everywhere ---
  click: "assets/kenney_interface_sounds/Audio/click_003.ogg", // every button press (see uiHelpers.ts's makeButton)
  select: "assets/kenney_interface_sounds/Audio/select_004.ogg", // walking up to a floor station and pressing E
  open: "assets/kenney_interface_sounds/Audio/open_002.ogg", // a panel/modal opening (Item Shop, Coin Kiosk)
  confirm: "assets/kenney_interface_sounds/Audio/confirmation_002.ogg", // a real win (see WinCelebration.ts), or a confirmed purchase
  error: "assets/kenney_interface_sounds/Audio/error_003.ogg", // insufficient balance / a failed request
  lose: "assets/kenney_interface_sounds/Audio/error_005.ogg", // a game round resolving as a loss - a different file from `error` so it doesn't sound identical to a real error toast

  // --- Casino Audio pack: game-specific flavor, layered on top of the above ---
  chipLay: "assets/kenney_casino_audio/Audio/chip-lay-2.ogg", // Coin Kiosk shuffle-cup claim result
  cardSlide: "assets/kenney_casino_audio/Audio/card-slide-3.ogg", // dealing/drawing a card (Blackjack, Video Poker, Baccarat, Hi-Lo)
  diceThrow: "assets/kenney_casino_audio/Audio/dice-throw-2.ogg", // Dice's roll

  // --- Richer per-game flavor (sound pass #2) - all pulled from files that
  // were already on disk in the two packs above but never wired up (see
  // AUDIO_GUIDE.md's "curated subset" note); no new downloads needed for any
  // of these ---
  reelSpin: "assets/kenney_interface_sounds/Audio/switch_003.ogg", // a spin/roll starting - Slots reels, Wheel, Roulette
  reelStop: "assets/kenney_interface_sounds/Audio/tick_002.ogg", // a spin/roll landing - Slots reels, Wheel, Roulette
  chipBet: "assets/kenney_casino_audio/Audio/chips-handle-2.ogg", // a bet physically "placed" - Roulette's spin start
  ballDrop: "assets/kenney_interface_sounds/Audio/drop_002.ogg", // Plinko's ball release, Roulette's ball drop
  cardShuffle: "assets/kenney_casino_audio/Audio/card-shuffle.ogg", // shuffle-before-slide flavor layered on every card game's deal (Blackjack/Baccarat/Video Poker/Hi-Lo)
  reveal: "assets/kenney_interface_sounds/Audio/pluck_001.ogg", // a safe/good pick - Mines' gem tile, Dragon Tower's climb, Keno's per-number hit
  bust: "assets/kenney_interface_sounds/Audio/glitch_002.ogg", // a bad pick - Mines' mine tile, Dragon Tower's fall (layered with `lose`)
  bigWin: "assets/kenney_interface_sounds/Audio/bong_001.ogg" // a big payout - layered with `confirm` in WinCelebration.ts for a jackpot-feel accent
} as const;

export type SoundKey = keyof typeof SOUND_ASSETS;

/**
 * Background music loops - Kenney's "Music Loops" pack (v1.1, 2015), same
 * CC0 1.0 license as the two SFX packs above (see AUDIO_GUIDE.md for the
 * full source note - this pack predates Kenney's current site catalog, so it
 * was pulled from a long-standing public mirror of the same CC0 files
 * rather than kenney.nl directly). 24 tracks landed under
 * public/assets/kenney_music_loops/{Loops,Retro}/; only a curated 15 are
 * wired here (1 lobby + 1 per game), same "land the pack, wire a subset"
 * convention as the SFX packs - the rest are left in place for future use.
 */
export const MUSIC_ASSETS = {
  alphaDance: "assets/kenney_music_loops/Loops/alpha-dance.ogg", // Overworld (lobby)
  wackyWaiting: "assets/kenney_music_loops/Loops/wacky-waiting.ogg", // Slots
  polkaTrain: "assets/kenney_music_loops/Loops/polka-train.ogg", // Roulette
  missionPlausible: "assets/kenney_music_loops/Loops/mission-plausible.ogg", // Blackjack
  italianMom: "assets/kenney_music_loops/Loops/italian-mom.ogg", // Baccarat
  swingingPants: "assets/kenney_music_loops/Loops/swinging-pants.ogg", // Video Poker
  infiniteDescent: "assets/kenney_music_loops/Loops/infinite-descent.ogg", // Hi-Lo
  drummingSticks: "assets/kenney_music_loops/Loops/drumming-sticks.ogg", // Dice
  cheerfulAnnoyance: "assets/kenney_music_loops/Loops/cheerful-annoyance.ogg", // Coin Flip
  sadDescent: "assets/kenney_music_loops/Loops/sad-descent.ogg", // Limbo
  retroMystic: "assets/kenney_music_loops/Retro/retro-mystic.ogg", // Mines
  flowingRocks: "assets/kenney_music_loops/Loops/flowing-rocks.ogg", // Plinko
  retroBeat: "assets/kenney_music_loops/Retro/retro-beat.ogg", // Dragon Tower
  retroPolka: "assets/kenney_music_loops/Retro/retro-polka.ogg", // Wheel
  germanVirtue: "assets/kenney_music_loops/Loops/german-virtue.ogg" // Keno
} as const;

export type MusicKey = keyof typeof MUSIC_ASSETS;

/** Call once, from BootScene.preload() - queues every sound above for load. */
export function preloadSounds(scene: Phaser.Scene): void {
  for (const [key, path] of Object.entries(SOUND_ASSETS)) {
    scene.load.audio(key, path);
  }
}

/** Call once, from BootScene.preload() - queues every music loop above for load. */
export function preloadMusic(scene: Phaser.Scene): void {
  for (const [key, path] of Object.entries(MUSIC_ASSETS)) {
    scene.load.audio(key, path);
  }
}

// Module-scope (not per-scene) - Phaser's sound manager is shared game-wide
// (same "one cache, keyed by string, played from any scene" model the doc
// comment above already relies on for SFX), so "what music is currently
// playing" needs to live at that same game-wide scope too. Every scene's
// create() just calls playMusic(this, itsOwnKey) unconditionally - this
// tracks whether that's actually a change (vs. e.g. a scene racing its own
// re-create) and no-ops if not, so no caller needs its own "is this already
// playing" guard.
let currentMusic: Phaser.Sound.BaseSound | undefined;
let currentMusicKey: MusicKey | undefined;

const MUSIC_VOLUME = 0.22; // well under SFX's ~0.45 default - this loops continuously under everything else, SFX should always read over it
const MUSIC_FADE_MS = 400;

/**
 * Crossfades from whatever music loop is currently playing (if any) to
 * `key`, looped. Safe to call every time a scene's create() runs - a no-op
 * if `key` is already the current track (e.g. re-entering the same game).
 * Never throws, same fire-and-forget contract as playSfx - a missing/
 * not-yet-decoded track should never break scene load.
 */
export function playMusic(scene: Phaser.Scene, key: MusicKey): void {
  try {
    if (currentMusicKey === key && currentMusic?.isPlaying) return;

    const previous = currentMusic;
    if (previous) {
      scene.tweens.add({
        targets: previous,
        volume: 0,
        duration: MUSIC_FADE_MS,
        onComplete: () => previous.stop()
      });
    }

    const next = scene.sound.add(key, { loop: true, volume: 0 });
    next.play();
    scene.tweens.add({ targets: next, volume: MUSIC_VOLUME, duration: MUSIC_FADE_MS });

    currentMusic = next;
    currentMusicKey = key;
  } catch {
    // Best-effort - see doc comment above.
  }
}

/** Fades out and stops whatever music is currently playing, if any - e.g. before a modal/panel that should play in silence. */
export function stopMusic(scene: Phaser.Scene): void {
  try {
    const previous = currentMusic;
    if (!previous) return;
    scene.tweens.add({
      targets: previous,
      volume: 0,
      duration: MUSIC_FADE_MS,
      onComplete: () => previous.stop()
    });
    currentMusic = undefined;
    currentMusicKey = undefined;
  } catch {
    // Best-effort - see doc comment above.
  }
}

/**
 * Plays a preloaded sound effect. Fire-and-forget, and deliberately never
 * throws - a missing/not-yet-decoded sound (e.g. a scene racing BootScene
 * in dev/hot-reload) should never break gameplay over a sound effect, so
 * this swallows Phaser sound-manager errors rather than propagating them.
 */
export function playSfx(scene: Phaser.Scene, key: SoundKey, config?: Phaser.Types.Sound.SoundConfig): void {
  try {
    scene.sound.play(key, { volume: 0.45, ...config });
  } catch {
    // Best-effort - see doc comment above.
  }
}
