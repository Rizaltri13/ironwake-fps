// The player's body: a physics body from physics.js plus look angles, an eye height
// that eases between standing and crouching, health and armour. Combat numbers live in
// main.js; this module is movement and state only.
import { makeBody, STAND_HEIGHT } from './physics.js';

const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;

export function createPlayer(mover, spawn) {
  const body = makeBody(spawn.x, spawn.z);
  const player = {
    body,
    yaw: Math.PI, // face north, toward the sites
    pitch: 0,
    eye: STAND_EYE,
    health: 100,
    armor: 0,
    helmet: false,
    alive: true,
    money: 800,
    kills: 0,
    deaths: 0,
    shots: 0,
    hits: 0,
  };

  function look(dx, dy, sensitivity = 0.0022) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(1.45, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  function step(dt, keys, wish) {
    const walking = (keys.has('ShiftLeft') || keys.has('ShiftRight')) && !body.crouching;
    mover.step(body, dt, wish, {
      crouch: keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC'),
      jump: keys.has('Space'),
      speed: walking ? 2.7 : undefined,
    });
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);
  }

  function reset(spawnPoint, money) {
    body.position.set(spawnPoint.x, 0, spawnPoint.z);
    body.velocity.set(0, 0, 0);
    body.height = STAND_HEIGHT;
    body.crouching = false;
    player.yaw = Math.PI;
    player.pitch = 0;
    player.eye = STAND_EYE;
    player.health = 100;
    player.alive = true;
    if (money !== undefined) player.money = money;
  }

  return {
    state: player,
    step,
    look,
    recoil,
    reset,
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
    eyePos() {
      return { x: body.position.x, y: body.position.y + player.eye, z: body.position.z };
    },
  };
}
