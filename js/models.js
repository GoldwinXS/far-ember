// Ember Squad: low-poly meshes for the board, props and units, plus canvas textures.
import * as THREE from 'three';
import { makeRng, CLASSES } from './data.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const matCache = new Map();
export function mat(color, o = {}) {
  const key = color + (o.map ? o.map.uuid : '') + JSON.stringify({ ...o, map: 0 });
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0, flatShading: !!o.flat,
      emissive: o.glow || '#000000', emissiveIntensity: o.gi ?? 1, transparent: !!o.opacity, opacity: o.opacity ?? 1, map: o.map || null });
    matCache.set(key, m);
  }
  return m;
}
const geoCache = new Map();
function geo(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}
const box = (w, h, d) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt, rb, h, s = 10) => geo(`c${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const sph = (r, w = 12, h = 8) => geo(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));

function mesh(g, m, x = 0, y = 0, z = 0, parent) {
  const me = new THREE.Mesh(g, m);
  me.position.set(x, y, z);
  me.castShadow = true;
  me.receiveShadow = true;
  if (parent) parent.add(me);
  return me;
}

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

// ---------------------------------------------------------------- ground

const GROUND = {
  grass: '#5f7c3f', road: '#3b3d40', pave: '#8c8d86', floor: '#8d6c4a', planks: '#6f5136', concrete: '#7e827d',
  dirt: '#7d6343', field: '#6b5636', alien: '#2c2935', alienglow: '#34303f',
};

export function groundTextures(m) {
  const T = 48;
  const W = m.w * T, H = m.h * T;
  const rng = makeRng(m.w * 31 + m.objects.length);
  const color = canvasTex(W, H, (g) => {
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const k = m.idx(x, y), type = m.ground[k], px = x * T, py = y * T;
      g.fillStyle = GROUND[type];
      g.fillRect(px, py, T, T);
      const speck = (n, cols, s) => {
        for (let i = 0; i < n; i++) { g.fillStyle = rng.pick(cols); g.fillRect(px + rng() * T, py + rng() * T, s, s); }
      };
      if (type === 'grass') {
        speck(26, ['#4f6b33', '#6d8a49', '#56733a', '#7a9550'], 3);
        g.strokeStyle = 'rgba(40,60,25,0.5)';
        for (let i = 0; i < 6; i++) { const bx = px + rng() * T, by = py + rng() * T; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + rng() * 3 - 1.5, by - 4); g.stroke(); }
      } else if (type === 'road') {
        speck(40, ['#34363a', '#414347', '#2f3134'], 2);
        const r = m.road[k];
        g.fillStyle = '#d8b44a';
        if (r === 1 && m.inside(x, y + 1) && m.road[m.idx(x, y + 1)] === 1) for (let i = 0; i < 2; i++) g.fillRect(px + 4 + i * 24, py + T - 2, 14, 4);
        if (r === 2 && m.inside(x + 1, y) && m.road[m.idx(x + 1, y)] === 2) for (let i = 0; i < 2; i++) g.fillRect(px + T - 2, py + 4 + i * 24, 4, 14);
      } else if (type === 'pave') {
        speck(14, ['#83847d', '#979891'], 2);
        g.strokeStyle = 'rgba(60,60,55,0.45)'; g.lineWidth = 1;
        g.strokeRect(px + 0.5, py + 0.5, T / 2, T / 2); g.strokeRect(px + T / 2 + 0.5, py + T / 2 + 0.5, T / 2 - 1, T / 2 - 1);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (m.inside(x + dx, y + dy) && m.ground[m.idx(x + dx, y + dy)] === 'road') {
            g.fillStyle = '#b4b5ad';
            g.fillRect(dx > 0 ? px + T - 4 : px, dy > 0 ? py + T - 4 : py, dx ? 4 : T, dy ? 4 : T);
          }
        }
      } else if (type === 'floor' || type === 'planks') {
        g.strokeStyle = type === 'floor' ? 'rgba(70,45,25,0.55)' : 'rgba(40,25,15,0.6)';
        for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(px, py + i * 12 + 0.5); g.lineTo(px + T, py + i * 12 + 0.5); g.stroke(); }
        speck(8, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.06)'], 3);
      } else if (type === 'concrete') {
        speck(30, ['#767a75', '#868a85', '#737670'], 2);
        if (rng.chance(0.15)) { g.fillStyle = 'rgba(40,40,35,0.18)'; g.beginPath(); g.ellipse(px + rng() * T, py + rng() * T, 10 + rng() * 10, 6 + rng() * 8, rng() * 3, 0, 7); g.fill(); }
        if (x % 2 === 0) { g.fillStyle = 'rgba(50,52,50,0.5)'; g.fillRect(px, py, 1, T); }
        if (y % 2 === 0) { g.fillStyle = 'rgba(50,52,50,0.5)'; g.fillRect(px, py, T, 1); }
      } else if (type === 'dirt') {
        speck(30, ['#6f5639', '#8a7050', '#655033', '#9a8264'], 3);
      } else if (type === 'field') {
        for (let i = 0; i < 4; i++) {
          g.fillStyle = '#5b4a2e'; g.fillRect(px + i * 12 + 1, py, 4, T);
          g.fillStyle = '#7d9a45';
          for (let j = 0; j < 6; j++) g.fillRect(px + i * 12 + 6 + rng() * 2, py + j * 8 + rng() * 3, 4, 5);
        }
      } else if (type === 'alien' || type === 'alienglow') {
        speck(30, ['#26232e', '#332f3d', '#2a2633'], 3);
      }
    }
    // board grid
    g.strokeStyle = 'rgba(0,0,0,0.2)';
    g.lineWidth = 1;
    for (let x = 0; x <= m.w; x++) { g.beginPath(); g.moveTo(x * T + 0.5, 0); g.lineTo(x * T + 0.5, H); g.stroke(); }
    for (let y = 0; y <= m.h; y++) { g.beginPath(); g.moveTo(0, y * T + 0.5); g.lineTo(W, y * T + 0.5); g.stroke(); }
    for (const d of m.decor) if (d.type === 'paint') { g.fillStyle = 'rgba(220,180,60,0.7)'; g.fillRect(0, d.y * T + T / 2 - 2, W, 3); }
  });
  let glow = null;
  if (m.biome === 'spire') {
    glow = canvasTex(W, H, (g) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#4fdde8'; g.lineCap = 'round';
      const vr = makeRng(5);
      for (let i = 0; i < 26; i++) {
        let x = vr() * W, y = vr() * H;
        g.lineWidth = 1 + vr() * 2.5;
        g.globalAlpha = 0.35 + vr() * 0.4;
        g.beginPath(); g.moveTo(x, y);
        for (let s = 0; s < 8; s++) { x += (vr() - 0.5) * 70; y += (vr() - 0.5) * 70; g.lineTo(x, y); }
        g.stroke();
      }
      g.globalAlpha = 1;
      const cx = (m.w / 2) * T, cy = 5 * T;
      const rg = g.createRadialGradient(cx, cy, 10, cx, cy, 4.5 * T);
      rg.addColorStop(0, 'rgba(110,235,245,0.55)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
    });
  }
  return { color, glow, base: GROUND[m.ground[m.idx(0, 0)]] };
}

// ---------------------------------------------------------------- props

const texCache = new Map();
function wallTex(style) {
  if (texCache.has(style)) return texCache.get(style);
  const t = canvasTex(64, 128, (g, w, h) => {
    const base = { brick: '#8c4a36', plaster: '#c8b796', blue: '#5f7a8e', barn: '#8b2e25', shed: '#86847a', metal: '#6c787f' }[style] || '#888';
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    if (style === 'brick') {
      g.fillStyle = 'rgba(40,20,12,0.45)';
      for (let y = 0; y < h; y += 8) { g.fillRect(0, y, w, 1); for (let x = (y / 8) % 2 ? 0 : 8; x < w; x += 16) g.fillRect(x, y, 1, 8); }
    } else if (style === 'blue' || style === 'barn') {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let y = 0; y < h; y += 10) g.fillRect(0, y, w, 2);
      if (style === 'barn') { g.fillStyle = 'rgba(255,255,255,0.08)'; for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 2, h); }
    } else if (style === 'metal') {
      for (let x = 0; x < w; x += 8) { g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, 0, 3, h); g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x + 4, 0, 2, h); }
    } else {
      const r = makeRng(3);
      for (let i = 0; i < 90; i++) { g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'; g.fillRect(r() * w, r() * h, 3, 3); }
    }
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, h - 6, w, 6);
  });
  texCache.set(style, t);
  return t;
}
function stripeTex() {
  if (texCache.has('stripe')) return texCache.get('stripe');
  const t = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, 0, 3, h); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x + 4, 0, 1, h); }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
  }, true);
  texCache.set('stripe', t);
  return t;
}
function woodTex() {
  if (texCache.has('wood')) return texCache.get('wood');
  const t = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#a07a4a'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(60,35,15,0.5)';
    for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 2);
    g.strokeStyle = '#5c3f22'; g.lineWidth = 5; g.strokeRect(2, 2, w - 4, h - 4);
    g.beginPath(); g.moveTo(4, 4); g.lineTo(w - 4, h - 4); g.stroke();
  });
  texCache.set('wood', t);
  return t;
}

const WALL_H = 1.9;
const CAR_COLS = ['#9b2f2a', '#2f5d8c', '#d6d2c6', '#3d6b45', '#c9a23a', '#4a4a50'];
const BOX_COLS = ['#a33b2c', '#2f5f8a', '#3f7a4a', '#c27c2c', '#767c84'];

export function buildObject(o, rng) {
  const g = new THREE.Group();
  let cx = 0, cz = 0;
  for (const [x, y] of o.tiles) { cx += x; cz += y; }
  cx /= o.tiles.length; cz /= o.tiles.length;
  g.position.set(cx, 0, cz);
  const along = o.axis === 'y';
  switch (o.type) {
    case 'wall': {
      const wm = mat('#ffffff', { map: wallTex(o.style), rough: 0.9 });
      mesh(box(1, WALL_H, 1), wm, 0, WALL_H / 2, 0, g);
      mesh(box(1.02, 0.08, 1.02), mat('#3b3530'), 0, WALL_H + 0.04, 0, g);
      break;
    }
    case 'window': {
      const wm = mat('#ffffff', { map: wallTex(o.style), rough: 0.9 });
      mesh(box(1, 0.8, 1), wm, 0, 0.4, 0, g);
      mesh(box(1, 0.4, 1), wm, 0, WALL_H - 0.2, 0, g);
      mesh(box(1.02, 0.08, 1.02), mat('#3b3530'), 0, WALL_H + 0.04, 0, g);
      mesh(box(1.04, 0.06, 1.04), mat('#d8d2c2'), 0, 0.83, 0, g);
      const glass = mesh(box(along ? 0.04 : 1, 0.9, along ? 1 : 0.04), mat('#9fc3d6', { opacity: 0.22, rough: 0.1 }), 0, 1.25, 0, g);
      glass.castShadow = false;
      break;
    }
    case 'crate': {
      const s = o.style === 'indoor' ? 0.7 : 0.82;
      const c = mesh(box(s, s, s), mat('#ffffff', { map: woodTex() }), 0, s / 2, 0, g);
      c.rotation.y = (rng() - 0.5) * 0.4;
      if (rng() < 0.3) { const t = mesh(box(0.5, 0.5, 0.5), mat('#ffffff', { map: woodTex() }), 0.05, s + 0.25, 0.02, g); t.rotation.y = rng() * 1.5; }
      break;
    }
    case 'lowwall': {
      const m2 = o.stone ? mat('#8d8a80', { flat: true }) : mat('#ffffff', { map: wallTex('brick'), rough: 0.9 });
      mesh(box(along ? 0.42 : 1, 0.78, along ? 1 : 0.42), m2, 0, 0.39, 0, g);
      mesh(box(along ? 0.5 : 1.02, 0.07, along ? 1.02 : 0.5), mat('#6f6a60'), 0, 0.81, 0, g);
      break;
    }
    case 'hedge': {
      mesh(box(along ? 0.6 : 1, 0.9, along ? 1 : 0.6), mat('#3f5f2a', { flat: true }), 0, 0.45, 0, g);
      mesh(box(along ? 0.5 : 0.9, 0.2, along ? 0.9 : 0.5), mat('#4d7034', { flat: true }), 0, 0.95, 0, g);
      break;
    }
    case 'fence': {
      const wood = mat('#7a5a3a');
      for (const s of [-0.45, 0.45]) mesh(box(0.1, 0.9, 0.1), wood, along ? 0 : s, 0.45, along ? s : 0, g);
      for (const h of [0.35, 0.7]) mesh(box(along ? 0.06 : 1, 0.1, along ? 1 : 0.06), wood, 0, h, 0, g);
      break;
    }
    case 'car': case 'tractor': {
      const inner = new THREE.Group();
      g.add(inner);
      if (o.axis === 'x') inner.rotation.y = Math.PI / 2;
      if (o.type === 'car') {
        const body = mat(CAR_COLS[o.color % CAR_COLS.length], { rough: 0.45, metal: 0.3 });
        mesh(box(0.92, 0.42, 1.9), body, 0, 0.38, 0, inner);
        mesh(box(0.8, 0.36, 1.0), mat('#1e262e', { rough: 0.2 }), 0, 0.77, -0.1, inner);
        mesh(box(0.82, 0.05, 0.96), body, 0, 0.97, -0.1, inner);
        for (const [x, z] of [[-0.44, 0.6], [0.44, 0.6], [-0.44, -0.62], [0.44, -0.62]]) {
          const w = mesh(cyl(0.18, 0.18, 0.14, 12), mat('#161616'), x, 0.18, z, inner);
          w.rotation.z = Math.PI / 2;
        }
        for (const x of [-0.3, 0.3]) mesh(box(0.18, 0.08, 0.04), mat('#f4ecd0', { glow: '#6b6248' }), x, 0.45, 0.96, inner);
      } else {
        const body = mat('#4c7a34', { rough: 0.6 });
        mesh(box(0.7, 0.55, 1.5), body, 0, 0.6, 0.15, inner);
        mesh(box(0.72, 0.7, 0.62), mat('#2a3a26', { rough: 0.3 }), 0, 1.15, -0.35, inner);
        for (const x of [-0.45, 0.45]) {
          const w = mesh(cyl(0.42, 0.42, 0.26, 14), mat('#171717'), x, 0.42, -0.4, inner); w.rotation.z = Math.PI / 2;
          const f = mesh(cyl(0.24, 0.24, 0.18, 12), mat('#171717'), x * 0.9, 0.24, 0.6, inner); f.rotation.z = Math.PI / 2;
        }
        mesh(cyl(0.04, 0.04, 0.6), mat('#333'), 0.2, 1.1, 0.5, inner);
      }
      break;
    }
    case 'barrel': {
      mesh(cyl(0.28, 0.28, 0.85, 14), mat('#a8322a', { rough: 0.5 }), 0, 0.425, 0, g);
      for (const h of [0.22, 0.62]) mesh(cyl(0.29, 0.29, 0.05, 14), mat('#2a2a2a'), 0, h, 0, g);
      mesh(cyl(0.2, 0.2, 0.02, 14), mat('#e2c142', { glow: '#3a2e05' }), 0, 0.86, 0, g);
      break;
    }
    case 'tree': {
      const s = 0.85 + rng() * 0.35;
      g.scale.setScalar(s);
      mesh(cyl(0.09, 0.14, 1.9, 7), mat('#5b4330'), 0, 0.95, 0, g);
      if (o.kind === 1) {
        for (let i = 0; i < 3; i++) mesh(geo('cone' + i, () => new THREE.ConeGeometry(0.75 - i * 0.18, 1.0, 7)), mat('#2f5a34', { flat: true }), 0, 1.7 + i * 0.55, 0, g);
      } else {
        const greens = ['#4f7a32', '#5d8a3a', '#46702c', '#6b9443'];
        for (let i = 0; i < 3; i++) {
          const r = 0.5 + rng() * 0.3;
          mesh(geo('ico' + Math.round(r * 10), () => new THREE.IcosahedronGeometry(Math.round(r * 10) / 10, 0)), mat(greens[(i + o.kind) % 4], { flat: true }),
            (rng() - 0.5) * 0.6, 2.0 + rng() * 0.6, (rng() - 0.5) * 0.6, g).rotation.set(rng() * 3, rng() * 3, 0);
        }
      }
      break;
    }
    case 'rock': {
      const r = mesh(geo('rock', () => new THREE.DodecahedronGeometry(0.46, 0)), mat('#7c7a74', { flat: true }), 0, 0.3, 0, g);
      r.scale.set(1, 0.75, 0.9 + rng() * 0.2);
      r.rotation.set(rng(), rng() * 3, rng());
      break;
    }
    case 'hay': {
      const h = mesh(cyl(0.42, 0.42, 0.8, 14), mat('#cfae5a', { rough: 1 }), 0, 0.42, 0, g);
      h.rotation.z = Math.PI / 2;
      h.rotation.y = rng() * 3;
      break;
    }
    case 'container': {
      const len = o.tiles.length;
      const t = stripeTex().clone();
      t.needsUpdate = true;
      t.repeat.set(len, 1);
      const m2 = new THREE.MeshStandardMaterial({ color: BOX_COLS[o.color % BOX_COLS.length], map: t, roughness: 0.7, metalness: 0.2 });
      mesh(box(along ? 0.98 : len - 0.04, 2.3, along ? len - 0.04 : 0.98), m2, 0, 1.15, 0, g);
      break;
    }
    case 'barrier': {
      const c = mat('#b9b7ae');
      mesh(box(along ? 0.5 : 1, 0.32, along ? 1 : 0.5), c, 0, 0.16, 0, g);
      mesh(box(along ? 0.28 : 1, 0.45, along ? 1 : 0.28), c, 0, 0.54, 0, g);
      mesh(box(along ? 0.3 : 1.01, 0.08, along ? 1.01 : 0.3), mat('#c9452f'), 0, 0.5, 0, g);
      break;
    }
    case 'pillar': {
      const p = mesh(cyl(0.34, 0.46, 2.6, 6), mat('#c9d2da', { rough: 0.35, glow: '#1f5a66', gi: 0.6, flat: true }), 0, 1.3, 0, g);
      p.rotation.y = rng() * 2;
      p.rotation.z = (rng() - 0.5) * 0.12;
      mesh(geo('pcap', () => new THREE.OctahedronGeometry(0.22, 0)), mat('#9ff6ff', { glow: '#59e6f2', gi: 1.4 }), 0, 2.8, 0, g);
      break;
    }
    case 'shard': {
      for (let i = 0; i < 3; i++) {
        const s = mesh(geo('oct' + i, () => new THREE.OctahedronGeometry(0.22 + i * 0.07, 0)), mat('#d7d0e6', { rough: 0.3, glow: '#204a58', gi: 0.7, flat: true }),
          (rng() - 0.5) * 0.4, 0.3 + i * 0.12, (rng() - 0.5) * 0.4, g);
        s.scale.y = 1.6;
        s.rotation.set((rng() - 0.5) * 0.6, rng() * 3, (rng() - 0.5) * 0.6);
      }
      break;
    }
    case 'spire': {
      mesh(cyl(0.7, 1.35, 7.5, 6), mat('#cfd6de', { rough: 0.3, glow: '#245f6b', gi: 0.8, flat: true }), 0, 3.75, 0, g);
      mesh(cyl(0.25, 0.25, 7.6, 6), mat('#8ef5ff', { glow: '#6ff0ff', gi: 2 }), 0, 3.8, 0, g);
      const top = mesh(geo('spiretop', () => new THREE.OctahedronGeometry(0.9, 0)), mat('#e6fbff', { glow: '#7ff4ff', gi: 1.5 }), 0, 8.6, 0, g);
      top.userData.spin = 0.6;
      break;
    }
  }
  return g;
}

export function buildLintel(d) {
  const g = new THREE.Group();
  g.position.set(d.x, 0, d.y);
  const wm = mat('#ffffff', { map: wallTex(d.style), rough: 0.9 });
  mesh(box(1, 0.35, 1), wm, 0, WALL_H - 0.175, 0, g);
  mesh(box(1.02, 0.08, 1.02), mat('#3b3530'), 0, WALL_H + 0.04, 0, g);
  return g;
}

export function buildOutside(d, biome) {
  const g = new THREE.Group();
  g.position.set(d.x, 0, d.y);
  g.scale.setScalar(d.s);
  g.rotation.y = d.k * 6;
  const k = d.k;
  if (biome === 'town' && k < 0.35) {
    const cols = ['#b8a88a', '#8c4a36', '#6d8291', '#c9c2b0'];
    mesh(box(3, 2.2, 2.6), mat(cols[Math.floor(k * 11) % 4]), 0, 1.1, 0, g);
    const roof = mesh(geo('roof', () => new THREE.ConeGeometry(2.3, 1.3, 4)), mat('#4a3c36', { flat: true }), 0, 2.85, 0, g);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1, 1, 0.85);
  } else if (biome === 'yard' && k < 0.6) {
    const n = 1 + Math.floor(k * 4) % 3;
    for (let i = 0; i < n; i++) mesh(box(1, 1.15, 3), mat(BOX_COLS[(Math.floor(k * 50) + i) % 5], { rough: 0.7 }), 0, 0.58 + i * 1.16, 0, g).rotation.y = i * 0.05;
  } else if (biome === 'spire') {
    const p = mesh(cyl(0.3, 0.6, 2 + k * 4, 6), mat('#bcc5ce', { rough: 0.4, glow: '#1d4b55', gi: 0.5, flat: true }), 0, 1 + k * 2, 0, g);
    p.rotation.z = (k - 0.5) * 0.4;
  } else if (biome === 'farm' && k > 0.8) {
    const h = mesh(cyl(0.42, 0.42, 0.8, 12), mat('#cfae5a'), 0, 0.42, 0, g);
    h.rotation.z = Math.PI / 2;
  } else {
    mesh(cyl(0.1, 0.15, 1.6, 6), mat('#5b4330'), 0, 0.8, 0, g);
    const pine = k > 0.6;
    if (pine) for (let i = 0; i < 3; i++) mesh(geo('cone' + i, () => new THREE.ConeGeometry(0.75 - i * 0.18, 1.0, 7)), mat('#2f5a34', { flat: true }), 0, 1.5 + i * 0.55, 0, g);
    else mesh(geo('ico7', () => new THREE.IcosahedronGeometry(0.7, 0)), mat('#4f7a32', { flat: true }), 0, 2.0, 0, g);
  }
  return g;
}

// ---------------------------------------------------------------- units

const PALE = '#cfd4d8', PALE_DARK = '#4b505a';
const GLOW = { husk: '#69ecf7', drone: '#69ecf7', stalker: '#ff5f6d', warden: '#b58cff', brute: '#ff9a3c', overseer: '#9ff6ff' };

function limb(parent, w, h, d, m, x, y, z) {
  // pivot at the top so limbs swing from the hip/shoulder
  const p = new THREE.Group();
  p.position.set(x, y, z);
  parent.add(p);
  mesh(box(w, h, d), m, 0, -h / 2, 0, p);
  return p;
}

export function buildUnit(u) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const muzzle = new THREE.Object3D();
  const rig = { root, body, muzzle, legs: [], arms: [], spin: [], height: 1.6, glowMats: [] };
  if (u.side === 'ember') {
    const cls = CLASSES[u.kind];
    const accent = mat(cls.color, { rough: 0.6 });
    const armour = mat('#3d4a3f', { rough: 0.7 });
    const cloth = mat('#2d332e');
    const dark = mat('#22262a', { rough: 0.5 });
    rig.legs.push(limb(body, 0.17, 0.62, 0.2, cloth, -0.11, 0.66, 0), limb(body, 0.17, 0.62, 0.2, cloth, 0.11, 0.66, 0));
    for (const l of rig.legs) mesh(box(0.19, 0.1, 0.27), dark, 0, -0.6, 0.04, l);
    mesh(box(0.46, 0.5, 0.3), armour, 0, 0.92, 0, body);
    mesh(box(0.36, 0.3, 0.06), accent, 0, 0.98, 0.16, body);
    for (const s of [-0.28, 0.28]) mesh(box(0.16, 0.12, 0.3), accent, s, 1.14, 0, body);
    mesh(box(0.34, 0.4, 0.18), mat('#454a3c'), 0, 0.95, -0.22, body);
    mesh(sph(0.14), mat(u.skin || '#e0ac7e'), 0, 1.33, 0.01, body);
    const helm = mesh(geo('helm', () => new THREE.SphereGeometry(0.165, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55)), mat('#2c322d', { rough: 0.6 }), 0, 1.36, -0.01, body);
    helm.scale.set(1, 0.95, 1.08);
    mesh(box(0.22, 0.05, 0.05), mat('#1a1d1f', { rough: 0.2, glow: cls.color, gi: 0.25 }), 0, 1.37, 0.15, body);
    const armR = limb(body, 0.13, 0.5, 0.14, armour, 0.3, 1.12, 0);
    const armL = limb(body, 0.13, 0.5, 0.14, armour, -0.3, 1.12, 0);
    armR.rotation.x = -1.1; armL.rotation.x = -1.2; armL.rotation.z = -0.5;
    rig.arms.push(armR, armL);
    const gun = new THREE.Group();
    gun.position.set(0.14, 0.98, 0.3);
    body.add(gun);
    const gm = mat('#1c1f22', { rough: 0.4, metal: 0.4 });
    const spec = { rifle: [0.07, 0.1, 0.7], shotgun: [0.09, 0.11, 0.6], mg: [0.12, 0.15, 0.85], longrifle: [0.06, 0.08, 1.05] }[cls.weapon];
    mesh(box(spec[0], spec[1], spec[2]), gm, 0, 0, spec[2] / 2 - 0.15, gun);
    if (cls.weapon === 'mg') mesh(box(0.1, 0.16, 0.16), accent, 0, -0.12, 0.15, gun);
    if (cls.weapon === 'longrifle') mesh(cyl(0.035, 0.035, 0.3, 8), gm, 0, 0.08, 0.2, gun).rotation.x = Math.PI / 2;
    if (cls.weapon === 'shotgun') mesh(box(0.08, 0.06, 0.25), mat('#5b4330'), 0, -0.06, 0.2, gun);
    muzzle.position.set(0, 0, spec[2] - 0.15);
    gun.add(muzzle);
    rig.height = 1.55;
  } else {
    const glow = GLOW[u.kind];
    const gmat = new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 1.6, roughness: 0.3 });
    rig.glowMats.push(gmat);
    const pale = mat(PALE, { rough: 0.45 });
    const dark = mat(PALE_DARK, { rough: 0.5 });
    if (u.kind === 'husk') {
      rig.legs.push(limb(body, 0.12, 0.8, 0.14, dark, -0.1, 0.82, 0), limb(body, 0.12, 0.8, 0.14, dark, 0.1, 0.82, 0));
      mesh(geo('huskT', () => new THREE.CapsuleGeometry(0.19, 0.42, 4, 8)), pale, 0, 1.12, 0, body);
      const head = mesh(sph(0.15), pale, 0, 1.6, 0.03, body);
      head.scale.set(0.85, 1.35, 1.05);
      mesh(box(0.2, 0.05, 0.06), gmat, 0, 1.62, 0.15, body);
      const armR = limb(body, 0.08, 0.6, 0.08, dark, 0.24, 1.36, 0);
      armR.rotation.x = -1.2;
      rig.arms.push(armR);
      const gun = new THREE.Group(); gun.position.set(0.24, 1.08, 0.36); body.add(gun);
      mesh(box(0.08, 0.1, 0.6), dark, 0, 0, 0.1, gun);
      mesh(box(0.05, 0.05, 0.2), gmat, 0, 0.03, 0.35, gun);
      muzzle.position.set(0, 0, 0.42); gun.add(muzzle);
      rig.height = 1.85;
    } else if (u.kind === 'drone') {
      // military quadcopter taken over by the Pale: matte hull, panel lines, a sensor ball with one eye,
      // four arms to motor pods with two-blade props, skids, and a cyan seam where the Pale got in
      const hullM = new THREE.MeshStandardMaterial({ color: '#40464c', metalness: 0.6, roughness: 0.45 });
      const darkM = new THREE.MeshStandardMaterial({ color: '#1e2226', metalness: 0.5, roughness: 0.55 });
      const bladeM = new THREE.MeshStandardMaterial({ color: '#15181b', metalness: 0.2, roughness: 0.6 });
      const blurM = new THREE.MeshBasicMaterial({ color: '#2a2f34', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
      const seam = new THREE.MeshStandardMaterial({ color: '#7ff4ff', emissive: '#59e6f2', emissiveIntensity: 1.4, roughness: 0.3 });
      rig.glowMats.push(seam);
      const Y = 1.25;
      mesh(geo('dhull3', () => new RoundedBoxGeometry(0.34, 0.11, 0.46, 3, 0.04)), hullM, 0, Y, 0, body);
      mesh(geo('dtop3', () => new RoundedBoxGeometry(0.22, 0.06, 0.28, 3, 0.03)), hullM, 0, Y + 0.075, -0.02, body);
      // panel lines and the seam
      for (const z of [-0.12, 0.08]) mesh(box(0.345, 0.006, 0.006), darkM, 0, Y + 0.03, z, body);
      mesh(box(0.006, 0.006, 0.4), darkM, 0, Y + 0.058, 0, body);
      for (const sx of [-1, 1]) mesh(box(0.004, 0.012, 0.3), seam, sx * 0.172, Y, 0.02, body);
      // sensor ball under the nose, one glowing eye
      mesh(box(0.05, 0.05, 0.05), darkM, 0, Y - 0.08, 0.14, body);
      mesh(sph(0.065, 16, 12), darkM, 0, Y - 0.13, 0.15, body);
      const eye = mesh(sph(0.03, 14, 10), seam, 0, Y - 0.13, 0.205, body);
      eye.scale.set(1, 1, 0.5);
      mesh(box(0.012, 0.012, 0.16), darkM, 0, Y + 0.12, -0.12, body).rotation.x = -0.5;
      // skids
      for (const sx of [-1, 1]) {
        mesh(geo('dskid', () => new THREE.CylinderGeometry(0.008, 0.008, 0.44, 8).rotateX(Math.PI / 2)), darkM, sx * 0.13, Y - 0.16, 0, body);
        for (const z of [-0.12, 0.12]) mesh(geo('dstrut', () => new THREE.CylinderGeometry(0.007, 0.007, 0.12, 6)), darkM, sx * 0.12, Y - 0.1, z, body).rotation.z = sx * 0.2;
      }
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const ang = Math.atan2(sx, sz);
        const arm = mesh(geo('darm3', () => new RoundedBoxGeometry(0.045, 0.03, 0.3, 2, 0.012)), hullM, sx * 0.19, Y + 0.01, sz * 0.24, body);
        arm.rotation.y = ang;
        const px = sx * 0.32, pz = sz * 0.38;
        mesh(geo('dmotor', () => new THREE.CylinderGeometry(0.035, 0.04, 0.06, 16)), darkM, px, Y + 0.03, pz, body);
        mesh(geo('dled', () => new THREE.SphereGeometry(0.012, 8, 6)), seam, px, Y + 0.005, pz + sz * 0.035, body);
        const prop = new THREE.Group();
        prop.position.set(px, Y + 0.07, pz);
        body.add(prop);
        for (const r of [0, Math.PI]) {
          const blade = mesh(geo('dblade', () => new THREE.BoxGeometry(0.14, 0.004, 0.022).translate(0.07, 0, 0)), bladeM, 0, 0, 0, prop);
          blade.rotation.set(r ? -0.12 : 0.12, r, 0);
        }
        mesh(geo('dhub', () => new THREE.CylinderGeometry(0.012, 0.012, 0.02, 8)), darkM, 0, 0, 0, prop);
        mesh(geo('dblur', () => new THREE.CircleGeometry(0.15, 28).rotateX(-Math.PI / 2)), blurM, px, Y + 0.072, pz, body).castShadow = false;
        rig.spin.push([prop, 'y', 38 * (sx * sz > 0 ? 1 : -1)]);
      }
      mesh(box(0.02, 0.02, 0.14), darkM, 0, Y - 0.06, 0.2, body);
      muzzle.position.set(0, Y - 0.06, 0.28); body.add(muzzle);
      rig.hover = true;
      rig.height = 1.62;
    } else if (u.kind === 'stalker') {
      mesh(box(0.42, 0.34, 0.95), pale, 0, 0.72, 0, body).rotation.x = -0.15;
      mesh(box(0.46, 0.14, 0.5), dark, 0, 0.92, -0.1, body);
      const head = mesh(box(0.28, 0.24, 0.36), pale, 0, 0.88, 0.58, body);
      head.rotation.x = 0.2;
      for (const s of [-0.07, 0.07]) mesh(sph(0.035, 6, 4), gmat, s, 0.92, 0.77, body);
      for (const [x, z] of [[-0.2, 0.32], [0.2, 0.32], [-0.2, -0.32], [0.2, -0.32]]) {
        const l = limb(body, 0.08, 0.66, 0.08, dark, x, 0.66, z);
        l.rotation.z = x < 0 ? 0.25 : -0.25;
        rig.legs.push(l);
      }
      muzzle.position.set(0, 0.8, 0.8); body.add(muzzle);
      rig.height = 1.25;
    } else if (u.kind === 'warden') {
      mesh(geo('robe', () => new THREE.ConeGeometry(0.42, 1.35, 8)), pale, 0, 0.68, 0, body);
      mesh(sph(0.17), pale, 0, 1.5, 0, body).scale.set(0.9, 1.2, 0.9);
      mesh(box(0.18, 0.04, 0.05), gmat, 0, 1.52, 0.14, body);
      const halo = mesh(geo('halo', () => new THREE.TorusGeometry(0.28, 0.035, 6, 24)), gmat, 0, 1.92, 0, body);
      halo.rotation.x = Math.PI / 2;
      rig.spin.push([halo, 'z', 1.4]);
      mesh(cyl(0.025, 0.025, 1.8, 6), dark, 0.36, 0.95, 0.12, body);
      mesh(geo('oct0w', () => new THREE.OctahedronGeometry(0.1, 0)), gmat, 0.36, 1.92, 0.12, body);
      muzzle.position.set(0.36, 1.92, 0.12); body.add(muzzle);
      rig.height = 2.0;
    } else if (u.kind === 'brute') {
      rig.legs.push(limb(body, 0.26, 0.8, 0.3, dark, -0.22, 0.82, 0), limb(body, 0.26, 0.8, 0.3, dark, 0.22, 0.82, 0));
      mesh(box(0.86, 0.78, 0.56), pale, 0, 1.25, 0, body);
      mesh(box(0.3, 0.3, 0.06), gmat, 0, 1.3, 0.29, body);
      mesh(box(0.92, 0.18, 0.6), dark, 0, 1.68, -0.02, body);
      mesh(sph(0.16), pale, 0, 1.82, 0.08, body);
      const armR = limb(body, 0.26, 0.75, 0.26, pale, 0.58, 1.55, 0);
      const armL = limb(body, 0.26, 0.75, 0.26, pale, -0.58, 1.55, 0);
      armR.rotation.x = -0.9; armL.rotation.x = -0.4;
      rig.arms.push(armR, armL);
      const gun = new THREE.Group(); gun.position.set(0.58, 1.05, 0.5); body.add(gun);
      mesh(box(0.22, 0.22, 0.75), dark, 0, 0, 0.1, gun);
      mesh(cyl(0.07, 0.07, 0.1, 8), gmat, 0, 0, 0.5, gun).rotation.x = Math.PI / 2;
      muzzle.position.set(0, 0, 0.55); gun.add(muzzle);
      rig.height = 2.05;
    } else if (u.kind === 'overseer') {
      const shellM = new THREE.MeshPhysicalMaterial({ color: '#aeb4ba', metalness: 0.1, roughness: 0.4, clearcoat: 0.4, clearcoatRoughness: 0.3 });
      const plateM = new THREE.MeshStandardMaterial({ color: '#4a5159', metalness: 0.7, roughness: 0.35 });
      const coreM = new THREE.MeshStandardMaterial({ color: '#9ff6ff', emissive: '#59e6f2', emissiveIntensity: 0.9, roughness: 0.2 });
      rig.glowMats.push(coreM);
      const crystal = mesh(geo('ovc', () => new THREE.OctahedronGeometry(0.62, 0)), shellM, 0, 2.1, 0, body);
      crystal.scale.set(1, 1.55, 1);
      rig.spin.push([crystal, 'y', 0.35]);
      mesh(sph(0.2, 16, 12), coreM, 0, 2.1, 0.3, body);
      for (let i = 0; i < 4; i++) {
        const piv = new THREE.Group(); piv.position.y = 2.1; body.add(piv);
        piv.rotation.y = (i * Math.PI) / 2;
        const p2 = mesh(box(0.18, 0.9, 0.06), plateM, 0.95, 0, 0, piv);
        p2.rotation.z = 0.25;
        mesh(box(0.03, 0.6, 0.07), coreM, 0.95, 0, 0.0, piv).rotation.z = 0.25;
        rig.spin.push([piv, 'y', 0.6]);
      }
      const ring = mesh(geo('ovr', () => new THREE.TorusGeometry(0.9, 0.035, 8, 40)), coreM, 0, 0.12, 0, body);
      ring.rotation.x = Math.PI / 2;
      muzzle.position.set(0, 2.1, 0.5); body.add(muzzle);
      rig.hover = true;
      rig.height = 3.2;
    }
  }
  const hit = new THREE.Mesh(cyl(0.42, 0.42, rig.height, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = rig.height / 2;
  root.add(hit);
  rig.hit = hit;
  return rig;
}

// Animate a rig each frame. moving: walking now. t: seconds.
export function tickRig(rig, t, moving, phase) {
  const s = t * 11 + phase;
  rig.legs.forEach((l, i) => { l.rotation.x = moving ? Math.sin(s + (i % 2) * Math.PI) * 0.55 : l.rotation.x * 0.8; });
  if (rig.hover) rig.body.position.y = Math.sin(t * 2 + phase) * 0.08;
  else rig.body.position.y = moving ? Math.abs(Math.sin(s)) * 0.05 : Math.sin(t * 1.5 + phase) * 0.008;
  for (const [o, axis, speed] of rig.spin) o.rotation[axis] += speed * 0.016;
}

// Small round glow sprite texture for flashes and sparks.
let glowTexture = null;
export function glowTex() {
  if (glowTexture) return glowTexture;
  glowTexture = canvasTex(64, 64, (g) => {
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.3, 'rgba(255,255,255,0.6)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  });
  return glowTexture;
}

export function shieldTex(full) {
  const key = 'shield' + full;
  if (texCache.has(key)) return texCache.get(key);
  const t = canvasTex(64, 64, (g) => {
    const path = () => { g.beginPath(); g.moveTo(32, 5); g.lineTo(55, 13); g.lineTo(53, 34); g.quadraticCurveTo(48, 50, 32, 59); g.quadraticCurveTo(16, 50, 11, 34); g.lineTo(9, 13); g.closePath(); };
    g.lineWidth = 5; g.strokeStyle = 'rgba(10,20,30,0.85)'; path(); g.stroke();
    g.fillStyle = 'rgba(20,40,60,0.55)'; path(); g.fill();
    g.save(); path(); g.clip();
    g.fillStyle = '#7fd0ff';
    g.fillRect(0, full ? 0 : 33, 64, 64);
    g.restore();
    g.lineWidth = 3; g.strokeStyle = '#d8f1ff'; path(); g.stroke();
  });
  texCache.set(key, t);
  return t;
}
