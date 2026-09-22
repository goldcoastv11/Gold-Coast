export type ResultTone = 'win' | 'loss' | 'push';
export function resultTone(result: string | null): ResultTone | null {
  if (result === 'You win' || result === 'Blackjack!') return 'win';
  if (result === 'Dealer wins' || result === 'Bust') return 'loss';
  return result === 'Push' ? 'push' : null;
}
type Round = { key: string; phase: string; revision: number; result: string | null };
/** Polling must never replay a result cue, nor celebrate an old hand on entry. */
export class ResultTracker {
  private last: Round | null = null;
  private armed = false;
  arm() { this.armed = true; }
  cancel() { this.armed = false; }
  observe(round: Round): ResultTone | null {
    const previous = this.last;
    this.last = round;
    const changed = !previous || previous.key !== round.key || previous.revision !== round.revision;
    const watchedHand = previous?.key === round.key && previous.phase === 'playing';
    if (round.phase === 'resolved' && changed && (watchedHand || this.armed)) {
      this.armed = false;
      return resultTone(round.result);
    }
    if (previous?.key !== round.key && !this.armed) this.armed = false;
    return null;
  }
}

export class TableAudio {
  private context: AudioContext | null = null;
  muted = false;
  constructor() { try { this.muted = localStorage.getItem('gc-table-muted') === '1'; } catch { /* optional */ } }
  unlock() {
    if (this.muted) return;
    try { this.context ??= new AudioContext(); if (this.context.state === 'suspended') void this.context.resume().catch(() => {}); } catch { /* Visual feedback always works without audio. */ }
  }
  toggle() {
    this.muted = !this.muted;
    try { localStorage.setItem('gc-table-muted', this.muted ? '1' : '0'); } catch { /* optional */ }
    if (this.muted) void this.context?.suspend().catch(() => {}); else this.unlock();
  }
  play(tone: ResultTone) {
    const ctx = this.context;
    if (this.muted || !ctx || ctx.state !== 'running') return;
    const notes = tone === 'win' ? [523.25, 659.25, 783.99, 1046.5] : tone === 'loss' ? [220, 164.81] : [440, 440];
    notes.forEach((frequency, index) => {
      const start = ctx.currentTime + index * .115, oscillator = ctx.createOscillator(), gain = ctx.createGain();
      oscillator.type = tone === 'loss' ? 'sine' : 'triangle'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.07, start + .015); gain.gain.exponentialRampToValueAtTime(.001, start + .32);
      oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(start); oscillator.stop(start + .34);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  }
}
