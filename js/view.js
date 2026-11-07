// Ember Squad: the 3D board. Scene, camera, touch controls, overlays and effects.
import * as THREE from 'three';
import { buildUnit, tickRig, glowTex, shieldTex, mat } from './models.js';
import { makeRng } from './data.js';
import { buildWorld, primeWorld, variants as variantsFor } from './world.js';
import { setGrassImpostor } from './kit.js';
import { setPaleTextures } from './chars.js';
import { texSet } from './assets.js';
import { loadBiome, loadChars, hdr, SKIES } from './assets.js';
import { makeCharacter, tickChar, setBase, playOnce, setMoving, RIM } from './chars.js';
import { Post } from './post.js';
import { buildCarrier, loadHangar, hangarEnv } from './carrier.js';

// sun: direction (x, y, z), colour, strength. env: sky light strength. exp: exposure. fog: haze colour and range.
const LIGHTS = {
  day: { sunDir: [-0.7, 0.62, 0.42], sun: '#fff1de', sunI: 3.2, env: 0.75, exp: 0.95, fog: '#aebccb', fogNear: 30, fogFar: 85, rim: 0.1, hemi: ['#cfe0ff', '#5a5040', 0.25], grade: { sat: 1.05, contrast: 1.06, tint: [1.0, 0.995, 0.985], vig: 0.3, bloom: 0.22, lift: 0.035 } },
  dusk: { sunDir: [0.85, 0.32, -0.45], sun: '#ffc08a', sunI: 2.9, env: 0.6, exp: 1.0, fog: '#8c8078', fogNear: 26, fogFar: 75, rim: 0.18, hemi: ['#56628a', '#4a3c30', 0.45], grade: { sat: 1.04, contrast: 1.08, tint: [1.02, 0.99, 0.97], vig: 0.36, bloom: 0.32, lift: 0.045 } },
  night: { sunDir: [0.45, 0.7, 0.55], sun: '#a8bcff', sunI: 1.25, env: 0.42, exp: 0.98, fog: '#131a26', fogNear: 14, fogFar: 46, rim: 0.32, hemi: ['#5a74a8', '#161a22', 0.5], grade: { sat: 0.92, contrast: 1.1, tint: [0.94, 0.98, 1.05], vig: 0.42, bloom: 0.55, lift: 0.065 } },
  spireday: { sunDir: [-0.5, 0.75, -0.4], sun: '#f4f0ff', sunI: 2.8, env: 0.8, exp: 1.22, fog: '#6a7088', fogNear: 26, fogFar: 72, rim: 0.12, hemi: ['#c8c0ff', '#3a3248', 0.45], grade: { sat: 0.95, contrast: 1.08, tint: [0.97, 0.99, 1.03], vig: 0.34, bloom: 0.28, lift: 0.045 } },
  spirenight: { sunDir: [0.3, 0.8, 0.5], sun: '#8fa8ff', sunI: 0.8, env: 0.5, exp: 0.95, fog: '#141a26', fogNear: 14, fogFar: 46, rim: 0.32, hemi: ['#5a70a8', '#181a24', 0.36], grade: { sat: 0.95, contrast: 1.12, tint: [0.93, 0.98, 1.06], vig: 0.44, bloom: 0.55, lift: 0.045 } },
  spire: { sunDir: [-0.45, 0.42, -0.7], sun: '#ffd4b0', sunI: 2.6, env: 0.6, exp: 0.9, fog: '#3d3647', fogNear: 24, fogFar: 70, rim: 0.18, hemi: ['#c0b8ff', '#201828', 0.25], grade: { sat: 1.0, contrast: 1.1, tint: [0.98, 0.98, 1.04], vig: 0.4, bloom: 0.3, lift: 0.045 } },
};
const BLUE = new THREE.Color('#47a8f5'), YELLOW = new THREE.Color('#ff9a5a'), ORANGE = new THREE.Color('#ff7a3d'), GREEN = new THREE.Color('#6fdc7a'), MIDBLUE = new THREE.Color('#a9d8ff');
const v3 = new THREE.Vector3();
// bolt colours: Ember Company fires orange, the Pale fire cyan
const BOLT = { ember: '#ff6a2a', pale: '#5ff0ff' };
let _boltGeo = null;

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envCache = new Map();
    this.quality = 'high';
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#1a201c');
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.5, 220);
    this.cam = { tx: 10, tz: 10, yaw: Math.PI / 4, dist: 24 };
    this.goal = { ...this.cam };
    this.bounds = { w: 22, h: 22 };
    this.shake = 0;
    this.hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.flash = new THREE.PointLight('#ffcf8a', 0, 9, 2);
    // a soft warm fill from the side opposite the sun (no shadows): backlit walls at dusk keep some shape
    this.fillLight = new THREE.DirectionalLight('#ffb27a', 0);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.flash, this.fillLight, this.fillLight.target);
    this.world = new THREE.Group();
    this.scene.add(this.world);
    // short-lived effects (shots, blasts, puffs) live here, so a mission change clears them with the world
    this.fxRoot = new THREE.Group();
    this.scene.add(this.fxRoot);
    this.rigs = new Map();
    this.objMeshes = new Map();
    this.tweens = [];
    this.fx = [];
    this.time = 0;
    this.follow = null;
    this.selected = null;
    this.onTap = null;
    this.onFrame = null;
    this.raycaster = new THREE.Raycaster();
    this.buildOverlays();
    this.initControls();
    this.post = new Post(r, this.scene, this.camera);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.post) this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 48 : 36;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ mission setup
  setQuality(q) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 1.6) : Math.min(dpr, 1));
    this.resize();
    if (this.post) this.post.setLook({ ao: q === 'high' });
  }
  async prepare(biome, time, progress = () => {}, enemies = true) {
    await loadBiome(biome, time, (f) => progress(f * 0.9), enemies);
    await primeWorld(biome);
    this.chars = await loadChars(enemies).catch(() => null);
    setPaleTextures(await texSet('dark_rock').catch(() => null));
    const sky = SKIES[biome === 'spire' ? 'spire' : time];
    if (!this.envCache.has(sky)) {
      const t = await hdr(sky);
      this.envCache.set(sky, this.pmrem.fromEquirectangular(t).texture);
    }
    progress(1);
  }
  // The carrier's hangar: textures and the soldiers' bodies.
  async prepareCarrier(progress = () => {}) {
    let done = 0;
    const step = (p) => p.then((v) => { progress(++done / 2); return v; });
    const [, chars] = await Promise.all([step(loadHangar()), step(loadChars(false).catch(() => null))]);
    this.chars = chars;
  }
  // Build the hangar in place of a mission map. The camera then moves between named stations.
  setCarrier() {
    this.cine = null;
    this.cineCur = null;
    this.stationNow = null;
    this.clearWorld();
    this.map = null;
    this.skyDome = null;
    this.fogCanvas = null;
    this.bounds = { w: 24, h: 36 };
    this.carrierEnv ||= hangarEnv(this.renderer);
    this.scene.environment = this.carrierEnv;
    this.scene.background = new THREE.Color('#020309');
    this.scene.fog = new THREE.Fog('#0b1220', 40, 150);
    this.fogColor = null;
    this.light = { grade: { sat: 1.06, contrast: 1.08, tint: [0.98, 1.0, 1.04], vig: 0.4, bloom: 0.28, lift: 0.03 } };
    this.hemi.color.set('#8ea4c8');
    this.hemi.groundColor.set('#262a33');
    this.hemi.intensity = 1.15;
    this.fillLight.intensity = 0;
    RIM.squad.value.set('#b8ccff').multiplyScalar(0.16);
    this.sun.color.set('#e8eeff');
    this.sun.intensity = 2.2;
    this.renderer.toneMappingExposure = 1.0;
    this.sun.position.set(9, 30, 7);
    this.sun.target.position.set(0, 0, 0);
    const sc = this.sun.shadow.camera;
    sc.left = -16; sc.right = 16; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 70;
    sc.updateProjectionMatrix();
    this.sun.shadow.radius = 4;
    this.post.setLook(this.light.grade);
    this.post.setLook({ ao: this.quality === 'high' });
    // starlight through the bay door, falling off down the hangar
    const door = new THREE.SpotLight('#fff0dc', 900, 80, 0.62, 0.8, 2);
    door.position.set(-6, 7, -32);
    door.target.position.set(0, 0, 2);
    this.world.add(door, door.target);
    // two high fills along the walls so the plating and catwalks read
    for (const x of [-7, 7]) { const f = new THREE.PointLight('#cfdcff', 40, 24, 1.6); f.position.set(x, 7.5, 2); this.world.add(f); }
    this.carrier = buildCarrier(this);
    // the hangar's ship shares materials with the drop ship: full reflections back
    if (this.carrier.ship) this.envFit(this.carrier.ship.root, 1);
    this.world.add(this.carrier.root);
    this.envScale = 0.7;
    this.world.traverse((o) => { if (o.isMesh && o.material && !o.material.isShaderMaterial) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.envMapIntensity = m.userData.baseEnv ?? (m.userData.baseEnv = m.envMapIntensity ?? 1); });
    this.lamps = []; this.poles = []; this.trees = []; this.roofs = null; this.torch = null;
    this.goal.tx = this.cam.tx = 0; this.goal.tz = this.cam.tz = 0;
    // compile every material now, so turning to a new part of the hangar never stalls a frame
    try { this.renderer.compile(this.scene, this.camera); } catch { /* compiled on first draw instead */ }
  }
  // Spare armour on display stands: a fitted set lifted off a posed body and hung on a pole, so the stands show
  // the same plates the squad wears.
  armourStands(list) {
    if (!this.chars || !this.carrier) return;
    const metal = new THREE.MeshStandardMaterial({ color: '#2a2e35', roughness: 0.45, metalness: 0.75 });
    for (const s of list) {
      const rig = makeCharacter({ side: 'ember', kind: s.kind, id: 'stand', kit: s.kit }, this.chars);
      if (!rig || !rig.armour) continue;
      setBase(rig, 'idle', 0);
      rig.mixer.setTime(0.5);
      rig.root.updateMatrixWorld(true);
      const g = new THREE.Group();
      rig.model.traverse((o) => {
        if (!o.isSkinnedMesh) return;
        const m = o.material;
        m.map = null; m.emissiveMap = null; m.normalMap = null; m.emissive.set('#000000');
        m.color.set('#3b3e44'); m.roughness = 0.6; m.metalness = 0.1; m.needsUpdate = true;
      });
      if (rig.gun) rig.gun.visible = false;
      g.add(rig.root);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.05, 20), metal);
      base.position.y = 0.025; base.castShadow = base.receiveShadow = true;
      g.add(base);
      rig.root.position.y = 0.05;
      rig.root.updateMatrixWorld(true);
      g.position.set(s.x, 0, s.z);
      g.rotation.y = s.yaw;
      this.carrier.root.add(g);
    }
  }
  // Glide the camera to a hangar station (or jump there).
  // The camera turns away from its subject just enough to put it s.x of the way across the screen (centred when narrow).
  station(name, instant = false) {
    const s = this.carrier && this.carrier.stations[name];
    if (!s) return;
    const frac = innerWidth > 900 ? s.x : 0.5;
    const tanH = Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect;
    const at = s.look.clone().sub(s.eye).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan((frac - 0.5) * 2 * tanH)).add(s.eye);
    this.stationNow = s;
    this.hemiGoal = s.fill;
    this.cine = { p: s.eye.clone(), t: at, speed: 1.7 };
    // a long move would glide through the dropship: cut instead
    if (instant || !this.cineCur || this.cineCur.p.distanceTo(s.eye) > 9) this.cineCur = { p: s.eye.clone(), t: at.clone() };
  }
  makeGrassImpostor() {
    if (this.grassDone) return;
    const vs = variantsFor('grass_medium_02').concat(variantsFor('grass_medium_01'));
    if (!vs.length) return;
    this.grassDone = true;
    const sc = new THREE.Scene();
    const row = new THREE.Group();
    vs.slice(0, 5).forEach((v, i) => {
      const c = v.obj.clone(true);
      c.traverse((o) => { if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ map: o.material.map, color: '#ffffff', side: THREE.DoubleSide }); });
      c.position.x = (i - 2) * 0.35;
      c.rotation.y = i * 1.3;
      row.add(c);
    });
    sc.add(row);
    const box = new THREE.Box3().setFromObject(row);
    const w = box.max.x - box.min.x, h = box.max.y - box.min.y;
    const cam = new THREE.OrthographicCamera(box.min.x, box.max.x, box.max.y, box.min.y, -10, 10);
    cam.position.set(0, 0, 5);
    const S = 512, H = Math.round(S * Math.min(1, h / w));
    const rt = new THREE.WebGLRenderTarget(S, H);
    const r = this.renderer;
    const prevClear = r.getClearAlpha(), prevColor = r.getClearColor(new THREE.Color());
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(sc, cam);
    const px = new Uint8Array(S * H * 4);
    r.readRenderTargetPixels(rt, 0, 0, S, H, px);
    r.setRenderTarget(null);
    r.setClearColor(prevColor, prevClear);
    rt.dispose();
    const t = new THREE.DataTexture(px, S, H);
    t.colorSpace = THREE.LinearSRGBColorSpace;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    setGrassImpostor(t);
  }
  setMission(map, time) {
    this.cine = null;
    this.stationNow = null;
    this.clearWorld();
    this.carrier = null;
    this.skyDome = null;
    this.ships = [];
    this.map = map;
    this.bounds = { w: map.w, h: map.h };
    const key = map.biome === 'spire' ? 'spire' : time;
    let L = (map.biome === 'spire' ? LIGHTS[time === 'day' ? 'spireday' : time === 'night' ? 'spirenight' : 'spire'] : LIGHTS[key]) || LIGHTS.day;
    // the farm's soil went pink under an orange key and a blue fill: a yellower key and a neutral fill keep it ochre
    if (map.biome === 'farm' && key === 'dusk') L = { ...L, sun: '#ffc874', env: 0.55, hemi: ['#6f7a80', '#4a4030', 0.62], grade: { ...L.grade, sat: L.grade.sat * 0.85, tint: [1.0, 1.0, 0.94] } };
    this.light = L;
    this.scene.environment = this.envCache.get(SKIES[key]) || null;
    this.hemi.color.set(L.hemi[0]);
    this.hemi.groundColor.set(L.hemi[1]);
    this.hemi.intensity = L.hemi[2];
    // character rim: faint in daylight, stronger at night so the squad never sinks into the ground
    RIM.squad.value.set('#b8ccff').multiplyScalar(L.rim);
    RIM.pale.value.set('#8feaff').multiplyScalar(L.rim * 0.8);
    this.sun.color.set(L.sun);
    this.sun.intensity = L.sunI;
    this.renderer.toneMappingExposure = L.exp;
    const cx = map.w / 2 - 0.5, cz = map.h / 2 - 0.5;
    const d = new THREE.Vector3(...L.sunDir).normalize();
    this.sun.position.set(cx + d.x * 40, d.y * 40, cz + d.z * 40);
    this.sun.target.position.set(cx, 0, cz);
    this.fillLight.position.set(cx - d.x * 40, 14, cz - d.z * 40);
    this.fillLight.target.position.set(cx, 0, cz);
    this.fillLight.color.set(key === 'night' ? '#8fa4d8' : '#ffb27a');
    this.fillLight.intensity = { day: 0.25, dusk: map.biome === 'farm' ? 0.75 : 0.5, night: 0.8, spire: 0.3 }[key] ?? 0.3;
    const sc = this.sun.shadow.camera;
    const ext = map.w * 0.8;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 110;
    sc.updateProjectionMatrix();
    this.sun.shadow.radius = key === 'night' ? 1.5 : 3;
    this.fogColor = new THREE.Color(L.fog);
    this.scene.background = this.fogColor;
    this.skyLevel = L.env * 1.1;
    this.scene.fog = new THREE.Fog(L.fog, L.fogNear, L.fogFar);
    this.post.setLook(L.grade);
    this.fill.material.opacity = key === 'night' || L === LIGHTS.spirenight ? 0.05 : 0.1;
    this.post.setLook({ ao: this.quality === 'high' });

    const w = buildWorld(map, time, this.world);
    this.envScale = L.env;
    this.world.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        // materials are shared between missions: scale from the original value every time
        if (m.userData.baseEnv === undefined) m.userData.baseEnv = m.envMapIntensity ?? 1;
        m.envMapIntensity = m.userData.baseEnv * L.env;
      }
    });
    this.objMeshes = w.objMeshes;
    this.roofs = w.roofs;
    this.lamps = [];
    this.poles = w.lamps.map((p) => [p.x, p.z]);
    if (key === 'night' || key === 'dusk') {
      // a few real lights spread across the map (the iPad budget); every lamp glows, and the
      // lamps without a real light paint a warm pool on the ground instead
      const all = w.lamps, budget = key === 'night' ? 5 : 3;
      // the two lamps nearest the squad's start always get real lights (the opening view should be lit), the rest spread out
      const sd = (p) => Math.hypot(p.x - map.w / 2, p.z - (map.h - 3));
      const near = all.slice().sort((a, c) => sd(a) - sd(c)).slice(0, 2), rest = all.filter((p) => !near.includes(p)), n2 = budget - near.length;
      const lit = new Set(all.length <= budget ? all : [...near, ...Array.from({ length: n2 }, (_, i) => rest[Math.round((i * (rest.length - 1)) / Math.max(1, n2 - 1))])]);
      const flat = (pos, r, color, opacity) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
        m.position.set(pos.x, 0.045, pos.z);
        m.userData.noAO = true;
        this.world.add(m);
      };
      for (const p of all) {
        if (lit.has(p)) {
          // floodlights throw a cone of cool white down the lane; street lamps a warm pool
          let l;
          if (p.flood) {
            const yard = map.biome === 'yard';
            l = new THREE.SpotLight(yard ? '#ffb060' : '#fff1dc', key === 'night' ? (yard ? 90 : 40) : 22, yard ? 20 : 16, 0.75, 0.6, 2);
            l.target.position.copy(p.flood);
            this.world.add(l.target);
          } else l = new THREE.PointLight('#ffc27a', key === 'night' ? 16 : 8, 8, 2);
          l.position.copy(p);
          this.world.add(l);
          this.lamps.push(l);
        }
        // floodlights always paint their pool; street lamps only when they have no real light
        if (p.flood || !lit.has(p)) flat(p.flood || p, p.flood ? 3.4 : 2.4, p.flood ? (map.biome === 'yard' ? '#ffb060' : '#fff0d8') : '#ffb868', key === 'night' ? (p.flood && lit.has(p) ? (map.biome === 'yard' ? 0.34 : 0.2) : 0.32) : 0.16);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: p.flood ? (map.biome === 'yard' ? '#ffc070' : '#fff4e0') : '#ffcf8a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.4 }));
        glow.position.copy(p);
        glow.scale.setScalar(p.flood ? 0.45 : 0.26);
        this.world.add(glow);
      }
    }
    if (map.biome === 'spire' && key !== 'day') {
      // crystal pillars light the ground around them in cyan
      const live = (t) => map.objects.filter((o) => !o.gone && o.type === t);
      const pillars = live('pillar').length >= 4 ? live('pillar') : [...live('pillar'), ...live('shard')];
      const pick = pillars.length <= 4 ? pillars : Array.from({ length: 4 }, (_, i) => pillars[Math.round((i * (pillars.length - 1)) / 3)]);
      for (const o of pick) {
        const [tx, ty] = o.tiles ? o.tiles[0] : [o.x, o.y];
        const l = new THREE.PointLight('#5ae8f4', key === 'night' ? 12 : 6, 7.5, 2);
        l.position.set(tx, 1.4, ty);
        this.world.add(l);
        this.lamps.push(l);
      }
    }
    this.torch = null;
    if (key === 'night' || key === 'dusk') {
      this.torch = new THREE.PointLight('#dfe8ff', key === 'night' ? 1.1 : 1.0, 9, 1.4);
      this.world.add(this.torch);
    }
    fireBook();
    // a sky dome: the fog's colour at the horizon, a glow band just above it, then darkening fast over the first
    // 25 degrees (all a close camera sees) to the zenith
    const sk = map.biome === 'spire' ? (time === 'night' ? 'night' : 'spire') : key;
    const zen = { day: '#5b7aa6', dusk: '#2b2d4a', night: '#070b16', spire: '#2a2240' }[sk] || '#5b7aa6';
    const glow = { day: '#d4d2cc', dusk: '#c9805a', night: '#1c2438', spire: '#8a5a7a' }[sk] || '#d4d2cc';
    const mid = { day: '#8fa8c8', dusk: '#a0604a', night: '#121a2c', spire: '#4a3450' }[sk] || '#8fa8c8';
    // the giant sits on the far side of the map: light it from the camera's side of the sun so it shows a lit face, not a crescent
    this.world.add(frontierSky(cx, cz, map.w, { sun: new THREE.Vector3(L.sunDir[0], L.sunDir[1], Math.abs(L.sunDir[2]) * 0.6 + 0.25).normalize(), sky: new THREE.Color(glow), haze: sk === 'day' ? 0.25 : 0.1, bright: sk === 'night' ? 0.3 : 1 }));
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(195, 32, 16), new THREE.ShaderMaterial({
      uniforms: { uZen: { value: new THREE.Color(zen) }, uHor: { value: new THREE.Color(L.fog) }, uGlow: { value: new THREE.Color(glow) }, uMid: { value: new THREE.Color(mid) } },
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uGlow; uniform vec3 uMid; varying vec3 vD;
        void main(){ vec3 c = mix(uHor, uGlow, smoothstep(0.0, 0.02, vD.y)); c = mix(c, uMid, smoothstep(0.02, 0.21, vD.y)); c = mix(c, uZen, smoothstep(0.21, 0.7, vD.y)); gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    }));
    this.skyDome.renderOrder = -10;
    this.skyDome.userData.noAO = true;
    this.world.add(this.skyDome);
    this.trees = w.trees || [];
    const fc = document.createElement('canvas');
    fc.width = map.w; fc.height = map.h;
    this.fogCanvas = fc;
    this.fogTex = new THREE.CanvasTexture(fc);
    this.fogTex.magFilter = THREE.LinearFilter;
    this.fogTex.minFilter = THREE.LinearFilter;
    const fog = new THREE.Mesh(new THREE.PlaneGeometry(map.w, map.h), new THREE.MeshBasicMaterial({ map: this.fogTex, transparent: true, depthWrite: false }));
    fog.rotation.x = -Math.PI / 2;
    fog.position.set(cx, 0.03, cz);
    fog.renderOrder = 1;
    this.world.add(fog);
    this.goal.tx = this.cam.tx = cx;
    this.goal.tz = this.cam.tz = map.h - 6;
    this.goal.dist = this.cam.dist = 14;
  }

  clearWorld() {
    this.setArcs?.([]);
    this.showArcPreview?.(null);
    // free the GPU side of everything the mission built; shared cached assets are simply re-uploaded when reused
    const seen = new Set();
    const free = (m) => { if (!m || seen.has(m)) return; seen.add(m); for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); };
    for (const root of [this.world, this.fxRoot]) root.traverse((o) => {
      if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(free);
    });
    for (const c of [...this.world.children]) this.world.remove(c);
    for (const c of [...this.fxRoot.children]) this.fxRoot.remove(c);
    this.rigs.clear();
    this.objMeshes.clear();
    this.fx = [];
    this.smokeLive = 0;
    this.smokeGroups = new Map();
    this.evacGroup = null;
    this.cacheGroup = null;
    this.clearAll();
    this.setSelected(null);
  }

  // ------------------------------------------------------------ units
  addUnit(u) {
    const rig = (u.kind !== 'drone' && makeCharacter(u, this.chars)) || buildUnit(u);
    if (rig.hover) {
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 4), new THREE.MeshBasicMaterial({ color: '#9ff6ff', transparent: true, opacity: 0.35, depthWrite: false }));
      line.position.y = (rig.height * 0.72) / 2;
      line.scale.y = rig.height * 0.72;
      const dot = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#9ff6ff', transparent: true, opacity: 0.45, depthWrite: false }));
      dot.position.y = 0.04;
      rig.root.add(line, dot);
    }
    rig.phase = Math.random() * 6;
    // characters take the map's sky-light strength like the world does (at night they were mirrors of a day sky)
    if (!this.carrier && this.envScale) this.envFit(rig.root);
    rig.root.position.set(u.x, 0, u.y);
    rig.yaw = u.side === 'ember' ? Math.PI : 0;
    rig.targetYaw = rig.yaw;
    rig.root.rotation.y = rig.yaw;
    rig.hit.userData.unitId = u.id;
    rig.unit = u;
    this.world.add(rig.root);
    this.rigs.set(u.id, rig);
    return rig;
  }
  rig(u) { return this.rigs.get(u.id); }
  setVisible(u, vis) { const r = this.rig(u); if (r) r.root.visible = vis; }
  place(u) { const r = this.rig(u); if (r) r.root.position.set(u.x, 0, u.y); }
  // Turn toward a tile. When aiming, turn a little further so the barrel (not the chest) points at it.
  face(u, tx, ty, aiming) {
    const r = this.rig(u);
    if (r && r.dying) return;
    if (r && (tx !== u.x || ty !== u.y)) r.targetYaw = Math.atan2(tx - u.x, ty - u.y) - ((aiming || r.base === 'aim') && r.aimOffset ? r.aimOffset : 0);
  }
  removeUnit(u) {
    const r = this.rig(u);
    if (r) { this.world.remove(r.root); this.rigs.delete(u.id); }
  }

  async walk(u, path, onStep, follow) {
    const r = this.rig(u);
    if (!r) return;
    r.moving = true;
    r.volleyRaised = false;
    const run = path.length > 4;
    if (r.isChar) setMoving(r, true, run);
    if (follow) this.follow = r;
    for (let i = 1; i < path.length; i++) {
      const [x0, y0] = path[i - 1], [x1, y1] = path[i];
      r.targetYaw = Math.atan2(x1 - x0, y1 - y0);
      const dur = Math.hypot(x1 - x0, y1 - y0) * (r.isChar ? (run ? 0.27 : 0.5) : follow ? 0.15 : 0.11);
      await this.tween(dur, (k) => r.root.position.set(x0 + (x1 - x0) * k, 0, y0 + (y1 - y0) * k));
      if (onStep && (await onStep(i)) === false) break;
    }
    r.moving = false;
    if (r.isChar) setMoving(r, false);
    if (this.follow === r) this.follow = null;
  }

  // Animation hooks used by the rules code.
  pose(u, name) {
    const r = this.rig(u);
    if (r) r.volleyRaised = false;
    if (!r || !r.isChar || this.instant) return Promise.resolve();
    switch (name) {
      case 'aim': setBase(r, 'aim'); return this.wait(0.25);
      case 'idle': setBase(r, 'idle'); return Promise.resolve();
      case 'overwatch': setBase(r, 'aim'); return this.wait(0.3);
      case 'hunker': r.crouched = true; setBase(r, 'idle'); return this.wait(0.3);
      case 'reload': return playOnce(r, 'reload', { portion: 0.85 });
      case 'throw': return playOnce(r, 'throw', { portion: 0.55, speed: 1.3 });
      case 'heal': r.crouched = true; setBase(r, 'idle'); return this.wait(0.6);
      case 'hit': return playOnce(r, 'hit', { portion: 0.6 });
      case 'melee': return playOnce(r, 'melee', { portion: 0.7 });
      case 'cast': return playOnce(r, 'cast', { portion: 0.7 });
      default: return Promise.resolve();
    }
  }
  aim(u, on) {
    const r = this.rig(u);
    if (r) r.volleyRaised = false;
    if (r && r.isChar) setBase(r, on ? 'aim' : 'idle');
  }
  // After moving: crouch behind half cover, stand by full cover, face the cover.
  settle(u, covers) {
    const r = this.rig(u);
    if (!r || !r.isChar) return;
    r.volleyRaised = false;
    const best = covers.reduce((a, c) => (!a || c.c > a.c ? c : a), null);
    r.crouched = !!best && best.c === 1;
    if (best) r.targetYaw = Math.atan2(best.dx, best.dy);
    setBase(r, 'idle', 0.35);
  }

  // ------------------------------------------------------------ camera
  focus(x, y, opts = {}) {
    if (opts.instant) this.roofSnap = true;
    this.goal.tx = x;
    this.goal.tz = y;
    if (opts.dist) this.goal.dist = opts.dist;
    if (opts.instant) Object.assign(this.cam, this.goal);
  }
  focusPair(a, b) {
    this.focus((a.x + b.x) / 2, (a.y + b.y) / 2);
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    this.goal.dist = Math.max(Math.min(this.goal.dist, 16), Math.min(16, 11 + d * 0.6));
  }
  rotate(dir) { this.goal.yaw += (dir * Math.PI) / 4; }
  // Scale an object's reflections to this map's sky light (k = 1 restores them, for the hangar).
  envFit(root, k = Math.min(1, (this.envScale ?? 1) * 1.3)) {
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.userData.baseEnv === undefined) m.userData.baseEnv = m.envMapIntensity ?? 1;
        m.envMapIntensity = m.userData.baseEnv * k;
      }
    });
  }
  // A tactical yaw from which every unit in the group is clear of walls and containers (the current one first).
  clearYaw(mid, group, dist) {
    if (!this.map) return this.goal.yaw;
    const pitch = 0.66 + Math.min(1, Math.max(0, (dist - 9) / 24)) * 0.3, cp = Math.cos(pitch), sp = Math.sin(pitch);
    for (const k of [0, 1, -1, 2, -2, 3, -3, 4]) {
      const yaw = this.goal.yaw + (k * Math.PI) / 4;
      const ex = mid.x + Math.sin(yaw) * cp * dist, ey = sp * dist, ez = mid.y + Math.cos(yaw) * cp * dist;
      const ok = group.every((u) => {
        for (let t = 0.05; t < 0.97; t += 0.02) {
          const x = Math.round(ex + (u.x - ex) * t), z = Math.round(ez + (u.y - ez) * t), y = ey + (1.0 - ey) * t;
          if (y < 2.3 && !(x === u.x && z === u.y) && this.map.inside(x, z) && this.map.blocksLOS(x, z)) return false;
        }
        return true;
      });
      if (ok) return yaw;
    }
    return this.goal.yaw;
  }
  // Over-the-shoulder camera for a shot: behind and right of the shooter, looking at the target.
  shoulderCam(from, to) {
    if (this.instant) return;
    const a = new THREE.Vector3(from.x, 0, from.y), b = new THREE.Vector3(to.x, 0, to.y);
    const dir = b.clone().sub(a).normalize();
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    const beyond = b.clone().addScaledVector(dir, 7);
    if (this.map && !this.map.inside(Math.round(beyond.x), Math.round(beyond.z))) return;
    // right shoulder first, then the left, then wider: skip any spot with a wall behind it or a post in the sight line
    for (const side of [1.05, -1.05, 1.45, -1.45]) {
      const p = a.clone().addScaledVector(dir, -3.0).addScaledVector(right, side);
      p.y = 1.95;
      if (this.camBlocked(p) || this.postInSight(p, b) || !this.clearView(p, b)) continue;
      this.cine = { p, t: b.clone().setY(1.0) };
      this.cineCur = { p: p.clone(), t: this.cine.t.clone() };
      this.cineOut = null;
      this.skyOn(true);
      return;
    }
  }
  // A lamp post within 0.6 tiles of the near 70% of the sight line splits the frame.
  postInSight(p, b) {
    const sx = b.x - p.x, sz = b.z - p.z, len2 = sx * sx + sz * sz;
    return (this.poles || []).some(([x, z]) => {
      const t = Math.max(0, Math.min(0.7, ((x - p.x) * sx + (z - p.z) * sz) / len2));
      return Math.hypot(p.x + sx * t - x, p.z + sz * t - z) < 0.6;
    });
  }
  // Close cameras see the horizon: show the blurred sky instead of a flat fog colour.
  skyOn(on) {
    // missions have their own sky dome that meets the fog at the horizon
    if (this.carrier || this.skyDome) return;
    if (on && this.scene.environment) {
      this.scene.background = this.scene.environment;
      this.scene.backgroundBlurriness = 0.3;
      this.scene.backgroundIntensity = this.skyLevel ?? 0.8;
    } else if (this.fogColor) this.scene.background = this.fogColor;
  }
  lowCam(from, to, group) {
    if (this.instant) return;
    const a = new THREE.Vector3(from.x, 0, from.y), b = new THREE.Vector3(to.x, 0, to.y);
    const dir = b.clone().sub(a).normalize();
    const p = a.clone().addScaledVector(dir, -2.5);
    p.y = 2.2;
    if (this.camBlocked(p) || !this.clearView(p, b) || p.distanceTo(b) > 13) return;
    if (group && group.some((u) => { const q = new THREE.Vector3(u.x, 0, u.y); return !this.clearView(p, q) || q.clone().sub(p).setY(0).normalize().dot(dir) < 0.94; })) return;
    this.cine = { p, t: b.clone().setY(0.9) };
    this.cineCur = { p: p.clone(), t: this.cine.t.clone() };
    this.cineOut = null;
    this.skyOn(true);
  }
  // Does a straight line from the camera to the target stay clear of walls?
  clearView(p, b) {
    if (!this.map) return true;
    for (let k = 0.1; k < 0.97; k += 0.035) {
      const x = Math.round(p.x + (b.x - p.x) * k), z = Math.round(p.z + (b.z - p.z) * k);
      if (this.map.inside(x, z) && this.map.blocksLOS(x, z)) return false;
    }
    return true;
  }
  // Compile every material the scene now holds before a cinematic starts, so its first frames do not stall
  // (the drop ship on a fresh map froze the picture for about 2 s while its shaders compiled).
  async precompile() {
    if (this.instant) return;
    try { await (this.renderer.compileAsync ? this.renderer.compileAsync(this.scene, this.camera) : this.renderer.compile(this.scene, this.camera)); } catch { /* compiled on first draw instead */ }
  }
  endCine() {
    if (this.cine && this.cineCur && !this.carrier && !this.instant) this.cineOut = { p: this.camera.position.clone(), t: this.cineCur.t.clone(), t0: this.time, dur: 0.55 };
    this.cine = null;
    this.stationNow = null;
    this.skyOn(false);
  }
  // A fixed low camera for the menu lineup: eye at (px, 1.55, pz), looking at (tx, 0.8, tz).
  heroCam(px, pz, tx, tz) {
    this.cine = { p: new THREE.Vector3(px, 1.55, pz), t: new THREE.Vector3(tx, 0.8, tz) };
    this.skyOn(true);
  }
  camBlocked(p) {
    if (!this.map) return false;
    const tx = Math.round(p.x), tz = Math.round(p.z);
    if (!this.map.inside(tx, tz)) return false;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (this.map.blocksLOS(tx + dx, tz + dz) && Math.hypot(tx + dx - p.x, tz + dz - p.z) < 0.9) return true;
    return (this.map.buildings || []).some((b) => p.x > b.x0 - 0.7 && p.x < b.x0 + b.w - 0.3 && p.z > b.y0 - 0.7 && p.z < b.y0 + b.h - 0.3);
  }
  // Trees between the camera and what it looks at fade out.
  fadeTrees() {
    if (!this.trees || !this.trees.length) return;
    const cam = this.camera.position;
    const tgt = this.cine ? this.cine.t : new THREE.Vector3(this.cam.tx, 0.5, this.cam.tz);
    const seg = tgt.clone().sub(cam);
    const len = seg.length();
    seg.normalize();
    for (const t of this.trees) {
      const p = t.getWorldPosition(v3).setY(1.8);
      const along = p.clone().sub(cam).dot(seg);
      const off = along > 0 && along < len + 1.5 ? p.clone().sub(cam).sub(seg.clone().multiplyScalar(along)).length() : 99;
      const want = off < 2.2 ? 0.18 : 1;
      t.userData.fade = (t.userData.fade ?? 1) + (want - (t.userData.fade ?? 1)) * 0.15;
      const f = t.userData.fade;
      if (Math.abs(f - (t.userData.lastF ?? 1)) < 0.01) continue;
      t.userData.lastF = f;
      t.traverse((o) => {
        if (!o.isMesh) return;
        o.material.transparent = f < 0.98;
        o.material.opacity = f;
        o.material.depthWrite = f > 0.5;
        o.castShadow = true;
      });
    }
  }
  zoom(f) { this.goal.dist = Math.max(9, Math.min(36, this.goal.dist * f)); }

  initControls() {
    const c = this.canvas;
    const pts = new Map();
    let g = null;
    let last = null;
    const two = () => {
      const [a, b] = [...pts.values()];
      return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
    };
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) g = { x0: e.clientX, y0: e.clientY, moved: 0, t: performance.now(), multi: false, button: e.button };
      else if (g) g.multi = true;
      last = pts.size === 2 ? two() : null;
    });
    c.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (!g) return;
      if (pts.size === 1) {
        g.moved += Math.abs(dx) + Math.abs(dy);
        if (g.moved < 8) return;
        if (g.button === 2) this.goal.yaw -= dx * 0.006;
        else this.pan(dx, dy);
      } else if (pts.size === 2) {
        const now = two();
        if (last) {
          this.pan(now.mx - last.mx, now.my - last.my);
          if (now.d > 10 && last.d > 10) this.goal.dist = Math.max(9, Math.min(36, this.goal.dist * (last.d / now.d)));
          let da = now.ang - last.ang;
          if (da > Math.PI) da -= Math.PI * 2;
          if (da < -Math.PI) da += Math.PI * 2;
          this.goal.yaw -= da;
        }
        last = now;
      }
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      last = pts.size === 2 ? two() : null;
      if (pts.size === 0 && g) {
        if (!g.multi && g.moved < 10 && performance.now() - g.t < 700 && e.type === 'pointerup' && g.button === 0 && this.onTap) this.onTap(e.clientX, e.clientY);
        g = null;
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  pan(dx, dy) {
    const s = this.cam.dist * 0.0021 * (window.innerHeight > 0 ? 900 / Math.max(500, window.innerHeight) : 1);
    const yaw = this.cam.yaw;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const mx = (-dx * rx + dy * fx) * s, mz = (-dx * rz + dy * fz) * s;
    this.goal.tx += mx; this.goal.tz += mz;
    this.cam.tx += mx; this.cam.tz += mz;
    this.follow = null;
  }

  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.rigs.values()].filter((r) => r.root.visible && !r.dying).map((r) => r.hit), false);
    const out = {};
    if (hits.length) out.unitId = hits[0].object.userData.unitId;
    const ray = this.raycaster.ray;
    if (ray.direction.y < -0.01) {
      const t = -ray.origin.y / ray.direction.y;
      const x = ray.origin.x + ray.direction.x * t, z = ray.origin.z + ray.direction.z * t;
      out.tile = [Math.round(x), Math.round(z)];
    }
    return out;
  }
  project(x, h, y) {
    v3.set(x, h, y).project(this.camera);
    return { x: (v3.x * 0.5 + 0.5) * window.innerWidth, y: (-v3.y * 0.5 + 0.5) * window.innerHeight, behind: v3.z > 1 };
  }
  unitScreen(u, extra = 0.35) {
    const r = this.rig(u);
    if (!r) return null;
    if (r.head) {
      r.head.getWorldPosition(v3);
      return this.project(v3.x, v3.y + extra * 0.6, v3.z);
    }
    const p = r.root.position;
    return this.project(p.x, r.height + extra + (r.hover ? r.body.position.y : 0), p.z);
  }

  // ------------------------------------------------------------ overlays
  buildOverlays() {
    const flat = (g) => { g.rotateX(-Math.PI / 2); return g; };
    const basic = (o) => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, ...o });
    const N = 24 * 24;
    this.fill = new THREE.InstancedMesh(flat(new THREE.PlaneGeometry(1.0, 1.0)), basic({ opacity: 0.12 }), N);
    this.edges = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.02, 0.05), basic({ opacity: 0.9 }), N * 4);
    this.dots = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 10), basic({ opacity: 0.95 }), 160);
    this.aoeFill = new THREE.InstancedMesh(flat(new THREE.PlaneGeometry(0.94, 0.94)), basic({ opacity: 0.32 }), N);
    for (const m of [this.fill, this.edges, this.dots, this.aoeFill]) {
      m.count = 0;
      m.renderOrder = 2;
      m.frustumCulled = false;
      m.setColorAt(0, BLUE);
      this.scene.add(m);
    }
    this.dest = new THREE.Mesh(flat(new THREE.RingGeometry(0.3, 0.42, 32)), basic({ color: '#ffffff', opacity: 0.95 }));
    this.dest.position.y = 0.03;
    this.dest.renderOrder = 3;
    this.aoeRing = new THREE.Mesh(flat(new THREE.RingGeometry(0.96, 1, 64)), basic({ color: '#ff8a3d', opacity: 0.9 }));
    this.aoeRing.position.y = 0.04;
    this.rangeRing = new THREE.Mesh(flat(new THREE.RingGeometry(0.985, 1, 96)), basic({ color: '#ffffff', opacity: 0.35 }));
    this.rangeRing.position.y = 0.035;
    this.selRing = new THREE.Mesh(flat(new THREE.RingGeometry(0.36, 0.46, 40)), basic({ color: '#ff8a3d', opacity: 0.9 }));
    this.selRing.position.y = 0.03;
    this.shields = [0, 1, 2, 3].map(() => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: shieldTex(true), depthTest: false, transparent: true }));
      s.scale.set(0.42, 0.42, 1);
      s.renderOrder = 5;
      return s;
    });
    this.targetRings = [];
    this.aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: '#ff6a5a', dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0.9, depthTest: false }));
    this.aimLine.renderOrder = 4;
    for (const o of [this.dest, this.aoeRing, this.rangeRing, this.selRing, ...this.shields, this.aimLine]) { o.visible = false; o.renderOrder ||= 3; this.scene.add(o); }
  }

  clearAll() {
    this.clearRange();
    this.clearPath();
    this.clearAoe();
    this.showTargets([]);
    this.showArcPreview(null);
    this.aimLine.visible = false;
  }

  // Overwatch arcs on the ground: a fan that brightens toward its reach with a solid rim. The squad's are Ember
  // orange, the enemies' Pale cyan. A preview (while aiming) is brighter and has range ticks.
  arcMesh(arc, preview) {
    const g = new THREE.Group();
    const col = new THREE.Color(arc.side === 'ember' ? '#ffa04a' : '#6fe2ff');
    const N = 32, half = arc.half ?? 0.61, r0 = 0.6, r1 = arc.r + 0.5;
    const at = (a, r, y = 0) => [arc.x + Math.sin(a) * r, 0.05 + y, arc.y + Math.cos(a) * r];
    const pos = [], cols = [];
    const fade = preview ? [0.06, 0.3] : [0.03, 0.17];
    for (let i = 0; i < N; i++) {
      const a0 = arc.a - half + (2 * half * i) / N, a1 = arc.a - half + (2 * half * (i + 1)) / N;
      pos.push(...at(a0, r0), ...at(a0, r1), ...at(a1, r1), ...at(a0, r0), ...at(a1, r1), ...at(a1, r0));
      for (const k of [0, 1, 1, 0, 1, 0]) cols.push(col.r, col.g, col.b, fade[k]);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
    const fill = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    // the rim: two edges and the far arc as a ribbon, so it stays a few pixels wide on a phone screen
    const rim = [];
    const w = preview ? 0.07 : 0.05;
    const ribbon = (pts) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, , az] = pts[i], [bx, , bz] = pts[i + 1];
        const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * w, nz = (dx / l) * w;
        rim.push(ax - nx, 0.055, az - nz, ax + nx, 0.055, az + nz, bx + nx, 0.055, bz + nz, ax - nx, 0.055, az - nz, bx + nx, 0.055, bz + nz, bx - nx, 0.055, bz - nz);
      }
    };
    const outer = [];
    for (let i = 0; i <= N; i++) outer.push(at(arc.a - half + (2 * half * i) / N, r1));
    ribbon([at(arc.a - half, r0), ...outer, at(arc.a + half, r0)]);
    if (preview) for (let r = 3; r < r1 - 0.6; r += 3) { const tick = []; for (let i = 0; i <= 8; i++) tick.push(at(arc.a - half + (2 * half * i) / 8, r)); ribbon(tick); }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rim, 3));
    const rimMesh = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: preview ? 0.95 : 0.7, depthWrite: false, side: THREE.DoubleSide }));
    for (const m of [fill, rimMesh]) { m.renderOrder = 2; m.frustumCulled = false; m.userData.noAO = true; g.add(m); }
    return g;
  }
  setArcs(list) {
    const key = JSON.stringify(list.map((a) => [a.id, a.x, a.y, +a.a.toFixed(3), a.r, a.side]));
    if (key === this.arcKey) return;
    this.arcKey = key;
    if (!this.arcGroup) { this.arcGroup = new THREE.Group(); this.scene.add(this.arcGroup); }
    for (const c of [...this.arcGroup.children]) { c.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); this.arcGroup.remove(c); }
    for (const a of list) this.arcGroup.add(this.arcMesh(a, false));
  }
  showArcPreview(arc) {
    if (this.arcPreview) { this.arcPreview.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); this.scene.remove(this.arcPreview); this.arcPreview = null; }
    if (arc) { this.arcPreview = this.arcMesh(arc, true); this.scene.add(this.arcPreview); }
  }
  clearRange() { this.fill.count = 0; this.edges.count = 0; }
  // Move range in bands, one per action spent: the first filled blue, middle ones faint blue, and the last
  // (every action left) inside a dashed orange edge.
  showRange(bands) {
    const m = new THREE.Matrix4();
    let i = 0;
    const last = bands.length - 1;
    const blue = bands[0] || [], upTo = (k) => bands.slice(0, k + 1).flat();
    const yellow = last > 0 ? upTo(last).slice(blue.length) : [];
    const fills = bands.map((list, k) => [list, k === 0 ? BLUE.clone().multiplyScalar(0.75) : k < last ? BLUE.clone().multiplyScalar(0.3) : null]).filter((f) => f[1]);
    for (const [list, col] of fills) {
      for (const [x, y] of list) {
        m.makeTranslation(x, 0.02, y);
        this.fill.setMatrixAt(i, m);
        this.fill.setColorAt(i, col);
        i++;
      }
    }
    this.fill.count = i;
    this.fill.instanceMatrix.needsUpdate = true;
    if (this.fill.instanceColor) this.fill.instanceColor.needsUpdate = true;
    const key = (x, y) => x * 100 + y;
    const bset = new Set(blue.map(([x, y]) => key(x, y)));
    const aset = new Set([...blue, ...yellow].map(([x, y]) => key(x, y)));
    let e = 0;
    const rot = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    const sc = new THREE.Matrix4();
    const edge = (set, list, col, lift, dashed) => {
      for (const [x, y] of list) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (set.has(key(x + dx, y + dy))) continue;
          for (const off of dashed ? [-0.27, 0.27] : [0]) {
            m.makeTranslation(x + dx * 0.48 + (dy ? off : 0), 0.03 + lift, y + dy * 0.48 + (dx ? off : 0));
            if (dx) m.multiply(rot);
            if (dashed) m.multiply(sc.makeScale(0.32, 1, 1));
            this.edges.setMatrixAt(e, m);
            this.edges.setColorAt(e, col);
            e++;
          }
        }
      }
    };
    if (last > 0) edge(aset, [...blue, ...yellow], YELLOW, 0, true);
    if (last > 1) { const mid = upTo(last - 1); edge(new Set(mid.map(([x, y]) => key(x, y))), mid, MIDBLUE, 0.002, false); }
    edge(bset, blue, BLUE, 0.004, false);
    this.edges.count = e;
    this.edges.instanceMatrix.needsUpdate = true;
    if (this.edges.instanceColor) this.edges.instanceColor.needsUpdate = true;
  }
  showPath(path, dash, covers) {
    const m = new THREE.Matrix4();
    let n = 0;
    const col = dash ? YELLOW : new THREE.Color('#dff1ff');
    for (let i = 1; i < path.length && n < 155; i++) {
      const [x0, y0] = path[i - 1], [x1, y1] = path[i];
      const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) * 3));
      for (let s = 0; s < steps; s++) {
        const k = s / steps;
        m.makeTranslation(x0 + (x1 - x0) * k, 0.03, y0 + (y1 - y0) * k);
        this.dots.setMatrixAt(n, m);
        this.dots.setColorAt(n, col);
        n++;
      }
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
    const [ex, ey] = path[path.length - 1];
    this.dest.position.set(ex, 0.03, ey);
    this.dest.material.color.copy(col);
    this.dest.visible = true;
    this.shields.forEach((s, i) => {
      const c = covers[i];
      s.visible = !!c;
      if (!c) return;
      s.material.map = shieldTex(c.c === 2);
      s.position.set(ex + c.dx * 0.45, c.c === 2 ? 1.2 : 0.8, ey + c.dy * 0.45);
    });
  }
  clearPath() {
    this.dots.count = 0;
    this.dest.visible = false;
    for (const s of this.shields) s.visible = false;
  }
  showRangeRing(x, y, r) {
    this.rangeRing.visible = !!r;
    if (!r) return;
    this.rangeRing.position.set(x, 0.035, y);
    this.rangeRing.scale.setScalar(r);
  }
  showAoe(x, y, r, tiles, color) {
    const m = new THREE.Matrix4();
    const col = color === 'smoke' ? new THREE.Color('#b8c4c8') : color === 'heal' ? GREEN : ORANGE;
    tiles.forEach(([tx, ty], i) => {
      m.makeTranslation(tx, 0.025, ty);
      this.aoeFill.setMatrixAt(i, m);
      this.aoeFill.setColorAt(i, col);
    });
    this.aoeFill.count = tiles.length;
    this.aoeFill.instanceMatrix.needsUpdate = true;
    if (this.aoeFill.instanceColor) this.aoeFill.instanceColor.needsUpdate = true;
    this.aoeRing.visible = r > 0;
    this.aoeRing.material.color.copy(col);
    this.aoeRing.position.set(x, 0.04, y);
    this.aoeRing.scale.setScalar(r + 0.5);
  }
  clearAoe() { this.aoeFill.count = 0; this.aoeRing.visible = false; this.showRangeRing(0, 0, 0); }
  showTargets(units, focusUnit, from) {
    while (this.targetRings.length < units.length) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff5a4f', transparent: true, depthWrite: false }));
      ring.renderOrder = 3;
      this.scene.add(ring);
      this.targetRings.push(ring);
    }
    this.targetRings.forEach((ring, i) => {
      const u = units[i];
      ring.visible = !!u;
      if (!u) return;
      ring.position.set(u.x, 0.035, u.y);
      ring.userData.focus = u === focusUnit;
    });
    this.aimLine.visible = !!(focusUnit && from);
    if (focusUnit && from) {
      const a = this.rig(from), b = this.rig(focusUnit);
      if (a && b) {
        this.aimLine.geometry.setFromPoints([new THREE.Vector3(from.x, 1.0, from.y), new THREE.Vector3(focusUnit.x, b.height * 0.55, focusUnit.y)]);
        this.aimLine.computeLineDistances();
      }
    }
  }
  setSelected(u, color) {
    this.selected = u ? this.rig(u) : null;
    this.selRing.visible = !!this.selected;
    if (color) this.selRing.material.color.set(color);
  }

  setFog(vis) {
    if (!this.fogCanvas || !this.map) return;
    const g = this.fogCanvas.getContext('2d');
    const img = g.createImageData(this.map.w, this.map.h);
    for (let i = 0; i < vis.length; i++) {
      img.data[i * 4] = 6; img.data[i * 4 + 1] = 10; img.data[i * 4 + 2] = 16;
      img.data[i * 4 + 3] = vis[i] ? 0 : 120;
    }
    g.putImageData(img, 0, 0);
    this.fogTex.needsUpdate = true;
  }

  setEvac(evac) {
    if (this.evacGroup) { this.world.remove(this.evacGroup); this.evacGroup = null; }
    if (!evac) return;
    const g = new THREE.Group();
    g.position.set(evac[0], 0, evac[1]);
    // painted landing pad: a ring and corner chevrons, with green flares burning at two corners
    const paint = new THREE.MeshBasicMaterial({ color: '#7dff96', transparent: true, opacity: 0.85, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.12, 1.24, 48).rotateX(-Math.PI / 2), paint);
    ring.position.y = 0.025;
    g.add(ring);
    for (let i = 0; i < 4; i++) {
      const ch = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.28, 3, 1).rotateX(-Math.PI / 2), paint);
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      ch.position.set(Math.cos(a) * 0.75, 0.026, Math.sin(a) * 0.75);
      ch.rotation.y = -a + Math.PI;
      g.add(ch);
    }
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1.2, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#5fe07a', transparent: true, opacity: 0.08, depthWrite: false }));
    fill.position.y = 0.02;
    g.add(fill);
    const flares = [];
    for (const [fx, fz] of [[1.25, 1.25], [-1.25, -1.25]]) {
      const light = new THREE.PointLight('#7dff96', 2, 4, 2);
      light.position.set(fx, 0.25, fz);
      // the flare stick itself
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.2, 8), new THREE.MeshStandardMaterial({ color: '#3a4a3e', roughness: 0.6 }));
      stick.position.set(fx, 0.05, fz);
      stick.rotation.z = 1.2;
      g.add(stick);
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#b8ffc8', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      core.position.set(fx, 0.12, fz);
      core.scale.setScalar(0.35);
      g.add(light, core);
      flares.push([fx, fz, light, core]);
    }
    g.userData.flares = flares;
    g.userData.pulse = fill;
    this.evacGroup = g;
    this.world.add(g);
  }
  setCache(cache, carrier) {
    if (this.cacheGroup) { this.cacheGroup.parent?.remove(this.cacheGroup); this.cacheGroup = null; }
    if (!cache) return;
    const g = new THREE.Group();
    const box = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.36), mat('#3b4046', { rough: 0.4, metal: 0.6 }));
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.04, 0.38), mat('#ffcf6a', { glow: '#ff9c2a', gi: 2.2, rough: 0.3 }));
    strip.position.y = 0.06;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI), mat('#2a2d31', { metal: 0.7, rough: 0.4 }));
    handle.position.y = 0.16;
    box.add(shell, strip, handle);
    box.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    box.position.y = 0.2;
    g.add(box);
    if (carrier) {
      const r = this.rig(carrier);
      if (!r) return;
      g.position.set(0, 0.85, -0.38);
      g.scale.setScalar(0.7);
      r.body.add(g);
    } else {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 6, 8, 1, true), new THREE.MeshBasicMaterial({ color: '#ffc04a', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      beam.position.y = 3;
      g.add(beam);
      g.position.set(cache.x, 0, cache.y);
      g.userData.spin = box;
      this.world.add(g);
    }
    this.cacheGroup = g;
  }
  setSmoke(list) {
    const want = new Set(list.map((s) => s.x + ',' + s.y));
    for (const [k, grp] of this.smokeGroups) if (!want.has(k)) { this.world.remove(grp); this.smokeGroups.delete(k); }
    for (const s of list) {
      const k = s.x + ',' + s.y;
      if (this.smokeGroups.has(k)) continue;
      const grp = new THREE.Group();
      grp.position.set(s.x, 0, s.y);
      const r = makeRng(s.x * 31 + s.y);
      for (let i = 0; i < 22; i++) {
        if (i >= 14) break;
        const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex(), color: '#ece8e0', transparent: true, depthWrite: false, opacity: 0 }));
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 1.5;
        p.position.set(Math.cos(a) * d, 0.3 + r() * 1.2, Math.sin(a) * d);
        p.scale.setScalar(1.2 + r() * 1.0);
        p.userData.s0 = p.scale.x; p.userData.life = 7 + r() * 5;
        p.material.rotation = r() * 6;
        p.userData.base = p.position.y;
        p.userData.ph = r() * 6;
        grp.add(p);
      }
      this.smokeGroups.set(k, grp);
      this.world.add(grp);
    }
  }

  removeObject(o) {
    const g = this.objMeshes.get(o.id);
    if (!g) return;
    this.objMeshes.delete(o.id);
    const start = this.time;
    this.fx.push(() => {
      const k = Math.min(1, (this.time - start) / 0.35);
      g.scale.set(1 + k * 0.2, 1 - k * 0.9, 1 + k * 0.2);
      if (k >= 1) { this.world.remove(g); return false; }
      return true;
    });
    // rubble made of whatever broke
    const r = makeRng(o.id * 7 + 3);
    let src = null;
    g.traverse((m) => { if (!src && m.isMesh && m.material && !m.material.transparent) src = m.material; });
    for (const [x, y] of o.tiles) {
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07 + r() * 0.07, 0).scale(1.3, 0.6, 1), src || mat('#6a6862', { flat: true }));
        b.castShadow = true;
        b.position.set(x + (r() - 0.5) * 0.8, 0.05, y + (r() - 0.5) * 0.8);
        b.rotation.y = r() * 3;
        b.receiveShadow = true;
        this.world.add(b);
      }
    }
  }

  // ------------------------------------------------------------ effects
  tween(dur, fn) {
    if (this.instant) { fn(1); return Promise.resolve(); }
    return new Promise((resolve) => this.tweens.push({ t: 0, dur: Math.max(0.001, dur), fn, resolve }));
  }
  wait(s) { return this.tween(s, () => {}); }

  muzzlePos(u) {
    const r = this.rig(u);
    if (!r) return new THREE.Vector3(u.x, 1, u.y);
    r.root.updateMatrixWorld(true);
    // the big Pale fire as they roar: the blast leaves just in front of the head, wherever the clip has put it
    if (r.isChar && !r.gun && r.head && (u.kind === 'brute' || u.kind === 'overseer')) {
      const e = r.root.matrixWorld.elements;
      return r.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(e[8], 0, e[10]).normalize().multiplyScalar(0.28)).add(new THREE.Vector3(0, -0.06, 0));
    }
    return r.muzzle.getWorldPosition(new THREE.Vector3());
  }
  targetPos(u) {
    const r = this.rig(u);
    return new THREE.Vector3(u.x, r ? r.height * 0.55 : 1, u.y);
  }

  async shotFx(shooter, target, hit, kind) {
    const sr = this.rig(shooter);
    if (sr && sr.isChar && !this.instant) {
      if (sr.type === 'human' && !sr.crouched) playOnce(sr, 'fire', { portion: 0.5 });
      else if (sr.type !== 'human') { playOnce(sr, 'fire', { portion: 0.6 }); await this.wait(0.35); }
      sr.root.updateMatrixWorld(true);
    }
    const from = this.muzzlePos(shooter);
    const to = this.targetPos(target);
    if (!hit) {
      const dir = to.clone().sub(from).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar((Math.random() < 0.5 ? -1 : 1) * (0.55 + Math.random() * 0.5));
      to.add(side).add(dir.multiplyScalar(2.5));
      to.y += (Math.random() - 0.4) * 0.6;
    }
    const pale = shooter.side === 'pale';
    // bolts per trigger pull, the gap between them, their size and speed
    const spec = pale ? [shooter.kind === 'brute' || shooter.kind === 'overseer' ? 3 : 2, 0.12, 1.3, 32]
      : ({ shotgun: [4, 0.025, 0.8, 40], mg: [3, 0.09, 1.0, 42], longrifle: [1, 0, 1.25, 70], rifle: [2, 0.11, 1.0, 40] }[kind] || [1, 0, 1, 40]);
    const color = pale ? BOLT.pale : BOLT.ember;
    this.flash.color.set(color);
    let arrive = Promise.resolve();
    for (let i = 0; i < spec[0]; i++) {
      const spread = kind === 'shotgun' ? new THREE.Vector3((Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.7) : new THREE.Vector3();
      arrive = this.bolt(from, to.clone().add(spread), color, spec[2], spec[3]);
      this.muzzleFlash(from, color);
      if (spec[1]) await this.wait(spec[1]);
    }
    await arrive;
    this.impact(to, hit, target, color);
  }
  // Where a bolt lands: on a body a white flash and sparks in its colour; on the ground or cover a glowing scorch
  // that cools to black, a spray of embers and a puff of smoke.
  impact(to, hit, target, color) {
    this.sparks(to, hit ? (target && target.side === 'pale' ? '#9ff6ff' : '#ff9a60') : color, hit ? 36 : 22, hit ? 0.6 : 0.55, hit ? 1.2 : 1.1, hit ? 0.2 : 0.14);
    const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: hit ? '#ffffff' : color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    fl.position.copy(to);
    fl.scale.setScalar(hit ? 0.5 : 0.45);
    this.fxRoot.add(fl);
    const fs = this.time;
    this.fx.push(() => { const k = (this.time - fs) / 0.1; fl.material.opacity = 1 - k; if (k >= 1) { fl.removeFromParent(); fl.material.dispose(); return false; } return true; });
    if (hit) {
      if (target) this.hitFlinch(target);
      if (target && target.side === 'pale') this.puff(to, '#7ff4ff', 0.45, 0.7, 0.4);
      return;
    }
    const ground = to.clone();
    ground.y = 0.1;
    this.puff(ground, '#6f6a62', 0.55, 1.2, 0.5);
    // a ragged black char ring that stays a while, with a small hot core inside it that cools over three seconds
    const char = new THREE.Mesh(new THREE.CircleGeometry(0.34, 18).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: scorchTex(), color: '#000000', transparent: true, opacity: 0, depthWrite: false }));
    char.position.set(to.x, 0.038, to.z);
    char.rotation.y = Math.random() * 6;
    char.userData.noAO = true;
    this.fxRoot.add(char);
    const mark = new THREE.Mesh(new THREE.CircleGeometry(0.13, 14).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex(), color: new THREE.Color(color).multiplyScalar(2.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    mark.position.set(to.x, 0.042, to.z);
    mark.userData.noAO = true;
    this.fxRoot.add(mark);
    const ms = this.time;
    this.scorches = (this.scorches || []).filter((m) => m.parent);
    this.scorches.push(char);
    if (this.scorches.length > 50) { const old = this.scorches.shift(); old.removeFromParent(); old.material.dispose(); }
    this.fx.push(() => {
      const t = this.time - ms, k = Math.min(1, t / 3);
      if (mark.parent) {
        mark.material.color.set(color).multiplyScalar(2.4 * (1 - k) * (1 - k));
        if (k >= 1) { mark.removeFromParent(); mark.material.dispose(); }
      }
      if (!char.parent) return false;
      char.material.opacity = 0.72 * Math.min(1, t / 0.25) * Math.min(1, Math.max(0, (34 - t) / 4));
      if (t > 34) { char.removeFromParent(); char.material.dispose(); return false; }
      return true;
    });
  }
  // An energy bolt: a white-hot core inside a coloured halo, flying at speed (units a second). Resolves on arrival.
  bolt(from, to, color, size = 1, speed = 40) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    dir.normalize();
    _boltGeo ||= { core: new THREE.CapsuleGeometry(0.016, 0.5, 3, 8).rotateX(Math.PI / 2), halo: new THREE.CapsuleGeometry(0.05, 0.62, 3, 10).rotateX(Math.PI / 2) };
    const g = new THREE.Group();
    const core = new THREE.Mesh(_boltGeo.core, new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4e6').multiplyScalar(3), transparent: true, depthWrite: false }));
    const halo = new THREE.Mesh(_boltGeo.halo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.4), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    const head2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.85 }));
    head2.position.z = 0.3;
    head2.scale.setScalar(0.55 * size);
    g.add(core, halo, head2);
    g.scale.set(size, size, Math.min(1, len / 1.2));
    g.position.copy(from);
    g.lookAt(to);
    g.traverse((o) => { o.userData.noAO = true; });
    this.fxRoot.add(g);
    // a short glowing tail that follows the bolt and shrinks into the impact point
    const trail = new THREE.Mesh(new THREE.CylinderGeometry(0.014 * size, 0.004 * size, 1, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    trail.userData.noAO = true;
    trail.visible = false;
    this.fxRoot.add(trail);
    const TAIL = 0.9 * size;
    const dur = Math.max(0.06, len / speed), start = this.time;
    return new Promise((resolve) => {
      this.fx.push(() => {
        const k = (this.time - start) / dur;
        const head = len * Math.min(1, k), tail = Math.max(0, Math.min(TAIL, head) - (k > 1 ? (k - 1) * dur * speed : 0));
        if (tail > 0.02) {
          trail.visible = true;
          trail.scale.z = tail;
          trail.position.copy(from).addScaledVector(dir, head - tail / 2);
          trail.lookAt(to);
        } else trail.visible = false;
        if (k <= 1) g.position.copy(from).addScaledVector(dir, head);
        else if (g.parent) { g.removeFromParent(); core.material.dispose(); halo.material.dispose(); head2.material.dispose(); resolve(); }
        if (k > 1 && tail <= 0.02) { trail.removeFromParent(); trail.geometry.dispose(); trail.material.dispose(); return false; }
        return true;
      });
    });
  }
  tracer(from, to, color, radius) { return this.bolt(from, to, color, radius / 0.011); }
  // A shot that misses on purpose, for the crossfire between turns: past the target's shoulder and into the ground
  // or cover behind it, or off into the distance.
  nearMiss(shooter, target) {
    const r = this.rig(shooter), t = this.rig(target);
    if (!r || !t || !r.root.visible || !t.root.visible) return;
    const from = this.muzzlePos(shooter);
    const aim = this.targetPos(target);
    const dir = aim.clone().sub(from).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar((Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 0.9));
    aim.add(side);
    aim.y = Math.min(aim.y + (Math.random() - 0.5) * 0.4, from.y - 0.25);
    const ray = aim.clone().sub(from);
    // carry on past the target until the bolt meets the ground
    let to, lands = false;
    if (ray.y < -0.02) { const k = (0.05 - from.y) / ray.y; to = from.clone().addScaledVector(ray, Math.min(k, 6)); lands = k <= 6; }
    else to = from.clone().addScaledVector(ray, 2.2);
    const color = shooter.side === 'pale' ? BOLT.pale : BOLT.ember;
    this.muzzleFlash(from, color);
    this.bolt(from, to, color, 1.1, 34).then(() => { if (lands) this.impact(to, false, null, color); });
  }
  // How far (degrees) the barrel points away from a point: 0 when the gun is aimed straight at it.
  gunAngle(u, p) {
    const r = this.rig(u);
    if (!r) return 180;
    r.root.updateMatrixWorld(true);
    const m = this.muzzlePos(u), d = p.clone().sub(m).normalize();
    const e = (r.gun || r.root).matrixWorld.elements;
    const f = r.gun ? new THREE.Vector3(e[0], e[1], e[2]) : new THREE.Vector3(e[8], 0, e[10]);
    if (!r.gun) d.y = 0;
    return Math.acos(THREE.MathUtils.clamp(f.normalize().dot(d.normalize()), -1, 1)) * 57.3;
  }
  // Wait until a unit has finished turning to where it was told to face (at most maxT seconds).
  async aimSettled(u, maxT = 0.6) {
    const r = this.rig(u);
    if (!r || this.instant) return;
    const t0 = this.time;
    while (this.time - t0 < maxT) {
      let d = r.targetYaw - r.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) < 0.05) return;
      await this.wait(0.04);
    }
  }
  // A crossfire burst between turns: the shooter turns and raises the gun, fires n near misses along the barrel,
  // then lowers it again a moment later. Skipped when the shooter is busy (walking, in a clip, dying).
  async volley(shooter, target, n = 1, onFire) {
    const r = this.rig(shooter), t = this.rig(target);
    if (!r || !t || !r.root.visible || !t.root.visible || r.dying || r.moving || r.oneShot || r.volley) return false;
    r.volley = true;
    const raised = r.isChar && r.base !== 'aim' && r.base !== 'crouchAim';
    try {
      this.face(shooter, target.x, target.y, true);
      if (raised) { setBase(r, 'aim', 0.2); r.volleyRaised = true; }
      const aimAt = this.targetPos(target);
      const t0 = this.time;
      while (this.time - t0 < 0.9 && this.gunAngle(shooter, aimAt) > 10) await this.wait(0.05);
      if (this.gunAngle(shooter, aimAt) > 22 || r.moving || r.dying) return false;
      onFire?.();
      for (let i = 0; i < n; i++) {
        if (r.moving || r.dying || !t.root.visible || this.gunAngle(shooter, aimAt) > 24) break;
        this.nearMiss(shooter, target);
        await this.wait(0.11);
      }
      return true;
    } finally {
      r.volley = false;
      if (raised) setTimeout(() => { if (r.volleyRaised && !r.dying && !r.moving) { r.volleyRaised = false; setBase(r, 'idle', 0.35); } }, 1300);
    }
  }
  muzzleFlash(pos, color) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    s.position.copy(pos);
    s.material.rotation = Math.random() * 6;
    s.scale.setScalar(0.45 + Math.random() * 0.2);
    this.fxRoot.add(s);
    // a ring of light that spreads from the emitter
    const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    ring.position.copy(pos);
    this.fxRoot.add(ring);
    this.flash.position.copy(pos);
    this.flash.intensity = 6;
    this.flash.distance = 3.5;
    const start = this.time;
    this.fx.push(() => {
      const k = (this.time - start) / 0.09;
      s.material.opacity = Math.max(0, 1 - k * 1.4);
      ring.scale.setScalar(0.2 + k * 0.7);
      ring.material.opacity = Math.max(0, 0.8 * (1 - k));
      if (k >= 1) { s.removeFromParent(); s.material.dispose(); ring.removeFromParent(); ring.material.dispose(); return false; }
      return true;
    });
  }
  sparks(pos, color, n, life = 0.5, speed = 1, size = 0.12) {
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3), vel = [];
    for (let i = 0; i < n; i++) {
      p[i * 3] = pos.x; p[i * 3 + 1] = pos.y; p[i * 3 + 2] = pos.z;
      vel.push(new THREE.Vector3((Math.random() - 0.5) * 4 * speed, Math.random() * 3 * speed, (Math.random() - 0.5) * 4 * speed));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, map: glowTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.fxRoot.add(pts);
    const start = this.time;
    let prev = this.time;
    this.fx.push(() => {
      const dt = this.time - prev; prev = this.time;
      const k = (this.time - start) / life;
      for (let i = 0; i < n; i++) {
        vel[i].y -= 9 * dt;
        p[i * 3] += vel[i].x * dt; p[i * 3 + 1] = Math.max(0.02, p[i * 3 + 1] + vel[i].y * dt); p[i * 3 + 2] += vel[i].z * dt;
      }
      geo.attributes.position.needsUpdate = true;
      pts.material.opacity = 1 - k;
      if (k >= 1) { pts.removeFromParent(); geo.dispose(); pts.material.dispose(); return false; }
      return true;
    });
  }
  hitFlinch(u) {
    const r = this.rig(u);
    if (!r) return;
    if (r.isChar) { if (!r.dying) playOnce(r, 'hit', { portion: 0.55 }); return; }
    const start = this.time;
    this.fx.push(() => {
      const k = (this.time - start) / 0.3;
      r.body.rotation.x = Math.sin(Math.min(1, k) * Math.PI) * -0.25;
      return k < 1;
    });
  }
  async explode(x, y, radius) {
    if (this.instant) return;
    const pos = new THREE.Vector3(x, 0.4, y);
    // a high, soft light so the blast lights the street without stamping a flat disc on it
    this.flash.color.set('#ffb066');
    this.flash.position.set(x, 2.4, y);
    this.flash.intensity = 140;
    this.flash.distance = 12;
    this.shake = 0.6;
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: new THREE.Color('#ffc870').multiplyScalar(2.2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    core.renderOrder = 3;
    core.userData.noAO = true;
    core.position.set(x, 0.7, y);
    core.scale.setScalar(radius * 2);
    this.fxRoot.add(core);
    const cs = this.time;
    this.fx.push(() => {
      const k = (this.time - cs) / 0.3;
      core.material.opacity = Math.max(0, k < 0.17 ? 1 : 1 - (k - 0.17) / 0.83);
      core.scale.setScalar(1.4 + k * 0.5);
      if (k >= 1) { core.removeFromParent(); core.material.dispose(); return false; }
      return true;
    });
    // fireball: a 16-frame flipbook (white-hot core rolling out to red and smoke), four sprites deep
    const book = fireBook();
    for (let i = 0; i < 4; i++) {
      const tex = book.clone();
      tex.repeat.set(0.25, 0.25);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      const a = Math.random() * Math.PI * 2, d = i ? radius * 0.35 : 0;
      s.position.set(x + Math.cos(a) * d, 0.55 + i * 0.22, y + Math.sin(a) * d);
      s.material.rotation = Math.random() * 6;
      s.visible = false;
      this.fxRoot.add(s);
      const size = (i ? 2.4 : 3.6) * (radius / 1.5), life = 0.85 + Math.random() * 0.25, st = this.time + i * 0.05;
      this.fx.push((dt) => {
        const k = (this.time - st) / life;
        if (k < 0) return true;
        s.visible = true;
        const f = Math.min(15, Math.floor(k * 16));
        tex.offset.set((f % 4) * 0.25, 0.75 - Math.floor(f / 4) * 0.25);
        s.scale.setScalar(size * (0.5 + 0.5 * Math.min(1, k * 4)));
        s.position.y += dt * (0.6 + k * 1.4);
        s.position.y = Math.max(s.position.y, s.scale.x * 0.4);
        const heat = Math.max(0, 1 - k * 1.7);
        s.material.color.setRGB(1 + 1.5 * heat, 1 + 1.15 * heat, 1 + 0.8 * heat);
        s.material.opacity = k > 0.75 ? Math.max(0, 1 - (k - 0.75) / 0.25) : 1;
        if (k >= 1) { s.removeFromParent(); s.material.dispose(); return false; }
        return true;
      });
    }
    // a few additive flames for flicker on top
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex(), color: '#ffb070', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      s.renderOrder = 2;
      s.userData.noAO = true;
      const a = Math.random() * Math.PI * 2, d = Math.random() * radius * 0.4;
      s.position.set(x + Math.cos(a) * d, 0.25 + Math.random() * 0.5, y + Math.sin(a) * d);
      const size = 0.6 + Math.random() * radius * 0.5, life = 0.25 + Math.random() * 0.25, st = this.time;
      const v = new THREE.Vector3(Math.cos(a) * (0.6 + d * 1.5), 2.2 + Math.random() * 3.2, Math.sin(a) * (0.6 + d * 1.5));
      s.material.rotation = Math.random() * 6;
      this.fxRoot.add(s);
      this.fx.push((dt) => {
        const k = (this.time - st) / life;
        s.position.addScaledVector(v, dt * (1 - k * 0.7));
        s.scale.setScalar(size * (0.35 + k * 1.15));
        s.material.opacity = Math.max(0, 1 - Math.pow(k, 1.6));
        s.material.color.setRGB(1, 0.9 - k * 0.55, 0.65 - k * 0.6);
        if (k >= 1) { s.removeFromParent(); s.material.dispose(); return false; }
        return true;
      });
    }
    // smoke column: born inside the fireball, rising 3 to 4 m over about five seconds
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * radius * 0.5;
      this.smoke(new THREE.Vector3(x + Math.cos(a) * d, 0.5 + Math.random() * 0.8, y + Math.sin(a) * d), i % 3 ? '#b8b2a8' : '#8f8880',
        1.1 + Math.random() * 0.9, 5.5 + Math.random() * 1.2, 0.55 + Math.random() * 0.25, new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.15 + Math.random() * 0.2), 0.32 + Math.random() * 0.35);
    }
    // dust thrown out low along the ground
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      this.smoke(new THREE.Vector3(x, 0.25, y).addScaledVector(dir, radius * 0.3), '#9a8f7e', 0.7 + Math.random() * 0.4, 1.4 + Math.random() * 0.6, 0.12, dir.multiplyScalar(2.6 + Math.random()), 0, 2.5);
    }
    this.sparks(pos, '#ffcf7a', 50, 0.95, 1.7);
    this.debris(pos, radius);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#fff1d6', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.position.set(x, 0.06, y);
    this.fxRoot.add(ring);
    const rs = this.time;
    this.fx.push(() => {
      const k = (this.time - rs) / 0.3;
      ring.scale.setScalar(0.3 + k * radius * 1.4);
      ring.material.opacity = Math.max(0, 0.45 * (1 - k));
      if (k >= 1) { ring.removeFromParent(); ring.geometry.dispose(); ring.material.dispose(); return false; }
      return true;
    });
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.8, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: scorchTex(), color: '#000000', transparent: true, opacity: 0.85, depthWrite: false }));
    scorch.position.set(x, 0.035, y);
    scorch.rotation.y = Math.random() * 6;
    this.world.add(scorch);
    await this.wait(0.45);
  }
  // A shaded smoke puff (lighter on top) that fades in, drifts, rises and thins out. drag slows the drift.
  smoke(pos, color, size, life, rise, drift, delay = 0, drag = 0.4) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeLitTex(), color, transparent: true, depthWrite: false, opacity: 0 }));
    s.userData.noAO = true;
    s.renderOrder = 1;
    s.position.copy(pos);
    s.scale.setScalar(size * 0.6);
    s.material.rotation = (Math.random() - 0.5) * 0.4;
    // parented to the mission's world, so smoke never drifts into the next map
    this.world.add(s);
    const born = this.time + delay;
    const v = drift.clone();
    this.smokeLive = (this.smokeLive || 0) + 1;
    s.userData.smokeCount = true;
    this.fx.push((dt) => {
      const t = this.time - born;
      if (t < 0) return true;
      const k = t / life;
      v.multiplyScalar(Math.max(0, 1 - drag * dt));
      s.position.addScaledVector(v, dt);
      s.position.y += rise * dt * (1 - k * 0.5);
      s.scale.setScalar(size * (0.6 + Math.sqrt(k) * 1.9));
      s.position.y = Math.max(s.position.y, s.scale.x * 0.36);
      s.material.opacity = (k < 0.06 ? k / 0.06 : Math.pow(1 - k, 0.8)) * 0.42;
      if (k >= 1) { s.removeFromParent(); s.material.dispose(); this.smokeLive--; return false; }
      return true;
    });
  }
  debris(pos, radius) {
    for (let i = 0; i < 18; i++) {
      const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.03 + Math.random() * 0.05, 0).scale(1.2, 0.7, 1), mat(i % 3 ? '#3b3128' : '#55493c', { rough: 1, flat: true }));
      b.position.copy(pos);
      b.castShadow = true;
      this.fxRoot.add(b);
      const v = new THREE.Vector3((Math.random() - 0.5) * 3 * radius, 3 + Math.random() * 4, (Math.random() - 0.5) * 3 * radius);
      const spin = new THREE.Vector3(Math.random() * 10, Math.random() * 10, 0);
      this.fx.push((dt) => {
        v.y -= 14 * dt;
        b.position.addScaledVector(v, dt);
        b.rotation.x += spin.x * dt;
        b.rotation.y += spin.y * dt;
        if (b.position.y < 0.03) {
          b.position.y = 0.03;
          v.multiplyScalar(0.3);
          v.y = Math.abs(v.y) * 0.3;
          if (v.length() < 0.4) { this.world.attach(b); return false; }
        }
        return true;
      });
    }
  }
  async death(u) {
    const r = this.rig(u);
    if (!r) return;
    r.dying = true;
    if (r.isChar && !this.instant) {
      await playOnce(r, 'death', { hold: true, portion: 0.95 });
      r.corpse = true;
      // leave the body on the ground for a while, then let it sink away
      const start = this.time;
      this.fx.push(() => {
        const k = (this.time - start - 6) / 2;
        if (k < 0) return true;
        r.root.position.y = -k * 0.6;
        if (k >= 1) { this.removeUnit(u); return false; }
        return true;
      });
      return;
    }
    const mats = [];
    r.root.traverse((o) => {
      if (o.isMesh && o.material && o.material.visible !== false) {
        o.material = o.material.clone();
        o.material.transparent = true;
        mats.push(o.material);
      }
    });
    await this.tween(0.8, (k) => {
      r.body.rotation.x = -Math.min(1, k * 1.6) * 0.9;
      r.body.position.y = -k * 0.6;
      for (const m of mats) m.opacity = 1 - k;
    });
    this.removeUnit(u);
  }
  // A grenade, rocket or smoke canister flies in an arc to the target.
  handPos(u) {
    const r = this.rig(u);
    const h = r && (r.grip ? r.grip.hand : r.model && r.model.getObjectByName('mixamorigRightHand'));
    if (!h) return this.muzzlePos(u);
    r.root.updateMatrixWorld(true);
    return h.getWorldPosition(new THREE.Vector3());
  }
  async lob(u, x, y, kind) {
    if (this.instant) return;
    const from = kind === 'rocket' ? this.muzzlePos(u) : this.handPos(u);
    const to = new THREE.Vector3(x, 0.15, y);
    const isRocket = kind === 'rocket';
    const g = new THREE.Mesh(isRocket ? new THREE.CylinderGeometry(0.04, 0.04, 0.35, 8).rotateX(Math.PI / 2) : new THREE.SphereGeometry(0.07, 10, 8),
      new THREE.MeshStandardMaterial({ color: kind === 'smoke' ? '#8a9a8a' : '#3a4030', roughness: 0.5, metalness: 0.4 }));
    g.castShadow = true;
    this.fxRoot.add(g);
    const dist = from.distanceTo(to);
    const peak = isRocket ? 0.4 : Math.min(3.2, 0.8 + dist * 0.28);
    await this.tween(isRocket ? dist / 18 : 0.45 + dist * 0.045, (k) => {
      const p = from.clone().lerp(to, k);
      p.y += Math.sin(k * Math.PI) * peak;
      g.lookAt(p);
      g.position.copy(p);
      if (isRocket && Math.random() < 0.7) this.puff(p, '#bbbbbb', 0.25, 1.2);
    });
    g.removeFromParent();
  }
  puff(pos, color, size, life, rise) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex(), color, transparent: true, depthWrite: false, opacity: 0.6 }));
    s.userData.noAO = true;
    s.renderOrder = 1;
    s.position.copy(pos);
    s.scale.setScalar(size);
    this.fxRoot.add(s);
    const start = this.time, vy = rise ?? (0.3 + Math.random() * 0.5), rot = (Math.random() - 0.5) * 1.5;
    this.fx.push((dt) => {
      const k = (this.time - start) / life;
      s.position.y += vy * dt;
      s.material.rotation += rot * dt;
      s.scale.setScalar(size * (1 + k * 2.2));
      // keep the quad out of the ground, or the ground clips it along a straight line (square dust)
      s.position.y = Math.max(s.position.y, s.scale.x * 0.42);
      s.material.opacity = 0.6 * (1 - k);
      if (k >= 1) { s.removeFromParent(); s.material.dispose(); return false; }
      return true;
    });
    return s;
  }
  healFx(u) {
    const r = this.rig(u);
    if (!r) return;
    const p = r.root.position.clone();
    p.y = 0.8;
    this.sparks(p, '#7dff96', 24);
  }
  setShield(u, on) {
    const r = this.rig(u);
    if (!r) return;
    if (on && !r.bubble) {
      const rad = r.height * 0.55;
      r.bubble = new THREE.Mesh(new THREE.SphereGeometry(rad, 32, 20), new THREE.ShaderMaterial({
        uniforms: { uC: { value: new THREE.Color('#b58cff') }, uR: { value: rad } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: 'varying vec3 vN; varying vec3 vW; varying vec3 vO; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vO = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: `uniform vec3 uC; uniform float uR; varying vec3 vN; varying vec3 vW; varying vec3 vO;
          void main(){ vec3 V = normalize(cameraPosition - vW); float f = 1.0 - abs(dot(normalize(vN), V));
            float a = (0.05 + 0.45 * pow(f, 2.5)) * smoothstep(uR + 0.3, uR + 2.0, distance(cameraPosition, vO));
            gl_FragColor = vec4(uC * a, a);
            #include <colorspace_fragment>
          }`,
      }));
      r.bubble.position.y = r.height * 0.5;
      r.root.add(r.bubble);
    } else if (!on && r.bubble) {
      r.root.remove(r.bubble);
      r.bubble = null;
    }
  }
  beam(from, to, color) {
    const a = this.muzzlePos(from), b = this.targetPos(to);
    const len = a.distanceTo(b);
    const g = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.position.copy(a).add(b).multiplyScalar(0.5);
    g.lookAt(b);
    this.fxRoot.add(g);
    const start = this.time;
    this.fx.push(() => {
      const k = (this.time - start) / 0.6;
      g.material.opacity = 1 - k;
      if (k >= 1) { g.removeFromParent(); g.geometry.dispose(); g.material.dispose(); return false; }
      return true;
    });
  }

  // ------------------------------------------------------------ frame loop
  // Head-and-shoulders portrait of a soldier class in one of the four looks, rendered once and cached as an image URL.
  portrait(cls, kit, k) {
    this.portraits ||= new Map();
    if (this.portraits.has(k)) return this.portraits.get(k);
    const p = new Promise((resolve) => { (this.portraitJobs ||= []).push({ cls, kit, resolve }); });
    this.portraits.set(k, p);
    return p;
  }
  renderPortraits() {
    const job = this.portraitJobs && this.portraitJobs.shift();
    if (!job || !this.chars) { if (job) this.portraitJobs.unshift(job); return; }
    const rig = makeCharacter({ side: 'ember', kind: job.cls, id: 'p_' + job.cls, kit: job.kit }, this.chars);
    if (!rig) { job.resolve(null); return; }
    const sc = new THREE.Scene();
    sc.environment = this.scene.environment;
    sc.background = new THREE.Color('#121a28');
    const key = new THREE.DirectionalLight('#fff0dc', 3.2); key.position.set(1.5, 2.5, 3);
    const rim = new THREE.DirectionalLight('#ff9a50', 2.4); rim.position.set(-2, 1.5, -2.5);
    sc.add(key, rim, new THREE.HemisphereLight('#b8c8d8', '#202020', 0.6), rig.root);
    rig.root.rotation.y = 0.35;
    setBase(rig, 'idle', 0);
    rig.mixer.setTime(0.8);
    rig.root.updateMatrixWorld(true);
    const head = rig.head ? rig.head.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.15, 0);
    const cam = new THREE.PerspectiveCamera(24, 0.8, 0.05, 20);
    cam.position.set(head.x + 0.2, head.y + 0.02, head.z + 1.25);
    cam.lookAt(head.x, head.y - 0.12, head.z);
    const W = 200, H = 250;
    const r = this.renderer, gl = r.getContext();
    const dpr = r.getPixelRatio();
    r.setRenderTarget(null);
    r.setViewport(0, 0, W / dpr, H / dpr);
    r.setScissor(0, 0, W / dpr, H / dpr);
    r.setScissorTest(true);
    r.render(sc, cam);
    const px = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    r.setScissorTest(false);
    const size = r.getSize(new THREE.Vector2());
    r.setViewport(0, 0, size.x, size.y);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const img = c.getContext('2d').createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    c.getContext('2d').putImageData(img, 0, 0);
    job.resolve(c.toDataURL('image/jpeg', 0.88));
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    if (this.portraitJobs && this.portraitJobs.length) this.renderPortraits();
    // timeScale slows the whole game for frame captures (test tools only)
    const raw = Math.min(0.25, (now - this.last) / 1000) * (this.timeScale ?? 1), dt = Math.min(0.05, raw);
    this.last = now;
    this.time += dt;
    // tweens run on the real clock, so a slow frame never stretches a cinematic
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += raw;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(k);
      if (k >= 1) { this.tweens.splice(i, 1); tw.resolve(); }
    }
    this.fx = this.fx.filter((f) => f(dt));
    this.flash.intensity *= Math.pow(0.0005, dt);
    for (const s of this.ships || []) s.tick(dt, this.time);
    // camera
    if (this.follow) { this.goal.tx = this.follow.root.position.x; this.goal.tz = this.follow.root.position.z; }
    if (this.autoOrbit) this.goal.yaw += dt * 0.04;
    const g = this.goal, c = this.cam;
    g.tx = Math.max(-1, Math.min(this.bounds.w, g.tx));
    g.tz = Math.max(-1, Math.min(this.bounds.h, g.tz));
    const k = 1 - Math.exp(-dt * 6);
    c.tx += (g.tx - c.tx) * k;
    c.tz += (g.tz - c.tz) * k;
    c.dist += (g.dist - c.dist) * k;
    c.yaw += (g.yaw - c.yaw) * k;
    const pitch = 0.66 + Math.min(1, Math.max(0, (c.dist - 9) / 24)) * 0.3;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    this.shake *= Math.pow(0.02, dt);
    const sx = (Math.random() - 0.5) * this.shake, sz = (Math.random() - 0.5) * this.shake;
    if (this.cine && this.stationNow && this.stationNow.drift) {
      // the wide hangar shot sways slowly
      const d = this.stationNow.drift, t = this.time;
      this.cine.p.copy(this.stationNow.eye).add(v3.set(Math.sin(t * 0.13) * d, Math.sin(t * 0.09) * d * 0.3, Math.cos(t * 0.11) * d * 0.5));
    }
    if (this.carrier) this.carrier.tick(dt, this.time);
    if (this.skyDome) this.skyDome.position.copy(this.camera.position);
    if (this.cine) {
      const k2 = 1 - Math.exp(-dt * (this.cine.speed || 9));
      this.cineCur ||= { p: this.camera.position.clone(), t: new THREE.Vector3(c.tx, 0.5, c.tz) };
      this.cineCur.p.lerp(this.cine.p, k2);
      this.cineCur.t.lerp(this.cine.t, k2);
      this.camera.position.copy(this.cineCur.p).add(new THREE.Vector3(sx, 0, sz));
      this.camera.lookAt(this.cineCur.t);
    } else {
      this.cineCur = null;
      this.camera.position.set(c.tx + Math.sin(c.yaw) * cp * c.dist + sx, sp * c.dist, c.tz + Math.cos(c.yaw) * cp * c.dist + sz);
      const o = this.cineOut;
      if (o && this.time - o.t0 < o.dur) {
        const k = (this.time - o.t0) / o.dur, e = k * k * k * (k * (k * 6 - 15) + 10);
        const look = v3.set(c.tx + sx, 0.5, c.tz + sz).clone();
        this.camera.position.lerpVectors(o.p, this.camera.position, e).y += Math.sin(Math.PI * e) * 2.2;
        this.camera.lookAt(look.lerpVectors(o.t, look, e));
      } else {
        this.cineOut = null;
        this.camera.lookAt(c.tx + sx, 0.5, c.tz + sz);
      }
    }
    if (this.torch && this.squadCentre) this.torch.position.set(this.squadCentre.x, 2.4, this.squadCentre.y);
    this.fadeTrees();
    // units
    if (this.spin) { const r = this.rigs.get(this.spin); if (r) r.targetYaw += dt * 0.35; }
    for (const r of this.rigs.values()) {
      let d = r.targetYaw - r.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      r.yaw += d * Math.min(1, dt * 10);
      r.root.rotation.y = r.yaw;
      if (r.isChar) tickChar(r, dt);
      else if (!r.dying) tickRig(r, this.time, r.moving, r.phase);
      for (const m of r.glowMats) m.emissiveIntensity = 1.0 + Math.sin(this.time * 3 + r.phase) * 0.25;
    }
    if (this.selected) {
      const p = this.selected.root.position;
      this.selRing.position.set(p.x, 0.03, p.z);
      this.selRing.material.opacity = 0.65 + Math.sin(this.time * 5) * 0.3;
    }
    for (const ring of this.targetRings) {
      if (!ring.visible) continue;
      const s = ring.userData.focus ? 1.15 + Math.sin(this.time * 6) * 0.08 : 0.9;
      ring.scale.setScalar(s);
      ring.material.opacity = ring.userData.focus ? 1 : 0.55;
    }
    if (this.evacGroup) {
      this.evacGroup.userData.pulse.material.opacity = 0.07 + Math.sin(this.time * 2) * 0.03;
      for (const [fx, fz, light, core] of this.evacGroup.userData.flares) {
        light.intensity = 1.6 + Math.random() * 0.7;
        core.scale.setScalar(0.2 + Math.random() * 0.05);
        // a thin trail of flare smoke, not a glowing cloud
        if (Math.random() < 0.07) this.puff(new THREE.Vector3(this.evacGroup.position.x + fx, 0.25, this.evacGroup.position.z + fz), '#7a9a84', 0.28, 2.2, 0.4);
      }
    }
    if (this.cacheGroup && this.cacheGroup.userData.spin) { this.cacheGroup.userData.spin.rotation.y += dt; this.cacheGroup.userData.spin.position.y = 0.25 + Math.sin(this.time * 2) * 0.06; }
    for (const grp of this.smokeGroups?.values() || []) for (const p of grp.children) {
      const L = p.userData.life, k = ((this.time + p.userData.ph * L) % L) / L;
      p.position.y = 0.25 + k * 1.7;
      p.scale.setScalar(p.userData.s0 * (0.7 + k * 0.7));
      p.material.opacity = 0.24 * Math.sin(k * Math.PI);
      p.material.rotation += dt * 0.05;
    }
    if (this.carrier && this.hemiGoal) this.hemi.intensity += (this.hemiGoal - this.hemi.intensity) * Math.min(1, dt * 3);
    if (this.fillLight.intensity > 0 && !this.carrier) {
      const cp = this.camera.position, lt = this.cine ? this.cine.t : v3.set(c.tx, 0, c.tz);
      this.fillLight.target.position.copy(lt);
      const hx = cp.x - lt.x, hz = cp.z - lt.z, hl = Math.hypot(hx, hz) || 1;
      this.fillLight.position.set(lt.x + (hx / hl) * 40, lt.y + 18, lt.z + (hz / hl) * 40);
    }
    if (this.post && this.post.ao) {
      const smoky = (this.smokeLive || 0) > 0;
      this.post.ao.blendIntensity += ((smoky ? 0 : 0.9) - this.post.ao.blendIntensity) * Math.min(1, dt * 5);
      this.post.ao.enabled = this.quality === 'high' && this.post.ao.blendIntensity > 0.03;
    }
    this.updateRoofs(dt);
    for (const o of this.objMeshes.values()) for (const ch of o.children) if (ch.userData.spin) ch.rotation.y += dt * ch.userData.spin;
    // drop to fast rendering if the device cannot keep up (about 22 fps for 4 seconds)
    if (this.quality === 'high' && !this.instant && !this.lockQuality) {
      this.slow = dt > 0.045 ? (this.slow || 0) + dt : Math.max(0, (this.slow || 0) - dt * 0.5);
      if (this.slow > 4) { this.slow = 0; this.setQuality('fast'); if (this.onAutoQuality) this.onAutoQuality('fast'); }
    }
    if (this.quality === 'high') this.post.frame(this.time);
    else this.renderer.render(this.scene, this.camera);
    if (this.onFrame) this.onFrame(dt);
  }

  // Roofs fade out while a soldier (or a seen enemy, or the move preview) is inside, or the camera is close.
  updateRoofs(dt) {
    if (!this.roofs) return;
    const inside = [];
    for (const r of this.rigs.values()) if (r.root.visible && !r.corpse) inside.push(r.root.position);
    if (this.dest.visible) inside.push(this.dest.position);
    const close = this.cam.dist < 11;
    // what the camera is looking at: its target, and anyone standing near it
    const eye = this.camera.position;
    // (a close camera's target counts; the tactical view's ground point does not, or houses near it lose their roofs for nothing)
    const tgt = this.cine ? this.cine.t : null;
    const ref = tgt || new THREE.Vector3(this.cam.tx, 0, this.cam.tz);
    const seen = tgt ? [tgt] : [];
    for (const r of this.rigs.values()) if (r.root.visible && !r.corpse && Math.hypot(r.root.position.x - ref.x, r.root.position.z - ref.z) < 7) seen.push(r.root.position);
    const snap = this.roofSnap;
    this.roofSnap = false;
    for (const R of this.roofs) {
      const b = R.b;
      const occupied = inside.some((p) => p.x > b.x0 - 0.3 && p.x < b.x0 + b.w - 0.7 && p.z > b.y0 - 0.3 && p.z < b.y0 + b.h - 0.7);
      const rc = this.revealCut && this.time < this.revealCut.until ? this.revealCut : null;
      const near = (close && Math.hypot(b.x0 + b.w / 2 - ref.x, b.y0 + b.h / 2 - ref.z) < 6)
        || (rc && Math.hypot(b.x0 + b.w / 2 - 0.5 - rc.x, b.y0 + b.h / 2 - 0.5 - rc.z) < rc.r + Math.max(b.w, b.h) / 2);
      // under the real gable: eaves low at the sides, the ridge along the long axis
      const S = R.shape, alongX = S && S.x1 - S.x0 >= S.z1 - S.z0, half = S && (alongX ? S.z1 - S.z0 : S.x1 - S.x0) / 2;
      const under = (x, y, z) => x > S.x0 - S.oh && x < S.x1 + S.oh && z > S.z0 - S.oh && z < S.z1 + S.oh
        && y < S.h + S.slope * (half - (alongX ? Math.abs(z - (S.z0 + S.z1) / 2) : Math.abs(x - (S.x0 + S.x1) / 2)));
      const hides = S && !occupied && !near && seen.some((q) => {
        for (let k = 0.04; k < 0.97; k += 0.04) if (under(eye.x + (q.x - eye.x) * k, eye.y + (q.y + 0.9 - eye.y) * k, eye.z + (q.z - eye.z) * k)) return true;
        return false;
      });
      // a roof in the way thins to a ghost; it only goes when someone is inside or the camera is close
      const target = occupied || near || hides ? 0 : 1;
      R.fade = snap ? target : R.fade + (target - R.fade) * Math.min(1, dt * 6);
      for (const m of R.mats) { m.opacity = R.fade; m.depthWrite = R.fade > 0.95; }
      R.roof.visible = R.fade > 0.02;
      R.roof.traverse((o) => { if (o.isMesh) o.castShadow = R.fade > 0.5; });
    }
  }
}

// soft round textures for fire, smoke and scorch marks
let _smoke = null, _fire = null, _scorch = null, _star = null;
function starTex() {
  return (_star ||= blobTex((g) => {
    g.translate(64, 64);
    for (let i = 0; i < 6; i++) {
      g.rotate(Math.PI / 3);
      const gr = g.createLinearGradient(0, 0, 60, 0);
      gr.addColorStop(0, 'rgba(255,250,230,1)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, -5); g.lineTo(60 - (i % 2) * 22, 0); g.lineTo(0, 5); g.fill();
    }
    const c = g.createRadialGradient(0, 0, 0, 0, 0, 26);
    c.addColorStop(0, 'rgba(255,255,240,1)'); c.addColorStop(1, 'rgba(255,190,90,0)');
    g.fillStyle = c; g.fillRect(-64, -64, 128, 128);
  }));
}
function blobTex(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function smokeTex() {
  return (_smoke ||= blobTex((g) => {
    const r = makeRng(7);
    for (let i = 0; i < 26; i++) {
      const x = 64 + (r() - 0.5) * 50, y = 64 + (r() - 0.5) * 50, rad = 18 + r() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.16)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    }
    // fade to nothing well inside the square
    g.globalCompositeOperation = 'destination-in';
    const edge = g.createRadialGradient(64, 64, 16, 64, 64, 62);
    edge.addColorStop(0, 'rgba(0,0,0,1)');
    edge.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = edge;
    g.fillRect(0, 0, 128, 128);
  }));
}
let _fireBook = null;
export function fireBook() {
  if (_fireBook) return _fireBook;
  const S = 128, G = 4;
  const c = document.createElement('canvas');
  c.width = c.height = S * G;
  const g = c.getContext('2d');
  const img = g.createImageData(S * G, S * G), d = img.data;
  const r = makeRng(23), perm = new Uint8Array(512), val = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; val[i] = r(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const h = (x, y, z) => val[perm[(perm[(perm[x & 255] + y) & 255] + z) & 255]];
  const sm = (t) => t * t * (3 - 2 * t);
  const n3 = (x, y, z) => {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), u = sm(x - X), v = sm(y - Y), w = sm(z - Z);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(h(X, Y, Z), h(X + 1, Y, Z), u), l(h(X, Y + 1, Z), h(X + 1, Y + 1, Z), u), v),
      l(l(h(X, Y, Z + 1), h(X + 1, Y, Z + 1), u), l(h(X, Y + 1, Z + 1), h(X + 1, Y + 1, Z + 1), u), v), w);
  };
  const fbm = (x, y, z) => n3(x, y, z) * 0.5 + n3(x * 2, y * 2, z * 2) * 0.25 + n3(x * 4, y * 4, z * 4) * 0.15 + n3(x * 8, y * 8, z * 8) * 0.1;
  // heat to colour: white-hot, orange, deep red, then smoke
  const ramp = [[1, [255, 244, 208]], [0.72, [255, 176, 64]], [0.5, [255, 132, 40]], [0.3, [120, 38, 12]], [0.12, [62, 56, 52]], [0, [44, 41, 39]]];
  const col = (t) => {
    for (let i = 0; i < ramp.length - 1; i++) {
      const [t0, c0] = ramp[i], [t1, c1] = ramp[i + 1];
      if (t >= t1) { const k = (t - t1) / (t0 - t1); return [c1[0] + (c0[0] - c1[0]) * k, c1[1] + (c0[1] - c1[1]) * k, c1[2] + (c0[2] - c1[2]) * k]; }
    }
    return ramp[ramp.length - 1][1];
  };
  for (let f = 0; f < 16; f++) {
    const t = f / 15, R = 0.4 + 0.5 * Math.sqrt(t), ox = (f % G) * S, oy = Math.floor(f / G) * S;
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const u = ((px + 0.5) / S) * 2 - 1, v = ((py + 0.5) / S) * 2 - 1;
      const dist = Math.hypot(u, v);
      const n = fbm(u * 2.4 + 7, v * 2.4 + t * 1.6, t * 2.2);
      const edge = R * (0.72 + 0.56 * n);
      const a = Math.min(1, Math.max(0, (edge - dist) / (edge * 0.22)));
      if (a <= 0) continue;
      const heat = Math.min(1, Math.max(0, (1 - dist / edge) * (1.3 - t * 1.25) + (n - 0.5) * 0.7));
      const [cr, cg, cb] = col(heat);
      const i = ((oy + py) * S * G + ox + px) * 4;
      d[i] = cr; d[i + 1] = cg; d[i + 2] = cb;
      d[i + 3] = 255 * a * (t < 0.65 ? 1 : 1 - ((t - 0.65) / 0.35) * 0.7);
    }
  }
  g.putImageData(img, 0, 0);
  _fireBook = new THREE.CanvasTexture(c);
  _fireBook.colorSpace = THREE.SRGBColorSpace;
  return _fireBook;
}
let _smokeLit = null;
// The frontier sky: a ringed gas giant and a small moon far beyond the map, lit by the same sun. Low and cinematic
// cameras see them over the rooftops.
let _gasTex = null, _ringTex = null, _moonTex = null;
function frontierSky(cx, cz, size, look) {
  const canvas = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const rng = makeRng(77);
  _gasTex ||= canvas(1024, 512, (g, w, h) => {
    const cols = ['#c9a77a', '#e3cfa6', '#a8744a', '#d9b98a', '#8f5f3e', '#efe0c0', '#b98a5a'];
    for (let y = 0; y < h; y += 2) {
      const band = cols[Math.floor((Math.sin(y * 0.045) * 0.5 + 0.5 + Math.sin(y * 0.013) * 0.4) * cols.length + cols.length) % cols.length];
      g.fillStyle = band; g.fillRect(0, y, w, 2);
    }
    for (let i = 0; i < 900; i++) {
      const y = rng() * h, x = rng() * w, l = 40 + rng() * 220;
      g.fillStyle = `rgba(${rng() < 0.5 ? '255,240,215' : '90,55,35'},${0.05 + rng() * 0.08})`;
      g.fillRect(x, y, l, 1 + rng() * 3);
    }
    const sx = w * 0.62, sy = h * 0.62;
    const gr = g.createRadialGradient(sx, sy, 0, sx, sy, 46);
    gr.addColorStop(0, 'rgba(170,70,40,.9)'); gr.addColorStop(0.6, 'rgba(200,110,70,.5)'); gr.addColorStop(1, 'rgba(200,110,70,0)');
    g.save(); g.scale(1.8, 1); g.fillStyle = gr; g.fillRect((sx - 60) / 1.8, sy - 60, 120, 120); g.restore();
  });
  _ringTex ||= canvas(512, 512, (g, w) => {
    for (let r = 0; r < w / 2; r++) {
      const k = r / (w / 2);
      if (k < 0.66) continue;
      const a = (0.25 + 0.5 * Math.abs(Math.sin(r * 0.31)) * Math.abs(Math.sin(r * 0.07))) * Math.min(1, (k - 0.66) * 12) * Math.min(1, (1 - k) * 14);
      g.strokeStyle = `rgba(226,206,170,${a})`; g.lineWidth = 1.2;
      g.beginPath(); g.arc(w / 2, w / 2, r, 0, 7); g.stroke();
    }
  });
  _moonTex ||= canvas(512, 256, (g, w, h) => {
    g.fillStyle = '#8d8a86'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { const x = rng() * w, y = rng() * h, r = 2 + rng() * 14; g.fillStyle = `rgba(${rng() < 0.5 ? '60,58,56' : '170,166,160'},${0.15 + rng() * 0.25})`; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  });
  const grp = new THREE.Group();
  const far = 150 + size;
  // about 13 degrees wide, centred 4.5 degrees up: it rises out of the horizon haze, disc and ring under the top of a close camera
  const GR = 19, R0 = GR * 1.23, R1 = GR * 1.92;
  const giant = new THREE.Mesh(new THREE.SphereGeometry(GR, 64, 32));
  giant.position.set(cx + 18, 11, cz - far * 0.95);
  giant.rotation.set(0.2, 0, 0.32);
  const ring = new THREE.Mesh(new THREE.RingGeometry(R0, R1, 128, 1));
  giant.add(ring);
  ring.rotation.set(-Math.PI / 2 + 0.18, 0, 0);
  const ringN = new THREE.Vector3(0, 0, 1).applyQuaternion(giant.quaternion.clone().multiply(ring.quaternion));
  const U = { tMap: { value: _gasTex }, uSun: { value: look.sun }, uSky: { value: look.sky }, uHaze: { value: look.haze }, uBright: { value: look.bright },
    uC: { value: giant.position.clone() }, uR: { value: GR }, uN: { value: ringN }, uR0: { value: R0 }, uR1: { value: R1 } };
  const VS = 'varying vec2 vUv; varying vec3 vN; varying vec3 vW; void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
  const HEAD = 'uniform sampler2D tMap; uniform vec3 uSun; uniform vec3 uSky; uniform float uHaze; uniform float uBright; uniform vec3 uC; uniform float uR; uniform vec3 uN; uniform float uR0; uniform float uR1; varying vec2 vUv; varying vec3 vN; varying vec3 vW;';
  giant.material = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS, fog: false,
    fragmentShader: `${HEAD}
      void main(){
        vec3 n = normalize(vN), V = normalize(cameraPosition - vW);
        vec3 alb = texture2D(tMap, vUv).rgb;
        float lit = smoothstep(-0.06, 0.35, dot(n, uSun));
        // the ring's shadow across the disc
        float dn = dot(uSun, uN), t = abs(dn) > 0.001 ? dot(uC - vW, uN) / dn : -1.0;
        float k = (length(vW + uSun * t - uC) - uR0) / (uR1 - uR0);
        float ringSh = t > 0.0 && k > 0.0 && k < 1.0 ? (0.25 + 0.5 * abs(sin(k * 55.0)) * abs(sin(k * 12.0))) * 0.8 : 0.0;
        vec3 c = alb * (lit * (1.0 - ringSh) * 1.2 + 0.02) * uBright;
        float f = 1.0 - max(dot(n, V), 0.0);
        c += uSky * pow(f, 3.0) * 0.3 * (0.25 + lit);
        c = mix(c, uSky, uHaze + 0.5 * smoothstep(8.0, -4.0, vW.y));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
  ring.material = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS, fog: false, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    fragmentShader: `${HEAD} uniform sampler2D tRing;
      void main(){
        float a = texture2D(tRing, vUv).a;
        // the planet's shadow on the ring
        vec3 o = vW - uC; float b = dot(o, uSun), h = b * b - dot(o, o) + uR * uR;
        float sh = h > 0.0 && -b - sqrt(h) > 0.0 ? 0.1 : 1.0;
        vec3 c = vec3(0.89, 0.81, 0.67) * (0.15 + 0.85 * sh) * uBright;
        c = mix(c, uSky, uHaze + 0.5 * smoothstep(8.0, -4.0, vW.y));
        gl_FragColor = vec4(c, a * 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
  ring.material.uniforms = { ...U, tRing: { value: _ringTex } };
  const moon = new THREE.Mesh(new THREE.SphereGeometry(4.5, 32, 16), new THREE.MeshStandardMaterial({ map: _moonTex, roughness: 1, fog: false, envMapIntensity: 0.3 }));
  moon.position.set(cx - far * 0.4, 21, cz - far * 0.88);
  grp.add(giant, moon);
  grp.traverse((o) => { o.userData.noAO = true; o.castShadow = false; o.receiveShadow = false; });
  return grp;
}
function smokeLitTex() {
  // overlapping soft blobs, each lit from above: bright crowns, darker undersides
  return (_smokeLit ||= blobTex((g) => {
    const r = makeRng(19);
    for (let i = 0; i < 30; i++) {
      const x = 64 + (r() - 0.5) * 56, y = 64 + (r() - 0.5) * 52, rad = 14 + r() * 26;
      const lit = Math.round(150 + (1 - y / 128) * 105);
      const gr = g.createRadialGradient(x, y - rad * 0.3, 0, x, y, rad);
      gr.addColorStop(0, `rgba(${lit},${lit},${lit},0.6)`);
      gr.addColorStop(0.6, `rgba(${lit - 40},${lit - 40},${lit - 40},0.36)`);
      gr.addColorStop(1, `rgba(${lit - 60},${lit - 60},${lit - 60},0)`);
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    }
    g.globalCompositeOperation = 'destination-in';
    const edge = g.createRadialGradient(64, 64, 18, 64, 64, 62);
    edge.addColorStop(0, 'rgba(0,0,0,1)');
    edge.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = edge;
    g.fillRect(0, 0, 128, 128);
  }));
}
function fireTex() {
  // turbulent flame ball: overlapping hot cores with a ragged, smoky edge
  return (_fire ||= blobTex((g) => {
    const r = makeRng(11);
    for (let i = 0; i < 40; i++) {
      const a = r() * 6.28, d = r() * 30, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, rad = 10 + r() * 26;
      const hot = d < 14;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, hot ? 'rgba(255,246,214,0.55)' : 'rgba(255,170,70,0.38)');
      gr.addColorStop(0.5, hot ? 'rgba(255,180,80,0.35)' : 'rgba(210,80,20,0.22)');
      gr.addColorStop(1, 'rgba(120,30,0,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    }
    g.globalCompositeOperation = 'destination-in';
    const edge = g.createRadialGradient(64, 64, 24, 64, 64, 63);
    edge.addColorStop(0, 'rgba(0,0,0,1)'); edge.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = edge;
    g.fillRect(0, 0, 128, 128);
  }));
}
function scorchTex() {
  return (_scorch ||= blobTex((g) => {
    const r = makeRng(3);
    g.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 40; i++) {
      const a = r() * 6.28, d = r() * 40, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d, rad = 10 + r() * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.35)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    }
    // fade everything to nothing well inside the square
    g.globalCompositeOperation = 'destination-in';
    const edge = g.createRadialGradient(64, 64, 20, 64, 64, 62);
    edge.addColorStop(0, 'rgba(0,0,0,1)'); edge.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = edge;
    g.fillRect(0, 0, 128, 128);
  }));
}

