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
const SECS = sections(6);
// A point on the rendered skin at (z, u): the loft is flat between its ring points, so this blends the four ring
// points round the spot. Parts placed with it sit exactly on the faces drawn. M is that loft's ring count.
function surf(z, u, push = 0, M = 48) {
  let i = 0;
  while (i < SECS.length - 2 && SECS[i + 1][0] < z) i++;
  const a = SECS[i], b = SECS[i + 1];
  const t = Math.min(1, Math.max(0, (z - a[0]) / (b[0] - a[0])));
  const uu = Math.min(1, Math.max(0, u)), j = Math.min(M - 1, Math.floor(uu * M)), f = uu * M - j;
  const ring = (s) => { const p = ringPoint(s, j / M, push), q = ringPoint(s, (j + 1) / M, push); return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]; };
  const pa = ring(a), pb = ring(b);
  return new THREE.Vector3(pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, z);
}
// The skin's local frame at (z, u): n points out, tu runs round the hull, tz along it. q turns a part's +y to n,
// its +x round the hull and its +z along the ship (toward the nose).
function frame(z, u, push = 0, M = 48) {
  const p = surf(z, u, push, M);
  const tu = surf(z, u + 0.002, push, M).sub(surf(z, u - 0.002, push, M)).normalize();
  const dz = surf(z + 0.02, u, push, M).sub(surf(z - 0.02, u, push, M));
  const n = new THREE.Vector3().crossVectors(tu, dz).normalize();
  const tz = new THREE.Vector3().crossVectors(tu, n);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(tu, n, tz));
  return { p, n, tu, tz, q, z, u };
}
// Solve for u in [u0, u1] where a coordinate of the skin crosses a value (it must be monotonic over that span).
function solveU(z, push, M, u0, u1, axis, v) {
  const f0 = surf(z, u0, push, M)[axis];
  for (let k = 0; k < 40; k++) {
    const um = (u0 + u1) / 2, fm = surf(z, um, push, M)[axis];
    if ((fm - v) * (f0 - v) > 0) u0 = um; else u1 = um;
  }
  return (u0 + u1) / 2;
}
// Right-hand wall x at height y, belly y under x, roof y over x (mirror x for the left side).
const wallX = (z, y, push = 0, M = 48) => surf(z, solveU(z, push, M, 0, 0.5, 'y', y), push, M).x;
const bellyY = (z, x, push = 0, M = 48) => surf(z, Math.abs(x) < 1e-4 ? 0 : solveU(z, push, M, 0, 0.25, 'x', Math.abs(x)), push, M).y;
const roofY = (z, x, push = 0, M = 48) => surf(z, Math.abs(x) < 1e-4 ? 0.5 : solveU(z, push, M, 0.25, 0.5, 'x', Math.abs(x)), push, M).y;
// How far the skin falls away below a flat footprint laid on the frame (offsets along tu and tz, in metres).
function sag(fr, pts, push = 0, M = 48) {
  const du = 0.002 / surf(fr.z, fr.u + 0.001, push, M).distanceTo(surf(fr.z, fr.u - 0.001, push, M));
  let worst = 0;
  for (const [a, b] of pts) {
    const s = surf(fr.z - b, fr.u + a * du, push, M); // tz points to the nose, so +b is toward -z
    worst = Math.max(worst, fr.p.clone().sub(s).dot(fr.n));
  }
  return worst;
}
// A raised plate that follows the skin: a grid over z0..z1 and u0..u1 lifted by t, its edges tucked under the skin.
// On the bay's inner skin (inward) it stands toward the cabin instead.
function patch(z0, z1, u0, u1, t, { push = 0, M = 48, nz = 4, nu = 6, inward = false } = {}) {
  const lift = inward ? -t : t, tuck = inward ? 0.012 : -0.012;
  const P = (iz, iu, l) => surf(z0 + ((z1 - z0) * iz) / nz, u0 + ((u1 - u0) * iu) / nu, push + l, M);
  const pos = [], uv = [], idx = [];
  for (let iz = 0; iz <= nz; iz++) for (let iu = 0; iu <= nu; iu++) {
    pos.push(...P(iz, iu, lift).toArray());
    uv.push(iu / nu, iz / nz);
  }
  for (let iz = 0; iz < nz; iz++) for (let iu = 0; iu < nu; iu++) {
    const a = iz * (nu + 1) + iu, b = a + 1, c = a + nu + 1, d = c + 1;
    if (inward) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  top.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  top.setIndex(idx);
  top.computeVertexNormals();
  // the four side walls, from the top edge down into the skin
  const wpos = [], wuv = [];
  const rim = [];
  for (let iu = 0; iu <= nu; iu++) rim.push([0, iu]);
  for (let iz = 1; iz <= nz; iz++) rim.push([iz, nu]);
  for (let iu = nu - 1; iu >= 0; iu--) rim.push([nz, iu]);
  for (let iz = nz - 1; iz >= 0; iz--) rim.push([iz, 0]);
  for (let k = 0; k < rim.length - 1; k++) {
    const a = P(...rim[k], lift), b = P(...rim[k + 1], lift), c = P(...rim[k], tuck), d = P(...rim[k + 1], tuck);
    const quad = inward ? [a, b, c, b, d, c] : [a, c, b, b, c, d];
    for (const v of quad) { wpos.push(v.x, v.y, v.z); wuv.push(0, 0); }
  }
  const walls = new THREE.BufferGeometry();
  walls.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
  walls.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
  walls.computeVertexNormals();
  return mergeGeometries([top.toNonIndexed(), walls]);
}

export const hullTools = { surf, frame, wallX, bellyY, roofY, SECS }; // for tools/ship_audit.js

// Skin a run of sections into a mesh. uv.x runs nose to tail, uv.y round the hull. push may be a number or
// a function of the section index (a flare).
function loft(secs, M, u0 = 0, u1 = 1, push = 0, capNose = false) {
  const pos = [], uv = [], idx = [];
  const z0 = HULL[0][0], z1 = HULL[HULL.length - 1][0];
  for (const [i, s] of secs.entries()) for (let j = 0; j <= M; j++) {
    const u = u0 + ((u1 - u0) * j) / M;
    pos.push(...ringPoint(s, u, typeof push === 'function' ? push(i, j / M) : push));
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
    lens: new THREE.MeshStandardMaterial({ color: '#dfe6ee', roughness: 0.12, metalness: 0, emissive: '#ffffff', emissiveIntensity: 0.25 }),
  };
  for (const [k, m] of Object.entries(hullMats)) m.name = k;
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
  const secs = SECS;
  add(loft(secs, 48, 0, 1, 0, true), M.hull);
  // tail collar round the ramp opening: it flares out of the skin, and a frame ring at the open end closes the
  // gaps between the collar, the skin and the bay lining
  const tail = secs.slice(-3);
  add(loft(tail, 48, 0, 1, (i) => [-0.004, 0.05, 0.05][i]), M.dark);
  const BP = -0.07, BM = 32; // the bay lining sits 7 cm inside the skin, on a coarser ring
  const tailSec = HULL[HULL.length - 1];
  const endRing = new THREE.Shape(), endHole = new THREE.Path();
  for (let j = 0; j <= 48; j++) { const [x, y] = ringPoint(tailSec, j / 48, 0.05); if (j) endRing.lineTo(x, y); else endRing.moveTo(x, y); }
  for (let j = 0; j <= BM; j++) { const [x, y] = ringPoint(tailSec, j / BM, BP); if (j) endHole.lineTo(x, y); else endHole.moveTo(x, y); }
  endRing.holes.push(endHole);
  add(new THREE.ShapeGeometry(endRing, 2), M.dark, 0, 0, tailSec[0], body, false);
  // troop bay: the lining, a bulkhead, a deck out to the walls, jump seats, grab rails and lights
  const baySecs = secs.filter((s) => s[0] >= -0.7);
  add(loft(baySecs, BM, 0, 1, BP), M.bay, 0, 0, 0, body, false);
  const zb = baySecs[0][0] + 0.02, deckTop = 1.17;
  const bulk = new THREE.Shape();
  for (let j = 0; j <= BM; j++) { const p = surf(zb, j / BM, BP, BM); if (j) bulk.lineTo(p.x, p.y); else bulk.moveTo(p.x, p.y); }
  add(new THREE.ShapeGeometry(bulk), M.seat, 0, 0, zb, body, false);
  // the deck runs wall to wall, so nothing shows under it
  const dzs = [zb, ...secs.map((s) => s[0]).filter((z) => z > zb + 0.05 && z < 3.94), 3.99];
  const dpos = [], duv = [], didx = [];
  for (const [i, z] of dzs.entries()) {
    const xw = Math.min(Math.max(0.95, wallX(z, deckTop, BP, BM) + 0.015), wallX(z, deckTop) - 0.012); // never out through the skin
    dpos.push(-xw, deckTop, z, xw, deckTop, z);
    duv.push(0.5 - xw / 2.8, (z - zb) / 4.6, 0.5 + xw / 2.8, (z - zb) / 4.6);
    if (i) { const a = (i - 1) * 2; didx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
  deck.setAttribute('uv', new THREE.Float32BufferAttribute(duv, 2));
  deck.setIndex(didx);
  deck.computeVertexNormals();
  add(deck, M.panel, 0, 0, 0, body, false);
  const lining = { push: BP, M: BM, inward: true };
  const uAt = (z, y, s) => { const u = solveU(z, BP, BM, 0, 0.5, 'y', y); return s > 0 ? u : 1 - u; };
  const span = (z, y0, y1, s) => { const a = uAt(z, y0, s), b = uAt(z, y1, s); return [Math.min(a, b), Math.max(a, b)]; };
  for (const s of [-1, 1]) {
    // jump seats with their backs on the wall, each turned to follow the hull's taper, on legs to the deck
    for (let k = 0; k < 6; k++) {
      const z = 0.35 + k * 0.6;
      const seat = new THREE.Group();
      seat.name = 'seat';
      seat.position.set(s * wallX(z, 1.84, BP, BM), 0, z);
      seat.rotation.y = s * Math.atan((wallX(z + 0.2, 1.84, BP, BM) - wallX(z - 0.2, 1.84, BP, BM)) / 0.4);
      body.add(seat);
      add(new THREE.BoxGeometry(0.06, 0.6, 0.5), M.seat, -s * 0.03, 1.84, 0, seat, false);
      add(new THREE.BoxGeometry(0.42, 0.07, 0.48), M.seat, -s * 0.26, 1.55, 0, seat, false);
      add(new THREE.BoxGeometry(0.05, 0.2, 0.3), M.seat, -s * 0.085, 2.02, 0, seat, false);
      for (const dz of [-0.19, 0.19]) add(new THREE.CylinderGeometry(0.018, 0.018, 0.37, 6), M.metal, -s * 0.42, 1.335, dz, seat, false);
      // webbing on the wall above each seat
      for (const dz of [-0.16, 0.16]) {
        const [u0, u1] = span(z + dz, 2.16, 2.6, s);
        add(patch(z + dz - 0.02, z + dz + 0.02, u0, u1, 0.01, { ...lining, nz: 1, nu: 4 }), M.seat, 0, 0, 0, body, false);
      }
    }
    // red strip lights down each side of the door
    const [d0, d1] = span(3.88, 1.25, 2.45, s);
    add(patch(3.86, 3.9, d0, d1, 0.014, { ...lining, nz: 1, nu: 10 }), M.redGlow, 0, 0, 0, body, false);
    // a grab rail hung from the roof on four hangers, with straps
    const xr = s * 0.5, yr = Math.min(...[0.1, 0.9, 1.7, 2.5, 3.3, 3.7].map((z) => roofY(z, 0.5, BP, BM))) - 0.08;
    add(new THREE.CylinderGeometry(0.018, 0.018, 3.6, 6).rotateX(Math.PI / 2), M.metal, xr, yr, 1.9, body, false);
    for (const z of [0.3, 1.3, 2.3, 3.4]) {
      const len = roofY(z, 0.5, BP, BM) - yr + 0.012;
      add(new THREE.BoxGeometry(0.025, len, 0.025), M.metal, xr, yr + len / 2, z, body, false);
    }
    for (let k = 0; k < 7; k++) add(new THREE.BoxGeometry(0.03, 0.22, 0.012), M.seat, xr, yr - 0.1, 0.3 + k * 0.55, body, false);
    // roof lights
    for (let k = 0; k < 4; k++) {
      const z = 0.5 + k * 0.85, a = solveU(z, BP, BM, 0.25, 0.5, 'x', 0.38), b = solveU(z, BP, BM, 0.25, 0.5, 'x', 0.26);
      const [u0, u1] = s > 0 ? [a, b] : [1 - b, 1 - a];
      add(patch(z - 0.06, z + 0.06, u0, u1, 0.012, { ...lining, nz: 1, nu: 2 }), M.warmGlow, 0, 0, 0, body, false);
    }
    add(new THREE.BoxGeometry(0.45, 1.1, 0.22), M.panel, s * 0.48, 1.72, -0.45, body, false);
  }
  // hull details: reaction thruster blocks, vents and access hatches on both flanks
  for (const s of [-1, 1]) {
    // reaction thruster blocks, seated on the skin's frame and sunk past the curve under them, nozzles out of the face
    for (const [z, y] of [[-3.6, 2.15], [2.6, 2.45]]) {
      const u = solveU(z, 0, 48, 0, 0.5, 'y', y), f = frame(z, s > 0 ? u : 1 - u);
      const sk = sag(f, [[0.11, 0.14], [-0.11, 0.14], [0.11, -0.14], [-0.11, -0.14]]);
      const up = 0.08 - sk - 0.01, blk = add(new THREE.BoxGeometry(0.22, 0.16, 0.28), M.dark, 0, 0, 0, body);
      blk.quaternion.copy(f.q);
      blk.position.copy(f.p).addScaledVector(f.n, up);
      for (const dz of [-0.08, 0.08]) {
        const nz = add(new THREE.CylinderGeometry(0.04, 0.03, 0.06, 8), M.metal, 0, 0, 0, body, false); // bell flares outward
        nz.quaternion.copy(f.q);
        nz.position.copy(f.p).addScaledVector(f.n, up + 0.08 + 0.02).addScaledVector(f.tz, dz);
      }
    }
    // vent strips and a hatch plate, laid on the skin's own frame so they sit flush
    for (const [z, y, w, d, mat] of [[-0.9, 1.35, 0.12, 0.34, M.dark], [-0.42, 1.35, 0.12, 0.34, M.dark], [0.06, 1.35, 0.12, 0.34, M.dark], [0.54, 1.35, 0.12, 0.34, M.dark], [3.3, 1.75, 0.42, 0.5, M.panel]]) {
      const u = solveU(z, 0, 48, 0, 0.5, 'y', y), f = frame(z, s > 0 ? u : 1 - u);
      const sk = sag(f, [[w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]]);
      const m = add(new THREE.BoxGeometry(w, 0.04, d), mat, 0, 0, 0, body, false);
      m.quaternion.copy(f.q);
      m.position.copy(f.p).addScaledVector(f.n, Math.min(0, 0.016 - sk)); // bottom edges under the skin, top up to 2 cm proud
    }
  }
  // the red lamp over the door
  { const [u0, u1] = span(3.88, 2.56, 2.66, 1); add(patch(3.84, 3.92, u0, u1, 0.03, { ...lining, nz: 1, nu: 2 }), M.redGlow, 0, 0, 0, body, false); }
  const bayLight = new THREE.PointLight('#ffd6a8', 3, 5, 1.8);
  bayLight.position.set(0, 2.5, 2.4);
  body.add(bayLight);
  // ramp, hinged at the bottom of the tail
  const ramp = new THREE.Group();
  ramp.name = 'ramp';
  ramp.position.set(0, 1.09, 4.0);
  body.add(ramp);
  // the ramp is cut to the tail's own outline, so shut it closes the hull; open, it is a rounded-ended ramp
  const base = tailSec[3] - tailSec[2] / 2;
  const rampLen = tailSec[2] - 0.02;
  const outline = new THREE.Shape();
  for (let j = 0; j <= 40; j++) { const [x, y] = ringPoint(tailSec, j / 40, -0.03); if (j) outline.lineTo(x, Math.max(0, y - base)); else outline.moveTo(x, Math.max(0, y - base)); }
  const rg = new THREE.ExtrudeGeometry(outline, { depth: 0.1, bevelEnabled: false });
  rg.rotateX(Math.PI / 2);
  add(rg, M.tread, 0, 0, 0, ramp);
  // tread plates and grip bars sit on the ramp's top face (y = 0), a hair sunk so no sliver of light shows under them
  for (const x of [-0.45, 0.45]) add(new THREE.BoxGeometry(0.34, 0.008, rampLen - 0.2), M.metal, x, 0.002, rampLen / 2, ramp, false);
  for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(1.6 - i * 0.05, 0.022, 0.05), M.dark, 0, 0.008, 0.25 + i * 0.3, ramp, false);
  add(new THREE.BoxGeometry(2.0, 0.016, 0.1), M.ember, 0, 0.005, 0.08, ramp, false);
  // canopy glass: a shallow blister that rises out of the nose, its edges tucked under the skin
  const nose = secs.filter((s) => s[0] > -5.2 && s[0] < -3.65);
  const bump = (k) => Math.sin(Math.PI * Math.min(1, Math.max(0, k))) ** 0.5;
  add(loft(nose, 16, 0.385, 0.615, (i, t) => 0.018 * bump(i / (nose.length - 1)) * bump(t) - 0.006), M.glass, 0, 0, 0, body, false);
  // chin turret
  const turret = new THREE.Group();
  turret.name = 'turret';
  turret.position.set(0, 0.92, -4.4);
  body.add(turret);
  add(new THREE.SphereGeometry(0.24, 18, 12), M.dark, 0, 0, 0, turret);
  for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.035, 0.04, 0.6, 8).rotateX(Math.PI / 2), M.metal, s * 0.08, -0.04, -0.4, turret);
  // sensor fit on the spine, pitched to the hull's slope and bedded into it; a radome and an aerial on a foot
  {
    const z0 = -0.95, z1 = 0.35, y0 = roofY(z0, 0.35), y1 = roofY(z1, 0.35);
    const fit = add(new RoundedBoxGeometry(0.7, 0.16, 1.3, 2, 0.05), M.panel, 0, (y0 + y1) / 2 + 0.05, (z0 + z1) / 2);
    fit.rotation.x = -Math.atan2(y1 - y0, z1 - z0);
    add(new THREE.SphereGeometry(0.14, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.dark, 0, roofY(0.6, 0.14) - 0.012, 0.6);
    const ay = roofY(0.9, 0.25);
    add(new THREE.CylinderGeometry(0.035, 0.045, 0.05, 10), M.dark, 0.25, ay + 0.008, 0.9);
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 5), M.metal, 0.25, ay + 0.35, 0.9);
  }
  // wings with an ember edge, swept back, a touch of droop
  const wings = [], pods = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Shape();
    // the root follows the hull 3.5 cm inside the skin (allowing for the droop and the bevel), so it is buried
    // in the wall and never shows inside the troop bay
    const root = (z) => (wallX(z, 1.82) - 0.035 - 0.07 * 1.89) / 0.9976 + 0.05;
    const pts = [[root(-1.1), 1.1], [3.95, -0.4], [3.95, -2.3], [root(2.35), -2.35], [root(0.6), -0.6]].map(([x, y]) => [x * s, y]);
    sh.moveTo(...pts[0]); for (const p of pts.slice(1)) sh.lineTo(...p);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 });
    g.rotateX(-Math.PI / 2);
    const wing = add(g, M.panel, 0, 1.78, 0);
    wing.rotation.z = s * -0.07;
    wings.push(wing);
    // engine pod at the tip on a pivot, so it can swing from straight down (hover) to straight back (cruise)
    const pivot = new THREE.Group();
    pivot.name = 'pod';
    pivot.position.set(s * 4.45, 1.98, 1.25);
    body.add(pivot);
    const prof = [[0.33, 1.2], [0.37, 1.28], [0.42, 1.27], [0.5, 1.16], [0.56, 0.9], [0.56, -0.55], [0.5, -0.95], [0.43, -1.22], [0.36, -1.24]].reverse().map(([r, y]) => new THREE.Vector2(r, y));
    const pod = add(new THREE.LatheGeometry(prof, 28).rotateX(-Math.PI / 2), M.podPanel, 0, 0, 0, pivot);
    add(pod.geometry, M.duct, 0, 0, 0, pivot, false);
    // the cowl's radius at a station along the pod (intake toward -z)
    const rAt = (z) => {
      for (let k = 0; k < prof.length - 1; k++) {
        const a = prof[k], b = prof[k + 1];
        if (a.y !== b.y && (-z - a.y) * (-z - b.y) <= 0) return a.x + ((b.x - a.x) * (-z - a.y)) / (b.y - a.y);
      }
      return 0.5;
    };
    // an ember band round the intake, half sunk in the cowl
    add(new THREE.TorusGeometry(rAt(-1.0), 0.03, 8, 28), M.ember, 0, 0, -1.0, pivot, false);
    // intake duct from the lip back to the fan face; the fan's spinner runs back on a shaft to the face plate
    add(new THREE.CylinderGeometry(0.332, 0.332, 0.25, 24, 1, true).rotateX(Math.PI / 2), M.duct, 0, 0, -1.075, pivot, false);
    add(new THREE.CircleGeometry(0.335, 24), M.dark, 0, 0, -0.95, pivot, false);
    for (let k = 0; k < 18; k++) {
      const blade = add(new THREE.BoxGeometry(0.05, 0.31, 0.012), M.fan, 0, 0, -1.0, pivot, false);
      blade.rotation.set(0, 0.5, (k / 18) * Math.PI * 2, 'ZYX');
      blade.position.x = Math.sin((k / 18) * Math.PI * 2) * -0.178;
      blade.position.y = Math.cos((k / 18) * Math.PI * 2) * 0.178;
    }
    add(new THREE.ConeGeometry(0.08, 0.16, 16).rotateX(-Math.PI / 2), M.fan, 0, 0, -1.07, pivot, false);
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 16).rotateX(Math.PI / 2), M.fan, 0, 0, -0.97, pivot, false);
    // panel seams pressed into the cowl
    for (const z of [-0.45, 0.15, 0.5]) add(new THREE.TorusGeometry(rAt(z) + 0.002, 0.007, 4, 40), M.dark, 0, 0, z, pivot, false);
    // a heat-blued band round the hot end that follows the cowl, its edges tucked into it
    const band = [new THREE.Vector2(rAt(1.0) - 0.006, -1.0)];
    for (let k = 0; k <= 6; k++) { const z = 1.0 - (0.4 * k) / 6; band.push(new THREE.Vector2(rAt(z) + 0.008, -z)); }
    band.push(new THREE.Vector2(rAt(0.6) - 0.006, -0.6));
    add(new THREE.LatheGeometry(band, 32).rotateX(-Math.PI / 2), M.heat, 0, 0, 0, pivot, false);
    add(new THREE.BoxGeometry(0.02, 0.18, 0.32), M.dark, s * 0.56, 0.12, -0.2, pivot, false);
    const nozzle = new THREE.MeshStandardMaterial({ color: '#3a3d42', roughness: 0.3, metalness: 1, side: THREE.DoubleSide });
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2, pet = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.015, 0.42), nozzle);
      pet.position.set(Math.cos(a) * 0.37, Math.sin(a) * 0.37, 1.2);
      pet.rotation.set(0, 0, a + Math.PI / 2);
      pet.rotateX(-0.16);
      pivot.add(pet);
    }
    // the exhaust: a liner from the turbine face back to the cowl lip, so the face plate meets a wall all round
    add(new THREE.CylinderGeometry(0.36, 0.36, 0.32, 24, 1, true).rotateX(Math.PI / 2), M.duct, 0, 0, 1.085, pivot, false);
    add(new THREE.CircleGeometry(0.362, 24), M.dark, 0, 0, 0.93, pivot, false);
    // the nozzle glow: a ring of hot metal on the face plate, a soft sprite and a cone of exhaust
    const hot = add(new THREE.RingGeometry(0.1, 0.35, 32), new THREE.MeshBasicMaterial({ color: '#ff7a2a' }), 0, 0, 0.933, pivot, false);
    for (let k = 0; k < 16; k++) {
      const blade = add(new THREE.BoxGeometry(0.045, 0.29, 0.01), M.fan, 0, 0, 1.0, pivot, false);
      blade.rotation.set(0, -0.5, (k / 16) * Math.PI * 2, 'ZYX');
      blade.position.x = Math.sin((k / 16) * Math.PI * 2) * -0.214;
      blade.position.y = Math.cos((k / 16) * Math.PI * 2) * 0.214;
    }
    add(new THREE.ConeGeometry(0.1, 0.32, 18).rotateX(Math.PI / 2), M.fan, 0, 0, 1.14, pivot, false);
    add(new THREE.CylinderGeometry(0.075, 0.075, 0.08, 16).rotateX(Math.PI / 2), M.fan, 0, 0, 0.965, pivot, false);
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
    fin.name = 'fin';
    fin.position.set(s * 0.7, 2.95, 0);
    fin.rotation.z = s * -0.72;
    body.add(fin);
    add(g, M.panel, 0, 0, 0, fin);
    add(new THREE.BoxGeometry(0.14, 0.1, 1.05), M.ember, 0, 0.93, 3.78, fin, false);
    // the strobe sits in a lens on a foot at the fin tip
    add(new THREE.CylinderGeometry(0.04, 0.045, 0.03, 12), M.dark, 0, 0.99, 4.2, fin, false);
    add(new THREE.SphereGeometry(0.034, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.lens, 0, 1.0, 4.2, fin, false);
    const strobe = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color('#ffffff').multiplyScalar(3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    strobe.position.set(0, 1.02, 4.2);
    fin.add(strobe);
    strobes.push(strobe);
  }
  // belly lift jets: rings laid on the belly's own slope and bedded into it, the glow inside them
  const belly = [];
  for (const x of [-0.7, 0.7]) {
    const u = solveU(-1.6, 0, 48, 0, 0.25, 'x', 0.7), f = frame(-1.6, x < 0 ? 1 - u : u);
    const sk = sag(f, [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [Math.cos((k * Math.PI) / 4) * 0.3, Math.sin((k * Math.PI) / 4) * 0.3]));
    const ring = add(new THREE.TorusGeometry(0.26, 0.04, 8, 20).rotateX(Math.PI / 2), M.dark, 0, 0, 0, body, false);
    ring.quaternion.copy(f.q);
    ring.position.copy(f.p).addScaledVector(f.n, -sk * 0.6);
    const glow = add(new THREE.CircleGeometry(0.22, 20).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff9a5a', transparent: true, side: THREE.DoubleSide }), 0, 0, 0, body, false);
    glow.quaternion.copy(f.q);
    glow.position.copy(f.p).addScaledVector(f.n, 0.004);
    belly.push(glow);
    ring.castShadow = false;
  }
  // landing legs: nose and two mains. Each strut rises out of a fairing bedded in the belly, with a shock collar,
  // a link, a brake line along it and a foot pad it runs into; the gear doors hang from the fairing's edges
  const legs = [];
  for (const [x, z] of [[0, -3.4], [-1.15, 1.6], [1.15, 1.6]]) {
    const h = bellyY(z, x) + 0.05; // the strut's top is 5 cm up inside the hull
    const leg = new THREE.Group();
    leg.name = 'leg';
    leg.position.set(x, h, z);
    body.add(leg);
    add(new THREE.BoxGeometry(0.36, 0.28, 0.6), M.dark, 0, -0.03, 0, leg);
    add(new THREE.CylinderGeometry(0.075, 0.075, h - 0.02, 10), M.metal, 0, -(h - 0.02) / 2, 0, leg);
    add(new THREE.CylinderGeometry(0.11, 0.11, 0.25, 10), M.dark, 0, -0.28, 0, leg);
    add(new THREE.BoxGeometry(0.05, 0.3, 0.18), M.dark, 0.09, -h * 0.6, 0.06, leg);
    add(new THREE.CylinderGeometry(0.28, 0.34, 0.08, 20), M.dark, 0, -h + 0.04, 0, leg);
    add(new THREE.CylinderGeometry(0.015, 0.015, h - 0.32, 6), M.rubber, -0.08, -(0.2 + (h - 0.32) / 2), -0.036, leg);
    for (const d of x === 0 ? [-1, 1] : [Math.sign(x)]) {
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8).rotateX(Math.PI / 2), M.metal, d * 0.18, -0.17, 0, leg, false);
      const door = add(new THREE.BoxGeometry(0.02, 0.32, 0.5), M.panel, d * (0.18 + 0.16 * Math.sin(0.5)), -0.17 - 0.16 * Math.cos(0.5), 0, leg, false);
      door.rotation.z = d * 0.5;
    }
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
      this.onTick?.(dt, t); // flights.js hangs the engine sound here while the ship flies
    },
    onTick: null,
  };
  greebles(body, M);
  ship.setRamp(1); ship.setGear(1); ship.setTilt(1); ship.setThrust(0);
  root.traverse((o) => { if (o.isSprite || (o.material && o.material.transparent)) o.userData.noAO = true; });
  return ship;
}

// Vents, hatches, sensors, aerials, wing fences, hinges and grab handles. Each piece is laid on the skin's own frame
// (the spot, the outward normal and the slope both ways) and bedded deep enough that no edge lifts where the hull
// curves away under it; plates on tight curves are built to follow the skin. All of them merge into one mesh per
// material.
function greebles(body, M) {
  const buckets = new Map();
  const put = (geo, mat, pos, quat, label) => {
    label = label || `${geo.type.replace('Geometry', '')} @${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}`;
    geo.applyQuaternion(quat || new THREE.Quaternion()).translate(pos.x, pos.y, pos.z);
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.userData.label = label;
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(g);
  };
  const raw = (geo, mat, label) => put(geo, mat, new THREE.Vector3(), null, label); // already in body space
  // the u span that covers half-width w (metres) round the hull at (z, u)
  const du = (z, u, w) => (w * 0.002) / surf(z, u + 0.001).distanceTo(surf(z, u - 0.001));
  // a spot on a frame: a along tu, b along tz, up along the normal
  const on = (f, a, b, up) => f.p.clone().addScaledVector(f.tu, a).addScaledVector(f.tz, b).addScaledVector(f.n, up);
  for (const side of [1, -1]) {
    const u = (v) => (side > 0 ? v : 1 - v);
    // louvred vents low on the flanks: a plate that follows the turn of the belly, louvres along it
    for (const z of [-2.2, -1.6, 2.0]) {
      const uc = u(0.14), w = du(z, uc, 0.17);
      raw(patch(z - 0.11, z + 0.11, uc - w, uc + w, 0.02, { nu: 8, nz: 3 }), M.dark, `vent plate z ${z}`);
      for (let k = 0; k < 4; k++) {
        const zk = z - 0.08 + k * 0.055;
        raw(patch(zk - 0.01, zk + 0.01, uc - w * 0.88, uc + w * 0.88, 0.032, { nu: 8, nz: 1 }), M.metal, `louvre z ${zk.toFixed(2)}`);
      }
    }
    // raised access panels that follow the skin, a bolt at each corner
    for (const [z, uu] of [[-0.4, 0.36], [1.2, 0.38], [3.1, 0.33], [-3.2, 0.3]]) {
      const uc = u(uu), w = du(z, uc, 0.21);
      raw(patch(z - 0.17, z + 0.17, uc - w, uc + w, 0.015, { nu: 8, nz: 4 }), M.panel, `access panel z ${z}`);
      for (const [a, b] of [[-0.86, -0.82], [0.86, -0.82], [-0.86, 0.82], [0.86, 0.82]]) {
        const f = frame(z + b * 0.17, uc + a * w);
        put(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6), M.metal, on(f, 0, 0, 0.012), f.q);
      }
    }
    // grab handles beside the ramp, their ends bedded in the skin
    for (let k = 0; k < 3; k++) {
      const f = frame(3.6, u(0.2 + k * 0.05));
      put(new THREE.TorusGeometry(0.05, 0.008, 6, 12, Math.PI).rotateY(Math.PI / 2), M.metal, on(f, 0, 0, -0.005), f.q);
    }
    // a step plate below the door line, on two brackets
    const st = frame(2.4, u(0.09));
    put(new THREE.BoxGeometry(0.28, 0.02, 0.16), M.metal, on(st, 0, 0, 0.05), st.q);
    for (const a of [-0.1, 0.1]) put(new THREE.BoxGeometry(0.03, 0.07, 0.12), M.dark, on(st, a, 0, 0.015), st.q);
    // wing fences: thin upright plates across the wing top
    for (const wx of [2.3, 3.4]) put(new THREE.BoxGeometry(0.02, 0.14, 0.9), M.panel, new THREE.Vector3(side * wx, 2.0 - wx * 0.07 + 0.06, 0.55 + (wx - 2.3) * 0.5));
    // a hardpoint pylon under each wing
    put(new THREE.BoxGeometry(0.1, 0.16, 0.9), M.dark, new THREE.Vector3(side * 2.9, 1.48, 0.6));
    put(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 12).rotateX(Math.PI / 2), M.metal, new THREE.Vector3(side * 2.9, 1.34, 0.6));
    // ramp hinges
    put(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 10).rotateZ(Math.PI / 2), M.metal, new THREE.Vector3(side * 0.7, 1.09, 4.0));
  }
  // spine: aerial blades, a sensor dome and a row of small intakes, each on the spine's own slope
  for (const z of [-2.0, -1.3, 2.3]) { const f = frame(z, 0.5); put(new THREE.BoxGeometry(0.015, 0.22, 0.12), M.dark, on(f, 0, 0, 0.095), f.q); }
  const dome = frame(-3.0, 0.5);
  const dk = sag(dome, [[0.09, 0], [-0.09, 0], [0, 0.09], [0, -0.09]]);
  put(new THREE.SphereGeometry(0.09, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.glass, on(dome, 0, 0, -dk - 0.003), dome.q);
  for (let k = 0; k < 4; k++) { const f = frame(1.0 + k * 0.3, 0.5); put(new THREE.BoxGeometry(0.18, 0.05, 0.12), M.dark, on(f, 0, 0, 0.012), f.q); }
  // nose: a pitot probe and two sensor pucks set into the cheeks
  put(new THREE.CylinderGeometry(0.008, 0.012, 0.5, 6).rotateX(Math.PI / 2), M.metal, new THREE.Vector3(0.22, 1.32, -5.55));
  for (const uu of [0.2, 0.8]) { const f = frame(-4.95, uu); put(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12), M.glass, on(f, 0, 0, 0.002), f.q); }
  for (const [mat, list] of buckets) {
    const m = new THREE.Mesh(mergeGeometries(list), mat);
    m.name = 'greebles';
    m.userData.pieces = list.map((g) => [g.userData.label, g.attributes.position.count]); // for tools/shipaudit.py
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
