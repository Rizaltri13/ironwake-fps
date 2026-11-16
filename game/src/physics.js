// Shared body physics for the player and every bot: acceleration, friction, gravity,
// crouch and jump, resolved as a box against the world's colliders one axis at a time,
// so a wall never swallows a body. A body is a plain object:
//   { position, velocity, height, radius, onGround, crouching }
// and a wish is the caller's desired move direction on the ground plane.
import * as THREE from 'three';

export const STAND_HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.12;
export const WALK_SPEED = 5.2;
export const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function makeBody(x, z, radius = 0.34) {
  return {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    height: STAND_HEIGHT,
    radius,
    onGround: true,
    crouching: false,
  };
}

export function createMover(colliders) {
  const probe = new THREE.Box3();

  // lift keeps the feet and the crown out of the horizontal tests, so standing on the
  // floor is not read as walking into a wall.
  function overlaps(body, x, y, z, height, lift) {
    probe.min.set(x - body.radius, y + lift, z - body.radius);
    probe.max.set(x + body.radius, y + height - lift, z + body.radius);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function canStand(body) {
    return !overlaps(body, body.position.x, body.position.y, body.position.z, STAND_HEIGHT, 0.02);
  }

  // wish: THREE.Vector3 (only x/z read, need not be normalised). opts:
  // { crouch, jump, speed } — speed overrides the walk/crouch defaults.
  function step(body, dt, wish, opts = {}) {
    const wantCrouch = !!opts.crouch;
    if (wantCrouch && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!wantCrouch && body.crouching && canStand(body)) {
      body.crouching = false;
      body.height = STAND_HEIGHT;
    }

    const speed = opts.speed ?? (body.crouching ? CROUCH_SPEED : WALK_SPEED);
    const blend = Math.min(1, (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / Math.max(speed, 0.01));
    body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
    body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
    if (body.onGround && wish.x === 0 && wish.z === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }

    if (opts.jump && body.onGround) {
      body.velocity.y = JUMP_SPEED;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;

    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(body, nextX, body.position.y, body.position.z, body.height, 0.04)) body.position.x = nextX;
    else body.velocity.x = 0;
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body, body.position.x, body.position.y, nextZ, body.height, 0.04)) body.position.z = nextZ;
    else body.velocity.z = 0;

    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body, body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    body.velocity.y = Math.max(-30, body.velocity.y);
  }

  return { step, canStand, overlaps: (body, x, y, z, h, lift) => overlaps(body, x, y, z, h, lift) };
}
