// Far Ember: the Wren, Ember Company's dropship. Built in code: a lofted hull with a painted livery,
// swept wings with tilting engine pods, a rear ramp, landing legs and running lights. Animated through setters.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glowTex } from './models.js';

const EMBER = '#ff7a2e', NAVY = '#1b2a44', HULL_C = '#c3c4bf';
const EMBLEM = ['M60 5 L107 29 L100 87 L60 115 L20 87 L13 29 Z', 'M60 24 L67 53 L94 61 L67 69 L60 98 L53 69 L26 61 L53 53 Z'];

// Hull cross-sections from nose (-z) to tail: z, width, height, centre height, squareness.
const HULL = [
  [-5.6, 0.28, 0.3, 1.42, 2.2],
  [-5.2, 1.0, 0.72, 1.48, 2.6],
  [-4.3, 1.9, 1.32, 1.6, 3.0],
  [-3.0, 2.55, 1.92, 1.76, 3.6],
  [-1.2, 2.95, 2.3, 1.9, 4.2],
  [1.0, 3.0, 2.36, 1.95, 4.4],
  [2.7, 2.8, 2.18, 2.0, 4.2],
  [4.0, 2.5, 1.95, 2.08, 4.0],
];
const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
function sections(steps = 6) {
  const out = [], n = HULL.length;
  for (let i = 0; i < n - 1; i++) for (let s = 0; s < steps; s++) {
    out.push(HULL[0].map((_, k) => cr(HULL[Math.max(0, i - 1)][k], HULL[i][k], HULL[i + 1][k], HULL[Math.min(n - 1, i + 2)][k], s / steps)));
  }
  out.push(HULL[n - 1].slice());
  return out;
}
// A point on a section; u runs round the hull from the belly (0) up the right side (0.25), over the top (0.5), down the left.
function ringPoint(sec, u, push = 0) {
  const [z, w, h, c, n] = sec;
  const a = -Math.PI / 2 + Math.PI * 2 * u;
  const ca = Math.cos(a), sa = Math.sin(a);
  const ey = 2 / (sa < 0 ? n * 1.5 : n), ex = 2 / n; // a flatter belly
  return [(w / 2 + push) * Math.sign(ca) * Math.abs(ca) ** ex, c + (h / 2 + push) * Math.sign(sa) * Math.abs(sa) ** ey, z];
}
// Skin a run of sections into a mesh. uv.x runs nose to tail, uv.y round the hull.
function loft(secs, M, u0 = 0, u1 = 1, push = 0, capNose = false) {
  const pos = [], uv = [], idx = [];
  const z0 = HULL[0][0], z1 = HULL[HULL.length - 1][0];
  for (const s of secs) for (let j = 0; j <= M; j++) {
    const u = u0 + ((u1 - u0) * j) / M;
    pos.push(...ringPoint(s, u, push));
    uv.push((s[0] - z0) / (z1 - z0), u);
  }
  for (let i = 0; i < secs.length - 1; i++) for (let j = 0; j < M; j++) {
    const a = i * (M + 1) + j, b = a + 1, c = a + M + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  if (capNose) {
    const tip = pos.length / 3;
    pos.push(0, secs[0][3], secs[0][0] - 0.1);
    uv.push(0, 0.5);
    for (let j = 0; j < M; j++) idx.push(tip, j + 1, j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (u0 === 0 && u1 === 1) {
    // the seam under the belly: average the two copies of each seam vertex so the shading stays smooth
    const nrm = g.attributes.normal;
    for (let i = 0; i < secs.length; i++) {
      const a = i * (M + 1), b = a + M;
      const nx = nrm.getX(a) + nrm.getX(b), ny = nrm.getY(a) + nrm.getY(b), nz = nrm.getZ(a) + nrm.getZ(b);
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm.setXYZ(a, nx / l, ny / l, nz / l);
      nrm.setXYZ(b, nx / l, ny / l, nz / l);
    }
  }
  return g;
}

// ------------------------------------------------------------ paint
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function rngOf(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
// Normals from a height canvas (dark = grooves).
function normalFrom(hc, strength = 2.5) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h), g = out.getContext('2d');
  const img = g.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * w + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255;
    img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
    img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return out;
}
function tex(c, srgb, repeat) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function emblemPath(g, x, y, s) {
  g.save(); g.translate(x, y); g.scale(s / 120, s / 120);
  const shield = new Path2D(EMBLEM[0]), star = new Path2D(EMBLEM[1]);
  g.fillStyle = NAVY; g.fill(shield);
  g.lineWidth = 7; g.strokeStyle = EMBER; g.stroke(shield);
  g.fillStyle = EMBER; g.fill(star);
  g.restore();
}

// The hull livery, laid out with x along the ship (nose at 0) and y round it (canvas top = the left side's u 1 end).
let hullMats = null;
function hullMaterials() {
  if (hullMats) return hullMats;
  const W = 2048, H = 1024, rnd = rngOf(7);
  const col = canvas(W, H), g = col.getContext('2d');
  const hc = canvas(W / 2, H / 2), hg = hc.getContext('2d');
  const rc = canvas(W / 2, H / 2), rg = rc.getContext('2d');
  const Y = (u) => (1 - u) * H;
  g.fillStyle = HULL_C; g.fillRect(0, 0, W, H);
  hg.fillStyle = '#fff'; hg.fillRect(0, 0, W / 2, H / 2);
  rg.fillStyle = 'rgb(255,115,40)'; rg.fillRect(0, 0, W / 2, H / 2); // AO 1, rough .45, metal .16
  // panels: a grid along the ship and round it, each with its own slight tone
  const xs = [0, 0.07, 0.15, 0.24, 0.33, 0.43, 0.52, 0.62, 0.8, 0.9, 1].map((v) => v * W);
  const us = [0, 0.06, 0.13, 0.21, 0.29, 0.37, 0.44, 0.5, 0.56, 0.63, 0.71, 0.79, 0.87, 0.94, 1];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < us.length - 1; j++) {
    const v = (rnd() - 0.5) * 0.07;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(xs[i], Y(us[j + 1]), xs[i + 1] - xs[i], Y(us[j]) - Y(us[j + 1]));
  }
  // belly: darker, heat-stained
  for (const [a, b] of [[0, 0.1], [0.9, 1]]) {
    const gr = g.createLinearGradient(0, Y(a), 0, Y(b));
    const edge = a === 0;
    gr.addColorStop(0, edge ? 'rgba(70,66,60,.85)' : 'rgba(70,66,60,0)');
    gr.addColorStop(1, edge ? 'rgba(70,66,60,0)' : 'rgba(70,66,60,.85)');
    g.fillStyle = gr; g.fillRect(0, Y(b), W, Y(a) - Y(b));
  }
  // grime: soft blotches and streaks running down the sides toward the belly
  for (let i = 0; i < 260; i++) {
    const x = rnd() * W, y = rnd() * H, r = 8 + rnd() * 60;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(60,55,48,${0.05 + rnd() * 0.08})`); gr.addColorStop(1, 'rgba(60,55,48,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 420; i++) {
    const x = rnd() * W, u = rnd();
    const down = u < 0.5 ? 1 : -1; // toward the belly in canvas space
    const y = Y(u), len = 20 + rnd() * 90;
    const gr = g.createLinearGradient(0, y, 0, y + down * len);
    gr.addColorStop(0, `rgba(55,50,45,${0.08 + rnd() * 0.1})`); gr.addColorStop(1, 'rgba(55,50,45,0)');
    g.fillStyle = gr; g.fillRect(x, Math.min(y, y + down * len), 2 + rnd() * 4, len);
  }
  // panel lines, cut into the height map too, with rivets along some
  g.strokeStyle = 'rgba(28,30,34,.8)'; g.lineWidth = 2;
  hg.strokeStyle = '#000'; hg.lineWidth = 1.5;
  for (const x of xs) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); hg.beginPath(); hg.moveTo(x / 2, 0); hg.lineTo(x / 2, H / 2); hg.stroke(); }
  for (const u of us) { g.beginPath(); g.moveTo(0, Y(u)); g.lineTo(W, Y(u)); g.stroke(); hg.beginPath(); hg.moveTo(0, Y(u) / 2); hg.lineTo(W / 2, Y(u) / 2); hg.stroke(); }
  g.fillStyle = 'rgba(40,40,44,.55)';
  for (const u of us) if (rnd() < 0.5) for (let x = 6; x < W; x += 14) g.fillRect(x, Y(u) + 5, 2, 2);
  // hatches and vents
  for (let i = 0; i < 16; i++) {
    const x = (0.25 + rnd() * 0.65) * W, u = [0.16, 0.34, 0.66, 0.84][i % 4] + (rnd() - 0.5) * 0.04;
    const w = 40 + rnd() * 50, h = 24 + rnd() * 26;
    g.strokeStyle = 'rgba(28,30,34,.75)'; g.strokeRect(x, Y(u), w, h);
    hg.strokeRect(x / 2, Y(u) / 2, w / 2, h / 2);
    if (i % 3 === 0) { g.fillStyle = 'rgba(30,32,36,.6)'; for (let k = 4; k < h - 4; k += 6) g.fillRect(x + 5, Y(u) + k, w - 10, 2); }
  }
  // livery: an ember stripe low on each flank with a navy keel line, ending in a chevron at the nose
  for (const [lo, hi] of [[0.17, 0.205], [0.795, 0.83]]) {
    g.fillStyle = EMBER;
    g.beginPath(); g.moveTo(0.2 * W, Y(lo)); g.lineTo(0.96 * W, Y(lo)); g.lineTo(0.96 * W, Y(hi)); g.lineTo(0.24 * W, Y(hi)); g.closePath(); g.fill();
    g.fillStyle = NAVY;
    const n0 = lo < 0.5 ? lo - 0.018 : hi + 0.006, n1 = lo < 0.5 ? lo - 0.006 : hi + 0.018;
    g.fillRect(0.22 * W, Y(n1), 0.74 * W, Y(n0) - Y(n1));
  }
  // canopy: dark glass over the nose with frame bars; glossy and a little metallic in the roughness map
  const cx0 = 0.045 * W, cx1 = 0.2 * W, cu0 = 0.38, cu1 = 0.62;
  const glass = g.createLinearGradient(0, Y(cu1), 0, Y(cu0));
  glass.addColorStop(0, '#16222e'); glass.addColorStop(0.5, '#0a1018'); glass.addColorStop(1, '#16222e');
  g.fillStyle = glass;
  g.beginPath(); g.moveTo(cx0, Y(0.47)); g.lineTo(cx0 + 40, Y(cu1)); g.lineTo(cx1, Y(cu1 - 0.01)); g.lineTo(cx1, Y(cu0 + 0.01)); g.lineTo(cx0 + 40, Y(cu0)); g.lineTo(cx0, Y(0.53)); g.closePath(); g.fill();
  g.strokeStyle = '#2a2f36'; g.lineWidth = 7;
  for (const x of [0.1 * W, 0.15 * W]) { g.beginPath(); g.moveTo(x, Y(cu1)); g.lineTo(x, Y(cu0)); g.stroke(); }
  g.beginPath(); g.moveTo(cx0, Y(0.5)); g.lineTo(cx1, Y(0.5)); g.stroke();
  rg.fillStyle = 'rgb(255,18,150)';
  rg.fillRect(cx0 / 2, Y(cu1) / 2, (cx1 - cx0) / 2, (Y(cu0) - Y(cu1)) / 2);
  // troop bay windows, four a side
  for (const u of [0.31, 0.69]) for (let i = 0; i < 4; i++) {
    const x = (0.42 + i * 0.07) * W;
    g.fillStyle = '#0d141c'; g.fillRect(x, Y(u + 0.018), 46, Y(u - 0.018) - Y(u + 0.018));
    g.strokeStyle = '#3a3f46'; g.lineWidth = 3; g.strokeRect(x, Y(u + 0.018), 46, Y(u - 0.018) - Y(u + 0.018));
    rg.fillStyle = 'rgb(255,20,140)'; rg.fillRect(x / 2, Y(u + 0.018) / 2, 23, (Y(u - 0.018) - Y(u + 0.018)) / 2);
  }
  // markings: hull number by the nose, emblem by the tail. The right flank reads mirrored in canvas space,
  // the left flank upside down, so each side gets its own flip.
  const side = (u, fn) => {
    g.save(); g.translate(0, Y(u));
    if (u < 0.5) g.scale(-1, 1); else g.scale(1, -1);
    fn(u < 0.5 ? -1 : 1);
    g.restore();
  };
  // inside side(), +y is world down on both flanks and x = sx * distance from the nose
  for (const u of [0.245, 0.755]) side(u, (sx) => {
    g.font = '700 74px "Chakra Petch", "Arial Narrow", sans-serif';
    g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillStyle = NAVY;
    g.fillText('E-02', sx * 0.3 * W, 6);
    g.font = '600 24px "Chakra Petch", sans-serif';
    g.fillStyle = 'rgba(27,42,68,.85)';
    g.fillText('CARRIER LANTERN', sx * 0.72 * W, -40);
    emblemPath(g, sx * 0.86 * W - 50, -50, 100);
  });
  // small stencils: NO STEP along the spine, warning triangles under the wing roots, rescue arrows by the canopy
  g.save();
  g.font = '600 15px "Chakra Petch", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const x of [0.36, 0.55, 0.74]) {
    g.save(); g.translate(x * W, Y(0.5)); g.scale(1, -1);
    g.fillStyle = 'rgba(27,42,68,.8)'; g.fillText('NO STEP', 0, -26); g.fillText('NO STEP', 0, 26);
    g.fillRect(-60, -16, 120, 2); g.fillRect(-60, 14, 120, 2);
    g.restore();
  }
  for (const u of [0.28, 0.72]) for (const x of [0.47, 0.6]) {
    g.save(); g.translate(x * W, Y(u)); if (u > 0.5) g.scale(1, -1); else g.scale(-1, 1);
    g.fillStyle = '#e2ad24'; g.beginPath(); g.moveTo(0, -14); g.lineTo(14, 11); g.lineTo(-14, 11); g.closePath(); g.fill();
    g.fillStyle = '#1b1b1b'; g.fillRect(-1.5, -6, 3, 9); g.fillRect(-1.5, 5, 3, 3);
    g.restore();
  }
  for (const u of [0.36, 0.64]) {
    g.save(); g.translate(0.215 * W, Y(u)); if (u > 0.5) g.scale(1, -1); else g.scale(-1, 1);
    g.fillStyle = 'rgba(199,55,47,.9)'; g.fillText('RESCUE', 0, 0);
    g.beginPath(); g.moveTo(34, -6); g.lineTo(46, 0); g.lineTo(34, 6); g.fill();
    g.restore();
  }
  g.restore();
  // hazard chevrons on the ramp end
  g.save(); g.beginPath(); g.rect(0.975 * W, 0, 0.025 * W, H); g.clip();
  for (let y = -60; y < H + 60; y += 36) { g.fillStyle = '#e8b52a'; g.beginPath(); g.moveTo(0.975 * W, y); g.lineTo(W, y + 25); g.lineTo(W, y + 43); g.lineTo(0.975 * W, y + 18); g.fill(); }
  g.restore();
  const map = tex(col, true), normalMap = tex(normalFrom(hc, 3)), arm = tex(rc);
  const hull = new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap: arm, metalnessMap: arm, roughness: 1, metalness: 1, envMapIntensity: 1.1 });
  hull.normalScale.set(0.8, 0.8);
  // a tiling panel skin for wings, fins and engine pods
  const P = 512, pc = canvas(P, P), pg = pc.getContext('2d'), ph = canvas(P, P), phg = ph.getContext('2d');
  pg.fillStyle = HULL_C; pg.fillRect(0, 0, P, P);
  phg.fillStyle = '#fff'; phg.fillRect(0, 0, P, P);
  // panels of mixed sizes from recursive cuts, so neighbouring tiles never repeat; grime in broad soft patches
  const cuts = [];
  const cut = (x, y, w, h, d) => {
    if (d > 3 || (d > 1 && rnd() < 0.3) || w < 70 || h < 70) { cuts.push([x, y, w, h]); return; }
    if (w > h ? rnd() < 0.8 : rnd() < 0.2) { const k = Math.round(w * (0.3 + rnd() * 0.4)); cut(x, y, k, h, d + 1); cut(x + k, y, w - k, h, d + 1); }
    else { const k = Math.round(h * (0.3 + rnd() * 0.4)); cut(x, y, w, k, d + 1); cut(x, y + k, w, h - k, d + 1); }
  };
  cut(0, 0, P, P, 0);
  for (const [x, y, w, h] of cuts) {
    const v = (rnd() - 0.5) * 0.08;
    pg.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    pg.fillRect(x, y, w, h);
  }
  for (let i = 0; i < 26; i++) {
    const x = rnd() * P, y = rnd() * P, r = 30 + rnd() * 120;
    const gr = pg.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(60,55,48,${0.04 + rnd() * 0.06})`); gr.addColorStop(1, 'rgba(60,55,48,0)');
    for (const [ox, oy] of [[0, 0], [P, 0], [-P, 0], [0, P], [0, -P]]) { pg.save(); pg.translate(ox, oy); pg.fillStyle = gr; pg.fillRect(x - r, y - r, r * 2, r * 2); pg.restore(); }
  }
  pg.strokeStyle = 'rgba(28,30,34,.8)'; pg.lineWidth = 2; phg.strokeStyle = '#000'; phg.lineWidth = 2;
  for (const [x, y, w, h] of cuts) for (const gg of [pg, phg]) gg.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  pg.fillStyle = 'rgba(40,40,44,.5)';
  for (const [x, y, w] of cuts) if (rnd() < 0.5) for (let k = x + 6; k < x + w - 4; k += 12) pg.fillRect(k, y + 5, 2, 2);
  for (const [x, y, w, h] of cuts) if (rnd() < 0.18 && w > 90 && h > 60) {
    pg.fillStyle = 'rgba(30,32,36,.55)';
    for (let k = 10; k < h - 10; k += 7) pg.fillRect(x + 12, y + k, w - 24, 2);
  }
  const pmap = tex(pc, true, true), pnor = tex(normalFrom(ph, 3), false, true);
  pmap.repeat.set(0.3, 0.3); pnor.repeat.set(0.3, 0.3);
  const panel = new THREE.MeshStandardMaterial({ map: pmap, normalMap: pnor, roughness: 0.48, metalness: 0.16, envMapIntensity: 1.1 });
  panel.normalScale.set(0.7, 0.7);
  hullMats = {
    hull, panel,
    dark: new THREE.MeshStandardMaterial({ color: '#2a2e33', roughness: 0.5, metalness: 0.6 }),
    metal: new THREE.MeshStandardMaterial({ color: '#5a6068', roughness: 0.35, metalness: 0.85 }),
    ember: new THREE.MeshStandardMaterial({ color: EMBER, roughness: 0.5, metalness: 0.1 }),
    bay: new THREE.MeshStandardMaterial({ color: '#5a606a', roughness: 0.8, metalness: 0.25, side: THREE.BackSide }),
    tread: new THREE.MeshStandardMaterial({ map: pmap, normalMap: pnor, color: '#8d939c', roughness: 0.62, metalness: 0.45 }),
    duct: new THREE.MeshStandardMaterial({ color: '#24262a', roughness: 0.6, metalness: 0.5, side: THREE.BackSide }),
    heat: new THREE.MeshStandardMaterial({ color: '#545a66', roughness: 0.35, metalness: 0.85 }),
    fan: new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.4, metalness: 0.9 }),
    podPanel: panel.clone(),
    warmGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd6a8').multiplyScalar(1.6) }),
    seat: new THREE.MeshStandardMaterial({ color: '#2c3138', roughness: 0.8 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.7 }),
    redGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3a24').multiplyScalar(2.2) }),
    glass: new THREE.MeshStandardMaterial({ color: '#0b121a', roughness: 0.06, metalness: 0.9, envMapIntensity: 1.6 }),
  };
  return hullMats;
}

// ------------------------------------------------------------ build
export function buildDropship() {
  const M = hullMaterials();
  const root = new THREE.Group();
  root.name = 'dropship';
  const body = new THREE.Group(); // banks and bobs inside the root
  root.add(body);
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = body, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const secs = sections(6);
  add(loft(secs, 48, 0, 1, 0, true), M.hull);
  // tail collar round the ramp opening
  const tail = secs.slice(-3);
  add(loft(tail, 48, 0, 1, 0.05), M.dark);
  // troop bay: an inner skin that follows the hull, a deck, a bulkhead, benches and red strip lights
  const baySecs = secs.filter((s) => s[0] >= -0.7);
  add(loft(baySecs, 32, 0, 1, -0.07), M.bay, 0, 0, 0, body, false);
  const bulk = new THREE.Shape();
  for (let j = 0; j <= 32; j++) { const [x, y] = ringPoint(baySecs[0], j / 32, -0.07); if (j) bulk.lineTo(x, y); else bulk.moveTo(x, y); }
  add(new THREE.ShapeGeometry(bulk), M.seat, 0, 0, baySecs[0][0] + 0.02, body, false);
  add(new THREE.BoxGeometry(1.9, 0.06, 4.6), M.panel, 0, 1.14, 1.7, body, false);
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.34, 0.1, 3.6), M.seat, s * 0.8, 1.52, 1.8, body, false);
    add(new THREE.BoxGeometry(0.06, 0.55, 3.6), M.seat, s * 0.98, 1.84, 1.8, body, false);
    add(new THREE.BoxGeometry(0.04, 1.3, 0.04), M.redGlow, s * 1.0, 1.85, 3.88, body, false);
    for (let k = 0; k < 6; k++) add(new THREE.BoxGeometry(0.05, 0.42, 0.34), M.seat, s * 0.9, 1.84, 0.35 + k * 0.6, body, false);
    add(new THREE.CylinderGeometry(0.018, 0.018, 3.8, 6).rotateX(Math.PI / 2), M.metal, s * 0.5, 2.78, 1.8, body, false);
    for (let k = 0; k < 7; k++) add(new THREE.BoxGeometry(0.03, 0.22, 0.012), M.seat, s * 0.5, 2.66, 0.3 + k * 0.55, body, false);
    add(new THREE.BoxGeometry(0.45, 1.1, 0.22), M.panel, s * 0.48, 1.72, -0.45, body, false);
    // webbing on the walls above the benches
    for (let k = 0; k < 6; k++) add(new THREE.BoxGeometry(0.02, 0.5, 0.04), M.seat, s * 0.96, 2.25, 0.3 + k * 0.62, body, false);
  }
  // hull details: reaction thruster blocks, vents and access hatches on both flanks
  for (const s of [-1, 1]) {
    for (const [z, y] of [[-3.6, 2.15], [2.6, 2.45]]) {
      add(new THREE.BoxGeometry(0.16, 0.22, 0.28), M.dark, s * (z < 0 ? 1.12 : 1.36), y, z);
      for (const dz of [-0.08, 0.08]) add(new THREE.CylinderGeometry(0.03, 0.04, 0.06, 8).rotateZ(Math.PI / 2), M.metal, s * (z < 0 ? 1.22 : 1.46), y, z + dz, body, false);
    }
    for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(0.04, 0.12, 0.34), M.dark, s * 1.47, 1.35, -0.9 + k * 0.48, body, false);
    add(new THREE.BoxGeometry(0.03, 0.42, 0.5), M.panel, s * 1.34, 1.75, 3.3, body, false);
  }
  for (const x of [-0.32, 0.32]) for (let k = 0; k < 4; k++) add(new THREE.BoxGeometry(0.12, 0.03, 0.12), M.warmGlow, x, 2.96, 0.5 + k * 0.85, body, false);
  add(new THREE.BoxGeometry(0.08, 0.08, 0.04), M.redGlow, 0.72, 2.62, 3.88, body, false);
  const bayLight = new THREE.PointLight('#ffd6a8', 3, 5, 1.8);
  bayLight.position.set(0, 2.5, 2.4);
  body.add(bayLight);
  // ramp, hinged at the bottom of the tail
  const ramp = new THREE.Group();
  ramp.position.set(0, 1.09, 4.0);
  body.add(ramp);
  // the ramp is cut to the tail's own outline, so shut it closes the hull; open, it is a rounded-ended ramp
  const tailSec = HULL[HULL.length - 1], base = tailSec[3] - tailSec[2] / 2;
  const rampLen = tailSec[2] - 0.02;
  const outline = new THREE.Shape();
  for (let j = 0; j <= 40; j++) { const [x, y] = ringPoint(tailSec, j / 40, -0.03); if (j) outline.lineTo(x, Math.max(0, y - base)); else outline.moveTo(x, Math.max(0, y - base)); }
  const rg = new THREE.ExtrudeGeometry(outline, { depth: 0.1, bevelEnabled: false });
  rg.rotateX(Math.PI / 2);
  add(rg, M.tread, 0, 0, 0, ramp);
  for (const x of [-0.45, 0.45]) add(new THREE.BoxGeometry(0.34, 0.006, rampLen - 0.2), M.metal, x, 0.004, rampLen / 2, ramp, false);
  for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(1.6 - i * 0.05, 0.02, 0.05), M.dark, 0, 0.012, 0.25 + i * 0.3, ramp, false);
  add(new THREE.BoxGeometry(2.0, 0.015, 0.1), M.ember, 0, 0.01, 0.08, ramp, false);
  // canopy glass sits just proud of the nose
  const nose = secs.filter((s) => s[0] > -5.2 && s[0] < -3.65);
  add(loft(nose, 16, 0.385, 0.615, 0.012), M.glass, 0, 0, 0, body, false);
  // chin turret
  const turret = new THREE.Group();
  turret.position.set(0, 0.92, -4.4);
  body.add(turret);
  add(new THREE.SphereGeometry(0.24, 18, 12), M.dark, 0, 0, 0, turret);
  for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.035, 0.04, 0.6, 8).rotateX(Math.PI / 2), M.metal, s * 0.08, -0.04, -0.4, turret);
  // sensor fit on the spine and an antenna
  add(new RoundedBoxGeometry(0.7, 0.16, 1.3, 2, 0.05), M.panel, 0, 3.25, -0.3);
  add(new THREE.SphereGeometry(0.14, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.dark, 0, 3.32, 0.6);
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 5), M.metal, 0.25, 3.55, 0.9);
  // wings with an ember edge, swept back, a touch of droop
  const wings = [], pods = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Shape();
    const pts = [[1.2, 1.1], [3.95, -0.4], [3.95, -2.3], [1.2, -2.35]].map(([x, y]) => [x * s, y]);
    sh.moveTo(...pts[0]); for (const p of pts.slice(1)) sh.lineTo(...p);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 });
    g.rotateX(-Math.PI / 2);
    const wing = add(g, M.panel, 0, 1.78, 0);
    wing.rotation.z = s * -0.07;
    wings.push(wing);
    // engine pod at the tip on a pivot, so it can swing from straight down (hover) to straight back (cruise)
    const pivot = new THREE.Group();
    pivot.position.set(s * 4.45, 1.98, 1.25);
    body.add(pivot);
    const prof = [[0.33, 1.2], [0.37, 1.28], [0.42, 1.27], [0.5, 1.16], [0.56, 0.9], [0.56, -0.55], [0.5, -0.95], [0.43, -1.22], [0.36, -1.24]].reverse().map(([r, y]) => new THREE.Vector2(r, y));
    const pod = add(new THREE.LatheGeometry(prof, 28).rotateX(-Math.PI / 2), M.podPanel, 0, 0, 0, pivot);
    add(pod.geometry, M.duct, 0, 0, 0, pivot, false);
    add(new THREE.TorusGeometry(0.5, 0.035, 8, 28), M.ember, 0, 0, -1.0, pivot, false);
    add(new THREE.CylinderGeometry(0.335, 0.335, 0.3, 24, 1, true).rotateX(Math.PI / 2), M.duct, 0, 0, -1.08, pivot, false);
    add(new THREE.CircleGeometry(0.335, 24), M.dark, 0, 0, -0.95, pivot, false);
    for (let k = 0; k < 18; k++) {
      const blade = add(new THREE.BoxGeometry(0.05, 0.3, 0.012), M.fan, 0, 0, -1.0, pivot, false);
      blade.rotation.set(0, 0.5, (k / 18) * Math.PI * 2, 'ZYX');
      blade.position.x = Math.sin((k / 18) * Math.PI * 2) * -0.17;
      blade.position.y = Math.cos((k / 18) * Math.PI * 2) * 0.17;
    }
    add(new THREE.ConeGeometry(0.08, 0.16, 16).rotateX(-Math.PI / 2), M.fan, 0, 0, -1.07, pivot, false);
    for (const z of [-0.45, 0.15, 0.7]) add(new THREE.TorusGeometry(0.562, 0.007, 4, 40), M.dark, 0, 0, z, pivot, false);
    add(new THREE.CylinderGeometry(0.555, 0.5, 0.36, 32, 1, true).rotateX(Math.PI / 2), M.heat, 0, 0, 0.82, pivot, false);
    add(new THREE.BoxGeometry(0.02, 0.18, 0.32), M.dark, s * 0.56, 0.12, -0.2, pivot, false);
    const nozzle = new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.3, metalness: 1, side: THREE.DoubleSide });
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2, pet = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.015, 0.42), nozzle);
      pet.position.set(Math.cos(a) * 0.37, Math.sin(a) * 0.37, 1.2);
      pet.rotation.set(0, 0, a + Math.PI / 2);
      pet.rotateX(-0.16);
      pivot.add(pet);
    }
    add(new THREE.CircleGeometry(0.33, 24), M.dark, 0, 0, 0.93, pivot, false);
    // the nozzle glow: a ring of hot metal deep inside (behind the turbine), a soft sprite and a cone of exhaust
    const hot = add(new THREE.RingGeometry(0.1, 0.31, 32), new THREE.MeshBasicMaterial({ color: '#ff7a2a' }), 0, 0, 0.95, pivot, false);
    for (let k = 0; k < 16; k++) {
      const blade = add(new THREE.BoxGeometry(0.045, 0.24, 0.01), M.fan, 0, 0, 1.0, pivot, false);
      blade.rotation.set(0, -0.5, (k / 16) * Math.PI * 2, 'ZYX');
      blade.position.x = Math.sin((k / 16) * Math.PI * 2) * -0.19;
      blade.position.y = Math.cos((k / 16) * Math.PI * 2) * 0.19;
    }
    add(new THREE.ConeGeometry(0.1, 0.32, 18).rotateX(Math.PI / 2), M.fan, 0, 0, 1.14, pivot, false);
    const plume = add(new THREE.ConeGeometry(0.32, 2.2, 20, 1, true).rotateX(-Math.PI / 2), plumeMat(), 0, 0, 2.2, pivot, false);
    plume.userData.noAO = true;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ff9a5a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    sprite.position.set(0, 0, 1.4);
    pivot.add(sprite);
    // a nav light on the outer face of the pod: red to port, green to starboard
    const nav = add(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: s < 0 ? '#ff2a2a' : '#3aff6a' }), s * 0.57, 0, -0.2, pivot, false);
    const navGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: s < 0 ? '#ff3a3a' : '#4aff7a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    navGlow.scale.setScalar(0.5);
    nav.add(navGlow);
    pods.push({ pivot, hot, plume, sprite, nav: navGlow, pod });
  }
  // twin tail fins, canted out, with ember tips and white strobes
  const strobes = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Shape();
    sh.moveTo(1.2, 0); sh.lineTo(3.95, 0); sh.lineTo(4.3, 0.95); sh.lineTo(3.2, 0.95); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
    g.rotateY(-Math.PI / 2);
    g.translate(0.05, 0, 0);
    const fin = new THREE.Group();
    fin.position.set(s * 0.7, 2.95, 0);
    fin.rotation.z = s * -0.72;
    body.add(fin);
    add(g, M.panel, 0, 0, 0, fin);
    add(new THREE.BoxGeometry(0.14, 0.1, 1.05), M.ember, 0, 0.93, 3.78, fin, false);
    const strobe = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color('#ffffff').multiplyScalar(3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    strobe.position.set(0, 1.0, 4.25);
    fin.add(strobe);
    strobes.push(strobe);
  }
  // belly lift jets and landing lights
  const belly = [];
  for (const [x, z] of [[-0.7, -1.6], [0.7, -1.6]]) {
    const ring = add(new THREE.TorusGeometry(0.26, 0.04, 8, 20).rotateX(Math.PI / 2), M.dark, x, 0.72, z, body, false);
    const glow = add(new THREE.CircleGeometry(0.22, 20).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff9a5a', transparent: true, side: THREE.DoubleSide }), x, 0.7, z, body, false);
    belly.push(glow);
    ring.castShadow = false;
  }
  // landing legs: nose and two mains, each with a strut, a link and a pad
  const legs = [];
  for (const [x, z, h] of [[0, -3.4, 0.88], [-1.15, 1.6, 0.72], [1.15, 1.6, 0.72]]) {
    const leg = new THREE.Group();
    leg.position.set(x, h, z);
    body.add(leg);
    add(new THREE.CylinderGeometry(0.075, 0.075, h - 0.1, 10), M.metal, 0, -(h - 0.1) / 2, 0, leg);
    add(new THREE.CylinderGeometry(0.11, 0.11, 0.25, 10), M.dark, 0, -0.14, 0, leg);
    add(new THREE.BoxGeometry(0.05, 0.3, 0.18), M.dark, 0.09, -h * 0.55, 0.06, leg);
    add(new THREE.CylinderGeometry(0.28, 0.34, 0.08, 20), M.dark, 0, -h + 0.04, 0, leg);
    add(new THREE.CylinderGeometry(0.015, 0.015, h - 0.2, 6), M.rubber, -0.1, -(h - 0.2) / 2, -0.04, leg);
    const door = add(new THREE.BoxGeometry(0.02, 0.32, 0.5), M.panel, (x >= 0 ? 1 : -1) * 0.22, -0.12, 0, leg, false);
    door.rotation.z = (x >= 0 ? 1 : -1) * 0.5;
    legs.push({ leg, h });
  }

  const ship = {
    root, body, ramp, pods, legs, strobes, belly, bayLight, wings,
    ramp_k: 1, gear_k: 1, tilt_k: 0, thrust_k: 0,
    // 0 shut, 1 open (resting on the deck)
    setRamp(k) { this.ramp_k = k; ramp.rotation.x = -Math.PI / 2 + (Math.PI / 2 + Math.asin(Math.min(1, 1.09 / rampLen))) * k; bayLight.intensity = 1 + k * 6; },
    // 0 tucked away, 1 down
    setGear(k) {
      this.gear_k = k;
      for (const { leg, h } of legs) { leg.scale.y = Math.max(0.02, k); leg.position.y = h; leg.visible = k > 0.03; }
    },
    // engine pods: 0 pointing down for hover and landing, 1 swung back for cruise
    setTilt(k) { this.tilt_k = k; for (const p of pods) p.pivot.rotation.x = (Math.PI / 2) * (1 - k); },
    // engine output 0..1 (idle glow at 0)
    setThrust(k) { this.thrust_k = k; },
    tick(dt, t) {
      const th = this.thrust_k;
      for (const p of pods) {
        const flick = 0.92 + Math.random() * 0.16;
        p.hot.visible = th > 0.03;
        p.hot.material.color.setRGB(1, 0.5, 0.25).multiplyScalar(th * 3.4 * flick);
        p.plume.visible = th > 0.05;
        p.plume.material.uniforms.uK.value = th * flick;
        p.plume.scale.set(1, 1, 0.6 + th * 0.8);
        p.sprite.scale.setScalar((0.5 + th * 1.3) * flick);
        p.sprite.material.opacity = th * 0.55;
        p.nav.material.opacity = (t % 1) < 0.5 ? 1 : 0.25;
      }
      for (const g of belly) g.material.color.setRGB(1, 0.6, 0.35).multiplyScalar(0.15 + th * (1 - this.tilt_k) * 3 * (0.9 + Math.random() * 0.2));
      const blink = (t % 1.6) < 0.08;
      for (const s of strobes) { s.material.opacity = blink ? 1 : 0; s.scale.setScalar(blink ? (th > 0.05 ? 0.4 : 0.14) : 0.01); }
    },
  };
  greebles(body, secs, M);
  ship.setRamp(1); ship.setGear(1); ship.setTilt(1); ship.setThrust(0);
  root.traverse((o) => { if (o.isSprite || (o.material && o.material.transparent)) o.userData.noAO = true; });
  return ship;
}

// Vents, hatches, sensors, aerials, wing fences, hinges and grab handles. Each piece sits on the hull surface
// (ringPoint gives the spot), and all of them merge into one mesh per material.
function greebles(body, secs, M) {
  const buckets = new Map();
  const put = (geo, mat, pos, quat) => {
    geo.applyQuaternion(quat || new THREE.Quaternion()).translate(pos.x, pos.y, pos.z);
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(g);
  };
  const sec = (z) => secs.reduce((a, b) => (Math.abs(b[0] - z) < Math.abs(a[0] - z) ? b : a));
  // a point on the hull at (z, u) and its outward normal
  const at = (z, u, out = 0) => {
    const s0 = sec(z), [x, y] = ringPoint(s0, u, out), [x2, y2] = ringPoint(s0, u + 0.002, out);
    const n = new THREE.Vector3(y2 - y, -(x2 - x), 0).normalize();
    return { p: new THREE.Vector3(x, y, z), n, q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n) };
  };
  for (const side of [1, -1]) {
    const u = (v) => (side > 0 ? v : 1 - v);
    // louvred vents low on the flanks
    for (const z of [-2.2, -1.6, 2.0]) {
      const h = at(z, u(0.14));
      put(new THREE.BoxGeometry(0.34, 0.03, 0.22), M.dark, h.p, h.q);
      for (let k = 0; k < 4; k++) put(new THREE.BoxGeometry(0.3, 0.025, 0.02), M.metal, h.p.clone().addScaledVector(h.n, 0.02).add(new THREE.Vector3(0, 0, -0.08 + k * 0.055)), h.q);
    }
    // raised access panels with bolt heads
    for (const [z, uu] of [[-0.4, 0.36], [1.2, 0.38], [3.1, 0.33], [-3.2, 0.3]]) {
      const h = at(z, u(uu));
      put(new THREE.BoxGeometry(0.42, 0.018, 0.34), M.panel, h.p, h.q);
      for (const [dx, dz] of [[-0.18, -0.14], [0.18, -0.14], [-0.18, 0.14], [0.18, 0.14]]) put(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6), M.metal, h.p.clone().add(new THREE.Vector3(0, dx, dz)).addScaledVector(h.n, 0.01), h.q);
    }
    // grab handles beside the ramp and a step plate below the door line
    for (let k = 0; k < 3; k++) { const h = at(3.6, u(0.2 + k * 0.05)); put(new THREE.TorusGeometry(0.05, 0.008, 6, 12, Math.PI), M.metal, h.p.clone().addScaledVector(h.n, 0.005), h.q); }
    const step = at(2.4, u(0.09));
    put(new THREE.BoxGeometry(0.28, 0.02, 0.16), M.metal, step.p.clone().addScaledVector(step.n, 0.04), step.q);
    // wing fences: thin upright plates across the wing top
    for (const wx of [2.3, 3.4]) put(new THREE.BoxGeometry(0.02, 0.14, 0.9), M.panel, new THREE.Vector3(side * wx, 2.0 - wx * 0.07 + 0.06, 0.55 + (wx - 2.3) * 0.5));
    // a hardpoint pylon under each wing
    put(new THREE.BoxGeometry(0.1, 0.16, 0.9), M.dark, new THREE.Vector3(side * 2.9, 1.48, 0.6));
    put(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 12).rotateX(Math.PI / 2), M.metal, new THREE.Vector3(side * 2.9, 1.34, 0.6));
    // ramp hinges
    put(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 10).rotateZ(Math.PI / 2), M.metal, new THREE.Vector3(side * 0.7, 1.09, 4.0));
  }
  // spine: aerial blades, a sensor dome and a row of small intakes
  for (const z of [-1.8, 0.4, 2.2]) { const h = at(z, 0.5); put(new THREE.BoxGeometry(0.015, 0.22, 0.12), M.dark, h.p.clone().add(new THREE.Vector3(0, 0.1, 0))); }
  const dome = at(-3.0, 0.5);
  put(new THREE.SphereGeometry(0.09, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.glass, dome.p);
  for (let k = 0; k < 4; k++) { const h = at(1.0 + k * 0.3, 0.5); put(new THREE.BoxGeometry(0.18, 0.05, 0.12), M.dark, h.p.clone().add(new THREE.Vector3(0, 0.02, 0))); }
  // nose: a pitot probe and two sensor pucks
  put(new THREE.CylinderGeometry(0.008, 0.012, 0.5, 6).rotateX(Math.PI / 2), M.metal, new THREE.Vector3(0.22, 1.32, -5.55));
  for (const sx of [-0.35, 0.35]) put(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12).rotateX(Math.PI / 2.4), M.glass, new THREE.Vector3(sx, 1.35, -5.05));
  for (const [mat, list] of buckets) {
    const m = new THREE.Mesh(mergeGeometries(list), mat);
    m.castShadow = true; m.receiveShadow = true;
    body.add(m);
  }
}

// A soft additive exhaust cone, brightest at the nozzle.
function plumeMat() {
  return new THREE.ShaderMaterial({
    uniforms: { uK: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform float uK; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float along = clamp(vUv.y, 0.0, 1.0); // 1 at the nozzle, 0 at the tip
        float edge = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.5);
        vec3 c = mix(vec3(1.0, 0.35, 0.1), vec3(1.0, 0.85, 0.65), along * along);
        float a = along * along * edge * uK * 1.4;
        gl_FragColor = vec4(c * a * 2.0, a);
        #include <colorspace_fragment>
      }`,
  });
}
