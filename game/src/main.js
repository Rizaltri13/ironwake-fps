// IRONWAKE: a round-based tactical FPS. Five Strikers carry the Core to a plant site,
// five Sentinels hold the yard; money between rounds buys rifles, armour and the DMR.
// The player fights alongside four bots against five. This module owns the match:
// phases (menu, freeze/buy, live, round over, match over), the round clock, planting
// and defusing, the economy, combat resolution and the deterministic screenshot
// scenes (?shot=start|buy|play|end with &seed=N, frozen on window.__shotReady).
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createMover } from './physics.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createLoadout, WEAPONS, BUY_ORDER, ARMOR_PRICE, HELMET_PRICE } from './weapons.js';
import { createBots } from './bots.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const ROUND_TIME = 100;
const FREEZE_TIME = 6;
const PLANT_TIME = 3.25;
const DEFUSE_TIME = 4.0;
const DETONATE_TIME = 40;
const ROUND_END_TIME = 4.5;
const ROUNDS_TO_WIN = 5;
const MAX_ROUNDS = 9;
const HALF_ROUND = 4; // sides swap after this round
const WIN_PAY = 2650;
const LOSS_PAY = 1900;
const KILL_PAY = 300;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed * 7919 + 13);

// ---- scene ---------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 46, 115);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 220);
scene.add(camera);

const world = createWorld(scene);
const mover = createMover(world.colliders);
const hud = createHud();
const audio = createAudio();
const loadout = createLoadout(camera);

// The planted Core: a squat charge with a glowing crown that pulses as it counts down.
const coreGroup = new THREE.Group();
{
  const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.46), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.6, metalness: 0.3 }));
  baseMesh.position.y = 0.15;
  const crown = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 1.4 }));
  crown.position.y = 0.36;
  coreGroup.add(baseMesh, crown);
  coreGroup.visible = false;
  scene.add(coreGroup);
}

// Tracers: one-frame lines in the shooter's team colour.
const tracers = [];
const tracerMats = {
  strike: new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true }),
  guard: new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.ward), transparent: true }),
};
function spawnTracer(from, to, team) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, tracerMats[team]);
  scene.add(line);
  tracers.push({ line, life: 0.07 });
}

// ---- match state -----------------------------------------------------------------
const match = {
  phase: 'menu',
  round: 1,
  scores: { strike: 0, guard: 0 },
  phaseT: 0,
  clock: ROUND_TIME,
  attackSite: 'A',
  planted: null, // { site, position, t }
  playerDiedLastRound: false,
  over: null,
};
const playerTeamNow = () => (match.round <= HALF_ROUND ? 'strike' : 'guard');
const playerRole = () => playerTeamNow(); // 'strike' attacks, 'guard' defends

let player;
let bots;

const playerProxy = {
  id: 'player',
  name: 'You',
  isPlayer: true,
  get team() { return playerTeamNow(); },
  get alive() { return player.state.alive; },
  get body() { return player.state.body; },
  eyePos() {
    const e = player.eyePos();
    return new THREE.Vector3(e.x, e.y, e.z);
  },
};

const raycaster = new THREE.Raycaster();
function canSee(a, b) {
  const dir = new THREE.Vector3().copy(b).sub(a);
  const dist = dir.length();
  if (dist < 0.01) return true;
  dir.normalize();
  raycaster.set(a, dir);
  raycaster.far = dist;
  const hit = raycaster.intersectObjects(world.shootables, false)[0];
  return !hit || hit.distance > dist - 0.7;
}

function aliveCount(team) {
  let n = bots.aliveCount(team);
  if (playerTeamNow() === team && player.state.alive) n += 1;
  return n;
}

function award(team, amount) {
  for (const bot of bots.all) if (bot.team === team && bot.active) bot.money += amount;
  if (playerTeamNow() === team) player.state.money += amount;
}

function onKill(victim, attacker) {
  const attackerName = attacker.isPlayer ? 'You' : attacker.name;
  const victimName = victim.isPlayer ? 'You' : victim.name;
  hud.kill([attackerName, victimName], attacker.team, victim.team);
  if (attacker.isPlayer) player.state.money += KILL_PAY;
  else if (attacker.money !== undefined) attacker.money += KILL_PAY;
  checkRoundEnd();
}

function hurtPlayer(amount, attacker) {
  const p = player.state;
  if (!p.alive || match.phase !== 'live') return;
  let dmg = amount;
  if (p.armor > 0) {
    const absorbed = dmg * 0.45;
    p.armor = Math.max(0, p.armor - absorbed);
    dmg -= absorbed;
  }
  p.health -= dmg;
  playerChannel = null;
  hud.damageFlash();
  audio.hurt();
  if (p.health <= 0) {
    p.health = 0;
    p.alive = false;
    p.deaths += 1;
    if (attacker && attacker.kills !== undefined) attacker.kills += 1;
    hud.kill([attacker ? attacker.name : '—', 'You'], attacker ? attacker.team : 'guard', playerTeamNow());
    hud.setObjective('<b>You are down</b>Your squad fights on — watch the round play out.');
    checkRoundEnd();
  }
}

const fx = {
  foesOf(bot) {
    const foes = bots.all.filter((b) => b.team !== bot.team && b.active);
    if (playerTeamNow() !== bot.team) foes.push(playerProxy);
    return foes;
  },
  canSee,
  hurt(foe, amount, part, attacker) {
    if (foe.isPlayer) { hurtPlayer(amount, attacker); return; }
    const killed = foe.damage(amount, part, attacker);
    if (killed) onKill(foe, attacker);
  },
  tracer: spawnTracer,
  sfx(name, weaponId, pos) {
    if (name === 'shot') audio.shot(weaponId, camera.position.distanceTo(pos));
  },
  playerTeam: () => playerTeamNow(),
  onChannel(bot, type) {
    if (type === 'plant') doPlant(bot.body.position.clone(), bot);
    else if (type === 'defuse') doDefuse(bot);
  },
};

player = createPlayer(mover, world.spawns.strike[2]);
bots = createBots(scene, world, mover, fx);
const input = createInput(renderer.domElement, onLockChange);

// ---- round flow --------------------------------------------------------------------
function spawnFor(bot) {
  const slots = world.spawns[bot.team];
  if (bot.team !== playerTeamNow()) return slots[bot.index];
  if (bot.index === 4) return null; // the player takes the fifth slot
  return slots[[0, 1, 3, 4][bot.index]];
}

function startMatch() {
  match.scores = { strike: 0, guard: 0 };
  match.round = 1;
  player.state.money = 800;
  player.state.kills = 0;
  player.state.deaths = 0;
  player.state.shots = 0;
  player.state.hits = 0;
  player.state.armor = 0;
  player.state.helmet = false;
  for (const bot of bots.all) { bot.money = 800; bot.kills = 0; bot.deaths = 0; bot.weaponId = 'pistol'; bot.armor = 0; bot.helmet = false; }
  loadout.resetRound(['pistol']);
  startRound();
}

function startRound() {
  match.attackSite = random() < 0.5 ? 'A' : 'B';
  match.planted = null;
  coreGroup.visible = false;
  match.clock = ROUND_TIME;
  match.phase = 'freeze';
  match.phaseT = FREEZE_TIME;
  playerChannel = null;

  const keepIds = match.playerDiedLastRound ? ['pistol'] : Object.keys(loadout.owned);
  loadout.resetRound(keepIds);
  match.playerDiedLastRound = false;
  player.reset(world.spawns[playerTeamNow()][2]);
  bots.resetRound(spawnFor);
  bots.buyPhase();
  bots.planRound({ attackSite: match.attackSite, playerTeam: playerTeamNow() });

  hud.setScores(match.scores.strike, match.scores.guard);
  hud.setRound(match.round, MAX_ROUNDS);
  hud.hideBuy();
  refreshObjective();
  refreshBuy();
  hud.showBuy(buyState());
}

function refreshObjective() {
  if (match.planted) {
    hud.setObjective(playerRole() === 'guard'
      ? `<b>Core planted at site ${match.planted.site}</b>Defuse it before it detonates.`
      : `<b>Core planted at site ${match.planted.site}</b>Defend it until detonation.`);
  } else if (playerRole() === 'strike') {
    hud.setObjective('<b>Objective</b>Plant the Core at site A or B — or eliminate the Sentinels.');
  } else {
    hud.setObjective('<b>Objective</b>Hold sites A and B. Defuse the Core if it is planted.');
  }
}

function endRound(winner, reason) {
  if (match.phase !== 'live' && match.phase !== 'freeze') return;
  match.phase = 'over';
  match.phaseT = ROUND_END_TIME;
  match.scores[winner] += 1;
  match.playerDiedLastRound = !player.state.alive;
  award(winner, WIN_PAY);
  award(winner === 'strike' ? 'guard' : 'strike', LOSS_PAY);
  hud.setScores(match.scores.strike, match.scores.guard);
  hud.hideBuy();
  hud.interact(null);
  const youWon = winner === playerTeamNow();
  hud.banner(youWon ? 'ROUND WON' : 'ROUND LOST', reason, 3200);
  if (youWon) audio.roundWin(); else audio.roundLose();
}

function checkRoundEnd() {
  if (match.phase !== 'live') return;
  const strikes = aliveCount('strike');
  const guards = aliveCount('guard');
  if (match.planted) {
    if (guards === 0) endRound('strike', 'Sentinels eliminated');
  } else {
    if (strikes === 0) endRound('guard', 'Strikers eliminated');
    else if (guards === 0) endRound('strike', 'Sentinels eliminated');
  }
}

function doPlant(position, planter) {
  if (match.planted || match.phase !== 'live') return;
  const siteKey = world.sites.A.center.distanceTo(position) < world.sites.B.center.distanceTo(position) ? 'A' : 'B';
  match.planted = { site: siteKey, position: position.clone(), t: DETONATE_TIME };
  coreGroup.position.copy(position);
  coreGroup.visible = true;
  bots.setPlanted(siteKey, position);
  if (planter.isPlayer) player.state.money += 350;
  else if (planter.money !== undefined) planter.money += 350;
  hud.banner('CORE PLANTED', `Site ${siteKey} — ${DETONATE_TIME} seconds to detonation`, 2600);
  audio.plantBeep(true);
  refreshObjective();
}

function doDefuse(byWhom) {
  if (!match.planted) return;
  if (byWhom.isPlayer) player.state.money += KILL_PAY;
  else if (byWhom.money !== undefined) byWhom.money += KILL_PAY;
  endRound('guard', 'Core defused');
}

function endMatch() {
  match.phase = 'matchover';
  const p = player.state;
  const champion = match.scores.strike > match.scores.guard ? 'strike' : match.scores.guard > match.scores.strike ? 'guard' : null;
  const accuracy = p.shots > 0 ? Math.round((p.hits / p.shots) * 100) : 0;
  hud.showOverlay('end', {
    title: champion === null ? 'DRAW' : champion === playerTeamNow() ? 'VICTORY' : 'DEFEAT',
    copy: champion === 'strike' ? 'The Strikers took the Foundry District.' : champion === 'guard' ? 'The Sentinels held the Foundry District.' : 'Honours even — the yard belongs to no one.',
    rows: [
      ['Final score', `${match.scores.strike} — ${match.scores.guard}`],
      ['Your kills / deaths', `${p.kills} / ${p.deaths}`],
      ['Accuracy', `${accuracy}%`],
      ['Bank', `$${p.money.toLocaleString('en-US')}`],
    ],
  });
  if (document.pointerLockElement) document.exitPointerLock();
}

// ---- buying ---------------------------------------------------------------------------
function buyState() {
  const p = player.state;
  const rows = BUY_ORDER.map((id, i) => {
    const def = WEAPONS[id];
    return { key: String(i + 1), name: def.name, price: def.price, owned: !!loadout.owned[id], afford: p.money >= def.price };
  });
  rows.push({ key: '5', name: 'Kevlar vest', price: ARMOR_PRICE, owned: p.armor >= 100 && !p.helmet, afford: p.money >= ARMOR_PRICE });
  rows.push({ key: '6', name: 'Vest + helmet', price: HELMET_PRICE, owned: p.helmet, afford: p.money >= HELMET_PRICE });
  return { money: p.money, rows };
}

function refreshBuy() {
  if (match.phase === 'freeze') hud.showBuy(buyState());
}

function tryBuy(key) {
  const p = player.state;
  const index = ['1', '2', '3', '4'].indexOf(key);
  if (index >= 0) {
    const id = BUY_ORDER[index];
    const def = WEAPONS[id];
    if (loadout.owned[id]) { loadout.equip(id); return; }
    if (p.money < def.price) { audio.denied(); return; }
    p.money -= def.price;
    loadout.give(id);
    audio.buy();
  } else if (key === '5') {
    if (p.armor >= 100 || p.money < ARMOR_PRICE) { audio.denied(); return; }
    p.money -= ARMOR_PRICE;
    p.armor = 100;
    audio.buy();
  } else if (key === '6') {
    if (p.helmet || p.money < HELMET_PRICE) { audio.denied(); return; }
    p.money -= HELMET_PRICE;
    p.armor = 100;
    p.helmet = true;
    audio.buy();
  }
  refreshBuy();
}

// ---- player combat -----------------------------------------------------------------------
const shootDir = new THREE.Vector3();
let prevFiring = false;
let playerChannel = null;

function playerShoot() {
  const def = loadout.def;
  if (!loadout.takeRound()) {
    if (loadout.current.mag === 0) { audio.dryFire(); loadout.reload(); }
    return;
  }
  loadout.pullTrigger();
  audio.shot(def.id, 0);
  player.state.shots += def.pellets;
  const speed = player.groundSpeed();
  const targetsNow = world.shootables.concat(bots.hitMeshes.filter((mesh) => mesh.userData.bot.active && mesh.userData.bot.alive));
  for (let pellet = 0; pellet < def.pellets; pellet += 1) {
    camera.getWorldDirection(shootDir);
    const spread = loadout.spread(speed);
    shootDir.x += (random() * 2 - 1) * spread;
    shootDir.y += (random() * 2 - 1) * spread;
    shootDir.z += (random() * 2 - 1) * spread;
    shootDir.normalize();
    raycaster.set(camera.position, shootDir);
    raycaster.far = 160;
    const hit = raycaster.intersectObjects(targetsNow, false)[0];
    const end = hit ? hit.point : camera.position.clone().add(shootDir.clone().multiplyScalar(60));
    spawnTracer(camera.position.clone().add(new THREE.Vector3(0, -0.12, 0)), end, playerTeamNow());
    if (hit && hit.object.userData.bot) {
      const bot = hit.object.userData.bot;
      const part = hit.object.userData.part;
      let amount = def.damage * (part === 'head' ? def.headMult : 1);
      if (part === 'head' && bot.helmet) amount *= 0.62;
      if (hit.distance > def.range) amount *= 0.45;
      player.state.hits += 1;
      const killed = bot.damage(amount, part, player.state);
      hud.hitMarker(killed, shot ? 4000 : 90);
      audio.hit(killed);
      if (killed) onKill(bot, playerProxy);
    }
  }
  player.recoil(0.006 + def.kick * 0.1 + random() * 0.003, (random() * 2 - 1) * 0.003);
}

function playerInteract(dt) {
  const p = player.state;
  if (!p.alive || match.phase !== 'live') { hud.interact(null); playerChannel = null; return; }
  const holding = input.state.keys.has('KeyE');
  const still = player.groundSpeed() < 0.6;
  let want = null;
  if (playerRole() === 'strike' && !match.planted) {
    for (const key of ['A', 'B']) {
      const site = world.sites[key];
      if (Math.hypot(site.center.x - p.body.position.x, site.center.z - p.body.position.z) < site.radius) want = { type: 'plant', need: PLANT_TIME, label: 'Hold <b>E</b> — planting the Core' };
    }
  } else if (playerRole() === 'guard' && match.planted) {
    const d = Math.hypot(match.planted.position.x - p.body.position.x, match.planted.position.z - p.body.position.z);
    if (d < 2.0) want = { type: 'defuse', need: DEFUSE_TIME, label: 'Hold <b>E</b> — defusing the Core' };
  }
  if (!want) { hud.interact(null); playerChannel = null; return; }
  if (holding && still) {
    if (!playerChannel || playerChannel.type !== want.type) playerChannel = { type: want.type, t: 0, need: want.need };
    playerChannel.t += dt;
    if (Math.floor(playerChannel.t * 2) !== Math.floor((playerChannel.t - dt) * 2)) audio.tick();
    hud.interact(want.label.replace(/<[^>]+>/g, ''), playerChannel.t / want.need);
    if (playerChannel.t >= want.need) {
      const done = playerChannel.type;
      playerChannel = null;
      hud.interact(null);
      if (done === 'plant') doPlant(p.body.position.clone(), playerProxy);
      else doDefuse(playerProxy);
    }
  } else {
    playerChannel = null;
    hud.interact(want.label, 0);
  }
}

// ---- per-frame -----------------------------------------------------------------------------
const wish = new THREE.Vector3();
let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();
let frozen = false;
let started = false;
let fovNow = 74;

hud.onPlay(() => {
  if (shot) return;
  audio.wake();
  if (match.phase === 'menu' || match.phase === 'matchover') startMatch();
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (match.phase !== 'menu' && match.phase !== 'matchover') {
    hud.showOverlay('paused');
  }
}

function fmtClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function step(dt) {
  elapsed += dt;
  const phase = match.phase;

  if (phase === 'freeze') {
    match.phaseT -= dt;
    hud.setTimer(fmtClock(match.phaseT), match.phaseT < 3);
    if (match.phaseT <= 0) {
      match.phase = 'live';
      hud.hideBuy();
      hud.banner('ROUND LIVE', playerRole() === 'strike' ? `The Core goes to site ${match.attackSite} — or anywhere you take it` : 'Hold the yard', 1800);
    }
  } else if (phase === 'live') {
    if (match.planted) {
      match.planted.t -= dt;
      hud.setTimer(fmtClock(match.planted.t), match.planted.t < 10);
      coreGroup.children[1].material.emissiveIntensity = 1 + Math.sin(elapsed * (match.planted.t < 10 ? 14 : 5)) * 0.9;
      if (match.planted.t <= 0) {
        audio.explosion();
        coreGroup.visible = false;
        endRound('strike', 'The Core detonated');
      }
    } else {
      match.clock -= dt;
      hud.setTimer(fmtClock(match.clock), match.clock < 15);
      if (match.clock <= 0) endRound('guard', 'Time expired — the yard holds');
    }
    bots.step(dt, elapsed);
    if (player.state.alive) {
      const keys = input.state.keys;
      const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      wish.set(0, 0, 0);
      if (forward || strafe) {
        const sin = Math.sin(player.state.yaw);
        const cos = Math.cos(player.state.yaw);
        wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
      }
      player.step(dt, keys, wish);
    }
    playerInteract(dt);
    checkRoundEnd();
  } else if (phase === 'over') {
    match.phaseT -= dt;
    if (match.phaseT <= 0) {
      const decided = match.scores.strike >= ROUNDS_TO_WIN || match.scores.guard >= ROUNDS_TO_WIN || match.round >= MAX_ROUNDS;
      if (decided) endMatch();
      else { match.round += 1; startRound(); }
    }
  }
  loadout.step(dt);
}

function handlePresses() {
  for (const code of input.takePresses()) {
    if (match.phase === 'freeze' && code.startsWith('Digit')) tryBuy(code.slice(5));
    else if (match.phase === 'live') {
      if (code === 'Digit1') {
        const primary = Object.keys(loadout.owned).find((id) => WEAPONS[id].slot === 'primary');
        if (primary) loadout.equip(primary);
      } else if (code === 'Digit2') loadout.equip('pistol');
      else if (code === 'KeyR' && loadout.reload()) audio.reload();
    }
  }
}

function syncCamera(dt) {
  const p = player.state;
  if (p.alive || match.phase === 'menu') {
    camera.position.set(p.body.position.x, p.body.position.y + p.eye, p.body.position.z);
    camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  } else {
    // Spectate: a slow orbit over the yard while the round plays out.
    const cx = match.planted ? match.planted.position.x : 0;
    const cz = match.planted ? match.planted.position.z : -4;
    const a = elapsed * 0.07;
    camera.position.set(cx + Math.sin(a) * 17, 15, cz + Math.cos(a) * 17);
    camera.lookAt(cx, 0, cz);
  }
  const scoped = input.state.aiming && loadout.def.scoped && p.alive;
  loadout.setScoped(scoped);
  hud.setScope(scoped && !shot);
  const targetFov = scoped ? 26 : 74;
  fovNow += (targetFov - fovNow) * Math.min(1, dt * 11);
  if (Math.abs(fovNow - camera.fov) > 0.05) {
    camera.fov = fovNow;
    camera.updateProjectionMatrix();
  }
}

function refreshHud() {
  const p = player.state;
  hud.setHealth(p.health, p.armor);
  hud.setMoney(p.money);
  hud.setAmmo(loadout.current.mag, loadout.current.reserve);
  hud.setWeaponName(loadout.def.name);
  hud.setCrosshairGap(3 + loadout.spread(player.groundSpeed()) * 620 + (input.state.aiming && loadout.def.scoped ? -2 : 0));
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    if (match.phase === 'live' || match.phase === 'freeze') {
      const look = input.takeLook();
      const sens = input.state.aiming && loadout.def.scoped ? 0.0009 : 0.0022;
      player.look(look.x, look.y, sens);
    }
    handlePresses();
    if (match.phase === 'live' && player.state.alive) {
      const firing = input.state.firing;
      const wantFire = firing && (loadout.def.auto || !prevFiring);
      if (wantFire && loadout.ready()) playerShoot();
      else if (firing && !loadout.def.auto && !prevFiring && loadout.current.mag === 0 && loadout.current.cooldown === 0) { audio.dryFire(); loadout.reload(); }
      prevFiring = firing;
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    for (let i = tracers.length - 1; i >= 0; i -= 1) {
      tracers[i].life -= dt;
      tracers[i].line.material.opacity = Math.max(0, tracers[i].life / 0.07) * 0.75;
      if (tracers[i].life <= 0) {
        scene.remove(tracers[i].line);
        tracers[i].line.geometry.dispose();
        tracers.splice(i, 1);
      }
    }
    syncCamera(dt);
    refreshHud();
  }
  renderer.render(scene, camera);
}

// ---- screenshot scenes ----------------------------------------------------------------------
function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimCameraAt(point) {
  const dx = point.x - camera.position.x;
  const dy = point.y - camera.position.y;
  const dz = point.z - camera.position.z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  player.state.yaw = yaw;
  player.state.pitch = pitch;
}

function placeShotBots() {
  bots.resetRound(spawnFor);
  const byName = (name) => bots.all.find((b) => b.name === name);
  const move = (bot, x, z, yaw) => {
    bot.body.position.set(x, 0, z);
    bot.yaw = yaw;
    bot.figure.group.position.set(x, 0, z);
    bot.figure.group.rotation.set(0, yaw, 0);
  };
  return { byName, move };
}

function runShot(name) {
  frozen = false;
  if (name !== 'start') hud.hideOverlay();
  if (name === 'start') {
    match.phase = 'menu';
    placeShotBots();
    camera.position.set(-7.5, 3.4, 17.5);
    aimCameraAt(new THREE.Vector3(2, 0.8, -14));
    hud.showOverlay('start');
  } else if (name === 'buy') {
    match.phase = 'freeze';
    match.attackSite = 'B';
    player.reset(world.spawns.strike[2]);
    const { byName, move } = placeShotBots();
    move(byName('Vex'), -2.5, 20.4, Math.PI);
    move(byName('Ondo'), 2.6, 20.8, Math.PI);
    move(byName('Pell'), -4.6, 22.8, Math.PI * 0.9);
    move(byName('Rusk'), 4.8, 22.6, Math.PI * 1.1);
    player.state.money = 3400;
    loadout.give('rifle');
    player.state.money = 700;
    camera.position.set(0, 1.6, 22);
    aimCameraAt(new THREE.Vector3(1.5, 1.1, 6));
    hud.setScores(2, 1);
    hud.setRound(4, MAX_ROUNDS);
    hud.setTimer('0:06');
    hud.setObjective('<b>Objective</b>Plant the Core at site A or B — or eliminate the Sentinels.');
    hud.showBuy(buyState());
  } else if (name === 'play') {
    match.phase = 'live';
    match.clock = 47;
    player.reset(new THREE.Vector3(-8.6, 0, 1.5));
    player.state.health = 72;
    player.state.armor = 55;
    player.state.money = 1250;
    loadout.give('rifle');
    loadout.current.mag = 17;
    const { byName, move } = placeShotBots();
    move(byName('Vex'), -6.4, -1.8, Math.PI * 0.82); // teammate covering from the plaza
    const talon = byName('Talon');
    move(talon, 1.8, -3.4, Math.PI * 1.45); // sentinel caught mid-plaza
    const ivo = byName('Ivo');
    ivo.damage(500, 'torso', player.state); // already down: the kill the feed reports
    move(ivo, 4.4, -6.4, Math.PI);
    ivo.figure.group.rotation.x = -1.5;
    move(byName('Mira'), 9.5, -9.5, Math.PI * 1.3);
    camera.position.set(-8.6, 1.6, 1.5);
    aimCameraAt(new THREE.Vector3(1.8, 1.25, -3.4));
    loadout.pullTrigger();
    loadout.flash = 0.06;
    loadout.step(0.001); // pose the view model mid-recoil with the muzzle flash lit
    hud.setScores(2, 1);
    hud.setRound(4, MAX_ROUNDS);
    hud.setTimer('0:47');
    hud.setObjective('<b>Objective</b>Plant the Core at site A or B — or eliminate the Sentinels.');
    hud.kill(['You', 'Ivo'], 'strike', 'guard');
    hud.hitMarker(false, 4000);
  } else {
    // end
    match.phase = 'matchover';
    match.scores = { strike: 5, guard: 3 };
    placeShotBots();
    player.state.kills = 11;
    player.state.deaths = 7;
    player.state.shots = 214;
    player.state.hits = 96;
    player.state.money = 4350;
    camera.position.set(9, 4.2, 14);
    aimCameraAt(new THREE.Vector3(-3, 0.5, -12));
    hud.setScores(5, 3);
    hud.setRound(8, MAX_ROUNDS);
    hud.setTimer('0:00');
    endMatch();
  }
  refreshHud();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Boot: a posed menu scene behind the start overlay, or the live game.
if (shot) {
  runShot(shot);
} else {
  match.phase = 'menu';
  bots.resetRound(spawnFor);
  player.reset(world.spawns.strike[2]);
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
