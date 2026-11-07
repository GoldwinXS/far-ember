// Far Ember: Ember Company armour. Plates are grown from the soldier's own body surface in the rest pose (so they sit on
// it and never float), given thickness and a rim, and parented to bones. The fit is done once per body and shared;
// each soldier gets their own materials, so paint, trim, visor and helmet are theirs to choose.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The customisation palettes. Index 0 of each is the default.
export const PALETTE = {
  armour: [['Bone', '#d8d4c8'], ['Ash', '#8e949c'], ['Navy', '#34486b'], ['Olive', '#67714d'], ['Sand', '#bba27b'], ['Ember', '#c8652d'], ['Crimson', '#8c302d'], ['Night', '#2d3036']],
  trim: [['Ember', '#ff7a2e'], ['Gold', '#d9a743'], ['White', '#ebe9e2'], ['Teal', '#2fb3b8'], ['Red', '#c7372f'], ['Navy', '#24355a'], ['Black', '#1d1f23'], ['Olive', '#515c39']],
  suit: [['Charcoal', '#4c5057'], ['Navy', '#3a4864'], ['Olive', '#4f5540'], ['Brown', '#5a4f42'], ['Grey', '#7e8288']],
  visor: [['Ember', '#ff8a3d'], ['Teal', '#5ae0ff'], ['Green', '#8cff6a'], ['Red', '#ff4a4a'], ['Gold', '#ffcf5a'], ['White', '#e8f0ff']],
  helmet: ['Standard', 'Crested', 'Spotter'],
  pattern: ['Edged', 'Striped', 'Plain'],
};
const CLASS_TRIM = { scout: '#e07a38', gunner: '#93b544', marksman: '#4f9fd2', medic: '#e6e2d6' };

// A new soldier's kit: varied by look so a fresh squad does not match.
export function defaultKit(cls, look = 0) {
  const k = look % 4;
  return { armour: [0, 1, 4, 3][k], trim: [0, 6, 2, 5][k], suit: [0, 1, 2, 0][k], visor: [0, 1, 4, 0][k], helmet: k % 3, pattern: [0, 1, 0, 2][k] };
}
export function kitColours(kit) {
  const K = { ...defaultKit('', 0), ...(kit || {}) };
  const pick = (list, i) => list[Math.max(0, Math.min(list.length - 1, i | 0))][1];
  return { armour: pick(PALETTE.armour, K.armour), trim: pick(PALETTE.trim, K.trim), suit: pick(PALETTE.suit, K.suit), visor: pick(PALETTE.visor, K.visor), helmet: K.helmet | 0, pattern: K.pattern | 0 };
}

// ------------------------------------------------------------ fitting
// Plates: the bone segment they follow (a to b), which bones' skin they sit on, where along the segment (t),
// which way round they face, how wide (half angle), and the gap and thickness.
const PLATES = [
  { id: 'chest', V: [-1, -0.55, -0.18, 0.18, 0.55, 1], a: 'Spine1', b: 'Neck', on: ['Spine1', 'Spine2'], t: [0.1, 0.93], face: 'fwd', half: 74, off: 0.012, th: 0.016, at: 'Spine2' },
  { id: 'back', V: [-1, -0.5, 0, 0.5, 1], a: 'Spine1', b: 'Neck', on: ['Spine1', 'Spine2'], t: [0.02, 0.9], face: 'back', half: 70, off: 0.014, th: 0.016, at: 'Spine2' },
  { id: 'belly', V: [-1, -0.35, 0.35, 1], a: 'Hips', b: 'Spine1', on: ['Spine', 'Hips', 'Spine1'], t: [0.42, 1.0], face: 'fwd', half: 58, off: 0.01, th: 0.012, at: 'Spine' },
  { id: 'shoulderL', V: [-1, -0.6, -0.2, 0.2, 0.6, 1], a: 'LeftArm', b: 'LeftForeArm', on: ['LeftArm', 'LeftShoulder'], t: [-0.2, 0.42], face: 'out', half: 98, off: 0.014, th: 0.014, at: 'LeftArm', cls: true },
  { id: 'shoulderR', V: [-1, -0.6, -0.2, 0.2, 0.6, 1], a: 'RightArm', b: 'RightForeArm', on: ['RightArm', 'RightShoulder'], t: [-0.2, 0.42], face: 'out', half: 98, off: 0.014, th: 0.014, at: 'RightArm' },
  { id: 'forearmL', V: [-1, -0.33, 0.33, 1], a: 'LeftForeArm', b: 'LeftHand', on: ['LeftForeArm'], t: [0.2, 0.86], face: 'out', half: 84, off: 0.008, th: 0.011, at: 'LeftForeArm' },
  { id: 'forearmR', V: [-1, -0.33, 0.33, 1], a: 'RightForeArm', b: 'RightHand', on: ['RightForeArm'], t: [0.2, 0.86], face: 'out', half: 84, off: 0.008, th: 0.011, at: 'RightForeArm' },
  { id: 'thighL', V: [-1, -0.3, 0, 0.3, 1], round: 0.1, a: 'LeftUpLeg', b: 'LeftLeg', on: ['LeftUpLeg'], t: [0.16, 0.64], face: 'fwdOut', half: 64, off: 0.008, th: 0.01, at: 'LeftUpLeg' },
  { id: 'thighR', V: [-1, -0.3, 0, 0.3, 1], round: 0.1, a: 'RightUpLeg', b: 'RightLeg', on: ['RightUpLeg'], t: [0.16, 0.64], face: 'fwdOut', half: 64, off: 0.008, th: 0.01, at: 'RightUpLeg' },
  { id: 'shinL', V: [-1, -0.45, 0, 0.45, 1], a: 'LeftLeg', b: 'LeftFoot', on: ['LeftLeg'], t: [-0.06, 0.82], face: 'fwd', half: 66, off: 0.008, th: 0.011, at: 'LeftLeg' },
  { id: 'shinR', V: [-1, -0.45, 0, 0.45, 1], a: 'RightLeg', b: 'RightFoot', on: ['RightLeg'], t: [-0.06, 0.82], face: 'fwd', half: 66, off: 0.008, th: 0.011, at: 'RightLeg' },
];

const fits = new Map(); // body key -> { plates: [{ id, at, geo, cls }], helmet: {...} }

// Posed vertices of the body with the bone that moves each one most.
function sampleBody(model, P) {
  const out = [];
  const v = new THREE.Vector3();
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const g = o.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, n = g.attributes.position.count;
    const names = o.skeleton.bones.map((b) => b.name.slice(P.length));
    for (let i = 0; i < n; i++) {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      out.push({ p: o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld).clone(), bone: names[best] });
    }
  });
  return out;
}

// Smooth a grid of radii, filling empty cells from their neighbours first.
function smoothGrid(r, NI, NJ, passes, wrapJ = false) {
  for (let it = 0; it < 30; it++) {
    let empty = 0;
    const nx = r.slice();
    for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) {
      if (r[i * NJ + j] > 0) continue;
      let s = 0, c = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di; let b = j + dj;
        if (wrapJ) b = (b + NJ) % NJ;
        if (a < 0 || a >= NI || b < 0 || b >= NJ) continue;
        if (r[a * NJ + b] > 0) { s += r[a * NJ + b]; c++; }
      }
      if (c) nx[i * NJ + j] = s / c; else empty++;
    }
    r.set(nx);
    if (!empty) break;
  }
  for (let p = 0; p < passes; p++) {
    const nx = r.slice();
    for (let i = 0; i < NI; i++) for (let j = 0; j < NJ; j++) {
      let s = 0, c = 0;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const a = i + di; let b = j + dj;
        if (wrapJ) b = (b + NJ) % NJ;
        if (a < 0 || a >= NI || b < 0 || b >= NJ) continue;
        s += r[a * NJ + b]; c++;
      }
      nx[i * NJ + j] = s / c;
    }
    r.set(nx);
  }
}
function bilinear(r, NI, NJ, fi, fj) {
  fi = Math.max(0, Math.min(NI - 1.001, fi)); fj = Math.max(0, Math.min(NJ - 1.001, fj));
  const i = Math.floor(fi), j = Math.floor(fj), a = fi - i, b = fj - j;
  return r[i * NJ + j] * (1 - a) * (1 - b) + r[(i + 1) * NJ + j] * a * (1 - b) + r[i * NJ + j + 1] * (1 - a) * b + r[(i + 1) * NJ + j + 1] * a * b;
}

// A shell over a grid of surface points: outer skin, inner skin and a rim round the edge. pts(i, j, lift) gives a
// point lifted off the body; paint(i, j) gives the trim masks [edge band, centre stripe].
function shell(NU, NV, pts, th, paint, closedV = false) {
  const outer = [], inner = [], uvs = [], pa = [];
  for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) {
    outer.push(...pts(i, j, th)); inner.push(...pts(i, j, 0));
    // uv measures distance from the plate's edges (a closed helmet only has its lower rim)
    uvs.push(closedV ? 0.5 : j / NV, closedV ? 0.5 + (0.5 * i) / NU : i / NU); pa.push(...paint(i, j));
  }
  const idx = [];
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const a = i * (NV + 1) + j, b = a + 1, c = a + NV + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const mk = (pos, flip) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('paint', new THREE.Float32BufferAttribute(pa, 2));
    g.setIndex(flip ? idx.map((_, k) => idx[k - (k % 3) + 2 - (k % 3)]) : idx);
    g.computeVertexNormals();
    return g;
  };
  let out = mk(outer, false), inn = mk(inner, true);
  // make sure the outer skin faces away from the body: compare its normal with the outer-minus-inner direction
  const n0 = new THREE.Vector3().fromBufferAttribute(out.attributes.normal, Math.floor(outer.length / 6));
  const k = Math.floor(outer.length / 6) * 3;
  const lift = new THREE.Vector3(outer[k] - inner[k], outer[k + 1] - inner[k + 1], outer[k + 2] - inner[k + 2]);
  if (n0.dot(lift) < 0) { out = mk(outer, true); inn = mk(inner, false); }
  // rim: walk the border, joining outer and inner skins with hard-edged quads
  const loop = [];
  if (closedV) for (let j = 0; j <= NV; j++) loop.push([NU, j]);
  else {
    for (let j = 0; j <= NV; j++) loop.push([0, j]);
    for (let i = 1; i <= NU; i++) loop.push([i, NV]);
    for (let j = NV - 1; j >= 0; j--) loop.push([NU, j]);
    for (let i = NU - 1; i >= 1; i--) loop.push([i, 0]);
    loop.push([0, 0]);
  }
  const rp = [], rpa = [];
  const O = (i, j) => outer.slice((i * (NV + 1) + j) * 3, (i * (NV + 1) + j) * 3 + 3), I = (i, j) => inner.slice((i * (NV + 1) + j) * 3, (i * (NV + 1) + j) * 3 + 3);
  for (let k2 = 0; k2 < loop.length - 1; k2++) {
    const [i0, j0] = loop[k2], [i1, j1] = loop[k2 + 1];
    rp.push(...O(i0, j0), ...I(i0, j0), ...O(i1, j1), ...O(i1, j1), ...I(i0, j0), ...I(i1, j1));
    for (let q = 0; q < 6; q++) rpa.push(2, 0);
  }
  const rim = new THREE.BufferGeometry();
  rim.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  rim.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((rp.length / 3) * 2), 2));
  rim.setAttribute('paint', new THREE.Float32BufferAttribute(rpa, 2));
  rim.computeVertexNormals();
  // the rim's winding depends on the loop direction: point its normals away from the plate's middle
  const mid = new THREE.Vector3(); for (let q = 0; q < outer.length; q += 3) mid.x += outer[q], mid.y += outer[q + 1], mid.z += outer[q + 2];
  mid.multiplyScalar(3 / outer.length);
  const rn = new THREE.Vector3().fromBufferAttribute(rim.attributes.normal, 0), rp0 = new THREE.Vector3(rp[0], rp[1], rp[2]);
  if (rn.dot(rp0.sub(mid)) < 0) {
    const pos = rim.attributes.position;
    for (let q = 0; q < pos.count; q += 3) { const x = pos.getX(q + 1), y = pos.getY(q + 1), z = pos.getZ(q + 1); pos.setXYZ(q + 1, pos.getX(q + 2), pos.getY(q + 2), pos.getZ(q + 2)); pos.setXYZ(q + 2, x, y, z); }
    rim.computeVertexNormals();
  }
  return mergeGeometries([out.toNonIndexed(), inn.toNonIndexed(), rim]);
}

// A hard plate over (u, v) in [-1, 1]: a face split into flat facets at the crease lines V (each facet has its own
// vertices, so the creases stay sharp), a chamfer round the edge, a short rim and an inner skin. P(u, v, lift, s) is a
// point lifted off the body, with the plate's outline shrunk to s of its size.
const FACE = 0.94; // the face's share of the plate; the chamfer takes the rest
function plate(NU, NV, P, th, V, paint) {
  const parts = [];
  const centre = new THREE.Vector3(...P(0, 0, 0, 1)), up = new THREE.Vector3(...P(0, 0, th, 1)).sub(centre);
  const build = (pos, uv, pa, idx, want) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('paint', new THREE.Float32BufferAttribute(pa, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // flip the winding when the normals face the wrong way (want(point) is the outward direction there)
    const a = idx[Math.floor(idx.length / 6) * 3];
    const n = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, a), p = new THREE.Vector3().fromBufferAttribute(g.attributes.position, a);
    if (n.dot(want(p)) < 0) { g.setIndex(idx.map((_, q) => idx[q - (q % 3) + 2 - (q % 3)])); g.computeVertexNormals(); }
    parts.push(g.toNonIndexed());
  };
  const grid = (rows, cols, at) => {
    const pos = [], uv = [], pa = [], idx = [];
    for (let i = 0; i <= rows; i++) for (let c = 0; c <= cols; c++) {
      const [u, v, lift, s, puv, ppa] = at(i, c);
      pos.push(...P(u, v, lift, s)); uv.push(...puv); pa.push(...ppa);
    }
    for (let i = 0; i < rows; i++) for (let c = 0; c < cols; c++) { const a = i * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1; idx.push(a, d, b, b, d, e); }
    return [pos, uv, pa, idx];
  };
  // face: one block of vertices per facet
  for (let k = 0; k < V.length - 1; k++) {
    const m = Math.max(2, Math.round((NV * (V[k + 1] - V[k])) / 2));
    const [pos, uv, pa, idx] = grid(NU, m, (i, c) => {
      const u = -1 + (2 * i) / NU, v = V[k] + ((V[k + 1] - V[k]) * c) / m;
      return [u, v, th, FACE, [(v * FACE + 1) / 2, (u * FACE + 1) / 2], paint(u * FACE, v * FACE)];
    });
    build(pos, uv, pa, idx, () => up);
  }
  // the border, walked round the square
  const loop = [];
  for (let j = 0; j <= NV; j++) loop.push([-1, -1 + (2 * j) / NV]);
  for (let i = 1; i <= NU; i++) loop.push([-1 + (2 * i) / NU, 1]);
  for (let j = NV - 1; j >= 0; j--) loop.push([1, -1 + (2 * j) / NV]);
  for (let i = NU - 1; i >= 0; i--) loop.push([-1 + (2 * i) / NU, -1]);
  const ring = (top, bot, pa) => {
    const [pos, uv, paint2, idx] = grid(1, loop.length - 1, (i, c) => { const [u, v] = loop[c], s = i ? top : bot; return [u, v, s[1], s[0], [0, 0], pa]; });
    build(pos, uv, paint2, idx, (p) => p.clone().sub(centre));
  };
  ring([FACE, th], [1, th * 0.45], [0, 0]); // chamfer: face edge down to the outline, bare and worn
  ring([1, th * 0.45], [1, 0], [2, 0]); // rim: outline down to the body side
  // inner skin, facing the body
  const [pos, uv, pa, idx] = grid(NU, NV, (i, c) => [-1 + (2 * i) / NU, -1 + (2 * c) / NV, 0, 1, [0.5, 0.5], [0, 0]]);
  build(pos, uv, pa, idx, () => up.clone().negate());
  return mergeGeometries(parts);
}

function fitPlate(spec, verts, J, fwd) {
  const A = J(spec.a), B = J(spec.b);
  const axis = B.clone().sub(A);
  const len = axis.length();
  axis.normalize();
  const perp = (v) => v.clone().addScaledVector(axis, -v.dot(axis)).normalize();
  const side = new THREE.Vector3().subVectors(A, J('Spine1')).setY(0);
  let ref = fwd.clone();
  if (spec.face === 'back') ref.negate();
  else if (spec.face === 'out') ref = side.clone().normalize().add(new THREE.Vector3(0, 0.35, 0));
  else if (spec.face === 'fwdOut') ref = fwd.clone().add(side.clone().normalize().multiplyScalar(0.55));
  const e1 = perp(ref), e2 = new THREE.Vector3().crossVectors(axis, e1);
  const half = (spec.half * Math.PI) / 180, [t0, t1] = spec.t;
  const NI = 14, NJ = 18;
  const bins = Array.from({ length: NI * NJ }, () => []);
  const on = new Set(spec.on);
  const d = new THREE.Vector3();
  for (const { p, bone } of verts) {
    if (!on.has(bone)) continue;
    d.subVectors(p, A);
    const t = d.dot(axis) / len;
    if (t < t0 - 0.05 || t > t1 + 0.05) continue;
    const rx = d.dot(e1), ry = d.dot(e2), r = Math.hypot(rx, ry), th = Math.atan2(ry, rx);
    if (Math.abs(th) > half * 1.15) continue;
    const i = Math.max(0, Math.min(NI - 1, Math.floor(((t - t0) / (t1 - t0)) * NI)));
    const j = Math.max(0, Math.min(NJ - 1, Math.floor(((th + half) / (2 * half)) * NJ)));
    bins[i * NJ + j].push(r);
  }
  const R = new Float32Array(NI * NJ);
  bins.forEach((b, k) => { if (b.length) { b.sort((x, y) => x - y); R[k] = b[Math.floor((b.length - 1) * 0.86)]; } });
  if (!R.some((x) => x > 0)) return null;
  smoothGrid(R, NI, NJ, 4);
  // flat facets between the crease lines, pushed out just enough that their middles clear the body
  const V = spec.V || [-1, 1];
  let span = 0;
  for (let k = 0; k < V.length - 1; k++) span = Math.max(span, (V[k + 1] - V[k]) * half);
  const grow = 1 / Math.cos(Math.min(1.1, span / 2));
  const surf = (u, v, lift, s) => {
    const rd = spec.round ?? 0.32;
    const th = v * half * s * (1 - rd * Math.abs(u) ** 6);
    const t = (t0 + t1) / 2 + u * s * ((t1 - t0) / 2) * (1 - rd * Math.abs(v) ** 6);
    const r = (bilinear(R, NI, NJ, ((t - t0) / (t1 - t0)) * NI - 0.5, ((th + half) / (2 * half)) * NJ - 0.5) + spec.off) * grow + lift;
    return A.clone().addScaledVector(axis, t * len).addScaledVector(e1, Math.cos(th) * r).addScaledVector(e2, Math.sin(th) * r);
  };
  const P = (u, v, lift, s) => {
    let k = 0;
    while (k < V.length - 2 && v > V[k + 1]) k++;
    const q = surf(u, V[k], lift, s).lerp(surf(u, V[k + 1], lift, s), (v - V[k]) / (V[k + 1] - V[k]));
    return [q.x, q.y, q.z];
  };
  return plate(14, 18, P, spec.th, V, (u, v) => {
    const au = Math.abs(u), av = Math.abs(v);
    return [au > 0.8 || av > 0.86 ? 1 : 0, av < 0.13 ? 1 : 0];
  });
}

// The helmet: a rounded shell the size of the body's own helmet (which the body shader hides above CAP), open at the
// face with cheek guards, a brow over a visor band across the eyes, and a glowing strip in the visor.
export const CAP = 0.092; // the top share of the body's height that the new helmet replaces
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function fitHelmet(verts, fwd) {
  const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  let top = -Infinity, bot = Infinity;
  for (const v of verts) { if (v.p.y > top) top = v.p.y; if (v.p.y < bot) bot = v.p.y; }
  const H = top - bot;
  const cap = verts.filter((v) => v.p.y > top - CAP * H).map((v) => v.p);
  if (cap.length < 30) return null;
  const pct = (arr, q) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.floor((s.length - 1) * q)]; };
  const xs = cap.map((p) => p.dot(right)), zs = cap.map((p) => p.dot(fwd));
  const x0 = pct(xs, 0.02), x1 = pct(xs, 0.98), z0 = pct(zs, 0.02), z1 = pct(zs, 0.8);
  const rx = ((x1 - x0) / 2) * 1.04, rz = ((z1 - z0) / 2) * 1.08, ry = Math.max(rx, rz);
  const C = right.clone().multiplyScalar((x0 + x1) / 2).addScaledVector(fwd, (z0 + z1) / 2 + rz * 0.05).setY(top + 0.006 * H - ry);
  const dirOf = (phi, a) => up.clone().multiplyScalar(Math.cos(phi)).addScaledVector(fwd, Math.sin(phi) * Math.cos(a)).addScaledVector(right, Math.sin(phi) * Math.sin(a));
  const N = 2.6;
  const R = (phi, a) => {
    const d = dirOf(phi, a);
    const x = d.dot(right) / rx, y = d.y / (d.y < 0 ? ry * 1.25 : ry), z = d.dot(fwd) / rz;
    const r = 1 / Math.pow(Math.abs(x) ** N + Math.abs(y) ** N + Math.abs(z) ** N, 1 / N);
    // cheek guards taper in toward the jaw; a low brow ridge rises over the visor
    return r * (1 - 0.14 * Math.max(0, -d.y)) * (1 + 0.05 * smooth(0.6, 1.0, Math.cos(a)) * smooth(1.0, 1.3, phi) * (1 - smooth(1.35, 1.6, phi)));
  };
  const TH = 0.013;
  const point = (phi, a, lift) => C.clone().addScaledVector(dirOf(phi, a), R(phi, a) + lift);
  // the shell's lower edge: high over the brow, low over the cheeks and the nape
  const yBrow = top - 0.05 * H, yEye = top - 0.1 * H, ySide = top - 0.128 * H, yBack = top - 0.136 * H;
  const edgeY = (a) => { const c = Math.abs(a); return c < 1.5 ? yBrow + (ySide - yBrow) * smooth(0.95, 1.45, c) : ySide + (yBack - ySide) * smooth(1.6, 3.0, c); };
  const phiAt = (a, y) => { let lo = 0.05, hi = 2.9; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (point(m, a, 0).y > y) lo = m; else hi = m; } return (lo + hi) / 2; };
  const NU = 14, NV = 48;
  const edge = [];
  for (let j = 0; j <= NV; j++) { const a = -Math.PI + (2 * Math.PI * j) / NV; edge.push(phiAt(a, edgeY(a))); }
  const shellGeo = shell(NU, NV, (i, j, lift) => {
    const a = -Math.PI + (2 * Math.PI * j) / NV, phi = Math.max(0.03, edge[j] * (i / NU));
    const q = point(phi, a, lift); return [q.x, q.y, q.z];
  }, TH, (i, j) => {
    const a = -Math.PI + (2 * Math.PI * j) / NV;
    // a trim stripe runs over the crown from brow to nape, so the helmet reads from behind
    const crown = Math.abs(Math.sin(a) * Math.sin(edge[j] * (i / NU))) < 0.2 && i < NU - 2;
    return [i >= NU - 1 || crown ? 1 : 0, crown ? 1 : 0];
  }, true);
  // visor: from the shell's edge down to below the eyes, slightly recessed under the brow; it closes to nothing
  // where the cheek guards already come lower
  const VA = 1.45, VN = 30, VR = 4;
  const vis = [], vidx = [], strip = [], sidx = [];
  for (let j = 0; j <= VN; j++) {
    const a = -VA + (2 * VA * j) / VN;
    const pe = phiAt(a, edgeY(a)), py = phiAt(a, yEye), p0 = Math.min(pe, py) - 0.03;
    for (let k = 0; k <= VR; k++) { const q = point(p0 + (py - p0) * (k / VR), a, TH * 0.35); vis.push(q.x, q.y, q.z); }
    const mid = p0 + (py - p0) * 0.45, on = py - p0 > 0.12;
    for (const ph of [mid - 0.028, mid + 0.028]) { const q = point(on ? ph : p0, a, TH * 0.45); strip.push(q.x, q.y, q.z); }
  }
  for (let j = 0; j < VN; j++) {
    for (let k = 0; k < VR; k++) { const a = j * (VR + 1) + k, b = a + 1, c = a + VR + 1, d = c + 1; vidx.push(a, c, b, b, c, d); }
    const a = j * 2; sidx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const mkg = (pos, idx) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; };
  let vg = mkg(vis, vidx), sg = mkg(strip, sidx);
  const outward = (g) => {
    const k = Math.floor(g.attributes.position.count / 2);
    const n = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, k), p = new THREE.Vector3().fromBufferAttribute(g.attributes.position, k).sub(C);
    return n.dot(p) > 0;
  };
  const flip = (idx) => idx.map((_, k) => idx[k - (k % 3) + 2 - (k % 3)]);
  if (!outward(vg)) vg = mkg(vis, flip(vidx));
  if (!outward(sg)) sg = mkg(strip, flip(sidx));
  // extras for the helmet styles: a crest from brow to nape, and a spotter's rangefinder on the right temple
  const crest = shell(18, 2, (i, j, lift) => {
    const t = i / 18, front = t < 0.42;
    const phi = front ? Math.max(0.04, edge[NV / 2] * 0.9 * (1 - t / 0.42)) : Math.max(0.04, ((t - 0.42) / 0.58) * edge[0] * 0.92);
    const q = point(phi, front ? 0 : Math.PI, TH + 0.003 + lift + 0.014 * Math.sin(t * Math.PI)).addScaledVector(right, (j - 1) * 0.012);
    return [q.x, q.y, q.z];
  }, 0.008, () => [1, 1]);
  const side = point(edge[Math.round(NV * 0.75)] * 0.62, Math.PI / 2, TH + 0.012);
  // comm pucks over the ears break up the helmet's round outline
  const ears = mergeGeometries([-1, 1].map((sg2) => {
    const a = (sg2 * Math.PI) / 2, ph = phiAt(a, top - 0.078 * H), q = point(ph, a, TH + 0.005);
    return new THREE.CylinderGeometry(0.026, 0.031, 0.016, 18).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirOf(ph, a))).translate(q.x, q.y, q.z);
  }));
  const earCaps = mergeGeometries([-1, 1].map((sg2) => {
    const a = (sg2 * Math.PI) / 2, ph = phiAt(a, top - 0.078 * H), q = point(ph, a, TH + 0.014);
    return new THREE.CylinderGeometry(0.014, 0.014, 0.006, 14).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirOf(ph, a))).translate(q.x, q.y, q.z);
  }));
  return { shell: shellGeo, visor: vg, strip: sg, crest, ears, earCaps, spotterAt: side, centre: C, right, fwd, up };
}

// Fit (or fetch) the armour for this body. model must be posed (the idle at time 0) and its world matrices current.
export function fitBody(key, model, P = 'mixamorig') {
  if (fits.has(key)) return fits.get(key);
  model.updateMatrixWorld(true);
  const verts = sampleBody(model, P);
  const bone = (n) => model.getObjectByName(P + n);
  const J = (n) => bone(n).getWorldPosition(new THREE.Vector3());
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
  const out = { plates: [], helmet: null };
  for (const spec of PLATES) {
    if (!bone(spec.a) || !bone(spec.b) || !bone(spec.at)) continue;
    const g = fitPlate(spec, verts, J, fwd);
    if (!g) continue;
    // into the bone's space, so the plate rides the bone
    g.applyMatrix4(bone(spec.at).matrixWorld.clone().invert());
    out.plates.push({ id: spec.id, at: spec.at, geo: g, cls: !!spec.cls });
  }
  const h = bone('Head') && fitHelmet(verts, fwd);
  if (h) {
    const inv = bone('Head').matrixWorld.clone().invert();
    for (const k of ['shell', 'visor', 'strip', 'crest', 'ears', 'earCaps']) h[k].applyMatrix4(inv);
    // the rangefinder: a small housing and lens on the right side
    const s = h.spotterAt;
    const box = new THREE.BoxGeometry(0.026, 0.03, 0.055).lookAt(h.fwd).translate(s.x, s.y, s.z);
    const eye = new THREE.CylinderGeometry(0.011, 0.013, 0.04, 10).rotateX(Math.PI / 2).lookAt(h.fwd).translate(s.x + h.fwd.x * 0.04, s.y - 0.004, s.z + h.fwd.z * 0.04);
    h.spotter = mergeGeometries([box, eye]).applyMatrix4(inv);
    out.helmet = h;
  }
  fits.set(key, out);
  return out;
}

// ------------------------------------------------------------ materials and dressing
function armourMat(rim) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.42, metalness: 0.08, envMapIntensity: 1.0 });
  m.userData.uniforms = { uArmour: { value: new THREE.Color() }, uTrim: { value: new THREE.Color() }, uPattern: { value: 0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.uniforms, { uRim: rim });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 paint;\nvarying vec2 vPaint;')
      .replace('#include <common>', '#include <common>\nvarying vec2 vArm;\nvarying vec3 vPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaint = paint; vArm = uv; vPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uArmour; uniform vec3 uTrim; uniform float uPattern; uniform vec3 uRim; varying vec2 vPaint; varying vec2 vArm; varying vec3 vPos;
        float ah(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float an(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(ah(i), ah(i + vec3(1,0,0)), f.x), mix(ah(i + vec3(0,1,0)), ah(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(ah(i + vec3(0,0,1)), ah(i + vec3(1,0,1)), f.x), mix(ah(i + vec3(0,1,1)), ah(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float edge = min(vPaint.x, 1.0), rimSide = step(1.5, vPaint.x);
        float tm = uPattern < 0.5 ? edge : (uPattern < 1.5 ? vPaint.y : 0.0);
        diffuseColor.rgb = mix(uArmour, uTrim, tm) * mix(1.0, 0.7, rimSide);
        // panel seams across the plate, a darker chamfer at the edge, grime, and paint worn to metal at edges and rims
        float ed = min(min(vArm.x, 1.0 - vArm.x), min(vArm.y, 1.0 - vArm.y));
        float gn = an(vPos * 90.0) * 0.6 + an(vPos * 260.0) * 0.4;
        float seam = (1.0 - smoothstep(0.008, 0.02, min(abs(vArm.y - 0.36), abs(vArm.y - 0.69)))) * step(0.05, ed) * (1.0 - rimSide);
        float wear = smoothstep(0.62, 0.9, gn * 0.8 + (1.0 - smoothstep(0.0, 0.05, ed)) * 0.5 + rimSide * 0.3);
        diffuseColor.rgb *= (1.0 - seam * 0.75) * (0.9 + 0.16 * gn) * mix(1.0, 0.8, (1.0 - smoothstep(0.012, 0.03, ed)) * (1.0 - rimSide));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.43, 0.45), wear * 0.75);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor + (gn - 0.5) * 0.35 + seam * 0.3 - wear * 0.12, 0.2, 1.0);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = mix(metalnessFactor, 0.85, wear * 0.7);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  float rimF = 1.0 - saturate(dot(normal, normalize(vViewPosition)));\n  totalEmissiveRadiance += uRim * rimF * rimF * rimF;');
  };
  m.customProgramCacheKey = () => 'armour-plate-3';
  return m;
}

// Dress a soldier: plates on their bones, the helmet on the head. Returns a handle to repaint them.
export function dress(model, fit, cls, kit, rim, P = 'mixamorig') {
  const bone = (n) => model.getObjectByName(P + n);
  const main = armourMat(rim), clsMat = armourMat(rim);
  const visorMat = new THREE.MeshStandardMaterial({ color: '#0a0f15', roughness: 0.06, metalness: 0.85, envMapIntensity: 1.6 });
  const stripMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const meshes = [];
  const put = (geo, mat, at) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    bone(at).add(m);
    meshes.push(m);
    return m;
  };
  for (const p of fit.plates) put(p.geo, p.cls ? clsMat : main, p.at);
  let crest = null, spotter = null;
  if (fit.helmet) {
    put(fit.helmet.shell, main, 'Head');
    put(fit.helmet.visor, visorMat, 'Head');
    put(fit.helmet.strip, stripMat, 'Head').castShadow = false;
    crest = put(fit.helmet.crest, main, 'Head');
    const gear = new THREE.MeshStandardMaterial({ color: '#1e2126', roughness: 0.4, metalness: 0.7 });
    spotter = put(fit.helmet.spotter, gear, 'Head');
    put(fit.helmet.ears, main, 'Head');
    put(fit.helmet.earCaps, gear, 'Head');
  }
  const handle = {
    meshes, main, clsMat, visorMat, stripMat,
    paint(k) {
      const c = kitColours(k);
      main.userData.uniforms.uArmour.value.set(c.armour);
      main.userData.uniforms.uTrim.value.set(c.trim);
      main.userData.uniforms.uPattern.value = c.pattern;
      clsMat.userData.uniforms.uArmour.value.set(c.armour);
      clsMat.userData.uniforms.uTrim.value.set(CLASS_TRIM[cls] || c.trim);
      clsMat.userData.uniforms.uPattern.value = 0;
      stripMat.color.set(c.visor).multiplyScalar(2.2);
      if (crest) crest.visible = c.helmet === 1;
      if (spotter) spotter.visible = c.helmet === 2;
      return c;
    },
  };
  handle.paint(kit);
  return handle;
}
