import { ClubWorld, Look, Person } from './world';
import { API_BASE_URL, getToken, setToken, clearToken, login, signup, getMe } from '../api/client';
import './style.css';
import { GAMES, STATIONS, nearestStation, GameId, Station } from './catalog';
import { RoomService, TableId } from '../../server/src/multiplayer/room';

type Snapshot = ReturnType<RoomService['join']>;
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
const practice = new RoomService();
let quickplayOpen = false, arcadeOpen = false, returnToQuickplay = false, quickplayOrigin: 'welcome' | 'lobby' = 'lobby';
let frame: HTMLIFrameElement | null = null;
root.insertAdjacentHTML('beforeend', `<section id="quickplay" hidden><div class="quickplay-heading"><div><div class="eyebrow">SKIP THE WALK. FIND YOUR GAME.</div><h2>Quickplay</h2><p id="quickplay-note">Every game, one tap away.</p></div><button id="close-quickplay">Back to lounge</button></div><label class="game-search">Find a game<input id="game-search" type="search" placeholder="Search all 14 games" /></label><div id="game-list"></div></section><section id="arcade-host" hidden><div id="arcade-loading"><p>Opening your game…</p><button id="cancel-arcade">Back to lounge</button></div></section>`);
for (const [parent, id] of [['.lobby-actions', 'quickplay-button'], ['.entry-card', 'welcome-quickplay']]) {
  const button = document.createElement('button'); button.id = id; button.textContent = 'Quickplay · All games'; button.className = 'quickplay-button'; document.querySelector(parent)!.prepend(button);
}
el('tour').textContent = 'Explore & play free blackjack →';
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
  world.mode = mode; world.resetInput(); show('welcome', mode === 'welcome'); show('lobby', mode === 'lobby'); show('wardrobe-panel', mode === 'wardrobe'); show('table-screen', mode === 'table'); show('quickplay', mode === 'quickplay'); show('arcade-host', mode === 'arcade');
}
function receive(data: Snapshot) {
  snapshot = data; connected = true; world.enabled = !arcadeOpen;
  el('network').textContent = touring ? 'SOLO PRACTICE · OFFLINE' : '● CONNECTED'; el('room-label').textContent = touring ? 'Solo practice' : `Room ${data.code}`; el('population').textContent = touring ? 'Just you' : `${data.players.length} / 8`;
  world.updatePlayers(data.players, data.self);
  const self = data.players.find(p => p.id === data.self)!;
  if (Math.hypot(world.pose.x - self.x, world.pose.z - self.z) > 1.3) { world.pose.x = self.x; world.pose.z = self.z; }
  if (self.tableId) world.activeStation = STATIONS.find(t => t.id === self.tableId)!;
  if (!inWardrobe && !quickplayOpen && !arcadeOpen) setModeIfChanged(self.seated ? 'table' : 'lobby');
  renderTable();
}
function setModeIfChanged(mode: ClubWorld['mode']) { if (world.mode !== mode) setMode(mode); }
el('join').onclick = async () => {
  if (busy) return; busy = true; el('join').textContent = 'Connecting…';
  try { const code = el<HTMLInputElement>('room-code').value.trim().toUpperCase(); const data = await request<Snapshot>('join', { code: code || undefined, look }); touring = false; const p = data.players.find(p => p.id === data.self)!; world.pose.x = p.x; world.pose.z = p.z; receive(data); show('invite', true); }
  catch (e) { notify(message(e)); if (e instanceof RoomRequestError && e.status === 401) { clearToken(); authUi(); } }
  finally { busy = false; el('join').textContent = 'Enter the lounge ↗'; }
};
function startPractice() { touring = true; world.enabled = true; world.updatePlayers([], ''); snapshot = practice.join('solo', 'You', undefined, look); const p = snapshot.players[0]; world.pose = { x: p.x, z: p.z, yaw: Math.PI }; receive(snapshot); show('invite', false); }
el('tour').onclick = startPractice;
el('exit').onclick = async () => {
  if (busy) return; const old = snapshot, wasTour = touring; snapshot = null; connected = false; touring = false; inWardrobe = false; world.updatePlayers([], ''); setMode('welcome'); el('network').textContent = 'MOBILE PREVIEW';
  if (old && wasTour) practice.leave('solo', old.code);
  else if (old) { busy = true; try { await request('leave', { code: old.code }); } catch { /* The server expires presence after 15 seconds. */ } finally { busy = false; } }
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
  el('deal').textContent = touring ? 'Deal a hand' : 'Deal for the table';
  document.querySelector('.table-heading .eyebrow')!.textContent = `${world.activeStation.name.toUpperCase()} · ${touring ? 'SOLO' : 'SHARED'} FREE PRACTICE`;
  if (fingerprint !== lastTable) {
    lastTable = fingerprint; el('dealer-cards').innerHTML = cards(t.dealer);
    el('hands').innerHTML = t.hands.length ? t.hands.map(h => `<div class="hand ${h.id === t.turn ? 'active' : ''} ${h.id === snapshot!.self ? 'mine' : ''}"><div class="hand-name">${escape(h.name)}${h.id === snapshot!.self ? ' · YOU' : ''}<b>${h.total}</b></div><div class="cards">${cards(h.cards)}</div><small>${h.result || (h.done ? 'Standing' : h.id === t.turn ? 'Playing…' : 'Waiting')}</small></div>`).join('') : '<p class="empty-table">Invite a friend to sit down, then deal the first hand.</p>';
  }
  const empty = document.querySelector('.empty-table');
  if (empty && touring) empty.textContent = 'Take your time. Deal a free hand against the dealer.';
  el('turn-status').textContent = t.phase === 'playing' ? `${turn ? 'Your turn' : `${t.hands.find(h => h.id === t.turn)?.name || 'Player'}’s turn`} · ${Math.ceil(t.remainingMs / 1000)}s` : t.phase === 'resolved' ? 'Hand complete. Ready for another?' : `${snapshot.players.filter(p => p.tableId === t.id).length} / 4 seats filled`;
  show('deal', t.phase !== 'playing'); show('hit', t.phase === 'playing'); show('stand', t.phase === 'playing');
  for (const id of ['hit', 'stand']) el<HTMLButtonElement>(id).disabled = !turn || busy || !connected;
  el<HTMLButtonElement>('deal').disabled = busy || !connected;
}
async function action(action: 'sit' | 'leave' | 'deal' | 'hit' | 'stand', station?: Station, quick = false) {
  if (!snapshot || busy || !connected) return false;
  busy = true; renderTable();
  try {
    const tableId = (station?.id ?? snapshot.table.id) as TableId;
    const revision = snapshot.tables.find(t => t.id === tableId)!.revision;
    receive(touring ? practice.action('solo', snapshot.code, action, revision, tableId, quick) : await request<Snapshot>('action', { code: snapshot.code, action, revision, tableId, quickplay: quick }));
    if (action === 'leave' && returnToQuickplay) { returnToQuickplay = false; openQuickplay(); }
    return true;
  }
  catch (e) { notify(message(e)); return false; } finally { busy = false; renderTable(); }
}
for (const [id, name] of [['leave-table', 'leave'], ['deal', 'deal'], ['hit', 'hit'], ['stand', 'stand']] as const) el(id).onclick = () => void action(name);
el('sit').onclick = () => { const station = nearestStation(world.pose.x, world.pose.z); if (station) void launchGame(station.game, station, false); };
world.onFrame = () => {
  const station = nearestStation(world.pose.x, world.pose.z), near = !!station;
  show('sit', near); show('nearby', !near);
  if (station) el('sit').innerHTML = `Sit & play <span>${escape(station.name.toUpperCase())}</span>`;
  el('nearby').textContent = 'Walk to a table or choose Quickplay';
  el<HTMLButtonElement>('sit').disabled = !touring && (!connected || busy);
};
// Serial polling prevents stale responses from overwriting a completed action.
async function poll() {
  if (snapshot && !busy && !document.hidden) {
    busy = true;
    try { receive(touring ? practice.sync('solo', snapshot.code, { ...world.pose, look }) : await request<Snapshot>('sync', { code: snapshot.code, pose: { ...world.pose, look } })); }
    catch (e) {
      connected = false; world.resetInput(); world.enabled = false; el('network').textContent = 'CONNECTION LOST · RETRYING'; renderTable();
      if ((e instanceof RoomRequestError && (e.status === 404 || e.status === 401)) || touring) { snapshot = null; inWardrobe = false; if (!arcadeOpen) { quickplayOpen = false; setMode('welcome'); } world.enabled = true; el('network').textContent = 'ROOM SESSION ENDED'; notify(message(e)); if (e instanceof RoomRequestError && e.status === 401) { clearToken(); authUi(); } }
    } finally { busy = false; renderTable(); }
  }
  setTimeout(() => void poll(), connected ? 180 : 1200);
}
void poll();
function openQuickplay() {
  quickplayOrigin = snapshot ? 'lobby' : 'welcome'; quickplayOpen = true; setMode('quickplay'); renderGameList(); el<HTMLInputElement>('game-search').value = '';
}
function closeQuickplay() { quickplayOpen = false; setMode(snapshot ? 'lobby' : quickplayOrigin); }
el('quickplay-button').onclick = el('welcome-quickplay').onclick = openQuickplay;
el('close-quickplay').onclick = closeQuickplay;
function renderGameList(query = '') {
  el('quickplay-note').textContent = 'Blackjack: free solo or shared tables. Other games: sign in to play with Gold Coins.';
  const list = el('game-list'); list.replaceChildren();
  for (const game of GAMES.filter(g => `${g.name} ${g.category}`.toLowerCase().includes(query.toLowerCase()))) {
    const button = document.createElement('button'); button.className = 'game-choice';
    button.innerHTML = `<span class="game-icon">${game.icon}</span><span><b>${game.name}</b><small>${game.description}</small><em>${game.id === 'blackjack' ? 'FREE PRACTICE · 2 TABLES' : 'GOLD COINS · ONLINE'}</em></span><span class="game-arrow">↗</span>`;
    button.onclick = () => void launchGame(game.id, undefined, true); list.append(button);
  }
  if (!list.children.length) list.textContent = 'No games match your search.';
}
el<HTMLInputElement>('game-search').oninput = e => renderGameList((e.target as HTMLInputElement).value);
async function launchGame(id: GameId, station?: Station, quick = false) {
  if (busy || arcadeOpen) return;
  if (id === 'blackjack') {
    if (!snapshot) startPractice();
    station ??= STATIONS.find(s => s.game === 'blackjack' && snapshot!.tables.some(t => t.id === s.id && t.phase !== 'playing' && t.seats < 4));
    if (!station) { notify('Both blackjack tables are busy. Try again after a hand finishes.'); return; }
    const ok = await action('sit', station, quick);
    if (ok) { returnToQuickplay = quick; quickplayOpen = false; setMode('table'); }
    return;
  }
  if (!getToken()) { notify('Sign in to play this game with Gold Coins. Free blackjack is available now.'); return; }
  busy = true;
  try {
    const me = await getMe();
    if (me.activeRound) { notify('Finish or leave your existing arcade hand before opening another game.'); return; }
    const game = GAMES.find(g => g.id === id)!;
    returnToQuickplay = quick; arcadeOpen = true; quickplayOpen = false; setMode('arcade'); world.enabled = false;
    frame = document.createElement('iframe'); frame.title = `${game.name} game`; frame.src = `/index.html?mobileGame=1&game=${game.id}`; frame.allow = 'fullscreen';
    el('arcade-host').prepend(frame); show('arcade-loading', true);
  } catch (e) { notify(message(e)); }
  finally { busy = false; }
}
function closeArcade() {
  frame?.remove(); frame = null; arcadeOpen = false; world.enabled = true;
  if (returnToQuickplay) { returnToQuickplay = false; openQuickplay(); } else setMode(snapshot ? 'lobby' : 'welcome');
}
el('cancel-arcade').onclick = closeArcade;
window.addEventListener('message', e => {
  if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin) return;
  if (e.data?.type === 'gc-game-ready') show('arcade-loading', false);
  if (e.data?.type === 'gc-game-exit') closeArcade();
});
el('fullscreen').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else notify('For a full-screen view, add Gold Coast to your phone’s Home Screen.'); }
  catch { notify('Fullscreen isn’t available here. You can still play sideways.'); }
};
const invite = new URL(location.href).searchParams.get('room'); if (invite && /^[a-f0-9]{6}$/i.test(invite)) el<HTMLInputElement>('room-code').value = invite.toUpperCase();
if (getToken()) { busy = true; getMe().then(me => authUi(me.username)).catch(() => notify('Sign in to reconnect, or explore the solo tour while the server is offline.')).finally(() => busy = false); }
