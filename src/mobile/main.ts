import { ClubWorld, Look, Person } from './world';
import { API_BASE_URL, getToken, setToken, clearToken, login, signup, getMe } from '../api/client';
import './style.css';

type Snapshot = { code: string; self: string; players: Person[]; table: { phase: 'waiting' | 'playing' | 'resolved'; revision: number; dealer: number[]; hands: { id: string; name: string; cards: number[]; total: number; done: boolean; result: string | null }[]; turn: string | null; remainingMs: number } };
const palette = { shirt: ['#27c6b5', '#e9ae54', '#a78bfa', '#f47591'], skin: ['#f0c5a3', '#c68b60', '#865338', '#51362a'], hair: ['#302922', '#ac733b', '#e9ce8a'] };
let look: Look = { shirt: palette.shirt[0], skin: palette.skin[1], hair: palette.hair[0] };
try { const saved = JSON.parse(localStorage.getItem('gc3d-look') || 'null'); for (const k of Object.keys(palette) as (keyof Look)[]) if (palette[k].includes(saved?.[k])) look[k] = saved[k]; } catch { /* Storage is optional. */ }
const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `
  <header><div class="brand"><span class="brand-mark">G</span><div>GOLD COAST<small>THE SOCIAL CLUB</small></div></div><div class="header-right"><span id="network">MOBILE PREVIEW</span><button id="fullscreen" class="quiet" aria-label="Toggle fullscreen">⛶</button></div></header>
  <section id="welcome" class="welcome"><div class="eyebrow">YOUR PEOPLE. YOUR PLACE.</div><h1>A little escape.<br>A great night in.</h1><p>Make it your look. Meet your friends.<br>Take a seat at the coast.</p><div class="entry-card"><h2>Welcome to the club</h2><form id="login-form"><label>Username<input id="username" autocomplete="username" minlength="3" maxlength="32" required placeholder="Your player name" pattern="[a-zA-Z0-9_]+" /></label><label>Password<input id="password" type="password" autocomplete="current-password" minlength="6" maxlength="200" required placeholder="At least 6 characters" /></label><div class="row"><button class="primary" type="submit">Sign in</button><button id="signup" type="button">Create account</button></div></form><div id="signed-in" hidden><p id="greeting"></p></div><div id="room-entry" hidden><label>Friend’s room code <span>(optional)</span><input id="room-code" maxlength="6" placeholder="Leave empty to create a room" autocomplete="off" /></label><button id="join" class="primary">Enter the lounge <span>↗</span></button><button id="signout" class="text-button">Sign out</button></div><button id="tour" class="text-button">Explore the lounge without signing in →</button></div><div class="entry-foot">3D SOCIAL LOUNGE <span>•</span> FREE PRACTICE BLACKJACK</div></section>
  <section id="lobby" hidden><div class="room-card"><span class="eyebrow">THE PALM LOUNGE</span><div><b id="room-label">Solo tour</b><span id="population">1 / 8</span></div><button id="invite" class="text-button">Copy invite link ↗</button></div><div class="lobby-actions"><button id="wardrobe">Customize</button><button id="exit">Exit room</button></div><div id="look-area" aria-label="Drag to look around"></div><div id="joystick" aria-label="Drag to move" role="group"><div id="nub"></div></div><div class="controls-hint">MOVE <span>•</span> DRAG RIGHT SIDE TO LOOK</div><button id="sit" class="primary interact">Take a seat <span>BLACKJACK</span></button><div id="nearby" class="nearby">Walk toward the green blackjack table</div></section>
  <section id="wardrobe-panel" class="wardrobe panel" hidden><div class="eyebrow">MAKE YOURSELF AT HOME</div><h2>Your signature look</h2><p>Starter styles. All yours.</p><div id="swatches"></div><button id="done-look" class="primary">Looks good →</button></section>
  <section id="table-screen" hidden><div class="table-heading"><span class="eyebrow">THE PALM TABLE · FREE PRACTICE</span><h2>Blackjack</h2><p>No coins spent or earned · Dealer stands on 17</p></div><button id="leave-table" class="quiet leave-table">Leave table ↗</button><div class="dealer-label"><b>Your dealer</b><span>Welcome to the table</span></div><div id="dealer-cards" class="dealer-cards"></div><div id="hands" class="hands"></div><div class="table-footer"><span id="turn-status" role="status"></span><div class="row"><button id="deal" class="primary">Deal for the table</button><button id="hit" class="primary">Hit</button><button id="stand">Stand</button></div></div></section>
  <div id="toast" role="status" aria-live="polite" hidden></div><div id="rotate"><div class="rotate-icon">▯ ↻</div><h2>A wider view awaits</h2><p>Turn your phone sideways to enter Gold Coast.</p></div>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, visible: boolean) => el(id).hidden = !visible;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
let world: ClubWorld;
try { world = new ClubWorld(root, look); }
catch { root.innerHTML = '<div class="fallback"><h1>This device couldn’t start the 3D lounge.</h1><p>Try a recent version of Safari or Chrome with graphics acceleration enabled.</p><a href="/">Return to the original arcade</a></div>'; throw new Error('WebGL unavailable'); }
world.controls(el('joystick'), el('nub'), el('look-area'));
let snapshot: Snapshot | null = null, busy = false, connected = false, touring = false, inWardrobe = false, signedIn = false;
let toastTimer: ReturnType<typeof setTimeout>;
function notify(message: string) { el('toast').textContent = message; show('toast', true); clearTimeout(toastTimer); toastTimer = setTimeout(() => show('toast', false), 5500); }
world.canvas.addEventListener('renderfailure', () => notify('Graphics were interrupted. Reload this page to continue.'));
class RoomRequestError extends Error { constructor(message: string, public status: number) { super(message); } }
async function request<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/multiplayer/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() || ''}` }, body: JSON.stringify(body), signal: controller.signal });
    const data = await response.json();
    if (!response.ok) throw new RoomRequestError(data.error || 'The room request failed.', response.status);
    return data;
  } catch (e) { if (e instanceof RoomRequestError) throw e; throw new Error('Connection interrupted. Check your connection or try again when the server is online.'); }
  finally { clearTimeout(timer); }
}
function message(e: unknown) { return e instanceof Error ? e.message : 'Something went wrong. Please try again.'; }
function authUi(name?: string) {
  signedIn = !!name; show('login-form', !signedIn); show('signed-in', signedIn); show('room-entry', signedIn); el('greeting').textContent = `Welcome back, ${name || ''}.`;
}
async function authenticate(create: boolean) {
  if (busy || !el<HTMLFormElement>('login-form').reportValidity()) return;
  busy = true;
  try { const result = await (create ? signup : login)(el<HTMLInputElement>('username').value.trim(), el<HTMLInputElement>('password').value); setToken(result.token); el<HTMLInputElement>('password').value = ''; authUi(result.user.username); }
  catch (e) { notify(message(e)); } finally { busy = false; }
}
el('login-form').onsubmit = e => { e.preventDefault(); void authenticate(false); };
el('signup').onclick = () => void authenticate(true);
el('signout').onclick = () => { clearToken(); authUi(); };
function setMode(mode: ClubWorld['mode']) {
  world.mode = mode; world.resetInput(); show('welcome', mode === 'welcome'); show('lobby', mode === 'lobby'); show('wardrobe-panel', mode === 'wardrobe'); show('table-screen', mode === 'table');
}
function receive(data: Snapshot) {
  snapshot = data; connected = true; world.enabled = true;
  el('network').textContent = '● CONNECTED'; el('room-label').textContent = `Room ${data.code}`; el('population').textContent = `${data.players.length} / 8`;
  world.updatePlayers(data.players, data.self);
  const self = data.players.find(p => p.id === data.self)!;
  if (Math.hypot(world.pose.x - self.x, world.pose.z - self.z) > 1.3) { world.pose.x = self.x; world.pose.z = self.z; }
  if (!inWardrobe) setModeIfChanged(self.seated ? 'table' : 'lobby');
  renderTable();
}
function setModeIfChanged(mode: ClubWorld['mode']) { if (world.mode !== mode) setMode(mode); }
el('join').onclick = async () => {
  if (busy) return; busy = true; el('join').textContent = 'Connecting…';
  try { const code = el<HTMLInputElement>('room-code').value.trim().toUpperCase(); const data = await request<Snapshot>('join', { code: code || undefined, look }); touring = false; world.pose.x = data.players.find(p => p.id === data.self)!.x; world.pose.z = 5; receive(data); show('invite', true); }
  catch (e) { notify(message(e)); if (e instanceof RoomRequestError && e.status === 401) { clearToken(); authUi(); } }
  finally { busy = false; el('join').textContent = 'Enter the lounge ↗'; }
};
el('tour').onclick = () => { touring = true; snapshot = null; world.enabled = true; world.updatePlayers([], ''); world.pose = { x: -2, z: 5, yaw: Math.PI }; setMode('lobby'); el('network').textContent = 'SOLO TOUR · OFFLINE'; el('room-label').textContent = 'Explore at your pace'; el('population').textContent = 'Just you'; show('invite', false); };
el('exit').onclick = async () => {
  if (busy) return; const old = snapshot; snapshot = null; connected = false; touring = false; inWardrobe = false; world.updatePlayers([], ''); setMode('welcome'); el('network').textContent = 'MOBILE PREVIEW';
  if (old) { busy = true; try { await request('leave', { code: old.code }); } catch { /* The server expires presence after 15 seconds. */ } finally { busy = false; } }
};
el('invite').onclick = async () => {
  if (!snapshot) return; const url = new URL(location.href); url.searchParams.set('room', snapshot.code);
  try { await navigator.clipboard.writeText(url.toString()); notify('Invite link copied. Send it to a friend.'); } catch { notify(`Ask your friend to enter room code ${snapshot.code}.`); }
};
for (const key of Object.keys(palette) as (keyof Look)[]) {
  const section = document.createElement('div'); section.className = 'swatch-row'; section.innerHTML = `<h3>${key === 'shirt' ? 'Outfit' : key === 'skin' ? 'Skin tone' : 'Hair color'}</h3>`;
  palette[key].forEach((color, i) => { const button = document.createElement('button'); button.className = 'swatch'; button.style.background = color; button.setAttribute('aria-label', `${key} option ${i + 1}`); button.setAttribute('aria-pressed', String(look[key] === color)); button.onclick = () => { look = { ...look, [key]: color }; world.setLook(look); section.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button))); try { localStorage.setItem('gc3d-look', JSON.stringify(look)); } catch { /* optional */ } }; section.append(button); });
  el('swatches').append(section);
}
el('wardrobe').onclick = () => { inWardrobe = true; setMode('wardrobe'); };
el('done-look').onclick = () => { inWardrobe = false; setMode('lobby'); };
const cards = (ranks: number[]) => ranks.map(rank => `<span class="card ${rank === 0 ? 'card-back' : ''}">${rank === 0 ? 'G' : rank === 1 ? 'A' : rank === 11 ? 'J' : rank === 12 ? 'Q' : rank === 13 ? 'K' : rank}<small>${rank ? '♠' : ''}</small></span>`).join('');
let lastTable = '';
function renderTable() {
  if (!snapshot) return;
  const t = snapshot.table, turn = t.turn === snapshot.self, fingerprint = JSON.stringify(t);
  if (fingerprint !== lastTable) {
    lastTable = fingerprint; el('dealer-cards').innerHTML = cards(t.dealer);
    el('hands').innerHTML = t.hands.length ? t.hands.map(h => `<div class="hand ${h.id === t.turn ? 'active' : ''} ${h.id === snapshot!.self ? 'mine' : ''}"><div class="hand-name">${escape(h.name)}${h.id === snapshot!.self ? ' · YOU' : ''}<b>${h.total}</b></div><div class="cards">${cards(h.cards)}</div><small>${h.result || (h.done ? 'Standing' : h.id === t.turn ? 'Playing…' : 'Waiting')}</small></div>`).join('') : '<p class="empty-table">Invite a friend to sit down, then deal the first hand.</p>';
  }
  el('turn-status').textContent = t.phase === 'playing' ? `${turn ? 'Your turn' : `${t.hands.find(h => h.id === t.turn)?.name || 'Player'}’s turn`} · ${Math.ceil(t.remainingMs / 1000)}s` : t.phase === 'resolved' ? 'Hand complete. Ready for another?' : `${snapshot.players.filter(p => p.seated).length} / 4 seats filled`;
  show('deal', t.phase !== 'playing'); show('hit', t.phase === 'playing'); show('stand', t.phase === 'playing');
  for (const id of ['hit', 'stand']) el<HTMLButtonElement>(id).disabled = !turn || busy || !connected;
  el<HTMLButtonElement>('deal').disabled = busy || !connected;
}
async function action(action: string) {
  if (touring) { notify('This is a solo tour. Sign in and create a room to play blackjack with friends.'); return; }
  if (!snapshot || busy || !connected) return;
  busy = true; renderTable();
  try { receive(await request<Snapshot>('action', { code: snapshot.code, action, revision: snapshot.table.revision })); }
  catch (e) { notify(message(e)); } finally { busy = false; renderTable(); }
}
for (const [id, name] of [['sit', 'sit'], ['leave-table', 'leave'], ['deal', 'deal'], ['hit', 'hit'], ['stand', 'stand']]) el(id).onclick = () => void action(name);
world.onFrame = () => {
  const near = Math.hypot(world.pose.x, world.pose.z + 2) < 3.9;
  show('sit', near); show('nearby', !near);
  el<HTMLButtonElement>('sit').disabled = !touring && (!connected || busy);
};
// Serial polling prevents stale responses from overwriting a completed action.
async function poll() {
  if (snapshot && !busy && !document.hidden) {
    busy = true;
    try { receive(await request<Snapshot>('sync', { code: snapshot.code, pose: { ...world.pose, look } })); }
    catch (e) {
      connected = false; world.resetInput(); world.enabled = false; el('network').textContent = 'CONNECTION LOST · RETRYING'; renderTable();
      if (e instanceof RoomRequestError && (e.status === 404 || e.status === 401)) { snapshot = null; inWardrobe = false; setMode('welcome'); world.enabled = true; el('network').textContent = 'ROOM SESSION ENDED'; notify(message(e)); if (e.status === 401) { clearToken(); authUi(); } }
    } finally { busy = false; renderTable(); }
  }
  setTimeout(() => void poll(), connected ? 180 : 1200);
}
void poll();
el('fullscreen').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else notify('For a full-screen view, add Gold Coast to your phone’s Home Screen.'); }
  catch { notify('Fullscreen isn’t available here. You can still play sideways.'); }
};
const invite = new URL(location.href).searchParams.get('room'); if (invite && /^[a-f0-9]{6}$/i.test(invite)) el<HTMLInputElement>('room-code').value = invite.toUpperCase();
if (getToken()) { busy = true; getMe().then(me => authUi(me.username)).catch(() => notify('Sign in to reconnect, or explore the solo tour while the server is offline.')).finally(() => busy = false); }
