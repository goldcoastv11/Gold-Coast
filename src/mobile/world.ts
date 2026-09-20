import * as T from 'three';
import { STATIONS, Station } from './catalog';

export type Look = { shirt: string; skin: string; hair: string };
export type Person = { id: string; name: string; x: number; z: number; yaw: number; look: Look; seated: boolean };
type Figure = { group: T.Group; limbs: T.Group[]; shirt: T.MeshStandardMaterial; skin: T.MeshStandardMaterial; hair: T.MeshStandardMaterial };
const material = (color: string, metalness = 0) => new T.MeshStandardMaterial({ color, roughness: .65, metalness });
function box(parent: T.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, mat: T.Material) {
  const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), mat); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
}
function cylinder(parent: T.Object3D, x: number, y: number, z: number, radius: number, height: number, mat: T.Material) {
  const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, height, 16), mat); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
}
function figure(look: Look): Figure {
  const group = new T.Group(), shirt = material(look.shirt), skin = material(look.skin), hair = material(look.hair), dark = material('#253345'), shoes = material('#f6eee0');
  box(group, 0, 1.02, 0, .56, .66, .32, shirt);
  box(group, 0, 1.65, 0, .42, .44, .39, skin);
  box(group, 0, 1.89, -.02, .45, .15, .43, hair);
  box(group, -.11, 1.67, .204, .055, .06, .018, dark); box(group, .11, 1.67, .204, .055, .06, .018, dark);
  const limbs: T.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = new T.Group(); leg.position.set(side * .16, .72, 0); group.add(leg);
    box(leg, 0, -.29, 0, .23, .58, .26, dark); box(leg, 0, -.64, .05, .25, .13, .37, shoes); limbs.push(leg);
    const arm = new T.Group(); arm.position.set(side * .4, 1.26, 0); group.add(arm);
    box(arm, 0, -.16, 0, .21, .35, .28, shirt); box(arm, 0, -.43, 0, .18, .23, .23, skin); limbs.push(arm);
  }
  return { group, limbs, shirt, skin, hair };
}
function label(text: string, width = 4, height = 1): T.Mesh {
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 192;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#dfbd7c'; ctx.font = '600 70px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(text, 384, 112);
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
  return new T.Mesh(new T.PlaneGeometry(width, height), new T.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
}
function dispose(group: T.Object3D) {
  const materials = new Set<T.Material>();
  group.traverse(o => { if (o instanceof T.Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); } });
  for (const m of materials) { if ('map' in m && m.map instanceof T.Texture) m.map.dispose(); m.dispose(); }
}
export class ClubWorld {
  readonly canvas: HTMLCanvasElement;
  readonly self: Figure;
  private renderer: T.WebGLRenderer;
  private scene = new T.Scene();
  private camera = new T.PerspectiveCamera(52, 1, .1, 100);
  private people = new Map<string, { figure: Figure; data: Person }>();
  private keys = new Set<string>();
  private stick = { x: 0, y: 0 };
  private yaw = 0;
  private pitch = .35;
  private previous = performance.now();
  private walkTime = 0;
  private dealers: Figure[] = [];
  activeStation: Station = STATIONS[0];
  pose = { x: -2, z: 2, yaw: Math.PI };
  mode: 'welcome' | 'lobby' | 'table' | 'wardrobe' | 'quickplay' | 'arcade' = 'welcome';
  enabled = true;
  onFrame: () => void = () => {};
  constructor(host: HTMLElement, look: Look) {
    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.3;
    this.canvas = this.renderer.domElement; this.canvas.setAttribute('aria-label', 'Gold Coast 3D lounge'); host.prepend(this.canvas);
    this.scene.background = new T.Color('#182b3b'); this.scene.fog = new T.Fog('#182b3b', 28, 65);
    this.scene.add(new T.HemisphereLight('#d4eafa', '#947052', 3));
    const sun = new T.DirectionalLight('#ffe2ac', 3); sun.position.set(-8, 15, 8); this.scene.add(sun);
    const floor = material('#d2b890'), navy = material('#193746'), gold = material('#c69c59', .65), green = material('#1f706d');
    box(this.scene, 0, -.18, 0, 23, .3, 21, floor);
    for (let x = -10; x <= 10; x += 2) box(this.scene, x, -.018, 0, .025, .01, 20, gold);
    for (let z = -9; z <= 9; z += 2) box(this.scene, 0, -.018, z, 22, .01, .025, gold);
    box(this.scene, 0, .01, -1, 10, .035, 9, navy);
    box(this.scene, 0, 2.4, -8.5, 23, 4.8, .3, navy);
    for (let x = -10; x < 11; x += 1) box(this.scene, x, 2.4, -8.28, .035, 4.8, .08, gold);
    const title = label('G O L D  C O A S T', 8, 2); title.position.set(0, 3.5, -8.05); this.scene.add(title);
    const subtitle = label('THE SOCIAL CLUB', 3.5, .8); subtitle.position.set(0, 2.55, -8.04); this.scene.add(subtitle);
    for (const x of [-11, 11]) { box(this.scene, x, .5, 0, .25, 1, 19, navy); for (const z of [-7, 0, 7]) box(this.scene, x, 2.3, z, .28, 4.6, .28, gold); }
    for (let i = 0; i < 24; i++) { const h = 1 + (i * 7 % 11) * .6; box(this.scene, (i - 12) * 3, h / 2 - 1, -28, 1.9, h, 2, material(i % 2 ? '#536d7c' : '#3f5669')); }
    for (const station of STATIONS) {
      const { x, z } = station;
      const felt = cylinder(this.scene, x, 1.1, z, 2.4, .2, material(station.color)); felt.scale.z = .65;
      const rim = cylinder(this.scene, x, 1, z, 2.52, .15, gold); rim.scale.z = .65;
      cylinder(this.scene, x, .5, z, .65, 1, navy);
      const sign = label(station.name.toUpperCase(), 3.8, .65); sign.position.set(x, 2.9, z - 1.6); this.scene.add(sign);
      for (const dx of [-1.8, -.6, .6, 1.8]) { cylinder(this.scene, x + dx, .55, z + 2.2, .34, .18, gold); cylinder(this.scene, x + dx, .27, z + 2.2, .10, .5, navy); }
      const dealer = figure({ shirt: '#f3e6cd', skin: '#c68b60', hair: '#302922' }); dealer.group.position.set(x, 0, z - 1.8); this.scene.add(dealer.group); this.dealers.push(dealer);
      if (station.game === 'roulette') { cylinder(this.scene, x, 1.3, z, .7, .1, gold); cylinder(this.scene, x, 1.37, z, .57, .06, material('#652d37')); }
      if (station.game === 'slots') { box(this.scene, x, 1.7, z, 1.5, 1.2, .35, navy); const reels = label('7   7   7', 1.3, .45); reels.position.set(x, 1.8, z + .2); this.scene.add(reels); }
    }
    for (const x of [-8, 8]) {
      for (const z of [-5, 6]) {
        cylinder(this.scene, x, .45, z, .65, .9, navy); cylinder(this.scene, x, 1.8, z, .12, 2.8, gold);
        for (let i = 0; i < 7; i++) { const leaf = new T.Mesh(new T.SphereGeometry(1, 8, 5), green); leaf.scale.set(.24, .10, 1.6); leaf.rotation.set(.3, i * Math.PI * 2 / 7, .15); leaf.position.set(x + Math.sin(i) * .35, 3.2, z); this.scene.add(leaf); }
      }
    }
    this.self = figure(look); this.scene.add(this.self.group);
    this.camera.position.set(10, 7, 12); this.camera.lookAt(0, 1, -2);
    window.addEventListener('resize', () => this.resize()); this.resize();
    window.addEventListener('keydown', e => { if (!(e.target instanceof HTMLInputElement)) { this.keys.add(e.code); if (e.code.startsWith('Arrow')) e.preventDefault(); } });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.resetInput()); document.addEventListener('visibilitychange', () => this.resetInput());
    this.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.enabled = false; this.canvas.dispatchEvent(new CustomEvent('renderfailure')); });
    this.renderer.setAnimationLoop(() => this.frame());
  }
  private resize() { const w = innerWidth, h = innerHeight; this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h); }
  resetInput() { this.keys.clear(); this.stick.x = this.stick.y = 0; }
  controls(stick: HTMLElement, nub: HTMLElement, lookArea: HTMLElement) {
    let joystickId: number | null = null, cameraId: number | null = null, lastX = 0, lastY = 0;
    const move = (e: PointerEvent) => { const r = stick.getBoundingClientRect(); let x = (e.clientX - r.left - r.width / 2) / 38, y = (e.clientY - r.top - r.height / 2) / 38; const n = Math.max(1, Math.hypot(x, y)); x /= n; y /= n; this.stick = { x, y }; nub.style.transform = `translate(${x * 32}px, ${y * 32}px)`; };
    stick.onpointerdown = e => { if (joystickId !== null) return; joystickId = e.pointerId; stick.setPointerCapture(e.pointerId); move(e); };
    stick.onpointermove = e => { if (e.pointerId === joystickId) move(e); };
    const stop = () => { joystickId = null; this.stick = { x: 0, y: 0 }; nub.style.transform = ''; };
    stick.onpointerup = stick.onpointercancel = stick.onlostpointercapture = stop;
    lookArea.onpointerdown = e => { if (cameraId !== null) return; cameraId = e.pointerId; lastX = e.clientX; lastY = e.clientY; lookArea.setPointerCapture(e.pointerId); };
    lookArea.onpointermove = e => { if (e.pointerId !== cameraId) return; this.yaw -= (e.clientX - lastX) * .006; this.pitch = T.MathUtils.clamp(this.pitch + (e.clientY - lastY) * .004, .12, .7); lastX = e.clientX; lastY = e.clientY; };
    lookArea.onpointerup = lookArea.onpointercancel = lookArea.onlostpointercapture = () => { cameraId = null; };
  }
  setLook(look: Look) { this.self.shirt.color.set(look.shirt); this.self.skin.color.set(look.skin); this.self.hair.color.set(look.hair); }
  updatePlayers(players: Person[], self: string) {
    for (const [id, remote] of this.people) if (!players.some(p => p.id === id && id !== self)) { this.scene.remove(remote.figure.group); dispose(remote.figure.group); this.people.delete(id); }
    for (const p of players) {
      if (p.id === self) continue;
      let remote = this.people.get(p.id);
      if (!remote) { const f = figure(p.look), tag = label(p.name, 1.8, .45); tag.position.y = 2.3; f.group.add(tag); f.group.position.set(p.x, 0, p.z); this.scene.add(f.group); remote = { figure: f, data: p }; this.people.set(p.id, remote); }
      remote.data = p; remote.figure.shirt.color.set(p.look.shirt); remote.figure.skin.color.set(p.look.skin); remote.figure.hair.color.set(p.look.hair);
    }
  }
  private frame() {
    const now = performance.now(), dt = Math.min((now - this.previous) / 1000, .05); this.previous = now;
    if (document.hidden || !this.enabled) return;
    let moving = false;
    if (this.mode === 'lobby') {
      let x = this.stick.x + Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
      let z = this.stick.y + Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) - Number(this.keys.has('KeyW') || this.keys.has('ArrowUp'));
      const length = Math.max(1, Math.hypot(x, z)); x /= length; z /= length;
      const dx = x * Math.cos(this.yaw) + z * Math.sin(this.yaw), dz = z * Math.cos(this.yaw) - x * Math.sin(this.yaw);
      const nx = T.MathUtils.clamp(this.pose.x + dx * dt * 4, -9.8, 9.8), nz = T.MathUtils.clamp(this.pose.z + dz * dt * 4, -7, 8.8);
      // Keep the player outside the table and seating furniture.
      const blocked = STATIONS.some(t => ((nx - t.x) / 2.95) ** 2 + ((nz - t.z) / 2) ** 2 < 1);
      if (!blocked) { this.pose.x = nx; this.pose.z = nz; }
      moving = Math.hypot(dx, dz) > .05 && !blocked;
      if (moving) this.pose.yaw = Math.atan2(dx, dz);
      // Keep yaw bounded for server validation after repeated camera rotations.
      this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    }
    this.self.group.position.set(this.pose.x, 0, this.pose.z); this.self.group.rotation.y = this.pose.yaw;
    this.self.group.visible = this.mode !== 'table';
    if (moving) this.walkTime += dt * 10;
    this.self.limbs.forEach((l, i) => l.rotation.x = moving ? Math.sin(this.walkTime) * .5 * (i < 2 ? 1 : -1) : 0);
    const target = new T.Vector3(), aim = new T.Vector3();
    if (this.mode === 'welcome') { target.set(10, 7, 12); aim.set(0, 1, -2); }
    else if (this.mode === 'table') { const t = this.activeStation; target.set(t.x, 3.9, t.z + 5.8); aim.set(t.x, 1.1, t.z - .8); }
    else if (this.mode === 'wardrobe') { target.set(this.pose.x + 1.1, 1.9, this.pose.z + 3.8); aim.set(this.pose.x, 1.05, this.pose.z); this.self.group.rotation.y = .2; }
    else { target.set(T.MathUtils.clamp(this.pose.x + Math.sin(this.yaw) * 4.8, -10.5, 10.5), 1.6 + this.pitch * 5, T.MathUtils.clamp(this.pose.z + Math.cos(this.yaw) * 4.8, -7.8, 10)); aim.set(this.pose.x, 1.35, this.pose.z); }
    this.camera.position.lerp(target, 1 - Math.exp(-dt * 7)); this.camera.lookAt(aim);
    for (const { figure: f, data: p } of this.people.values()) { const distance = Math.hypot(f.group.position.x - p.x, f.group.position.z - p.z); f.group.position.lerp(new T.Vector3(p.x, p.seated ? -.2 : 0, p.z), 1 - Math.exp(-dt * 12)); f.group.rotation.y = p.yaw; f.limbs.forEach((l, i) => l.rotation.x = p.seated ? (i % 2 === 0 ? -1.3 : -.4) : distance > .08 ? Math.sin(now * .01) * .4 * (i < 2 ? 1 : -1) : 0); }
    for (const dealer of this.dealers) dealer.group.rotation.y = Math.sin(now * .0005) * .06;
    this.onFrame(); this.renderer.render(this.scene, this.camera);
  }
}
