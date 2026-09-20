import { requestedArcadeGame } from './catalog';

export function embeddedGame() {
  return window.parent !== window ? requestedArcadeGame(window.location.search) : undefined;
}
export function notifyLounge(type: 'gc-game-ready' | 'gc-game-exit') {
  if (embeddedGame()) window.parent.postMessage({ type }, window.location.origin);
}
