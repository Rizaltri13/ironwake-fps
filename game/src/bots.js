// The other nine fighters: five Sentinels and five Strikers (one sits out on whichever
// team the player joins). Each bot is a physics body with a box-and-sphere figure, a
// bought weapon, a waypoint route and a small state machine: advance, hold, engage,
// plant, defuse, retake. Bots see through the arena's line-of-sight check, shoot with a
// distance-and-motion hit model, and take damage through the same table as the player.
import * as THREE from 'three';
import { PALETTE, teamColor } from './palette.js';
import { makeBody } from './physics.js';
import { WEAPONS } from './weapons.js';

const NAMES = {
  strike: ['Vex', 'Ondo', 'Pell', 'Rusk', 'Hale'],
  guard: ['Mira', 'Talon', 'Ivo', 'Sable', 'Wren'],
};
const EYE = 1.6;
const PLANT_TIME = 3.25;
const DEFUSE_TIME = 4.0;

export function createBots(scene, world, mover, fx) {
  const graph = world.graph;
  const bots = [];
  const hitMeshes = [];

  const mats = {
    strike: new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor('strike')), roughness: 0.65, metalness: 0.05 }),
    guard: new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor('guard')), roughness: 0.65, metalness: 0.05 }),
    ink: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6, metalness: 0.05 }),
    dark: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 }),
  };

  function buildFigure(team) {
    const group = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), mats[team]);
    torso.position.y = 1.06;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 12), mats.ink);
    head.position.y = 1.58;
    head.userData.part = 'head';
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.68, 0.2), mats.dark);
    legL.position.set(-0.13, 0.36, 0);
    const legR = legL.clone();
    legR.position.x = 0.13;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), mats.dark);
    gun.position.set(0.18, 1.28, -0.25);
    group.add(torso, head, legL, legR, gun);
    group.traverse((mesh) => { if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; } });
    scene.add(group);
    return { group, torso, head, legL, legR, gun };
  }

  for (const team of ['strike', 'guard']) {
    for (let index = 0; index < 5; index += 1) {
      const figure = buildFigure(team);
      const bot = {
        id: `${team}-${index}`,
        name: NAMES[team][index],
        team,
        index,
        isPlayer: false,
        body: makeBody(0, 24),
        figure,
        health: 100,
        armor: 0,
        helmet: false,
        alive: true,
        active: true,
        weaponId: 'pistol',
        money: 800,
        kills: 0,
        deaths: 0,
        yaw: team === 'strike' ? Math.PI : 0,
        pitch: 0,
        state: 'hold',
        path: [],
        goal: null,
        holdSpot: null,
        thinkAt: Math.random() * 0.2,
        seen: new Map(),
        target: null,
        reactAt: 0,
        burstLeft: 0,
        nextShotAt: 0,
        strafeDir: 1,
        strafeAt: 0,
        walkPhase: Math.random() * 6,
        fall: 0,
        channel: null,
        skill: 0.85 + Math.random() * 0.3,
        eyePos() {
          return new THREE.Vector3(this.body.position.x, this.body.position.y + (this.body.crouching ? 1.02 : EYE), this.body.position.z);
        },
        damage(amount, part, attacker) {
          if (!this.alive) return false;
          let dmg = amount; // the shooter already applied the head multiplier
          if (this.armor > 0) {
            const absorbed = dmg * 0.45;
            this.armor = Math.max(0, this.armor - absorbed);
            dmg -= absorbed;
          }
          this.health -= dmg;
          if (this.channel) this.channel = null;
          if (this.health > 0) return false;
          this.health = 0;
          this.alive = false;
          this.deaths += 1;
          this.fall = 0;
          if (attacker && attacker !== this) attacker.kills += 1;
          return true;
        },
        weaponDef() { return WEAPONS[this.weaponId]; },
      };
      figure.torso.userData.bot = bot;
      figure.head.userData.bot = bot;
      hitMeshes.push(figure.torso, figure.head);
      bots.push(bot);
    }
  }

  // ---- navigation ------------------------------------------------------------
  function nearestNode(pos) {
    let best = 0;
    let bestDist = Infinity;
    graph.nodes.forEach((node, index) => {
      const d = (node.x - pos.x) ** 2 + (node.z - pos.z) ** 2;
      if (d < bestDist) { bestDist = d; best = index; }
    });
    return best;
  }

  function findPath(fromPos, toPos) {
    const start = nearestNode(fromPos);
    const goal = nearestNode(toPos);
    if (start === goal) return [toPos.clone()];
    const prev = new Map([[start, -1]]);
    const queue = [start];
    while (queue.length) {
      const node = queue.shift();
      if (node === goal) break;
      for (const next of graph.edges.get(node) ?? []) {
        if (!prev.has(next)) { prev.set(next, node); queue.push(next); }
      }
    }
    if (!prev.has(goal)) return [toPos.clone()];
    const indices = [];
    for (let node = goal; node !== -1; node = prev.get(node)) indices.push(node);
    indices.reverse();
    return indices.map((index) => graph.nodes[index].clone()).concat([toPos.clone()]);
  }

  function sendTo(bot, point, then = 'hold') {
    bot.path = findPath(bot.body.position, point);
    bot.goal = point.clone();
    bot.state = 'advance';
    bot.thenState = then;
  }

  // ---- round setup -------------------------------------------------------------
  let attackSite = 'A';
  let planted = null; // { site, position }
  let playerTeam = 'strike';

  function holdSpots(siteKey, team) {
    const site = world.sites[siteKey];
    const c = site.center;
    // Four spots around the site: two close angles, two crossfires.
    return [
      new THREE.Vector3(c.x - 3.2, 0, c.z + 3.4),
      new THREE.Vector3(c.x + 3.4, 0, c.z + 2.8),
      new THREE.Vector3(c.x - 5.5, 0, c.z - 2.5),
      new THREE.Vector3(c.x + 5.8, 0, c.z - 3.2),
    ];
  }

  function planRound(opts) {
    attackSite = opts.attackSite;
    playerTeam = opts.playerTeam;
    planted = null;
    const otherSite = attackSite === 'A' ? 'B' : 'A';
    const strikers = bots.filter((b) => b.team === 'strike' && b.active && b.alive);
    const guards = bots.filter((b) => b.team === 'guard' && b.active && b.alive);
    // Strikers: three push the target site, one swings the other lane late, rest follow.
    strikers.forEach((bot, i) => {
      const site = i === 3 ? world.sites[otherSite] : world.sites[attackSite];
      const spot = site.center.clone();
      spot.x += (i % 2 ? 2.2 : -2.2);
      spot.z += 2.6;
      sendTo(bot, spot, 'push');
      bot.planDelay = i === 3 ? 14 : i * 0.7;
    });
    // Sentinels: two hold the attacked site's angles (they do not know which — they
    // split 2/2 with one mid), one watches mid from the plaza.
    const spotsA = holdSpots('A');
    const spotsB = holdSpots('B');
    guards.forEach((bot, i) => {
      if (i < 2) { bot.holdSpot = spotsA[i]; sendTo(bot, spotsA[i], 'hold'); }
      else if (i < 4) { bot.holdSpot = spotsB[i - 2]; sendTo(bot, spotsB[i - 2], 'hold'); }
      else { bot.holdSpot = new THREE.Vector3(0, 0, -6); sendTo(bot, bot.holdSpot, 'hold'); }
      bot.planDelay = 0;
    });
  }

  function setPlanted(siteKey, position) {
    planted = { site: siteKey, position: position.clone() };
    // Sentinels retake; strikers fall back to post-plant angles.
    for (const bot of bots) {
      if (!bot.active || !bot.alive) continue;
      if (bot.team === 'guard') {
        sendTo(bot, position.clone().add(new THREE.Vector3(bot.index % 2 ? 2.5 : -2.5, 0, 2.5)), 'retake');
      } else if (bot.state !== 'engage') {
        const spots = holdSpots(siteKey);
        const spot = spots[bot.index % spots.length];
        bot.holdSpot = spot;
        sendTo(bot, spot, 'hold');
      }
    }
  }

  function buyPhase() {
    for (const bot of bots) {
      if (!bot.active) continue;
      // Simple policy: keep a primary if owned; else rifle > smg > scatter by purse.
      const want = bot.money >= WEAPONS.rifle.price ? 'rifle' : bot.money >= WEAPONS.smg.price ? 'smg' : bot.money >= WEAPONS.scatter.price ? 'scatter' : null;
      if (want && WEAPONS[bot.weaponId].slot !== 'primary') {
        bot.money -= WEAPONS[want].price;
        bot.weaponId = want;
      }
      if (bot.money >= 1000 && !bot.helmet) { bot.money -= 1000; bot.armor = 100; bot.helmet = true; }
      else if (bot.money >= 650 && bot.armor <= 0) { bot.money -= 650; bot.armor = 100; }
    }
  }

  function resetRound(spawnFor) {
    for (const bot of bots) {
      const spawn = spawnFor(bot);
      bot.active = !!spawn;
      bot.figure.group.visible = bot.active;
      if (!spawn) continue;
      const diedLastRound = !bot.alive;
      bot.body = makeBody(spawn.x, spawn.z);
      bot.health = 100;
      bot.alive = true;
      bot.fall = 0;
      bot.channel = null;
      bot.target = null;
      bot.seen.clear();
      bot.state = 'hold';
      bot.path = [];
      bot.yaw = bot.team === 'strike' ? Math.PI : 0;
      if (diedLastRound) bot.weaponId = 'pistol'; // a dropped rifle stays dropped
      bot.figure.group.rotation.set(0, bot.yaw, 0);
      bot.figure.group.position.set(spawn.x, 0, spawn.z);
      bot.figure.group.scale.y = 1;
    }
  }

  // ---- perception & combat -------------------------------------------------------
  const tmpDir = new THREE.Vector3();

  function perceive(bot, time) {
    const eye = bot.eyePos();
    let bestTarget = null;
    let bestDist = Infinity;
    for (const foe of fx.foesOf(bot)) {
      if (!foe.alive) continue;
      const foeEye = foe.eyePos();
      const dist = eye.distanceTo(foeEye);
      if (dist > 70) continue;
      tmpDir.copy(foeEye).sub(eye).normalize();
      const facing = Math.sin(bot.yaw) * -tmpDir.x + Math.cos(bot.yaw) * -tmpDir.z; // 1 = dead ahead
      const inView = facing > -0.25 || dist < 7;
      if (!inView) continue;
      if (!fx.canSee(eye, foeEye)) continue;
      if (dist < bestDist) { bestDist = dist; bestTarget = foe; }
    }
    if (bestTarget) {
      if (bot.target !== bestTarget) { bot.target = bestTarget; bot.reactAt = time + (0.34 + Math.random() * 0.26) / bot.skill; }
      bot.seen.set(bestTarget.id, time);
    } else if (bot.target && time - (bot.seen.get(bot.target.id) ?? -9) > 1.6) {
      bot.target = null;
    }
  }

  function hitChance(bot, foe, dist) {
    let p = 0.46 - dist * 0.0062;
    p *= bot.skill;
    const speed = foe.body ? Math.hypot(foe.body.velocity.x, foe.body.velocity.z) : foe.groundSpeed();
    if (speed > 2.5) p *= 0.68;
    if (foe.body?.crouching || foe.crouching) p *= 0.85;
    return Math.max(0.07, Math.min(0.5, p));
  }

  function botShoot(bot, time) {
    const foe = bot.target;
    if (!foe || !foe.alive || time < bot.reactAt) return;
    if (bot.burstLeft <= 0) {
      if (time < bot.nextShotAt) return;
      bot.burstLeft = 2 + Math.floor(Math.random() * 4);
    }
    if (time < bot.nextShotAt) return;
    const def = bot.weaponDef();
    bot.nextShotAt = time + def.gap * (0.9 + Math.random() * 0.25);
    bot.burstLeft -= 1;
    if (bot.burstLeft === 0) bot.nextShotAt = time + 0.38 + Math.random() * 0.4;

    const from = bot.eyePos();
    from.y -= 0.12;
    const foeEye = foe.eyePos();
    const dist = from.distanceTo(foeEye);
    const hit = Math.random() < hitChance(bot, foe, dist);
    const part = hit && Math.random() < 0.16 ? 'head' : 'torso';
    const aimAt = foeEye.clone();
    aimAt.y -= part === 'head' ? 0.05 : 0.45;
    if (!hit) { aimAt.x += (Math.random() - 0.5) * 1.6; aimAt.y += (Math.random() - 0.3) * 0.9; aimAt.z += (Math.random() - 0.5) * 1.6; }
    fx.tracer(from, aimAt, bot.team);
    fx.sfx('shot', def.id, from);
    if (hit) {
      const falloff = dist > def.range ? 0.45 : 1;
      const amount = def.damage * (part === 'head' ? def.headMult : 1) * falloff;
      fx.hurt(foe, amount, part, bot);
    }
  }

  // ---- per-frame -------------------------------------------------------------------
  const wish = new THREE.Vector3();

  function stepBot(bot, dt, time) {
    const figure = bot.figure.group;
    if (!bot.active) return;
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      figure.rotation.x = -bot.fall * 1.5;
      figure.position.set(bot.body.position.x, bot.body.position.y + 0.12 - bot.fall * 0.1, bot.body.position.z);
      figure.rotation.y = bot.yaw;
      return;
    }
    if (bot.planDelay > 0) bot.planDelay -= dt;

    if (time >= bot.thinkAt) {
      bot.thinkAt = time + 0.12;
      perceive(bot, time);
    }

    let moveTarget = null;
    let crouch = false;
    let speed = undefined;

    if (bot.channel) {
      crouch = true;
      bot.channel.t += dt;
      if (bot.channel.t >= bot.channel.need) {
        const done = bot.channel;
        bot.channel = null;
        fx.onChannel(bot, done.type);
      }
    } else if (bot.target && bot.target.alive && time - (bot.seen.get(bot.target.id) ?? -9) < 0.4) {
      // Engage: face the target, strafe, fire.
      const foeEye = bot.target.eyePos();
      bot.yaw = Math.atan2(-(foeEye.x - bot.body.position.x), -(foeEye.z - bot.body.position.z));
      bot.pitch = Math.atan2(foeEye.y - bot.eyePos().y, Math.hypot(foeEye.x - bot.body.position.x, foeEye.z - bot.body.position.z));
      if (time >= bot.strafeAt) { bot.strafeAt = time + 0.7 + Math.random() * 0.8; bot.strafeDir = Math.random() < 0.5 ? -1 : 1; }
      const dist = bot.body.position.distanceTo(bot.target.body.position);
      if (dist > 9) moveTarget = bot.target.body.position;
      else {
        wish.set(Math.cos(bot.yaw) * bot.strafeDir, 0, -Math.sin(bot.yaw) * bot.strafeDir);
        moveTarget = null;
        mover.step(bot.body, dt, wish, { crouch: bot.body.crouching && Math.random() < 0.9, speed: 3.4 });
        botShoot(bot, time);
        animate(bot, dt);
        return;
      }
      botShoot(bot, time);
    } else if (bot.state === 'advance' && bot.path.length) {
      moveTarget = bot.path[0];
      const d = Math.hypot(moveTarget.x - bot.body.position.x, moveTarget.z - bot.body.position.z);
      if (d < 0.8) {
        bot.path.shift();
        if (!bot.path.length) arrive(bot);
      }
    } else if (bot.state === 'push') {
      // In the site: the carrier plants (only when the player is not the striker who
      // must do it); others take angles.
      const site = world.sites[attackSite];
      const distSite = Math.hypot(site.center.x - bot.body.position.x, site.center.z - bot.body.position.z);
      if (fx.playerTeam() !== 'strike' && bot.index === 0 && distSite < site.radius && !planted) {
        bot.channel = { type: 'plant', t: 0, need: PLANT_TIME };
        crouch = true;
      } else {
        bot.state = 'hold';
        bot.holdSpot = bot.body.position.clone();
      }
    } else if (bot.state === 'retake' && planted) {
      const d = Math.hypot(planted.position.x - bot.body.position.x, planted.position.z - bot.body.position.z);
      if (d < 1.6 && bot.team === 'guard') {
        bot.channel = { type: 'defuse', t: 0, need: DEFUSE_TIME };
        crouch = true;
      } else {
        moveTarget = planted.position; // the site yards are open; walk straight in
      }
    }

    if (moveTarget) {
      const dx = moveTarget.x - bot.body.position.x;
      const dz = moveTarget.z - bot.body.position.z;
      const len = Math.hypot(dx, dz) || 1;
      wish.set(dx / len, 0, dz / len);
      if (bot.planDelay <= 0) mover.step(bot.body, dt, wish, { speed });
      bot.yaw = Math.atan2(-dx, -dz);
      bot.pitch = 0;
    } else {
      wish.set(0, 0, 0);
      mover.step(bot.body, dt, wish, { crouch });
      if (bot.state === 'hold') {
        // Scan: slow sweep toward the likeliest approach.
        bot.yaw += Math.sin(time * 0.4 + bot.index * 1.7) * dt * 0.35;
      }
    }
    animate(bot, dt);
  }

  function arrive(bot) {
    if (bot.thenState === 'push') bot.state = 'push';
    else if (bot.thenState === 'retake') bot.state = 'retake';
    else bot.state = 'hold';
  }

  function animate(bot, dt) {
    const figure = bot.figure.group;
    const speed = Math.hypot(bot.body.velocity.x, bot.body.velocity.z);
    bot.walkPhase += dt * speed * 2.4;
    const swing = Math.sin(bot.walkPhase) * Math.min(1, speed / 3) * 0.5;
    bot.figure.legL.rotation.x = swing;
    bot.figure.legR.rotation.x = -swing;
    figure.position.copy(bot.body.position);
    figure.rotation.set(0, bot.yaw, 0);
    bot.figure.gun.rotation.x = -bot.pitch;
    const targetHeight = bot.body.crouching ? 0.78 : 1;
    figure.scale.y += (targetHeight - figure.scale.y) * Math.min(1, dt * 10);
  }

  function step(dt, time) {
    for (const bot of bots) stepBot(bot, dt, time);
  }

  return {
    all: bots,
    hitMeshes,
    step,
    planRound,
    setPlanted,
    buyPhase,
    resetRound,
    aliveCount(team) { return bots.filter((b) => b.team === team && b.active && b.alive).length; },
    teamBots(team) { return bots.filter((b) => b.team === team); },
  };
}
