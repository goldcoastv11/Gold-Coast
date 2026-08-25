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
  diceThrow: "assets/kenney_casino_audio/Audio/dice-throw-2.ogg" // Dice's roll
} as const;

export type SoundKey = keyof typeof SOUND_ASSETS;

/** Call once, from BootScene.preload() - queues every sound above for load. */
export function preloadSounds(scene: Phaser.Scene): void {
  for (const [key, path] of Object.entries(SOUND_ASSETS)) {
    scene.load.audio(key, path);
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
