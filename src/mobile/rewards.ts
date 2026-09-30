import { getToken, getMe, getChallenges, getProgression, claimChallenge, claimBonus } from '../api/client';
import type { MeResponse, ChallengeView } from '../api/types';

/** Rewards are granted only by the existing server endpoints, never by the reveal animation. */
export function installRewards(root: HTMLElement, signIn: () => void, notify: (text: string) => void) {
  const bar = document.createElement('div'); bar.className = 'player-tools';
  bar.innerHTML = '<span class="player-balance">Sign in to save your progress</span><button data-action="challenges">Challenges & XP</button><button data-action="coins">Coin kiosk · Shuffle cups</button>';
  document.querySelector('.catalog-content')!.prepend(bar);
  const lounge = bar.cloneNode(true) as HTMLElement; lounge.classList.add('lounge-tools');
  root.append(lounge);
  const modal = document.createElement('dialog'); modal.className = 'rewards-dialog';
  modal.innerHTML = '<div class="rewards-top"><h2></h2><button aria-label="Close rewards">✕</button></div><div class="rewards-content"></div>';
  root.append(modal);
  const content = modal.querySelector<HTMLDivElement>('.rewards-content')!;
  const close = modal.querySelector<HTMLButtonElement>('.rewards-top button')!;
  close.onclick = () => modal.close();
  let pending = false, revision = 0, user: MeResponse | null = null;
  const error = (e: unknown) => e instanceof Error ? e.message : 'Could not connect. Please try again.';
  const update = (me: MeResponse) => {
    user = me;
    for (const holder of [bar, lounge]) holder.querySelector('.player-balance')!.textContent = `${me.goldCoins.toLocaleString()} GC · Level ${me.progression.level} · ${me.progression.xp.toLocaleString()} XP`;
  };
  const refresh = async () => { if (getToken()) try { update(await getMe()); } catch { /* Keep the last confirmed balance. */ } };
  modal.addEventListener('close', () => { revision++; });
  modal.addEventListener('cancel', e => { if (pending) e.preventDefault(); });
  function lock(value: boolean) { pending = value; close.disabled = value; content.querySelectorAll('button').forEach(b => b.disabled = value); }
  function heading(text: string) { modal.querySelector('h2')!.textContent = text; }
  async function challenges() {
    const requestId = ++revision; heading('Challenges & XP'); content.textContent = 'Loading your progress…';
    try {
      const [board, progress] = await Promise.all([getChallenges(), getProgression()]);
      if (!modal.open || requestId !== revision) return;
      content.replaceChildren();
      if (!board.available) { content.textContent = 'Challenges are not available yet. Please check back soon.'; return; }
      const level = document.createElement('div'); level.className = 'level-progress';
      level.innerHTML = `<b>Level ${progress.level}</b><span>${progress.xp.toLocaleString()} total XP</span><progress max="${progress.xpForNextLevel || 1}" value="${progress.atMaxLevel ? 1 : progress.xpIntoLevel}"></progress><small>${progress.atMaxLevel ? 'Maximum level reached' : `${progress.xpIntoLevel} / ${progress.xpForNextLevel} XP to next level · ${progress.nextLevelRewardGc.toLocaleString()} GC reward`}</small>`;
      content.append(level);
      for (const [label, rows] of [['Daily', board.daily], ['Weekly', board.weekly], ['Achievements', board.achievements]] as [string, ChallengeView[]][]) {
        const h = document.createElement('h3'); h.textContent = label; content.append(h);
        for (const challenge of rows) {
          const card = document.createElement('article'); card.className = 'challenge-card';
          const title = document.createElement('b'); title.textContent = challenge.name;
          const description = document.createElement('p'); description.textContent = challenge.description;
          const meter = document.createElement('progress'); meter.max = challenge.target; meter.value = challenge.progress;
          const status = document.createElement('small'); status.textContent = `${challenge.progress} / ${challenge.target} · +${challenge.rewardXp} XP · +${challenge.rewardGc.toLocaleString()} GC`;
          const button = document.createElement('button'); button.className = challenge.complete && !challenge.claimed ? 'primary' : '';
          button.textContent = challenge.claimed ? 'Claimed ✓' : challenge.complete ? 'Claim reward' : 'In progress'; button.disabled = !challenge.complete || challenge.claimed;
          button.onclick = async () => {
            if (pending) return; lock(true);
            try { const result = await claimChallenge(challenge.id); update(result.user); notify(`+${result.claimed.rewardXp} XP and +${result.claimed.rewardGc.toLocaleString()} GC${result.levelsGained.length ? ` · Level ${result.progression.level}!` : ''}`); }
            catch (e) { notify(error(e)); }
            finally { pending = false; close.disabled = false; await challenges(); }
          };
          card.append(title, description, meter, status, button); content.append(card);
        }
      }
    } catch (e) { if (requestId === revision) { content.textContent = error(e); const retry = document.createElement('button'); retry.textContent = 'Try again'; retry.onclick = () => void challenges(); content.append(retry); } }
  }
  async function coins() {
    heading('Coin kiosk'); content.innerHTML = '<p>Shuffle the cups to reveal a free Gold Coin reward. No coins are spent.</p><p class="reward-note">A free refill is available every 30 seconds. Pick a cup after the shuffle to reveal your coins.</p><div class="shuffle-cups"><button aria-label="Choose cup 1"><span aria-hidden="true">G</span></button><button aria-label="Choose cup 2"><span aria-hidden="true">G</span></button><button aria-label="Choose cup 3"><span aria-hidden="true">G</span></button></div><p class="cup-result" role="status">Ready for a refill?</p><button class="primary start-shuffle">Shuffle & claim free coins</button>';
    const cups = Array.from(content.querySelectorAll<HTMLButtonElement>('.shuffle-cups button')); cups.forEach(b => b.disabled = true);
    const start = content.querySelector<HTMLButtonElement>('.start-shuffle')!;
    const status = content.querySelector<HTMLParagraphElement>('.cup-result')!;
    start.onclick = async () => {
      if (pending) return;
      lock(true); status.textContent = 'Saving your reward…';
      try {
        const result = await claimBonus(); update(result.user);
        const rack = content.querySelector('.shuffle-cups')!; rack.classList.add('shuffling'); status.textContent = 'Shuffling…';
        await new Promise(resolve => setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1400));
        rack.classList.remove('shuffling'); start.hidden = true; status.textContent = 'Pick a cup to reveal your saved reward.';
        cups.forEach(cup => { cup.disabled = false; cup.onclick = () => {
          cups.forEach(b => b.disabled = true); cup.classList.add('revealed'); cup.textContent = '●';
          status.textContent = `+${result.granted.gcAmount.toLocaleString()} GC added to your balance!`;
          pending = false; close.disabled = false;
          const again = document.createElement('button'); again.textContent = 'Back to kiosk'; again.onclick = () => void coins(); content.append(again);
        }; });
        // The reward is already persisted, so closing is safe even before choosing a cup.
        pending = false; close.disabled = false;
      } catch (e) { lock(false); cups.forEach(b => b.disabled = true); status.textContent = error(e); start.textContent = 'Try again'; }
    };
    if (user?.attendantClaim.lastClaimedAt) {
      const remaining = Math.max(0, 30000 - (Date.now() - Date.parse(user.attendantClaim.lastClaimedAt)));
      if (remaining) status.textContent = `Next free refill in about ${Math.ceil(remaining / 1000)} seconds.`;
    }
  }
  for (const holder of [bar, lounge]) holder.querySelectorAll<HTMLButtonElement>('button').forEach(button => button.onclick = () => {
    if (!getToken()) { signIn(); notify('Sign in or create a free account to save your coins and XP.'); return; }
    modal.showModal(); if (button.dataset.action === 'coins') void coins(); else void challenges(); void refresh();
  });
  return { update, refresh, clear: () => { user = null; for (const holder of [bar, lounge]) holder.querySelector('.player-balance')!.textContent = 'Sign in to save your progress'; } };
}
