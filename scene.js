import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createAdventure } from './adventure.js';
import { createCrowd } from './characters.js';

let adventure = null, nearCrowd = null;

const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const prog = t => { $('prog').textContent = t; return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); };

// ---------- coordinates: original map pixels -> metres ----------
const S = 2.2, CX = 740, CY = 600;
const wx = px => (px - CX) * S, wz = py => (py - CY) * S;
const tpx = x => x / S + CX, tpy = z => z / S + CY;
let seed = 1018; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const rr = (a, b) => a + (b - a) * rnd();
const pick = a => a[Math.floor(rnd() * a.length)];
const smooth = (e0, e1, x) => { let t = (x - e0) / (e1 - e0); t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function distSeg(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); const qx = ax + dx * t - px, qy = ay + dy * t - py; return Math.sqrt(qx * qx + qy * qy); }
function distPoly(px, py, pts) { let m = 1e9; for (let i = 0; i < pts.length - 1; i++) m = Math.min(m, distSeg(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])); return m; }
function inPoly(x, z, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]; if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) c = !c; } return c; }

// ---------- map data (pixel coordinates of the original 京城图) ----------
const WALLPX = [[95,1040],[95,470],[170,445],[245,330],[260,215],[300,178],[395,178],[1395,165],[1395,1040]];
const WALLW = WALLPX.map(p => [wx(p[0]), wz(p[1])]);
const inCity = (x, z) => inPoly(x, z, WALLW);
const HILLS = [
  [190,300,120,95],[125,225,90,70],[265,245,65,40],[100,370,60,50],
  [470,340,75,48],[400,290,50,30],[545,385,42,20],[360,560,45,22],
  [170,-200,90,55],[300,-20,35,18],[1300,-260,80,50],[1090,-240,45,16],
  [300,-980,330,170],[800,-1180,420,210],[1320,-1020,340,170],[1650,-560,220,80],[-150,-620,280,120]
];
const RIVER = [[-420,-600],[-360,300],[-220,1150],[380,1580],[1800,1720]];
const CAUSEWAYS = [[[220,-560],[1300,-560]],[[1108,105],[1105,-200]]];
const LAKE = { cx: 760, cy: -330, rx: 480, ry: 440 };

function lakeV(px, py) { return Math.pow(Math.abs((px - LAKE.cx) / LAKE.rx), 4) + Math.pow(Math.abs((py - LAKE.cy) / LAKE.ry), 4); }
function terrainH(x, z) {
  const px = x / S + CX, py = z / S + CY;
  let water = smooth(1.12, 0.9, lakeV(px, py));
  if (px < 1900 && (px < 500 || py > 1000)) water = Math.max(water, smooth(190, 165, distPoly(px, py, RIVER)));
  let h = 1.5 * (1 - water) - 4 * water;
  for (let i = 0; i < HILLS.length; i++) { const k = HILLS[i]; const dx = px - k[0], dy = py - k[1]; const d2 = (dx * dx + dy * dy) / (k[2] * k[2]); if (d2 < 6) h += k[3] * Math.exp(-d2 * 2.2); }
  for (const c of CAUSEWAYS) { const d = distSeg(px, py, c[0][0], c[0][1], c[1][0], c[1][1]) * S; if (d < 12) h = Math.max(h, 1.0 - smooth(5, 12, d) * 5); }
  return h;
}

// ---------- occupancy grid (2 m cells) ----------
// 0 empty, 1 solid, 2 water, 3 bridge, 4 street, 5 compound, 6 lane / towpath
const CS = 2, GX0 = wx(-450), GZ0 = wz(-1000);
const GNX = Math.ceil((wx(1800) - GX0) / CS), GNZ = Math.ceil((wz(1500) - GZ0) / CS);
const grid = new Uint8Array(GNX * GNZ);
const gi = (x, z) => { const i = Math.floor((x - GX0) / CS), j = Math.floor((z - GZ0) / CS); return (i < 0 || j < 0 || i >= GNX || j >= GNZ) ? -1 : i + j * GNX; };
const gget = (x, z) => { const i = gi(x, z); return i < 0 ? 255 : grid[i]; };
function markRect(x0, z0, x1, z1, v, cond) {
  const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - GX0) / CS)), i1 = Math.min(GNX - 1, Math.floor((Math.max(x0, x1) - GX0) / CS));
  const j0 = Math.max(0, Math.floor((Math.min(z0, z1) - GZ0) / CS)), j1 = Math.min(GNZ - 1, Math.floor((Math.max(z0, z1) - GZ0) / CS));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = i + j * GNX; if (!cond || cond(grid[k])) grid[k] = v; }
}
function rectAll(x0, z0, x1, z1, pred) {
  const i0 = Math.floor((x0 - GX0) / CS), i1 = Math.floor((x1 - GX0) / CS), j0 = Math.floor((z0 - GZ0) / CS), j1 = Math.floor((z1 - GZ0) / CS);
  if (i0 < 0 || j0 < 0 || i1 >= GNX || j1 >= GNZ) return false;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!pred(grid[i + j * GNX])) return false;
  return true;
}
function markDisk(x, z, r, v, cond) {
  const i0 = Math.floor((x - r - GX0) / CS), i1 = Math.floor((x + r - GX0) / CS), j0 = Math.floor((z - r - GZ0) / CS), j1 = Math.floor((z + r - GZ0) / CS);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (i < 0 || j < 0 || i >= GNX || j >= GNZ) continue;
    const cx = GX0 + (i + .5) * CS - x, cz = GZ0 + (j + .5) * CS - z;
    if (cx * cx + cz * cz <= r * r) { const k = i + j * GNX; if (!cond || cond(grid[k])) grid[k] = v; }
  }
}

// ---------- renderer / scene ----------
const host = $('scene');
const QUALITY = { standard: { pixelRatio: 1.5, shadow: 2048 }, high: { pixelRatio: 2, shadow: 4096 } };
let quality = 'standard';
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[quality].pixelRatio));
renderer.setSize(host.clientWidth, host.clientHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 0.3, 30000);
camera.rotation.order = 'YXZ';
scene.fog = new THREE.FogExp2(0xd9d2bf, 0.00016);

// ---------- procedural textures ----------
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
function facadeDraw(glow) {
  return (g, w, h) => {
    g.fillStyle = glow ? '#000' : '#e7dfcf'; g.fillRect(0, 0, w, h);
    if (!glow) { for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(120,100,70,${Math.random() * .06})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); } }
    const wood = glow ? '#000' : '#5b3f2b';
    g.fillStyle = wood; g.fillRect(0, 0, 9, h); g.fillRect(w - 9, 0, 9, h); g.fillRect(0, 0, w, 8); g.fillRect(0, h * .47, w, 7); g.fillRect(0, h - 7, w, 7);
    // upper lattice window
    g.fillStyle = glow ? '#ffd08a' : '#7b5638'; g.fillRect(26, h * .14, w - 52, h * .24);
    g.strokeStyle = glow ? '#3a2410' : '#4a3121'; g.lineWidth = 2;
    for (let x = 26; x <= w - 26; x += 8) { g.beginPath(); g.moveTo(x, h * .14); g.lineTo(x, h * .38); g.stroke(); }
    for (let y = h * .14; y <= h * .38; y += 8) { g.beginPath(); g.moveTo(26, y); g.lineTo(w - 26, y); g.stroke(); }
    // lower doors
    g.fillStyle = glow ? '#ffbe6e' : '#86603f'; g.fillRect(14, h * .56, w - 28, h * .37);
    g.strokeStyle = glow ? '#2a170a' : '#4a3121'; g.lineWidth = 3;
    for (let x = 14; x <= w - 14; x += (w - 28) / 4) { g.beginPath(); g.moveTo(x, h * .56); g.lineTo(x, h * .93); g.stroke(); }
    g.lineWidth = 1.2; for (let y = h * .58; y < h * .78; y += 5) { g.beginPath(); g.moveTo(14, y); g.lineTo(w - 14, y); g.stroke(); }
  };
}
const facadeTex = canvasTex(128, 128, facadeDraw(false));
const facadeGlow = canvasTex(128, 128, facadeDraw(true));
const hallTex = canvasTex(256, 128, (g, w, h) => {
  g.fillStyle = '#7e2e20'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#2f5552'; g.fillRect(0, 0, w, h * .18);
  for (let x = 4; x < w; x += 16) { g.fillStyle = '#c9a65e'; g.fillRect(x, h * .05, 8, h * .08); }
  g.fillStyle = '#5d1f16'; g.fillRect(0, h * .18, w, 5);
  for (let b = 0; b < 2; b++) {
    const x0 = b * w / 2;
    g.fillStyle = '#a23b27'; g.fillRect(x0, h * .2, 14, h * .8); // column
    g.fillStyle = '#6a271b'; g.fillRect(x0 + 22, h * .26, w / 2 - 36, h * .7);
    g.strokeStyle = '#c08a52'; g.lineWidth = 1.5;
    for (let x = x0 + 22; x < x0 + w / 2 - 14; x += 9) { g.beginPath(); g.moveTo(x, h * .26); g.lineTo(x, h * .62); g.stroke(); }
    for (let y = h * .26; y < h * .62; y += 9) { g.beginPath(); g.moveTo(x0 + 22, y); g.lineTo(x0 + w / 2 - 14, y); g.stroke(); }
  }
});
const brickTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#6b6158'; g.fillRect(0, 0, w, h);
  for (let r = 0; r < 16; r++) for (let c = -1; c < 9; c++) {
    const x = c * 16 + (r % 2) * 8, y = r * 8; const v = 100 + Math.random() * 40;
    g.fillStyle = `rgb(${v + 22},${v + 12},${v})`; g.fillRect(x + 1, y + 1, 14, 6);
  }
});
const slabTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#7d776c'; g.fillRect(0, 0, w, h);
  for (let r = 0; r < 8; r++) for (let c = -1; c < 5; c++) {
    const x = c * 64 + (r % 2) * 32, y = r * 32; const v = 150 + Math.random() * 35;
    g.fillStyle = `rgb(${v + 6},${v + 2},${v - 8})`; g.fillRect(x + 2, y + 2, 60, 28);
  }
});
const earthTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#a69882'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2500; i++) { const v = 120 + Math.random() * 70; g.fillStyle = `rgba(${v},${v - 8},${v - 25},.5)`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 2); }
});
const groundTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 5000; i++) { const v = 170 + Math.random() * 85; g.fillStyle = `rgba(${v},${v},${v},.6)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
});
const roofTex = canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#dcdcdc'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 8) { g.fillStyle = '#9a9a9a'; g.fillRect(x, 0, 3, h); g.fillStyle = '#f2f2f2'; g.fillRect(x + 4, 0, 2, h); }
  for (let y = 0; y < h; y += 16) { g.fillStyle = 'rgba(80,80,80,.25)'; g.fillRect(0, y, w, 1); }
});
const glowTex = canvasTex(64, 64, (g, w, h) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,220,160,1)'); gr.addColorStop(.25, 'rgba(255,170,90,.55)'); gr.addColorStop(1, 'rgba(255,140,60,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
// tileable water normal map
const waterNormal = (() => {
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'); const img = g.createImageData(N, N);
  const H = (x, y) => { const a = 2 * Math.PI / N; return Math.sin(x * a * 3 + y * a * 2) * .5 + Math.sin(x * a * 7 - y * a * 5) * .25 + Math.sin(-x * a * 11 + y * a * 13) * .12 + Math.sin(x * a * 2 + y * a * 9) * .2; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = H(x + 1, y) - H(x - 1, y), dy = H(x, y + 1) - H(x, y - 1); let nx = -dx * 2, ny = -dy * 2, nz = 1; const l = Math.hypot(nx, ny, nz);
    const k = (y * N + x) * 4; img.data[k] = (nx / l * .5 + .5) * 255; img.data[k + 1] = (ny / l * .5 + .5) * 255; img.data[k + 2] = (nz / l * .5 + .5) * 255; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
})();

// ---------- materials ----------
const envMats = [];
const M = (o) => { const m = new THREE.MeshStandardMaterial(o); envMats.push(m); return m; };
const mat = {
  ground: M({ map: groundTex, vertexColors: true, roughness: 1 }),
  water: M({ color: 0x55786f, roughness: .14, metalness: .05, normalMap: waterNormal, normalScale: new THREE.Vector2(.35, .35) }),
  houseBody: M({ map: facadeTex, emissiveMap: facadeGlow, emissive: 0xffb062, emissiveIntensity: 0, roughness: .92 }),
  roof: M({ map: roofTex, roughness: .78, side: THREE.DoubleSide }),
  hallRoof: M({ map: roofTex, color: 0x353b3c, roughness: .55, side: THREE.DoubleSide }),
  palaceRoof: M({ map: roofTex, color: 0x2e3f3c, roughness: .45, metalness: .1, side: THREE.DoubleSide }),
  hall: M({ map: hallTex, roughness: .8, emissive: 0xff9a4a, emissiveIntensity: 0 }),
  brick: M({ map: brickTex, roughness: .95 }),
  plain: M({ roughness: .9 }),
  slab: M({ map: slabTex, roughness: .9, side: THREE.DoubleSide }),
  earth: M({ map: earthTex, roughness: 1, side: THREE.DoubleSide }),
  bridge: M({ color: 0xb9b3a5, roughness: .85, side: THREE.DoubleSide }),
  canopy: M({ roughness: .95, flatShading: true }),
  trunk: M({ color: 0x4d3a2a, roughness: 1 }),
  robe: M({ roughness: .9 }),
  skin: M({ color: 0xd8b48c, roughness: .8 }),
  boat: M({ color: 0x6b4b32, roughness: .9 }),
  boatTop: M({ color: 0x3e3a33, roughness: .9, side: THREE.DoubleSide }),
  lantern: M({ color: 0xb8352a, emissive: 0xff5a2a, emissiveIntensity: .2, roughness: .6 }),
  flag: M({ roughness: .9, side: THREE.DoubleSide }),
  pagoda: M({ color: 0x9b8c78, roughness: .9 }),
};
mat.water.normalMap.repeat.set(1, 1);

// ---------- geometry helpers ----------
class GB {
  constructor() { this.p = []; this.uv = []; this.i = []; }
  v(x, y, z, u, w) { this.p.push(x, y, z); this.uv.push(u, w); return this.p.length / 3 - 1; }
  q(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  build() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.setIndex(this.i); g.computeVertexNormals(); return g; }
}
// curved hip roof on a unit footprint, ridge along x, height normalised to 1
function makeRoofGeo(steps, k, ridge, lift, curve, tMax = 1) {
  const b = new GB(), rings = [], ymax = Math.pow(tMax, curve);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps * tMax, hx = 0.5 + (ridge * 0.5 - 0.5) * t, hz = 0.5 - 0.5 * t, y = Math.pow(t, curve) / ymax, ring = [];
    for (let s = 0; s < 4; s++) for (let j = 0; j < k; j++) {
      const f = j / k, sp = -1 + 2 * f; let x, z;
      if (s === 0) { x = -hx + 2 * hx * f; z = hz; } else if (s === 1) { x = hx; z = hz - 2 * hz * f; } else if (s === 2) { x = hx - 2 * hx * f; z = -hz; } else { x = -hx; z = -hz + 2 * hz * f; }
      const L = lift * Math.pow(1 - t, 2) * Math.pow(Math.abs(sp), 4) / ymax;
      ring.push(b.v(x, y + L, z, s + f, t * 2));
    }
    rings.push(ring);
  }
  const n = 4 * k;
  for (let i = 0; i < steps; i++) for (let j = 0; j < n; j++) b.q(rings[i][j], rings[i][(j + 1) % n], rings[i + 1][(j + 1) % n], rings[i + 1][j]);
  return b.build();
}
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  body: new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0),
  roofHouse: makeRoofGeo(3, 3, .35, .07, 1.5),
  skirtHouse: makeRoofGeo(2, 3, .35, .06, 1.5, .35),
  roofHall: makeRoofGeo(8, 8, .45, .14, 1.75),
  skirtHall: makeRoofGeo(4, 8, .45, .12, 1.7, .35),
  roofPyr: makeRoofGeo(6, 6, 0, .14, 1.7),
};
{ // brick UV scale on the shared wall box
  const uv = G.box.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 5, uv.getY(i) * 2); }
const brickBox = G.box.clone();
function boxWorldUV(w, h, d, bay) {
  const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) { const fw = f < 2 ? d : w; for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setX(i, uv.getX(i) * fw / bay); } }
  return g;
}

// ---------- collected instances ----------
const bricks = [], plains = [], houses = [], trees = [], lanterns = [], flags = [], labels = [];
const addBrick = (x, y, z, sx, sy, sz, ry = 0) => bricks.push({ x, y, z, sx, sy, sz, ry });
const addPlain = (x, y, z, sx, sy, sz, c, ry = 0) => plains.push({ x, y, z, sx, sy, sz, c, ry });
const addLabel = (name, kind, x, y, z, desc, infoR = 0, group = '') => labels.push({ name, kind, pos: new THREE.Vector3(x, y, z), desc, infoR, group });
const statics = new THREE.Group(); scene.add(statics);
function addMesh(geo, m, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) {
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.rotation.y = ry; o.castShadow = o.receiveShadow = true; statics.add(o); return o;
}

// hall: w along x, d along z (metres). returns ridge height
function addHall(cx, cz, w, d, o = {}) {
  const g = o.baseY ?? Math.max(1.5, terrainH(cx, cz)); const plat = o.plat ?? 1;
  const h = o.h ?? 6.5, rh = o.rh ?? Math.min(w, d) * .38, over = o.over ?? 3.2;
  if (plat > 0) addPlain(cx, g + plat / 2 - .3, cz, w + 4, plat + .6, d + 4, o.platC ?? 0xb7ae9d);
  const top = g + plat;
  const body = new THREE.Mesh(boxWorldUV(w, h, d, 11), o.mat ?? mat.hall); body.position.set(cx, top + h / 2, cz); body.castShadow = body.receiveShadow = true; statics.add(body);
  const rot = d > w ? Math.PI / 2 : 0; const RW = (d > w ? d : w) + over, RD = (d > w ? w : d) + over;
  const rm = o.roofMat ?? mat.hallRoof;
  if (o.double) addMesh(G.skirtHall, rm, cx, top + h * .52, cz, RW + 2.2, h * .2, RD + 2.2, rot);
  addMesh(o.pyramid ? G.roofPyr : G.roofHall, rm, cx, top + h, cz, RW, rh, RD, rot);
  if (!o.noMark) markRect(cx - w / 2 - 1, cz - d / 2 - 1, cx + w / 2 + 1, cz + d / 2 + 1, 1);
  return top + h + rh;
}
function addPavilion(cx, cz, w, d, o = {}) {
  const g = o.baseY ?? Math.max(1.5, terrainH(cx, cz)); const h = o.h ?? 3.6, plat = o.plat ?? .8;
  addPlain(cx, g + plat / 2 - .2, cz, w + 1, plat + .4, d + 1, o.platC ?? 0xa8a090);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { addPlain(cx + sx * (w / 2 - .3), g + plat + h / 2, cz + sz * (d / 2 - .3), .4, h, .4, 0x8e3424); markDisk(cx + sx * (w / 2 - .3), cz + sz * (d / 2 - .3), .6, 1); }
  addMesh(o.pyramid !== false && Math.abs(w - d) < 1 ? G.roofPyr : G.roofHall, o.roofMat ?? mat.hallRoof, cx, g + plat + h, cz, w + 2.4, Math.min(w, d) * .45, d + 2.4);
  return g + plat + h + Math.min(w, d) * .45;
}
// gate tower over a wall. ax = direction the wall runs ('x' or 'z')
function addGateTower(cx, cz, ax, o = {}) {
  const g = o.baseY ?? Math.max(1.5, terrainH(cx, cz));
  const L = o.L ?? 34, D = o.D ?? 18, H = o.H ?? 10, tw = o.tw ?? 6.5, th = o.th ?? 6.5;
  const pl = (L - tw) / 2; const red = o.red;
  const put = (a, y, sa, sy, sd) => {
    const x = ax === 'x' ? cx + a : cx, z = ax === 'x' ? cz : cz + a;
    const sx = ax === 'x' ? sa : sd, sz = ax === 'x' ? sd : sa;
    if (red) addPlain(x, y, z, sx, sy, sz, 0x8f3627); else addBrick(x, y, z, sx, sy, sz);
  };
  for (const s of [-1, 1]) {
    const a = s * (tw / 2 + pl / 2); put(a, g + H / 2 - 1, pl, H + 2, D);
    const x = ax === 'x' ? cx + a : cx, z = ax === 'x' ? cz : cz + a;
    markRect(x - (ax === 'x' ? pl : D) / 2, z - (ax === 'x' ? D : pl) / 2, x + (ax === 'x' ? pl : D) / 2, z + (ax === 'x' ? D : pl) / 2, 1);
  }
  put(0, g + th + (H - th) / 2, tw, H - th, D);
  if (!o.water) markRect(cx - (ax === 'x' ? tw : D) / 2, cz - (ax === 'x' ? D : tw) / 2, cx + (ax === 'x' ? tw : D) / 2, cz + (ax === 'x' ? D : tw) / 2, 4, c => c !== 2);
  const hw = ax === 'x' ? L - 8 : D - 6, hd = ax === 'x' ? D - 6 : L - 8;
  return addHall(cx, cz, hw, hd, { baseY: g + H, plat: .5, h: o.th2 ?? 6, double: o.double ?? true, noMark: true, rh: 5.5, roofMat: red ? mat.palaceRoof : mat.hallRoof });
}
// walled compound. rect in px. gate side: 'top','bottom','left','right' (image sides)
function addCompound(p0x, p0y, p1x, p1y, o = {}) {
  const x0 = wx(p0x), z0 = wz(p0y), x1 = wx(p1x), z1 = wz(p1y), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  markRect(x0, z0, x1, z1, 5, c => c === 0 || c === 6);
  const col = o.red ? 0x8e3a2c : 0xd9d1c0, hgt = o.wallH ?? 4.2, th = 1.2, gap = o.gap ?? 7;
  const sides = { top: [[x0, z0], [x1, z0]], bottom: [[x0, z1], [x1, z1]], left: [[x0, z0], [x0, z1]], right: [[x1, z0], [x1, z1]] };
  for (const [name, [a, b]] of Object.entries(sides)) {
    if (o.skip && o.skip.includes(name)) continue;
    const horiz = a[1] === b[1]; const len = horiz ? b[0] - a[0] : b[1] - a[1]; const mid = len / 2;
    const segs = name === o.gate ? [[0, mid - gap / 2], [mid + gap / 2, len]] : [[0, len]];
    for (const [s0, s1] of segs) {
      for (let s = s0; s < s1 - .01; s += 16) {
        const e = Math.min(s + 16, s1), m = (s + e) / 2; const x = horiz ? a[0] + m : a[0], z = horiz ? a[1] : a[1] + m;
        const gy = Math.max(1.5, terrainH(x, z)), L = e - s + .3;
        addPlain(x, gy + hgt / 2 - .5, z, horiz ? L : th, hgt + 1, horiz ? th : L, col);
        addPlain(x, gy + hgt + .15, z, horiz ? L : th + 1, .35, horiz ? th + 1 : L, 0x3a3d3e);
      }
      if (horiz) markRect(a[0] + s0, a[1] - 1, a[0] + s1, a[1] + 1, 1); else markRect(a[0] - 1, a[1] + s0, a[0] + 1, a[1] + s1, 1);
    }
    if (name === o.gate && o.gateHouse !== false) {
      const x = horiz ? a[0] + mid : a[0], z = horiz ? a[1] : a[1] + mid;
      const gy = Math.max(1.5, terrainH(x, z));
      for (const s of [-1, 1]) addPlain(horiz ? x + s * (gap / 2 + .6) : x, gy + 2.6, horiz ? z : z + s * (gap / 2 + .6), 1.4, 5.2, 1.4, o.red ? 0x8e3a2c : 0x6a4a34);
      addMesh(G.roofHall, mat.hallRoof, x, gy + 5.2, z, horiz ? gap + 6 : 6, 2.4, horiz ? 6 : gap + 6);
      o.gatePos = [x, z];
    }
  }
  if (o.pave !== false) paves.push([x0 + 1, z0 + 1, x1 - 1, z1 - 1, o.paveMat ?? 'slab']);
  return { x0, z0, x1, z1, cx, cz };
}
const paves = [];

// ---------- 1. canals ----------
const CANALS = [
  { name: '盐桥运河', w: 16, pts: [[280,870],[1420,870]] },
  { name: '市河', w: 12, pts: [[1030,185],[1060,360],[1040,520],[1055,700],[1050,870]] },
  { name: '茆山河', w: 12, pts: [[1300,300],[1310,520],[1295,700],[1300,870],[1300,1060]] },
];
for (const c of CANALS) {
  c.W = c.pts.map(p => [wx(p[0]), wz(p[1])]);
  c.samples = [];
  for (let i = 0; i < c.W.length - 1; i++) {
    const [ax, az] = c.W[i], [bx, bz] = c.W[i + 1]; const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 2);
    for (let k = 0; k < n; k++) c.samples.push([lerp(ax, bx, k / n), lerp(az, bz, k / n)]);
  }
  c.samples.push(c.W[c.W.length - 1]);
}
function markCanals() {
  for (const c of CANALS) for (const [x, z] of c.samples) markDisk(x, z, c.w / 2 + 3.5, 6, v => v === 0);
  for (const c of CANALS) for (const [x, z] of c.samples) markDisk(x, z, c.w / 2, 2);
}

// ---------- 2. city wall & gates ----------
const GATES = [
  { n: '钱湖门', p: [395,178], ax: 'x', d: '临安西城门之一，门外即西湖南岸、南屏山一带。' },
  { n: '清波门', p: [600,175.3], ax: 'x', d: '西城门。临安府治就在门内不远。' },
  { n: '丰豫门', p: [880,171.6], ax: 'x', d: '西城门，俗称涌金门，出门便是西湖。' },
  { n: '钱塘门', p: [1350,165.6], ax: 'x', d: '西北城门，门外沿西湖北岸可往孤山、宝石山。' },
  { n: '余杭门', p: [1395,520], ax: 'z', d: '北城门，城北的运河水路由此通往苏州、湖州方向。' },
  { n: '天宗水门', p: [1395,870], ax: 'z', water: true, d: '北面水门。城内盐桥运河在此出城，船只往来不绝。' },
  { n: '艮山门', p: [1395,960], ax: 'z', d: '城东北的城门。' },
  { n: '东青门', p: [1350,1040], ax: 'x', d: '东城门之一。' },
  { n: '崇新门', p: [1180,1040], ax: 'x', d: '东城门之一。' },
  { n: '新门', p: [880,1040], ax: 'x', d: '东城门之一。' },
  { n: '保安门', p: [720,1040], ax: 'x', d: '东城门之一。' },
  { n: '候潮门', p: [480,1040], ax: 'x', d: '东南城门，门外近钱塘江，因观江潮得名。' },
  { n: '便门', p: [300,1040], ax: 'x', d: '东南城门之一。' },
  { n: '嘉会门', p: [95,1020], ax: 'z', d: '南城门。皇帝赴城南郊坛祭天，由此门出城。' },
  { n: '丽正门', p: [95,700], ax: 'z', red: true, d: '皇城南门，也是皇城的正门。' },
];
for (const g of GATES) { g.x = wx(g.p[0]); g.z = wz(g.p[1]); }
let wallCentroid = [0, 0]; WALLW.forEach(p => { wallCentroid[0] += p[0] / WALLW.length; wallCentroid[1] += p[1] / WALLW.length; });
function buildWall() {
  for (let e = 0; e < WALLW.length; e++) {
    const A = WALLW[e], B = WALLW[(e + 1) % WALLW.length]; const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    let nx = -uz, nz = ux; const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2;
    if ((wallCentroid[0] - mx) * nx + (wallCentroid[1] - mz) * nz > 0) { nx = -nx; nz = -nz; } // outward
    const gs = GATES.map(g => ({ g, s: (g.x - A[0]) * ux + (g.z - A[1]) * uz, off: Math.abs((g.x - A[0]) * nx + (g.z - A[1]) * nz) })).filter(o => o.off < 8 && o.s > -5 && o.s < L + 5);
    for (let s = 0; s <= L; s += 1) {
      if (gs.some(o => Math.abs(o.s - s) < 3.4)) continue;
      markDisk(A[0] + ux * s, A[1] + uz * s, 6.5, 1);
    }
    const cuts = gs.map(o => [o.s - 17, o.s + 17]);
    const ry = Math.atan2(-dz, dx);
    let s = 0;
    while (s < L) {
      let e2 = Math.min(L, s + 20);
      const cut = cuts.find(c => s < c[1] && e2 > c[0]);
      if (cut) { if (s < cut[0]) e2 = cut[0]; else { s = cut[1]; continue; } }
      const m = (s + e2) / 2, x = A[0] + ux * m, z = A[1] + uz * m;
      const h0 = Math.max(1.5, terrainH(A[0] + ux * s, A[1] + uz * s)), h1 = Math.max(1.5, terrainH(A[0] + ux * e2, A[1] + uz * e2));
      const bot = Math.min(h0, h1) - 3, top = (h0 + h1) / 2 + 10;
      addBrick(x, (bot + top) / 2, z, e2 - s + .6, top - bot, 12, ry);
      for (let q = s + 1.5; q < e2 - 1; q += 3.6) {
        const qx = A[0] + ux * q + nx * 5.6, qz = A[1] + uz * q + nz * 5.6;
        addBrick(qx, top + .7, qz, 1.8, 1.4, .8, ry);
      }
      s = e2;
    }
  }
  for (const g of GATES) {
    const ty = addGateTower(g.x, g.z, g.ax, { water: g.water, red: g.red });
    addLabel(g.n, 'gate', g.x, ty + 3, g.z, g.d, 70, '城门');
  }
}

// ---------- 3. landmarks ----------
const P = (px, py) => [wx(px), wz(py)];
function buildLandmarks() {
  // 大内
  addCompound(95, 465, 275, 935, { red: true, wallH: 7, gate: 'right', gap: 30, gateHouse: false, skip: ['left'], pave: false });
  markRect(wx(95), wz(465), wx(275), wz(935), 5, c => c === 0 || c === 6);
  { const [x, z] = P(275, 700); addGateTower(x, z, 'z', { red: true, L: 30, D: 14, H: 8, tw: 7 });
    addLabel('和宁门', 'gate', x, 30, z, '皇城北门。出门向北即是御街，百官每日由此入朝。', 60, '宫城'); }
  paves.push([wx(97), wz(467), wx(273), wz(933), 'earth']); paves.push([wx(110), wz(650), wx(265), wz(750), 'slab']);
  { const [x, z] = P(160, 700); const t = addHall(x, z, 26, 58, { double: true, plat: 2.6, h: 11, rh: 9, roofMat: mat.palaceRoof });
    addLabel('大庆殿', 'palace', x, t + 4, z, '皇城正殿，举行大朝会与重大典礼。南宋时一殿多用，随典礼更换殿名匾额。', 60, '宫城'); }
  { const [x, z] = P(228, 700); const t = addHall(x, z, 18, 34, { plat: 1.6, h: 8.5, rh: 7, roofMat: mat.palaceRoof });
    addLabel('垂拱殿', 'palace', x, t + 4, z, '皇帝日常视朝、召见群臣的殿宇。', 45, '宫城'); }
  { const [x, z] = P(165, 860); const t = addHall(x, z, 16, 30, { plat: 1.2, h: 7.5, roofMat: mat.palaceRoof });
    addLabel('福宁殿', 'palace', x, t + 4, z, '皇帝的寝殿。', 40, '宫城'); }
  for (const [px, py] of [[225, 610], [225, 790], [120, 610], [120, 790], [230, 880], [110, 900]]) { const [x, z] = P(px, py); addHall(x, z, 10, 24, { roofMat: mat.palaceRoof, h: 5.5 }); }
  { const [x, z] = P(170, 535); ponds.push([x, z, 26]); markDisk(x, z, 26, 2);
    const [px2, pz2] = P(205, 560); addPavilion(px2, pz2, 7, 7);
    addLabel('后苑', 'palace', x, 22, z, '皇家园林，依凤凰山势叠石引水，亭台错落。', 60, '宫城');
    for (let i = 0; i < 70; i++) { const tx = x + rr(-80, 80), tz = z + rr(-70, 90); if (gget(tx, tz) === 5) trees.push({ x: tx, z: tz, t: rnd() < .4 ? 2 : 0, s: rr(3, 5.5) }); } }
  fillCompound(wx(97), wz(470), wx(273), wz(930), 14, true);
  { const [x, z] = P(185, 700); addLabel('大内', 'palace', x, 75, z, '南宋皇城，倚凤凰山东麓而建，周回约九里。正殿、寝殿、后苑依山势层层铺开。', 0, '宫城'); }

  // 太庙
  { const c = addCompound(430, 712, 540, 780, { red: true, gate: 'top' }); const t = addHall(c.cx, c.cz + 10, 60, 22, { double: true, plat: 2, h: 9, rh: 8 });
    addHall(c.cx, c.z0 + 22, 24, 10, { h: 5 });
    fillCompound(c.x0, c.z0, c.x1, c.z1, 4);
    addLabel('太庙', 'office', c.cx, t + 4, c.cz, '供奉宋室历代祖先神主之所。遗址在今紫阳山东麓，已辟为太庙遗址公园。', 140, '宫城官署'); }
  // 三省六部
  { const c = addCompound(300, 800, 520, 860, { gate: 'top' }); let t = 0;
    for (const px of [345, 410, 475]) { const [x] = P(px, 0); t = addHall(x, c.cz + 6, 30, 15, { h: 6.5 }); addHall(x, c.z0 + 18, 16, 8, { h: 4.5 }); }
    fillCompound(c.x0, c.z0, c.x1, c.z1, 8);
    addLabel('三省六部', 'office', c.cx, t + 4, c.cz, '中书、门下、尚书三省与吏、户、礼、兵、刑、工六部的官署，紧邻皇城北门。', 160, '宫城官署'); }
  // 府治
  { const c = addCompound(720, 240, 830, 320, { gate: 'top' }); const t = addHall(c.cx, c.cz + 20, 30, 16, { h: 7 }); addHall(c.cx, c.cz - 25, 18, 9, { h: 5 });
    fillCompound(c.x0, c.z0, c.x1, c.z1, 5);
    addLabel('临安府治', 'office', c.cx, t + 4, c.cz, '临安府的衙署，掌管京城民政、刑狱与赋税。', 120, '宫城官署'); }
  // 太学 / 武学
  { const c = addCompound(1070, 380, 1150, 440, { gate: 'top' }); const t = addHall(c.cx, c.cz + 10, 28, 14, { h: 6.5 });
    addHall(c.x0 + 12, c.cz, 8, 70, { h: 4.5 }); addHall(c.x1 - 12, c.cz, 8, 70, { h: 4.5 });
    addLabel('太学', 'office', c.cx, t + 4, c.cz, '南宋的国家最高学府，鼎盛时在学生员逾千人。', 100, '宫城官署'); }
  { const c = addCompound(1070, 450, 1150, 500, { gate: 'bottom', paveMat: 'earth' }); const t = addHall(c.cx, c.z0 + 22, 24, 12, { h: 6 });
    addLabel('武学', 'office', c.cx, t + 4, c.cz, '培养武官的学校，院中设射圃习射。', 80, '宫城官署'); }
  // 景灵宫 / 万寿观
  { const c = addCompound(1135, 235, 1225, 295, { red: true, gate: 'bottom' }); const t = addHall(c.cx, c.cz - 15, 40, 20, { double: true, plat: 1.8, h: 8.5, rh: 7.5 });
    addHall(c.cx, c.z1 - 30, 22, 10, { h: 5 });
    fillCompound(c.x0, c.z0, c.x1, c.z1, 4);
    addLabel('景灵宫', 'temple', c.cx, t + 4, c.cz, '供奉历代帝后神御像的宫观，位于御街北端，皇帝按时节在此朝献。', 120, '寺观坛庙'); }
  { const c = addCompound(1240, 235, 1295, 290, { gate: 'bottom' }); const t = addHall(c.cx, c.cz - 8, 24, 14, { h: 6.5 });
    addLabel('万寿观', 'temple', c.cx, t + 4, c.cz, '皇家道观，与景灵宫相邻。', 80, '寺观坛庙'); }
  // 社坛
  { const c = addCompound(1215, 890, 1275, 945, { gate: 'bottom', paveMat: 'earth' }); const gy = 1.5;
    addPlain(c.cx, gy + .5, c.cz, 30, 1.2, 30, 0xb8ab90); addPlain(c.cx, gy + 1.4, c.cz, 18, 1, 18, 0xa89a7d);
    const s = 6; // five-coloured soil
    addPlain(c.cx, gy + 2, c.cz, s, .3, s, 0xc9a640);
    addPlain(c.cx, gy + 2, c.cz + s, s, .3, s, 0x4d7a5a); addPlain(c.cx - s, gy + 2, c.cz, s, .3, s, 0xa8402e);
    addPlain(c.cx, gy + 2, c.cz - s, s, .3, s, 0xe6e0d0); addPlain(c.cx + s, gy + 2, c.cz, s, .3, s, 0x2a2826);
    markRect(c.cx - 15, c.cz - 15, c.cx + 15, c.cz + 15, 1);
    addLabel('社坛', 'temple', c.cx, 14, c.cz, '祭祀土地之神的坛场。坛面依方位铺五色土：东青、南赤、西白、北黑、中黄。', 80, '寺观坛庙'); }
  // 城隍庙 on 吴山
  { const c = addCompound(450, 322, 495, 358, { gate: 'bottom', paveMat: 'earth' }); const t = addHall(c.cx, c.cz - 6, 18, 10, { h: 5.5, plat: 2 });
    addLabel('城隍庙', 'temple', c.cx, t + 4, c.cz, '吴山上的城隍庙，祀临安城的守护神，香火极盛。', 70, '寺观坛庙'); }
  // 北瓦
  { const c = addCompound(960, 715, 1040, 780, { gate: 'top', paveMat: 'earth' }); let t = 0;
    for (const px of [978, 1000, 1022]) for (const py of [737, 762]) { const [x, z] = P(px, py); t = addPavilion(x, z, 12, 10, { h: 4.2, plat: 1.2, platC: 0x8a6a4a });
      lanterns.push([x - 6.5, 1.5 + 1.2 + 3.6, z], [x + 6.5, 1.5 + 1.2 + 3.6, z]);
      flags.push({ x: x + 7.5, z: z - 4, ry: 0, c: pick([0xa8402e, 0x2d4a6b, 0xc59a3e]) }); }
    addLabel('北瓦', 'market', c.cx, t + 8, c.cz, '临安城内最大的瓦舍，在众安桥南。勾栏棚里说书、杂剧、傀儡戏、影戏昼夜不绝。', 110, '街市桥梁'); }
  // 朝天门
  { const [x, z] = P(625, 700); const t = addGateTower(x, z, 'z', { L: 46, D: 16, H: 9, tw: 10, th: 7 });
    addLabel('朝天门', 'gate', x, t + 3, z, '御街上的城中门楼，在吴山东麓。今杭州鼓楼即在此处。', 70, '街市桥梁'); }
  // 净慈寺
  { const c = addCompound(180, -115, 250, -40, { gate: 'right', red: true, paveMat: 'earth' }); const t = addHall(c.cx - 8, c.cz, 18, 30, { double: true, h: 8, rh: 7 });
    addHall(c.x1 - 20, c.cz, 10, 18, { h: 5 });
    addLabel('净慈寺', 'temple', c.cx, t + 4, c.cz, '南屏山下的名刹，始建于五代吴越国。“南屏晚钟”即指此寺钟声。', 100, '寺观坛庙'); }
  // pagodas
  { const [x, z] = P(300, -20); const t = addPagoda(x, z, 5, 9, 6, 7.5); addLabel('雷峰塔', 'temple', x, t + 6, z, '夕照山上的砖木塔，吴越国王钱俶时所建，临西湖南岸。', 60, '湖山'); }
  { const [x, z] = P(1300, -262); const t = addPagoda(x, z, 7, 3.2, 1.8, 5.2, true); addLabel('保俶塔', 'temple', x, t + 6, z, '宝石山上的塔，与雷峰塔隔湖相望。', 60, '湖山'); }
  { const [x, z] = P(1090, -240); addPavilion(x, z, 8, 8); }
}
const ponds = [];
function fillCompound(x0, z0, x1, z1, n, palace) {
  for (let k = 0, placed = 0; k < n * 25 && placed < n; k++) {
    const w = rr(10, 18), d = rr(10, 22), x = rr(x0 + w / 2 + 6, x1 - w / 2 - 6), z = rr(z0 + d / 2 + 6, z1 - d / 2 - 6);
    if (terrainH(x, z) > 4) continue;
    if (!rectAll(x - w / 2 - 5, z - d / 2 - 5, x + w / 2 + 5, z + d / 2 + 5, c => c === 5)) continue;
    addHall(x, z, w, d, { h: rr(4.5, 6), plat: .8, roofMat: palace ? mat.palaceRoof : mat.hallRoof }); placed++;
    if (rnd() < .6) trees.push({ x: x + w / 2 + 4, z: z + rr(-d / 2, d / 2), t: 0, s: rr(3, 4.5) });
  }
}
function addPagoda(x, z, floors, r0, r1, fh, slender) {
  let y = Math.max(1.5, terrainH(x, z)); markDisk(x, z, r0 + 2, 1);
  addPlain(x, y + .6, z, r0 * 2.6, 1.6, r0 * 2.6, 0xa69d8c); y += 1.4;
  for (let i = 0; i < floors; i++) {
    const r = lerp(r0, r1, i / Math.max(1, floors - 1));
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r * .92, r, fh, 8), mat.pagoda); body.position.set(x, y + fh / 2, z); body.castShadow = true; statics.add(body);
    y += fh;
    if (!slender) { addMesh(G.roofPyr, mat.hallRoof, x, y - .4, z, r * 2.9, r * .55, r * 2.9, Math.PI / 8); y += .3; }
    else { const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.2, r * 1.2, .5, 8), mat.pagoda); ring.position.set(x, y, z); statics.add(ring); }
  }
  const sp = new THREE.Mesh(new THREE.ConeGeometry(slender ? r1 : r1 * .8, slender ? 7 : 9, 8), slender ? mat.pagoda : mat.hallRoof); sp.position.set(x, y + (slender ? 3.5 : 4.5), z); sp.castShadow = true; statics.add(sp);
  return y + 9;
}

// ---------- 4. streets ----------
const STREETS = [
  { a: [278,700], b: [1180,700], w: 18, k: 'yujie' },
  { a: [1180,700], b: [1180,300], w: 18, k: 'yujie' },
  { a: [395,215], b: [1395,215], w: 8 }, { a: [600,360], b: [1395,360], w: 8 }, { a: [600,520], b: [1425,520], w: 9 },
  { a: [1180,700], b: [1395,700], w: 9 }, { a: [278,790], b: [1395,790], w: 9 }, { a: [278,960], b: [1425,960], w: 8 },
  { a: [65,1020], b: [1395,1020], w: 8 },
  { a: [395,150], b: [395,215], w: 8 }, { a: [600,145], b: [600,1070], w: 9 }, { a: [720,330], b: [720,1070], w: 8 },
  { a: [880,140], b: [880,1070], w: 9 }, { a: [1180,700], b: [1180,1070], w: 9 }, { a: [1350,135], b: [1350,1070], w: 8 },
  { a: [480,790], b: [480,1070], w: 8 }, { a: [300,960], b: [300,1070], w: 6 }, { a: [65,700], b: [95,700], w: 9 },
];
const LANE_X = [330,375,420,510,555,645,690,780,825,915,960,1005,1095,1140,1230,1275,1320];
const LANE_Y = [280,440,610,745,830,915,990];
for (const x of LANE_X) STREETS.push({ a: [x,180], b: [x,1036], w: 4.5, k: 'lane' });
for (const y of LANE_Y) STREETS.push({ a: [285,y], b: [1392,y], w: 4, k: 'lane' });
for (const st of STREETS) {
  st.horiz = st.a[1] === st.b[1];
  const A = [wx(st.a[0]), wz(st.a[1])], B = [wx(st.b[0]), wz(st.b[1])];
  st.c = st.horiz ? A[1] : A[0]; st.lo = st.horiz ? Math.min(A[0], B[0]) : Math.min(A[1], B[1]); st.hi = st.horiz ? Math.max(A[0], B[0]) : Math.max(A[1], B[1]);
  st.runs = []; st.major = st.k !== 'lane';
}
const XY = (st, s, o = 0) => st.horiz ? [s, st.c + o] : [st.c + o, s];
function rasterStreets() {
  for (const pass of ['major', 'lane']) for (const st of STREETS) {
    if ((pass === 'major') !== st.major) continue;
    const hw = st.w / 2; let run = null;
    for (let s = st.lo; s <= st.hi; s += 2) {
      const [x, z] = XY(st, s); const code = gget(x, z);
      let ok;
      if (st.major) ok = code === 0 || code === 4 || code === 6;
      else ok = (code === 0 || code === 6 || code === 4) && terrainH(x, z) < 4.5 && inCity(x, z);
      if (ok) {
        for (let o = -hw; o <= hw; o += 1) { const [cx, cz] = XY(st, s, o); const k = gi(cx, cz); if (k >= 0 && (grid[k] === 0 || grid[k] === 6 || (st.major && grid[k] === 4))) grid[k] = st.major ? 4 : 6; }
        if (!run) { run = [s, s]; st.runs.push(run); } run[1] = s + 2;
      } else run = null;
    }
  }
}
// bridges where streets cross canals
const bridges = [];
function segInt(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null; const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return (t >= 0 && t <= 1 && u >= 0 && u <= 1) ? [a[0] + t * r[0], a[1] + t * r[1]] : null;
}
function buildBridges() {
  for (const st of STREETS) {
    const A = XY(st, st.lo), B = XY(st, st.hi);
    for (const c of CANALS) for (let i = 0; i < c.W.length - 1; i++) {
      const p = segInt(A, B, c.W[i], c.W[i + 1]); if (!p) continue;
      const along = st.horiz ? p[0] : p[1]; const half = c.w / 2 + 4.5;
      const ok = [-1, 1].every(sg => { const [x, z] = XY(st, along + sg * half); const v = gget(x, z); return v === 4 || v === 6; });
      if (!ok) continue;
      if (bridges.some(b => Math.hypot(b.x - p[0], b.z - p[1]) < (st.major ? 10 : 40))) continue;
      const br = { x: p[0], z: p[1], ax: st.horiz ? 'x' : 'z', len: c.w + (st.major ? 12 : 9), w: Math.max(st.w, 4.5), base: 1.5, rise: st.major ? 3.2 : 2.8, st };
      bridges.push(br);
      const hl = br.len / 2, hw = br.w / 2;
      if (br.ax === 'x') markRect(br.x - hl, br.z - hw, br.x + hl, br.z + hw, 3, v => v !== 1); else markRect(br.x - hw, br.z - hl, br.x + hw, br.z + hl, 3, v => v !== 1);
    }
  }
  // 苏堤六桥 and 断桥 (on causeways)
  for (const px of [380, 520, 660, 820, 960, 1110]) { const br = { x: wx(px), z: wz(-560), ax: 'x', len: 18, w: 7, base: 1.0, rise: 2.8 }; bridges.push(br); markRect(br.x - 9, br.z - 3.5, br.x + 9, br.z + 3.5, 3); }
  { const br = { x: wx(1107), z: wz(70), ax: 'z', len: 22, w: 8, base: 1.0, rise: 3.2 }; bridges.push(br); markRect(br.x - 4, br.z - 11, br.x + 4, br.z + 11, 3); }
}
function bridgeH(x, z) {
  for (const b of bridges) {
    const a = b.ax === 'x' ? x - b.x : z - b.z, o = b.ax === 'x' ? z - b.z : x - b.x;
    if (Math.abs(a) <= b.len / 2 && Math.abs(o) <= b.w / 2 + .5) { const t = a / (b.len / 2); return b.base + b.rise * (1 - t * t); }
  }
  return null;
}
function groundAt(x, z) { if (gget(x, z) === 3) { const h = bridgeH(x, z); if (h !== null) return h; } return terrainH(x, z); }

// ---------- 5. houses ----------
const ROOFC = ['#3d4147', '#45484c', '#4c4945', '#3a3d40', '#53514c', '#42464a'];
const BODYC = ['#ffffff', '#f4ead6', '#eadcc2', '#dcc8a6', '#cdb894', '#f0e6d6'];
function tryHouse(cx, cz, w, d, o) {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  if (!inCity(x0, z0) || !inCity(x1, z1) || !inCity(x0, z1) || !inCity(x1, z0)) return null;
  const h = terrainH(cx, cz); if (h > 3.2 || h < 1.2) return null;
  if (!rectAll(x0 - .4, z0 - .4, x1 + .4, z1 + .4, c => c === 0)) return null;
  markRect(x0, z0, x1, z1, 1);
  const hs = { x: cx, z: cz, w, d, y: 1.5, h: o.h, two: o.two, bc: pick(BODYC), rc: pick(ROOFC) };
  houses.push(hs); return hs;
}
function streetFront(st) {
  const hw = st.w / 2, yj = st.k === 'yujie';
  for (const run of st.runs) for (const side of [-1, 1]) {
    let s = run[0] + rr(0, 2);
    while (s < run[1] - 4) {
      const w = yj ? rr(5.5, 9) : st.major ? rr(6.5, 11) : rr(7, 12), d = yj ? rr(11, 15) : rr(9, 14);
      const two = yj ? rnd() < .75 : st.major ? rnd() < .3 : rnd() < .06;
      const off = hw + .9 + rr(0, .6) + d / 2;
      const [cx, cz] = st.horiz ? [s + w / 2, st.c + side * off] : [st.c + side * off, s + w / 2];
      const hs = st.horiz ? tryHouse(cx, cz, w, d, { h: two ? rr(6.8, 7.6) : rr(3.6, 4.4), two }) : tryHouse(cx, cz, d, w, { h: two ? rr(6.8, 7.6) : rr(3.6, 4.4), two });
      if (hs) {
        if (st.major) { // lanterns & flags facing the street
          const fo = off - d / 2 - .55, ly = 1.5 + (two ? 3.3 : 2.9);
          const n = yj ? 2 : (rnd() < .6 ? 1 : 0);
          for (let q = 0; q < n; q++) { const a = s + w * (n === 2 ? (q ? .78 : .22) : .5); const [lx, lz] = XY(st, a, side * fo); lanterns.push([lx, ly, lz]); }
          if (rnd() < (yj ? .22 : .08)) { const [fx, fz] = XY(st, s + w * .5, side * (fo - .2)); flags.push({ x: fx, z: fz, ry: st.horiz ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? Math.PI : 0), c: pick([0x2d4a6b, 0xe8e2d2, 0xa8402e, 0xb58a3a, 0x2d4a6b]) }); }
        }
        // second row behind
        if (rnd() < .8) { const d2 = rr(9, 14), w2 = rr(8, 13), off2 = off + d / 2 + rr(2.5, 4.5) + d2 / 2;
          const [bx, bz] = st.horiz ? [s + w2 / 2, st.c + side * off2] : [st.c + side * off2, s + w2 / 2];
          st.horiz ? tryHouse(bx, bz, w2, d2, { h: rr(3.6, 4.6) }) : tryHouse(bx, bz, d2, w2, { h: rr(3.6, 4.6) }); }
        s += w + rr(0, .5);
      } else s += 2;
    }
  }
}
function fillHouses() {
  const xs = WALLW.map(p => p[0]), zs = WALLW.map(p => p[1]);
  for (let z = Math.min(...zs); z < Math.max(...zs); z += 13) for (let x = Math.min(...xs); x < Math.max(...xs); x += 13) {
    const w = rr(8, 15), d = rr(8, 15); tryHouse(x + rr(-3, 3), z + rr(-3, 3), w, d, { h: rr(3.5, 4.8) });
  }
}

// ---------- 6. trees ----------
function plantTrees() {
  // hills
  for (const hl of HILLS) {
    const n = Math.min(1600, Math.floor(hl[2] * hl[2] * .045 * Math.min(1, hl[3] / 40 + .3)));
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * hl[2] * 1.15; const x = wx(hl[0] + Math.cos(a) * r), z = wz(hl[1] + Math.sin(a) * r);
      const h = terrainH(x, z); const c = gget(x, z); if (h < 3.5 || (c !== 0 && c !== 255)) continue;
      trees.push({ x, z, t: rnd() < .55 ? 1 : 0, s: rr(3, 6.5) });
    }
  }
  // canal willows
  for (const c of CANALS) for (let i = 0; i < c.samples.length - 1; i += 5) {
    if (rnd() < .4) continue; const [ax, az] = c.samples[i], [bx, bz] = c.samples[i + 1]; const L = Math.hypot(bx - ax, bz - az) || 1; const nx = -(bz - az) / L, nz = (bx - ax) / L;
    for (const sg of [-1, 1]) { const x = ax + nx * sg * (c.w / 2 + 2), z = az + nz * sg * (c.w / 2 + 2); const v = gget(x, z); if ((v === 6) && inCity(x, z)) trees.push({ x, z, t: 2, s: rr(2.6, 3.6) }); }
  }
  // causeways
  for (const cw of CAUSEWAYS) { const A = P(...cw[0]), B = P(...cw[1]); const L = Math.hypot(B[0] - A[0], B[1] - A[1]); const nx = -(B[1] - A[1]) / L, nz = (B[0] - A[0]) / L;
    for (let s = 0; s < L; s += 11) for (const sg of [-1, 1]) { const x = A[0] + (B[0] - A[0]) * s / L + nx * sg * 4.2, z = A[1] + (B[1] - A[1]) * s / L + nz * sg * 4.2; if (gget(x, z) !== 3) trees.push({ x, z, t: rnd() < .7 ? 2 : 0, s: rr(2.6, 3.8) }); } }
  // lake shore, fields, city courtyards
  for (let i = 0; i < 9000; i++) {
    const px = rr(-300, 1750), py = rr(-900, 1400); const x = wx(px), z = wz(py); const h = terrainH(x, z); if (h < .7 || h > 3.4) continue;
    const ic = inCity(x, z); const c = gget(x, z);
    if (ic) { if (c === 0 && rnd() < .5) trees.push({ x, z, t: rnd() < .15 ? 2 : 0, s: rr(2.6, 4.5) }); else if (c === 5 && rnd() < .15) trees.push({ x, z, t: 0, s: rr(3, 5) }); }
    else if (c === 0 || c === 255) { const nearLake = lakeV(px, py) < 1.6; if (nearLake || rnd() < .45) trees.push({ x, z, t: nearLake && rnd() < .5 ? 2 : 0, s: rr(3, 5.5) }); }
  }
}

// ---------- terrain / water / sky ----------
function buildTerrain() {
  const TW = 7800, SEG = 300, tcx = wx(700), tcz = wz(250);
  const g = new THREE.PlaneGeometry(TW, TW, SEG, SEG); g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, uv = g.attributes.uv, cols = new Float32Array(pos.count * 3); const col = new THREE.Color(), tmp = new THREE.Color();
  const cCity = new THREE.Color('#8f8676'), cField = new THREE.Color('#7f8f58'), cField2 = new THREE.Color('#a49a63'), cHill = new THREE.Color('#4b6340'), cSand = new THREE.Color('#b4a682'), cBed = new THREE.Color('#5d6457');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + tcx, z = pos.getZ(i) + tcz, h = terrainH(x, z); pos.setXYZ(i, x, h, z); uv.setXY(i, x / 9, z / 9);
    if (inCity(x, z)) col.copy(cCity); else { const f = (Math.sin(x * .012) * Math.cos(z * .009 + Math.sin(x * .003) * 2) + 1) / 2; col.copy(cField).lerp(cField2, f > .62 ? .8 : .1); }
    if (h > 3) col.lerp(cHill, smooth(3, 22, h));
    if (h < 1.2) col.lerp(cSand, smooth(1.2, .4, h));
    if (h < 0) col.lerp(cBed, smooth(0, -2.5, h));
    cols[i * 3] = col.r; cols[i * 3 + 1] = col.g; cols[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat.ground); m.receiveShadow = true; scene.add(m); terrainMesh = m;
  const wg = new THREE.PlaneGeometry(TW * 2, TW * 2); wg.rotateX(-Math.PI / 2); const wu = wg.attributes.uv; for (let i = 0; i < wu.count; i++) wu.setXY(i, wu.getX(i) * 520, wu.getY(i) * 520);
  const water = new THREE.Mesh(wg, mat.water); water.position.set(tcx, .2, tcz); water.receiveShadow = true; scene.add(water);
}
let terrainMesh;
const skyU = { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, bot: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() }, sunCol: { value: new THREE.Color() } };
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: `varying vec3 vD; void main(){ vD = position; vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position = p.xyww; }`,
  fragmentShader: `uniform vec3 top,hor,bot,sunCol; uniform vec3 sunDir; varying vec3 vD;
    void main(){ vec3 d=normalize(vD); float h=d.y; vec3 c = h>0. ? mix(hor, top, pow(clamp(h,0.,1.),.5)) : mix(hor, bot, pow(clamp(-h,0.,1.),.35));
      float s=max(dot(d,normalize(sunDir)),0.); c += sunCol*(pow(s,900.)*3.+pow(s,10.)*.18);
      gl_FragColor=vec4(c,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(14000, 32, 16), skyMat); sky.frustumCulled = false; scene.add(sky);

// lights
const hemi = new THREE.HemisphereLight(0xd7dde2, 0x6e6352, 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.6); sun.castShadow = true;
sun.shadow.mapSize.set(QUALITY[quality].shadow, QUALITY[quality].shadow); sun.shadow.camera.near = 10; sun.shadow.camera.far = 9000;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(-.55, .62, .5).normalize();
function setShadowRange(r) { const c = sun.shadow.camera; c.left = c.bottom = -r; c.right = c.top = r; c.updateProjectionMatrix(); sun.shadow.bias = r > 500 ? -.0006 : -.0002; sun.shadow.normalBias = r > 500 ? 1.2 : .08; }

// ---------- build everything ----------
const glowPoints = { obj: null };
let houseBodies, houseRoofs, lanternMesh;
async function buildCity() {
  await prog('引水开河'); markCanals();
  await prog('筑城立门'); buildWall();
  await prog('营建宫阙官署'); buildLandmarks();
  await prog('开辟街巷'); rasterStreets(); buildBridges();
  await prog('里坊屋舍');
  for (const st of STREETS.filter(s => s.k === 'yujie')) streetFront(st);
  for (const st of STREETS.filter(s => s.major && s.k !== 'yujie')) streetFront(st);
  for (const st of STREETS.filter(s => !s.major)) streetFront(st);
  fillHouses();
  await prog('山水草木'); plantTrees(); buildTerrain();

  // street ribbons
  const bSlab = new GB(), bEarth = new GB();
  const yAt = (x, z) => Math.max(1.5, terrainH(x, z)) + .06;
  function quad(b, x0, z0, x1, z1, sc, lift = .06) {
    const lx = x1 - x0, lz = z1 - z0, ax = lx >= lz, n = Math.max(1, Math.ceil((ax ? lx : lz) / 8)), base = b.p.length / 3;
    for (let i = 0; i <= n; i++) { const f = i / n; let xa, za, xb, zb; if (ax) { xa = xb = x0 + lx * f; za = z0; zb = z1; } else { za = zb = z0 + lz * f; xa = x0; xb = x1; }
      b.v(xa, Math.max(1.5, terrainH(xa, za)) + lift, za, xa / sc, za / sc); b.v(xb, Math.max(1.5, terrainH(xb, zb)) + lift, zb, xb / sc, zb / sc); }
    for (let i = 0; i < n; i++) { const a = base + i * 2; b.q(a, a + 1, a + 3, a + 2); }
  }
  for (const st of STREETS) for (const run of st.runs) {
    const hw = st.w / 2, b = st.k === 'yujie' ? bSlab : bEarth, sc = st.k === 'yujie' ? 7 : 9;
    if (st.horiz) quad(b, run[0], st.c - hw, run[1], st.c + hw, sc, st.major ? .07 : .05); else quad(b, st.c - hw, run[0], st.c + hw, run[1], sc, st.major ? .07 : .05);
  }
  for (const p of paves) quad(p[4] === 'slab' ? bSlab : bEarth, p[0], p[1], p[2], p[3], 7, .04);
  for (const [b, m] of [[bSlab, mat.slab], [bEarth, mat.earth]]) { const mesh = new THREE.Mesh(b.build(), m); mesh.receiveShadow = true; scene.add(mesh); }

  // canals water + embankments
  const bW = new GB();
  for (const c of CANALS) {
    const pts = c.samples.filter((_, i) => i % 3 === 0); pts.push(c.samples[c.samples.length - 1]);
    const base = bW.p.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L;
      const hw = c.w / 2 + .2; bW.v(pts[i][0] + nx * hw, 1.56, pts[i][1] + nz * hw, (pts[i][0] + nx * hw) / 25, (pts[i][1] + nz * hw) / 25); bW.v(pts[i][0] - nx * hw, 1.56, pts[i][1] - nz * hw, (pts[i][0] - nx * hw) / 25, (pts[i][1] - nz * hw) / 25);
    }
    for (let i = 0; i < pts.length - 1; i++) { const a = base + i * 2; bW.q(a, a + 1, a + 3, a + 2); }
    for (let i = 0; i < c.samples.length - 1; i += 2) {
      const [ax, az] = c.samples[i], [bx, bz] = c.samples[Math.min(c.samples.length - 1, i + 2)]; const L = Math.hypot(bx - ax, bz - az) || 1; const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux;
      for (const sg of [-1, 1]) { const x = (ax + bx) / 2 + nx * sg * (c.w / 2 + .35), z = (az + bz) / 2 + nz * sg * (c.w / 2 + .35);
        const v = gget(x, z); if (v === 3 || v === 1 || v === 4 || !inCity(x, z)) continue; addPlain(x, 1.75, z, L + .1, .55, .6, 0x9d978a, Math.atan2(-uz, ux)); }
    }
  }
  for (const [x, z, r] of ponds) { const base = bW.p.length / 3; bW.v(x, 1.58, z, 0, 0); for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 2; bW.v(x + Math.cos(a) * r, 1.58, z + Math.sin(a) * r, 0, 0); } for (let i = 1; i <= 24; i++) bW.i.push(base, base + i, base + i + 1); }
  const cw = new THREE.Mesh(bW.build(), mat.water); cw.receiveShadow = true; scene.add(cw);

  // bridges
  const bB = new GB();
  for (const br of bridges) {
    const N = 18, dir = br.ax === 'x' ? [1, 0] : [0, 1], sd = br.ax === 'x' ? [0, 1] : [1, 0], hw = br.w / 2;
    const secs = [[-hw, hw, -.9, 0], [-hw, -hw + .35, 0, 1.0], [hw - .35, hw, 0, 1.0]];
    for (const [s0, s1, y0, y1] of secs) {
      const rings = [];
      for (let i = 0; i <= N; i++) {
        const t = -1 + 2 * i / N, a = t * br.len / 2, ty = br.base + br.rise * (1 - t * t) + .02, r = [];
        for (const [s, y] of [[s0, y0], [s1, y0], [s1, y1], [s0, y1]]) r.push(bB.v(br.x + dir[0] * a + sd[0] * s, ty + y, br.z + dir[1] * a + sd[1] * s, a / 3, y + s));
        rings.push(r);
      }
      for (let i = 0; i < N; i++) for (let k = 0; k < 4; k++) bB.q(rings[i][k], rings[i][(k + 1) % 4], rings[i + 1][(k + 1) % 4], rings[i + 1][k]);
      bB.q(rings[0][0], rings[0][1], rings[0][2], rings[0][3]); bB.q(rings[N][0], rings[N][1], rings[N][2], rings[N][3]);
    }
  }
  const bm = new THREE.Mesh(bB.build(), mat.bridge); bm.castShadow = bm.receiveShadow = true; scene.add(bm);

  await prog('点灯悬旗');
  adventure = createAdventure({
    scene, camera, houses, roofGeometry: G.roofHall, roofMaterial: mat.hallRoof,
    wx, wz, groundAt, findSpawn, isBlocked: blockedR,
    getMode: () => mode, getPlayer: () => player,
    travel: (x, z, faceTo) => { closeIntro(); hideCard(); toggleList(false); if (isTouch && !mini.classList.contains('collapsed')) toggleMini(); enterWalk(x, z, faceTo); },
    pause: paused => { resetInput(); if (paused) { hideCard(); toggleList(false); if (document.pointerLockElement) document.exitPointerLock(); } },
    face: (x, z) => { player.yaw = Math.atan2(-(x - player.x), -(z - player.z)); player.pitch = -.03; },
  });
  const o = new THREE.Object3D(), col = new THREE.Color();
  const inst = (geo, m, n, fn, cast = true) => {
    const chunks = new Map(), matrices = new Float32Array(n * 16), colors = new Float32Array(n * 3);
    let colored = false;
    for (let i = 0; i < n; i++) {
      o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1);
      const c = fn(i); o.updateMatrix(); o.matrix.toArray(matrices, i * 16);
      if (c !== undefined) { colored = true; col.set(c).toArray(colors, i * 3); }
      const key = `${Math.floor(o.position.x / 768)},${Math.floor(o.position.z / 768)}`;
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key).push(i);
    }
    const batch = new THREE.Group();
    for (const indices of chunks.values()) {
      const im = new THREE.InstancedMesh(geo, m, indices.length);
      for (let j = 0; j < indices.length; j++) {
        const i = indices[j]; o.matrix.fromArray(matrices, i * 16); im.setMatrixAt(j, o.matrix);
        if (colored) { col.fromArray(colors, i * 3); im.setColorAt(j, col); }
      }
      im.castShadow = cast; im.receiveShadow = true;
      im.computeBoundingBox(); im.computeBoundingSphere(); batch.add(im);
    }
    scene.add(batch); return batch;
  };
  inst(G.box, mat.brick, bricks.length, i => { const b = bricks[i]; o.position.set(b.x, b.y, b.z); o.rotation.y = b.ry; o.scale.set(b.sx, b.sy, b.sz); return 0xffffff; });
  inst(G.box, mat.plain, plains.length, i => { const b = plains[i]; o.position.set(b.x, b.y, b.z); o.rotation.y = b.ry || 0; o.scale.set(b.sx, b.sy, b.sz); return b.c; });
  plainsBuilt = plains.length;
  houseBodies = inst(G.body, mat.houseBody, houses.length, i => { const h = houses[i]; o.position.set(h.x, h.y, h.z); o.scale.set(h.w, h.h, h.d); return h.bc; });
  houseRoofs = inst(G.roofHouse, mat.roof, houses.length, i => { const h = houses[i]; const rot = h.d > h.w; o.position.set(h.x, h.y + h.h, h.z); o.rotation.y = rot ? Math.PI / 2 : 0; const L = Math.max(h.w, h.d) + 1.5, D = Math.min(h.w, h.d) + 1.5; o.scale.set(L, Math.min(h.w, h.d) * .4, D); return h.rc; });
  const twos = houses.filter(h => h.two);
  inst(G.skirtHouse, mat.roof, twos.length, i => { const h = twos[i]; const rot = h.d > h.w; o.position.set(h.x, h.y + h.h * .5, h.z); o.rotation.y = rot ? Math.PI / 2 : 0; o.scale.set(Math.max(h.w, h.d) + 2.6, .9, Math.min(h.w, h.d) + 2.6); return h.rc; });
  // trees
  const trunkG = new THREE.CylinderGeometry(.12, .2, 1, 5).translate(0, .5, 0);
  const canG = [new THREE.IcosahedronGeometry(1, 1), new THREE.ConeGeometry(1, 1, 7).translate(0, .5, 0), new THREE.SphereGeometry(1, 7, 6)];
  for (const t of trees) t.y = Math.max(1.3, terrainH(t.x, t.z));
  inst(trunkG, mat.trunk, trees.length, i => { const t = trees[i]; o.position.set(t.x, t.y - .2, t.z); o.scale.set(t.s * .5, t.t === 1 ? t.s * .7 : t.s * 1.1, t.s * .5); }, false);
  for (let ty = 0; ty < 3; ty++) {
    const list = trees.filter(t => t.t === ty);
    const greens = ty === 0 ? ['#4f6a3c', '#5d7743', '#46603a', '#6a7d45', '#587048'] : ty === 1 ? ['#2f4a35', '#36503a', '#2b4431'] : ['#93a862', '#a4b46d', '#87a05a'];
    inst(canG[ty], mat.canopy, list.length, i => { const t = list[i]; const y = t.y; o.rotation.y = rnd() * 6;
      if (ty === 0) { o.position.set(t.x, y + t.s * 1.25, t.z); o.scale.set(t.s * .85, t.s * .7, t.s * .85); }
      else if (ty === 1) { o.position.set(t.x, y + t.s * .45, t.z); o.scale.set(t.s * .55, t.s * 2.2, t.s * .55); }
      else { o.position.set(t.x, y + t.s * .95, t.z); o.scale.set(t.s * .75, t.s * 1.1, t.s * .75); }
      return pick(greens); }, true);
  }
  // lanterns, glow, flags
  lanternMesh = inst(new THREE.CylinderGeometry(.26, .26, .5, 8), mat.lantern, lanterns.length, i => { const l = lanterns[i]; o.position.set(l[0], l[1], l[2]); }, false);
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(lanterns.flat(), 3));
  glowPoints.obj = new THREE.Points(pg, new THREE.PointsMaterial({ map: glowTex, size: 5, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffb070, fog: true }));
  scene.add(glowPoints.obj);
  const flagG = new THREE.PlaneGeometry(1, 2.6).translate(.55, 0, 0);
  inst(flagG, mat.flag, flags.length, i => { const f = flags[i]; o.position.set(f.x, 1.5 + 5.2, f.z); o.rotation.y = f.ry; return f.c; });
  for (const f of flags) addPlain(f.x, 1.5 + 3.4, f.z, .14, 6.8, .14, 0x3d2c20);
  inst(G.box, mat.plain, plains.length - plainsBuilt, i => { const b = plains[plainsBuilt + i]; o.position.set(b.x, b.y, b.z); o.scale.set(b.sx, b.sy, b.sz); return b.c; });

  buildLabelsDom(); buildPeople(); buildBoats();
  const pm = new THREE.PMREMGenerator(renderer); const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(sky.geometry, skyMat)); applyTime(0); scene.environment = pm.fromScene(envScene, 0.04).texture;
}
let plainsBuilt = 0;

// ---------- people & boats ----------
let people = [], robeMesh, headMesh, boats = [], hullMesh, topMesh;
function buildPeople() {
  const pool = []; for (const st of STREETS) { if (st.k === 'lane') { for (const r of st.runs) if (r[1] - r[0] > 30) pool.push({ st, lo: r[0], hi: r[1], wgt: (r[1] - r[0]) * .25 }); } else pool.push({ st, lo: st.lo, hi: st.hi, wgt: (st.hi - st.lo) * (st.k === 'yujie' ? 6 : 1) }); }
  const tot = pool.reduce((a, b) => a + b.wgt, 0); const N = isTouch ? 600 : 1000;
  for (let i = 0; i < N; i++) { let r = rnd() * tot, p = pool[0]; for (const q of pool) { r -= q.wgt; if (r <= 0) { p = q; break; } }
    const lim = p.st.k === 'yujie' ? .25 : .3; people.push({ p, s: rr(p.lo, p.hi), off: rr(-lim, lim) * p.st.w, dir: rnd() < .5 ? -1 : 1, v: rr(.9, 1.5), ph: rnd() * 6, idle: rnd() < .15 }); }
  robeMesh = new THREE.InstancedMesh(new THREE.LatheGeometry([new THREE.Vector2(.21, 0), new THREE.Vector2(.24, .09), new THREE.Vector2(.15, .86), new THREE.Vector2(.24, 1.18), new THREE.Vector2(.11, 1.35)], 10), mat.robe, N);
  headMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(.13, 8, 6).translate(0, 1.47, 0), mat.skin, N);
  const col = new THREE.Color(); const robes = ['#2e3e55', '#6b4a32', '#d9d1bf', '#8a7a52', '#4a5a4a', '#7a2f25', '#3b3b3f', '#a59a80'];
  for (let i = 0; i < N; i++) { people[i].color = pick(robes); col.set(people[i].color); robeMesh.setColorAt(i, col); }
  for (const m of [robeMesh, headMesh]) { m.frustumCulled = false; m.castShadow = true; scene.add(m); }
  nearCrowd = createCrowd({ capacity: isTouch ? 36 : 64 }); scene.add(nearCrowd.group);
}
function buildBoats() {
  for (const c of CANALS) { const n = Math.floor(c.samples.length / 70); for (let i = 0; i < n; i++) boats.push({ c, s: rr(0, c.samples.length - 1), v: rr(.4, .8) * (rnd() < .5 ? -1 : 1), off: rr(-.22, .22) * c.w, big: false }); }
  for (let i = 0; i < 16; i++) boats.push({ lake: true, a: rnd() * 6.28, k: rr(.35, 1), v: rr(.008, .02) * (rnd() < .5 ? -1 : 1), big: rnd() < .4 });
  hullMesh = new THREE.InstancedMesh(G.box, mat.boat, boats.length); topMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(.75, .75, 1, 10, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2), mat.boatTop, boats.length);
  for (const m of [hullMesh, topMesh]) { m.frustumCulled = false; m.castShadow = true; scene.add(m); }
}
const _o = new THREE.Object3D();
function updatePeople(dt, t) {
  const candidates = [], nearView = camera.position.y < 100;
  for (let i = 0; i < people.length; i++) {
    const w = people[i], previousS = w.s;
    if (!w.idle) { w.s += w.dir * w.v * dt; if (w.s > w.p.hi) { w.s = w.p.hi; w.dir = -1; } if (w.s < w.p.lo) { w.s = w.p.lo; w.dir = 1; } }
    [w.x, w.z] = XY(w.p.st, w.s, w.off);
    if (mode === 'walk' && Math.hypot(w.x - player.x, w.z - player.z) < 1.05) {
      const lateral = w.p.st.horiz ? w.z - player.z : w.x - player.x;
      w.off = THREE.MathUtils.clamp(w.off + (Math.sign(lateral) || (i % 2 ? 1 : -1)) * dt * 1.8, -w.p.st.w * .36, w.p.st.w * .36);
      const approaching = (w.p.st.horiz ? player.x - w.x : player.z - w.z) * w.dir > 0;
      if (!w.idle && approaching) { w.s = previousS; w.dir *= -1; }
      [w.x, w.z] = XY(w.p.st, w.s, w.off); w.placed = false;
    }
    if (!w.idle || !w.placed) w.ground = groundAt(w.x, w.z);
    w.phase = t * 6 * w.v + w.ph;
    w.y = w.ground + (w.idle ? 0 : Math.abs(Math.sin(w.phase)) * .05);
    w.yaw = w.p.st.horiz ? (w.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (w.dir > 0 ? 0 : Math.PI);
    const distance = (w.x - camera.position.x) ** 2 + (w.z - camera.position.z) ** 2;
    if (nearView && distance < 65 ** 2) candidates.push({ i, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const detailed = new Set(candidates.slice(0, isTouch ? 36 : 64).map(c => c.i));
  nearCrowd.begin();
  for (let i = 0; i < people.length; i++) {
    const w = people[i], near = detailed.has(i);
    if (near) nearCrowd.add({ x: w.x, y: w.ground, z: w.z, yaw: w.yaw, phase: w.phase, walking: !w.idle, color: w.color });
    if (w.idle && w.placed && near === w.detailed) continue;
    _o.position.set(w.x, w.y, w.z); _o.rotation.set(0, w.yaw, 0); _o.scale.setScalar(near ? 0 : 1);
    _o.updateMatrix(); robeMesh.setMatrixAt(i, _o.matrix); headMesh.setMatrixAt(i, _o.matrix); w.placed = true; w.detailed = near;
  }
  nearCrowd.commit();
  robeMesh.instanceMatrix.needsUpdate = headMesh.instanceMatrix.needsUpdate = true;
  for (let i = 0; i < boats.length; i++) {
    const b = boats[i]; let x, z, ang;
    if (b.lake) { b.a += b.v * dt; x = wx(760 + Math.cos(b.a) * 270 * b.k); z = wz(-330 + Math.sin(b.a) * 150 * b.k); const sg = Math.sign(b.v); ang = Math.atan2(Math.cos(b.a) * 150 * sg, -Math.sin(b.a) * 270 * sg); }
    else { const n = b.c.samples.length - 1; b.s += b.v * dt / 2; if (b.s > n - 1) { b.s = n - 1; b.v = -b.v; } if (b.s < 0) { b.s = 0; b.v = -b.v; }
      const i0 = Math.floor(b.s), f = b.s - i0, A = b.c.samples[i0], B = b.c.samples[Math.min(n, i0 + 1)]; const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz) || 1;
      x = lerp(A[0], B[0], f) - dz / L * b.off; z = lerp(A[1], B[1], f) + dx / L * b.off; ang = Math.atan2(dz, dx); }
    const y = b.lake ? .2 : 1.56, sc = b.big ? 2 : 1;
    _o.position.set(x, y + .2 * sc, z); _o.rotation.set(0, -ang, 0); _o.scale.set(6 * sc, .6 * sc, 1.7 * sc); _o.updateMatrix(); hullMesh.setMatrixAt(i, _o.matrix);
    _o.position.set(x, y + .45 * sc, z); _o.scale.set(2.6 * sc, 1.2 * sc, 1.1 * sc); _o.updateMatrix(); topMesh.setMatrixAt(i, _o.matrix);
  }
  hullMesh.instanceMatrix.needsUpdate = topMesh.instanceMatrix.needsUpdate = true;
}

// ---------- labels DOM ----------
const KIND = { gate: '城门', palace: '宫城', office: '官署', temple: '寺观坛庙', market: '街市', bridge: '桥梁', water: '河湖', hill: '山', ward: '街坊' };
function addStaticLabels() {
  const hl = (n, px, py, d) => { const x = wx(px), z = wz(py); addLabel(n, 'hill', x, terrainH(x, z) + 22, z, d, 0, '湖山'); };
  hl('凤凰山', 190, 300, '皇城所倚之山，在城西南隅。城墙随山势起伏，大内在其东麓。');
  hl('吴山', 470, 345, '城内西南的小山，山上祠庙林立，可俯瞰全城与钱塘江。');
  hl('七宝山', 400, 290, '吴山一脉的山岭。'); hl('宝莲山', 360, 560, '城内小山，原图标于太庙西侧。');
  hl('南屏山', 170, -200, '西湖南岸的山，净慈寺在其北麓。'); hl('宝石山', 1300, -330, '西湖北岸的山，山顶立保俶塔。'); hl('孤山', 1090, -250, '西湖中的孤屿。北宋林逋隐居于此，以梅为妻、以鹤为子。');
  const wl = (n, px, py, d, g = '湖山') => addLabel(n, 'water', wx(px), 14, wz(py), d, 0, g);
  wl('西湖', 760, -330, '城西之湖，三面环山，一面临城。西城诸门出城即是湖岸。');
  wl('钱塘江', -300, 700, '城东南的大江，以江潮闻名。');
  wl('苏堤', 760, -575, '北宋元祐年间苏轼知杭州时，疏浚西湖，以葑泥筑成的长堤，堤上六桥。');
  wl('白堤', 1135, -80, '连接断桥与孤山的湖堤。');
  wl('盐桥运河', 690, 885, '城内的主干河道，与御街平行，南北贯城，漕船货船由此入城。', '街市桥梁');
  wl('市河', 1066, 450, '城内河道之一，沿河桥市相接。', '街市桥梁');
  for (const br of bridges) {
    if (br.st && br.st.k === 'yujie' && Math.abs(tpx(br.x) - 1055) < 10) addLabel('众安桥', 'bridge', br.x, 9, br.z, '御街跨河的石桥。桥南便是北瓦，一带是临安夜市最热闹的地方。', 40, '街市桥梁');
    if (br.st && Math.abs(tpy(br.z) - 700) < 3 && Math.abs(tpx(br.x) - 1298) < 12) addLabel('观桥', 'bridge', br.x, 9, br.z, '御街一线北段的石桥。', 40, '街市桥梁');
  }
  addLabel('断桥', 'bridge', wx(1107), 8, wz(70), '白堤东端的石桥。', 40, '湖山');
  addLabel('御街', 'market', wx(800), 10, wz(700), '自皇城和宁门向北贯穿全城的大街，长一万三千五百余尺，以石板铺砌。两侧店铺鳞次栉比，是临安的中轴，也是最繁华的商业街。', 0, '街市桥梁');
  const wards = ['清河坊', '融和坊', '太平坊', '积善坊', '修义坊', '里仁坊', '保民坊', '定民坊', '睦亲坊'];
  [645, 690, 780, 825, 915, 960, 1005, 1095, 1140].forEach((px, i) => addLabel(wards[i], 'ward', wx(px), 9, wz(688), '御街两侧的街坊。原图沿御街一字排开标注各坊名。', 0, ''));
}
let labelEls = [];
function buildLabelsDom() {
  addStaticLabels();
  const box = $('labels');
  for (const l of labels) {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'lb k-' + l.kind; el.textContent = l.name;
    el.setAttribute('aria-label', `${l.name}，${KIND[l.kind] || '地名'}`);
    el.addEventListener('click', e => { e.stopPropagation(); showCard(l, true); }); box.appendChild(el);
    l.el = el; l.width = el.offsetWidth; l.height = el.offsetHeight;
  }
  const order = ['宫城', '宫城官署', '街市桥梁', '寺观坛庙', '城门', '湖山'], list = $('list');
  for (const grp of order) {
    const items = labels.filter(l => l.group === grp); if (!items.length) continue;
    const h = document.createElement('h3'); h.textContent = grp; list.appendChild(h);
    for (const l of items) { const b = document.createElement('button'); b.innerHTML = `<span>${l.name}</span><small>${KIND[l.kind] || ''}</small>`; b.onclick = () => { toggleList(false); goToLabel(l); }; list.appendChild(b); }
  }
}
const _v = new THREE.Vector3();
let labelsVisible = true;
const labelPriority = { palace: 9, gate: 8, hill: 7, water: 6, market: 5, temple: 4, office: 4, bridge: 3, ward: 1 };
function updateLabels() {
  if (!labelsVisible) return;
  const W = host.clientWidth, H = host.clientHeight, walk = mode === 'walk' || (fly && fly.toWalk);
  const candidates = [], placed = [];
  const viewDistance = Math.max(9000, camera.position.distanceTo(controls.target) + 4500);
  const hud = document.querySelector('.hud-top').getBoundingClientRect();
  for (const l of labels) {
    const d = camera.position.distanceTo(l.pos);
    const max = walk ? (l.kind === 'hill' ? 1500 : l.kind === 'water' ? 400 : l.kind === 'ward' ? 140 : l.kind === 'bridge' ? 220 : 340) : (l.kind === 'ward' ? 1100 : l.kind === 'bridge' ? 1600 : viewDistance);
    _v.copy(l.pos).project(camera);
    if (_v.z < -1 || _v.z > 1 || d > max || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) continue;
    const x = (_v.x * .5 + .5) * W, y = (-_v.y * .5 + .5) * H;
    const rect = { left: x - l.width / 2 - 4, right: x + l.width / 2 + 4, top: y - l.height - 4, bottom: y + 4 };
    if (rect.right < 0 || rect.left > W || rect.top < 0 || rect.bottom > H) continue;
    if (rect.left < hud.right && rect.right > hud.left && rect.top < hud.bottom + 4) continue;
    candidates.push({ l, x, y, rect, opacity: 1 - smooth(max * .7, max, d), priority: l === cardLabel ? 100 : labelPriority[l.kind] || 0 });
  }
  candidates.sort((a, b) => b.priority - a.priority);
  const visible = new Set();
  for (const c of candidates) {
    if (placed.some(r => c.rect.left < r.right && c.rect.right > r.left && c.rect.top < r.bottom && c.rect.bottom > r.top)) continue;
    placed.push(c.rect); visible.add(c.l);
    c.l.el.style.transform = `translate(${c.x}px,${c.y}px) translate(-50%,-100%)`;
    c.l.el.style.opacity = c.opacity.toFixed(2);
  }
  for (const l of labels) {
    const hidden = !visible.has(l);
    if (hidden !== l.hidden) { l.el.classList.toggle('hide', hidden); l.hidden = hidden; }
  }
}

// ---------- day / night ----------
const DAY = { top: '#86a5c0', hor: '#e3dac6', bot: '#9f9883', fog: '#d8d1bd', hs: '#d7dde2', hg: '#6e6352', hi: 1.15, sc: '#fff0d4', si: 2.7, exp: 1.0, env: .8, sunCol: '#fff3d6' };
const NIGHT = { top: '#04070e', hor: '#1c2434', bot: '#0a0d12', fog: '#141a27', hs: '#3a4a6b', hg: '#1c1912', hi: .32, sc: '#9eb3dd', si: .4, exp: 1.25, env: .18, sunCol: '#3d4d6e' };
let night = 0, nightTarget = 0;
const cA = new THREE.Color(), cB = new THREE.Color();
const mixC = (a, b, t, out) => out.copy(cA.set(a)).lerp(cB.set(b), t);
function applyTime(t) {
  mixC(DAY.top, NIGHT.top, t, skyU.top.value); mixC(DAY.hor, NIGHT.hor, t, skyU.hor.value); mixC(DAY.bot, NIGHT.bot, t, skyU.bot.value);
  mixC(DAY.sunCol, NIGHT.sunCol, t, skyU.sunCol.value); skyU.sunDir.value.copy(SUN_DIR);
  mixC(DAY.fog, NIGHT.fog, t, scene.fog.color); mixC(DAY.hs, NIGHT.hs, t, hemi.color); mixC(DAY.hg, NIGHT.hg, t, hemi.groundColor);
  hemi.intensity = lerp(DAY.hi, NIGHT.hi, t); mixC(DAY.sc, NIGHT.sc, t, sun.color); sun.intensity = lerp(DAY.si, NIGHT.si, t);
  renderer.toneMappingExposure = lerp(DAY.exp, NIGHT.exp, t);
  for (const m of envMats) m.envMapIntensity = lerp(DAY.env, NIGHT.env, t);
  mat.houseBody.emissiveIntensity = t * 1.1; mat.lantern.emissiveIntensity = .2 + t * 3.2; mat.hall.emissiveIntensity = t * .12;
  if (glowPoints.obj) glowPoints.obj.material.opacity = t * .95;
}

// ---------- controls / modes ----------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = .08; controls.maxPolarAngle = 1.47; controls.minDistance = 40; controls.maxDistance = 6500; controls.screenSpacePanning = false;
controls.target.set(wx(760), 0, wz(560)); camera.position.set(wx(760), 1350, wz(560) + 2100); controls.update();
controls.autoRotate = !reduceMotion; controls.autoRotateSpeed = .25;
let mode = 'overview', fly = null, overviewPreset = 'city';
const player = { x: 0, z: 0, eye: 3, yaw: 0, pitch: 0 };
const keys = {}; let running = false;
function setModeUI() {
  const w = mode === 'walk' || !!fly?.toWalk;
  for (const [id, active] of [['btnOverview', !w && overviewPreset === 'city'], ['btnLake', !w && overviewPreset === 'lake'], ['btnWalk', w]]) {
    $(id).classList.toggle('on', active); $(id).setAttribute('aria-pressed', String(active));
  }
  $('cross').hidden = !w || isTouch; $('joy').hidden = !(w && isTouch); $('runBtn').hidden = !(w && isTouch);
  $('hint').textContent = w ? (isTouch ? '左下摇杆行走 · 滑动屏幕转向 · 点「全城」回到空中' : '点击画面锁定鼠标 · WASD 行走 · Shift 疾行 · V 回到俯瞰 · N 昼夜')
                            : (isTouch ? '单指旋转 · 双指缩放平移 · 点地名查看 · 点「漫步」落到街上' : '拖动旋转 · 右键平移 · 滚轮缩放 · 双击地面落地漫步');
  $('hint').hidden = innerWidth < 560;
  setShadowRange(w ? 140 : 1900);
}
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function flyTo(pos, quat, dur, fov, done, toWalk = false) {
  resetInput(); controls.autoRotate = false;
  if (controls.enabled) { controls.enableDamping = false; controls.update(); controls.enableDamping = true; }
  fly = { fp: camera.position.clone(), fq: camera.quaternion.clone(), tp: pos, tq: quat, t: 0, dur: reduceMotion ? .01 : dur, ffov: camera.fov, tfov: fov, done, toWalk, arc: Math.min(400, camera.position.distanceTo(pos) * .25) };
  controls.enabled = false; controls.autoRotate = false;
}
function findSpawn(x, z) {
  const candidate = (dx, dz, radius) => {
    const px = x + dx * CS, pz = z + dz * CS, c = gget(px, pz);
    return (c === 4 || c === 6 || c === 3 || (radius > 60 && (c === 0 || c === 5))) && !blockedR(px, pz) ? [px, pz] : null;
  };
  for (let R = 0; R < 180; R++) {
    for (let dz = -R; dz <= R; dz++) {
      if (Math.abs(dz) === R) {
        for (let dx = -R; dx <= R; dx++) { const p = candidate(dx, dz, R); if (p) return p; }
      } else {
        const p = candidate(-R, dz, R) || candidate(R, dz, R); if (p) return p;
      }
    }
  }
  let nearest = null, distance = Infinity;
  const consider = (px, pz) => {
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < distance && !blockedR(px, pz)) { nearest = [px, pz]; distance = d; }
  };
  for (const st of STREETS) for (const run of st.runs) {
    if (run[1] - run[0] < CS * 2) continue;
    const along = THREE.MathUtils.clamp(st.horiz ? x : z, run[0] + CS, run[1] - CS);
    consider(...XY(st, along));
  }
  for (const br of bridges) {
    const offset = THREE.MathUtils.clamp(br.ax === 'x' ? x - br.x : z - br.z, -br.len / 2 + CS, br.len / 2 - CS);
    consider(br.x + (br.ax === 'x' ? offset : 0), br.z + (br.ax === 'z' ? offset : 0));
  }
  return nearest;
}
function streetYaw(x, z, pref) {
  let ax = 0, az = 0; for (let k = -12; k <= 12; k++) { const a = gget(x + k * CS, z), b = gget(x, z + k * CS); if (a === 4 || a === 6 || a === 3) ax++; if (b === 4 || b === 6 || b === 3) az++; }
  let dx, dz; if (ax >= az) { dx = Math.sign(pref[0]) || 1; dz = 0; } else { dx = 0; dz = Math.sign(pref[1]) || 1; }
  return Math.atan2(-dx, -dz);
}
function enterWalk(x, z, faceTo) {
  const spawn = findSpawn(x, z);
  if (!spawn) { $('hint').textContent = '附近没有可通行的道路，请从名胜列表选择入城位置。'; return; }
  const [sx, sz] = spawn;
  if (document.pointerLockElement) document.exitPointerLock();
  let yaw; if (faceTo) yaw = Math.atan2(-(faceTo[0] - sx), -(faceTo[1] - sz)); else { const f = new THREE.Vector3(); camera.getWorldDirection(f); yaw = streetYaw(sx, sz, [f.x, f.z]); }
  player.x = sx; player.z = sz; player.yaw = yaw; player.pitch = faceTo ? .05 : 0; player.eye = groundAt(sx, sz) + 1.62;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(player.pitch, yaw, 0, 'YXZ'));
  hideCard(); mode = 'fly';
  flyTo(new THREE.Vector3(sx, player.eye, sz), q, 2.6, 70, () => { mode = 'walk'; setModeUI(); }, true);
  setModeUI();
}
function exitWalk(target) {
  overviewPreset = null;
  const f = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const t = target ?? new THREE.Vector3(player.x, groundAt(player.x, player.z), player.z);
  const pos = t.clone().addScaledVector(f, -420).add(new THREE.Vector3(0, 360, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, t, new THREE.Vector3(0, 1, 0)));
  if (document.pointerLockElement) document.exitPointerLock();
  mode = 'fly'; setModeUI();
  flyTo(pos, q, 2.2, 45, () => { mode = 'overview'; controls.target.copy(t); controls.enabled = true; controls.update(); setModeUI(); });
}
function overviewFly(target, dist = 520) {
  overviewPreset = null;
  if (document.pointerLockElement) document.exitPointerLock();
  const dir = camera.position.clone().sub(controls.target); dir.y = 0; if (dir.lengthSq() < 1) dir.set(0, 0, 1); dir.normalize();
  const pos = target.clone().addScaledVector(dir, dist * .8).add(new THREE.Vector3(0, dist * .65, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, target, new THREE.Vector3(0, 1, 0)));
  mode = 'fly'; flyTo(pos, q, 2, 45, () => { mode = 'overview'; controls.target.copy(target); controls.enabled = true; controls.update(); setModeUI(); });
}
function overviewPose(preset) {
  const target = new THREE.Vector3(wx(760), 0, wz(preset === 'lake' ? 350 : 560));
  const direction = preset === 'lake' ? new THREE.Vector3(310, 1650, -2900) : new THREE.Vector3(0, 1350, 2100);
  let distance = direction.length(); direction.normalize();
  const basis = new THREE.Matrix4().lookAt(direction, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  const right = new THREE.Vector3().setFromMatrixColumn(basis, 0), up = new THREE.Vector3().setFromMatrixColumn(basis, 1);
  const halfV = Math.tan(THREE.MathUtils.degToRad(22.5)), halfH = halfV * camera.aspect;
  for (const x of [wx(55), wx(1420)]) for (const y of [0, 260]) for (const z of [wz(-800), wz(1080)]) {
    const point = new THREE.Vector3(x, y, z).sub(target);
    distance = Math.max(distance, point.dot(direction) + Math.max(Math.abs(point.dot(right)) / halfH, Math.abs(point.dot(up)) / halfV));
  }
  distance *= 1.05;
  return { target, position: target.clone().addScaledVector(direction, distance), distance };
}
function fullOverview(preset = 'city') {
  closeIntro(); hideCard(); toggleList(false); overviewPreset = preset;
  if (document.pointerLockElement) document.exitPointerLock();
  const { target, position: pos, distance } = overviewPose(preset);
  controls.maxDistance = Math.max(6500, distance * 1.2);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pos, target, new THREE.Vector3(0, 1, 0)));
  mode = 'fly';
  flyTo(pos, q, 2.2, 45, () => { mode = 'overview'; controls.target.copy(target); controls.enabled = true; controls.update(); setModeUI(); });
  setModeUI();
}
function goToLabel(l) {
  showCard(l, false);
  const t = new THREE.Vector3(l.pos.x, Math.max(1.5, terrainH(l.pos.x, l.pos.z)), l.pos.z);
  if (mode === 'walk') enterWalk(l.pos.x + 40, l.pos.z + 40, [l.pos.x, l.pos.z]);
  else overviewFly(t, l.kind === 'hill' || l.kind === 'water' ? 1400 : 420);
}
function blocked(x, z) { const c = gget(x, z); if (c === 1 || c === 2 || c === 255) return true; if (c !== 3 && terrainH(x, z) < .35) return true; return false; }
function blockedR(x, z) { const r = .35; return blocked(x - r, z - r) || blocked(x + r, z - r) || blocked(x - r, z + r) || blocked(x + r, z + r) || !!adventure?.isBlocked(x, z); }

// ---------- input ----------
const cvs = renderer.domElement;
cvs.tabIndex = 0; cvs.setAttribute('aria-label', '临安三维场景，V 切换漫步与俯瞰，WASD 行走，N 切换昼夜');
addEventListener('keydown', e => {
  if (!$('loading').hidden || e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
  if (adventure?.paused) return;
  if (e.code === 'KeyE') { e.preventDefault(); if (!e.repeat) adventure?.interact(); return; }
  if (e.code === 'KeyJ') { if (!e.repeat) adventure?.openJournal(); return; }
  keys[e.code] = true;
  if (mode === 'walk' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'KeyV') { if (mode === 'walk') exitWalk(); else if (mode === 'overview') { closeIntro(); enterWalk(controls.target.x, controls.target.z); } }
  if (e.code === 'Tab' && document.pointerLockElement === cvs) { e.preventDefault(); exitWalk(); }
  if (e.code === 'KeyN') setNight(nightTarget ? 0 : 1);
  if (e.code === 'KeyM') toggleMini();
  if (e.code === 'KeyL') toggleLabels();
  if (e.code === 'Escape') { hideCard(); toggleList(false); }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', resetInput);
document.addEventListener('visibilitychange', resetInput);
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== cvs) resetInput(); });
let dragging = false;
cvs.addEventListener('mousedown', e => { if (mode === 'walk') { dragging = true; if (!document.pointerLockElement && !isTouch) { try { const p = cvs.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) {} } } });
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', e => {
  if (mode !== 'walk') return;
  if (document.pointerLockElement === cvs || dragging) { player.yaw -= e.movementX * .0022; player.pitch = Math.max(-1.3, Math.min(1.3, player.pitch - e.movementY * .0022)); }
});
cvs.addEventListener('dblclick', e => {
  if (mode !== 'overview') return;
  const r = cvs.getBoundingClientRect(); const m = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  const rc = new THREE.Raycaster(); rc.setFromCamera(m, camera); const hit = rc.intersectObject(terrainMesh)[0];
  if (hit) enterWalk(hit.point.x, hit.point.z);
});
cvs.addEventListener('pointerdown', () => { controls.autoRotate = false; });
// touch: look by dragging, joystick to move
const joy = { id: null, x: 0, y: 0 }, look = { id: null, x: 0, y: 0 };
const joyEl = $('joy'), knob = $('joyKnob');
function resetInput() {
  for (const key in keys) keys[key] = false;
  joy.id = look.id = null; joy.x = joy.y = 0; running = false; dragging = false;
  knob.style.transform = ''; $('runBtn').classList.remove('on');
}
addEventListener('touchcancel', resetInput);
joyEl.addEventListener('touchstart', e => { const t = e.changedTouches[0]; joy.id = t.identifier; moveJoy(t); e.preventDefault(); }, { passive: false });
function moveJoy(t) { const r = joyEl.getBoundingClientRect(); let dx = (t.clientX - r.left - r.width / 2) / (r.width / 2), dy = (t.clientY - r.top - r.height / 2) / (r.height / 2); const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } joy.x = dx; joy.y = dy; knob.style.transform = `translate(${dx * 36}px,${dy * 36}px)`; }
addEventListener('touchmove', e => { for (const t of e.changedTouches) { if (t.identifier === joy.id) moveJoy(t); if (t.identifier === look.id && mode === 'walk') { player.yaw -= (t.clientX - look.x) * .005; player.pitch = Math.max(-1.3, Math.min(1.3, player.pitch - (t.clientY - look.y) * .005)); look.x = t.clientX; look.y = t.clientY; } } }, { passive: true });
addEventListener('touchend', e => { for (const t of e.changedTouches) { if (t.identifier === joy.id) { joy.id = null; joy.x = joy.y = 0; knob.style.transform = ''; } if (t.identifier === look.id) look.id = null; } });
cvs.addEventListener('touchstart', e => { if (mode !== 'walk') return; const t = e.changedTouches[0]; look.id = t.identifier; look.x = t.clientX; look.y = t.clientY; }, { passive: true });
$('runBtn').onclick = () => { running = !running; $('runBtn').classList.toggle('on', running); };

// ---------- UI wiring ----------
function closeIntro() { $('intro').hidden = true; }
$('goOverview').onclick = () => fullOverview();
$('goWalk').onclick = () => { closeIntro(); const [x, z] = P(660, 700); enterWalk(x, z, [wx(1000), wz(700)]); };
$('btnOverview').onclick = () => fullOverview();
$('btnLake').onclick = () => fullOverview('lake');
$('btnWalk').onclick = () => { closeIntro(); if (mode === 'overview') enterWalk(controls.target.x, controls.target.z); };
function setNight(v) {
  nightTarget = v;
  for (const [id, active] of [['btnDay', !v], ['btnNight', !!v]]) { $(id).classList.toggle('on', active); $(id).setAttribute('aria-pressed', String(active)); }
}
$('btnDay').onclick = () => setNight(0); $('btnNight').onclick = () => setNight(1);
function toggleList(v) { const l = $('list'); l.hidden = v === undefined ? !l.hidden : !v; $('btnList').setAttribute('aria-expanded', String(!l.hidden)); }
$('btnList').onclick = () => { closeIntro(); toggleList(); };
function toggleLabels() {
  labelsVisible = !labelsVisible; $('labels').hidden = !labelsVisible;
  $('btnLabels').setAttribute('aria-pressed', String(labelsVisible));
  if (labelsVisible) updateLabels();
}
$('btnLabels').onclick = toggleLabels;
$('quality').onchange = () => {
  quality = $('quality').value;
  const profile = QUALITY[quality];
  renderer.setPixelRatio(Math.min(devicePixelRatio, profile.pixelRatio));
  renderer.setSize(host.clientWidth, host.clientHeight);
  sun.shadow.mapSize.set(profile.shadow, profile.shadow);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  renderer.shadowMap.needsUpdate = true;
};
let cardLabel = null;
function showCard(l, withActs) {
  cardLabel = l; $('cardKind').textContent = (KIND[l.kind] || '') + (l.group && l.group !== KIND[l.kind] ? ' · ' + l.group : '');
  $('cardName').textContent = l.name; $('cardDesc').textContent = l.desc || '';
  $('cardActs').hidden = !withActs;
  $('card').hidden = false;
}
function hideCard() { $('card').hidden = true; cardLabel = null; }
$('cardX').onclick = hideCard;
$('cardWalk').onclick = () => { if (!cardLabel) return; const l = cardLabel; enterWalk(l.pos.x + 30, l.pos.z + 30, [l.pos.x, l.pos.z]); };
$('cardFly').onclick = () => { if (!cardLabel) return; const l = cardLabel; const t = new THREE.Vector3(l.pos.x, Math.max(1.5, terrainH(l.pos.x, l.pos.z)), l.pos.z); if (mode === 'walk') exitWalk(t); else overviewFly(t, 420); };
// minimap
const CROP = { x: 55, y: 120, w: 1360, h: 945 };
const mini = $('mini'), miniCv = $('miniCv'), mctx = miniCv.getContext('2d');
function toggleMini() {
  const collapsed = mini.classList.toggle('collapsed');
  $('miniToggle').textContent = collapsed ? '展开' : '收起';
  $('miniToggle').setAttribute('aria-label', collapsed ? '展开小地图' : '收起小地图');
  $('miniToggle').setAttribute('aria-expanded', String(!collapsed));
}
$('miniToggle').onclick = e => { e.stopPropagation(); toggleMini(); };
miniCv.addEventListener('click', e => {
  const r = miniCv.getBoundingClientRect(); const px = CROP.x + (e.clientX - r.left) / r.width * CROP.w, py = CROP.y + (e.clientY - r.top) / r.height * CROP.h;
  closeIntro(); const x = wx(px), z = wz(py);
  if (mode === 'walk') enterWalk(x, z); else if (mode === 'overview') overviewFly(new THREE.Vector3(x, Math.max(1.5, terrainH(x, z)), z), 600);
});
function drawMini() {
  if (mini.classList.contains('collapsed')) return;
  const W = miniCv.clientWidth, H = miniCv.clientHeight, dpr = Math.min(2, devicePixelRatio);
  if (!W || !H) return;
  if (miniCv.width !== Math.round(W * dpr) || miniCv.height !== Math.round(H * dpr)) { miniCv.width = Math.round(W * dpr); miniCv.height = Math.round(H * dpr); }
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0); mctx.clearRect(0, 0, W, H);
  const toM = (x, z) => [(tpx(x) - CROP.x) / CROP.w * W, (tpy(z) - CROP.y) / CROP.h * H];
  const f = new THREE.Vector3(); camera.getWorldDirection(f); const ang = Math.atan2(f.z, f.x);
  let [mx, my] = mode === 'overview' ? toM(controls.target.x, controls.target.z) : toM(camera.position.x, camera.position.z);
  mctx.save(); mctx.translate(mx, my); mctx.rotate(ang);
  mctx.fillStyle = 'rgba(180,64,44,.22)'; mctx.beginPath(); mctx.moveTo(0, 0); mctx.arc(0, 0, mode === 'overview' ? 40 : 26, -.5, .5); mctx.closePath(); mctx.fill();
  mctx.fillStyle = '#b4402c'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 1.5; mctx.beginPath(); mctx.moveTo(8, 0); mctx.lineTo(-5, -5); mctx.lineTo(-2, 0); mctx.lineTo(-5, 5); mctx.closePath(); mctx.fill(); mctx.stroke();
  mctx.restore();
}

// ---------- main loop ----------
const clock = new THREE.Clock(); let infoTimer = 0, hudTimer = 0;
const frameDirection = new THREE.Vector3(), shadowCenter = new THREE.Vector3(), playerRotation = new THREE.Euler(0, 0, 0, 'YXZ');
function loop() {
  const dt = Math.min(.05, clock.getDelta()), t = clock.elapsedTime;
  if (Math.abs(night - nightTarget) > .001) { night += Math.sign(nightTarget - night) * Math.min(Math.abs(nightTarget - night), dt / 1.6); applyTime(night); }
  mat.water.normalMap.offset.set(t * .006, t * .004);
  if (fly) {
    fly.t += dt / fly.dur; const k = ease(Math.min(1, fly.t));
    camera.position.lerpVectors(fly.fp, fly.tp, k); camera.position.y += Math.sin(k * Math.PI) * fly.arc * (fly.toWalk ? .4 : 1);
    camera.quaternion.slerpQuaternions(fly.fq, fly.tq, k); camera.fov = lerp(fly.ffov, fly.tfov, k); camera.updateProjectionMatrix();
    if (fly.t >= 1) { const d = fly.done; fly = null; d && d(); }
  } else if (mode === 'walk') {
    const canMove = !adventure?.paused;
    let fx = 0, fz = 0; const fw = canMove ? (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - joy.y : 0, st = canMove ? (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x : 0;
    if (canMove && keys.KeyQ) player.yaw += dt * 1.6;
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    fx = -sy * fw + cy * st; fz = -cy * fw - sy * st; const l = Math.hypot(fx, fz);
    if (l > 0) { const sp = (keys.ShiftLeft || keys.ShiftRight || running ? 13 : 4.5) * dt * Math.min(1, l) / l; const nx = player.x + fx * sp, nz = player.z + fz * sp;
      if (!blockedR(nx, player.z)) player.x = nx; if (!blockedR(player.x, nz)) player.z = nz; }
    const ge = groundAt(player.x, player.z) + 1.62; player.eye += (ge - player.eye) * Math.min(1, dt * 10);
    camera.position.set(player.x, player.eye + (l > 0 ? Math.sin(t * 9) * .03 : 0), player.z);
    camera.quaternion.setFromEuler(playerRotation.set(player.pitch, player.yaw, 0));
    infoTimer -= dt; if (infoTimer < 0 && !adventure?.active) { infoTimer = .3; let best = null, bd = 1e9; for (const lb of labels) { if (!lb.infoR) continue; const d = Math.hypot(lb.pos.x - player.x, lb.pos.z - player.z); if (d < lb.infoR + 30 && d < bd) { bd = d; best = lb; } }
      if (best && best !== cardLabel) showCard(best, false); else if (!best && cardLabel && $('cardActs').hidden) hideCard(); }
  } else {
    controls.update();
    const gh = Math.max(1.5, terrainH(camera.position.x, camera.position.z)) + 12; if (camera.position.y < gh) camera.position.y = gh;
  }
  // shadow follows the view
  const c = mode === 'walk' || (fly && fly.toWalk && fly.t > .6) ? shadowCenter.set(camera.position.x, 0, camera.position.z) : controls.target;
  sun.target.position.set(c.x, 0, c.z); sun.position.set(c.x + SUN_DIR.x * 4000, SUN_DIR.y * 4000, c.z + SUN_DIR.z * 4000);
  const clearance = camera.position.y - Math.max(1.5, terrainH(camera.position.x, camera.position.z));
  // A tiny near plane makes distant water and paving fight with the terrain.
  const nearClip = mode === 'walk' ? .3 : THREE.MathUtils.clamp(clearance * .03, .3, 150);
  if (Math.abs(camera.near - nearClip) > .001) { camera.near = nearClip; camera.updateProjectionMatrix(); }
  scene.fog.density = lerp(.00016, .0011, smooth(400, 40, clearance)) * Math.min(1, 1600 / Math.max(1600, clearance));
  if (people.length) updatePeople(dt, t);
  adventure?.update(dt, t, night);
  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 1 / 30;
    camera.getWorldDirection(frameDirection); $('needle').style.transform = `rotate(${Math.atan2(-frameDirection.z, frameDirection.x) * 180 / Math.PI}deg)`;
    updateLabels(); drawMini();
  }
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
function onResize() {
  const W = host.clientWidth, H = host.clientHeight; renderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix();
  controls.maxDistance = Math.max(6500, overviewPose(overviewPreset || 'city').distance * 1.2); setModeUI();
  const top = document.querySelector('.hud-top').getBoundingClientRect().bottom + 8;
  $('list').style.top = `${top}px`; $('card').style.top = W <= 560 ? `${top}px` : '';
  document.documentElement.style.setProperty('--game-hud-bottom', `${top - 8}px`);
  const renderedLabels = labels.filter(l => l.el), hiddenLabels = renderedLabels.filter(l => l.hidden);
  for (const l of hiddenLabels) l.el.classList.remove('hide');
  for (const l of renderedLabels) { l.width = l.el.offsetWidth; l.height = l.el.offsetHeight; }
  for (const l of hiddenLabels) l.el.classList.add('hide');
  hudTimer = 0;
}
addEventListener('resize', onResize);
document.fonts.addEventListener('loadingdone', onResize);

(async () => {
  try { await Promise.race([document.fonts.load('20px "Ma Shan Zheng"', '临安'), new Promise(r => setTimeout(r, 1500))]); } catch (_) {}
  await buildCity();
  applyTime(0); onResize(); $('loading').hidden = true;
  if (isTouch) $('keys').innerHTML = '<b>俯瞰</b><span>单指旋转 · 双指缩放平移 · 点地名看介绍</span><b>漫步</b><span>左下摇杆行走 · 滑动屏幕转向 · 「疾行」加速</span>';
  window.__linan = {
    enterWalk, P, player, setNight, wx, wz, adventure, nightNow: () => { setNight(1); night = 1; applyTime(1); },
    stats: () => ({ mode, view: overviewPreset, quality, night, camera: camera.position.toArray(), near: camera.near, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, shadowSize: sun.shadow.mapSize.x, labelsVisible: labelsVisible ? labels.filter(l => !l.hidden).length : 0 })
  };
  window.__ready = { houses: houses.length, trees: trees.length, bridges: bridges.length, people: people.length, lanterns: lanterns.length };
  loop();
})().catch(err => { $('prog').textContent = '加载失败：' + err.message; console.error(err); });
