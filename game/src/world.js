// The map: Foundry District, an original industrial yard built from boxes and barrels.
// Two plant sites (A west, B east), a central plaza, three lanes north, spawn yards at
// both ends. Every solid box is a collider and a surface a bullet stops on. The module
// also exports the waypoint graph the bots navigate by, the site zones and the spawns.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ward' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  const glowAccent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.9, roughness: 0.4 });
  const glowWard = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ward), emissive: new THREE.Color(PALETTE.ward), emissiveIntensity: 0.9, roughness: 0.4 });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material] ?? material);
    mesh.position.set(x, y, z);
    mesh.castShadow = solid;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function barrel(x, z) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 14), materials.hairline);
    mesh.position.set(x, 0.525, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.42, 0, z - 0.42), new THREE.Vector3(x + 0.42, 1.05, z + 0.42)));
    shootables.push(mesh);
    return mesh;
  }

  // Ground and the perimeter: a 52 x 52 m yard, 5 m walls, open sky.
  box(53.2, 0.4, 53.2, 0, -0.2, 0, 'canvas');
  box(0.6, 5, 53.2, -26.3, 2.5, 0, 'surface');
  box(0.6, 5, 53.2, 26.3, 2.5, 0, 'surface');
  box(53.2, 5, 0.6, 0, 2.5, -26.3, 'surface');
  box(53.2, 5, 0.6, 0, 2.5, 26.3, 'surface');
  // Lane guide strips on the ground (visual only, paper thin).
  box(3.2, 0.03, 44, -23, 0.015, 0, 'surface', false);
  box(3.2, 0.03, 44, 23, 0.015, 0, 'surface', false);
  box(46, 0.03, 3.2, 0, 0.015, 0, 'surface', false);

  // Buildings: big blocks that carve the yard into lanes.
  box(10, 5.5, 14, -16, 2.75, -4, 'surface'); // west warehouse (A sits north of it)
  box(10, 5.5, 14, 16, 2.75, -4, 'surface'); // east warehouse (B sits north of it)
  box(8, 5, 8, 0, 2.5, -14, 'surface'); // north-mid block, splits the A/B approaches
  box(10, 4.5, 6, 0, 2.25, 8, 'surface'); // south-mid block, splits the spawn yard exits
  box(8, 4, 6, -16, 2, 10, 'surface'); // west-mid block
  box(8, 4, 6, 16, 2, 10, 'surface'); // east-mid block
  // Warehouse roof trim and door lintels, so the blocks read as buildings.
  box(10.6, 0.35, 14.6, -16, 5.65, -4, 'hairline');
  box(10.6, 0.35, 14.6, 16, 5.65, -4, 'hairline');
  box(2.6, 0.5, 0.5, -11, 3.4, -4, 'accent');
  box(2.6, 0.5, 0.5, 11, 3.4, -4, 'ward');

  // Plaza pillars.
  for (const [x, z] of [[-5.5, -5], [5.5, -5], [-5.5, 3], [5.5, 3]]) box(1.1, 4.2, 1.1, x, 2.1, z, 'hairline');

  // Cover crates and barrels, placed at the angles fights actually happen on.
  const crates = [
    [-23, 6, 1.15], [-23, -9, 1.15], [-13.5, -14, 1.15], [-19, -19.5, 1.15], [-16, -12.8, 2.3],
    [23, 6, 1.15], [23, -9, 1.15], [13.5, -14, 1.15], [19, -19.5, 1.15], [16, -12.8, 2.3],
    [-3.4, -1, 1.15], [3.4, -1, 1.15], [0, -7.5, 2.3], [-8.5, 5.5, 1.15], [8.5, 5.5, 1.15],
    [-16, 17.5, 1.15], [16, 17.5, 1.15], [0, 15.5, 2.3], [-7, -13, 1.15], [7, -13, 1.15],
    [-23, 17, 2.3], [23, 17, 2.3], [-8.5, -19, 1.15], [8.5, -19, 1.15],
  ];
  for (const [x, z, w] of crates) box(w, 1.1, 1.15, x, 0.55, z, 'hairline');
  for (const [x, z] of [[-21, -16], [-11.5, -19], [21, -16], [11.5, -19], [-1.8, 12.5], [1.8, 12.5], [-23.5, -2], [23.5, -2]]) barrel(x, z);

  // Sites: a marked plate, corner posts and a glowing beacon pillar each.
  function site(cx, cz, glow, tintName) {
    box(7.4, 0.05, 7.4, cx, 0.025, cz, tintName, false);
    for (const [dx, dz] of [[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6]]) box(0.28, 1.5, 0.28, cx + dx, 0.75, cz + dz, 'hairline');
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.4, 0.3), glow);
    beacon.position.set(cx, 1.7, cz);
    group.add(beacon);
    const light = new THREE.PointLight(new THREE.Color(tintName === 'accent' ? PALETTE.accent : PALETTE.ward), 14, 13);
    light.position.set(cx, 3.2, cz);
    scene.add(light);
    return { center: new THREE.Vector3(cx, 0, cz), radius: 3.9 };
  }
  const sites = { A: site(-16, -16.5, glowAccent, 'accent'), B: site(17, -16.5, glowWard, 'ward') };

  // Light: a warm key from the south-east, a cool fill, and a sky/ground gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.muted), new THREE.Color(PALETTE.surface), 1.35);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 2.7);
  key.position.set(18, 26, 14);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -32;
  key.shadow.camera.right = 32;
  key.shadow.camera.top = 32;
  key.shadow.camera.bottom = -32;
  key.shadow.camera.far = 80;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.95);
  fill.position.set(-14, 16, -18);
  scene.add(fill);

  const spawns = {
    strike: [[-16, 22], [-8, 22.6], [0, 22], [8, 22.6], [16, 22]].map(([x, z]) => new THREE.Vector3(x, 0, z)),
    guard: [[-20, -22.5], [-12, -22.8], [0, -22], [12, -22.8], [20, -22.5]].map(([x, z]) => new THREE.Vector3(x, 0, z)),
  };

  // Waypoint graph: nodes at lane junctions, edges a bot may walk in a straight line.
  const nodeList = [
    [-16, 21], [0, 21.5], [16, 21], // 0-2 striker spawn yard
    [-23, 12], [-8, 12], [8, 12], [23, 12], // 3-6 south junctions
    [-23, -2], [-8, 0], [0, -1], [8, 0], [23, -2], // 7-11 lanes + plaza
    [-7, -8], [7, -8], // 12-13 A/B links
    [-16, -16.5], [17, -16.5], // 14-15 sites A/B
    [-16, -21.5], [0, -21.5], [17, -21.5], // 16-18 sentinel back line
    [-23, -15], [23, -15], // 19-20 lane heads into the site yards
  ];
  const nodes = nodeList.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const edgePairs = [
    [0, 3], [0, 4], [1, 4], [1, 5], [1, 2], [2, 5], [2, 6],
    [3, 7], [4, 8], [5, 10], [6, 11],
    [7, 19], [8, 9], [9, 10], [8, 12], [10, 13],
    [12, 14], [13, 15], [11, 20],
    [14, 16], [14, 19], [15, 18], [15, 20],
    [16, 17], [17, 18], [12, 16], [13, 18],
  ];
  const edges = new Map();
  for (const [a, b] of edgePairs) {
    if (!edges.has(a)) edges.set(a, []);
    if (!edges.has(b)) edges.set(b, []);
    edges.get(a).push(b);
    edges.get(b).push(a);
  }

  return { colliders, shootables, group, sites, spawns, graph: { nodes, edges } };
}
