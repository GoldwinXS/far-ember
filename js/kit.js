// Ember Squad: procedural hero props. Shipping containers, crystal clusters, hay bales and grass cards.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from './data.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const bx = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// ------------------------------------------------------------ shipping container
// Built lying along +z, centred on the origin, sitting on y = 0. len in tiles.
const containerGeo = new Map();
function containerGeometry(len) {
  if (containerGeo.has(len)) return containerGeo.get(len);
  const W = 0.98, H = 1.82, L = len - 0.04;
  const body = [], frame = [], bars = [];
  // side walls: alternating ribs give the corrugated profile
  const pitch = 0.1;
  for (const side of [-1, 1]) {
    for (let z = -L / 2 + 0.08; z < L / 2 - 0.08; z += pitch) {
      body.push(bx(0.02, H - 0.16, pitch * 0.55, side * (W / 2 - 0.02), H / 2, z));
      body.push(bx(0.02, H - 0.16, pitch * 0.5, side * (W / 2 - 0.045), H / 2, z + pitch / 2));
    }
  }
  // front wall ribs (horizontal) and door end
  for (let y = 0.12; y < H - 0.1; y += pitch) body.push(bx(W - 0.1, pitch * 0.55, 0.02, 0, y, -L / 2 + 0.02));
  body.push(bx(W - 0.1, H - 0.16, 0.03, 0, H / 2, L / 2 - 0.03));
  for (const x of [-0.2, 0.2]) for (let y = 0.25; y < H - 0.2; y += 0.42) body.push(bx(0.36, 0.3, 0.012, x, y, L / 2 - 0.01));
  // roof with shallow ribs
  body.push(bx(W - 0.04, 0.03, L - 0.06, 0, H - 0.04, 0));
  for (let z = -L / 2 + 0.2; z < L / 2 - 0.1; z += 0.28) body.push(bx(W - 0.1, 0.02, 0.12, 0, H - 0.015, z));
  // frame: corner posts, rails, corner castings
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    frame.push(bx(0.09, H, 0.09, sx * (W / 2 - 0.045), H / 2, sz * (L / 2 - 0.045)));
    for (const sy of [0, 1]) frame.push(bx(0.12, 0.09, 0.12, sx * (W / 2 - 0.05), sy ? H - 0.045 : 0.045, sz * (L / 2 - 0.05)));
  }
  for (const sx of [-1, 1]) for (const y of [0.05, H - 0.06]) frame.push(bx(0.07, 0.1, L - 0.1, sx * (W / 2 - 0.035), y, 0));
  for (const sz of [-1, 1]) for (const y of [0.05, H - 0.06]) frame.push(bx(W - 0.1, 0.1, 0.07, 0, y, sz * (L / 2 - 0.035)));
  // locking bars and handles on the doors
  for (const x of [-0.36, -0.12, 0.12, 0.36]) {
    bars.push(new THREE.CylinderGeometry(0.014, 0.014, H - 0.2, 6).translate(x, H / 2, L / 2 + 0.01));
    bars.push(bx(0.05, 0.03, 0.05, x, 0.9, L / 2 + 0.03));
  }
  const g = { body: mergeGeometries(body), frame: mergeGeometries(frame), bars: mergeGeometries(bars) };
  containerGeo.set(len, g);
  return g;
}
const markCache = new Map();
function markingTex(seed) {
  if (markCache.has(seed)) return markCache.get(seed);
  const r = makeRng(seed);
  // frontier freight lines: an owner, a chevron mark and a short hold code (no real-world container codes)
  const owners = ['LANTERN FREIGHT', 'VELL SUPPLY', 'KESTREL AGRI', 'FRONTIER RELIEF', 'ARDEN MINING'];
  const t = canvasTex(512, 256, (g) => {
    g.clearRect(0, 0, 512, 256);
    g.fillStyle = 'rgba(240,238,228,0.9)';
    for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(24 + k * 22, 40); g.lineTo(38 + k * 22, 62); g.lineTo(24 + k * 22, 84); g.lineTo(34 + k * 22, 84); g.lineTo(48 + k * 22, 62); g.lineTo(34 + k * 22, 40); g.fill(); }
    g.font = 'bold 42px Arial Narrow, Arial, sans-serif';
    g.fillText(owners[Math.floor(r() * owners.length)], 104, 78);
    g.font = 'bold 28px Arial, sans-serif';
    g.fillText(`HOLD ${'ABCDEF'[Math.floor(r() * 6)]}${Math.floor(1 + r() * 9)}-${Math.floor(100 + r() * 899)}`, 104, 120);
    // dirt and rust streaks over the paint
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(${90 + r() * 50},${45 + r() * 25},${20 + r() * 15},${0.08 + r() * 0.18})`;
      const x = r() * 512;
      g.fillRect(x, r() * 60, 2 + r() * 6, 80 + r() * 180);
    }
  });
  markCache.set(seed, t);
  return t;
}
export function buildContainer(len, color, seed, set) {
  const g = new THREE.Group();
  const geo = containerGeometry(len);
  const paint = new THREE.MeshStandardMaterial({ color, map: set && set.map, normalMap: set && set.normalMap, roughnessMap: set && set.arm, roughness: 0.85, metalness: 0.3, envMapIntensity: 1 });
  if (paint.map) { paint.map = paint.map.clone(); paint.map.repeat.set(1.5, 1.5); paint.map.needsUpdate = true; }
  const frameM = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.7, metalness: 0.45 });
  const barM = new THREE.MeshStandardMaterial({ color: '#8b8f92', roughness: 0.45, metalness: 0.8 });
  for (const [geom, m] of [[geo.body, paint], [geo.frame, frameM], [geo.bars, barM]]) {
    const me = new THREE.Mesh(geom, m);
    me.castShadow = me.receiveShadow = true;
    g.add(me);
  }
  // stencilled markings on one long side and the doors
  const mark = new THREE.MeshStandardMaterial({ map: markingTex(seed), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 });
  const side = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), mark);
  side.position.set(0.49 + 0.012, 1.25, -len / 4);
  side.rotation.y = Math.PI / 2;
  g.add(side);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), mark);
  door.position.set(0, 1.45, len / 2 - 0.0);
  g.add(door);
  return g;
}

// ------------------------------------------------------------ floodlight mast
// A steel pole on a concrete footing with two lamp heads tilted down toward +z. head is where the light sits.
const mastMats = {};
export function buildFloodMast(lit) {
  const g = new THREE.Group();
  const M = (mastMats[lit] ||= {
    steel: new THREE.MeshStandardMaterial({ color: '#8d9296', roughness: 0.42, metalness: 0.85 }),
    dark: new THREE.MeshStandardMaterial({ color: '#2a2d30', roughness: 0.55, metalness: 0.6 }),
    conc: new THREE.MeshStandardMaterial({ color: '#9a978f', roughness: 0.92 }),
    lens: new THREE.MeshStandardMaterial({ color: '#cfd6da', roughness: 0.12, emissive: '#fff2d8', emissiveIntensity: lit ? 2.4 : 0 }),
  });
  const { steel, dark, conc, lens } = M;
  const H = 4.6;
  const parts = [
    [new THREE.CylinderGeometry(0.045, 0.07, H, 12).translate(0, H / 2 + 0.25, 0), steel],
    [bx(0.42, 0.25, 0.42, 0, 0.125, 0), conc],
    [bx(0.24, 0.03, 0.24, 0, 0.265, 0), steel],
    [bx(0.84, 0.05, 0.05, 0, H + 0.2, 0.02), steel],
    [bx(0.12, 0.3, 0.07, 0, 1.2, -0.08), dark],
  ];
  for (const sx of [-0.3, 0.3]) parts.push([bx(0.03, 0.14, 0.03, sx, H + 0.12, 0.04), steel]);
  for (const [geo, m] of parts) {
    const me = new THREE.Mesh(geo, m);
    me.castShadow = me.receiveShadow = true;
    g.add(me);
  }
  for (const sx of [-0.3, 0.3]) {
    const head = new THREE.Group();
    const housing = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.25, 0.11, 2, 0.02), dark);
    housing.castShadow = true;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.19), lens);
    face.position.z = 0.056;
    head.add(housing, face);
    for (let i = -2; i <= 2; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.21, 0.05), dark);
      fin.position.set(i * 0.06, 0, -0.075);
      head.add(fin);
    }
    head.position.set(sx, H + 0.02, 0.12);
    head.rotation.x = 0.8;
    g.add(head);
  }
  g.userData.head = new THREE.Vector3(0, H - 0.1, 0.25);
  g.userData.aim = new THREE.Vector3(0, 0, 5);
  return g;
}

// ------------------------------------------------------------ crystal cluster
let veinTex = null;
// Glowing cracks: the edges of Voronoi cells (narrow where two cells meet), brighter toward the base.
export function crackCanvas(w, h, cells, seed, base = true, width = 2.6) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h), d = img.data;
  const r = makeRng(seed);
  const pts = Array.from({ length: cells }, () => [r() * w, r() * h, 0.5 + r() * 0.5]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let d1 = 1e9, d2 = 1e9, k = 1;
    for (const [px, py, pk] of pts) {
      // wrap horizontally so the texture tiles round a crystal or a limb
      const dx = Math.min(Math.abs(x - px), w - Math.abs(x - px)), dy = y - py, dd = dx * dx + dy * dy;
      if (dd < d1) { d2 = d1; d1 = dd; k = pk; } else if (dd < d2) d2 = dd;
    }
    const edge = Math.max(0, 1 - (Math.sqrt(d2) - Math.sqrt(d1)) / width);
    const fade = base ? 0.35 + 0.65 * (y / h) : 1;
    const v = Math.pow(edge, 1.6) * k * fade;
    const i = (y * w + x) * 4;
    d[i] = 110 * v; d[i + 1] = 240 * v; d[i + 2] = 250 * v; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
function veins() {
  if (veinTex) return veinTex;
  veinTex = new THREE.CanvasTexture(crackCanvas(256, 512, 40, 17, true, 5));
  veinTex.colorSpace = THREE.SRGBColorSpace;
  veinTex.wrapS = veinTex.wrapT = THREE.RepeatWrapping;
  return veinTex;
}
function shard(h, rad, r) {
  // an irregular 7 to 9 sided crystal: the lower rings wander in and out, the tip leans off centre
  const seg = 7 + Math.floor(r() * 3);
  const body = new THREE.CylinderGeometry(rad, rad * 1.1, h, seg, 3, true);
  const p = body.attributes.position;
  const jit = Array.from({ length: (seg + 1) * 4 }, () => 0.82 + r() * 0.3);
  for (let i = 0; i < p.count; i++) {
    const ring = Math.floor(i / (seg + 1)), col = i % (seg + 1);
    if (ring === 0) continue; // the top ring stays true so the tip sits on it
    const k = jit[ring * (seg + 1) + (col % seg)];
    p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k);
  }
  body.translate(0, h / 2, 0);
  const tip = new THREE.ConeGeometry(rad, h * (0.28 + r() * 0.16), seg, 1, true);
  const tp = tip.attributes.position;
  const lean = [(r() - 0.5) * rad * 0.7, (r() - 0.5) * rad * 0.7];
  for (let i = 0; i < tp.count; i++) if (tp.getY(i) > 0) { tp.setX(i, tp.getX(i) + lean[0]); tp.setZ(i, tp.getZ(i) + lean[1]); }
  tip.translate(0, h + tip.parameters.height / 2, 0);
  return mergeGeometries([body.toNonIndexed(), tip.toNonIndexed()]);
}
export function buildCrystals(seed, height, spread) {
  const r = makeRng(seed);
  const n = 3 + Math.floor(r() * 4);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const h = height * (i === 0 ? 1 : 0.35 + r() * 0.55);
    const s = shard(h, 0.09 + r() * 0.1 + (i === 0 ? 0.08 : 0), r);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3((r() - 0.5) * spread, -0.05, (r() - 0.5) * spread),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.7 * (i ? 1 : 0.25), r() * 6, (r() - 0.5) * 0.7 * (i ? 1 : 0.25))),
      new THREE.Vector3(1, 1, 1));
    parts.push(s.applyMatrix4(m));
  }
  const geo = mergeGeometries(parts);
  geo.computeVertexNormals();
  const m = new THREE.MeshPhysicalMaterial({
    color: '#202631', roughness: 0.16, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08,
    emissive: '#5ae8f4', emissiveMap: veins(), emissiveIntensity: 1.7, flatShading: true, envMapIntensity: 1.2,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = mesh.receiveShadow = true;
  // rocky base so the cluster grows out of the ground
  const base = new THREE.Mesh(new THREE.DodecahedronGeometry(spread * 0.45 + 0.12, 0).scale(1, 0.32, 1), new THREE.MeshStandardMaterial({ color: '#2a2630', roughness: 0.95, flatShading: true }));
  base.position.y = 0.02;
  base.receiveShadow = true;
  const g = new THREE.Group();
  g.add(mesh, base);
  return g;
}

// ------------------------------------------------------------ hay bale
let hayTexs = null;
function hayTextures() {
  if (hayTexs) return hayTexs;
  const r = makeRng(3);
  const side = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#a88c4c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5200; i++) {
      const v = 150 + r() * 90;
      g.strokeStyle = `rgba(${v},${v * 0.82},${v * 0.42},${0.25 + r() * 0.55})`;
      g.lineWidth = 0.5 + r() * 1.3;
      const x = r() * w, y = r() * h, a = (r() - 0.5) * 0.5, l = 8 + r() * 26;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    // net wrap bands
    g.strokeStyle = 'rgba(230,226,210,0.35)'; g.lineWidth = 1;
    for (let x = 0; x < w; x += 18) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 40, h); g.stroke(); }
    const sh = g.createLinearGradient(0, 0, 0, h);
    sh.addColorStop(0, 'rgba(0,0,0,0.25)'); sh.addColorStop(0.15, 'rgba(0,0,0,0)'); sh.addColorStop(0.85, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = sh; g.fillRect(0, 0, w, h);
  });
  const end = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#9c8044'; g.fillRect(0, 0, w, h);
    for (let a = 0; a < 140; a += 0.08) {
      const rad = a * 0.9;
      if (rad > 128) break;
      const v = 140 + r() * 90;
      g.fillStyle = `rgba(${v},${v * 0.8},${v * 0.4},0.6)`;
      g.fillRect(128 + Math.cos(a) * rad, 128 + Math.sin(a) * rad, 2.5, 2.5);
    }
  });
  hayTexs = { side, end };
  return hayTexs;
}
// Square bale: compressed flakes of pale straw with seams between them, a bump map from the same canvas,
// a rounded, slightly lumpy body and two twine bands.
let baleTexs = null;
function baleTextures() {
  if (baleTexs) return baleTexs;
  const r = makeRng(5);
  const map = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#a58f60'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const dark = r() < 0.22;
      const v = dark ? 60 + r() * 50 : 170 + r() * 80;
      g.strokeStyle = `rgba(${v},${v * 0.86},${v * 0.55},${0.3 + r() * 0.6})`;
      g.lineWidth = 0.6 + r() * 1.4;
      const x = r() * w, y = r() * h, a = (r() - 0.5) * 0.9, l = 6 + r() * 22;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    // seams between the flakes
    for (let x = 20; x < w; x += 34 + r() * 16) {
      g.strokeStyle = 'rgba(40,30,15,0.45)'; g.lineWidth = 2 + r() * 2;
      g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y <= h; y += 16) g.lineTo(x + (r() - 0.5) * 6, y);
      g.stroke();
    }
  });
  baleTexs = { map };
  return baleTexs;
}
const baleGeo = (() => {
  let geo = null;
  return () => {
    if (geo) return geo;
    geo = new RoundedBoxGeometry(0.82, 0.38, 0.46, 4, 0.055);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + (Math.sin(x * 23 + z * 7) + Math.sin(z * 31 + y * 17) + Math.sin(y * 29 + x * 11)) * 0.008;
      p.setXYZ(i, x * k, y * k, z * k);
    }
    return geo;
  };
})();
export function buildBale(rng) {
  const { map } = baleTextures();
  // three shades of straw, shared, so a field of bales costs few draw calls
  baleTexs.mats ||= [0.9, 0.98, 1.05].map((k) => new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 2.5, roughness: 1, color: new THREE.Color('#ece3cc').multiplyScalar(k) }));
  baleTexs.twine ||= new THREE.MeshStandardMaterial({ color: '#4a4232', roughness: 0.9 });
  const straw = baleTexs.mats[Math.floor(rng() * 3)], twine = baleTexs.twine;
  const bale = new THREE.Group();
  const body = new THREE.Mesh(baleGeo(), straw);
  body.castShadow = body.receiveShadow = true;
  bale.add(body);
  for (const tx of [-0.2, 0.2]) {
    const tw = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.008, 4, 24).scale(1, 0.92, 1.12).rotateY(Math.PI / 2), twine);
    tw.position.x = tx;
    bale.add(tw);
  }
  return bale;
}
export function buildHay(rot) {
  const { side, end } = hayTextures();
  const sideM = new THREE.MeshStandardMaterial({ map: side, roughness: 1, color: '#efe4c8' });
  const endM = new THREE.MeshStandardMaterial({ map: end, roughness: 1, color: '#efe4c8' });
  const geo = new THREE.CylinderGeometry(0.42, 0.42, 0.82, 28, 1);
  const m = new THREE.Mesh(geo, [sideM, endM, endM]);
  m.rotation.z = Math.PI / 2;
  m.rotation.y = rot;
  m.position.y = 0.41;
  m.castShadow = m.receiveShadow = true;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

// ------------------------------------------------------------ grass cards
let grassMat = null;
let grassImpostor = null;
export function setGrassImpostor(tex) { grassImpostor = tex; grassMat = null; }
export const hasGrassImpostor = () => true;
export function grassMaterial() {
  if (grassMat) return grassMat;
  if (grassImpostor && false) {
    grassMat = new THREE.MeshStandardMaterial({ map: grassImpostor, alphaTest: 0.35, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.92, color: '#ffffff' });
    return grassMat;
  }
  const r = makeRng(29);
  // a dense tuft: many thin blades fanning out from the base, in the colours of the ground scan
  const tex = canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 420; i++) {
      const bx = w / 2 + (r() - 0.5) * w * 0.55, lean = (bx - w / 2) * (0.6 + r() * 0.9) + (r() - 0.5) * 40;
      const top = h * (0.12 + r() * 0.62), wid = 0.7 + r() * 1.6;
      const green = r() < 0.35;
      const tip = green ? [128 + r() * 30, 140 + r() * 25, 78 + r() * 20] : [176 + r() * 30, 160 + r() * 25, 108 + r() * 25];
      const base = [tip[0] * 0.55, tip[1] * 0.55, tip[2] * 0.5];
      const gr = g.createLinearGradient(0, h, 0, top);
      gr.addColorStop(0, `rgb(${base[0] | 0},${base[1] | 0},${base[2] | 0})`);
      gr.addColorStop(1, `rgb(${tip[0] | 0},${tip[1] | 0},${tip[2] | 0})`);
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(bx - wid, h);
      g.quadraticCurveTo(bx + lean * 0.35, (h + top) / 2, bx + lean, top);
      g.quadraticCurveTo(bx + lean * 0.35 + wid * 0.4, (h + top) / 2, bx + wid, h);
      g.fill();
    }
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  grassMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, alphaToCoverage: true, side: THREE.FrontSide, roughness: 0.95, color: '#ffffff' });
  return grassMat;
}
let grassGeo = null;
export function grassCardGeometry() {
  if (grassGeo) return grassGeo;
  // three crossed cards, each with a front and a back face so both sides light like the ground
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const front = new THREE.PlaneGeometry(0.34, 0.24).translate(0, 0.12, 0).rotateY((i * Math.PI) / 3);
    const back = front.clone();
    const idx = back.index.array;
    for (let k = 0; k < idx.length; k += 3) { const t = idx[k]; idx[k] = idx[k + 2]; idx[k + 2] = t; }
    parts.push(front, back);
  }
  grassGeo = mergeGeometries(parts);
  const n = grassGeo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  n.needsUpdate = true;
  return grassGeo;
}

// ------------------------------------------------------------ weapons
// Built from side profiles extruded with a bevel. Metres, barrel along +x, origin at the pistol grip.
const WMAT = {
  poly: new THREE.MeshStandardMaterial({ color: '#2e3134', roughness: 0.6, metalness: 0.05 }),
  tan: new THREE.MeshStandardMaterial({ color: '#2b2d2f', roughness: 0.6, metalness: 0.05 }),
  steel: new THREE.MeshStandardMaterial({ color: '#454a4f', roughness: 0.32, metalness: 0.85 }),
  wood: new THREE.MeshStandardMaterial({ color: '#2f3134', roughness: 0.55, metalness: 0.05 }),
  rubber: new THREE.MeshStandardMaterial({ color: '#141516', roughness: 0.9, metalness: 0 }),
  cloth: new THREE.MeshStandardMaterial({ color: '#4b4f3c', roughness: 0.95, metalness: 0 }),
  brass: new THREE.MeshStandardMaterial({ color: '#c9a45a', roughness: 0.3, metalness: 1 }),
  shell: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a2a').multiplyScalar(1.8) }),
  cell: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a2a').multiplyScalar(1.8) }),
  glass: new THREE.MeshStandardMaterial({ color: '#0f2030', roughness: 0.05, metalness: 0.3, envMapIntensity: 2.2 }),
  pale: new THREE.MeshStandardMaterial({ color: '#b2aca2', roughness: 0.65, metalness: 0 }),
  glow: new THREE.MeshStandardMaterial({ color: '#8ef5ff', emissive: '#59e6f2', emissiveIntensity: 1.6 }),
};
// Every corner of a gun profile is rounded (radius up to 1.4 cm, never more than a third of either edge),
// so stocks and receivers read as moulded parts instead of cut boxes.
function roundPath(path, pts, rMax = 0.014) {
  const n = pts.length;
  const P = pts.map(([x, y]) => new THREE.Vector2(x, y));
  const corner = (i) => {
    const p = P[i], a = P[(i - 1 + n) % n], c = P[(i + 1) % n];
    const r = Math.min(rMax, p.distanceTo(a) / 3, p.distanceTo(c) / 3);
    return [p.clone().lerp(a, r / p.distanceTo(a)), p, p.clone().lerp(c, r / p.distanceTo(c))];
  };
  const first = corner(0);
  path.moveTo(first[2].x, first[2].y);
  for (let k = 1; k <= n; k++) {
    const [i0, p, i1] = corner(k % n);
    path.lineTo(i0.x, i0.y);
    path.quadraticCurveTo(p.x, p.y, i1.x, i1.y);
  }
  return path;
}
function prof(points, depth, bevel = 0.006, holes = []) {
  const sh = roundPath(new THREE.Shape(), points);
  for (const h of holes) sh.holes.push(roundPath(new THREE.Path(), h, 0.01));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel * 1.4, bevelSize: bevel * 1.1, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}
const tube = (r, x0, x1, y, seg = 12) => new THREE.CylinderGeometry(r, r, x1 - x0, seg).rotateZ(Math.PI / 2).translate((x0 + x1) / 2, y, 0);
export const WEAPON_LEN = { rifle: 0.935, shotgun: 0.975, sniper: 1.18, lmg: 1.02, lance: 0.875 };
export function wornGuns(set) {
  // a worn-metal normal map gives the flat gun faces some surface
  if (!set || WMAT.steel.normalMap) return;
  for (const m of [WMAT.steel, WMAT.poly, WMAT.tan]) {
    m.normalMap = set.normalMap;
    m.normalScale = new THREE.Vector2(0.35, 0.35);
    m.roughnessMap = set.arm;
    m.needsUpdate = true;
  }
}
// What makes the squad's guns blasters: focusing coils along the barrel, a flared emitter at the tip and
// glowing energy cells in Ember orange. Positions are in the gun's own space (barrel along +x, about a metre long).
function blasterParts(add, kind) {
  const ring = (x, r, y, m = WMAT.steel) => add(new THREE.TorusGeometry(r, r * 0.22, 6, 18).rotateY(Math.PI / 2).translate(x, y, 0), m);
  const cellStrip = (x, y, w, h) => { for (const z of [-1, 1]) add(new THREE.BoxGeometry(w, h, 0.004).translate(x, y, z * 0.027), WMAT.cell); };
  if (kind === 'rifle') {
    for (const [k, x] of [0.62, 0.69, 0.76].entries()) ring(x, 0.02, 0.022, k === 1 ? WMAT.cell : WMAT.steel);
    add(new THREE.CylinderGeometry(0.016, 0.022, 0.06, 12).rotateZ(Math.PI / 2).translate(0.9, 0.022, 0), WMAT.steel);
    ring(0.93, 0.013, 0.022, WMAT.cell);
    cellStrip(0.13, 0.02, 0.17, 0.008);
    for (const z of [-1, 1]) add(new THREE.BoxGeometry(0.035, 0.06, 0.004).translate(0.13, -0.09, z * 0.016), WMAT.cell);
  } else if (kind === 'lmg') {
    for (let k = 0; k < 5; k++) ring(0.62 + k * 0.07, 0.026, 0.022, k % 2 ? WMAT.cell : WMAT.steel);
    for (let k = 0; k < 6; k++) add(new THREE.BoxGeometry(0.03, 0.03, 0.004).translate(0.62 + k * 0.05, 0.05, 0), WMAT.steel);
    add(new THREE.CylinderGeometry(0.065, 0.065, 0.1, 18).rotateX(Math.PI / 2).translate(0.12, -0.08, 0.035), WMAT.steel);
    for (const z of [0.0, 0.07]) add(new THREE.TorusGeometry(0.066, 0.006, 6, 24).translate(0.12, -0.08, z), WMAT.cell);
    ring(1.0, 0.016, 0.022, WMAT.cell);
    cellStrip(0.14, 0.03, 0.2, 0.01);
  } else if (kind === 'shotgun') {
    add(new THREE.CylinderGeometry(0.05, 0.022, 0.08, 16, 1, true).rotateZ(Math.PI / 2).translate(0.93, 0.015, 0), WMAT.steel);
    add(new THREE.CircleGeometry(0.03, 14).rotateY(Math.PI / 2).translate(0.9, 0.015, 0), WMAT.cell);
    for (const x of [0.62, 0.72]) ring(x, 0.032, 0.015);
    cellStrip(0.1, 0.035, 0.18, 0.008);
  } else if (kind === 'sniper') {
    for (let k = 0; k < 6; k++) ring(0.64 + k * 0.075, 0.024, 0.018, k % 2 ? WMAT.cell : WMAT.steel);
    add(new THREE.CylinderGeometry(0.012, 0.02, 0.06, 12).rotateZ(Math.PI / 2).translate(1.15, 0.018, 0), WMAT.steel);
    ring(1.17, 0.011, 0.018, WMAT.cell);
    cellStrip(0.14, 0.02, 0.2, 0.008);
  }
}
export function buildWeapon(kind) {
  const g = new THREE.Group();
  const add = (geo, m) => { const me = new THREE.Mesh(geo, m); me.castShadow = true; g.add(me); return me; };
  const grip = () => {
    add(prof([[-0.035, -0.02], [0.02, -0.02], [0.0, -0.13], [-0.055, -0.125]], 0.03), WMAT.poly);
    add(new THREE.TorusGeometry(0.03, 0.005, 6, 12, Math.PI).rotateZ(Math.PI).translate(0.045, -0.02, 0), WMAT.steel);
  };
  const rail = (x0, x1, y) => { for (let x = x0; x < x1; x += 0.018) add(new THREE.BoxGeometry(0.01, 0.008, 0.026).translate(x, y, 0), WMAT.steel); };
  const port = (x, y) => add(new THREE.BoxGeometry(0.06, 0.022, 0.004).translate(x, y, 0.024), WMAT.poly);
  if (kind === 'rifle' || kind === 'lmg') {
    const lmg = kind === 'lmg';
    add(prof([[-0.06, -0.02], [0.3, -0.02], [0.3, 0.06], [0.12, 0.07], [-0.06, 0.06]], lmg ? 0.05 : 0.042), WMAT.steel);
    add(prof([[0.3, -0.015], [0.56, -0.012], [0.56, 0.05], [0.3, 0.055]], lmg ? 0.058 : 0.05, 0.006), lmg ? WMAT.poly : WMAT.tan);
    add(tube(lmg ? 0.014 : 0.011, 0.56, lmg ? 1.0 : 0.88, 0.022), WMAT.steel);
    add(tube(0.017, lmg ? 0.95 : 0.84, lmg ? 1.02 : 0.9, 0.022, 8), WMAT.steel);
    add(prof([[-0.06, 0.055], [-0.06, -0.015], [-0.2, -0.045], [-0.36, -0.06], [-0.36, 0.045], [-0.2, 0.05]], 0.04, 0.009), lmg ? WMAT.poly : WMAT.tan);
    add(new RoundedBoxGeometry(0.022, 0.11, 0.046, 2, 0.006).translate(-0.37, -0.008, 0), WMAT.rubber);
    add(new THREE.BoxGeometry(0.14, 0.012, 0.03).translate(-0.24, 0.05, 0), WMAT.poly);
    grip();
    add(new THREE.BoxGeometry(0.26, 0.012, 0.022).translate(0.14, 0.072, 0), WMAT.steel);
    rail(0.04, 0.27, 0.082);
    port(0.12, 0.03);
    if (lmg) {
      add(new RoundedBoxGeometry(0.11, 0.12, 0.1, 3, 0.025).translate(0.12, -0.08, 0.035), WMAT.cloth);
      add(new THREE.BoxGeometry(0.18, 0.025, 0.02).translate(0.12, 0.1, 0), WMAT.poly);
      for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.006, 0.006, 0.22, 6).rotateZ(Math.PI / 2 - 0.25).rotateY(s * 0.12).translate(0.72, -0.01, s * 0.012), WMAT.steel);
    } else {
      add(prof([[0.09, -0.02], [0.145, -0.02], [0.175, -0.15], [0.115, -0.165]], 0.028), WMAT.poly);
      add(new RoundedBoxGeometry(0.075, 0.042, 0.034, 2, 0.008).translate(0.15, 0.1, 0), WMAT.poly);
      const lens = add(tube(0.012, 0.185, 0.19, 0.103), WMAT.glass);
      void lens;
    }
  } else if (kind === 'shotgun') {
    add(prof([[-0.05, -0.02], [0.24, -0.02], [0.24, 0.055], [-0.05, 0.06]], 0.046), WMAT.steel);
    add(tube(0.012, 0.24, 0.9, 0.03), WMAT.steel);
    add(tube(0.012, 0.24, 0.8, 0.0), WMAT.steel);
    add(new RoundedBoxGeometry(0.16, 0.045, 0.05, 2, 0.012).translate(0.48, 0.005, 0), WMAT.wood);
    add(new THREE.SphereGeometry(0.006, 8, 6).translate(0.89, 0.045, 0), WMAT.brass);
    for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(0.009, 0.009, 0.05, 8).translate(0.06 + i * 0.022, 0.018, 0.03), WMAT.shell);
    add(prof([[-0.05, 0.05], [-0.05, -0.015], [-0.2, -0.05], [-0.34, -0.07], [-0.34, 0.035], [-0.2, 0.045]], 0.042, 0.01), WMAT.wood);
    add(new RoundedBoxGeometry(0.022, 0.11, 0.048, 2, 0.006).translate(-0.35, -0.018, 0), WMAT.rubber);
    grip();
    port(0.1, 0.03);
    for (let x = 0.42; x < 0.56; x += 0.025) add(new THREE.BoxGeometry(0.008, 0.05, 0.054).translate(x, 0.005, 0), WMAT.wood);
  } else if (kind === 'sniper') {
    add(prof([[-0.06, -0.02], [0.32, -0.02], [0.32, 0.055], [-0.06, 0.055]], 0.042), WMAT.steel);
    add(prof([[0.32, -0.02], [0.56, -0.01], [0.56, 0.045], [0.32, 0.05]], 0.05, 0.006), WMAT.poly);
    add(tube(0.012, 0.56, 1.12, 0.018), WMAT.steel);
    add(tube(0.02, 1.08, 1.18, 0.018, 8), WMAT.steel);
    add(prof([[-0.06, 0.05], [-0.06, -0.02], [-0.16, -0.03], [-0.16, -0.09], [-0.28, -0.11], [-0.44, -0.08], [-0.44, 0.05], [-0.3, 0.06]], 0.044, 0.01, [[[-0.2, 0.0], [-0.12, 0.0], [-0.13, -0.05], [-0.2, -0.06]]]), WMAT.tan);
    add(new RoundedBoxGeometry(0.022, 0.13, 0.05, 2, 0.006).translate(-0.45, -0.015, 0), WMAT.rubber);
    add(new RoundedBoxGeometry(0.16, 0.03, 0.05, 2, 0.01).translate(-0.33, 0.065, 0), WMAT.tan);
    rail(0.0, 0.3, 0.068);
    port(0.14, 0.025);
    grip();
    add(prof([[0.08, -0.02], [0.13, -0.02], [0.14, -0.1], [0.09, -0.1]], 0.03), WMAT.poly);
    // scope
    add(tube(0.02, 0.02, 0.32, 0.11, 16), WMAT.steel);
    add(new THREE.CylinderGeometry(0.03, 0.02, 0.07, 16).rotateZ(Math.PI / 2).translate(0.355, 0.11, 0), WMAT.steel);
    add(new THREE.CylinderGeometry(0.02, 0.026, 0.05, 16).rotateZ(Math.PI / 2).translate(-0.005, 0.11, 0), WMAT.steel);
    add(tube(0.026, 0.388, 0.392, 0.11, 16), WMAT.glass);
    for (const x of [0.06, 0.24]) add(new THREE.BoxGeometry(0.02, 0.055, 0.02).translate(x, 0.075, 0), WMAT.steel);
    for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.005, 0.005, 0.2, 6).rotateZ(Math.PI / 2).translate(0.62, -0.01, s * 0.014), WMAT.steel);
  }
  if (kind !== 'lance') {
    blasterParts(add, kind);
  } else {
    // crystal lance: dark glass shards with glowing veins, grown around a bone-grey grip
    const glass = new THREE.MeshPhysicalMaterial({ color: '#1d2430', roughness: 0.12, clearcoat: 1, emissive: '#5ae8f4', emissiveMap: veins(), emissiveIntensity: 1.1, flatShading: true });
    add(new THREE.OctahedronGeometry(0.06, 0).scale(7, 0.9, 0.9).translate(0.45, 0.02, 0), glass);
    add(new THREE.OctahedronGeometry(0.04, 0).scale(5, 0.8, 0.8).rotateZ(0.12).translate(0.32, 0.06, 0.02), glass);
    add(new THREE.OctahedronGeometry(0.035, 0).scale(4, 0.8, 0.8).rotateZ(-0.15).translate(0.28, -0.03, -0.02), glass);
    add(prof([[-0.1, -0.015], [0.1, -0.02], [0.12, 0.03], [-0.1, 0.025]], 0.03, 0.008), WMAT.pale);
    grip();
  }
  return g;
}
