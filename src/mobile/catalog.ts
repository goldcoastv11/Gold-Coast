import { BLACKJACK_TABLES } from '../../server/src/multiplayer/room';

export const GAMES = [
  { id: 'blackjack', name: 'Blackjack', scene: 'BlackjackScene', icon: '♠', description: 'Take a seat against the dealer', category: 'Cards' },
  { id: 'roulette', name: 'Roulette', scene: 'RouletteScene', icon: '◉', description: 'Pick your color and spin the wheel', category: 'Tables' },
  { id: 'baccarat', name: 'Baccarat', scene: 'BaccaratScene', icon: '♦', description: 'Player, banker, or a tie', category: 'Cards' },
  { id: 'slots', name: 'Slots', scene: 'SlotsScene', icon: '777', description: 'Spin the reels', category: 'Arcade' },
  { id: 'coinflip', name: 'Coin Flip', scene: 'CoinFlipScene', icon: '◐', description: 'Heads or tails?', category: 'Arcade' },
  { id: 'dragontower', name: 'Dragon Tower', scene: 'DragonTowerScene', icon: '♜', description: 'Climb the tower one tile at a time', category: 'Arcade' },
  { id: 'mines', name: 'Mines', scene: 'MinesScene', icon: '✦', description: 'Find gems and avoid the mines', category: 'Arcade' },
  { id: 'dice', name: 'Dice', scene: 'DiceScene', icon: '⚄', description: 'Choose a target and roll', category: 'Arcade' },
  { id: 'limbo', name: 'Limbo', scene: 'LimboScene', icon: '↗', description: 'Choose your target multiplier', category: 'Arcade' },
  { id: 'plinko', name: 'Plinko', scene: 'PlinkoScene', icon: '⋮', description: 'Drop a ball through the pegs', category: 'Arcade' },
  { id: 'keno', name: 'Keno', scene: 'KenoScene', icon: '#', description: 'Pick numbers and watch the draw', category: 'Arcade' },
  { id: 'wheel', name: 'Wheel', scene: 'WheelScene', icon: '☸', description: 'Give the prize wheel a spin', category: 'Arcade' },
  { id: 'hilo', name: 'Hi-Lo', scene: 'HiLoScene', icon: '↕', description: 'Will the next card be higher or lower?', category: 'Cards' },
  { id: 'videopoker', name: 'Video Poker', scene: 'VideoPokerScene', icon: '♥', description: 'Hold your cards and draw a hand', category: 'Cards' },
] as const;
export type GameId = typeof GAMES[number]['id'];
export type Station = { id: string; name: string; game: GameId; x: number; z: number; color: string };
export const STATIONS: Station[] = [
  ...BLACKJACK_TABLES.map(t => ({ ...t, game: 'blackjack' as const, color: '#1f706d' })),
  { id: 'roulette', name: 'Sunset Roulette', game: 'roulette', x: -7, z: 5, color: '#773943' },
  { id: 'baccarat', name: 'Pearl Baccarat', game: 'baccarat', x: 0, z: 6, color: '#514675' },
  { id: 'slots', name: 'Golden Slots', game: 'slots', x: 7, z: 5, color: '#997333' },
  ...GAMES.filter(g => !['blackjack', 'roulette', 'baccarat', 'slots'].includes(g.id)).map((g, i) => {
    const positions = [[-15,-2],[15,-2],[-15,5],[15,5],[-14,13],[-7,13],[0,13],[7,13],[14,13],[0,20]];
    return { id: g.id, name: g.name, game: g.id, x: positions[i][0], z: positions[i][1], color: '#225660' };
  }),
];
export function gameLaunchUrl(id: GameId, quick: boolean) {
  return `/index.html?mobileGame=1&game=${id}&view=${quick ? 'quickplay' : 'lounge'}`;
}
export function nearestStation(x: number, z: number) {
  return STATIONS.filter(t => Math.hypot(t.x - x, t.z - z) <= 3.5).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
}
export function requestedArcadeGame(search: string) {
  const params = new URLSearchParams(search);
  return params.get('mobileGame') === '1' ? GAMES.find(g => g.id === params.get('game')) : undefined;
}
