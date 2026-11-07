// Ember Squad: animated characters from the Mixamo-based GLBs. Clip blending, rifles in hands, poses.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CHARS } from './assets.js';
import { buildWeapon, WEAPON_LEN, buildCrystals, wornGuns, crackCanvas } from './kit.js';
import { peekTex } from './assets.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { fitBody, dress, kitColours, defaultKit, CAP } from './armour.js';

const TARGET_H = { soldier: 1.27, husk: 1.36, brute: 1.72, stalker: 1.3, warden: 1.32, overseer: 2.7 };
// Which clip plays for each pose, per body type. Missing entries fall back to the base state.
const CLIPS = {
  human: { idle: 'idle', crouch: 'crouch', aim: 'aim', crouchAim: 'crouchAim', fire: 'fire', reload: 'reload', throw: 'throw', hit: 'hit', hitCrouch: 'hitCrouch', walk: 'walk', run: 'run', death: 'death', deathCrouch: 'deathCrouch' },
  brute: { idle: 'idle', aim: 'idle', fire: 'roar', melee: 'swipe', cast: 'roar', hit: 'hit', walk: 'walk', run: 'run', death: 'die' },
  stalker: { idle: 'idle', aim: 'idle', fire: 'attack', melee: 'attack', hit: 'hit', walk: 'walk', run: 'run', death: 'die' },
  warden: { idle: 'idle', aim: 'idle', fire: 'cast', cast: 'cast', hit: 'hit', walk: 'walk', run: 'walk', death: 'die' },
  overseer: { idle: 'idle', aim: 'idle', fire: 'roar', cast: 'roar', melee: 'swipe', hit: 'hit', walk: 'walk', run: 'walk', death: 'die' },
};

// A fresnel rim on every character so helmets and shoulders separate from dark ground. view.js sets the strength per time of day.
export const RIM = { squad: { value: new THREE.Color('#8fb4ff').multiplyScalar(0.28) }, pale: { value: new THREE.Color('#7fe6ff').multiplyScalar(0.2) } };
function addRim(m, u, head) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = u;
    let fs = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  float rimF = 1.0 - saturate(dot(normal, normalize(vViewPosition)));\n  totalEmissiveRadiance += uRim * rimF * rimF * rimF;');
    if (head) {
      // the body's own helmet and goggles (the top of the body in the rest pose) give way to the armour's helmet
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vCut;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n  vCut = position.${head.axis};`);
      fs = fs.replace('#include <common>', '#include <common>\nvarying float vCut;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n  if (vCut > ${head.cut.toFixed(5)}) discard;`);
    }
    sh.fragmentShader = fs;
  };
  if (head) m.customProgramCacheKey = () => `cut${head.axis}${head.cut.toFixed(4)}`;
}

let gunMat = null;
function prepGun(src, alien) {
  const g = src.scene.clone(true);
  gunMat ||= new THREE.MeshStandardMaterial({ color: '#23272b', roughness: 0.45, metalness: 0.6 });
  const alienMat = new THREE.MeshStandardMaterial({ color: '#2a3036', roughness: 0.3, metalness: 0.7, emissive: '#2fd4e0', emissiveIntensity: 0.25 });
  g.traverse((o) => { if (o.isMesh) { o.material = alien ? alienMat : gunMat; o.castShadow = true; } });
  return g;
}

const KIT = {
  olive: new THREE.MeshStandardMaterial({ color: '#4d5240', roughness: 0.9 }),
  dark: new THREE.MeshStandardMaterial({ color: '#2a2d27', roughness: 0.8 }),
  ember: new THREE.MeshStandardMaterial({ color: '#ff7a2e', roughness: 0.6, emissive: '#3a1404', emissiveIntensity: 0.5 }),
  band: { scout: '#e07a38', gunner: '#93b544', marksman: '#4f9fd2', medic: '#cfc9b6' },
  medic: new THREE.MeshStandardMaterial({ color: '#3f6a4a', roughness: 0.85 }),
  white: new THREE.MeshStandardMaterial({ color: '#e9e6dc', roughness: 0.7 }),
  gun: new THREE.MeshStandardMaterial({ color: '#23272b', roughness: 0.45, metalness: 0.6 }),
  pads: {},
  covers: [null, { color: new THREE.Color('#8c7b58') }, { color: new THREE.Color('#5f6a48') }, { color: new THREE.Color('#6d7378') }],
  glass: new THREE.MeshStandardMaterial({ color: '#1a2b3a', roughness: 0.05, metalness: 0.4, envMapIntensity: 2 }),
};
// Extra parts on the base rifle model (its barrel runs along +x, about 1 m long).
function addGunParts(gun, cls) {
  const add = (geo, m, x, y, z, rz = 0) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.rotation.z = rz; me.castShadow = true; gun.add(me); };
  if (cls === 'marksman') {
    add(new THREE.CylinderGeometry(0.028, 0.032, 0.32, 10), KIT.gun, 0.12, 0.115, 0, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.026, 0.026, 0.01, 10), KIT.glass, 0.285, 0.115, 0, Math.PI / 2);
    add(new THREE.BoxGeometry(0.03, 0.05, 0.02), KIT.gun, 0.05, 0.085, 0);
    add(new THREE.BoxGeometry(0.03, 0.05, 0.02), KIT.gun, 0.2, 0.085, 0);
  } else if (cls === 'gunner') {
    add(new THREE.BoxGeometry(0.14, 0.13, 0.09), KIT.olive, 0.1, -0.12, 0);
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), KIT.gun, 0.62, 0.02, 0, Math.PI / 2);
    add(new THREE.BoxGeometry(0.02, 0.12, 0.08), KIT.gun, 0.55, -0.06, 0);
  } else if (cls === 'scout') {
    add(new THREE.BoxGeometry(0.16, 0.05, 0.06), KIT.dark, 0.38, -0.04, 0);
  }
}
// Ember Company armour, fitted in the idle pose then parented to bones. Returns the paint handle.
function addKit(model, cls, mixer, actions, kit, body) {
  const spine = model.getObjectByName('mixamorigSpine2');
  const arm = model.getObjectByName('mixamorigLeftArm');
  const fore = model.getObjectByName('mixamorigLeftForeArm');
  const hips = model.getObjectByName('mixamorigHips');
  if (!spine || !arm || !fore || !hips) return;
  if (actions.idle) { actions.idle.play(); mixer.setTime(0); }
  model.updateMatrixWorld(true);
  const fit = fitBody(body, model);
  const handle = dress(model, fit, cls, kit, RIM.squad);
  if (actions.idle) actions.idle.stop();
  return handle;
}

// The Pale: a glowing visor and crystal growths on the shoulders.
function addPaleKit(model, mixer, actions) {
  const P = (hipsOf(model)?.name || 'mixamorigHips').replace(/Hips$/, '');
  const head = model.getObjectByName(P + 'Head');
  const ls = model.getObjectByName(P + 'LeftShoulder'), rs = model.getObjectByName(P + 'RightShoulder');
  if (!head) return;
  const idle = actions.idle2 || actions.idle;
  if (idle) { idle.play(); mixer.setTime(0); }
  model.updateMatrixWorld(true);
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()));
  const put = (bone, obj, pos, quat) => {
    const m = new THREE.Matrix4().compose(pos, quat || model.getWorldQuaternion(new THREE.Quaternion()), obj.scale.clone());
    bone.matrixWorld.clone().invert().multiply(m).decompose(obj.position, obj.quaternion, obj.scale);
    bone.add(obj);
  };
  const hp = head.getWorldPosition(new THREE.Vector3());
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.026, 0.03), new THREE.MeshStandardMaterial({ color: '#9ff6ff', emissive: '#4fdcea', emissiveIntensity: 2.2 }));
  put(head, visor, hp.clone().addScaledVector(fwd, 0.1).add(new THREE.Vector3(0, 0.1, 0)));
  for (const [bone, side] of [[ls, -1], [rs, 1]]) {
    if (!bone) continue;
    const c = buildCrystals(700 + side, 0.6, 0.3);
    c.scale.setScalar(0.32);
    const bp = bone.getWorldPosition(new THREE.Vector3());
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, 0, side * 0.6));
    put(bone, c, bp.add(new THREE.Vector3(0, 0.06, -0.02)), model.getWorldQuaternion(new THREE.Quaternion()).multiply(q));
  }
  if (idle) idle.stop();
}

// Rock scan textures reused as the Pale's skin (set when the biome textures load).
let paleSet = null;
export function setPaleTextures(rock) { paleSet = rock; }
const skinCache = new Map();
function paleSkin(kind) {
  if (skinCache.has(kind)) return skinCache.get(kind);
  const veinsTex = buildVeinTexture(kind === 'warden' ? 31 : 17);
  const map = paleSet ? lighten(paleSet.map, kind === 'warden' ? [0.92, 0.9, 1] : [0.96, 0.97, 1]) : null;
  const normal = paleSet ? paleSet.normalMap.clone() : null;
  for (const t of [map, normal, veinsTex]) if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); t.needsUpdate = true; }
  const out = { map, normal, veins: veinsTex };
  skinCache.set(kind, out);
  return out;
}
function lighten(tex, tint) {
  const img = tex.image;
  if (!img || !img.width) return tex.clone();
  const c = document.createElement('canvas');
  c.width = Math.min(512, img.width); c.height = Math.min(512, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const v = Math.min(255, 70 + (p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11) * 1.5);
    p[i] = v * tint[0]; p[i + 1] = v * tint[1]; p[i + 2] = v * tint[2];
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = tex.flipY;
  t.anisotropy = 4;
  return t;
}
function buildVeinTexture(seed) {
  // the same glowing cracks as the crystals, so the Pale and their spire share one look
  const t = new THREE.CanvasTexture(crackCanvas(256, 256, 30, seed, false, 3.4));
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function hipsOf(root) {
  let h = null;
  root.traverse((o) => { if (!h && o.isBone && /Hips$/.test(o.name)) h = o; });
  return h;
}

// Rifle clips were made on one rig; scale its hip movement to fit a body with different proportions.
const retargetCache = new Map();
function retarget(clips, srcHipsY, dstHipsY, key) {
  if (retargetCache.has(key)) return retargetCache.get(key);
  const k = dstHipsY / srcHipsY;
  const out = clips.map((c) => {
    const cc = c.clone();
    for (const t of cc.tracks) if (/Hips\.position$/.test(t.name)) for (let i = 0; i < t.values.length; i++) t.values[i] *= k;
    return cc;
  });
  retargetCache.set(key, out);
  return out;
}

export function makeCharacter(u, chars) {
  if (!chars) return null;
  let body, type;
  if (u.side === 'ember') {
    // one squad uniform on two bodies (goggles or gas mask); classes differ by kit
    body = CHARS.soldiers[(u.slot ?? ((u.look ?? 0) + (typeof u.rid === 'number' ? u.rid : 0))) % CHARS.soldiers.length];
    if (!chars[body]) body = CHARS.soldiers[0];
    type = 'human';
  } else {
    body = CHARS.enemies[u.kind];
    type = u.kind === 'husk' ? 'human' : u.kind;
  }
  const src = body && chars[body];
  if (!src) return null;
  const model = SkeletonUtils.clone(src.scene);
  const squad = u.side === 'ember';
  let head = null;
  if (squad) {
    const bb = new THREE.Box3();
    model.traverse((o) => { if (o.isSkinnedMesh) { o.geometry.computeBoundingBox(); bb.union(o.geometry.boundingBox); } });
    const size = bb.getSize(new THREE.Vector3());
    const axis = size.z > size.y ? 'z' : 'y';
    head = { axis, cut: bb.max[axis] - CAP * size[axis] };
  }
  // a soldier's own kit (paint, trim, undersuit, visor, helmet); a fresh one follows their look
  const kit = squad ? (u.kit || defaultKit(u.kind, u.slot ?? u.look ?? 0)) : null;
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      if (o.material) {
        o.material = o.material.clone();
        o.material.envMapIntensity = squad ? 0.7 : 1.0;
        if (o.material.map) o.material.map.anisotropy = 4;
        if (squad) {
          // matte field kit, lifted a little so the squad never reads as black shapes
          o.material.color.set(kitColours(kit).suit);
          o.material.roughness = 0.8;
          o.material.metalness = 0;
          o.material.metalnessMap = null;
          o.material.roughnessMap = null;
          if (o.material.map) { o.material.emissive = new THREE.Color('#ffffff'); o.material.emissiveMap = o.material.map; o.material.emissiveIntensity = 0.12; }
        } else if (u.kind === 'husk' || u.kind === 'warden') {
          // the Pale: matte bone-grey skin; the light parts of the original pattern glow as cyan seams
          // stone-like skin from a rock scan over the model's own UVs, with cyan veins glowing through
          const skin = paleSkin(u.kind);
          o.material.map = skin.map;
          if (!o.material.normalMap) o.material.normalMap = skin.normal;
          o.material.color.set(u.kind === 'husk' ? '#b4b1ab' : '#a49cae');
          o.material.roughness = 0.62;
          o.material.metalness = 0;
          o.material.metalnessMap = null;
          o.material.roughnessMap = null;
          o.material.emissive = new THREE.Color('#4fdcea');
          o.material.emissiveMap = skin.veins;
          o.material.emissiveIntensity = u.kind === 'warden' ? 1.3 : 1.0;
        } else if (u.kind === 'overseer') {
          o.material.color.multiply(new THREE.Color('#c8ccd4'));
        }
        addRim(o.material, squad ? RIM.squad : RIM.pale, o.isSkinnedMesh ? head : null);
      }
    }
  });
  const root = new THREE.Group();
  const holder = new THREE.Group();
  root.add(holder);
  holder.add(model);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const h = box.max.y - box.min.y || 1.8;
  const target = TARGET_H[u.side === 'ember' ? 'soldier' : u.kind] || 1.3;
  holder.scale.setScalar(target / h);

  const mixer = new THREE.AnimationMixer(model);
  let clips = src.animations;
  if (type === 'human' && chars.rifle) {
    const sh = hipsOf(chars.rifle.scene), dh = hipsOf(model);
    const rifleClips = sh && dh ? retarget(chars.rifle.animations, sh.position.length(), dh.position.length(), body) : chars.rifle.animations;
    clips = [...rifleClips];
  }
  // the Warden's own idle is a stiff stand: it borrows the Brute's hunched, breathing combat idle
  if (u.kind === 'warden' && chars.mutant) {
    const sh = hipsOf(chars.mutant.scene), dh = hipsOf(model);
    const idle = chars.mutant.animations.find((c) => c.name === 'idle');
    if (idle && sh && dh) {
      // the two rigs name their bones with different prefixes (mixamorig vs mixamorig1)
      const from = sh.name.replace(/Hips$/, ''), to = dh.name.replace(/Hips$/, '');
      const [moved] = retarget([idle], sh.position.length(), dh.position.length(), 'warden-idle');
      const renamed = moved.clone();
      for (const t of renamed.tracks) if (t.name.startsWith(from)) t.name = to + t.name.slice(from.length);
      clips = [...clips.filter((c) => c.name !== 'idle'), renamed];
    }
  }
  const actions = {};
  for (const c of clips) actions[c.name] = mixer.clipAction(c);
  const map = { ...CLIPS[type] };
  if (actions.idle2) map.idle = 'idle2';

  // rifle in the right hand, aligned so the barrel runs through the left hand in the aim pose
  let muzzle = new THREE.Object3D();
  let rigGun = null, grip = null, aimOffset = 0, armour = null;
  if (type === 'human' && chars.gun) {
    const hand = model.getObjectByName('mixamorigRightHand');
    const left = model.getObjectByName('mixamorigLeftHand');
    if (hand && left && actions.aim) {
      const kind = squad ? { scout: 'shotgun', gunner: 'lmg', marksman: 'sniper', medic: 'rifle' }[u.kind] || 'rifle' : 'lance';
      const worn = peekTex('rusty_metal_02');
      if (worn) worn.then?.(wornGuns);
      const gun = buildWeapon(kind);
      actions.aim.play();
      mixer.setTime(0.4);
      root.updateMatrixWorld(true);
      const R = hand.getWorldPosition(new THREE.Vector3()), L = left.getWorldPosition(new THREE.Vector3());
      const dir = L.clone().sub(R).normalize();
      const up = new THREE.Vector3(0, 1, 0).sub(dir.clone().multiplyScalar(dir.y)).normalize();
      const z = new THREE.Vector3().crossVectors(dir, up);
      const s = 0.694 * (target / 1.27);
      const pos = R.clone().addScaledVector(up, -0.03 * s / 0.66).addScaledVector(dir, 0.01);
      const world = new THREE.Matrix4().makeBasis(dir, up, z).scale(new THREE.Vector3(s, s, s)).setPosition(pos);
      const local = hand.matrixWorld.clone().invert().multiply(world);
      local.decompose(gun.position, gun.quaternion, gun.scale);
      hand.add(gun);
      grip = { hand, left, span: R.distanceTo(L), s, drop: -0.03 * s / 0.66, pos: gun.position.clone(), quat: gun.quaternion.clone(), scale: gun.scale.clone() };
      // the aim clip holds the rifle across the body: how far the barrel points off the body's facing
      aimOffset = Math.atan2(dir.x, dir.z);
      actions.aim.stop();
      muzzle.position.set(WEAPON_LEN[kind], 0.02, 0);
      gun.add(muzzle);
      rigGun = gun;
      if (squad) armour = addKit(model, u.kind, mixer, actions, kit, body);
      else addPaleKit(model, mixer, actions);
    }
  } else {
    // creatures: shots come from the chest or hands
    muzzle.position.set(0, target * 0.65, 0.35);
    root.add(muzzle);
    if (u.kind === 'warden') addPaleKit(model, mixer, actions);
    if (u.kind === 'overseer') {
      const spine = model.getObjectByName('mixamorigSpine2');
      if (spine) {
        model.updateMatrixWorld(true);
        const ws = spine.getWorldScale(new THREE.Vector3()).x;
        for (let i = 0; i < 5; i++) {
          const c = buildCrystals(900 + i, 0.5 + (i % 3) * 0.2, 0.25);
          c.scale.setScalar(1 / ws);
          c.position.set((i - 2) * 0.12 / ws, 0.05 / ws, -0.12 / ws);
          c.rotation.set(-0.9 - (i % 2) * 0.3, 0, (i - 2) * 0.35);
          spine.add(c);
        }
      }
    }
  }
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, target, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = target / 2;
  root.add(hit);
  const rig = {
    head: model.getObjectByName('mixamorigHead'),
    root, body: holder, hit, model, mixer, actions, map, type, muzzle, height: target, legs: [], arms: [], spin: [], glowMats: [],
    base: 'idle', current: null, crouched: false, isChar: true, gun: rigGun, grip, aimOffset, armour,
    // repaint a soldier in place (the barracks preview)
    setKit(k) { if (armour) armour.paint(k); model.traverse((o) => { if (o.isSkinnedMesh) o.material.color.set(kitColours(k).suit); }); },
  };
  setBase(rig, 'idle', 0);
  mixer.setTime(Math.random() * 2);
  return rig;
}

function clipFor(rig, pose) {
  const name = rig.map[pose] || rig.map.idle;
  return rig.actions[name] ? name : null;
}

export function setBase(rig, pose, fade = 0.3) {
  if (rig.crouched && pose === 'idle' && clipFor(rig, 'crouch')) pose = 'crouch';
  if (rig.crouched && pose === 'aim' && clipFor(rig, 'crouchAim')) pose = 'crouchAim';
  const name = clipFor(rig, pose);
  if (!name) return;
  rig.base = pose;
  if (rig.oneShot) return; // the one-shot returns to the new base when it ends
  crossTo(rig, name, fade, true);
}

function crossTo(rig, name, fade, loop) {
  const next = rig.actions[name];
  if (!next) return null;
  const prev = rig.current ? rig.actions[rig.current] : null;
  next.reset();
  next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  next.clampWhenFinished = !loop;
  next.enabled = true;
  next.setEffectiveWeight(1);
  next.setEffectiveTimeScale(1);
  if (prev && prev !== next) {
    if (fade > 0.01) next.crossFadeFrom(prev, fade, false);
    else prev.stop();
  }
  next.play();
  rig.current = name;
  return next;
}

// Play a clip once, then return to the base state. Resolves when the clip is done (or after maxT).
export function playOnce(rig, pose, opts = {}) {
  let name = clipFor(rig, rig.crouched && pose === 'hit' ? 'hitCrouch' : rig.crouched && pose === 'death' ? 'deathCrouch' : pose);
  if (!name) return Promise.resolve();
  const act = crossTo(rig, name, opts.fade ?? 0.18, false);
  if (!act) return Promise.resolve();
  if (opts.speed) act.setEffectiveTimeScale(opts.speed);
  const dur = (act.getClip().duration / (opts.speed || 1)) * (opts.portion || 1);
  rig.oneShot = name;
  return new Promise((resolve) => {
    rig.oneShotT = { left: dur, resolve, hold: !!opts.hold };
  });
}

// Two-hand grip: the barrel runs from the right hand through the left with the top of the gun up, so clips
// that turn the wrist (the idle) never roll the gun onto its side. Falls back to the hand-locked pose when the
// left hand lets go (reload, throw, death).
const _R = new THREE.Vector3(), _L = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _ws = new THREE.Vector3();
function gripGun(rig, dt) {
  const g = rig.gun, G = rig.grip;
  rig.root.updateMatrixWorld(true);
  const k = rig.root.getWorldScale(_ws).x;
  G.hand.getWorldPosition(_R);
  G.left.getWorldPosition(_L);
  const span = _R.distanceTo(_L) / (G.span * k);
  _d.subVectors(_L, _R).normalize();
  if (span < 0.55 || span > 1.6 || Math.abs(_d.y) > 0.9) { _p.copy(G.pos); _q.copy(G.quat); _s.copy(G.scale); }
  else {
    _u.set(0, 1, 0).addScaledVector(_d, -_d.y).normalize();
    _z.crossVectors(_d, _u);
    _m.makeBasis(_d, _u, _z).scale(_s.setScalar(G.s * k)).setPosition(_R.addScaledVector(_u, G.drop * k).addScaledVector(_d, 0.01 * k));
    _m.premultiply(_inv.copy(G.hand.matrixWorld).invert());
    _m.decompose(_p, _q, _s);
  }
  const a = dt > 0 ? Math.min(1, dt * 18) : 1;
  g.position.lerp(_p, a);
  g.quaternion.slerp(_q, a);
  g.scale.copy(_s);
}

export function tickChar(rig, dt) {
  rig.mixer.update(dt);
  if (rig.grip) gripGun(rig, dt);
  const o = rig.oneShotT;
  if (o) {
    o.left -= dt;
    if (o.left <= 0) {
      rig.oneShotT = null;
      rig.oneShot = null;
      if (!o.hold) crossTo(rig, clipFor(rig, rig.base), 0.3, true);
      o.resolve();
    }
  }
}

export function setMoving(rig, moving, run) {
  if (moving) {
    rig.wasCrouched = rig.crouched;
    rig.crouched = false;
    const name = clipFor(rig, run ? 'run' : 'walk');
    if (name && rig.current !== name) crossTo(rig, name, 0.2, true);
  } else {
    setBase(rig, rig.base === 'walk' || rig.base === 'run' ? 'idle' : rig.base, 0.25);
    crossTo(rig, clipFor(rig, rig.crouched && rig.base === 'idle' ? 'crouch' : rig.base), 0.25, true);
  }
}
