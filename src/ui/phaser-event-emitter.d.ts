/**
 * Ambient type for Phaser's internal EventEmitter module, imported directly
 * (not via the "phaser" package root - see LayeredCharacter.test.ts's
 * comment on why) so this test can exercise the real registration-order
 * primitive without pulling in Phaser's device detection, which throws
 * under plain Node.
 */
declare module "phaser/src/events/EventEmitter.js" {
  export default class EventEmitter {
    on(event: string, fn: (...args: unknown[]) => void, context?: unknown): this;
    once(event: string, fn: (...args: unknown[]) => void, context?: unknown): this;
    off(event: string, fn?: (...args: unknown[]) => void, context?: unknown): this;
    emit(event: string, ...args: unknown[]): boolean;
  }
}
