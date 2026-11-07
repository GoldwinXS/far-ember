// Ember Squad: asset loading. Textures, sky maps, props and characters, cached and loaded per biome.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { PACKED } from './packed.js';

const BASE = new URL('../assets/', import.meta.url).href;
const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const rgbe = new RGBELoader();
const cache = new Map();
let maxAniso = 4;
export function setAniso(n) { maxAniso = n; }

function once(key, fn) {
  if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e; }));
  return cache.get(key);
}

export function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('image ' + url));
    img.src = url;
  });
}

// A PBR set from assets/tex: <slug>_d.jpg, _n.jpg, _arm.jpg
export function texSet(slug) {
  return once('tex:' + slug, async () => {
    const load = (suffix, srgb) => new Promise((res, rej) => texLoader.load(`${BASE}tex/${slug}_${suffix}.jpg`, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = maxAniso;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      res(t);
    }, undefined, rej));
    const [map, normalMap, arm] = await Promise.all([load('d', true), load('n'), load('arm')]);
    return { map, normalMap, arm, slug };
  });
}
export const peekTex = (slug) => cache.get('tex:' + slug);

// Ground layers as array textures so the splat shader can blend 4 materials with few samplers.
export function layerArrays(slugs) {
  return once('arr:' + slugs.join(','), async () => {
    const S = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const make = async (suffix, srgb) => {
      const data = new Uint8Array(S * S * 4 * slugs.length);
      for (let i = 0; i < slugs.length; i++) {
        const img = await loadImage(`${BASE}tex/${slugs[i]}_${suffix}.jpg`);
        g.drawImage(img, 0, 0, S, S);
        data.set(g.getImageData(0, 0, S, S).data, i * S * S * 4);
      }
      const t = new THREE.DataArrayTexture(data, S, S, slugs.length);
      t.format = THREE.RGBAFormat;
      t.type = THREE.UnsignedByteType;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = maxAniso;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    };
    return { alb: await make('d', true), nor: await make('n'), arm: await make('arm') };
  });
}

// Binary files arrive as-is in development and as base64 text in the published build.
async function bin(path) {
  if (!PACKED) {
    const r = await fetch(BASE + path);
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.arrayBuffer();
  }
  const r = await fetch(BASE + path + '.txt');
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  const text = await r.text();
  const raw = atob(text.trim());
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

export function glb(path) {
  return once('glb:' + path, async () => {
    const buf = await bin(path);
    const dir = BASE + path.slice(0, path.lastIndexOf('/') + 1);
    return new Promise((res, rej) => gltfLoader.parse(buf, dir, res, rej));
  });
}
export function hdr(name) {
  return once('hdr:' + name, async () => {
    const d = rgbe.parse(await bin(`hdri/${name}.hdr`));
    const t = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat, d.type);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.LinearSRGBColorSpace;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.flipY = true;
    t.needsUpdate = true;
    return t;
  });
}

export const SKIES = { day: 'kloofendal_48d_partly_cloudy_puresky', dusk: 'qwantani_dusk_2', night: 'kloofendal_48d_partly_cloudy_puresky', spire: 'spruit_sunrise' };

export const BIOMES = {
  town: {
    layers: ['asphalt_02', 'concrete_pavement', 'leafy_grass', 'stony_dirt_path'],
    scale: [3.0, 1.6, 2.6, 3.0],
    tex: ['concrete_panels', 'blue_metal_plate', 'metal_plate_02', 'painted_metal_shutter', 'brick_wall_02', 'wood_floor_worn', 'weathered_planks', 'concrete_floor_02', 'box_profile_metal_sheet'],
    props: ['wooden_crate_01', 'wooden_crate_02', 'wooden_military_crate', 'Barrel_01', 'Barrel_02', 'covered_car', 'shrub_02', 'shrub_04', 'street_lamp_01', 'fire_hydrant',
      'metal_trash_can', 'utility_box_01', 'power_box_01', 'exterior_aircon_unit', 'trashbag', 'cardboard_box_01', 'ammo_box', 'propane_tank', 'water_manhole_cover',
      'grass_medium_01', 'grass_medium_02', 'old_tyre', 'plastic_crate_01', 'cement_bag', 'utility_box_02', 'security_light'],
    trees: ['oak', 'birch'],
  },
  farm: {
    layers: ['sparse_grass', 'farm_furrows', 'stony_dirt_path', 'leafy_grass'],
    scale: [2.6, 3.2, 3.0, 2.6],
    tex: ['weathered_planks', 'rusty_corrugated_iron', 'concrete_block_wall', 'wood_planks_dirt', 'dark_rock', 'concrete_floor_02', 'painted_metal_shutter'],
    props: ['wooden_crate_02', 'wooden_barrels_01', 'covered_car', 'boulder_01', 'rock_moss_set_01', 'tree_stump_01', 'dead_tree_trunk', 'propane_tank', 'portable_generator',
      'old_tyre', 'grass_medium_01', 'grass_medium_02', 'shrub_02', 'cement_bag', 'Barrel_02'],
    trees: ['oak', 'pine', 'spruce', 'birch'],
  },
  yard: {
    layers: ['concrete_floor_worn_001', 'asphalt_02', 'stony_dirt_path', 'concrete_floor_02'],
    scale: [3.4, 3.0, 3.0, 2.6],
    tex: ['rusty_corrugated_iron', 'concrete_block_wall', 'painted_metal_shutter', 'concrete_floor_02', 'rusty_metal_02'],
    props: ['wooden_crate_01', 'wooden_crate_02', 'old_military_crate', 'wooden_military_crate', 'plastic_crate_01', 'Barrel_01', 'Barrel_02', 'barrel_03', 'concrete_road_barrier',
      'concrete_road_barrier_02', 'ammo_box', 'portable_generator', 'power_box_01', 'street_lamp_01', 'rollershutter_door', 'security_light', 'grass_medium_01', 'grass_medium_02'],
    trees: ['spruce'],
  },
  spire: {
    layers: ['dark_rock', 'aerial_rocks_02', 'stony_dirt_path', 'dark_rock'],
    scale: [3.4, 4.0, 3.0, 2.0],
    tex: ['rusty_metal_02', 'dark_rock'],
    props: ['boulder_01', 'rock_moss_set_01'],
    trees: [],
  },
};

export const CHARS = {
  soldiers: ['swatguy'],
  enemies: { husk: 'alien', brute: 'mutant', stalker: 'parasite', warden: 'zlorp', overseer: 'maw' },
};

// Load everything a mission in this biome needs. onProgress(fraction).
export async function loadBiome(biome, time, onProgress = () => {}, enemies = true) {
  const b = BIOMES[biome];
  const jobs = [
    () => texSet('rusty_metal_02'),
    () => layerArrays(b.layers),
    ...b.tex.map((s) => () => texSet(s)),
    ...b.props.map((p) => () => glb(`props/${p}.glb`).catch(() => null)),
    ...b.trees.map((t) => () => glb(`trees/${t}_lod0.glb`).catch(() => null)),
    ...b.trees.map((t) => () => glb(`trees/${t}_lod1.glb`).catch(() => null)),
    () => hdr(SKIES[biome === 'spire' ? 'spire' : time]),
    () => loadChars(enemies).catch(() => null),
  ];
  let done = 0;
  await Promise.all(jobs.map((j) => j().then(() => onProgress(++done / jobs.length))));
}

// Bodies load on demand; the title screen only needs the soldiers.
const charsOut = {};
export async function loadChars(withEnemies = true) {
  const names = [...CHARS.soldiers, ...(withEnemies ? Object.values(CHARS.enemies) : [])];
  await Promise.all([
    ...names.map(async (n) => { if (!charsOut[n]) charsOut[n] = await glb(`chars/${n}.glb`).catch(() => null); }),
    charsOut.rifle ? null : glb('chars/rifle_anims.glb').then((g) => { charsOut.rifle = g; }).catch(() => null),
    charsOut.gun ? null : glb('props/rifle.glb').then((g) => { charsOut.gun = g; }).catch(() => null),
  ]);
  return charsOut;
}
