// The DOM HUD: top bar (round scores, timer), objective line, killfeed, banner,
// health/armour, money, ammo, the buy panel, the interact prompt and the overlays.
// It never touches the simulation; main.js pushes state in and reads callbacks out.
const $ = (id) => document.getElementById(id);

const COPY = {
  start: {
    title: 'IRONWAKE',
    copy: 'A tactical shooter in the Foundry District. Five Strikers carry the Core to site A or B; five Sentinels hold the yard. First to five rounds takes the match.',
    action: 'Play',
  },
  paused: {
    title: 'IRONWAKE',
    copy: 'Paused. Your squad fights on without you — click to jump back in.',
    action: 'Resume',
  },
  end: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const statsBox = $('match-stats');
  const hitmarker = $('hitmarker');
  const banner = $('banner');
  let hitTimer = 0;
  let bannerTimer = 0;
  const last = {};

  function setText(id, value) {
    if (last[id] === value) return;
    last[id] = value;
    $(id).textContent = value;
  }

  return {
    setAmmo(mag, reserve) {
      setText('ammo-mag', String(mag));
      setText('ammo-reserve', `/ ${reserve}`);
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setWeaponName(name) { setText('weapon-name', name.toUpperCase()); },
    setMoney(value) { setText('money', `$${value.toLocaleString('en-US')}`); },
    setHealth(health, armor) {
      setText('health-num', String(Math.max(0, Math.ceil(health))));
      $('health-fill').style.width = `${Math.max(0, health)}%`;
      $('armor-fill').style.width = `${Math.max(0, armor)}%`;
      $('status').classList.toggle('low', health <= 30);
    },
    setScores(strike, guard) {
      setText('score-strike', String(strike));
      setText('score-guard', String(guard));
    },
    setRound(current, total) { setText('round-label', `ROUND ${current} OF ${total}`); },
    setTimer(text, urgent = false) {
      setText('timer', text);
      $('timer').classList.toggle('urgent', urgent);
    },
    setObjective(html) {
      if (last.objective === html) return;
      last.objective = html;
      $('objective').innerHTML = html;
    },
    setCrosshairGap(px) {
      $('crosshair').style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    setScope(on) { $('scope').classList.toggle('on', on); },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    damageFlash() {
      const vignette = $('vignette');
      vignette.style.opacity = '1';
      setTimeout(() => { vignette.style.opacity = '0'; }, 130);
    },
    kill(text, killerTeam, victimTeam) {
      const feed = $('killfeed');
      const row = document.createElement('div');
      const [killer, victim] = text;
      row.innerHTML = `<b class="k-${killerTeam}">${killer}</b> ▸ <b class="k-${victimTeam}">${victim}</b>`;
      feed.prepend(row);
      while (feed.children.length > 5) feed.lastChild.remove();
      setTimeout(() => row.remove(), 4200);
    },
    banner(titleText, sub = '', holdMs = 2400) {
      setText('banner-title', titleText);
      setText('banner-sub', sub);
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), holdMs);
    },
    interact(label, progress) {
      const box = $('interact');
      if (label === null) { box.classList.remove('on'); return; }
      box.classList.add('on');
      setText('interact-label', label);
      box.querySelector('#channel i').style.width = `${Math.round((progress ?? 0) * 100)}%`;
    },
    showBuy({ money, rows }) {
      const box = $('buy');
      box.hidden = false;
      box.querySelector('.buy-money').textContent = `$${money.toLocaleString('en-US')}`;
      const host = $('buy-rows');
      host.innerHTML = '';
      for (const row of rows) {
        const div = document.createElement('div');
        div.className = `buy-row${row.owned ? ' owned' : ''}${!row.owned && !row.afford ? ' cant' : ''}`;
        div.innerHTML = `<kbd>${row.key}</kbd><span class="buy-name">${row.name}</span><span class="buy-price">${row.owned ? 'OWNED' : `$${row.price}`}</span>`;
        host.appendChild(div);
      }
    },
    hideBuy() { $('buy').hidden = true; },
    showOverlay(mode, stats = null) {
      const text = COPY[mode];
      title.innerHTML = mode === 'end' && stats ? stats.title : 'IRON<span style="color:var(--accent)">WAKE</span>';
      copy.textContent = mode === 'end' && stats ? stats.copy : text.copy;
      play.textContent = text.action;
      if (mode === 'end' && stats) {
        statsBox.style.display = 'block';
        statsBox.innerHTML = stats.rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
      } else {
        statsBox.style.display = 'none';
      }
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() { overlay.hidden = true; },
    onPlay(handler) { play.addEventListener('click', handler); },
  };
}
