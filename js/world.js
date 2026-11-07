// Ember Squad: builds the static world for a mission from the grid. Ground, buildings, props, scenery.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BIOMES, layerArrays, texSet, glb } from './assets.js';
import { makeRng } from './data.js';
import { OBJ, DIR4 } from './map.js';
import { buildContainer, buildFloodMast, buildCrystals, buildHay, buildBale, grassMaterial, grassCardGeometry, hasGrassImpostor } from './kit.js';

export const WS = 1 / 1.44; // metres to tiles
const WALL_H = 2.05;
const WALL_T = 0.36;
const YARD_GOLD = new THREE.Color(1.35, 1.15, 0.7); // the port's dry scrub, brighter than the leaf recolour alone

// ------------------------------------------------------------ small helpers
const matCache = new Map();
export function pbr(slug, o = {}) {
  const key = slug + JSON.stringify(o);
  if (matCache.has(key)) return matCache.get(key);
  const set = texSetSync(slug);
  const m = new THREE.MeshStandardMaterial({
    map: set ? set.map : null, normalMap: set ? set.normalMap : null, roughnessMap: set ? set.arm : null, aoMap: null,
    color: o.color || '#ffffff', roughness: o.rough ?? 1, metalness: o.metal ?? 0, side: o.side || THREE.FrontSide,
    normalScale: new THREE.Vector2(o.ns ?? 1, o.ns ?? 1), envMapIntensity: o.env ?? 0.9,
  });
  matCache.set(key, m);
  return m;
}
const loadedSets = new Map();
function texSetSync(slug) { return loadedSets.get(slug); }
export async function primeTextures(slugs) {
  for (const s of slugs) loadedSets.set(s, await texSet(s));
}
export function plain(color, o = {}) {
  const key = 'p' + color + JSON.stringify(o);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0, emissive: o.glow || '#000000', emissiveIntensity: o.gi ?? 1, transparent: !!o.opacity, opacity: o.opacity ?? 1, envMapIntensity: o.env ?? 1 }));
  return matCache.get(key);
}

// Box spanning world coords with UVs taken from world position, so textures run on across pieces.
function wbox(x0, x1, y0, y1, z0, z1, uvs = 1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    if (nx > 0.5) uv.setXY(i, z / uvs, y / uvs);
    else if (ny > 0.5) uv.setXY(i, x / uvs, z / uvs);
    else uv.setXY(i, x / uvs, y / uvs);
  }
  return g;
}
class Batch {
  constructor() { this.parts = new Map(); }
  add(mat, geo) { if (!this.parts.has(mat)) this.parts.set(mat, []); this.parts.get(mat).push(geo); }
  build(parent, opts = {}) {
    const out = [];
    for (const [mat, geos] of this.parts) {
      const m = new THREE.Mesh(mergeGeometries(geos), mat);
      m.castShadow = opts.cast !== false;
      m.receiveShadow = true;
      parent.add(m);
      out.push(m);
    }
    return out;
  }
}

function prepModel(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material) { o.material.envMapIntensity = 0.9; if (o.material.map) o.material.map.anisotropy = 4; }
    }
  });
  return root;
}
// A model file may hold several variants side by side. Return each top-level piece, bottom-centred.
const variantCache = new Map();
export function variants(name) {
  if (variantCache.has(name)) return variantCache.get(name);
  const g = loadedModels.get(name);
  if (!g) return [];
  let root = g.scene;
  while (root.children.length === 1 && !root.children[0].isMesh && root.children[0].children.length) root = root.children[0];
  // trees are one piece (trunk plus leaves); prop files hold several variants side by side
  const kids = root.children.length > 1 && !name.startsWith('tree') ? root.children : [root];
  const out = kids.map((k) => {
    const c = k.clone(true);
    c.position.set(0, 0, 0);
    const holder = new THREE.Group();
    holder.add(c);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    c.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    const size = box.getSize(new THREE.Vector3());
    prepModel(holder);
    // leaves and grass blades take the world's plant colour
    // (every tree material but the bark: some leaves and needles are solid, not cut-out cards)
    if (name.startsWith('tree') || name.startsWith('grass')) holder.traverse((o) => { if (o.isMesh && o.material && !/bark|trunk|stem|wood/i.test(o.material.name + (o.material.map?.name || ''))) alienFoliage(o.material); });
    return { obj: holder, size };
  }).filter((v) => v.size.x > 0.01);
  variantCache.set(name, out);
  return out;
}
const loadedModels = new Map();
export async function primeModels(names) {
  for (const n of names) {
    if (loadedModels.has(n)) continue;
    const path = n.startsWith('tree:') ? `trees/${n.slice(5)}_lod0.glb` : n.startsWith('tree1:') ? `trees/${n.slice(6)}_lod1.glb` : `props/${n}.glb`;
    const g = await glb(path).catch(() => null);
    if (g) loadedModels.set(n, g);
  }
}
// Place a copy of a model variant. fit: target size in tiles for the largest footprint side, or height.
function place(parent, name, x, z, o = {}) {
  const vs = variants(name);
  if (!vs.length) return null;
  const v = vs[(o.v ?? 0) % vs.length];
  const c = v.obj.clone(true);
  let s = WS * (o.scale ?? 1);
  if (o.fitH) s = o.fitH / v.size.y;
  if (o.fitW) s = Math.min(s, o.fitW / Math.max(v.size.x, v.size.z));
  c.scale.setScalar(s);
  c.position.set(x, o.y ?? 0, z);
  c.rotation.y = o.rot ?? 0;
  parent.add(c);
  return c;
}

// ------------------------------------------------------------ ground
function groundTypeLayer(biome, type, n) {
  // n is smooth noise in 0..1, so patches form blobs that follow the land instead of single tiles
  switch (biome) {
    case 'town': return { road: 0, pave: 1, grass: n > 0.66 ? 3 : 2, dirt: 3, floor: 1, planks: 1, concrete: 1 }[type] ?? 2;
    case 'farm': return { grass: 3, field: 1, dirt: 2, planks: 2, concrete: 2, floor: 2 }[type] ?? 3;
    case 'yard': return { concrete: n > 0.62 ? 3 : n < 0.22 ? 2 : 0, floor: 3, planks: 3, road: 1, dirt: 2 }[type] ?? 0;
    default: return { alien: n > 0.55 ? 1 : 0, alienglow: 1 }[type] ?? 0;
  }
}
function smoothNoise(seed) {
  const r = makeRng(seed);
  const P = 64, g = Array.from({ length: P * P }, () => r());
  const at = (a, b) => g[((a % P) + P) % P + (((b % P) + P) % P) * P];
  return (x, y) => {
    let v = 0, amp = 0.6, tot = 0, f = 1 / 5;
    for (let o = 0; o < 3; o++) {
      const gx = x * f, gy = y * f, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      v += ((at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy) * amp;
      tot += amp; amp *= 0.5; f *= 2;
    }
    return v / tot;
  };
}

function groundMaterial(map, arrays, scales, overlayTex, glowTex) {
  const W = map.w, H = map.h;
  // raw bytes: a canvas would premultiply alpha and wipe the other channels
  const sd = new Uint8Array(W * H * 4);
  const nz = smoothNoise(map.objects.length * 17 + W);
  for (let i = 0; i < W * H; i++) sd[i * 4 + groundTypeLayer(map.biome, map.ground[i], nz(i % W, (i / W) | 0))] = 255;
  const splatTex = new THREE.DataTexture(sd, W, H);
  splatTex.magFilter = splatTex.minFilter = THREE.LinearFilter;
  splatTex.generateMipmaps = false;
  splatTex.needsUpdate = true;
  // tileable value noise for warping and variation (r and g are independent)
  const N = 128;
  const nd = new Uint8Array(N * N * 4);
  const nr = makeRng(91);
  const sets = [0, 1].map(() => [4, 8, 16, 32].map((P) => ({ P, g: Array.from({ length: P * P }, () => nr()) })));
  const val = (oct, x, y) => {
    let v = 0, amp = 0.5, tot = 0;
    for (const { P, g } of oct) {
      const gx = (x / N) * P, gy = (y / N) * P;
      const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
      const G = (a, b) => g[(((a % P) + P) % P) + (((b % P) + P) % P) * P];
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const top = G(ix, iy) * (1 - sx) + G(ix + 1, iy) * sx;
      const bot = G(ix, iy + 1) * (1 - sx) + G(ix + 1, iy + 1) * sx;
      v += (top * (1 - sy) + bot * sy) * amp;
      tot += amp;
      amp *= 0.5;
    }
    return v / tot;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    nd[i] = val(sets[0], x, y) * 255;
    nd[i + 1] = val(sets[1], x, y) * 255;
    nd[i + 2] = 128;
    nd[i + 3] = 255;
  }
  const noise = new THREE.DataTexture(nd, N, N);
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  noise.magFilter = THREE.LinearFilter;
  noise.minFilter = THREE.LinearMipmapLinearFilter;
  noise.generateMipmaps = true;
  noise.needsUpdate = true;

  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: 0.8 });
  const uniforms = {
    tAlb: { value: arrays.alb }, tNor: { value: arrays.nor }, tArm: { value: arrays.arm },
    tSplat: { value: splatTex }, tNoise: { value: noise }, tOverlay: { value: overlayTex }, tGlow: { value: glowTex || overlayTex },
    uScale: { value: new THREE.Vector4(...scales) }, uMap: { value: new THREE.Vector2(W, H) }, uWet: { value: 0 }, uGlow: { value: glowTex ? 1 : 0 },
    uWetMask: { value: new THREE.Vector4(...(WETMASK[map.biome] || [0, 0, 0, 0])) },
    uTint: { value: new THREE.Vector3(...(map.biome === 'spire' ? [0.72, 0.76, 0.9] : [1, 1, 1])) },
    uVeg: { value: new THREE.Vector4(...new THREE.Color((VEG[map.biome] || {}).color || '#ffffff').toArray(), (VEG[map.biome] || {}).amount || 0) },
    uVegMask: { value: new THREE.Vector4(...((VEG[map.biome] || {}).mask || [0, 0, 0, 0])) },
  };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vGW;
uniform highp sampler2DArray tAlb; uniform highp sampler2DArray tNor; uniform highp sampler2DArray tArm;
uniform sampler2D tSplat; uniform sampler2D tNoise; uniform sampler2D tOverlay; uniform sampler2D tGlow;
uniform vec4 uScale; uniform vec2 uMap; uniform float uWet; uniform float uGlow; uniform vec4 uWetMask; uniform vec3 uTint; uniform vec4 uVeg; uniform vec4 uVegMask;
vec3 gArm; vec3 gNor; vec4 gAlb; float gWet; vec2 gSuv;`)
      .replace('#include <map_fragment>', `
vec2 gp = vGW.xz;
gSuv = (gp + 0.5) / uMap;
float n1 = texture(tNoise, gp * 0.13).r, n2 = texture(tNoise, gp * 0.13 + vec2(0.37, 0.71)).r;
vec4 sw = texture(tSplat, gSuv + (vec2(n1, n2) - 0.5) * 1.1 / uMap);
float sws[4]; sws[0] = sw.r; sws[1] = sw.g; sws[2] = sw.b; sws[3] = sw.a;
float wm[4]; wm[0] = uWetMask.x; wm[1] = uWetMask.y; wm[2] = uWetMask.z; wm[3] = uWetMask.w; float accW = 0.0;
float scl[4]; scl[0] = uScale.x; scl[1] = uScale.y; scl[2] = uScale.z; scl[3] = uScale.w;
float vm[4]; vm[0] = uVegMask.x; vm[1] = uVegMask.y; vm[2] = uVegMask.z; vm[3] = uVegMask.w;
vec4 accA = vec4(0.0); vec3 accR = vec3(0.0); vec3 accN = vec3(0.0); float wsum = 0.0;
vec2 gpx = dFdx(vec2(gp.x, -gp.y)), gpy = dFdy(vec2(gp.x, -gp.y));
for (int i = 0; i < 4; i++) {
  if (sws[i] < 0.004) continue;
  vec3 uvw = vec3(vec2(gp.x, -gp.y) / scl[i], float(i));
  vec2 ddx = gpx / scl[i], ddy = gpy / scl[i];
  vec3 armS = textureGrad(tArm, uvw, ddx, ddy).rgb;
  float w = pow(sws[i] * (armS.r + 0.35), 5.0);
  vec4 aS = textureGrad(tAlb, uvw, ddx, ddy);
  if (vm[i] > 0.5) aS.rgb = mix(aS.rgb, vec3(dot(aS.rgb, vec3(0.3, 0.59, 0.11))) * uVeg.rgb * 2.4, uVeg.a);
  accA += aS * w;
  accR += armS * w;
  accN += (textureGrad(tNor, uvw, ddx, ddy).rgb * 2.0 - 1.0) * w;
  accW += wm[i] * w;
  wsum += w;
}
gAlb = accA / max(wsum, 1e-5); gArm = accR / max(wsum, 1e-5); gNor = accN / max(wsum, 1e-5);
float macro = texture(tNoise, gp * 0.031).r;
gAlb.rgb *= mix(0.8, 1.14, macro) * uTint;
vec4 ov = texture(tOverlay, gSuv);
gAlb.rgb = mix(gAlb.rgb, ov.rgb, ov.a);
gWet = uWet * (accW / max(wsum, 1e-5)) * smoothstep(0.5, 0.64, texture(tNoise, gp * 0.045 + 0.3).g) * smoothstep(0.95, 0.55, gArm.r);
gAlb.rgb *= 1.0 - gWet * 0.35;
diffuseColor.rgb *= gAlb.rgb;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(gArm.g, 0.08, gWet);')
      .replace('#include <normal_fragment_maps>', `
vec3 tn = normalize(vec3(gNor.xy * mix(1.2, 0.2, gWet), max(gNor.z, 0.2)));
vec3 nW = normalize(vec3(tn.x, tn.z, -tn.y));
normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);`)
      .replace('#include <aomap_fragment>', `
float gAO = mix(1.0, gArm.r, 0.85);
reflectedLight.indirectDiffuse *= gAO;
reflectedLight.indirectSpecular *= gAO;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (uGlow > 0.5) {
  // glowing cracks live in the darkest crevices of the rock scan, brighter near the spire
  float crack = smoothstep(0.42, 0.16, gArm.r) * smoothstep(0.42, 0.66, texture(tNoise, gp * 0.07).r);
  float near = texture(tGlow, gSuv).g;
  totalEmissiveRadiance += vec3(0.25, 0.85, 0.95) * crack * (0.9 + near * 2.2) + vec3(0.1, 0.4, 0.45) * near * 0.2;
}`);
  };
  return m;
}

const WETMASK = { town: [1, 0.7, 0, 0.25], farm: [0, 0.1, 0.5, 0], yard: [0.9, 1, 0.3, 0.8], spire: [0.4, 0.4, 0.2, 0.4] };

// Road paint, kerb shading, stains, tyre marks: a canvas laid over the ground.
function overlayCanvas(map, rng) {
  const T = 64, W = map.w * T, H = map.h * T;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const at = (x, y) => (map.inside(x, y) ? map.ground[map.idx(x, y)] : '');
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const k = map.idx(x, y), type = map.ground[k], px = x * T, py = y * T;
    if (type === 'road') {
      const r = map.road[k];
      g.fillStyle = 'rgba(232,206,120,0.85)';
      if (r === 1 && at(x, y + 1) === 'road' && map.road[map.idx(x, y + 1)] === 1) for (let i = 0; i < 2; i++) g.fillRect(px + 6 + i * 32, py + T - 2, 20, 4);
      if (r === 2 && at(x + 1, y) === 'road' && map.road[map.idx(x + 1, y)] === 2) for (let i = 0; i < 2; i++) g.fillRect(px + T - 2, py + 6 + i * 32, 4, 20);
      if (rng() < 0.18) {
        g.fillStyle = `rgba(10,10,12,${0.18 + rng() * 0.2})`;
        g.beginPath(); g.ellipse(px + rng() * T, py + rng() * T, 6 + rng() * 14, 4 + rng() * 9, rng() * 3, 0, 7); g.fill();
      }
      if (rng() < 0.25) {
        g.strokeStyle = 'rgba(15,15,15,0.35)'; g.lineWidth = 1.2;
        g.beginPath(); let cx = px + rng() * T, cy = py + rng() * T; g.moveTo(cx, cy);
        for (let i = 0; i < 6; i++) { cx += (rng() - 0.5) * 22; cy += (rng() - 0.5) * 22; g.lineTo(cx, cy); }
        g.stroke();
      }
    }
    if (type === 'pave' || type === 'grass' || type === 'dirt') {
      for (const [dx, dy] of DIR4) {
        if (at(x + dx, y + dy) !== 'road' || type === 'road') continue;
        // kerb shadow on the road side is drawn by the kerb mesh; add grime along the kerb
        g.fillStyle = 'rgba(30,26,20,0.25)';
        g.fillRect(dx > 0 ? px + T - 3 : dx < 0 ? px : px, dy > 0 ? py + T - 3 : dy < 0 ? py : py, dx ? 3 : T, dy ? 3 : T);
      }
    }
    if ((type === 'concrete') && rng() < 0.12) {
      g.fillStyle = `rgba(40,30,20,${0.12 + rng() * 0.12})`;
      g.beginPath(); g.ellipse(px + rng() * T, py + rng() * T, 10 + rng() * 18, 6 + rng() * 10, rng() * 3, 0, 7); g.fill();
    }
  }
  if (map.biome === 'yard') {
    g.fillStyle = 'rgba(226,190,70,0.75)';
    for (const d of map.decor) if (d.type === 'paint') g.fillRect(0, d.y * T + T / 2 - 3, W, 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function glowCanvas(map) {
  const T = 32, W = map.w * T, H = map.h * T;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#4fdde8'; g.lineCap = 'round';
  const vr = makeRng(5);
  for (let i = 0; i < 0; i++) {
    let x = vr() * W, y = vr() * H;
    g.lineWidth = 0.8 + vr() * 2;
    g.globalAlpha = 0.25 + vr() * 0.45;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 9; s++) { x += (vr() - 0.5) * 50; y += (vr() - 0.5) * 50; g.lineTo(x, y); }
    g.stroke();
  }
  g.globalAlpha = 1;
  const sp = map.objects.find((o) => o.type === 'spire');
  if (sp) {
    const cx = (sp.tiles[0][0] + 0.5 + 0.5) * T, cy = (sp.tiles[0][1] + 0.5 + 0.5) * T;
    const rg = g.createRadialGradient(cx, cy, 6, cx, cy, 5 * T);
    rg.addColorStop(0, 'rgba(110,235,245,0.5)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------ buildings
const STYLE = {
  // colony prefabs: cast panels, ribbed metal and navy plate, low metal roofs, dark frames and orange doors
  brick: { wall: 'painted_metal_shutter', wallColor: '#c9d0d8', roof: 'metal_plate_02', roofColor: '#9aa2ab', floor: 'metal_plate_02', trim: '#ff7a2e', door: '#24303f', pitch: 0.6 },
  plaster: { wall: 'painted_metal_shutter', wallColor: '#e9edf0', roof: 'metal_plate_02', roofColor: '#9aa2ab', floor: 'metal_plate_02', trim: '#ff7a2e', door: '#24303f', pitch: 0.6 },
  blue: { wall: 'blue_metal_plate', wallColor: '#d4dfec', roof: 'metal_plate_02', roofColor: '#a2aab3', floor: 'metal_plate_02', trim: '#ff7a2e', door: '#d8642a', pitch: 0.6 },
  barn: { wall: 'weathered_planks', roof: 'rusty_corrugated_iron', floor: 'wood_planks_dirt', trim: '#6b4a32', door: '#7a2a20', pitch: 1.5, wallColor: '#c05a40' },
  shed: { wall: 'concrete_block_wall', roof: 'rusty_corrugated_iron', floor: 'concrete_floor_02', trim: '#8a8a84', door: '#5a6066', pitch: 0.5 },
  metal: { wall: 'painted_metal_shutter', wallColor: '#8d98a4', roof: 'rusty_corrugated_iron', roofColor: '#7d8288', floor: 'concrete_floor_02', trim: '#a8822e', door: '#28313c', pitch: 0.45 },
};

function roofGeometry(x0, x1, z0, z1, hEave, hRidge, alongX) {
  // gable roof: ridge runs along the long axis
  const pos = [], uv = [], idx = [];
  const quad = (a, b, c, d, ua, ub, uc, ud) => {
    const i = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    uv.push(...ua, ...ub, ...uc, ...ud);
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  const S = 1.6, rise = hRidge - hEave;
  if (alongX) {
    const zm = (z0 + z1) / 2, slope = Math.hypot(zm - z0, rise);
    quad([x0, hEave, z0], [x1, hEave, z0], [x1, hRidge, zm], [x0, hRidge, zm], [x0 / S, 0], [x1 / S, 0], [x1 / S, slope / S], [x0 / S, slope / S]);
    quad([x1, hEave, z1], [x0, hEave, z1], [x0, hRidge, zm], [x1, hRidge, zm], [x1 / S, 0], [x0 / S, 0], [x0 / S, slope / S], [x1 / S, slope / S]);
  } else {
    const xm = (x0 + x1) / 2, slope = Math.hypot(xm - x0, rise);
    quad([x1, hEave, z0], [x1, hEave, z1], [xm, hRidge, z1], [xm, hRidge, z0], [z0 / S, 0], [z1 / S, 0], [z1 / S, slope / S], [z0 / S, slope / S]);
    quad([x0, hEave, z1], [x0, hEave, z0], [xm, hRidge, z0], [xm, hRidge, z1], [z1 / S, 0], [z0 / S, 0], [z0 / S, slope / S], [z1 / S, slope / S]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// Roof over a footprint whose wall faces are [x0,x1]x[z0,z1] with tops at hFace.
function roofFor(x0, x1, z0, z1, hFace, slope, oh) {
  const alongX = x1 - x0 >= z1 - z0;
  const half = (alongX ? z1 - z0 : x1 - x0) / 2;
  const hRidge = hFace + slope * half, hEave = hFace - slope * oh;
  // ridge tiles along the top and fascia boards under the eaves
  const trim = [];
  const xm = (x0 + x1) / 2, zm = (z0 + z1) / 2;
  if (alongX) {
    trim.push(new THREE.CylinderGeometry(0.075, 0.075, x1 - x0 + 2 * oh + 0.04, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).translate(xm, hRidge + 0.01, zm));
    for (const z of [z0 - oh, z1 + oh]) trim.push(new THREE.BoxGeometry(x1 - x0 + 2 * oh, 0.13, 0.04).translate(xm, hEave - 0.05, z));
  } else {
    trim.push(new THREE.CylinderGeometry(0.075, 0.075, z1 - z0 + 2 * oh + 0.04, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(xm, hRidge + 0.01, zm));
    for (const x of [x0 - oh, x1 + oh]) trim.push(new THREE.BoxGeometry(0.04, 0.13, z1 - z0 + 2 * oh).translate(x, hEave - 0.05, zm));
  }
  const gut = [];
  if (alongX) for (const z of [z0 - oh - 0.03, z1 + oh + 0.03]) gut.push(new THREE.CylinderGeometry(0.045, 0.045, x1 - x0 + 2 * oh, 8, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI).translate(xm, hEave - 0.06, z));
  else for (const x of [x0 - oh - 0.03, x1 + oh + 0.03]) gut.push(new THREE.CylinderGeometry(0.045, 0.045, z1 - z0 + 2 * oh, 8, 1, true, 0, Math.PI).rotateX(Math.PI / 2).translate(x, hEave - 0.06, zm));
  return {
    gutter: mergeGeometries(gut),
    roof: roofGeometry(x0 - oh, x1 + oh, z0 - oh, z1 + oh, hEave, hRidge, alongX),
    gable: gableGeometry(x0, x1, z0, z1, hFace, hRidge - hFace, alongX, 0),
    trim: mergeGeometries(trim),
    hRidge,
  };
}
function gableGeometry(x0, x1, z0, z1, h, rise, alongX, inset) {
  const pos = [], uv = [];
  const tri = (a, b, c) => { pos.push(...a, ...b, ...c); for (const p of [a, b, c]) uv.push(alongX ? p[2] : p[0], p[1]); };
  if (alongX) {
    const zm = (z0 + z1) / 2;
    for (const x of [x0 + inset, x1 - inset]) { tri([x, h, z0], [x, h, z1], [x, h + rise, zm]); tri([x, h, z1], [x, h, z0], [x, h + rise, zm]); }
  } else {
    const xm = (x0 + x1) / 2;
    for (const z of [z0 + inset, z1 - inset]) { tri([x0, h, z], [x1, h, z], [xm, h + rise, z]); tri([x1, h, z], [x0, h, z], [xm, h + rise, z]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function buildBuilding(parent, map, b, rng, isNight) {
  const st = STYLE[b.style] || STYLE.brick;
  const wallM = pbr(st.wall, { color: st.wallColor || '#ffffff' });
  // colony frames are painted metal with grime from the shutter scan, not flat orange plastic
  const trimM = st.trim === '#ff7a2e' ? pbr('painted_metal_shutter', { color: '#c4733f', rough: 0.85, metal: 0.2 }) : plain(st.trim, { rough: 0.7 });
  const plinthM = pbr('concrete_floor_02', { color: '#b9b5aa' });
  const glassM = plain('#1c2630', { rough: 0.05, metal: 0.1, opacity: 0.62, env: 1.6 });
  const litM = plain('#ffcf8a', { glow: '#ffb35c', gi: 1.6, rough: 0.5 });
  const batch = new Batch();
  const x0 = b.x0, y0 = b.y0, x1 = b.x0 + b.w - 1, y1 = b.y0 + b.h - 1;
  const inB = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && (x === x0 || x === x1 || y === y0 || y === y1);
  const t = WALL_T / 2;
  const litChance = isNight ? 0.75 : 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!inB(x, y)) continue;
    const o = map.objAt(x, y);
    const kind = o ? o.type : 'door';
    const alongX = y === y0 || y === y1;
    if (kind === 'wall') {
      for (const [dx, dy] of DIR4) {
        if (!inB(x + dx, y + dy)) continue;
        const ax = dx ? [x - t * Math.sign(dx) * 0 - (dx > 0 ? t : 0.5), x + (dx > 0 ? 0.5 : t)] : [x - t, x + t];
        const az = dy ? [y - (dy > 0 ? t : 0.5), y + (dy > 0 ? 0.5 : t)] : [y - t, y + t];
        batch.add(wallM, wbox(ax[0], ax[1], 0, WALL_H, az[0], az[1], 1.6));
      }
      continue;
    }
    // window or door: pieces run the full tile along the wall
    const [ax0, ax1, az0, az1] = alongX ? [x - 0.5, x + 0.5, y - t, y + t] : [x - t, x + t, y - 0.5, y + 0.5];
    if (kind === 'window') {
      batch.add(wallM, wbox(ax0, ax1, 0, 0.82, az0, az1, 1.6));
      batch.add(wallM, wbox(ax0, ax1, 1.55, WALL_H, az0, az1, 1.6));
      const out = alongX ? (y === y0 ? -1 : 1) : (x === x0 ? -1 : 1);
      {
        const f = t + 0.035, o2 = out * f;
        const face = (a0, a1, b0, b1) => alongX
          ? wbox(x + a0, x + a1, b0, b1, y + o2 - 0.035, y + o2 + 0.005)
          : wbox(x + o2 - 0.035, x + o2 + 0.005, b0, b1, y + a0, y + a1);
        batch.add(trimM, face(-0.5, -0.4, 0.78, 1.62));
        batch.add(trimM, face(0.4, 0.5, 0.78, 1.62));
        batch.add(trimM, face(-0.5, 0.5, 1.53, 1.64));
      }
      // sill, frame, mullion, glass
      if (alongX) {
        batch.add(trimM, wbox(x - 0.48, x + 0.48, 0.8, 0.86, y - t - (out < 0 ? 0.08 : 0), y + t + (out > 0 ? 0.08 : 0)));
        batch.add(trimM, wbox(x - 0.5, x - 0.44, 0.82, 1.55, y - 0.05, y + 0.05));
        batch.add(trimM, wbox(x + 0.44, x + 0.5, 0.82, 1.55, y - 0.05, y + 0.05));
        batch.add(trimM, wbox(x - 0.02, x + 0.02, 0.82, 1.55, y - 0.04, y + 0.04));
        batch.add(trimM, wbox(x - 0.5, x + 0.5, 1.5, 1.55, y - 0.05, y + 0.05));
        batch.add(rng() < litChance ? litM : glassM, wbox(x - 0.44, x + 0.44, 0.86, 1.5, y - 0.012, y + 0.012));
      } else {
        batch.add(trimM, wbox(x - t - (out < 0 ? 0.08 : 0), x + t + (out > 0 ? 0.08 : 0), 0.8, 0.86, y - 0.48, y + 0.48));
        batch.add(trimM, wbox(x - 0.05, x + 0.05, 0.82, 1.55, y - 0.5, y - 0.44));
        batch.add(trimM, wbox(x - 0.05, x + 0.05, 0.82, 1.55, y + 0.44, y + 0.5));
        batch.add(trimM, wbox(x - 0.04, x + 0.04, 0.82, 1.55, y - 0.02, y + 0.02));
        batch.add(trimM, wbox(x - 0.05, x + 0.05, 1.5, 1.55, y - 0.5, y + 0.5));
        batch.add(rng() < litChance ? litM : glassM, wbox(x - 0.012, x + 0.012, 0.86, 1.5, y - 0.44, y + 0.44));
      }
    } else {
      batch.add(wallM, wbox(ax0, ax1, 1.62, WALL_H, az0, az1, 1.6));
      if (alongX) {
        batch.add(trimM, wbox(x - 0.5, x - 0.42, 0, 1.62, y - t - 0.02, y + t + 0.02));
        batch.add(trimM, wbox(x + 0.42, x + 0.5, 0, 1.62, y - t - 0.02, y + t + 0.02));
      } else {
        batch.add(trimM, wbox(x - t - 0.02, x + t + 0.02, 0, 1.62, y - 0.5, y - 0.42));
        batch.add(trimM, wbox(x - t - 0.02, x + t + 0.02, 0, 1.62, y + 0.42, y + 0.5));
      }
      // open door leaf against the inside wall
      const leaf = new THREE.Group();
      const paint = new THREE.MeshStandardMaterial({ color: st.door, roughness: 0.55, envMapIntensity: 0.8 });
      const slab = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.56, 0.04), paint);
      leaf.add(slab);
      for (const [py, ph] of [[0.42, 0.5], [-0.32, 0.62]]) for (const side of [-1, 1]) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.56, ph, 0.012), paint);
        panel.position.set(0, py, side * 0.026);
        leaf.add(panel);
      }
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), new THREE.MeshStandardMaterial({ color: '#c9a65a', metalness: 0.9, roughness: 0.3 }));
      knob.position.set(0.32, -0.02, 0.04);
      leaf.add(knob);
      leaf.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      const inward = alongX ? (y === y0 ? 1 : -1) : (x === x0 ? 1 : -1);
      if (alongX) { leaf.position.set(x - 0.42, 0.78, y + inward * 0.42); leaf.rotation.y = Math.PI / 2; }
      else { leaf.position.set(x + inward * 0.42, 0.78, y - 0.42); }
      parent.add(leaf);
    }
  }
  // grime band along the base of the outside walls
  const grime = pbr('concrete_floor_02', { color: '#6d6255' });
  const gt = t + 0.012;
  for (const [ax0, ax1, az0, az1] of [[x0 - gt, x1 + gt, y0 - gt, y0 - t + 0.002], [x0 - gt, x1 + gt, y1 + t - 0.002, y1 + gt], [x0 - gt, x0 - t + 0.002, y0 - gt, y1 + gt], [x1 + t - 0.002, x1 + gt, y0 - gt, y1 + gt]]) {
    batch.add(grime, wbox(ax0, ax1, 0.12, 0.4, az0, az1, 1.2));
  }
  // plinth and coping
  const pt = 0.3;
  for (const [ax0, ax1, az0, az1] of [[x0 - pt, x1 + pt, y0 - pt, y0 + pt], [x0 - pt, x1 + pt, y1 - pt, y1 + pt], [x0 - pt, x0 + pt, y0 - pt, y1 + pt], [x1 - pt, x1 + pt, y0 - pt, y1 + pt]]) {
    batch.add(plinthM, wbox(ax0, ax1, 0, 0.14, az0, az1, 1.2));
  }
  // floor inside
  const floorM = pbr(st.floor).clone();
  floorM.emissive = new THREE.Color('#ffffff');
  floorM.emissiveMap = floorM.map;
  floorM.emissiveIntensity = 0.18;
  const floor = new THREE.Mesh(wbox(x0, x1, 0, 0.03, y0, y1, 1.4), floorM);
  floor.receiveShadow = true;
  parent.add(floor);
  const capM = plain('#2a2624', { rough: 0.9 });
  const c0 = WALL_H - 0.02, c1 = WALL_H + 0.06, e = t + 0.02;
  batch.add(capM, wbox(x0 - e, x1 + e, c0, c1, y0 - e, y0 + e));
  batch.add(capM, wbox(x0 - e, x1 + e, c0, c1, y1 - e, y1 + e));
  batch.add(capM, wbox(x0 - e, x0 + e, c0, c1, y0 + e, y1 - e));
  batch.add(capM, wbox(x1 - e, x1 + e, c0, c1, y0 + e, y1 - e));
  batch.build(parent);
  // roof (fades when someone is inside); tall houses get an upper floor that fades with it
  const upper = b.tall ? 1.85 : 0;
  const rf = roofFor(x0 - t, x1 + t, y0 - t, y1 + t, WALL_H + 0.07 + upper, st.pitch * 0.6, 0.34);
  const roofMat = pbr(st.roof, { side: THREE.DoubleSide, color: st.roofColor || (b.style === 'barn' ? '#9a8f84' : '#ffffff') }).clone();
  roofMat.transparent = true;
  const gableMat = wallM.clone();
  gableMat.transparent = true;
  gableMat.side = THREE.DoubleSide;
  const roofMats = [];
  const trimMat = new THREE.MeshStandardMaterial({ color: b.style === 'barn' || b.style === 'shed' || b.style === 'metal' ? '#4a4038' : '#6e3a28', roughness: 0.85, transparent: true });
  const roof = new THREE.Group();
  if (upper) {
    const upWall = wallM.clone();
    upWall.transparent = true;
    const ub = new Batch();
    const H0 = WALL_H + 0.07, H1 = H0 + upper;
    const glassUp = plain('#1c2630', { rough: 0.05, metal: 0.1, env: 1.6 }).clone();
    glassUp.transparent = true;
    const frameUp = plain(st.trim, { rough: 0.6 }).clone();
    frameUp.transparent = true;
    const sides = [[x0 - t, x1 + t, y0 - t, y0 + t, 'x', -1], [x0 - t, x1 + t, y1 - t, y1 + t, 'x', 1], [x0 - t, x0 + t, y0 - t, y1 + t, 'z', -1], [x1 - t, x1 + t, y0 - t, y1 + t, 'z', 1]];
    for (const [ax0, ax1, az0, az1, axis, out2] of sides) {
      // floor band, then wall with a window every other tile
      ub.add(frameUp, wbox(ax0 - 0.02, ax1 + 0.02, H0 - 0.02, H0 + 0.1, az0 - 0.02, az1 + 0.02));
      const len = axis === 'x' ? ax1 - ax0 : az1 - az0;
      const start = axis === 'x' ? ax0 : az0;
      const n = Math.max(1, Math.floor(len / 1.6));
      const gap = len / n;
      let cur = start;
      for (let i = 0; i < n; i++) {
        const w0 = start + i * gap + gap / 2 - 0.4, w1 = w0 + 0.8;
        const seg = (p0, p1, y0b, y1b) => axis === 'x' ? wbox(p0, p1, y0b, y1b, az0, az1, 1.6) : wbox(ax0, ax1, y0b, y1b, p0, p1, 1.6);
        ub.add(upWall, seg(cur, w0, H0 + 0.1, H1));
        ub.add(upWall, seg(w0, w1, H0 + 0.1, H0 + 0.75));
        ub.add(upWall, seg(w0, w1, H0 + 1.45, H1));
        const glass = axis === 'x' ? wbox(w0, w1, H0 + 0.75, H0 + 1.45, (az0 + az1) / 2 - 0.01, (az0 + az1) / 2 + 0.01) : wbox((ax0 + ax1) / 2 - 0.01, (ax0 + ax1) / 2 + 0.01, H0 + 0.75, H0 + 1.45, w0, w1);
        ub.add(glassUp, glass);
        const sill = axis === 'x' ? wbox(w0 - 0.05, w1 + 0.05, H0 + 0.7, H0 + 0.76, out2 < 0 ? az0 - 0.06 : az0, out2 > 0 ? az1 + 0.06 : az1) : wbox(out2 < 0 ? ax0 - 0.06 : ax0, out2 > 0 ? ax1 + 0.06 : ax1, H0 + 0.7, H0 + 0.76, w0 - 0.05, w1 + 0.05);
        ub.add(frameUp, sill);
        cur = w1;
      }
      ub.add(upWall, axis === 'x' ? wbox(cur, ax1, H0 + 0.1, H1, az0, az1, 1.6) : wbox(ax0, ax1, H0 + 0.1, H1, cur, az1, 1.6));
    }
    ub.build(roof);
    roofMats.push(upWall, glassUp, frameUp);
  }
  const gutterMat = new THREE.MeshStandardMaterial({ color: '#7d8084', metalness: 0.6, roughness: 0.45, transparent: true });
  for (const m of [new THREE.Mesh(rf.roof, roofMat), new THREE.Mesh(rf.gable, gableMat), new THREE.Mesh(rf.trim, trimMat), new THREE.Mesh(rf.gutter, gutterMat)]) { m.castShadow = true; m.receiveShadow = true; roof.add(m); }
  if (b.style === 'brick' || b.style === 'plaster' || b.style === 'blue') {
    const mast = new THREE.Group();
    const cx = x0 + (x1 - x0) * (rng() < 0.5 ? 0.25 : 0.75), cz = y0 + (y1 - y0) * (rng() < 0.5 ? 0.3 : 0.7);
    const top = rf.hRidge + 1.1;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, top - WALL_H, 8).translate(cx, (top + WALL_H) / 2, cz), gutterMat);
    const dishM = gutterMat.clone();
    dishM.side = THREE.DoubleSide;
    roofMats.push(dishM);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, 1.15).rotateX(-1.0).translate(cx + 0.28, rf.hRidge + 0.6, cz), dishM);
    const box = new THREE.Mesh(wbox(cx - 0.18, cx + 0.18, rf.hRidge - 0.05, rf.hRidge + 0.25, cz - 0.14, cz + 0.14), gutterMat);
    const tipM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3a2a').multiplyScalar(2), transparent: true });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6).translate(cx, top, cz), tipM);
    for (const m of [pole, dish, box]) { m.castShadow = true; m.receiveShadow = true; mast.add(m); }
    mast.add(tip);
    roof.add(mast);
    roofMats.push(tipM);
  }
  parent.add(roof);
  const pipeM = new THREE.MeshStandardMaterial({ color: '#7d8084', metalness: 0.6, roughness: 0.45 });
  for (const [px, pz] of [[x0 - t - 0.05, y0 - t - 0.05], [x1 + t + 0.05, y1 + t + 0.05]]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, WALL_H + upper, 8), pipeM);
    pipe.position.set(px, (WALL_H + upper) / 2, pz);
    pipe.castShadow = true;
    parent.add(pipe);
  }
  // the roof's shape, so the view can tell when it really stands between the camera and someone
  const shape = { x0: x0 - t, x1: x1 + t, z0: y0 - t, z1: y1 + t, h: WALL_H + 0.07 + upper, slope: st.pitch * 0.6, oh: 0.34 };
  return { b, roof, shape, mats: [roofMat, gableMat, trimMat, gutterMat, ...roofMats], fade: 1 };
}

// ------------------------------------------------------------ cover props
function hayTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#b49a5a'; g.fillRect(0, 0, 256, 256);
  const r = makeRng(3);
  for (let i = 0; i < 1400; i++) {
    g.strokeStyle = `rgba(${200 + r() * 50},${170 + r() * 50},${90 + r() * 40},${0.3 + r() * 0.5})`;
    g.lineWidth = 0.6 + r();
    const x = r() * 256, y = r() * 256, a = (r() - 0.5) * 0.6;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
let hayTex = null;
const FURNITURE = ['WoodenTable_01', 'Sofa_01', 'modern_wooden_cabinet', 'vintage_wooden_drawer_01', 'round_wooden_table_01', 'ArmChair_01', 'WoodenChair_01', 'Shelf_01', 'wooden_bookshelf_worn', 'Television_01', 'old_bed_frame', 'painted_wooden_chair_01'];
const CONTAINER_COLS = ['#c2563e', '#4a7cab', '#5a9161', '#d8913e', '#9aa0a6'];

const out_trees = [];
// Plants on each frontier world: the ground's grass layers, tufts and tree leaves are recoloured from their scanned
// greens into the world's own hue (teal on the colony, violet crops on the farm, gold at the port).
// Grass on the ground only drifts toward the world's hue (soil and paths keep their own colours); leaves and tufts
// take it fully. One shared colour, set per mission, so cached plant materials follow whichever world is loaded.
const VEG = {
  town: { color: '#5f8f84', amount: 0.32, mask: [0, 0, 1, 0], leaf: '#3fa595' },
  farm: { color: '#857c64', amount: 0.35, mask: [1, 1, 0, 1], leaf: '#7258a0' },
  yard: { color: '#b8913a', amount: 0.5, mask: [0, 0, 1, 0], leaf: '#c08a1c' }, // the port's dirt patches are gold dust
};
const LEAF = { color: { value: new THREE.Color('#ffffff') }, amount: { value: 0 } };
// (tracked by object: a cloned material copies userData but not its shader hook, so it needs its own)
const foliage = new WeakSet();
export function alienFoliage(m) {
  if (foliage.has(m)) return;
  foliage.add(m);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLeaf = LEAF.color;
    sh.uniforms.uLeafK = LEAF.amount;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLeaf; uniform float uLeafK;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))) * uLeaf * 2.6, uLeafK);`);
  };
  m.customProgramCacheKey = () => 'alien-leaf';
  m.needsUpdate = true;
}
function prepTree(t, list) {
  t.traverse((m) => {
    if (!m.isMesh) return;
    m.material = m.material.clone();
    if (m.material.alphaTest || m.material.transparent) { m.material.alphaTest = 0.5; m.material.alphaToCoverage = true; m.material.transparent = false; m.material.side = THREE.DoubleSide; alienFoliage(m.material); }
  });
  t.userData.tree = true;
  t.traverse((m) => { if (m.isMesh) m.userData.noAO = true; });
  list.push(t);
}
function buildCover(parent, o, map, rng, biome) {
  const g = new THREE.Group();
  let cx = 0, cz = 0;
  for (const [x, y] of o.tiles) { cx += x; cz += y; }
  cx /= o.tiles.length; cz /= o.tiles.length;
  g.position.set(cx, 0, cz);
  parent.add(g);
  const along = o.axis === 'y';
  const rot = (rng() - 0.5) * 0.3;
  switch (o.type) {
    case 'crate': {
      if (o.style === 'indoor' && FURNITURE.some((f) => variants(f).length)) {
        const n = ['WoodenTable_01', 'Sofa_01', 'modern_wooden_cabinet', 'vintage_wooden_drawer_01', 'round_wooden_table_01', 'ArmChair_01'][Math.floor(rng() * 6)];
        if (place(g, n, 0, 0, { fitW: 0.9, rot: Math.floor(rng() * 4) * Math.PI / 2 })) break;
      }
      const names = biome === 'yard' ? ['wooden_military_crate', 'old_military_crate', 'wooden_crate_02', 'plastic_crate_01'] : ['wooden_crate_02', 'wooden_crate_01', 'wooden_military_crate'];
      const n = names[Math.floor(rng() * names.length)];
      const a = place(g, n, 0, 0, { fitW: 0.86, v: Math.floor(rng() * 3), rot });
      if (a) {
        const h = new THREE.Box3().setFromObject(a).max.y;
        if (h < 0.55) place(g, names[Math.floor(rng() * names.length)], (rng() - 0.5) * 0.1, 0, { fitW: 0.7, v: Math.floor(rng() * 3), rot: rot + (rng() - 0.5) * 0.6, y: h });
      }
      break;
    }
    case 'barrel': {
      const n = ['Barrel_01', 'Barrel_02', 'barrel_03'][Math.floor(rng() * 3)];
      place(g, n, -0.2, -0.12, { fitH: 0.68, rot: rng() * 6 });
      place(g, n, 0.22, 0.14, { fitH: 0.68, rot: rng() * 6 });
      break;
    }
    case 'car': case 'tractor': {
      const c = place(g, 'covered_car', 0, 0, { fitW: 2.1, rot: (along ? 0 : Math.PI / 2) + (rng() < 0.5 ? Math.PI : 0) + (rng() - 0.5) * 0.12 });
      if (!c) g.add(new THREE.Mesh(new THREE.BoxGeometry(along ? 0.9 : 1.9, 0.9, along ? 1.9 : 0.9), plain('#555')));
      break;
    }
    case 'lowwall': {
      const street = biome === 'town' && /road|pave/.test(map.ground[map.idx(o.tiles[0][0], o.tiles[0][1])]);
      if (street && variants('cement_bag').length) {
        // sandbag wall: three courses of bags, staggered
        for (let row = 0; row < 3; row++) for (let k = -1; k <= 1; k++) {
          const off = k * 0.32 + (row % 2) * 0.16 - 0.08;
          const bag = place(g, 'cement_bag', along ? (rng() - 0.5) * 0.04 : off, along ? off : (rng() - 0.5) * 0.04, { fitW: 0.36, y: row * 0.14, rot: (along ? 0 : Math.PI / 2) + (rng() - 0.5) * 0.25 });
          if (bag) bag.traverse((m) => { if (m.isMesh && !m.material.userData.burlap) { m.material = m.material.clone(); m.material.map = null; m.material.color.set('#6f6450'); m.material.roughness = 0.95; m.material.userData.burlap = true; } });
        }
        break;
      }
      const stone = o.stone || biome === 'farm';
      if (stone && variants('rock_moss_set_01').length) {
        // dry stone wall: a row of real rocks, two courses
        for (let row = 0; row < 2; row++) for (let k = -1; k <= 1; k++) {
          const off = k * 0.32 + (row ? 0.16 : 0) - (row ? 0.08 : 0);
          place(g, 'rock_moss_set_01', along ? (rng() - 0.5) * 0.08 : off, along ? off : (rng() - 0.5) * 0.08, { fitW: 0.42, fitH: 0.42, v: Math.floor(rng() * 6), y: row * 0.3, rot: rng() * 6 });
        }
        break;
      }
      const m = stone ? pbr('dark_rock', { color: '#c9c3b6' }) : pbr('concrete_floor_02', { color: '#b9bec5' });
      const sx = along ? 0.36 : 1.02, sz = along ? 1.02 : 0.36;
      const w = new THREE.Mesh(wbox(cx - sx / 2, cx + sx / 2, 0, 0.74, cz - sz / 2, cz + sz / 2, 1.2), m);
      w.position.set(-cx, 0, -cz);
      w.castShadow = w.receiveShadow = true;
      g.add(w);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.08, 0.07, sz + 0.02), pbr('concrete_floor_02', { color: '#bdb8ad' }));
      cap.position.y = 0.775;
      cap.castShadow = cap.receiveShadow = true;
      g.add(cap);
      break;
    }
    case 'hedge': {
      for (let i = -1; i <= 1; i += 2) place(g, rng() < 0.5 ? 'shrub_02' : 'shrub_04', along ? 0 : i * 0.25, along ? i * 0.25 : 0, { fitH: 0.85, fitW: 0.75, v: Math.floor(rng() * 4), rot: rng() * 6 });
      if (!g.children.length) g.add(new THREE.Mesh(new THREE.BoxGeometry(along ? 0.6 : 1, 0.9, along ? 1 : 0.6), plain('#3f5f2a')));
      break;
    }
    case 'fence': {
      const wood = pbr('weathered_planks', { color: '#c8b8a0' });
      for (const s of [-0.46, 0.46]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.82, 0.09), wood);
        p.position.set(along ? 0 : s, 0.41, along ? s : 0);
        p.castShadow = true;
        g.add(p);
      }
      for (const h of [0.28, 0.52, 0.74]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(along ? 0.04 : 1.0, 0.11, along ? 1.0 : 0.04), wood);
        r.position.y = h;
        r.rotation[along ? 'x' : 'z'] = (rng() - 0.5) * 0.05;
        r.castShadow = r.receiveShadow = true;
        g.add(r);
      }
      break;
    }
    case 'tree': {
      const kinds = BIOMES[biome].trees;
      const n = kinds.length ? kinds[Math.floor(rng() * kinds.length)] : null;
      const t = n ? place(g, 'tree:' + n, 0, 0, { fitH: 3.6 + rng() * 1.4, rot: rng() * 6 }) : null;
      if (t) prepTree(t, out_trees);
      if (!t) g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 2), plain('#5b4330')));
      break;
    }
    case 'rock': {
      const n = rng() < 0.5 ? 'boulder_01' : 'rock_moss_set_01';
      place(g, n, 0, 0, { fitW: 0.95, fitH: 0.8, v: Math.floor(rng() * 5), rot: rng() * 6 });
      break;
    }
    case 'hay': {
      // square bales, stacked two high, with twine
      const n = 1 + Math.floor(rng() * 2);
      for (let i = 0; i < n; i++) {
        const bale = buildBale(rng);
        bale.position.set((rng() - 0.5) * 0.06, 0.19 + i * 0.38, (rng() - 0.5) * 0.06);
        bale.rotation.y = (along ? Math.PI / 2 : 0) + (rng() - 0.5) * 0.2;
        g.add(bale);
      }
      break;
    }
    case 'barrier': {
      const n = rng() < 0.5 ? 'concrete_road_barrier' : 'concrete_road_barrier_02';
      if (!place(g, n, 0, 0, { fitW: 1.02, rot: along ? Math.PI / 2 : 0 })) g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.75, 0.4), plain('#b9b7ae')));
      break;
    }
    case 'container': {
      const len = o.tiles.length;
      const set = texSetSync('painted_metal_shutter') || texSetSync('rusty_corrugated_iron');
      const c = buildContainer(len, CONTAINER_COLS[o.color % CONTAINER_COLS.length], o.id * 13 + 5, set);
      c.rotation.y = (along ? 0 : Math.PI / 2) + (rng() < 0.5 ? Math.PI : 0);
      g.add(c);
      if (rng() < 0.4) {
        const top = buildContainer(len, CONTAINER_COLS[(o.color + 2) % CONTAINER_COLS.length], o.id * 13 + 9, set);
        top.rotation.y = c.rotation.y + (rng() - 0.5) * 0.04;
        top.position.y = 1.82;
        g.add(top);
      }
      break;
    }
    case 'pillar': {
      g.add(buildCrystals(o.id * 7 + 1, 2.4 + rng() * 0.6, 0.55));
      break;
    }
    case 'shard': {
      g.add(buildCrystals(o.id * 7 + 3, 0.7 + rng() * 0.3, 0.6));
      break;
    }
    case 'spire': {
      const tower = buildCrystals(4242, 8.5, 1.6);
      g.add(tower);
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 7.5, 6), new THREE.MeshStandardMaterial({ color: '#8ef5ff', emissive: '#6ff0ff', emissiveIntensity: 1.6 }));
      core.position.y = 3.8;
      g.add(core);
      const top = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), new THREE.MeshStandardMaterial({ color: '#e6fbff', emissive: '#7ff4ff', emissiveIntensity: 1.3 }));
      top.position.y = 10.4;
      top.userData.spin = 0.6;
      g.add(top);
      break;
    }
  }
  return g;
}

// ------------------------------------------------------------ the world
export function buildWorld(map, time, parent) {
  const biome = map.biome;
  const B = BIOMES[biome];
  LEAF.color.value.set((VEG[biome] || {}).leaf || '#ffffff');
  LEAF.amount.value = VEG[biome] ? 0.72 : 0;
  const rng = makeRng(map.objects.length * 31 + map.w * 7);
  out_trees.length = 0;
  const out = { objMeshes: new Map(), roofs: [], lamps: [], ground: null, trees: out_trees };
  const night = time === 'night';
  const cx = map.w / 2 - 0.5, cz = map.h / 2 - 0.5;

  // ground
  const arrays = layerArraysSync(B.layers);
  const overlay = overlayCanvas(map, makeRng(13));
  const gmat = groundMaterial(map, arrays, B.scale, overlay, biome === 'spire' ? glowCanvas(map) : null);
  gmat.userData.uniforms.uWet.value = night ? 0.85 : time === 'dusk' ? 0.4 : 0.12;
  // the ground runs far past the map, so the fog fades it into the sky at the horizon
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(map.w + 260, map.h + 260), gmat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, 0, cz);
  ground.receiveShadow = true;
  parent.add(ground);
  out.ground = ground;

  // kerbs along road edges
  const kerbM = pbr('concrete_floor_02', { color: '#c9c6bd' });
  const kb = new Batch();
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const t = map.ground[map.idx(x, y)];
    if (t === 'road') continue;
    for (const [dx, dy] of DIR4) {
      if (!map.inside(x + dx, y + dy) || map.ground[map.idx(x + dx, y + dy)] !== 'road') continue;
      const ex = x + dx * 0.5, ez = y + dy * 0.5;
      if (dx) kb.add(kerbM, wbox(ex - 0.08 - (dx > 0 ? 0.0 : 0), ex + 0.08, 0, 0.09, ez - 0.5, ez + 0.5, 0.8));
      else kb.add(kerbM, wbox(ex - 0.5, ex + 0.5, 0, 0.09, ez - 0.08, ez + 0.08, 0.8));
    }
  }
  kb.build(parent, { cast: false });

  // buildings
  for (const b of map.buildings || []) out.roofs.push(buildBuilding(parent, map, b, rng, night));

  // cover objects
  for (const o of map.objects) {
    if (o.gone || o.type === 'wall' || o.type === 'window') continue;
    out.objMeshes.set(o.id, buildCover(parent, o, map, rng, biome));
  }

  // dressing that does not block: lamps, bins, clutter, grass; merged by material to save draw calls
  const decor = new THREE.Group();
  parent.add(decor);
  dress(decor, map, rng, biome, night, out);
  outside(decor, map, rng, biome);
  mergeStatic(decor);
  horizon(parent, map, rng, biome);
  return out;
}

// Fold every plain mesh under a group into one mesh per material (world space). Instanced meshes stay as they are.
function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const byMat = new Map();
  const drop = [];
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material)) return;
    const src = o.geometry;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', src.attributes.position.clone());
    if (src.attributes.normal) g.setAttribute('normal', src.attributes.normal.clone());
    else { g.setIndex(src.index); g.computeVertexNormals(); }
    g.setAttribute('uv', src.attributes.uv ? src.attributes.uv.clone() : new THREE.BufferAttribute(new Float32Array(src.attributes.position.count * 2), 2));
    if (src.index) g.setIndex(src.index.clone());
    g.applyMatrix4(o.matrixWorld);
    const flat = g.index ? g.toNonIndexed() : g;
    const key = o.material;
    if (!byMat.has(key)) byMat.set(key, { geos: [], cast: false });
    const e = byMat.get(key);
    e.geos.push(flat);
    e.cast ||= o.castShadow;
    drop.push(o);
  });
  for (const o of drop) o.parent.remove(o);
  for (const [m, e] of byMat) {
    const merged = mergeGeometries(e.geos);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = e.cast;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  // empty holders left behind
  for (const c of [...group.children]) if (!c.isMesh && !c.children.length) group.remove(c);
}

function layerArraysSync(slugs) {
  const p = arraysReady.get(slugs.join(','));
  if (!p) throw new Error('ground layers not loaded');
  return p;
}
const arraysReady = new Map();
export async function primeWorld(biome) {
  const B = BIOMES[biome];
  arraysReady.set(B.layers.join(','), await layerArrays(B.layers));
  await primeTextures([...new Set([...B.tex, 'concrete_floor_02', 'weathered_planks', 'brick_wall_02', 'dark_rock', 'rusty_corrugated_iron', 'painted_plaster_wall', 'blue_plaster_weathered', 'clay_roof_tiles_02', 'grey_roof_tiles', 'wood_floor_worn', 'concrete_block_wall', 'wood_planks_dirt', 'concrete_panels', 'blue_metal_plate', 'metal_plate_02', 'painted_metal_shutter'])].filter(Boolean));
  await primeModels([...B.props, ...B.trees.map((t) => 'tree:' + t), ...B.trees.map((t) => 'tree1:' + t), ...(biome === 'spire' ? [] : FURNITURE)]);
}

// The lantern sits at the top of the lamp model: find it from the model's bounds.
function lampHead(lamp) {
  lamp.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(lamp);
  const top = new THREE.Box3(new THREE.Vector3(box.min.x, box.max.y - 0.45, box.min.z), box.max.clone());
  const c = new THREE.Vector3();
  let n = 0;
  lamp.traverse((m) => {
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 7) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (top.containsPoint(v)) { c.add(v); n++; }
    }
  });
  if (n) c.divideScalar(n);
  else c.set((box.min.x + box.max.x) / 2, box.max.y - 0.2, (box.min.z + box.max.z) / 2);
  c.y -= 0.12;
  return c;
}

function edgeSpot(map, x, y, rng) {
  // a point near the edge of a free tile, out of the way of a unit standing in the middle
  const [dx, dy] = DIR4[Math.floor(rng() * 4)];
  const side = (rng() - 0.5) * 0.6;
  return [x + dx * 0.38 + (dy ? side : 0), y + dy * 0.38 + (dx ? side : 0)];
}

function dress(parent, map, rng, biome, night, out) {
  const free = (x, y) => map.inside(x, y) && !map.objAt(x, y);
  const T = (x, y) => (map.inside(x, y) ? map.ground[map.idx(x, y)] : '');
  if (biome === 'town') {
    // street lamps along pavement next to the road
    let n = 0;
    for (let y = 1; y < map.h - 1; y += 1) for (let x = 1; x < map.w - 1; x += 1) {
      if (n > 7) break;
      if (T(x, y) !== 'pave' || !free(x, y) || rng() > 0.09) continue;
      const road = DIR4.find(([dx, dy]) => T(x + dx, y + dy) === 'road');
      if (!road) continue;
      const [dx, dy] = road;
      const lx = x + dx * 0.4, lz = y + dy * 0.4;
      const mast = buildFloodMast(night);
      mast.scale.setScalar(0.62);
      mast.position.set(lx, 0, lz);
      mast.rotation.y = Math.atan2(-dx, -dy);
      parent.add(mast);
      mast.updateMatrixWorld(true);
      const head = mast.userData.head.clone().applyMatrix4(mast.matrixWorld);
      head.flood = mast.userData.aim.clone().applyMatrix4(mast.matrixWorld);
      out.lamps.push(head);
      n++;
    }
  }
  if (biome === 'yard') {
    // floodlight masts at the ends of the container rows, heads facing down the lane
    let n = 0;
    for (const o of map.objects) {
      if (o.gone || o.type !== 'container' || n >= 6 || rng() < 0.3) continue;
      const [ex, ey] = o.tiles[o.tiles.length - 1];
      const dx = o.axis === 'y' ? 0 : 1, dy = o.axis === 'y' ? 1 : 0;
      const lx = ex + dx * 0.9, lz = ey + dy * 0.9;
      if (!map.inside(Math.round(lx), Math.round(lz)) || map.objAt(Math.round(lx), Math.round(lz))) continue;
      const mast = buildFloodMast(night);
      mast.position.set(lx, 0, lz);
      mast.rotation.y = Math.atan2(dx, dy);
      parent.add(mast);
      mast.updateMatrixWorld(true);
      const head = mast.userData.head.clone().applyMatrix4(mast.matrixWorld);
      head.flood = mast.userData.aim.clone().applyMatrix4(mast.matrixWorld);
      out.lamps.unshift(head);
      n++;
    }
  }
  const clutter = {
    town: [['metal_trash_can', 0.55], ['power_box_01', 0.5], ['utility_box_01', 0.6], ['utility_box_02', 0.6], ['ammo_box', 0.3]],
    farm: [['tree_stump_01', 0.6], ['dead_tree_trunk', 1.2], ['wooden_barrels_01', 0.7], ['portable_generator', 0.55], ['wooden_crate_02', 0.5]],
    yard: [['ammo_box', 0.3], ['portable_generator', 0.55], ['power_box_01', 0.5], ['plastic_crate_01', 0.3], ['old_military_crate', 0.6], ['concrete_road_barrier', 0.9]],
    spire: [['boulder_01', 0.45]],
  }[biome];
  let placed = 0;
  for (let i = 0; i < 400 && placed < 26; i++) {
    const x = Math.floor(rng() * map.w), y = Math.floor(rng() * map.h);
    if (!free(x, y) || T(x, y) === 'road' || y > map.h - 4) continue;
    if (!DIR4.some(([dx, dy]) => map.objAt(x + dx, y + dy))) continue; // clutter gathers against things
    const [name, size] = clutter[Math.floor(rng() * clutter.length)];
    const [px, pz] = edgeSpot(map, x, y, rng);
    const it = place(parent, name, px, pz, { fitW: size, v: Math.floor(rng() * 4), rot: rng() * 6 });
    if (it && name === 'old_tyre') { it.rotation.x = Math.PI / 2; it.position.y = 0.06; }
    if (it) placed++;
  }
  // manholes on roads
  // a security light over every outside door
  for (const b of map.buildings || []) {
    if (!variants('security_light').length) break;
    const x0 = b.x0, y0 = b.y0, x1 = b.x0 + b.w - 1, y1 = b.y0 + b.h - 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1 || y === y0 || y === y1;
      if (!edge || map.objAt(x, y)) continue;
      const [ox, oy] = y === y0 ? [0, -1] : y === y1 ? [0, 1] : x === x0 ? [-1, 0] : [1, 0];
      const corner = (x === x0 || x === x1) && (y === y0 || y === y1);
      if (corner) continue;
      place(parent, 'security_light', x + ox * 0.22 + (oy ? 0.32 : 0), y + oy * 0.22 + (ox ? 0.32 : 0), { fitW: 0.22, y: 1.72, rot: Math.atan2(ox, oy) });
    }
  }
  // one aircon unit on an outside wall of each colony prefab, at shoulder height
  if (biome === 'town' && variants('exterior_aircon_unit').length) for (const b of map.buildings || []) {
    const x0 = b.x0, y0 = b.y0, x1 = b.x0 + b.w - 1, y1 = b.y0 + b.h - 1, spots = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const o = map.objAt(x, y);
      if (!o || o.type !== 'wall' || ((x === x0 || x === x1) && (y === y0 || y === y1))) continue;
      const [ox, oy] = y === y0 ? [0, -1] : y === y1 ? [0, 1] : x === x0 ? [-1, 0] : [1, 0];
      if (map.inside(x + ox, y + oy) && free(x + ox, y + oy)) spots.push([x, y, ox, oy]);
    }
    if (!spots.length) continue;
    const [x, y, ox, oy] = spots[Math.floor(rng() * spots.length)];
    place(parent, 'exterior_aircon_unit', x + ox * (WALL_T / 2 + 0.17), y + oy * (WALL_T / 2 + 0.17), { fitW: 0.55, y: 1.2, rot: Math.atan2(ox, oy) });
  }
  // furniture along the inside walls (looks only; units still stand in the middle of tiles)
  for (const b of map.buildings || []) {
    if (biome === 'spire') break;
    const deco = b.style === 'barn' ? [] : ['WoodenChair_01', 'Shelf_01', 'wooden_bookshelf_worn', 'Television_01', 'painted_wooden_chair_01', 'old_bed_frame'];
    let n = 0;
    for (let y = b.y0 + 1; y < b.y0 + b.h - 1 && n < 3; y++) for (let x = b.x0 + 1; x < b.x0 + b.w - 1 && n < 3; x++) {
      if (!free(x, y) || rng() > 0.35 || !deco.length) continue;
      const wall = DIR4.find(([dx, dy]) => { const o = map.objAt(x + dx, y + dy); return o && o.type === 'wall'; });
      if (!wall) continue;
      const [dx, dy] = wall;
      const name = deco[Math.floor(rng() * deco.length)];
      if (place(parent, name, x + dx * 0.3, y + dy * 0.3, { fitW: 0.55, fitH: name === 'Shelf_01' || name === 'wooden_bookshelf_worn' ? 1.2 : 0.7, rot: Math.atan2(-dx, -dy) })) n++;
    }
  }
  // grass tufts from the rendered scan: dense along kerbs, walls and fences, lighter in the open
  if ((biome === 'town' || biome === 'farm') && hasGrassImpostor()) {
    const mats = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (T(x, y) !== 'grass') continue;
      for (const [dx, dy] of DIR4) {
        const edge = !map.inside(x + dx, y + dy) || T(x + dx, y + dy) !== 'grass' || map.objAt(x + dx, y + dy);
        const k = edge ? (biome === 'farm' ? 0 : 3) : 0;
        for (let i = 0; i < k; i++) {
          const along = (rng() - 0.5) * 0.95, inward = edge ? 0.5 - rng() * 0.2 : rng() * 0.5;
          const px = x + (dx ? dx * inward : along), pz = y + (dy ? dy * inward : along);
          if (!free(x, y) && Math.hypot(px - x, pz - y) < 0.45) continue;
          const sc = (edge ? 0.75 : 0.55) + rng() * 0.45;
          q.setFromAxisAngle(up, rng() * 6.28);
          mats.push(m4.clone().compose(new THREE.Vector3(px, 0, pz), q, new THREE.Vector3(sc, sc * (0.7 + rng() * 0.6), sc)));
        }
      }
    }
    const im = new THREE.InstancedMesh(grassCardGeometry(), grassMaterial(), Math.min(mats.length, 4000));
    for (let i = 0; i < im.count; i++) im.setMatrixAt(i, mats[i]);
    im.instanceMatrix.needsUpdate = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    im.userData.noAO = true;
    parent.add(im);
  }
  // grass clumps on grass tiles, instanced
  if (biome === 'town' || biome === 'farm' || biome === 'yard') {
    const light = (v) => { let n = 0; v.obj.traverse((o) => { if (o.isMesh) n += o.geometry.attributes.position.count; }); return n < 900; };
    const vs = [...variants('grass_medium_01'), ...variants('grass_medium_02')].filter(light);
    if (vs.length) {
      const per = 0;
      const lists = vs.map(() => []);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
        if (biome === 'yard') {
          // the port: gold scrub at the foot of containers, walls and barriers
          const nb = DIR4.find(([dx, dy]) => map.inside(x + dx, y + dy) && map.objAt(x + dx, y + dy));
          if (nb && free(x, y) && T(x, y) !== 'road' && rng() < 0.45) {
            // in the open tile, just off the object (props and containers overhang their tiles)
            const cx = x - nb[0] * 0.12, cz = y - nb[1] * 0.12;
            for (let k = 9 + Math.floor(rng() * 6); k > 0; k--) {
              const vi = Math.floor(rng() * vs.length), sz = vs[vi].size;
              const sy = (0.3 + rng() * 0.32) / Math.max(0.04, sz.y);
              const sw = Math.min(sy, 0.55 / Math.max(0.02, sz.x, sz.z));
              q.setFromAxisAngle(up, rng() * 6.28);
              const px = cx + (nb[1] ? (rng() - 0.5) * 0.9 : (rng() - 0.5) * 0.35), pz = cz + (nb[0] ? (rng() - 0.5) * 0.9 : (rng() - 0.5) * 0.35);
              const mt = m4.clone().compose(new THREE.Vector3(px, 0, pz), q, new THREE.Vector3(sw, sy, sw));
              mt.tint = YARD_GOLD;
              lists[vi].push(mt);
            }
          }
          continue;
        }
        if (T(x, y) !== 'grass') continue;
        const edges = DIR4.filter(([dx, dy]) => !map.inside(x + dx, y + dy) || T(x + dx, y + dy) !== 'grass' || map.objAt(x + dx, y + dy));
        const n = per + edges.length;
        for (let k = 0; k < n; k++) {
          const e = k >= per && edges.length ? edges[k % edges.length] : null;
          const px = e ? x + e[0] * (0.36 + rng() * 0.12) + (e[1] ? (rng() - 0.5) * 0.9 : 0) : x + (rng() - 0.5) * 0.98;
          const pz = e ? y + e[1] * (0.36 + rng() * 0.12) + (e[0] ? (rng() - 0.5) * 0.9 : 0) : y + (rng() - 0.5) * 0.98;
          if (!free(x, y) && Math.hypot(px - x, pz - y) < 0.45) continue;
          const s = WS * (1.1 + rng() * 0.9);
          q.setFromAxisAngle(up, rng() * 6.28);
          lists[Math.floor(rng() * vs.length)].push(m4.clone().compose(new THREE.Vector3(px, 0, pz), q, new THREE.Vector3(s, s * (0.8 + rng() * 0.5), s)));
        }
        // tufts out in the open lawn: a few clumps bunched together, so big lawns are never one flat texture
        // (each variant is one blade group of a scanned clump, so a tuft bunches several, scaled to knee height)
        if (free(x, y) && rng() < (biome === 'farm' ? 0.25 : 0.12)) {
          const cx = x + (rng() - 0.5) * 0.6, cz = y + (rng() - 0.5) * 0.6;
          // lush, dry or dark: a tuft has to differ from the lawn under it to break it up
          const tint = TUFT_TINTS[Math.floor(rng() * TUFT_TINTS.length)];
          for (let k = 8 + Math.floor(rng() * 6); k > 0; k--) {
            const vi = Math.floor(rng() * vs.length), sz = vs[vi].size;
            const sy = (0.22 + rng() * 0.26) / Math.max(0.04, sz.y);
            const sw = Math.min(sy, 0.45 / Math.max(0.02, sz.x, sz.z));
            q.setFromAxisAngle(up, rng() * 6.28);
            const mt = m4.clone().compose(new THREE.Vector3(cx + (rng() - 0.5) * 0.5, 0, cz + (rng() - 0.5) * 0.5), q, new THREE.Vector3(sw, sy, sw));
            mt.tint = tint;
            lists[vi].push(mt);
          }
        }
      }
      vs.forEach((v, i) => {
        v.obj.traverse((o) => { if (o.isMesh && o.material) { o.material.alphaTest = 0.45; o.material.transparent = false; o.material.side = THREE.DoubleSide; alienFoliage(o.material); } });
        instanced(parent, v.obj, lists[i]);
      });
      // crops on the farm's fields: two rows of knee-high leafy plants a tile
      if (biome === 'farm') {
        const [geo, mat] = cropParts();
        const list = [];
        for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
          if (T(x, y) !== 'field' || !free(x, y)) continue;
          for (const dz of [-0.25, 0.25]) for (const dx of [-0.33, 0, 0.33]) {
            const s2 = 0.5 + rng() * 0.3;
            q.setFromAxisAngle(up, rng() * 6.28);
            list.push(m4.clone().compose(new THREE.Vector3(x + dx + (rng() - 0.5) * 0.08, 0, y + dz + (rng() - 0.5) * 0.06), q, new THREE.Vector3(s2, s2 * (0.85 + rng() * 0.3), s2)));
          }
        }
        if (list.length) {
          const im = new THREE.InstancedMesh(geo, mat, list.length);
          list.forEach((m, i) => im.setMatrixAt(i, m));
          im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.userData.noAO = true;
          parent.add(im);
        }
      }
    }
  }
}

// A crop plant: three crossed cards of broad violet leaves fanning from the soil.
let cropGeo = null, cropMat = null;
function cropParts() {
  if (cropGeo) return [cropGeo, cropMat];
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d'), r = makeRng(41);
  for (let i = 0; i < 22; i++) {
    const a = -Math.PI / 2 + (r() - 0.5) * 2.0, len = 120 + r() * 120, w = 14 + r() * 16;
    const tx = 128 + Math.cos(a) * len, ty = 256 + Math.sin(a) * len;
    const gr = g.createLinearGradient(128, 256, tx, ty);
    gr.addColorStop(0, '#1d1a2a'); gr.addColorStop(0.5, r() < 0.5 ? '#4c4068' : '#54466e'); gr.addColorStop(1, r() < 0.5 ? '#7e70a4' : '#8a7aa8');
    g.fillStyle = gr;
    const nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
    g.beginPath();
    g.moveTo(128, 256);
    g.quadraticCurveTo((128 + tx) / 2 + nx, (256 + ty) / 2 + ny, tx, ty);
    g.quadraticCurveTo((128 + tx) / 2 - nx, (256 + ty) / 2 - ny, 128, 256);
    g.fill();
    g.strokeStyle = 'rgba(240,200,240,.35)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(128, 256); g.lineTo(tx, ty); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cropMat = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.75 });
  const parts = [0, 1, 2].map((k) => new THREE.PlaneGeometry(0.62, 0.62).translate(0, 0.31, 0).rotateY((k * Math.PI) / 3));
  cropGeo = mergeGeometries(parts);
  return [cropGeo, cropMat];
}

// Low hills on the horizon, with a few tall masts blinking on them, so low cameras see land beyond the map
// that fades into the fog.
function horizon(parent, map, rng, biome) {
  const cx = map.w / 2, cz = map.h / 2, R = Math.max(map.w, map.h) / 2;
  const hillM = new THREE.MeshStandardMaterial({ color: { town: '#46524c', farm: '#54473f', yard: '#43464c', spire: '#2e2836' }[biome] || '#46524c', roughness: 1, metalness: 0 });
  const mastM = new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.7, metalness: 0.5 });
  const tipM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3a2a').multiplyScalar(2) });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rng() * 0.3, d = R + 42 + rng() * 40;
    const rx = 16 + rng() * 22, ry = 4 + rng() * 8, rz = 12 + rng() * 18;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10), hillM);
    hill.scale.set(rx, ry, rz);
    hill.position.set(cx + Math.cos(a) * d, -ry * 0.25, cz + Math.sin(a) * d);
    hill.rotation.y = rng() * 6.28;
    hill.userData.noAO = true;
    parent.add(hill);
    if (biome !== 'spire' && rng() < 0.35) {
      const h = 10 + rng() * 10, mx = hill.position.x + (rng() - 0.5) * rx * 0.6, mz = hill.position.z + (rng() - 0.5) * rz * 0.6;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.5, h, 6), mastM);
      mast.position.set(mx, ry * 0.6 + h / 2, mz);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), tipM);
      tip.position.set(mx, ry * 0.6 + h + 0.3, mz);
      parent.add(mast, tip);
    }
  }
}

const WHITE = new THREE.Color(1, 1, 1);
const TUFT_TINTS = [new THREE.Color(0.85, 1.2, 0.62), new THREE.Color(1.3, 1.18, 0.78), new THREE.Color(0.66, 0.86, 0.55)];
function instanced(parent, holder, mats) {
  if (!mats.length) return;
  holder.updateMatrixWorld(true);
  holder.traverse((o) => {
    if (!o.isMesh) return;
    const im = new THREE.InstancedMesh(o.geometry, o.material, mats.length);
    const local = o.matrixWorld.clone();
    mats.forEach((m, i) => im.setMatrixAt(i, m.clone().multiply(local)));
    if (mats.some((m) => m.tint)) mats.forEach((m, i) => im.setColorAt(i, m.tint || WHITE));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = false;
    im.receiveShadow = true;
    im.frustumCulled = false;
    im.userData.noAO = true;
    parent.add(im);
  });
}

function outside(parent, map, rng, biome) {
  const W = map.w, H = map.h;
  const ring = [];
  for (let i = 0; i < 64; i++) {
    const side = Math.floor(rng() * 4);
    const along = rng() * (side < 2 ? W + 16 : H + 16) - 8;
    const depth = 1.5 + rng() * 9;
    const x = side === 0 ? along : side === 1 ? along : side === 2 ? -depth - 1 : W + depth;
    const z = side === 0 ? -depth - 1 : side === 1 ? H + depth : along;
    if (side === 1 && Math.abs(x - W / 2) < 6 && depth < 5) continue; // keep the squad's back clear
    ring.push([x, z, side]);
  }
  const trees = BIOMES[biome].trees;
  for (const [x, z, side] of ring) {
    const k = rng();
    if (biome === 'town' && k < 0.28) {
      const w = 3 + Math.floor(rng() * 3), h = 3 + Math.floor(rng() * 2);
      const style = ['brick', 'plaster', 'blue'][Math.floor(rng() * 3)];
      const st = STYLE[style];
      const g = new THREE.Group();
      const body = new THREE.Mesh(wbox(x - w / 2, x + w / 2, 0, WALL_H + 0.5, z - h / 2, z + h / 2, 1.6), pbr(st.wall));
      body.castShadow = body.receiveShadow = true;
      g.add(body);
      const glassM = plain('#1c2630', { rough: 0.05, metal: 0.1, env: 1.6 });
      const frameM = plain(st.trim, { rough: 0.6 });
      const wb = new Batch();
      for (const [ax, az, nx, nz, len] of [[x, z - h / 2, 0, -1, w], [x, z + h / 2, 0, 1, w], [x - w / 2, z, -1, 0, h], [x + w / 2, z, 1, 0, h]]) {
        const count = Math.max(1, Math.floor(len / 1.4));
        for (let i = 0; i < count; i++) {
          const o = (i - (count - 1) / 2) * 1.4;
          const cxw = ax + (nz ? o : 0) + nx * 0.02, czw = az + (nx ? o : 0) + nz * 0.02;
          const sx = nz ? 0.8 : 0.04, sz = nx ? 0.8 : 0.04;
          wb.add(frameM, wbox(cxw - sx / 2 - (nz ? 0.06 : 0), cxw + sx / 2 + (nz ? 0.06 : 0), 0.9, 1.75, czw - sz / 2 - (nx ? 0.06 : 0), czw + sz / 2 + (nx ? 0.06 : 0)));
          wb.add(glassM, wbox(cxw - sx / 2 + (nx ? 0.01 : 0), cxw + sx / 2 + (nx ? 0.01 : 0), 0.96, 1.69, czw - sz / 2 + (nz ? 0.01 : 0), czw + sz / 2 + (nz ? 0.01 : 0)));
        }
      }
      wb.build(g);
      const rf = roofFor(x - w / 2, x + w / 2, z - h / 2, z + h / 2, WALL_H + 0.5, st.pitch * 0.6, 0.3);
      const rm = new THREE.Mesh(rf.roof, pbr(st.roof, { side: THREE.DoubleSide }));
      rm.castShadow = true;
      g.add(rm);
      g.add(new THREE.Mesh(rf.gable, pbr(st.wall, { side: THREE.DoubleSide })));
      parent.add(g);
    } else if (biome === 'yard' && k < 0.45) {
      const len = 2 + Math.floor(rng() * 2);
      const o = { type: 'container', tiles: Array.from({ length: len }, (_, i) => [x, z + i]), axis: rng() < 0.5 ? 'x' : 'y', color: Math.floor(rng() * 5) };
      buildCover(parent, o, map, rng, biome);
    } else if (biome === 'spire') {
      const p = buildCover(parent, { type: rng() < 0.6 ? 'pillar' : 'shard', tiles: [[x, z]] }, map, rng, biome);
      p.scale.setScalar(1 + rng() * 1.5);
    } else if (trees.length && k < 0.85) {
      place(parent, 'tree1:' + trees[Math.floor(rng() * trees.length)], x, z, { fitH: 3.8 + rng() * 2.2, rot: rng() * 6 });
    } else if (biome === 'farm') {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.78, 16), new THREE.MeshStandardMaterial({ map: (hayTex ||= hayTexture()), roughness: 1 }));
      h.rotation.z = Math.PI / 2; h.position.set(x, 0.4, z); h.castShadow = true;
      parent.add(h);
    }
  }
}
