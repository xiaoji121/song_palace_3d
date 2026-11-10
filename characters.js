import * as THREE from 'three';

// Metres, soles at zero, face toward +Z. All factories share these resources.
const TAU = Math.PI * 2;
const BASE_HEIGHT = 1.8;
const materials = new Map();
function material(color, cloth = false) {
  const key = `${new THREE.Color(color).getHexString()}:${cloth}`;
  if (!materials.has(key)) {
    materials.set(key, new THREE.MeshStandardMaterial({
      color, roughness: cloth ? 0.98 : 0.76, metalness: 0,
      vertexColors: cloth,
    }));
  }
  return materials.get(key);
}

function garment(rings, segments = 32, pleats = 0.018) {
  const positions = [], colors = [], indices = [];
  for (let r = 0; r < rings.length; r++) {
    const [y, rx, rz] = rings[r];
    for (let s = 0; s <= segments; s++) {
      const a = s / segments * TAU;
      const fold = 1 + Math.cos(a * 12) * pleats;
      positions.push(Math.sin(a) * rx * fold, y, Math.cos(a) * rz * fold);
      const shade = 0.94 + Math.cos(a * 12) * 0.035;
      colors.push(shade, shade, shade);
      if (r < rings.length - 1 && s < segments) {
        const i = r * (segments + 1) + s, j = i + segments + 1;
        indices.push(i, i + 1, j, i + 1, j + 1, j);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

const geometry = {
  sphere: new THREE.SphereGeometry(1, 16, 12),
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 20),
  torso: garment([
    [0, 0, 0], [0, 0.177, 0.104], [0.12, 0.19, 0.117],
    [0.32, 0.235, 0.126], [0.4, 0.208, 0.112],
    [0.45, 0.095, 0.077], [0.45, 0, 0],
  ]),
  skirt: garment([
    [0, 0, 0], [0, 0.292, 0.169], [0.06, 0.285, 0.164],
    [0.32, 0.247, 0.146], [0.61, 0.2, 0.124],
    [0.75, 0.178, 0.108], [0.75, 0, 0],
  ], 40, 0.035),
  sleeve: garment([
    [-0.53, 0, 0], [-0.53, 0.118, 0.1], [-0.44, 0.145, 0.115],
    [-0.26, 0.134, 0.11], [-0.08, 0.107, 0.096],
    [0, 0.075, 0.075], [0, 0, 0],
  ]),
  hair: new THREE.SphereGeometry(1, 20, 12, 0, TAU, 0, 1.75),
};
for (const g of [geometry.sphere, geometry.box, geometry.cylinder, geometry.hair]) {
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
}
const hairMaterial = material('#292820');
const bootMaterial = material('#36332c');
const soleMaterial = material('#827568');
const eyeMaterial = material('#30291f');
const eyeWhite = material('#e6d6bd');
const mouthMaterial = material('#9f6555');

function mesh(parent, shape, surface, x, y, z, sx, sy, sz) {
  const part = new THREE.Mesh(shape, surface);
  part.position.set(x, y, z);
  part.scale.set(sx, sy, sz);
  part.castShadow = true;
  part.receiveShadow = true;
  parent.add(part);
  return part;
}
function bar(parent, surface, a, b, width, depth = width) {
  const midpoint = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const direction = new THREE.Vector3().subVectors(b, a);
  const part = mesh(parent, geometry.box, surface,
    midpoint.x, midpoint.y, midpoint.z, width, direction.length(), depth);
  part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return part;
}

export function createCharacter({
  robeColor = '#82654b', trimColor = '#c6b18a', skinColor = '#c99f7d',
  hatStyle = 'cloth', height = 1.72,
} = {}) {
  const group = new THREE.Group();
  group.name = 'Song daily-wear character';
  const scale = Number.isFinite(height) && height > 0 ? height / BASE_HEIGHT : 1.72 / BASE_HEIGHT;
  group.scale.setScalar(scale);
  const cloth = material(robeColor, true), trim = material(trimColor, true);
  const skin = material(skinColor);
  const warmSkin = material(new THREE.Color(skinColor).multiplyScalar(0.87));
  const darkCloth = material(new THREE.Color(robeColor).multiplyScalar(0.65), true);
  const body = new THREE.Group();
  group.add(body);
  const torso = mesh(body, geometry.torso, cloth, 0, 0.96, 0, 1, 1, 1);
  const skirt = mesh(body, geometry.skirt, cloth, 0, 0.23, 0, 1, 1, 1);
  mesh(body, geometry.cylinder, darkCloth, 0, 0.975, 0, 0.187, 0.055, 0.118);
  bar(body, trim, new THREE.Vector3(-0.1, 1.39, 0.08), new THREE.Vector3(0.13, 1.16, 0.128), 0.035, 0.016);
  bar(body, trim, new THREE.Vector3(0.1, 1.39, 0.08), new THREE.Vector3(-0.13, 0.995, 0.13), 0.039, 0.018);
  mesh(body, geometry.sphere, trim, 0.11, 0.975, 0.123, 0.027, 0.023, 0.016);
  const ties = [];
  for (const side of [-1, 1]) {
    const tie = mesh(body, geometry.box, trim, 0.11 + side * 0.025, 0.862, 0.137, 0.022, 0.2, 0.012);
    tie.rotation.z = side * 0.13;
    ties.push(tie);
  }
  // Thin raised seams follow the actual flare instead of floating straight rods.
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 0.083;
    bar(body, darkCloth,
      new THREE.Vector3(x * 0.63, 0.925, 0.119 * Math.sqrt(1 - (x / 0.3) ** 2)),
      new THREE.Vector3(x, 0.28, 0.17 * Math.sqrt(1 - (x / 0.3) ** 2)),
      0.005, 0.004);
  }
  mesh(body, geometry.cylinder, darkCloth, 0, 0.247, 0, 0.294, 0.024, 0.172);

  const head = new THREE.Group();
  head.position.y = 1.545;
  body.add(head);
  mesh(body, geometry.cylinder, skin, 0, 1.405, 0, 0.057, 0.12, 0.054);
  mesh(head, geometry.sphere, skin, 0, 0, 0, 0.116, 0.155, 0.105);
  for (const side of [-1, 1]) {
    mesh(head, geometry.sphere, skin, side * 0.114, -0.004, -0.002, 0.023, 0.04, 0.021);
    mesh(head, geometry.sphere, warmSkin, side * 0.127, -0.003, 0.009, 0.008, 0.023, 0.009);
  }
  mesh(head, geometry.sphere, skin, 0, -0.007, 0.101, 0.019, 0.04, 0.022);
  mesh(head, geometry.sphere, warmSkin, 0, -0.024, 0.117, 0.022, 0.014, 0.017);
  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(side * 0.044, 0.024, 0.091);
    head.add(eye);
    mesh(eye, geometry.sphere, eyeWhite, 0, 0, 0, 0.023, 0.009, 0.011);
    mesh(eye, geometry.sphere, eyeMaterial, -side * 0.002, 0, 0.009, 0.008, 0.008, 0.004);
    eyes.push(eye);
    const brow = mesh(head, geometry.sphere, hairMaterial, side * 0.044, 0.049, 0.094, 0.027, 0.0045, 0.004);
    brow.rotation.z = -side * 0.1;
  }
  mesh(head, geometry.sphere, mouthMaterial, 0, -0.068, 0.093, 0.03, 0.0035, 0.004);
  mesh(head, geometry.sphere, warmSkin, 0, -0.078, 0.092, 0.02, 0.004, 0.004);
  mesh(head, geometry.hair, hairMaterial, 0, 0.02, -0.012, 0.119, 0.14, 0.105);
  mesh(head, geometry.sphere, hairMaterial, 0, 0.202, -0.037, 0.048, 0.053, 0.046);
  const hatCloth = hatStyle === 'cloth' ? darkCloth : hairMaterial;
  if (hatStyle === 'scholar') {
    mesh(head, geometry.box, hatCloth, 0, 0.146, -0.01, 0.23, 0.12, 0.18);
    for (const side of [-1, 1]) {
      const flap = mesh(head, geometry.box, hatCloth, side * 0.11, 0.09, -0.067, 0.045, 0.15, 0.065);
      flap.rotation.z = side * 0.13;
    }
  } else if (hatStyle !== 'bun') {
    mesh(head, geometry.hair, hatCloth, 0, 0.05, -0.013,
      0.125, hatStyle === 'cap' ? 0.15 : 0.125, 0.113);
  }
  if (hatStyle !== 'bun') {
    mesh(head, geometry.cylinder, hatCloth, 0, 0.103, -0.009, 0.123, 0.033, 0.111);
    for (const side of [-1, 1]) {
      const tail = mesh(head, geometry.box, hatCloth, side * 0.039, 0.012, -0.111, 0.032, 0.17, 0.012);
      tail.rotation.z = side * 0.16;
    }
  }

  const arms = [], legs = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.233, 1.33, 0);
    arm.rotation.z = side * 0.1;
    body.add(arm);
    mesh(arm, geometry.sleeve, cloth, 0, 0, 0, 1, 1, 1);
    mesh(arm, geometry.cylinder, trim, 0, -0.525, 0, 0.12, 0.029, 0.103);
    mesh(arm, geometry.sphere, skin, 0, -0.579, 0.012, 0.043, 0.06, 0.027);
    for (let finger = 0; finger < 3; finger++) {
      mesh(arm, geometry.sphere, skin, (finger - 1) * 0.021, -0.628, 0.018, 0.011, 0.031 - Math.abs(finger - 1) * 0.005, 0.013);
    }
    const thumb = mesh(arm, geometry.sphere, skin, -side * 0.044, -0.581, 0.028, 0.016, 0.032, 0.017);
    thumb.rotation.z = -side * 0.42;
    arms.push(arm);

    const leg = new THREE.Group();
    leg.position.set(side * 0.105, 0.83, 0);
    group.add(leg);
    mesh(leg, geometry.cylinder, darkCloth, 0, -0.355, 0, 0.063, 0.71, 0.064);
    mesh(leg, geometry.sphere, bootMaterial, 0, -0.74, 0.039, 0.077, 0.076, 0.133);
    mesh(leg, geometry.box, soleMaterial, 0, -0.815, 0.043, 0.144, 0.03, 0.235);
    legs.push(leg);
  }

  let previousTime, gait = 0, motion = 0;
  const parentRotation = new THREE.Quaternion();
  const parentEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  function update(time, { lookYaw, walking = false, speed = 1 } = {}) {
    if (!Number.isFinite(time)) return;
    const dt = previousTime === undefined ? 1 / 60 : Math.max(0, Math.min(0.1, time - previousTime));
    previousTime = time;
    if (Number.isFinite(lookYaw)) {
      let parentYaw = 0;
      if (group.parent) {
        group.parent.getWorldQuaternion(parentRotation);
        parentEuler.setFromQuaternion(parentRotation, 'YXZ');
        parentYaw = parentEuler.y;
      }
      const target = lookYaw - parentYaw;
      const delta = Math.atan2(Math.sin(target - group.rotation.y), Math.cos(target - group.rotation.y));
      group.rotation.y += delta * (1 - Math.exp(-9 * dt));
    }
    const pace = Number.isFinite(speed) ? Math.max(0, Math.min(3, speed)) : 1;
    motion += ((walking && pace > 0 ? 1 : 0) - motion) * (1 - Math.exp(-10 * dt));
    gait += dt * 7 * pace;
    const stride = Math.sin(gait) * 0.31 * motion;
    const lift = Math.abs(Math.sin(gait)) * 0.032 * motion;
    body.position.y = Math.sin(time * 1.8) * 0.0035 + lift;
    torso.scale.z = 1 + Math.sin(time * 1.8) * 0.009;
    skirt.rotation.z = Math.sin(gait) * 0.016 * motion;
    head.rotation.y = Math.sin(time * 0.57) * 0.032 * (1 - motion);
    head.rotation.x = Math.sin(time * 1.1) * 0.012;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      legs[i].rotation.x = side * stride;
      legs[i].position.y = 0.83 + Math.max(0, -side * Math.sin(gait)) * 0.035 * motion;
      arms[i].rotation.x = -side * stride * 0.8 + Math.sin(time * 1.4 + i) * 0.025 * (1 - motion);
      arms[i].rotation.z = side * (0.1 + Math.sin(time * 1.1) * 0.012);
      ties[i].rotation.x = Math.sin(gait + i * 0.5) * 0.08 * motion;
    }
    const blinkPhase = ((time % 4.7) + 4.7) % 4.7;
    const blink = blinkPhase < 0.16 ? 1 - Math.sin(blinkPhase / 0.16 * Math.PI) * 0.94 : 1;
    for (const eye of eyes) eye.scale.y = blink;
  }
  return { group, update };
}

// Merge only the small LOD face into one vertex-coloured geometry, no loader.
let crowdFace;
function getCrowdFace() {
  if (crowdFace) return crowdFace;
  const positions = [], normals = [], colors = [];
  const matrix = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3();
  const position = new THREE.Vector3(), normal = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const sphere = geometry.sphere.toNonIndexed();
  function append(color, x, y, z, sx, sy, sz) {
    matrix.compose(new THREE.Vector3(x, y, z), quaternion, new THREE.Vector3(sx, sy, sz));
    normalMatrix.getNormalMatrix(matrix);
    const tint = new THREE.Color(color);
    const p = sphere.attributes.position, n = sphere.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      position.fromBufferAttribute(p, i).applyMatrix4(matrix);
      normal.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
      positions.push(position.x, position.y, position.z);
      normals.push(normal.x, normal.y, normal.z);
      colors.push(tint.r, tint.g, tint.b);
    }
  }
  append('#c99f7d', 0, 0, 0, 0.116, 0.155, 0.105);
  append('#c99f7d', 0, -0.01, 0.107, 0.02, 0.032, 0.024);
  append('#9f6555', 0, -0.068, 0.094, 0.028, 0.004, 0.005);
  for (const side of [-1, 1]) {
    append('#c99f7d', side * 0.115, 0, 0, 0.02, 0.037, 0.02);
    append('#30291f', side * 0.043, 0.023, 0.097, 0.014, 0.007, 0.005);
    append('#30291f', side * 0.043, 0.048, 0.095, 0.023, 0.004, 0.005);
  }
  sphere.dispose();
  crowdFace = new THREE.BufferGeometry();
  crowdFace.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  crowdFace.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  crowdFace.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return crowdFace;
}

export function createCrowd({ capacity = 72 } = {}) {
  capacity = Number.isFinite(capacity) ? Math.max(0, Math.floor(capacity)) : 72;
  const group = new THREE.Group();
  group.name = 'Song pedestrian LOD';
  const cloth = material('#ffffff', true);
  const skin = material('#c99f7d');
  const parts = [];
  function part(name, shape, surface, tint = false) {
    const instance = new THREE.InstancedMesh(shape, surface, capacity);
    instance.name = name;
    instance.count = 0;
    instance.frustumCulled = false;
    instance.castShadow = true;
    instance.receiveShadow = true;
    instance.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (tint) {
      instance.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      instance.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    group.add(instance);
    parts.push(instance);
    return instance;
  }
  const torso = part('shouldered robe', geometry.torso, cloth, true);
  const skirt = part('pleated hem', geometry.skirt, cloth, true);
  const head = part('face with ears and features', getCrowdFace(), material('#ffffff', true));
  const neck = part('neck', geometry.cylinder, skin);
  const hat = part('cloth cap', geometry.hair, hairMaterial);
  const belt = part('waist sash', geometry.cylinder, bootMaterial);
  const sleeves = [], hands = [], legs = [], shoes = [];
  for (const side of ['left', 'right']) {
    sleeves.push(part(`${side} sleeve`, geometry.sleeve, cloth, true));
    hands.push(part(`${side} hand`, geometry.sphere, skin));
    legs.push(part(`${side} leg`, geometry.cylinder, bootMaterial));
    shoes.push(part(`${side} shoe`, geometry.sphere, bootMaterial));
  }
  let count = 0;
  const root = new THREE.Matrix4(), local = new THREE.Matrix4(), result = new THREE.Matrix4();
  const translation = new THREE.Vector3(), scaling = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), euler = new THREE.Euler();
  const tint = new THREE.Color();
  function write(instance, x, y, z, sx, sy, sz, rx = 0, rz = 0) {
    translation.set(x, y, z);
    scaling.set(sx, sy, sz);
    rotation.setFromEuler(euler.set(rx, 0, rz));
    local.compose(translation, rotation, scaling);
    result.multiplyMatrices(root, local);
    instance.setMatrixAt(count, result);
    if (instance.instanceColor) instance.setColorAt(count, tint);
  }
  function begin() {
    count = 0;
    for (const instance of parts) instance.count = 0;
  }
  function add({ x = 0, y = 0, z = 0, yaw = 0, phase = 0, walking = true, color = '#788b83' } = {}) {
    if (count >= capacity) return false;
    if (![x, y, z, yaw, phase].every(Number.isFinite)) return false;
    tint.set(color);
    root.makeRotationY(yaw);
    root.setPosition(x, y, z);
    const wave = walking ? Math.sin(phase) : 0;
    const stride = wave * 0.31;
    const bob = Math.abs(wave) * 0.032;
    write(torso, 0, 0.96 + bob, 0, 1, 1, 1);
    write(skirt, 0, 0.23 + bob, 0, 1, 1, 1, 0, wave * 0.016);
    write(head, 0, 1.545 + bob, 0, 1, 1, 1);
    write(neck, 0, 1.405 + bob, 0, 0.057, 0.12, 0.054);
    write(hat, 0, 1.595 + bob, -0.013, 0.125, 0.15, 0.113);
    write(belt, 0, 0.975 + bob, 0, 0.187, 0.055, 0.118);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const armAngle = -side * stride * 0.8;
      const spread = side * 0.1;
      write(sleeves[i], side * 0.233, 1.33 + bob, 0, 1, 1, 1, armAngle, spread);
      // Match Euler XYZ used by the sleeve: R = Rx * Rz.
      const handY = -0.59 * Math.cos(spread);
      write(hands[i], side * 0.233 + 0.59 * Math.sin(spread),
        1.33 + bob + handY * Math.cos(armAngle), handY * Math.sin(armAngle),
        0.043, 0.071, 0.028, armAngle, spread);
      const legAngle = side * stride;
      const hipY = 0.83 + Math.max(0, -side * wave) * 0.035;
      write(legs[i], side * 0.105, hipY - 0.355 * Math.cos(legAngle),
        -0.355 * Math.sin(legAngle), 0.063, 0.71, 0.064, legAngle);
      // Slightly taller than the detailed boot: its idle sole still meets y=0.
      write(shoes[i], side * 0.105,
        hipY - 0.74 * Math.cos(legAngle) - 0.039 * Math.sin(legAngle),
        -0.74 * Math.sin(legAngle) + 0.039 * Math.cos(legAngle),
        0.077, 0.09, 0.133, legAngle);
    }
    count++;
    return true;
  }
  function commit() {
    for (const instance of parts) {
      instance.count = count;
      instance.instanceMatrix.needsUpdate = true;
      if (instance.instanceColor) instance.instanceColor.needsUpdate = true;
    }
  }
  return { group, begin, add, commit };
}
