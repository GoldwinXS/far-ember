// Far Ember: the carrier Lantern's hangar bay, home between missions. A steel deck with the dropship on its pad,
// ribbed walls with catwalks, the holo table, the armoury rack and the memorial wall, and the open bay door onto a
// planet. Built in code over a few PBR metal sets; static parts are merged per material to keep draw calls low.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { texSet } from './assets.js';
import { glowTex } from './models.js';
import { buildWeapon } from './kit.js';
import { buildDropship } from './dropship.js';
import { RANKS, CLASSES } from './data.js';

export const HANGAR_TEX = ['metal_plate_02', 'blue_metal_plate', 'metal_grate_rusty', 'box_profile_metal_sheet'];
const W = 24, L = 36, H = 10; // x -12..12, z -18..18; the bay door is the -z end
const EMBER = '#ff7a2e', NAVY = '#1b2a44';
export const SHIP_AT = new THREE.Vector3(0, 0, -1);
const EMBLEM = ['M60 5 L107 29 L100 87 L60 115 L20 87 L13 29 Z', 'M60 24 L67 53 L94 61 L67 69 L60 98 L53 69 L26 61 L53 53 Z'];

// Camera spots for each screen: where the eye stands, the subject, and how far across the screen the subject sits
// (the menus fill the left half on a wide screen), plus a slow sway for the wide shot.
export const STATIONS = {
  title: { eye: [-10.5, 4.2, 16.5], look: [0, 2, -2], x: 0.92, drift: 0.4 },
  ops: { eye: [3.7, 2.5, -4.6], look: [8.2, 1.5, -9.4], x: 0.7, fill: 3.0 },
  armoury: { eye: [4.0, 1.75, 11.0], look: [10.6, 1.2, 6.4], x: 0.7, fill: 2.6 },
  memorial: { eye: [3.0, 1.9, 10.6], look: [6.6, 2.4, 17.6], x: 0.68, fill: 2.3 },
  squad: { eye: [4.3, 1.05, 12.9], look: [0.35, 1.55, 6.1], x: 0.74, fill: 1.4 },
  soldier: { eye: [1.75, 1.0, 9.4], look: [0.35, 0.78, 6.3], x: 0.72 },
};
export const LINE_Z = 6.3;

// ------------------------------------------------------------ helpers
function boxUV(g, w, h, d) {
  const uv = g.attributes.uv;
  const f = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let i = 0; i < uv.count; i++) { const [a, b] = f[Math.floor(i / 4)]; uv.setXY(i, uv.getX(i) * a, uv.getY(i) * b); }
  return g;
}
const B = (w, h, d) => boxUV(new THREE.BoxGeometry(w, h, d), w, h, d);
const planeUV = (w, h) => { const g = new THREE.PlaneGeometry(w, h); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h); return g; };
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function ctex(c, srgb = true) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
function rngOf(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const glow = (c, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) });

// Static meshes go into per-material buckets and are merged at the end.
class Builder {
  constructor() { this.buckets = new Map(); this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); }
  add(geo, mat, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
    this.m.compose(new THREE.Vector3(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
    this.addMatrix(geo, mat, this.m);
  }
  addMatrix(geo, mat, matrix) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(g);
  }
  // bake a built group (a gun, a crate) into the buckets
  addObject(obj, matrix) {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => { if (o.isMesh) this.addMatrix(o.geometry, o.material, new THREE.Matrix4().multiplyMatrices(matrix, o.matrixWorld)); });
  }
  build(group) {
    for (const [mat, list] of this.buckets) {
      const mesh = new THREE.Mesh(mergeGeometries(list), mat);
      mesh.castShadow = !mat.userData.noShadow;
      mesh.receiveShadow = true;
      if (mat.transparent) mesh.userData.noAO = true;
      group.add(mesh);
    }
  }
}

let mats = null;
function materials() {
  if (mats) return mats;
  const S = {};
  for (const s of HANGAR_TEX) S[s] = texSetSync(s);
  // tile sizes in world units
  const pbr = (slug, color, tile, o = {}) => {
    const s = S[slug];
    const c = (t) => { const x = t.clone(); x.wrapS = x.wrapT = THREE.RepeatWrapping; x.repeat.set(1 / tile, 1 / tile); x.needsUpdate = true; return x; };
    const m = new THREE.MeshStandardMaterial({ color, map: c(s.map), normalMap: c(s.normalMap), roughnessMap: c(s.arm), roughness: o.rough ?? 1, metalness: o.metal ?? 0.5, envMapIntensity: o.env ?? 1 });
    m.normalScale.set(o.ns ?? 1, o.ns ?? 1);
    return m;
  };
  mats = {
    deck: pbr('metal_plate_02', '#a7afba', 4, { rough: 0.9, metal: 0.55, ns: 1.2 }),
    wall: pbr('blue_metal_plate', '#d2dcec', 5, { rough: 1, metal: 0.35 }),
    wallDark: pbr('metal_plate_02', '#7a828e', 3, { rough: 1, metal: 0.45 }),
    rib: pbr('metal_plate_02', '#6f7783', 2.5, { rough: 0.85, metal: 0.65 }),
    ceiling: pbr('metal_plate_02', '#3a4049', 4, { rough: 1, metal: 0.4 }),
    ribbed: pbr('box_profile_metal_sheet', '#8b96a6', 3, { rough: 0.9, metal: 0.5 }),
    grate: pbr('metal_grate_rusty', '#7c8590', 1.2, { rough: 0.9, metal: 0.6 }),
    crateNavy: pbr('blue_metal_plate', '#c8d2e0', 1.6, { rough: 0.9, metal: 0.3 }),
    crateOlive: pbr('metal_plate_02', '#7f8a62', 1.6, { rough: 0.9, metal: 0.3 }),
    steel: new THREE.MeshStandardMaterial({ color: '#59616b', roughness: 0.42, metalness: 0.85 }),
    dark: new THREE.MeshStandardMaterial({ color: '#23272d', roughness: 0.6, metalness: 0.5 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#1a1c1f', roughness: 0.75 }),
    pipeEmber: new THREE.MeshStandardMaterial({ color: '#b5531f', roughness: 0.5, metalness: 0.4 }),
    pipeTeal: new THREE.MeshStandardMaterial({ color: '#2d6670', roughness: 0.5, metalness: 0.4 }),
    paintEmber: new THREE.MeshStandardMaterial({ color: EMBER, roughness: 0.55, metalness: 0.1 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.7, metalness: 0.2 }),
    lampCool: glow('#e6eeff', 3.2),
    lampWarm: glow('#ffc890', 2.6),
    lampEmber: glow('#ff7a2e', 2.2),
    lampTeal: glow('#58e0ff', 2.2),
    lampRed: glow('#ff3a2a', 2.2),
    windowGlow: new THREE.MeshStandardMaterial({ color: '#0a121c', emissive: '#2c4c6e', emissiveIntensity: 0.7, roughness: 0.08, metalness: 0.7 }),
  };
  for (const k of ['ceiling', 'wall', 'wallDark', 'lampCool', 'lampWarm', 'lampEmber', 'lampTeal', 'lampRed', 'windowGlow']) mats[k].userData.noShadow = true;
  return mats;
}
// texSet is async and cached; prepareCarrier awaits every set first, so here we only read the resolved value
const resolved = new Map();
export async function loadHangar() {
  await Promise.all(HANGAR_TEX.map(async (s) => resolved.set(s, await texSet(s))));
  try { await document.fonts.load('700 64px "Chakra Petch"'); await document.fonts.load('400 40px "Michroma"'); } catch { /* system font then */ }
}
function texSetSync(s) { return resolved.get(s); }

function hazardTex() {
  const c = canvas(128, 128), g = c.getContext('2d');
  g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#e2ad24';
  for (let i = -128; i < 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 32, 0); g.lineTo(i + 160, 128); g.lineTo(i + 128, 128); g.fill(); }
  const t = ctex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.4, 1.4);
  return t;
}
function emblem(g, x, y, s, fill = NAVY) {
  g.save(); g.translate(x, y); g.scale(s / 120, s / 120);
  const shield = new Path2D(EMBLEM[0]), star = new Path2D(EMBLEM[1]);
  g.fillStyle = fill; g.fill(shield);
  g.lineWidth = 6; g.strokeStyle = EMBER; g.stroke(shield);
  g.fillStyle = EMBER; g.fill(star);
  g.restore();
}
// Wear a canvas: knock random specks out of the paint.
function wear(g, w, h, n, rnd, max = 3) {
  g.save(); g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < n; i++) { g.globalAlpha = 0.2 + rnd() * 0.6; g.beginPath(); g.arc(rnd() * w, rnd() * h, 0.5 + rnd() * max, 0, 7); g.fill(); }
  g.restore();
}

// ------------------------------------------------------------ deck markings
function deckDecal() {
  const S = 42.667, cw = W * S, ch = L * S, rnd = rngOf(11);
  const c = canvas(cw, ch), g = c.getContext('2d');
  const X = (x) => (x + W / 2) * S, Z = (z) => (z + L / 2) * S;
  const paint = 'rgba(232,222,190,.9)', yellow = 'rgba(226,173,36,.92)';
  // landing pad: a double ring, ticks and a cross
  const px = X(SHIP_AT.x), pz = Z(SHIP_AT.z);
  g.strokeStyle = paint; g.lineWidth = 0.18 * S;
  g.beginPath(); g.arc(px, pz, 5.6 * S, 0, 7); g.stroke();
  g.setLineDash([0.9 * S, 0.5 * S]); g.lineWidth = 0.1 * S;
  g.beginPath(); g.arc(px, pz, 5.1 * S, 0, 7); g.stroke();
  g.setLineDash([]);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath(); g.moveTo(px + Math.cos(a) * 5.75 * S, pz + Math.sin(a) * 5.75 * S); g.lineTo(px + Math.cos(a) * 6.2 * S, pz + Math.sin(a) * 6.2 * S); g.stroke();
  }
  g.fillStyle = yellow;
  for (const [a, b] of [[px - 0.09 * S, pz - 4.6 * S], [px - 4.6 * S, pz - 0.09 * S]]) g.fillRect(a, b, a === px - 0.09 * S ? 0.18 * S : 9.2 * S, a === px - 0.09 * S ? 9.2 * S : 0.18 * S);
  // pad number and bay name ahead of the nose, reading from the door
  g.save(); g.translate(px, Z(-8.2));
  g.fillStyle = paint; g.font = `700 ${2.4 * S}px "Chakra Petch", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('02', 0, 0);
  g.restore();
  g.save(); g.translate(X(-4.6), Z(5.4)); g.font = `600 ${0.62 * S}px "Chakra Petch", sans-serif`; g.textAlign = 'center'; g.fillStyle = paint;
  g.fillText('BAY 2', 0, 0); g.restore();
  // chevrons pointing out of the door
  for (let i = 0; i < 4; i++) {
    const z = Z(-10.5 - i * 1.2);
    g.fillStyle = yellow;
    g.beginPath(); g.moveTo(px - 1.2 * S, z + 0.6 * S); g.lineTo(px, z); g.lineTo(px + 1.2 * S, z + 0.6 * S); g.lineTo(px + 1.2 * S, z + 0.9 * S); g.lineTo(px, z + 0.3 * S); g.lineTo(px - 1.2 * S, z + 0.9 * S); g.fill();
  }
  // hazard band across the door threshold
  g.save(); g.beginPath(); g.rect(X(-9), Z(-17.6), 18 * S, 1.1 * S); g.clip();
  g.fillStyle = 'rgba(20,20,20,.85)'; g.fillRect(X(-9), Z(-17.6), 18 * S, 1.1 * S);
  g.fillStyle = yellow;
  for (let x = X(-10); x < X(10); x += 0.9 * S) { g.beginPath(); g.moveTo(x, Z(-17.6)); g.lineTo(x + 0.45 * S, Z(-17.6)); g.lineTo(x + 1.55 * S, Z(-16.5)); g.lineTo(x + 1.1 * S, Z(-16.5)); g.fill(); }
  g.restore();
  // walkways: dashed lines down both sides, a crossing by the memorial
  g.fillStyle = yellow;
  for (const x of [-7.4, 7.4]) for (let z = -15.5; z < 16.5; z += 1.4) g.fillRect(X(x) - 0.07 * S, Z(z), 0.14 * S, 0.8 * S);
  for (const z of [11.5, 12.6]) for (let x = -7.2; x < 7.3; x += 0.9) g.fillRect(X(x), Z(z) - 0.06 * S, 0.5 * S, 0.12 * S);
  // stencils by the walls
  g.fillStyle = 'rgba(232,222,190,.7)'; g.font = `600 ${0.55 * S}px "Chakra Petch", sans-serif`;
  for (const [t, x, z, r] of [['LOAD 1', -10.6, -9, Math.PI / 2], ['LOAD 2', -10.6, 2, Math.PI / 2], ['ARMOURY', 10.2, 2, Math.PI / 2], ['FUEL', -5.8, 4.8, 0]]) {
    g.save(); g.translate(X(x), Z(z)); g.rotate(r); g.textAlign = 'center'; g.fillText(t, 0, 0); g.restore();
  }
  // skid marks and scuffs
  for (let i = 0; i < 70; i++) {
    const a = rnd() * 7, r = 1 + rnd() * 6, x = X(-8 + rnd() * 16), z = Z(-14 + rnd() * 26);
    g.strokeStyle = `rgba(15,15,15,${0.08 + rnd() * 0.12})`; g.lineWidth = 0.05 * S + rnd() * 0.12 * S;
    g.beginPath(); g.arc(x, z, r * S, a, a + 0.3 + rnd() * 0.6); g.stroke();
  }
  for (let i = 0; i < 160; i++) {
    const x = rnd() * cw, y = rnd() * ch, r = (0.4 + rnd() * 2.2) * S;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(12,12,14,${0.06 + rnd() * 0.12})`); gr.addColorStop(1, 'rgba(12,12,14,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  wear(g, cw, ch, 9000, rnd, 2.2);
  const t = ctex(c);
  t.anisotropy = 16;
  return t;
}

// A big painted word or number for a wall, worn.
function wallPaint(text, w, h, color, font, extra) {
  const c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = color; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2);
  if (extra) extra(g, w, h);
  wear(g, w, h, 2600, rngOf(text.length * 13), 2.5);
  return ctex(c);
}

// Glowing console screens: bars, plots and lines of text, in teal and ember.
function screenTex(seed) {
  const rnd = rngOf(seed), c = canvas(256, 160), g = c.getContext('2d');
  g.fillStyle = '#04121a'; g.fillRect(0, 0, 256, 160);
  g.strokeStyle = 'rgba(90,224,255,.35)'; g.lineWidth = 1;
  for (let x = 8; x < 256; x += 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 160); g.stroke(); }
  g.strokeStyle = '#58e0ff'; g.lineWidth = 2; g.beginPath();
  for (let x = 0; x < 140; x += 4) g.lineTo(10 + x, 60 - Math.sin(x * 0.08 + seed) * 18 - rnd() * 10);
  g.stroke();
  for (let i = 0; i < 6; i++) { g.fillStyle = i === 2 ? EMBER : '#58e0ff'; g.fillRect(160, 14 + i * 13, 20 + rnd() * 70, 7); }
  g.fillStyle = 'rgba(160,236,255,.8)';
  for (let i = 0; i < 6; i++) g.fillRect(12, 96 + i * 10, 40 + rnd() * 180, 3);
  return ctex(c);
}

// ------------------------------------------------------------ shaders
const NOISE = `
  float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++){ s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }`;
const SPHERE_VS = `varying vec3 vObj; varying vec3 vWN; varying vec3 vWP;
  void main(){ vObj = position; vWN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
// The planet's surface is worked out once into two textures laid out like a sphere's UVs (rgb ground colour with
// cloud cover in alpha; land, city lights and ice), so the sphere itself costs a couple of lookups per pixel.
let planetMaps = null;
function bakePlanet(renderer) {
  if (planetMaps) return planetMaps;
  const W = 2048, H = 1024;
  const make = () => { const rt = new THREE.WebGLRenderTarget(W, H, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter }); rt.texture.wrapS = THREE.RepeatWrapping; return rt; };
  const A = make(), B = make();
  const vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  // the same point on the unit sphere that SphereGeometry puts at this uv
  const head = `${NOISE} varying vec2 vUv;
    vec3 spherePoint(vec2 uv){ float ph = uv.x * 6.2831853, th = (1.0 - uv.y) * 3.1415926; return vec3(-cos(ph) * sin(th), cos(th), sin(ph) * sin(th)); }`;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  const sc = new THREE.Scene();
  sc.add(quad);
  const cam = new THREE.Camera();
  quad.material = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: `${head}
    void main(){
      vec3 p = spherePoint(vUv);
      float h = fbm(p * 2.4 + 3.0);
      float land = smoothstep(0.5, 0.525, h);
      float shelf = smoothstep(0.43, 0.5, h) * (1.0 - land);
      float dry = smoothstep(0.46, 0.62, fbm(p * 3.1 + 11.0));
      vec3 ground = mix(vec3(0.17, 0.19, 0.18), vec3(0.58, 0.34, 0.14), dry) * (0.7 + 0.6 * fbm(p * 14.0));
      vec3 sea = mix(vec3(0.015, 0.06, 0.07), vec3(0.05, 0.2, 0.19), shelf);
      float ice = smoothstep(0.8, 0.88, abs(p.y) + (fbm(p * 6.0) - 0.5) * 0.14);
      vec3 col = mix(mix(sea, ground, land), vec3(0.85, 0.9, 0.95), ice);
      // clouds in bands along the latitudes, broken up by noise
      float band = 0.5 + 0.5 * sin(p.y * 9.0 + fbm(p * 4.0) * 5.0);
      float cl = smoothstep(0.6, 0.84, fbm(p * vec3(2.0, 6.0, 2.0) + fbm(p * 7.0) * 0.7) * 0.8 + band * 0.22);
      gl_FragColor = vec4(col, cl);
    }` });
  renderer.setRenderTarget(A); renderer.render(sc, cam);
  quad.material.dispose();
  quad.material = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: `${head}
    void main(){
      vec3 p = spherePoint(vUv);
      float land = smoothstep(0.5, 0.525, fbm(p * 2.4 + 3.0));
      float ice = smoothstep(0.8, 0.88, abs(p.y) + (fbm(p * 6.0) - 0.5) * 0.14);
      float city = smoothstep(0.55, 0.7, fbm(p * 16.0)) * smoothstep(0.45, 0.62, fbm(p * 55.0)) * land * (1.0 - ice);
      gl_FragColor = vec4(land, city, ice, 1.0);
    }` });
  renderer.setRenderTarget(B); renderer.render(sc, cam);
  renderer.setRenderTarget(null);
  quad.material.dispose(); quad.geometry.dispose();
  planetMaps = { surface: A.texture, masks: B.texture };
  return planetMaps;
}
const SPHERE_UV_VS = `varying vec2 vUv; varying vec3 vWN; varying vec3 vWP;
  void main(){ vUv = uv; vWN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
function planetMat(sun, maps) {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sun }, uTime: { value: 0 }, tA: { value: maps.surface }, tB: { value: maps.masks } },
    vertexShader: SPHERE_UV_VS,
    fragmentShader: `uniform vec3 uSun; uniform float uTime; uniform sampler2D tA; uniform sampler2D tB; varying vec2 vUv; varying vec3 vWN; varying vec3 vWP;
      void main(){
        vec3 n = normalize(vWN), V = normalize(cameraPosition - vWP);
        vec4 s = texture2D(tA, vUv);
        vec3 m = texture2D(tB, vUv).rgb;
        float cl = texture2D(tA, vUv + vec2(uTime * 0.0004, 0.0)).a;
        float day = dot(n, uSun);
        float lit = smoothstep(-0.1, 0.4, day);
        vec3 c = s.rgb * lit * 0.8;
        vec3 R = reflect(-uSun, n);
        c += (1.0 - m.r) * (1.0 - cl) * pow(max(dot(R, V), 0.0), 28.0) * 0.25 * lit;
        c = mix(c, vec3(0.44, 0.47, 0.52) * (lit + 0.01), cl * 0.75);
        float night = 1.0 - smoothstep(-0.3, 0.02, day);
        c += vec3(1.0, 0.58, 0.22) * m.g * night * (1.0 - cl) * 3.0;
        // lightning in the night side's storms
        c += vec3(0.6, 0.7, 1.0) * cl * night * step(0.996, fract(sin(dot(floor(vUv * 160.0), vec2(12.9, 78.2)) + floor(uTime * 3.0)) * 43758.5)) * 0.9;
        float f = 1.0 - max(dot(n, V), 0.0);
        c += vec3(0.3, 0.68, 0.78) * pow(f, 3.0) * (0.1 + lit) * 0.8;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
function atmosMat(sun, edge) {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sun } },
    vertexShader: SPHERE_VS, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    fragmentShader: `uniform vec3 uSun; varying vec3 vObj; varying vec3 vWN; varying vec3 vWP;
      void main(){
        vec3 n = normalize(vWN), V = normalize(cameraPosition - vWP);
        float g = pow(clamp(-dot(n, V) / ${edge.toFixed(3)}, 0.0, 1.0), 2.2);
        float lit = smoothstep(-0.35, 0.5, dot(n, uSun));
        vec3 c = vec3(0.32, 0.72, 0.86) * g * (0.06 + lit) * 0.9;
        gl_FragColor = vec4(c, g);
        #include <colorspace_fragment>
      }`,
  });
}
function moonMat(sun) {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sun } }, vertexShader: SPHERE_VS,
    fragmentShader: `uniform vec3 uSun; varying vec3 vObj; varying vec3 vWN; varying vec3 vWP; ${NOISE}
      void main(){ vec3 p = normalize(vObj), n = normalize(vWN);
        float m = fbm(p * 3.0), cr = smoothstep(0.55, 0.62, fbm(p * 9.0 + 4.0));
        vec3 col = vec3(0.55, 0.53, 0.5) * (0.6 + 0.6 * m) * (1.0 - cr * 0.35);
        float lit = smoothstep(-0.05, 0.3, dot(n, uSun));
        gl_FragColor = vec4(col * lit * 1.1, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
function holoMat(maps) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, tB: { value: maps.masks } }, vertexShader: SPHERE_UV_VS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    fragmentShader: `uniform float uTime; uniform sampler2D tB; varying vec2 vUv; varying vec3 vWN; varying vec3 vWP;
      void main(){
        vec3 n = normalize(vWN), V = normalize(cameraPosition - vWP);
        float la = vUv.y;
        float land = smoothstep(0.25, 0.75, sin(la * 44.0 + sin(la * 9.0) * 2.0 + sin(vUv.x * 12.566 + la * 20.0) * 0.5) * 0.5 + 0.5) * 0.7;
        vec2 sd = (vUv - vec2(0.62, 0.38)) * vec2(1.0, 2.6);
        land += smoothstep(0.06, 0.0, length(sd)) * 0.8 + smoothstep(0.075, 0.06, length(sd)) * 0.5;
        float f = 1.0 - abs(dot(n, V));
        float scan = smoothstep(0.75, 1.0, sin(vWP.y * 70.0 - uTime * 3.0) * 0.5 + 0.5);
        float lon = smoothstep(0.97, 1.0, sin(vUv.x * 56.5)), lat = smoothstep(0.97, 1.0, sin((vUv.y - 0.5) * 28.3));
        float a = 0.05 + land * 0.32 + pow(f, 2.0) * 0.55 + scan * 0.12 + (lon + lat) * 0.1;
        gl_FragColor = vec4(vec3(0.3, 0.85, 1.0) * a * 1.8, a);
        #include <colorspace_fragment>
      }`,
  });
}
function coneMat(color, k) {
  return new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Color(color) }, uK: { value: k } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform vec3 uC; uniform float uK; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ float e = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.0); float a = pow(clamp(vUv.y, 0.0, 1.0), 1.5) * e * uK; gl_FragColor = vec4(uC * a, a);
        #include <colorspace_fragment>
      }`,
  });
}
function fieldMat() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; varying vec2 vUv;
      void main(){
        float ex = smoothstep(0.93, 1.0, abs(vUv.x * 2.0 - 1.0)), ey = smoothstep(0.9, 1.0, abs(vUv.y * 2.0 - 1.0));
        float band = smoothstep(0.9, 1.0, sin(vUv.y * 34.0 + uTime * 1.3) * 0.5 + 0.5);
        float a = 0.018 + max(ex, ey) * 0.18 + band * 0.025;
        gl_FragColor = vec4(vec3(0.35, 0.75, 1.0) * a * 2.0, a);
        #include <colorspace_fragment>
      }`,
  });
}
function starfield() {
  const w = 2048, h = 1024, rnd = rngOf(3);
  const c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#020309'; g.fillRect(0, 0, w, h);
  // the galaxy's band and two faint nebulae, roughly where the bay door looks out (u about 0.75)
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * w, y = h * 0.42 + Math.sin(x / w * Math.PI * 2) * h * 0.12 + (rnd() - 0.5) * h * 0.14, r = 6 + rnd() * 30;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(150,160,200,${0.012 + rnd() * 0.02})`); gr.addColorStop(1, 'rgba(150,160,200,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (const [x, y, r, col] of [[0.7, 0.33, 260, '90,50,140'], [0.8, 0.4, 200, '30,110,140'], [0.74, 0.3, 140, '160,70,90']]) {
    const gr = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, r);
    gr.addColorStop(0, `rgba(${col},.22)`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.fillRect(x * w - r, y * h - r, r * 2, r * 2);
  }
  for (let i = 0; i < 4200; i++) {
    const b = rnd() ** 3, x = rnd() * w, y = rnd() * h;
    const tint = rnd();
    g.fillStyle = `rgba(${tint < 0.2 ? '255,214,170' : tint < 0.5 ? '200,215,255' : '255,255,255'},${0.25 + b * 0.75})`;
    if (b > 0.5) { g.beginPath(); g.arc(x, y, 0.5, 0, 7); g.fill(); }
  }
  const t = ctex(c);
  t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------ memorial wall
function memorialCanvas(fallen) {
  const cw = 2048, chh = 1160, c = canvas(cw, chh), g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, chh);
  grad.addColorStop(0, '#15181d'); grad.addColorStop(1, '#0d0f12');
  g.fillStyle = grad; g.fillRect(0, 0, cw, chh);
  emblem(g, cw / 2 - 60, 30, 120, '#0d0f12');
  g.fillStyle = '#e8c79a'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '400 46px "Michroma", sans-serif';
  g.fillText('THEY HELD THE LINE', cw / 2, 196);
  g.fillStyle = 'rgba(232,199,154,.55)'; g.fillRect(cw / 2 - 340, 232, 680, 2);
  const cols = 5, rows = 6, pw = 360, ph = 118, gx = 22, gy = 16;
  // the slot nearest the wall's centre takes the first name, then outward
  const slots = Array.from({ length: cols * rows }, (_, i) => i).sort((a, b) => Math.hypot((a % cols) - 2, Math.floor(a / cols) - 2.5) - Math.hypot((b % cols) - 2, Math.floor(b / cols) - 2.5));
  const order = new Array(cols * rows);
  slots.forEach((slot, k) => { order[slot] = k; });
  const x0 = (cw - (cols * pw + (cols - 1) * gx)) / 2, y0 = 262;
  for (let i = 0; i < cols * rows; i++) {
    const x = x0 + (i % cols) * (pw + gx), y = y0 + Math.floor(i / cols) * (ph + gy);
    const f = fallen[order[i]];
    if (!f) { g.strokeStyle = 'rgba(200,170,130,.24)'; g.lineWidth = 2; g.strokeRect(x, y, pw, ph); continue; }
    const pg = g.createLinearGradient(x, y, x, y + ph);
    pg.addColorStop(0, '#8a6a42'); pg.addColorStop(0.5, '#a88452'); pg.addColorStop(1, '#6e5233');
    g.fillStyle = pg; g.fillRect(x, y, pw, ph);
    g.strokeStyle = '#3d2c1a'; g.lineWidth = 3; g.strokeRect(x + 5, y + 5, pw - 10, ph - 10);
    g.fillStyle = '#2b1f12';
    g.font = '700 34px "Chakra Petch", sans-serif';
    const nm = f.callsign ? `${f.name.split(' ')[0]} "${f.callsign}" ${f.name.split(' ').slice(1).join(' ')}` : f.name;
    g.fillText(nm.length > 24 ? nm.slice(0, 23) + '.' : nm, x + pw / 2, y + 40, pw - 24);
    g.font = '600 21px "Chakra Petch", sans-serif';
    g.fillText(`${RANKS[f.rank]?.name || ''} · ${CLASSES[f.cls]?.name || ''}`.toUpperCase(), x + pw / 2, y + 74, pw - 24);
    g.font = '500 18px "Chakra Petch", sans-serif';
    g.fillText((f.where || '').toUpperCase(), x + pw / 2, y + 98, pw - 24);
  }
  if (fallen.length > cols * rows) { g.fillStyle = '#e8c79a'; g.font = '600 26px "Chakra Petch", sans-serif'; g.fillText(`and ${fallen.length - cols * rows} more`, cw / 2, chh - 24); }
  return c;
}

// ------------------------------------------------------------ build
export function buildCarrier(view) {
  const M = materials();
  const root = new THREE.Group();
  root.name = 'carrier';
  const b = new Builder();
  const rnd = rngOf(5);

  // deck (runs out past the door as a launch lip) and its markings
  const deck = new THREE.Mesh(planeUV(W, L + 4).rotateX(-Math.PI / 2), M.deck);
  deck.position.set(0, 0, -2);
  deck.receiveShadow = true;
  root.add(deck);
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(W, L).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: deckDecal(), transparent: true, roughness: 0.62, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2 }));
  decal.position.y = 0.004;
  decal.receiveShadow = true;
  decal.userData.noAO = true;
  root.add(decal);
  // the lip's outer edge: a drop into space with a row of edge lights
  b.add(B(W, 3, 0.4), M.wallDark, 0, -1.5, -20.2);
  for (let x = -8.5; x <= 8.5; x += 1.0) b.add(B(0.45, 0.06, 0.14), M.lampCool, x, 0.03, -19.85);

  // side walls: plating, I-beam ribs, a skirting, pipes, a catwalk with rails, wall lamps
  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(planeUV(L, H).rotateY(-s * Math.PI / 2), M.wall);
    wall.position.set(s * W / 2, H / 2, 0);
    wall.receiveShadow = true;
    root.add(wall);
    b.add(B(0.4, 1.1, L), M.wallDark, s * (W / 2 - 0.2), 0.55, 0);
    b.add(B(0.25, 0.5, L), M.ribbed, s * (W / 2 - 0.12), 7.4, 0);
    for (let z = -16; z <= 16; z += 4) {
      b.add(B(0.85, H, 0.2), M.rib, s * (W / 2 - 0.42), H / 2, z);
      b.add(B(0.14, H, 0.62), M.rib, s * (W / 2 - 0.86), H / 2, z);
      b.add(B(0.06, 0.34, 0.24), M.lampCool, s * (W / 2 - 0.95), 3.3, z);
      // catwalk brace
      b.add(B(0.12, 0.12, 2.3), M.steel, s * (W / 2 - 1.05), 3.95, z, 0, 0, 0);
    }
    for (const [y, r, m] of [[1.5, 0.11, M.dark], [1.82, 0.14, M.pipeEmber], [2.2, 0.08, M.pipeTeal], [2.42, 0.08, M.dark]]) b.add(new THREE.CylinderGeometry(r, r, L, 12).rotateX(Math.PI / 2), m, s * (W / 2 - 0.62), y, 0);
    // catwalk at 4.6 along the wall
    const cx = s * (W / 2 - 1.05);
    b.add(B(2.1, 0.08, L), M.grate, cx, 4.6, 0);
    b.add(B(0.05, 0.16, L), M.steel, cx - s * 1.04, 4.72, 0);
    for (let z = -17; z <= 17; z += 2) b.add(new THREE.CylinderGeometry(0.028, 0.028, 1.0, 6), M.steel, cx - s * 1.04, 5.1, z);
    for (const y of [5.12, 5.6]) b.add(new THREE.CylinderGeometry(0.025, 0.025, L, 6).rotateX(Math.PI / 2), M.steel, cx - s * 1.04, y, 0);
    // upper control windows on the right wall
    if (s > 0) for (let z = -10; z <= 10; z += 4) { b.add(B(0.1, 1.2, 3.2), M.windowGlow, W / 2 - 0.08, 7.0, z + 2); b.add(B(0.14, 0.1, 3.3), M.steel, W / 2 - 0.12, 7.65, z + 2); b.add(B(0.14, 0.1, 3.3), M.steel, W / 2 - 0.12, 6.35, z + 2); }
  }
  // big wall paint: the bay number on the left, the company emblem on the right
  const paintMat = (t) => new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
  const p02 = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.6).rotateY(Math.PI / 2), paintMat(wallPaint('02', 1024, 512, 'rgba(226,173,36,.85)', '700 420px "Chakra Petch", sans-serif')));
  p02.position.set(-W / 2 + 0.05, 7.0, -10);
  root.add(p02);
  const pe = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2).rotateY(-Math.PI / 2), paintMat(wallPaint('EMBER COMPANY', 2048, 500, 'rgba(232,222,200,.82)', '400 150px "Michroma", sans-serif', (g, w) => emblem(g, 30, 60, 380, 'rgba(27,42,68,.9)'))));
  pe.position.set(W / 2 - 0.05, 8.6, 6);
  root.add(pe);

  // ceiling: plating, cross girders, light panels, a gantry crane over the pad
  const ceil = new THREE.Mesh(planeUV(W, L).rotateX(Math.PI / 2), M.ceiling);
  ceil.position.y = H;
  root.add(ceil);
  for (let z = -16; z <= 16; z += 4) b.add(B(W, 0.7, 0.4), M.rib, 0, H - 0.35, z);
  for (const x of [-4.5, 4.5]) b.add(B(0.45, 0.5, L), M.rib, x, H - 0.95, 0);
  const fixtures = [];
  for (const x of [-8.5, -4.5, 4.5, 8.5]) for (let z = -14; z <= 14; z += 4) {
    b.add(B(1.7, 0.16, 0.7), M.dark, x, H - 1.28, z);
    b.add(B(1.5, 0.04, 0.5), M.lampCool, x, H - 1.37, z);
    fixtures.push([x, z]);
  }
  b.add(B(W - 1, 0.5, 0.6), M.paintEmber, 0, 8.6, 0.5);
  b.add(B(1.0, 0.6, 1.0), M.dark, 2.5, 8.15, 0.5);
  b.add(new THREE.CylinderGeometry(0.02, 0.02, 3.2, 4), M.steel, 2.5, 6.25, 0.5);

  // the bay door: pillars, lintel, hazard-striped frame, beacons; a faint force field across the opening
  b.add(B(3.2, H, 1.4), M.wallDark, -10.4, H / 2, -18);
  b.add(B(3.2, H, 1.4), M.wallDark, 10.4, H / 2, -18);
  b.add(B(18, 2.5, 1.4), M.wallDark, 0, 8.75, -18);
  for (const s of [-1, 1]) b.add(B(0.3, 7.5, 1.5), M.hazard, s * 8.85, 3.75, -18);
  b.add(B(18, 0.3, 1.5), M.hazard, 0, 7.35, -18);
  b.add(B(17.4, 0.12, 0.2), M.lampCool, 0, 7.15, -17.25);
  const field = new THREE.Mesh(new THREE.PlaneGeometry(17.4, 7.2), fieldMat());
  field.position.set(0, 3.6, -17.6);
  field.userData.noAO = true;
  root.add(field);
  const beacons = [];
  for (const s of [-1, 1]) {
    b.add(new THREE.CylinderGeometry(0.22, 0.26, 0.2, 14), M.dark, s * 8.4, 7.65, -17.1);
    const bm = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), glow(EMBER, 3));
    bm.position.set(s * 8.4, 7.75, -17.1);
    root.add(bm);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ff8a3d', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    halo.position.copy(bm.position);
    root.add(halo);
    beacons.push({ bm, halo });
  }
  // back wall: plating, a blast door to the ship, control room glass above, the memorial on the right
  const back = new THREE.Mesh(planeUV(W, H).rotateY(Math.PI), M.wall);
  back.position.set(0, H / 2, L / 2);
  back.receiveShadow = true;
  root.add(back);
  b.add(B(W, 1.1, 0.4), M.wallDark, 0, 0.55, L / 2 - 0.2);
  b.add(B(5.4, 5.4, 0.3), M.wallDark, -4.5, 2.7, L / 2 - 0.15);
  b.add(B(4.6, 4.8, 0.25), M.ribbed, -4.5, 2.5, L / 2 - 0.3);
  for (const s of [-1, 1]) b.add(B(0.3, 5.2, 0.4), M.hazard, -4.5 + s * 2.55, 2.6, L / 2 - 0.35);
  b.add(B(5.4, 0.3, 0.4), M.hazard, -4.5, 5.15, L / 2 - 0.35);
  b.add(B(0.5, 0.3, 0.1), M.lampRed, -4.5, 5.6, L / 2 - 0.4);
  b.add(B(19, 1.8, 0.1), M.windowGlow, 0, 7.4, L / 2 - 0.08);
  for (let x = -9.5; x <= 9.5; x += 2.375) b.add(B(0.14, 1.9, 0.18), M.steel, x, 7.4, L / 2 - 0.15);
  b.add(B(19.4, 0.14, 0.4), M.steel, 0, 6.45, L / 2 - 0.2);

  // memorial: a dark slab with brass plaques, a ledge of small lights below, a warm lamp
  const memorial = new THREE.Group();
  memorial.position.set(6.6, 0, L / 2 - 0.3);
  root.add(memorial);
  b.add(B(6.8, 4.2, 0.3), M.dark, 6.6, 2.55, L / 2 - 0.25);
  const memTex = ctex(memorialCanvas([]));
  const memMat = new THREE.MeshStandardMaterial({ map: memTex, emissiveMap: memTex, emissive: '#ffb070', emissiveIntensity: 1.4, roughness: 0.45, metalness: 0.35 });
  const memPlane = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3.62).rotateY(Math.PI), memMat);
  memPlane.position.set(0, 2.55, -0.12);
  memorial.add(memPlane);
  b.add(B(6.6, 0.12, 0.5), M.steel, 6.6, 0.95, L / 2 - 0.55);
  const candles = [];
  for (let i = 0; i < 9; i++) {
    const x = 6.6 - 2.8 + i * 0.7;
    b.add(new THREE.CylinderGeometry(0.045, 0.05, 0.14, 10), M.lampWarm, x, 1.08, L / 2 - 0.55);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ffb46a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 }));
    sp.position.set(x, 1.2, L / 2 - 0.55);
    sp.scale.setScalar(0.32);
    root.add(sp);
    candles.push(sp);
  }
  const memLight = new THREE.PointLight('#ffb070', 32, 14, 1.5);
  memLight.position.set(6.6, 2.4, L / 2 - 2.2);
  root.add(memLight);

  // armoury on the right wall: a rack of rifles between lockers, a strip light and a bench
  b.add(B(0.2, 2.6, 6.4), M.dark, W / 2 - 1.1, 1.7, 2);
  b.add(B(0.1, 0.06, 6.0), M.lampCool, W / 2 - 1.25, 3.05, 2);
  const kinds = ['rifle', 'shotgun', 'sniper', 'lmg', 'rifle', 'sniper', 'shotgun', 'rifle'];
  kinds.forEach((k, i) => {
    const gun = buildWeapon(k);
    const s = 0.72;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(W / 2 - 1.35, 1.05, -0.8 + i * 0.8), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, Math.PI / 2)), new THREE.Vector3(s, s, s));
    b.addObject(gun, m);
  });
  b.add(B(0.4, 0.08, 6.2), M.steel, W / 2 - 1.4, 0.55, 2);
  for (const z of [-3.1, -2.2, -1.3]) {
    b.add(new RoundedBoxGeometry(0.75, 2.3, 0.85, 2, 0.04), M.crateNavy, W / 2 - 1.2, 1.15, z);
    b.add(B(0.02, 0.5, 0.5), M.dark, W / 2 - 1.58, 1.7, z);
  }
  b.add(B(0.55, 0.42, 3.2), M.dark, W / 2 - 3.2, 0.21, 2);
  // a key light from the ceiling over the rack and the stands, and a lit sign
  const armLight = new THREE.SpotLight('#eef3ff', 55, 16, 0.8, 0.6, 1.6);
  armLight.position.set(W / 2 - 4.2, 6.8, 7.0);
  armLight.target.position.set(W / 2 - 1.2, 1.0, 7.1);
  root.add(armLight, armLight.target);
  const armFill = new THREE.PointLight('#ffd9b0', 26, 10, 1.5);
  armFill.position.set(W / 2 - 2.4, 3.4, 4.0);
  root.add(armFill);
  const sign = (() => {
    const c = canvas(1024, 192), g = c.getContext('2d');
    g.fillStyle = '#0a0e16'; g.fillRect(0, 0, 1024, 192);
    g.strokeStyle = EMBER; g.lineWidth = 6; g.strokeRect(10, 10, 1004, 172);
    emblem(g, 36, 30, 132, '#0a0e16');
    g.fillStyle = '#ffd2a8'; g.font = '400 92px "Michroma", sans-serif'; g.textBaseline = 'middle';
    g.fillText('ARMOURY', 200, 100);
    return ctex(c);
  })();
  const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.64).rotateY(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: sign, color: new THREE.Color(1.5, 1.5, 1.5) }));
  signMesh.position.set(W / 2 - 1.02, 2.75, 7.15);
  root.add(signMesh);

  // holo table, front right: base, glowing rim, consoles, the planet hologram with mission markers
  const holo = new THREE.Group();
  holo.position.set(8.2, 0, -9.4);
  root.add(holo);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.25, 0.95, 40), new THREE.MeshStandardMaterial({ color: '#4f5866', roughness: 0.45, metalness: 0.6 }));
  base.position.y = 0.475; base.castShadow = base.receiveShadow = true;
  holo.add(base);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.03, 8, 64).rotateX(Math.PI / 2), M.lampTeal);
  rim.position.y = 0.95;
  holo.add(rim);
  const top = new THREE.Mesh(new THREE.CircleGeometry(1.02, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#081820', emissive: '#1d6f86', emissiveIntensity: 0.7, roughness: 0.2, metalness: 0.6 }));
  top.position.y = 0.952;
  holo.add(top);
  const maps = bakePlanet(view.renderer);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.62, 48, 32), holoMat(maps));
  globe.position.y = 1.85;
  globe.userData.noAO = true;
  holo.add(globe);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.008, 6, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color('#58e0ff').multiplyScalar(1.6), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.position.y = 1.85; ring.rotation.x = 1.25;
  holo.add(ring);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.9, 32, 1, true), coneMat('#58e0ff', 0.35));
  beam.rotation.x = Math.PI; beam.position.y = 1.4;
  holo.add(beam);
  const markers = new THREE.Group();
  globe.add(markers);
  const moons = new THREE.Group();
  moons.position.y = 1.85;
  holo.add(moons);
  for (const [r, a, s] of [[1.08, 0.4, 0.07], [1.32, 2.6, 0.05]]) {
    const mo = new THREE.Mesh(new THREE.SphereGeometry(s, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#7fe8ff').multiplyScalar(1.4), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    mo.position.set(Math.cos(a) * r, Math.sin(a * 3) * 0.12, Math.sin(a) * r);
    moons.add(mo);
    const orbit = new THREE.Mesh(new THREE.TorusGeometry(r, 0.004, 4, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#58e0ff', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    moons.add(orbit);
  }
  moons.traverse((o) => { o.userData.noAO = true; });
  // two consoles beside the table, screens tilted up toward whoever stands at them
  for (const s of [-1, 1]) {
    const con = new THREE.Group();
    con.position.set(8.2 + s * 1.9, 0, -8.0);
    con.rotation.y = s * 0.55;
    root.add(con);
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.95, 0.55, 2, 0.05), M.dark);
    body.position.y = 0.475; body.castShadow = body.receiveShadow = true;
    con.add(body);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.48), new THREE.MeshBasicMaterial({ map: screenTex(20 + s * 7), color: new THREE.Color(1.5, 1.5, 1.5) }));
    scr.position.set(0, 1.02, 0.12);
    scr.rotation.x = -0.75;
    con.add(scr);
  }
  const holoKey = new THREE.SpotLight('#dfe9ff', 40, 14, 0.6, 0.7, 1.6);
  holoKey.position.set(6.2, 7.0, -6.5);
  holoKey.target.position.set(8.2, 0.6, -9.4);
  root.add(holoKey, holoKey.target);
  for (const [x, z, ry] of [[6.2, -11.6, 0.9], [10.2, -11.6, -0.9]]) {
    const con = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.95, 0.55, 2, 0.05), M.dark);
    con.position.set(x, 0.475, z); con.rotation.y = ry; con.castShadow = con.receiveShadow = true;
    root.add(con);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.48), new THREE.MeshBasicMaterial({ map: screenTex(40 + x), color: new THREE.Color(1.5, 1.5, 1.5) }));
    scr.position.set(x + Math.sin(ry) * 0.12, 1.02, z + Math.cos(ry) * 0.12); scr.rotation.set(-0.75, ry, 0, 'YXZ');
    root.add(scr);
  }
  const wallScreen = (() => {
    const c = canvas(1024, 512), g = c.getContext('2d'), rr = rngOf(9);
    const bg = g.createLinearGradient(0, 0, 0, 512);
    bg.addColorStop(0, '#12384a'); bg.addColorStop(1, '#0a2433');
    g.fillStyle = bg; g.fillRect(0, 0, 1024, 512);
    g.strokeStyle = 'rgba(90,224,255,.32)'; g.lineWidth = 1;
    for (let x = 0; x < 1024; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
    for (let y = 0; y < 512; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
    g.strokeStyle = '#58e0ff'; g.lineWidth = 2;
    for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(300, 260, 40 + k * 34, 0, 7); g.stroke(); }
    for (let i = 0; i < 9; i++) { const a2 = rr() * 6.28, d = 60 + rr() * 170; g.fillStyle = i < 3 ? EMBER : '#58e0ff'; g.beginPath(); g.arc(300 + Math.cos(a2) * d, 260 + Math.sin(a2) * d, 6, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(160,236,255,.85)'; g.font = '600 30px "Chakra Petch", sans-serif';
    g.fillText('FRONTIER  SECTOR  7', 600, 90);
    for (let i = 0; i < 8; i++) g.fillRect(600, 140 + i * 36, 120 + rr() * 260, 8);
    return ctex(c);
  })();
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.6).rotateY(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: wallScreen, color: new THREE.Color(1.3, 1.3, 1.3) }));
  wall.position.set(W / 2 - 0.2, 3.0, -10.2);
  root.add(wall);
  const stand = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.5), new THREE.MeshBasicMaterial({ map: wallScreen, color: new THREE.Color(0.95, 0.95, 0.95) }));
  stand.position.set(8.82, 2.65, -12.25);
  stand.rotation.y = -0.59;
  root.add(stand);
  b.add(B(3.15, 1.62, 0.08), M.dark, 8.82 + Math.sin(-0.59) * -0.06, 2.65, -12.25 + Math.cos(-0.59) * -0.06, -0.59);
  b.add(B(0.12, 1.9, 0.12), M.dark, 8.82 + Math.sin(-0.59) * -0.1, 0.95, -12.25 + Math.cos(-0.59) * -0.1, -0.59);
  b.add(B(0.2, 2.9, 5.5), M.dark, W / 2 - 0.05, 3.0, -10.2);
  b.add(B(0.08, 0.07, 9.0), M.lampCool, W / 2 - 0.2, 6.4, -9.5);
  b.add(B(0.08, 0.07, 9.0), M.lampCool, W / 2 - 0.2, 0.32, -9.5);
  const holoLight = new THREE.PointLight('#58e0ff', 22, 13, 1.5);
  holoLight.position.set(8.2, 2.2, -9.4);
  root.add(holoLight);

  // cargo on the left: containers, drums, a fuel cart and a missile rack by the port wing
  const crate = (x, z, y = 0, w = 1.7, h = 1.05, d = 1.05, ry = 0, m = M.crateNavy) => b.add(new RoundedBoxGeometry(w, h, d, 2, 0.05), m, x, y + h / 2, z, ry);
  crate(-10, -12.5); crate(-10, -11.3, 0, 1.7, 1.05, 1.05, 0.03, M.crateOlive); crate(-10, -11.9, 1.05, 1.7, 1.05, 1.05, -0.05);
  crate(-9.8, -6.2, 0, 1.2, 0.8, 1.2, 0.3, M.crateOlive); crate(-10.3, 0.5); crate(-10.3, 1.7, 0, 1.7, 1.05, 1.05, 0, M.crateOlive); crate(-10.25, 1.1, 1.05, 1.7, 1.05, 1.05, 0.08);
  crate(5.6, -14.6, 0, 1.4, 0.9, 1.0, 0.4); crate(4.4, -15.3, 0, 1.0, 0.7, 0.9, -0.2, M.crateOlive);
  for (let i = 0; i < 7; i++) {
    const a = rnd() * 7, r = rnd() * 0.9;
    b.add(new THREE.CylinderGeometry(0.3, 0.3, 0.92, 18), i % 3 ? M.pipeEmber : M.dark, -9.6 + Math.cos(a) * r, 0.46, 9.6 + Math.sin(a) * r);
  }
  b.add(B(1.6, 0.5, 0.9), M.dark, -5.9, 0.45, 3.4);
  b.add(new THREE.CylinderGeometry(0.36, 0.36, 1.3, 18).rotateZ(Math.PI / 2), M.pipeEmber, -5.9, 0.98, 3.4);
  for (const [x, z] of [[-6.5, 3.0], [-5.3, 3.0], [-6.5, 3.8], [-5.3, 3.8]]) b.add(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 14).rotateX(Math.PI / 2), M.rubber, x, 0.16, z);
  b.add(B(2.1, 0.08, 0.9), M.steel, -5.6, 0.5, -3.8);
  for (const s of [-1, 1]) b.add(B(0.08, 0.5, 0.8), M.steel, -5.6 + s, 0.25, -3.8);
  crate(-5.9, -3.85, 0.54, 0.9, 0.5, 0.6, 0.1, M.crateOlive); crate(-5.2, -3.75, 0.54, 0.6, 0.4, 0.5, -0.2);
  // fuel line from the wall to the ship
  const hose = new THREE.CatmullRomCurve3([[-11.6, 1.2, 4], [-10.6, 0.06, 3.4], [-8, 0.06, 2.4], [-4.5, 0.06, 1.0], [-2.3, 0.6, 0.6], [-1.5, 1.2, 0.4]].map((p) => new THREE.Vector3(...p)));
  b.add(new THREE.TubeGeometry(hose, 60, 0.07, 8), M.rubber);
  // floor lights along both walkways
  for (const x of [-7.4, 7.4]) for (let z = -15; z <= 15; z += 3) b.add(B(0.3, 0.03, 0.12), M.lampEmber, x + (x < 0 ? -0.4 : 0.4), 0.015, z);

  b.build(root);

  // light shafts under the pad fixtures and drifting dust
  const shafts = [];
  for (const [x, z] of fixtures) {
    if (z > 1 || z < SHIP_AT.z - 7 || Math.abs(x) > 6) continue;
    const c = new THREE.Mesh(new THREE.ConeGeometry(2.4, H - 1.4, 32, 1, true), coneMat('#cfe0ff', 0.06));
    c.position.set(x, (H - 1.4) / 2, z);
    c.userData.noAO = true;
    root.add(c);
    shafts.push(c);
  }
  const N = 420, dpos = new Float32Array(N * 3), dvel = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    dpos.set([(rnd() - 0.5) * 20, 0.3 + rnd() * 8, (rnd() - 0.5) * 30], i * 3);
    dvel.set([(rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.06], i * 3);
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  const dustMat = new THREE.PointsMaterial({ size: 0.035, map: glowTex(), color: '#cdd8ff', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  dustMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vNear;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n  vNear = smoothstep(1.5, 4.0, -mvPosition.z);\n  gl_PointSize = min(gl_PointSize, 6.0);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vNear;')
      .replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n  diffuseColor.a *= vNear;');
  };
  const dust = new THREE.Points(dg, dustMat);
  root.add(dust);

  // space: stars, a planet with an atmosphere below the door, a moon and the star itself
  const space = new THREE.Group();
  root.add(space);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(200, 48, 24), new THREE.MeshBasicMaterial({ map: starfield(), side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  space.add(sky);
  const NS = 1600, sp = new Float32Array(NS * 3), sc = new Float32Array(NS * 3);
  for (let i = 0; i < NS; i++) {
    const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize().multiplyScalar(190);
    sp.set([v.x, v.y, v.z], i * 3);
    const b = 0.35 + rnd() ** 3 * 1.4, t = rnd();
    sc.set(t < 0.2 ? [b, b * 0.85, b * 0.7] : t < 0.5 ? [b * 0.8, b * 0.88, b] : [b, b, b], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, map: glowTex(), vertexColors: true, transparent: true, depthWrite: false, fog: false }));
  stars.renderOrder = -9;
  sky.add(stars);
  const starPos = new THREE.Vector3(-150, 70, -190);
  const planetPos = new THREE.Vector3(10, -58, -170), R = 64;
  // light from the side, so a third of the disc is night with city lights and storms
  const sun = new THREE.Vector3(-1, 0.32, 0.38).normalize();
  const planet = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 64), planetMat(sun, maps));
  planet.position.copy(planetPos);
  planet.rotation.set(1.45, 0.4, 0.25); // equator toward the bay; the ice caps sit off to the sides
  space.add(planet);
  const atmos = new THREE.Mesh(new THREE.SphereGeometry(R * 1.05, 96, 48), atmosMat(sun, Math.sqrt(1 - 1 / 1.05 ** 2)));
  atmos.position.copy(planetPos);
  space.add(atmos);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(7, 48, 24), moonMat(starPos.clone().sub(new THREE.Vector3(-62, 26, -185)).normalize()));
  moon.position.set(-62, 26, -185);
  space.add(moon);
  const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color('#fff2dc').multiplyScalar(3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
  star.position.copy(starPos.clone().normalize().multiplyScalar(190));
  star.scale.setScalar(26);
  space.add(star);
  space.traverse((o) => { o.userData.noAO = true; if (o.material) o.material.fog = false; });

  // the dropship on its pad, ramp down
  const ship = buildDropship();
  ship.root.position.copy(SHIP_AT);
  root.add(ship.root);

  const stations = {};
  for (const [k, s] of Object.entries(STATIONS)) stations[k] = { eye: new THREE.Vector3(...s.eye), look: new THREE.Vector3(...s.look), x: s.x, drift: s.drift || 0, fill: s.fill || 1.15 };

  let memKey = '';
  const carrier = {
    root, ship, stations, holo, globe, markers,
    // write the names of the fallen onto the wall
    setFallen(fallen) {
      const key = fallen.map((f) => f.name + f.callsign).join('|');
      if (key === memKey) return;
      memKey = key;
      memMat.map.image = memorialCanvas(fallen);
      memMat.map.needsUpdate = true;
    },
    // one ember marker per mission on offer, spread over the hologram
    setOffers(offers) {
      markers.clear();
      offers.forEach((m, i) => {
        const r = rngOf(m.seed || i + 1);
        const v = new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.9, r() - 0.5).normalize().multiplyScalar(0.64);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: m.type === 'final' ? '#ff4a4a' : '#ffa060', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
        sp.position.copy(v);
        sp.scale.setScalar(0.16);
        markers.add(sp);
      });
    },
    tick(dt, t) {
      globe.rotation.y += dt * 0.12;
      moons.rotation.y -= dt * 0.08;
      ring.rotation.z += dt * 0.2;
      globe.material.uniforms.uTime.value = t;
      field.material.uniforms.uTime.value = t;
      planet.material.uniforms.uTime.value = t;
      planet.rotation.y += dt * 0.002;
      for (const [i, bc] of beacons.entries()) {
        const k = 0.5 + 0.5 * Math.sin(t * 3 + i * Math.PI);
        bc.halo.scale.setScalar(0.5 + k * 1.1);
        bc.halo.material.opacity = 0.3 + k * 0.7;
      }
      for (const [i, c] of candles.entries()) c.material.opacity = 0.65 + Math.sin(t * (7 + i) + i * 3) * 0.1 + Math.random() * 0.12;
      memLight.intensity = 31 + Math.random() * 2;
      for (let i = 0; i < N; i++) {
        for (let k = 0; k < 3; k++) {
          let v = dpos[i * 3 + k] + dvel[i * 3 + k] * dt;
          const lim = k === 0 ? 10 : k === 2 ? 15 : 0;
          if (k === 1) { if (v > 8.5) v = 0.3; else if (v < 0.3) v = 8.5; } else if (Math.abs(v) > lim) v = -Math.sign(v) * lim;
          dpos[i * 3 + k] = v;
        }
      }
      dg.attributes.position.needsUpdate = true;
      sky.position.copy(view.camera.position);
      ship.tick(dt, t);
    },
  };
  return carrier;
}

// Image-based light for the hangar: a dim room with bright ceiling panels and a blue glow from the door.
export function hangarEnv(renderer) {
  const sc = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(W, H, L), new THREE.MeshBasicMaterial({ color: '#2a3446', side: THREE.BackSide }));
  room.position.y = H / 2 - 2;
  sc.add(room);
  const panel = (w, d, x, y, z, color, k, rx = Math.PI / 2) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.x = rx; sc.add(m);
  };
  for (const x of [-8.5, -4.5, 4.5, 8.5]) for (let z = -14; z <= 14; z += 4) panel(1.5, 0.5, x, H - 3.4, z, '#e6eeff', 12);
  panel(18, 7.5, 0, 1.75, -L / 2 + 0.1, '#4a6aa8', 1.4, 0);
  panel(3, 2, 6.6, 0.5, L / 2 - 0.2, '#ffb070', 1.5, 0);
  panel(L, 0.4, W / 2 - 0.2, 1.3, 0, '#e6eeff', 1.2, 0);
  const deckp = new THREE.Mesh(new THREE.PlaneGeometry(W, L), new THREE.MeshBasicMaterial({ color: '#2a2f38' }));
  deckp.rotation.x = -Math.PI / 2; deckp.position.y = -1.99;
  sc.add(deckp);
  const pm = new THREE.PMREMGenerator(renderer);
  const t = pm.fromScene(sc, 0.02).texture;
  pm.dispose();
  return t;
}
