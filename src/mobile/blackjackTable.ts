import * as T from 'three';
import { GAMES, type GameId } from './catalog';
import { addGameProps } from './gameProps';

const feltTextures = new Map<GameId, T.CanvasTexture>();
function felt(game: GameId) {
  const cached = feltTextures.get(game); if (cached) return cached;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  const glow = ctx.createRadialGradient(512, 400, 30, 512, 512, 650);
  const colors = game === 'roulette' ? ['#693646', '#2d1928'] : ['baccarat', 'hilo', 'videopoker'].includes(game) ? ['#51426e', '#241d39'] : ['#226b59', '#0b342f'];
  glow.addColorStop(0, colors[0]); glow.addColorStop(1, colors[1]);
  ctx.fillStyle = glow; ctx.fillRect(0, 0, 1024, 1024);
  // Fine woven felt, baked once rather than adding per-frame shader work.
  ctx.fillStyle = '#ffffff08';
  for (let y = 0; y < 1024; y += 4) for (let x = (y % 8); x < 1024; x += 8) ctx.fillRect(x, y, 2, 1);
  ctx.strokeStyle = '#e6cb9080'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(512, 512, 450, 450, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.textAlign = 'center'; ctx.fillStyle = '#f1d49c';
  ctx.font = '500 25px Georgia'; ctx.fillText('G O L D   C O A S T', 512, 395);
  ctx.font = 'bold 48px Georgia'; ctx.fillText(GAMES.find(g => g.id === game)!.name.toUpperCase(), 512, 461);
  ctx.font = '18px sans-serif'; ctx.fillText(game === 'blackjack' ? 'DEALER STANDS ON 17' : 'GOLD COAST SOCIAL CLUB', 512, 510);
  ctx.fillStyle = '#b5d1be'; ctx.font = '15px sans-serif'; ctx.fillText(game === 'blackjack' ? 'THE PALM CLUB  •  FREE PRACTICE' : 'VIRTUAL GOLD COINS', 512, 550);
  ctx.strokeStyle = '#e6cb90a0';
  ctx.beginPath(); ctx.ellipse(512, 420, 365, 225, 0, .12, Math.PI - .12); ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const a = .35 + i * (Math.PI - .7) / 3;
    const x = 512 - Math.cos(a) * 350, y = 450 + Math.sin(a) * 320;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a - Math.PI / 2);
    ctx.strokeRect(-35, -43, 70, 86); ctx.font = '13px sans-serif'; ctx.fillText(`SEAT ${i + 1}`, 0, 65); ctx.restore();
  }
  if (game === 'baccarat') {
    for (const [i, title] of ['PLAYER', 'TIE', 'BANKER'].entries()) {
      const x = 240 + i * 270; ctx.strokeRect(x - 110, 590, 220, 100); ctx.font = '22px Georgia'; ctx.fillText(title, x, 650);
    }
  }
  if (game === 'roulette' || game === 'keno') {
    const cols = game === 'roulette' ? 12 : 10, rows = game === 'roulette' ? 3 : 8;
    for (let i = 0; i < cols * rows; i++) {
      const x = 180 + i % cols * (660 / cols), y = 575 + Math.floor(i / cols) * (230 / rows);
      ctx.fillStyle = i % 2 && game === 'roulette' ? '#912f45' : '#142b32'; ctx.fillRect(x, y, 660 / cols - 2, 230 / rows - 2);
      ctx.fillStyle = '#f0e6cf'; ctx.font = `${rows === 8 ? 15 : 21}px sans-serif`; ctx.fillText(String(i + 1), x + 330 / cols, y + 160 / rows);
    }
  }
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4; feltTextures.set(game, texture); return texture;
}

export function blackjackTable(parent: T.Object3D, x: number, z: number, game: GameId = 'blackjack') {
  const table = new T.Group(); table.position.set(x, 0, z); parent.add(table);
  const brass = new T.MeshStandardMaterial({ color: '#b18b4f', metalness: .72, roughness: .3 });
  const leather = new T.MeshStandardMaterial({ color: '#132328', roughness: .75 });
  const wood = new T.MeshStandardMaterial({ color: '#382720', roughness: .38 });
  const mesh = (geometry: T.BufferGeometry, material: T.Material, px: number, py: number, pz: number) => {
    const m = new T.Mesh(geometry, material); m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true; table.add(m); return m;
  };
  const disk = (radius: number, height: number, y: number, mat: T.Material) => {
    const m = mesh(new T.CylinderGeometry(radius, radius, height, 64), mat, 0, y, 0); m.scale.z = .65; return m;
  };
  disk(2.48, .27, .96, wood); disk(2.51, .045, 1.08, brass);
  disk(2.4, .055, 1.12, leather);
  const cloth = mesh(new T.CircleGeometry(2.27, 64), new T.MeshStandardMaterial({ map: felt(game), roughness: 1 }), 0, 1.153, 0);
  cloth.rotation.x = -Math.PI / 2; cloth.scale.y = .65;
  const rail = mesh(new T.TorusGeometry(2.39, .135, 10, 80), leather, 0, 1.17, 0); rail.rotation.x = Math.PI / 2; rail.scale.y = .65;
  const seam = mesh(new T.TorusGeometry(2.4, .012, 5, 80), brass, 0, 1.295, 0); seam.rotation.x = Math.PI / 2; seam.scale.y = .65;
  for (const px of [-1.35, 1.35]) {
    mesh(new T.CylinderGeometry(.22, .34, .9, 20), wood, px, .5, 0);
    mesh(new T.CylinderGeometry(.35, .35, .07, 24), brass, px, .08, 0);
  }
  // Dealer rack, stacked chips and a closed shoe are furniture, not live cards.
  if (game === 'blackjack' || game === 'baccarat') {
  mesh(new T.BoxGeometry(1.3, .09, .35), leather, 0, 1.21, -.72);
  for (let i = 0; i < 6; i++) {
    const chip = new T.MeshStandardMaterial({ color: ['#e9dfc6', '#a83c44', '#357c97'][i % 3], roughness: .6 });
    for (let j = 0; j < 5; j++) mesh(new T.CylinderGeometry(.075, .075, .018, 12), j % 2 ? chip : brass, -.5 + i * .2, 1.27 + j * .019, -.72);
  }
  const shoe = mesh(new T.BoxGeometry(.28, .19, .46), wood, 1.3, 1.26, -.65); shoe.rotation.y = -.3;
  mesh(new T.BoxGeometry(.19, .025, .3), new T.MeshStandardMaterial({ color: '#eee7d5' }), 1.3, 1.365, -.65);
  }
  if (game !== 'blackjack') addGameProps(table, game);
  for (const px of [-1.8, -.6, .6, 1.8]) {
    mesh(new T.CylinderGeometry(.38, .38, .17, 24), leather, px, .55, 2.2);
    mesh(new T.CylinderGeometry(.1, .12, .47, 16), brass, px, .27, 2.2);
    mesh(new T.CylinderGeometry(.32, .34, .055, 24), wood, px, .035, 2.2);
    mesh(new T.BoxGeometry(.62, .48, .14), leather, px, .89, 2.48);
    for (const dx of [-.23, .23]) mesh(new T.CylinderGeometry(.025, .025, .5, 8), brass, px + dx, .63, 2.48);
  }
  // Soft contact shading costs one transparent plane, with no mobile shadow map.
  const shadow = document.createElement('canvas'); shadow.width = shadow.height = 128;
  const ctx = shadow.getContext('2d')!, gradient = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
  gradient.addColorStop(0, '#00000080'); gradient.addColorStop(1, '#00000000'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  const contact = mesh(new T.PlaneGeometry(6, 4.4), new T.MeshBasicMaterial({ map: new T.CanvasTexture(shadow), transparent: true, depthWrite: false }), 0, .005, .2);
  contact.rotation.x = -Math.PI / 2;
  return table;
}
