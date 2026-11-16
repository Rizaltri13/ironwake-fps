// The armoury: five original guns with distinct numbers, and the loadout that owns the
// player's pistol + primary, their magazines, view models, reloads and spread. Damage is
// resolved by whoever fires (main.js for the player, bots.js for bots) from this table.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, slot: 'sidearm',
    damage: 26, headMult: 3.2, gap: 0.27, auto: false, mag: 12, reserve: 48,
    reload: 1.3, spreadStill: 0.0035, spreadMove: 0.02, range: 55, pellets: 1, kick: 0.05,
  },
  smg: {
    id: 'smg', name: 'Raptor SMG', price: 1100, slot: 'primary',
    damage: 21, headMult: 3.0, gap: 0.068, auto: true, mag: 30, reserve: 90,
    reload: 1.7, spreadStill: 0.006, spreadMove: 0.03, range: 48, pellets: 1, kick: 0.032,
  },
  scatter: {
    id: 'scatter', name: 'Mule Scattergun', price: 1300, slot: 'primary',
    damage: 11, headMult: 1.6, gap: 0.88, auto: false, mag: 6, reserve: 24,
    reload: 2.6, spreadStill: 0.035, spreadMove: 0.05, range: 26, pellets: 7, kick: 0.14,
  },
  rifle: {
    id: 'rifle', name: 'VK-7 Rifle', price: 2700, slot: 'primary',
    damage: 34, headMult: 3.6, gap: 0.099, auto: true, mag: 30, reserve: 90,
    reload: 1.9, spreadStill: 0.0022, spreadMove: 0.028, range: 80, pellets: 1, kick: 0.055,
  },
  longshot: {
    id: 'longshot', name: 'Longshot DMR', price: 4300, slot: 'primary',
    damage: 96, headMult: 2.2, gap: 1.05, auto: false, mag: 5, reserve: 25,
    reload: 2.4, spreadStill: 0.0008, spreadMove: 0.05, range: 120, pellets: 1, kick: 0.16, scoped: true,
  },
};
export const BUY_ORDER = ['smg', 'scatter', 'rifle', 'longshot'];
export const ARMOR_PRICE = 650;
export const HELMET_PRICE = 1000; // vest + helmet together

const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.6, metalness: 0.3 });

function buildViewModel(id) {
  const model = new THREE.Group();
  const add = (geo, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  };
  if (id === 'pistol') {
    add(new THREE.BoxGeometry(0.055, 0.09, 0.2), bodyMat, 0, 0.01, -0.05);
    add(new THREE.BoxGeometry(0.05, 0.12, 0.06), gripMat, 0, -0.08, 0.05);
  } else if (id === 'smg') {
    add(new THREE.BoxGeometry(0.07, 0.09, 0.34), bodyMat, 0, 0, -0.08);
    add(new THREE.BoxGeometry(0.04, 0.04, 0.16), gripMat, 0, 0.02, -0.32);
    add(new THREE.BoxGeometry(0.045, 0.14, 0.05), gripMat, 0, -0.1, -0.02);
    add(new THREE.BoxGeometry(0.06, 0.07, 0.14), gripMat, 0, -0.01, 0.16);
  } else if (id === 'scatter') {
    add(new THREE.BoxGeometry(0.08, 0.09, 0.3), bodyMat, 0, 0, -0.02);
    add(new THREE.CylinderGeometry(0.032, 0.032, 0.42, 10), darkMat, 0, 0.03, -0.3).rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(0.07, 0.07, 0.18), gripMat, 0, -0.03, -0.22);
    add(new THREE.BoxGeometry(0.065, 0.08, 0.2), gripMat, 0, -0.02, 0.22);
  } else if (id === 'longshot') {
    add(new THREE.BoxGeometry(0.07, 0.09, 0.4), bodyMat, 0, 0, -0.08);
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 10), darkMat, 0, 0.03, -0.5).rotation.x = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 12), darkMat, 0, 0.09, -0.12).rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(0.06, 0.08, 0.24), gripMat, 0, -0.02, 0.26);
  } else {
    // VK-7 rifle (the starter's silhouette, fleshed out)
    add(new THREE.BoxGeometry(0.09, 0.1, 0.42), bodyMat, 0, 0, 0);
    add(new THREE.BoxGeometry(0.045, 0.045, 0.4), gripMat, 0, 0.025, -0.38);
    add(new THREE.BoxGeometry(0.075, 0.08, 0.22), gripMat, 0, -0.02, 0.3);
    add(new THREE.BoxGeometry(0.05, 0.13, 0.06), gripMat, 0, -0.11, 0.02);
    add(new THREE.BoxGeometry(0.03, 0.07, 0.03), darkMat, 0, 0.09, -0.3);
  }
  model.position.set(0.24, -0.2, -0.42);
  return model;
}

export function createLoadout(camera) {
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.17, 0.17),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  function freshState(def) {
    return { def, mag: def.mag, reserve: def.reserve, cooldown: 0, reloadLeft: 0 };
  }

  const loadout = {
    owned: { pistol: freshState(WEAPONS.pistol) },
    currentId: 'pistol',
    flash: 0,
    kick: 0,
    models: {},
    get current() { return this.owned[this.currentId]; },
    get def() { return this.current.def; },

    give(id) {
      this.owned[id] = freshState(WEAPONS[id]);
      this.equip(id);
    },
    hasPrimary() {
      return Object.keys(this.owned).some((id) => WEAPONS[id].slot === 'primary');
    },
    equip(id) {
      if (!this.owned[id] || id === this.currentId) return;
      this.currentId = id;
      this.current.reloadLeft = 0;
      syncModel();
    },
    resetRound(keepIds) {
      // New round: keep the guns in keepIds with fresh magazines; drop the rest.
      const next = { pistol: freshState(WEAPONS.pistol) };
      for (const id of keepIds) if (id !== 'pistol' && WEAPONS[id]) next[id] = freshState(WEAPONS[id]);
      this.owned = next;
      this.currentId = keepIds.find((id) => WEAPONS[id]?.slot === 'primary') ?? 'pistol';
      syncModel();
    },
    step(dt) {
      const cur = this.current;
      cur.cooldown = Math.max(0, cur.cooldown - dt);
      this.flash = Math.max(0, this.flash - dt);
      this.kick += (0 - this.kick) * Math.min(1, dt * 14);
      const model = this.models[this.currentId];
      if (model) {
        model.position.z = -0.42 + this.kick;
        model.rotation.x = this.kick * 2.2 + (cur.reloadLeft > 0 ? -0.55 * Math.min(1, (cur.def.reload - cur.reloadLeft) * 2) : 0);
      }
      flash.visible = this.flash > 0;
      flash.rotation.z = this.flash * 30;
      flashLight.intensity = this.flash > 0 ? 18 : 0;
      if (cur.reloadLeft > 0) {
        cur.reloadLeft = Math.max(0, cur.reloadLeft - dt);
        if (cur.reloadLeft === 0) {
          const take = Math.min(cur.def.mag - cur.mag, cur.reserve);
          cur.mag += take;
          cur.reserve -= take;
        }
      }
    },
    ready() {
      const cur = this.current;
      return cur.mag > 0 && cur.cooldown === 0 && cur.reloadLeft === 0;
    },
    takeRound() {
      const cur = this.current;
      if (cur.mag <= 0) return false;
      cur.mag -= 1;
      return true;
    },
    pullTrigger() {
      const cur = this.current;
      cur.cooldown = cur.def.gap;
      this.flash = 0.06;
      this.kick = cur.def.kick;
    },
    reload() {
      const cur = this.current;
      if (cur.reloadLeft > 0 || cur.mag === cur.def.mag || cur.reserve === 0) return false;
      cur.reloadLeft = cur.def.reload;
      return true;
    },
    spread(speed) {
      const def = this.def;
      return def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove;
    },
  };

  loadout.scopedNow = false;
  loadout.setScoped = function setScoped(on) {
    loadout.scopedNow = on;
    syncModel();
  };
  function syncModel() {
    for (const [id, model] of Object.entries(loadout.models)) model.visible = id === loadout.currentId && !loadout.scopedNow;
  }
  for (const id of Object.keys(WEAPONS)) {
    const model = buildViewModel(id);
    model.visible = false;
    camera.add(model);
    loadout.models[id] = model;
  }
  syncModel();
  return loadout;
}
