import * as T from 'three';
import { Character, type Look } from './character';
import { blackjackTable } from './blackjackTable';
export type { Look } from './character';
import { LOUNGE_BOUNDS } from '../../server/src/multiplayer/room';
import { STATIONS, Station, GAMES, GameId } from './catalog';

export type Person = { id: string; name: string; x: number; z: number; yaw: number; look: Look; seated: boolean };
type Figure = Character;
const material = (color: string, metalness = 0) => new T.MeshStandardMaterial({ color, roughness: .65, metalness });
function box(parent: T.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, mat: T.Material) {
  const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), mat); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
}
function cylinder(parent: T.Object3D, x: number, y: number, z: number, radius: number, height: number, mat: T.Material) {
  const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, height, 16), mat); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
}
const figure = (look: Look, dealer = false) => new Character(look, dealer);
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
  private stationSigns: T.Mesh[] = [];
  private dealers: Figure[] = [];
  private gameStage = new T.Group();
  private stagePlayer: Figure;
  private stageTitle: T.Mesh | null = null;
  private stageTables = new Map<GameId, T.Group>();
  activeStation: Station = STATIONS[0];
  pose = { x: -2, z: 2, yaw: Math.PI };
  mode: 'welcome' | 'lobby' | 'table' | 'wardrobe' | 'quickplay' | 'arcade' = 'welcome';
  enabled = true;
  onFrame: () => void = () => {};
  constructor(host: HTMLElement, look: Look) {
    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.canvas = this.renderer.domElement; this.canvas.setAttribute('aria-label', 'Gold Coast 3D lounge'); host.prepend(this.canvas);
    this.scene.background = new T.Color('#182b3b'); this.scene.fog = new T.Fog('#182b3b', 28, 65);
    this.scene.add(new T.HemisphereLight('#d4eafa', '#474537', 2));
    const sun = new T.DirectionalLight('#ffe2ac', 2.5); sun.position.set(-8, 15, 8); this.scene.add(sun);
    const floor = material('#34464a'), navy = material('#193746'), gold = material('#c69c59', .65), green = material('#1f706d');
    box(this.scene, 0, -.18, 7, 40, .3, 36, floor);
    for (let x = -18; x <= 18; x += 2) box(this.scene, x, -.018, 7, .025, .01, 34, gold);
    for (let z = -9; z <= 23; z += 2) box(this.scene, 0, -.018, z, 38, .01, .025, gold);
    box(this.scene, 0, .01, -1, 10, .035, 9, navy);
    box(this.scene, 0, 2.4, -8.5, 40, 4.8, .3, navy);
    for (let x = -19; x < 20; x += 1) box(this.scene, x, 2.4, -8.28, .035, 4.8, .08, gold);
    const title = label('G O L D  C O A S T', 8, 2); title.position.set(0, 3.5, -8.05); this.scene.add(title);
    const subtitle = label('THE SOCIAL CLUB', 3.5, .8); subtitle.position.set(0, 2.55, -8.04); this.scene.add(subtitle);
    for (const x of [-19, 19]) { box(this.scene, x, .5, 7, .25, 1, 34, navy); for (const z of [-7, 7, 21]) box(this.scene, x, 2.3, z, .28, 4.6, .28, gold); }
    for (let i = 0; i < 24; i++) { const h = 1 + (i * 7 % 11) * .6; box(this.scene, (i - 12) * 3, h / 2 - 1, -28, 1.9, h, 2, material(i % 2 ? '#536d7c' : '#3f5669')); }
    for (const station of STATIONS) {
      const { x, z } = station;
      blackjackTable(this.scene, x, z, station.game);
      const sign = label(station.name.toUpperCase(), 2.8, .48); sign.position.set(x, 2.9, z - 1.6); this.scene.add(sign); this.stationSigns.push(sign);
      const dealer = figure({ shirt: '#f3e6cd', skin: '#c68b60', hair: '#302922' }, true); dealer.group.position.set(x, 0, z - 1.8); this.scene.add(dealer.group); this.dealers.push(dealer);
    }
    for (const x of [-18, 18]) {
      for (const z of [-5, 19]) {
        cylinder(this.scene, x, .45, z, .65, .9, navy); cylinder(this.scene, x, 1.8, z, .12, 2.8, gold);
        for (let i = 0; i < 7; i++) { const leaf = new T.Mesh(new T.SphereGeometry(1, 8, 5), green); leaf.scale.set(.24, .10, 1.6); leaf.rotation.set(.3, i * Math.PI * 2 / 7, .15); leaf.position.set(x + Math.sin(i) * .35, 3.2, z); this.scene.add(leaf); }
      }
    }
    this.self = figure(look); this.scene.add(this.self.group);
    // A dedicated dealer booth keeps lounge plants, other tables and avatars
    // out of every game's controls. The lounge itself remains walkable.
    this.gameStage.position.x = 40; this.scene.add(this.gameStage);
    const stageNavy = material('#122935');
    box(this.gameStage, 0, -.15, 0, 20, .2, 16, stageNavy);
    box(this.gameStage, 0, 3, -5, 20, 6, .3, stageNavy);
    for (const x of [-5, -2, 4, 7]) box(this.gameStage, x, 2.5, -4.8, .035, 5, .05, gold);
    const stageDealer = figure({ shirt:'#dae4e7', skin:'#c68b60', hair:'#302922' }, true);
    stageDealer.group.position.set(1.5, 1.4, -2.1); this.gameStage.add(stageDealer.group); this.dealers.push(stageDealer);
    this.stagePlayer = figure(look); this.stagePlayer.group.position.set(-2.7, -.2, 2.3); this.stagePlayer.group.rotation.y = Math.PI;
    this.gameStage.add(this.stagePlayer.group);
    cylinder(this.gameStage, -2.7, .48, 2.3, .38, .2, stageNavy);
    this.gameStage.visible = false;
    this.camera.position.set(10, 7, 12); this.camera.lookAt(0, 1, -2);
    window.addEventListener('resize', () => this.resize()); this.resize();
    window.addEventListener('keydown', e => { if (!(e.target instanceof HTMLInputElement)) { this.keys.add(e.code); if (e.code.startsWith('Arrow')) e.preventDefault(); } });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.resetInput()); document.addEventListener('visibilitychange', () => this.resetInput());
    this.canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.enabled = false; this.canvas.dispatchEvent(new CustomEvent('renderfailure')); });
    this.renderer.setAnimationLoop(() => this.frame());
  }
  setArcadeGame(id: GameId) {
    if (!this.stageTables.has(id)) {
      const table = blackjackTable(this.gameStage, 1.5, 0, id); table.scale.setScalar(1.2); this.stageTables.set(id, table);
    }
    for (const [game, table] of this.stageTables) table.visible = game === id;
    if (this.stageTitle) { this.gameStage.remove(this.stageTitle); dispose(this.stageTitle); }
    this.stageTitle = label(GAMES.find(g => g.id === id)!.name.toUpperCase(), 3.8, .55);
    this.stageTitle.position.set(-2, 3.4, -4.6); this.gameStage.add(this.stageTitle);
    this.camera.position.set(40, 2.7, 5.8); this.camera.lookAt(40, .65, -.8);
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
  setLook(look: Look) { for (const f of [this.self, this.stagePlayer]) f.setLook(look); }
  updatePlayers(players: Person[], self: string) {
    for (const [id, remote] of this.people) if (!players.some(p => p.id === id && id !== self)) { this.scene.remove(remote.figure.group); remote.figure.dispose(); this.people.delete(id); }
    for (const p of players) {
      if (p.id === self) continue;
      let remote = this.people.get(p.id);
      if (!remote) { const f = figure(p.look), tag = label(p.name, 1.8, .45); tag.position.y = 2.3; f.group.add(tag); f.group.position.set(p.x, 0, p.z); this.scene.add(f.group); remote = { figure: f, data: p }; this.people.set(p.id, remote); }
      remote.data = p; remote.figure.setLook(p.look);
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
      const nx = T.MathUtils.clamp(this.pose.x + dx * dt * 4, LOUNGE_BOUNDS.minX, LOUNGE_BOUNDS.maxX), nz = T.MathUtils.clamp(this.pose.z + dz * dt * 4, LOUNGE_BOUNDS.minZ, LOUNGE_BOUNDS.maxZ);
      // Keep the player outside the table and seating furniture.
      const blocked = STATIONS.some(t => ((nx - t.x) / 2.95) ** 2 + ((nz - t.z) / 2) ** 2 < 1);
      if (!blocked) { this.pose.x = nx; this.pose.z = nz; }
      moving = Math.hypot(dx, dz) > .05 && !blocked;
      if (moving) this.pose.yaw = Math.atan2(dx, dz);
      // Keep yaw bounded for server validation after repeated camera rotations.
      this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    }
    this.self.group.position.set(this.pose.x, 0, this.pose.z); this.self.group.rotation.y = this.pose.yaw;
    this.self.group.visible = this.mode !== 'arcade';
    if (this.mode === 'wardrobe') this.self.group.position.set(40, 0, 2.3);
    if (this.mode === 'table') { this.self.group.position.y = -.2; this.self.group.rotation.y = Math.PI; }
    this.gameStage.visible = this.mode === 'arcade' || this.mode === 'wardrobe';
    this.stagePlayer.group.visible = this.mode === 'arcade';
    if (this.mode === 'wardrobe') {
      for (const table of this.stageTables.values()) table.visible = false;
      if (this.stageTitle) this.stageTitle.visible = false;
    }
    for (const sign of this.stationSigns) sign.visible = this.mode !== 'table';
    const fov = this.mode === 'table' && this.camera.aspect > 1.65 ? 40 : 52;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.self.update(dt, moving, this.mode === 'table');
    if (this.mode === 'arcade') this.stagePlayer.update(dt, false, true);
    const target = new T.Vector3(), aim = new T.Vector3();
    if (this.mode === 'welcome') { target.set(10, 7, 12); aim.set(0, 1, -2); }
    else if (this.mode === 'table') { const t = this.activeStation; target.set(this.pose.x + 2.8, 3.2, this.pose.z + 3.8); aim.set(t.x, 1.1, t.z); }
    else if (this.mode === 'arcade') { target.set(40, 2.7, 5.8); aim.set(40, .65, -.8); }
    else if (this.mode === 'wardrobe') { target.set(41.1, 1.9, 6.1); aim.set(40, 1.05, 2.3); this.self.group.rotation.y = .2; }
    else { target.set(T.MathUtils.clamp(this.pose.x + Math.sin(this.yaw) * 4.8, LOUNGE_BOUNDS.minX - .5, LOUNGE_BOUNDS.maxX + .5), 1.6 + this.pitch * 5, T.MathUtils.clamp(this.pose.z + Math.cos(this.yaw) * 4.8, LOUNGE_BOUNDS.minZ - .5, LOUNGE_BOUNDS.maxZ + .5)); aim.set(this.pose.x, 1.35, this.pose.z); }
    this.camera.position.lerp(target, 1 - Math.exp(-dt * 7)); this.camera.lookAt(aim);
    for (const { figure: f, data: p } of this.people.values()) { const distance = Math.hypot(f.group.position.x - p.x, f.group.position.z - p.z); f.group.position.lerp(new T.Vector3(p.x, p.seated ? -.2 : 0, p.z), 1 - Math.exp(-dt * 12)); f.group.rotation.y = p.yaw; f.update(dt, distance > .08, p.seated); }
    for (const dealer of this.dealers) {
      const inStage = dealer.group.parent === this.gameStage;
      if (inStage) dealer.group.visible = this.mode === 'arcade';
      if (inStage ? this.mode === 'arcade' : this.mode !== 'arcade' && dealer.group.position.distanceTo(this.camera.position) < 18) dealer.update(dt);
    }
    this.onFrame(); this.renderer.render(this.scene, this.camera);
  }
}
