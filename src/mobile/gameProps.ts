import * as T from 'three';
import type { GameId } from './catalog';

/** Decorative station equipment; game results always come from the game engine. */
export function addGameProps(parent: T.Group, game: GameId) {
  const gold = new T.MeshStandardMaterial({ color: '#c69d58', metalness: .65, roughness: .35 });
  const dark = new T.MeshStandardMaterial({ color: '#10242e', roughness: .5 });
  const white = new T.MeshStandardMaterial({ color: '#f1e8d2', roughness: .7 });
  const red = new T.MeshStandardMaterial({ color: '#a62e45', roughness: .65 });
  const gem = new T.MeshStandardMaterial({ color: '#5be5c2', metalness: .3, roughness: .2, emissive: '#124e43', emissiveIntensity: .4 });
  const add = (geometry: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number) => {
    const mesh = new T.Mesh(geometry, mat); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  };
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, mat = dark) => add(new T.BoxGeometry(w, h, d), mat, x, y, z);
  const text = (value: string, x: number, y: number, z: number, w: number, h: number, bg = '#10242e') => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#d8b477'; ctx.lineWidth = 8; ctx.strokeRect(12, 12, 488, 232);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 76px Georgia'; ctx.fillStyle = '#f9e2b0'; ctx.fillText(value, 256, 128);
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
    return add(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: texture }), x, y, z);
  };
  if (game === 'roulette' || game === 'wheel') {
    const wheel = new T.Group(); wheel.position.set(-1.05, 1.23, -.1); parent.add(wheel);
    const horizontal = game === 'roulette'; if (horizontal) wheel.rotation.x = -Math.PI / 2; else wheel.position.y = 1.95;
    const disc = new T.Mesh(new T.CircleGeometry(.75, 64), dark); wheel.add(disc);
    const count = horizontal ? 37 : 16;
    for (let i = 0; i < count; i++) {
      const wedge = new T.Mesh(new T.RingGeometry(.36, .68, 3, 1, i / count * Math.PI * 2, Math.PI * 2 / count - .018), i === 0 ? gem : i % 2 ? red : dark);
      wedge.position.z = .01; wheel.add(wedge);
    }
    const rim = new T.Mesh(new T.TorusGeometry(.75, .055, 8, 64), gold); wheel.add(rim);
    const hub = new T.Mesh(new T.SphereGeometry(.16, 16, 10), gold); hub.scale.z = .5; wheel.add(hub);
    if (horizontal) { const ball = new T.Mesh(new T.SphereGeometry(.045, 8, 6), white); ball.position.set(.51, .37, .07); wheel.add(ball); }
    else { box(-1.05, 1.36, -.1, .12, .4, .12, gold); const pointer = new T.Mesh(new T.ConeGeometry(.1, .22, 3), gold); pointer.rotation.z = Math.PI; pointer.position.set(0, .77, .06); wheel.add(pointer); }
  } else if (game === 'slots' || game === 'videopoker') {
    box(-.85, 1.76, -.25, 1.25, 1.2, .55); box(-.85, 2.39, -.25, 1.4, .12, .65, gold);
    text(game === 'slots' ? '7  7  7' : 'A K Q J 10', -.85, 1.88, .035, 1.12, .62, '#264c50');
    text(game === 'slots' ? 'GOLD' : 'POKER', -.85, 2.32, .04, 1.05, .2);
    box(-.85, 1.28, .12, 1.3, .15, .55); for (const x of [-1.15, -.85, -.55]) add(new T.CylinderGeometry(.075, .075, .035, 16), gold, x, 1.375, .18);
  } else if (game === 'plinko') {
    box(-.8, 1.89, -.25, 1.7, 1.4, .16); text('PLINKO', -.8, 2.58, -.14, 1.7, .25);
    for (let row = 0; row < 6; row++) for (let col = 0; col <= row; col++) add(new T.SphereGeometry(.035, 6, 4), gold, -.8 + (col - row / 2) * .22, 2.4 - row * .17, -.12);
    for (let i = 0; i < 7; i++) box(-1.48 + i * .22, 1.27, -.06, .03, .16, .2, gold);
  } else if (game === 'dragontower') {
    for (let i = 0; i < 5; i++) box(-.9, 1.29 + i * .23, -.2, 1.05 - i * .13, .19, .75 - i * .08, i % 2 ? dark : gold);
    add(new T.OctahedronGeometry(.21), gem, -.9, 2.51, -.2);
  } else if (game === 'mines') {
    box(-.8, 1.2, -.1, 1.5, .08, 1.1);
    for (let i = 0; i < 12; i++) {
      const x = -1.34 + i % 4 * .36, z = -.46 + Math.floor(i / 4) * .36;
      box(x, 1.26, z, .29, .045, .29, gold);
      if (i % 3 === 0) add(new T.OctahedronGeometry(.12), gem, x, 1.4, z);
    }
  } else if (game === 'dice') {
    for (const x of [-1.1, -.5]) {
      const die = box(x, 1.43, -.1, .42, .42, .42, white); die.rotation.y = .25;
      for (const [dx, dy] of [[-.1, -.1], [.1, .1], [0, 0]]) add(new T.SphereGeometry(.036, 8, 5), dark, x + dx, 1.43 + dy, .125);
    }
    text('ROLL', .7, 1.28, -.5, .8, .24).rotation.x = -Math.PI / 3;
  } else if (game === 'coinflip') {
    const coin = add(new T.CylinderGeometry(.5, .5, .08, 48), gold, -.8, 1.32, -.2); coin.rotation.x = .18;
    text('G', -.8, 1.375, -.2, .65, .65, '#a07b39').rotation.x = -Math.PI / 2;
    for (let i = 0; i < 6; i++) add(new T.CylinderGeometry(.18, .18, .035, 24), gold, .4, 1.2 + i * .04, -.4);
  } else if (game === 'limbo') {
    box(-.8, 1.68, -.2, 1.4, .95, .18); text('2.00×', -.8, 1.7, -.1, 1.25, .75);
    for (let i = 0; i < 5; i++) box(-1.3 + i * .24, 1.27 + i * .06, .3, .13, .15 + i * .12, .14, gold);
  } else if (game === 'hilo') {
    for (const [i, rank] of ['A ↑', 'K ↓'].entries()) text(rank, -.9 + i * .65, 1.46, -.2, .5, .65, '#24484d');
  } else if (game === 'keno') {
    const cage = add(new T.SphereGeometry(.44, 12, 8), new T.MeshStandardMaterial({ color: '#c6a568', wireframe: true, metalness: .7 }), -1, 1.66, -.5);
    cage.rotation.z = .3;
    for (let i = 0; i < 6; i++) add(new T.SphereGeometry(.09, 10, 6), i % 2 ? red : white, -1 + Math.sin(i * 2) * .24, 1.43 + i % 2 * .1, -.5 + Math.cos(i * 2) * .2);
    box(-1, 1.23, -.5, .8, .12, .6, gold);
  }
}
