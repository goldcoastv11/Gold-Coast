import { ClubWorld, Look, Person } from './world';
import { API_BASE_URL, getToken, setToken, clearToken, login, signup, getMe, abandonRound, playCoinFlip } from '../api/client';
import './style.css';
import './quickplay.css';
import './blackjackLounge.css';
import './loungeGames.css';
import { installRewards } from './rewards';
import './rewards.css';
import { ResultTracker, TableAudio, resultTone } from './feedback';
import { GAMES, STATIONS, nearestStation, GameId, Station, gameLaunchUrl } from './catalog';
import { RoomService, TableId, SHIRTS, SKINS, HAIR, INDEPENDENT_LOUNGE_GAMES } from '../../server/src/multiplayer/room';
import { OUTFITS, outfitFor } from './outfits';
import { VoiceChat } from './voiceChat';

type Snapshot = ReturnType<RoomService['join']>;
const palette = { shirt: SHIRTS, skin: SKINS, hair: HAIR };
let look: Look = { shirt: palette.shirt[0], skin: palette.skin[1], hair: palette.hair[0] };
try { const saved = JSON.parse(localStorage.getItem('gc3d-look') || 'null'); for (const k of Object.keys(palette) as (keyof typeof palette)[]) if (palette[k].includes(saved?.[k])) look[k] = saved[k]; look.outfit = outfitFor(saved?.outfit).id; } catch { /* Storage is optional. */ }
const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `
  <header><div class="brand"><span class="brand-mark">G</span><div>GOLD COAST<small>THE SOCIAL CLUB</small></div></div><div class="header-right"><span id="network">MOBILE PREVIEW</span><button id="fullscreen" class="quiet" aria-label="Toggle fullscreen">⛶</button></div></header>
  <section id="welcome" class="welcome"><div class="eyebrow">YOUR PEOPLE. YOUR PLACE.</div><h1>A little escape.<br>A great night in.</h1><p>Make it your look. Meet your friends.<br>Take a seat at the coast.</p><div class="entry-card"><h2>Welcome to the club</h2><form id="login-form"><label>Username<input id="username" autocomplete="username" minlength="3" maxlength="32" required placeholder="Your player name" pattern="[a-zA-Z0-9_]+" /></label><label>Password<input id="password" type="password" autocomplete="current-password" minlength="6" maxlength="200" required placeholder="At least 6 characters" /></label><div class="row"><button class="primary" type="submit">Sign in</button><button id="signup" type="button">Create account</button></div></form><div id="signed-in" hidden><p id="greeting"></p></div><div id="room-entry" hidden><label>Friend’s room code <span>(optional)</span><input id="room-code" maxlength="6" placeholder="Leave empty to create a room" autocomplete="off" /></label><button id="join" class="primary">Enter the lounge <span>↗</span></button><button id="signout" class="text-button">Sign out</button></div><button id="tour" class="text-button">Explore the lounge without signing in →</button></div><div class="entry-foot">3D SOCIAL LOUNGE <span>•</span> ONE SHARED GOLD COIN BALANCE</div></section>
  <section id="lobby" hidden><div class="room-card"><span class="eyebrow">THE PALM LOUNGE</span><div><b id="room-label">Solo tour</b><span id="population">1 / 8</span></div><button id="invite" class="text-button">Copy invite link ↗</button></div><div class="lobby-actions"><button id="wardrobe">Customize</button><button id="exit">Exit room</button></div><div id="look-area" aria-label="Move the mouse to look around; click to lock the view"></div><div id="joystick" aria-label="Drag to move" role="group"><div id="nub"></div></div><div class="controls-hint"><span class="desktop-hint">WASD TO MOVE <b>•</b> MOUSE TO LOOK <b>•</b> E TO PLAY <b>•</b> ESC TO RELEASE</span><span class="touch-hint">MOVE <b>•</b> DRAG TO LOOK</span></div><button id="sit" class="primary interact">Take a seat <span>BLACKJACK</span></button><div id="nearby" class="nearby">Walk toward the green blackjack table</div></section>
  <section id="wardrobe-panel" class="wardrobe panel" hidden><div class="eyebrow">MAKE YOURSELF AT HOME</div><h2>Your signature look</h2><p>Starter styles. All yours.</p><div id="swatches"></div><button id="done-look" class="primary">Looks good →</button></section>
  <section id="table-screen" hidden><div class="table-heading"><span class="eyebrow">THE PALM TABLE · FREE PRACTICE</span><h2>Blackjack</h2><p>No coins spent or earned · Dealer stands on 17</p></div><button id="leave-table" class="quiet leave-table">Leave table ↗</button><div class="dealer-label"><b>Your dealer</b><span>Welcome to the table</span></div><div id="dealer-cards" class="dealer-cards"></div><div id="hands" class="hands"></div><div class="table-footer"><span id="turn-status" role="status"></span><div class="row"><button id="deal" class="primary">Deal for the table</button><button id="hit" class="primary">Hit</button><button id="stand">Stand</button><button id="play-turn" class="primary" hidden>Play my turn</button></div></div></section>
  <div id="voice-controls" hidden><span id="voice-status">Voice off</span><button id="join-voice" class="primary">Join voice</button><button id="mute-voice" hidden>Mute</button><button id="leave-voice" hidden>Leave voice</button></div>
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
let quickplayOpen = false, arcadeOpen = false, returnToQuickplay = false, socialTurnOpen = false;
let socialResult = 'Round complete';
let socialView: Record<string, string | number | boolean | number[] | string[] | null> | null = null;
let coinFlipBet = 25, coinFlipBusy = false;
let loungeDirectory = false;
let category = 'All games';
const resultTracker = new ResultTracker(), tableAudio = new TableAudio();
document.addEventListener('pointerdown', () => tableAudio.unlock(), { capture: true });
document.addEventListener('keydown', () => tableAudio.unlock(), { capture: true });
let frame: HTMLIFrameElement | null = null;
root.insertAdjacentHTML('beforeend', `<section id="quickplay" hidden><div class="quickplay-heading"><div><div class="eyebrow">SKIP THE WALK. FIND YOUR GAME.</div><h2>Quickplay</h2><p id="quickplay-note">Every game, one tap away.</p></div><button id="close-quickplay">Back to lounge</button></div><label class="game-search">Find a game<input id="game-search" type="search" placeholder="Search all 14 games" /></label><div id="game-list"></div></section><section id="arcade-host" hidden><div id="arcade-loading"><p>Opening your game…</p><button id="cancel-arcade">Back to lounge</button></div></section>`);
for (const [parent, id] of [['.lobby-actions', 'quickplay-button'], ['.entry-card', 'welcome-quickplay']]) {
  const button = document.createElement('button'); button.id = id; button.textContent = 'Quickplay · All games'; button.className = 'quickplay-button'; document.querySelector(parent)!.prepend(button);
}
el('quickplay').innerHTML = `<div class="catalog-top"><a class="catalog-brand" href="/mobile.html">G<span>GOLD COAST<small>PLAY YOUR WAY</small></span></a><div class="row"><button id="catalog-account">Sign in / Friends</button><button id="close-quickplay" class="primary">Enter lounge ↗</button></div></div><div class="catalog-content"><div class="catalog-intro"><div><div class="eyebrow">YOUR NEXT HAND STARTS HERE</div><h1>Quickplay</h1><p id="quickplay-note">All your favorites. Straight to the action.</p></div><span class="catalog-stamp">14 GAMES<br><small>ONE GOLD COAST</small></span></div><label class="game-search"><span>Find your game</span><input id="game-search" type="search" placeholder="Search games…" /></label><nav id="game-categories" aria-label="Game categories"></nav><div class="catalog-section"><h2>Gold Coast games</h2><span id="game-count"></span></div><div id="game-list"></div><p class="catalog-foot">Blackjack is free practice. Sign in for the other games with virtual Gold Coins.</p></div>`;
el('table-screen').insertAdjacentHTML('beforeend', '<section id="blackjack-betting" class="blackjack-betting" hidden><label>BET <input id="blackjack-bet" type="number" inputmode="numeric" min="1" max="10000" step="1" value="25"></label><div class="bet-shortcuts"><button type="button" data-bet="10">10</button><button type="button" data-bet="25">25</button><button type="button" data-bet="50">50</button><button type="button" data-bet="100">100</button></div><button id="place-blackjack-bet" class="primary">Place bet</button></section><button id="table-sound" class="quiet">Sound on</button><div id="round-result" role="status" aria-live="polite" hidden><b></b><span></span></div>');
function soundLabel() { el('table-sound').textContent = tableAudio.muted ? 'Sound off' : 'Sound on'; el('table-sound').setAttribute('aria-pressed', String(!tableAudio.muted)); }
el('table-sound').onclick = () => { tableAudio.toggle(); soundLabel(); }; soundLabel();
el('catalog-account').onclick = () => { quickplayOpen = false; setMode('welcome'); };
for (const name of ['All games', 'Cards', 'Tables', 'Arcade']) {
  const button = document.createElement('button'); button.textContent = name; button.setAttribute('aria-pressed', String(name === category));
  button.onclick = () => { category = name; el('game-categories').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button))); renderGameList(el<HTMLInputElement>('game-search').value); };
  el('game-categories').append(button);
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
const voice = new VoiceChat(request, state => {
  el('voice-status').textContent = state.label;
  show('join-voice', !state.active); show('mute-voice', state.active); show('leave-voice', state.active);
  el<HTMLButtonElement>('join-voice').disabled = state.joining;
  el('join-voice').textContent = state.joining ? 'Connecting…' : 'Join voice';
  el('mute-voice').textContent = state.muted ? 'Unmute' : 'Mute';
  el('mute-voice').setAttribute('aria-pressed', String(state.muted));
});
function updateVoiceAvailability() { show('voice-controls', !!snapshot && !touring && signedIn); }
el('join-voice').onclick = async () => {
  if (!snapshot || touring) return;
  try { await voice.join(snapshot.code, snapshot.self); } catch (e) { notify(message(e)); }
};
el('mute-voice').onclick = () => voice.toggleMute();
el('leave-voice').onclick = () => void voice.leave();
function message(e: unknown) { return e instanceof Error ? e.message : 'Something went wrong. Please try again.'; }
function authUi(name?: string) {
  el('catalog-account').textContent = name ? 'Account / Friends' : 'Sign in / Friends';
  signedIn = !!name; show('login-form', !signedIn); show('signed-in', signedIn); show('room-entry', signedIn); el('greeting').textContent = `Welcome back, ${name || ''}.`; updateVoiceAvailability();
}
async function authenticate(create: boolean) {
  if (busy || !el<HTMLFormElement>('login-form').reportValidity()) return;
  busy = true; submitAuth.disabled = true; el('auth-error').textContent = '';
  try { const result = await (create ? signup : login)(el<HTMLInputElement>('username').value.trim(), el<HTMLInputElement>('password').value); setToken(result.token); el<HTMLInputElement>('password').value = ''; authUi(result.user.username); rewards.update(result.user); const next = pendingGame; pendingGame = null; busy = false; if (next) await launchGame(next.id, next.station, next.quick); else openQuickplay(); }
  catch (e) { el('auth-error').textContent = message(e); } finally { busy = false; submitAuth.disabled = false; }
}
el('login-form').onsubmit = e => { e.preventDefault(); void authenticate(creatingAccount); };
let creatingAccount = false;
const submitAuth = el<HTMLButtonElement>('login-form').querySelector<HTMLButtonElement>('button[type=submit]')!;
el('signup').onclick = () => {
  if (busy) return;
  creatingAccount = !creatingAccount;
  submitAuth.textContent = creatingAccount ? 'Create your free account' : 'Sign in';
  el('signup').textContent = creatingAccount ? 'Already a member? Sign in' : 'New here? Create account';
  el<HTMLInputElement>('password').autocomplete = creatingAccount ? 'new-password' : 'current-password';
  el('auth-error').textContent = '';
};
el('login-form').insertAdjacentHTML('beforeend', '<button id="show-password" type="button" class="text-button" aria-pressed="false">Show password</button><p id="auth-error" role="alert"></p><p class="auth-help">Use 3–32 letters, numbers or underscores for your username. Password: at least 6 characters.</p>');
el('show-password').onclick = () => { const input = el<HTMLInputElement>('password'); const visible = input.type === 'password'; input.type = visible ? 'text' : 'password'; el('show-password').textContent = visible ? 'Hide password' : 'Show password'; el('show-password').setAttribute('aria-pressed', String(visible)); };
el('signup').textContent = 'New here? Create account';
let pendingGame: { id: GameId; station?: Station; quick: boolean } | null = null;
el('signout').onclick = async () => { await voice.leave(); clearToken(); authUi(); rewards.clear(); pendingGame = null; openQuickplay(); };
function setMode(mode: ClubWorld['mode']) {
  if (mode !== 'lobby' && document.pointerLockElement === el('look-area')) document.exitPointerLock?.();
  document.body.dataset.mode = mode; document.body.dataset.presentation = mode === 'arcade' && returnToQuickplay ? 'quickplay' : 'lounge'; world.enabled = mode !== 'quickplay' && !(mode === 'arcade' && returnToQuickplay);
  if (mode !== 'table') document.body.classList.remove('blackjack-room', 'lounge-game-room', 'independent-game-room', 'coinflip-room');
  world.mode = mode; world.resetInput(); show('welcome', mode === 'welcome'); show('lobby', mode === 'lobby'); show('wardrobe-panel', mode === 'wardrobe'); show('table-screen', mode === 'table'); show('quickplay', mode === 'quickplay'); show('arcade-host', mode === 'arcade');
}
function receive(data: Snapshot) {
  snapshot = data; connected = true; world.enabled = !quickplayOpen && !(arcadeOpen && returnToQuickplay);
  el('network').textContent = touring ? 'SOLO PRACTICE · OFFLINE' : '● CONNECTED'; el('room-label').textContent = touring ? 'Solo practice' : `Room ${data.code}`; el('population').textContent = touring ? 'Just you' : `${data.players.length} / 8`;
  world.updatePlayers(data.players, data.self);
  const self = data.players.find(p => p.id === data.self)!;
  if (Math.hypot(world.pose.x - self.x, world.pose.z - self.z) > 1.3) { world.pose.x = self.x; world.pose.z = self.z; }
  if (self.tableId && !arcadeOpen) world.activeStation = STATIONS.find(t => t.id === self.tableId)!;
  if (!inWardrobe && !quickplayOpen && !arcadeOpen && world.mode !== 'welcome') setModeIfChanged(self.seated ? 'table' : 'lobby');
  updateVoiceAvailability();
  renderTable();
}
function setModeIfChanged(mode: ClubWorld['mode']) { if (world.mode !== mode) setMode(mode); }
el('join').onclick = async () => {
  if (busy) return; busy = true; el('join').textContent = 'Connecting…';
  try { const code = el<HTMLInputElement>('room-code').value.trim().toUpperCase(); const data = await request<Snapshot>('join', { code: code || undefined, look }); touring = false; const p = data.players.find(p => p.id === data.self)!; world.pose.x = p.x; world.pose.z = p.z; setMode('lobby'); receive(data); show('invite', true); }
  catch (e) { notify(message(e)); if (e instanceof RoomRequestError && e.status === 401) { clearToken(); authUi(); } }
  finally { busy = false; el('join').textContent = 'Enter the lounge ↗'; }
};
function startPractice() { touring = true; world.enabled = true; world.updatePlayers([], ''); snapshot = practice.join('solo', 'You', undefined, look); const p = snapshot.players[0]; world.pose = { x: p.x, z: p.z, yaw: Math.PI }; if (!quickplayOpen) setMode('lobby'); receive(snapshot); show('invite', false); }
el('tour').onclick = () => { void voice.leave(); startPractice(); updateVoiceAvailability(); };
el('exit').onclick = async () => {
  if (busy) return; await voice.leave(); const old = snapshot, wasTour = touring; snapshot = null; connected = false; touring = false; inWardrobe = false; world.updatePlayers([], ''); openQuickplay(); el('network').textContent = 'MOBILE PREVIEW'; updateVoiceAvailability();
  if (old && wasTour) practice.leave('solo', old.code);
  else if (old) { busy = true; try { await request('leave', { code: old.code }); } catch { /* The server expires presence after 15 seconds. */ } finally { busy = false; } }
};
el('invite').onclick = async () => {
  if (!snapshot) return; const url = new URL(location.href); url.searchParams.set('room', snapshot.code);
  try { await navigator.clipboard.writeText(url.toString()); notify('Invite link copied. Send it to a friend.'); } catch { notify(`Ask your friend to enter room code ${snapshot.code}.`); }
};
el('swatches').insertAdjacentHTML('beforebegin', '<label class="outfit-label">Character outfit<select id="outfit-choice" aria-label="Character outfit"></select></label><p id="outfit-status" role="status" aria-live="polite"></p>');
const outfitChoice = el<HTMLSelectElement>('outfit-choice');
for (const outfit of OUTFITS) { const option = document.createElement('option'); option.value = outfit.id; option.textContent = outfit.name; outfitChoice.append(option); }
outfitChoice.value = outfitFor(look.outfit).id;
outfitChoice.onchange = () => {
  look = { ...look, outfit: outfitFor(outfitChoice.value).id }; world.setLook(look);
  try { localStorage.setItem('gc3d-look', JSON.stringify(look)); } catch { /* optional */ }
};
for (const key of Object.keys(palette) as (keyof typeof palette)[]) {
  const section = document.createElement('div'); section.className = 'swatch-row'; section.innerHTML = `<h3>${key === 'shirt' ? 'Clothing' : key === 'skin' ? 'Skin tone' : 'Hair color'}</h3>`;
  palette[key].forEach((color, i) => { const button = document.createElement('button'); button.className = 'swatch'; button.style.background = color; button.setAttribute('aria-label', `${key} option ${i + 1}`); button.setAttribute('aria-pressed', String(look[key] === color)); button.onclick = () => { look = { ...look, [key]: color }; world.setLook(look); section.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button))); try { localStorage.setItem('gc3d-look', JSON.stringify(look)); } catch { /* optional */ } }; section.append(button); });
  el('swatches').append(section);
}
el('wardrobe').onclick = () => { inWardrobe = true; setMode('wardrobe'); };
el('done-look').onclick = () => { inWardrobe = false; setMode('lobby'); };
const cards = (ranks: number[], seed = '') => ranks.map((rank, index) => {
  const suits = ['♠', '♥', '♦', '♣'], suit = suits[(index + [...seed].reduce((n, c) => n + c.charCodeAt(0), 0)) % suits.length], red = suit === '♥' || suit === '♦';
  return `<span class="card ${rank === 0 ? 'card-back' : ''} ${red ? 'red-card' : ''}">${rank === 0 ? 'G' : rank === 1 ? 'A' : rank === 11 ? 'J' : rank === 12 ? 'Q' : rank === 13 ? 'K' : rank}<small>${rank ? suit : ''}</small></span>`;
}).join('');
function miniGameView(game: typeof GAMES[number], view: Record<string, any> | null | undefined, detail: string) {
  let visual = `<span class="mini-icon">${game.icon}</span>`;
  if (view) {
    if (Array.isArray(view.reels)) visual = `<span class="mini-reels">${view.reels.map(escape).join(' ')}</span>`;
    else if (Array.isArray(view.hand)) visual = `<span class="mini-cards">${view.hand.map((card: string) => escape(card.split(':')[0])).join(' · ')}</span>`;
    else if (typeof view.number === 'number') visual = `<span class="mini-number ${escape(String(view.color || ''))}">${view.number}</span>`;
    else if (typeof view.currentCard === 'number') visual = `<span class="mini-card">${view.currentCard}</span>`;
    else if (Array.isArray(view.revealed)) visual = `<span class="mini-grid">${Array.from({ length: 9 }, (_, i) => `<i class="${view.revealed.includes(i) ? 'on' : ''}"></i>`).join('')}</span>`;
    else if (typeof view.currentRow === 'number') visual = `<span class="mini-tower">${'◆'.repeat(Math.min(8, view.currentRow + 1))}</span>`;
    else if (typeof view.multiplier === 'number') visual = `<span class="mini-multiplier">${Number(view.multiplier).toFixed(2)}×</span>`;
    else if (typeof view.roll === 'number') visual = `<span class="mini-number">${Number(view.roll).toFixed(1)}</span>`;
  }
  return `${visual}<small>${escape(detail)}</small>`;
}
let lastTable = '';
function renderTable() {
  if (!snapshot) return;
  const t = snapshot.table, turn = t.turn === snapshot.self, fingerprint = JSON.stringify(t);
  const game = GAMES.find(g => g.id === t.game as GameId) ?? GAMES[0];
  const blackjack = t.game === 'blackjack';
  const coinflip = t.game === 'coinflip';
  const independent = (INDEPENDENT_LOUNGE_GAMES as readonly string[]).includes(t.game);
  document.body.classList.toggle('lounge-game-room', world.mode === 'table');
  document.body.classList.toggle('independent-game-room', !blackjack && independent && world.mode === 'table');
  document.body.classList.toggle('coinflip-room', coinflip && world.mode === 'table');
  document.body.classList.toggle('blackjack-room', blackjack && world.mode === 'table');
  if (!blackjack) {
    show('blackjack-betting', false);
    show('round-result', false); el('table-screen').dataset.outcome = '';
    document.querySelector('.table-heading .eyebrow')!.textContent = `${world.activeStation.name.toUpperCase()} · ${touring ? 'SOLO' : '4-SEAT SOCIAL TABLE'}`;
    document.querySelector('.table-heading h2')!.textContent = game.name;
    document.querySelector('.table-heading p')!.textContent = 'Friends stay seated and watch each turn · Virtual Gold Coins';
    document.querySelector('.dealer-label b')!.textContent = t.phase === 'playing' ? `${t.hands.find(h => h.id === t.turn)?.name ?? snapshot.players.find(p => p.id === t.turn)?.name ?? 'Player'} is playing` : 'Your dealer';
    document.querySelector('.dealer-label span')!.textContent = t.lastPlay ? `${t.lastPlay.playerName}: ${t.lastPlay.result}` : 'Take turns around the table';
    el('dealer-cards').innerHTML = coinflip ? '' : !independent && t.lastPlay
      ? `<div class="shared-table-view"><b>${escape(t.lastPlay.playerName)}</b><div class="mini-game-view">${miniGameView(game, t.lastPlay.view, t.lastPlay.result)}</div></div>`
      : `<span class="social-game-symbol"><small>${escape(game.name)}</small>${game.icon}</span>`;
    const seated = snapshot.players.filter(p => p.tableId === t.id).sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
    const socialFingerprint = JSON.stringify({ table: t, players: seated.map(p => ({ id: p.id, name: p.name, seat: p.seat })), self: snapshot.self, coinFlipBet, coinFlipBusy, connected });
    const renderSeats = socialFingerprint !== lastTable;
    if (renderSeats) {
      lastTable = socialFingerprint;
      el('hands').innerHTML = [0, 1, 2, 3].map(seat => {
      const p = seated.find(v => v.seat === seat), active = independent ? t.activities?.[p?.id ?? '']?.phase === 'playing' : p?.id === t.turn;
      const activity = p ? t.activities?.[p.id] : undefined;
      const detail = !p ? 'A friend can join here' : independent ? (activity?.result || (activity?.phase === 'playing' ? 'Playing now…' : 'Ready to play')) : active ? (t.phase === 'playing' ? (t.lastPlay?.result || 'Playing now…') : 'Ready to play') : (t.lastPlay?.playerId === p.id ? t.lastPlay.result : 'Watching the table');
      const view = independent ? activity?.view : t.lastPlay && t.lastPlay.playerId === p?.id ? t.lastPlay.view : null;
      const ownCoinControls = coinflip && p?.id === snapshot!.self ? `<div class="coinflip-seat-controls"><label>BET <input class="coinflip-bet" type="number" min="1" max="10000" step="1" inputmode="numeric" value="${coinFlipBet}"></label><div class="coinflip-bet-row"><button type="button" data-coin-bet="10">10</button><button type="button" data-coin-bet="25">25</button><button type="button" data-coin-bet="50">50</button><button type="button" data-coin-bet="100">100</button></div><div class="coinflip-side-row"><button class="primary" type="button" data-coin-side="heads">Heads</button><button class="primary" type="button" data-coin-side="tails">Tails</button></div></div>` : '';
      const panel = `<div class="hand social-seat ${coinflip ? 'coinflip-seat' : ''} ${active ? 'active' : ''} ${p?.id === snapshot!.self ? 'mine' : ''}" data-seat="${seat}"><div class="seat-number">SEAT ${seat + 1}</div><div class="hand-name">${p ? `${escape(p.name)}${p.id === snapshot!.self ? ' · YOU' : ''}` : 'Open seat'}${active ? `<b>${independent ? 'LIVE' : 'TURN'}</b>` : ''}</div><div class="mini-game-view">${miniGameView(game, view, detail)}</div>${ownCoinControls}</div>`;
      const coinValue = typeof activity?.view?.result === 'string' ? (activity.view.result.toLowerCase() === 'heads' ? 'H' : 'T') : active ? '?' : 'G';
      const tableCoin = coinflip && p ? `<div class="coinflip-table-coin ${active ? 'flipping' : ''}" data-seat="${seat}" aria-hidden="true"><span>${coinValue}</span></div>` : '';
      return panel + tableCoin;
      }).join('');
    }
    if (coinflip) {
      const seats = [0, 1, 2, 3].map(seat => {
        const player = seated.find(p => p.seat === seat), activity = player ? t.activities?.[player.id] : undefined;
        return { occupied: !!player, side: typeof activity?.view?.result === 'string' ? activity.view.result : undefined, flipping: activity?.phase === 'playing' };
      });
      world.setCoinFlipSeats(t.id, seats);
      if (renderSeats) {
        document.querySelectorAll<HTMLInputElement>('.coinflip-bet').forEach(input => input.onchange = () => { const amount = Number(input.value); if (Number.isInteger(amount) && amount >= 1 && amount <= 10000) coinFlipBet = amount; else { input.value = String(coinFlipBet); notify('Choose a whole-number bet from 1 to 10,000 Gold Coins.'); } });
        document.querySelectorAll<HTMLButtonElement>('[data-coin-bet]').forEach(button => button.onclick = () => { coinFlipBet = Number(button.dataset.coinBet); renderTable(); });
        document.querySelectorAll<HTMLButtonElement>('[data-coin-side]').forEach(button => { button.disabled = coinFlipBusy || !connected; button.onclick = () => void playNativeCoinFlip(button.dataset.coinSide as 'heads' | 'tails'); });
      }
    }
    const activeName = seated.find(p => p.id === t.turn)?.name ?? 'A player';
    const ownActivity = t.activities?.[snapshot.self];
    el('turn-status').textContent = independent
      ? (ownActivity?.phase === 'playing' ? 'YOUR GAME IS LIVE · EVERYONE CAN SEE YOUR PROGRESS' : `PLAY AT YOUR OWN PACE · ${seated.length} / 4 SEATS FILLED`)
      : turn ? (t.phase === 'playing' ? 'YOUR GAME IS LIVE · EVERYONE AT THE TABLE IS WATCHING' : 'YOUR TURN · PLAY ON THE TABLE') : `${activeName.toUpperCase()}’S TURN · ${seated.length} / 4 SEATS FILLED`;
    show('deal', false); show('hit', false); show('stand', false); show('play-turn', !coinflip);
    el<HTMLButtonElement>('play-turn').disabled = independent ? busy || !connected : !turn || (t.phase === 'playing' && !socialTurnOpen) || busy || !connected;
    el('play-turn').textContent = socialTurnOpen ? 'Finish game' : independent ? 'Open my game' : turn ? (t.phase === 'playing' ? 'End turn' : 'Play my turn') : `Watching ${activeName}`;
    return;
  }
  document.querySelector('.table-heading h2')!.textContent = 'Blackjack';
  document.querySelector('.table-heading p')!.textContent = 'Standard multiplayer Blackjack · Dealer stands on 17';
  document.querySelector('.dealer-label b')!.textContent = 'Your dealer'; document.querySelector('.dealer-label span')!.textContent = 'Welcome to the table';
  show('play-turn', false);
  const own = t.hands.find(h => h.id === snapshot!.self), tone = t.phase === 'resolved' ? resultTone(own?.result ?? null) : null;
  const cue = resultTracker.observe({ key: `${snapshot.code}/${t.id}`, phase: t.phase, revision: t.revision, result: own?.result ?? null });
  const banner = el('round-result'); show('round-result', !!tone);
  el('table-screen').dataset.outcome = tone || '';
  if (tone) {
    banner.dataset.tone = tone;
    banner.querySelector('b')!.textContent = tone === 'win' ? (own?.result === 'Blackjack!' ? '★ BLACKJACK!' : '★ YOU WIN!') : tone === 'loss' ? (own?.result === 'Bust' ? 'BUST · DEALER WINS' : 'DEALER WINS') : 'PUSH · IT’S A TIE';
    banner.querySelector('span')!.textContent = `Your hand: ${own!.total} · Free practice`;
  } else banner.classList.remove('celebrate');
  if (cue && world.mode === 'table') { tableAudio.play(cue); banner.classList.remove('celebrate'); void banner.offsetWidth; banner.classList.add('celebrate'); }
  el('deal').textContent = 'Deal cards';
  document.querySelector('.table-heading .eyebrow')!.textContent = `${world.activeStation.name.toUpperCase()} · ${touring ? 'SOLO' : 'SHARED'} BLACKJACK`;
  if (fingerprint !== lastTable) {
    lastTable = fingerprint; el('dealer-cards').innerHTML = cards(t.dealer, 'dealer');
    const seated = snapshot.players.filter(p => p.tableId === t.id);
    el('hands').innerHTML = [0, 1, 2, 3].map(seat => {
      const player = seated.find(p => p.seat === seat), hand = player && t.hands.find(h => h.id === player.id), bet = player ? t.bets?.[player.id] : undefined;
      return `<div class="hand blackjack-hand ${hand?.id === t.turn ? 'active' : ''} ${player?.id === snapshot!.self ? 'mine' : ''}" data-seat="${seat}"><div class="hand-name">${player ? `${escape(player.name)}${player.id === snapshot!.self ? ' · YOU' : ''}` : 'OPEN SEAT'}${hand ? `<b>${hand.total}</b>` : ''}</div><div class="cards">${hand ? cards(hand.cards, hand.id) : ''}</div><small>${hand ? `BET ${hand.bet.toLocaleString()} GC · ${hand.result || (hand.done ? 'STAND' : hand.id === t.turn ? 'YOUR TURN' : 'WAITING')}` : bet ? `BET ${bet.toLocaleString()} GC` : player ? 'PLACE BET' : ''}</small></div>`;
    }).join('');
  }
  const seated = snapshot.players.filter(p => p.tableId === t.id), ownBet = t.bets?.[snapshot.self], allBetsPlaced = seated.length > 0 && seated.every(p => !!t.bets?.[p.id]);
  el('turn-status').textContent = t.phase === 'playing' ? `${turn ? 'YOUR TURN' : `${t.hands.find(h => h.id === t.turn)?.name || 'PLAYER'}’S TURN`} · ${Math.ceil(t.remainingMs / 1000)}s` : t.phase === 'resolved' ? 'HAND COMPLETE · PLACE BETS FOR THE NEXT HAND' : allBetsPlaced ? 'ALL BETS PLACED · READY TO DEAL' : `${seated.filter(p => !!t.bets?.[p.id]).length} / ${seated.length} BETS PLACED`;
  show('blackjack-betting', t.phase !== 'playing' && !ownBet); show('deal', t.phase !== 'playing' && allBetsPlaced); show('hit', t.phase === 'playing'); show('stand', t.phase === 'playing');
  for (const id of ['hit', 'stand']) el<HTMLButtonElement>(id).disabled = !turn || busy || !connected;
  el<HTMLButtonElement>('deal').disabled = busy || !connected || !allBetsPlaced;
}
async function playNativeCoinFlip(side: 'heads' | 'tails') {
  if (!snapshot || coinFlipBusy) return;
  if (!getToken()) { notify('Sign in to use Gold Coins at the Coin Flip table.'); return; }
  coinFlipBusy = true; renderTable();
  try {
    // Polling briefly uses the shared request lock. Hold this wager and start
    // it as soon as that sync finishes instead of silently discarding a tap.
    for (let attempt = 0; busy && attempt < 40; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
    if (busy) throw new Error('The table is still syncing. Please try again.');
    const activity = snapshot.table.activities?.[snapshot.self];
    if (activity?.phase !== 'playing' && !await action('begin')) return;
    const response = await playCoinFlip(coinFlipBet, 'GC', side), result = response.result;
    rewards.update(response.user);
    const summary = `${result.result === 'heads' ? 'Heads' : 'Tails'} · ${result.won ? 'Won' : 'Lost'} · ${coinFlipBet.toLocaleString()} GC`;
    await action('finish', undefined, false, summary, undefined, { bet: coinFlipBet, guess: side, result: result.result, won: result.won, payout: result.payout });
  } catch (e) { notify(message(e)); }
  finally { coinFlipBusy = false; renderTable(); }
}
async function action(action: 'sit' | 'leave' | 'bet' | 'deal' | 'hit' | 'stand' | 'begin' | 'share' | 'finish', station?: Station, quick = false, result?: string, betAmount?: number, view?: Record<string, string | number | boolean | number[] | string[] | null>) {
  if (!snapshot || busy || !connected) return false;
  busy = true; renderTable();
  if (action === 'deal') resultTracker.arm();
  try {
    const tableId = (station?.id ?? snapshot.table.id) as TableId;
    const revision = snapshot.tables.find(t => t.id === tableId)!.revision;
    receive(touring ? practice.action('solo', snapshot.code, action, revision, tableId, quick, result, betAmount, view) : await request<Snapshot>('action', { code: snapshot.code, action, revision, tableId, quickplay: quick, result, betAmount, view }));
    if (action === 'leave' && returnToQuickplay) { returnToQuickplay = false; openQuickplay(); }
    return true;
  }
  catch (e) { if (action === 'deal') resultTracker.cancel(); notify(message(e)); return false; } finally { busy = false; renderTable(); }
}
for (const [id, name] of [['deal', 'deal'], ['hit', 'hit'], ['stand', 'stand']] as const) el(id).onclick = () => void action(name);
document.querySelectorAll<HTMLButtonElement>('.bet-shortcuts button').forEach(button => button.onclick = () => { el<HTMLInputElement>('blackjack-bet').value = button.dataset.bet!; });
el('place-blackjack-bet').onclick = () => { const amount = Number(el<HTMLInputElement>('blackjack-bet').value); if (Number.isInteger(amount) && amount >= 1 && amount <= 10000) void action('bet', undefined, false, undefined, amount); else notify('Choose a whole-number bet from 1 to 10,000 Gold Coins.'); };
el('leave-table').onclick = async () => { if (socialTurnOpen) await closeArcade('Player left the table'); await action('leave'); };
el('play-turn').onclick = () => { if (socialTurnOpen) void closeArcade('Turn complete'); else void startSocialTurn(); };
el('sit').onclick = () => { const station = nearestStation(world.pose.x, world.pose.z); if (station) void launchGame(station.game, station, false); };
document.addEventListener('keydown', e => {
  if (e.code !== 'KeyE' || e.repeat || world.mode !== 'lobby' || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const station = nearestStation(world.pose.x, world.pose.z);
  if (station) { e.preventDefault(); void launchGame(station.game, station, false); }
  else notify('Walk closer to a table, then press E to sit and play.');
});
world.onFrame = () => {
  if (inWardrobe && el('outfit-status').textContent !== world.self.status) el('outfit-status').textContent = world.self.status;
  const station = nearestStation(world.pose.x, world.pose.z), near = !!station;
  show('sit', near); show('nearby', !near);
  if (station) el('sit').innerHTML = `Press E or tap to play <span>${escape(station.name.toUpperCase())}</span>`;
  el('nearby').textContent = 'Walk to a table and press E, or choose Quickplay';
  el<HTMLButtonElement>('sit').disabled = !touring && (!connected || busy);
  if (world.mode === 'table' && snapshot?.table.game === 'blackjack') {
    world.placeTableOverlay(el('dealer-cards'), 0, 1.36, -.68);
    document.querySelectorAll<HTMLElement>('.blackjack-hand').forEach(hand => world.placeTableOverlay(hand, [-1.65, -.55, .55, 1.65][Number(hand.dataset.seat)], 1.34, .86));
    world.placeTableOverlay(document.querySelector<HTMLElement>('.table-footer')!, 0, 1.38, .2);
    world.placeTableOverlay(el('blackjack-betting'), 0, 1.39, .06);
    world.placeTableOverlay(el('round-result'), 0, 1.4, -.25);
  } else if (world.mode === 'table' && snapshot) {
    world.placeTableOverlay(el('dealer-cards'), 0, 1.36, -.34);
    const coinflip = snapshot.table.game === 'coinflip';
    document.querySelectorAll<HTMLElement>('.social-seat').forEach(hand => world.placeTableOverlay(hand, [-1.65, -.55, .55, 1.65][Number(hand.dataset.seat)], coinflip ? 1.52 : 1.34, coinflip ? 1.03 : .88));
    if (coinflip) document.querySelectorAll<HTMLElement>('.coinflip-table-coin').forEach(coin => world.placeTableOverlay(coin, [-1.55, -.52, .52, 1.55][Number(coin.dataset.seat)], 1.68, -.72));
    world.placeTableOverlay(document.querySelector<HTMLElement>('.table-footer')!, 0, 1.38, .2);
    if (socialTurnOpen) {
      const independent = (INDEPENDENT_LOUNGE_GAMES as readonly string[]).includes(snapshot.table.game);
      const ownSeat = snapshot.players.find(p => p.id === snapshot!.self)?.seat ?? 1.5;
      world.placeTableOverlay(el('arcade-host'), independent ? [-.48, -.18, .18, .48][ownSeat] : 0, 1.42, .12);
    }
  }
};
// Serial polling prevents stale responses from overwriting a completed action.
async function poll() {
  if (snapshot && !busy && !document.hidden) {
    busy = true;
    try { receive(touring ? practice.sync('solo', snapshot.code, { ...world.pose, look }) : await request<Snapshot>('sync', { code: snapshot.code, pose: { ...world.pose, look } })); }
    catch (e) {
      connected = false; world.resetInput(); world.enabled = false; el('network').textContent = 'CONNECTION LOST · RETRYING'; renderTable();
      if ((e instanceof RoomRequestError && (e.status === 404 || e.status === 401)) || touring) { void voice.leave(); snapshot = null; inWardrobe = false; if (!arcadeOpen) openQuickplay(); el('network').textContent = 'ROOM SESSION ENDED'; notify(message(e)); updateVoiceAvailability(); if (e instanceof RoomRequestError && e.status === 401) { clearToken(); authUi(); } }
    } finally { busy = false; renderTable(); }
  }
  setTimeout(() => void poll(), connected ? 180 : 1200);
}
void poll();
function openQuickplay() {
  loungeDirectory = false;
  quickplayOpen = true; setMode('quickplay'); renderGameList(); el<HTMLInputElement>('game-search').value = '';
}
function closeQuickplay() { if (busy) return; quickplayOpen = false; if (!snapshot) startPractice(); else setMode(snapshot.players.find(p => p.id === snapshot!.self)?.seated ? 'table' : 'lobby'); }
el('quickplay-button').onclick = el('welcome-quickplay').onclick = openQuickplay;
el('close-quickplay').onclick = closeQuickplay;
const loungeGamesButton = document.createElement('button'); loungeGamesButton.textContent = 'Lounge games'; loungeGamesButton.id = 'lounge-games';
document.querySelector('.lobby-actions')!.prepend(loungeGamesButton);
loungeGamesButton.onclick = () => { loungeDirectory = true; quickplayOpen = true; setMode('quickplay'); el<HTMLInputElement>('game-search').value = ''; renderGameList(); };
function renderGameList(query = '') {
  document.querySelector('.catalog-intro h1')!.textContent = loungeDirectory ? 'Lounge games' : 'Quickplay';
  el('quickplay-note').textContent = loungeDirectory ? 'Take a seat with your character, dealer, and game.' : 'All your favorites. Straight to the action.';
  document.querySelector('.catalog-foot')!.textContent = loungeDirectory ? 'Every Lounge game uses the same virtual Gold Coin balance shown in Quickplay.' : 'Direct games use virtual Gold Coins. Sign in to play and keep one balance everywhere.';
  const list = el('game-list'); list.replaceChildren();
  for (const game of GAMES.filter(g => (category === 'All games' || g.category === category) && `${g.name} ${g.category}`.toLowerCase().includes(query.toLowerCase()))) {
    const button = document.createElement('button'); button.className = 'game-choice';
    button.dataset.game = game.id;
    button.setAttribute('aria-label', `${game.name} — ${game.description}`);
    button.innerHTML = `<span class="game-cover"><span class="tile-brand">GOLD COAST</span><span class="game-icon" aria-hidden="true">${game.icon}</span><b>${game.name}</b><span class="tile-play">PLAY ↗</span></span><span class="game-meta"><b>${game.name}</b><small>${game.category} · Gold Coins</small></span>`;
    button.onclick = () => void launchGame(game.id, loungeDirectory ? STATIONS.find(s => s.game === game.id) : undefined, !loungeDirectory); list.append(button);
  }
  el('game-count').textContent = `${list.children.length} games`;
  if (!list.children.length) list.textContent = 'No games match your search.';
}
el<HTMLInputElement>('game-search').oninput = e => renderGameList((e.target as HTMLInputElement).value);
async function launchGame(id: GameId, station?: Station, quick = false) {
  if (busy || arcadeOpen) return;
  if (!quick) {
    if (!getToken() && !touring) { pendingGame = { id, station, quick }; quickplayOpen = false; setMode('welcome'); el('username').focus(); notify('Sign in or create a free account to use your Gold Coins at this table.'); return; }
    if (!snapshot) startPractice();
    station ??= STATIONS.find(s => s.game === id && snapshot!.tables.some(t => t.id === s.id && t.seats < 4));
    if (!station) { notify(`The ${GAMES.find(g => g.id === id)!.name} table is full or busy.`); return; }
    const ok = await action('sit', station, loungeDirectory);
    if (ok) { returnToQuickplay = quick; quickplayOpen = false; setMode('table'); }
    return;
  }
  if (!getToken()) { pendingGame = { id, station, quick }; quickplayOpen = false; setMode('welcome'); el('username').focus(); notify('Sign in or create a free account to play. We’ll bring you straight back to your game.'); return; }
  busy = true;
  try {
    const me = await getMe();
    if (me.activeRound) { notify('Finish or leave your existing arcade hand before opening another game.'); return; }
    const game = GAMES.find(g => g.id === id)!;
    world.activeStation = station ?? STATIONS.find(s => s.game === id) ?? STATIONS[0];
    el('arcade-host').dataset.game = id;
    el('arcade-host').dataset.presentation = quick ? 'quickplay' : 'lounge';
    if (!quick) world.setArcadeGame(id);
    returnToQuickplay = quick; arcadeOpen = true; quickplayOpen = false; setMode('arcade');
    frame = document.createElement('iframe'); frame.title = `${game.name} game`; frame.src = gameLaunchUrl(game.id, quick); frame.allow = 'fullscreen';
    el('arcade-host').prepend(frame); show('arcade-loading', true);
  } catch (e) { notify(message(e)); }
  finally { busy = false; }
}
async function startSocialTurn() {
  if (!snapshot || busy) return;
  const independent = (INDEPENDENT_LOUNGE_GAMES as readonly string[]).includes(snapshot.table.game);
  if (!independent && (snapshot.table.turn !== snapshot.self || snapshot.table.phase === 'playing')) return;
  if (!getToken()) { notify('Sign in to play this Gold Coin game with friends.'); return; }
  try {
    const me = await getMe();
    if (me.activeRound) { notify('Finish or leave your existing game before starting this turn.'); return; }
    if (!await action('begin')) return;
    const game = GAMES.find(g => g.id === snapshot!.table.game as GameId)!;
    socialResult = 'Round complete'; socialView = null; socialTurnOpen = true; arcadeOpen = true; returnToQuickplay = false;
    document.body.classList.add('social-playing');
    el('arcade-host').dataset.game = game.id; el('arcade-host').dataset.presentation = 'social'; el('arcade-host').classList.add('social-turn');
    frame = document.createElement('iframe'); frame.title = `${game.name} — current social turn`; frame.src = gameLaunchUrl(game.id, false); frame.allow = 'fullscreen';
    el('arcade-host').prepend(frame); show('arcade-host', true); show('arcade-loading', true);
  } catch (e) { notify(message(e)); }
}
async function closeArcade(result = 'Turn complete') {
  if (socialTurnOpen) {
    frame?.remove(); frame = null; arcadeOpen = false; socialTurnOpen = false; document.body.classList.remove('social-playing'); el('arcade-host').classList.remove('social-turn'); show('arcade-host', false); world.enabled = true;
    try { const me = await getMe(); if (me.activeRound) await abandonRound(); } catch { /* A completed single-round game has nothing to abandon. */ }
    const independent = !!snapshot && (INDEPENDENT_LOUNGE_GAMES as readonly string[]).includes(snapshot.table.game);
    if (snapshot && (independent ? snapshot.table.activities?.[snapshot.self]?.phase === 'playing' : snapshot.table.phase === 'playing' && snapshot.table.turn === snapshot.self)) await action('finish', undefined, false, result, undefined, socialView ?? undefined);
    void rewards.refresh();
    return;
  }
  void rewards.refresh();
  frame?.remove(); frame = null; arcadeOpen = false; world.enabled = true;
  if (returnToQuickplay) { returnToQuickplay = false; openQuickplay(); } else if (snapshot) setMode('lobby'); else openQuickplay();
}
el('cancel-arcade').onclick = () => void closeArcade('Turn ended');
window.addEventListener('message', e => {
  if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin) return;
  if (e.data?.type === 'gc-game-ready') show('arcade-loading', false);
  if (e.data?.type === 'gc-game-progress' && socialTurnOpen && typeof e.data.summary === 'string') { socialResult = e.data.summary; socialView = e.data.view && typeof e.data.view === 'object' ? e.data.view : null; void action('share', undefined, false, e.data.summary, undefined, socialView ?? undefined); void rewards.refresh(); }
  if (e.data?.type === 'gc-game-exit') void closeArcade(socialResult);
});
el('fullscreen').onclick = async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else notify('For a full-screen view, add Gold Coast to your phone’s Home Screen.'); }
  catch { notify('Fullscreen isn’t available here. You can still play sideways.'); }
};
const invite = new URL(location.href).searchParams.get('room'); if (invite && /^[a-f0-9]{6}$/i.test(invite)) el<HTMLInputElement>('room-code').value = invite.toUpperCase();
window.addEventListener('pagehide', () => void voice.leave());
const rewards = installRewards(root, () => { quickplayOpen = false; setMode('welcome'); }, notify);
openQuickplay();
if (getToken()) { busy = true; getMe().then(me => { authUi(me.username); rewards.update(me); }).catch(() => notify('Sign in to reconnect, or explore the solo tour while the server is offline.')).finally(() => busy = false); }
