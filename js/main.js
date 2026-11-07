// Far Ember: boot, screens flow and saving.
import { View } from './view.js';
import { UI } from './ui.js';
import { Battle } from './battle.js';
import { sfx } from './audio.js';
import { newCampaign, applyResult, buyUpgrade, recruit, choosePerk, upgradeSave } from './campaign.js';
import { emblem } from './brand.js';
import { LINE_Z } from './carrier.js';
import { flightOut, flightIn } from './flights.js';
import { defaultKit } from './armour.js';

const KEY = 'ember-squad-save-v1';
const PREFS = 'ember-squad-prefs';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked: the cloud copy still works */ } },
};

// Cloud copy of the save in the viewer's private area, when the page runs inside Claude.
const cloud = {
  ref: null,
  writing: false,
  queued: null,
  async init() {
    try {
      if (!window.claude || !window.claude.use) return;
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      if (!db || !user) return;
      const id = await user.id();
      if (id) this.ref = db.doc(`data/users/${id}/save`);
    } catch { this.ref = null; }
  },
  async read() {
    if (!this.ref) return null;
    try {
      const snap = await Promise.race([this.ref.get(), new Promise((r) => setTimeout(() => r(null), 6000))]);
      if (!snap || !snap.exists) return null;
      return JSON.parse(snap.data().json);
    } catch { return null; }
  },
  async write(json) {
    if (!this.ref) return;
    if (this.writing) { this.queued = json; return; }
    this.writing = true;
    try { await this.ref.set({ json, savedAt: Date.now() }); } catch (e) { if (e && e.code === 'invalid_argument') this.ref = null; }
    this.writing = false;
    if (this.queued) { const q = this.queued; this.queued = null; this.write(q); }
  },
};

class App {
  constructor() {
    this.sfx = sfx;
    this.view = new View(document.getElementById('gl'));
    this.ui = new UI(this);
    this.camp = null;
    this.battle = null;
    const p = this.prefs();
    sfx.setMuted(!!p.muted);
    this.quality = p.quality || 'high';
    this.view.setQuality?.(this.quality);
    this.view.onTap = (x, y) => {
      sfx.init();
      if (this.battle) this.battle.tap(this.view.pick(x, y));
    };
    this.view.onFrame = () => this.ui.frame();
    this.view.onAutoQuality = (q) => { this.quality = q; this.ui.toast('Switched to fast graphics to keep things smooth. Change it in the menu.'); };
    // the first tap unlocks audio: a short orchestral sting, then the menu theme
    document.addEventListener('pointerdown', () => { sfx.init(); if (!this.battle) { sfx.music('sting', { fade: 0.2, loop: false }); setTimeout(() => { if (!this.battle) sfx.music('base', { fade: 3 }); }, 9000); } }, { once: true });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.key(e));
  }

  prefs(patch) {
    let p = {};
    try { p = JSON.parse(store.get(PREFS) || '{}'); } catch { p = {}; }
    if (patch) { p = { ...p, ...patch }; store.set(PREFS, JSON.stringify(p)); }
    return p;
  }
  setQuality(q) {
    this.quality = q;
    this.view.setQuality?.(q);
    this.prefs({ quality: q });
  }

  async boot(hotData) {
    const bar = document.getElementById('loadbar'), lbl = document.getElementById('loadlbl');
    const progress = (f, t) => { bar.style.width = `${Math.round(f * 100)}%`; if (t) lbl.textContent = t; };
    progress(0.05, 'Loading');
    await this.view.prepareCarrier((f) => progress(0.05 + f * 0.85, 'Boarding the Lantern'));
    await cloud.init();
    let local = null;
    try { local = JSON.parse((hotData && hotData.save) || store.get(KEY) || 'null'); } catch { local = null; }
    const remote = await cloud.read();
    this.camp = upgradeSave(remote && (!local || (remote.savedAt || 0) > (local.savedAt || 0)) ? remote : local);
    progress(1, 'Ready');
    const ld = document.getElementById('loading');
    ld.style.opacity = '0';
    setTimeout(() => ld.remove(), 600);
    this.toTitle();
    this.portraits ||= {};
  }
  // Portraits are per class and kit: a repaint gets a fresh one.
  kitOf(who) { const cls = who.cls || who.kind; return { ...defaultKit(cls, who.look ?? who.slot ?? 0), ...(who.kit || {}) }; }
  portraitKey(who) { const k = this.kitOf(who); return `${who.cls || who.kind}:${[k.armour, k.trim, k.suit, k.visor, k.helmet, k.pattern].join('')}`; }
  // Rendered on first ask; until then the caller gets null and the image is filled in when it is ready
  // (ui.portraitsReady swaps every <img data-pk>).
  portraitFor(who) {
    this.portraits ||= {};
    const k = this.portraitKey(who);
    if (this.portraits[k]) return this.portraits[k];
    this.portraitAsked ||= new Set();
    if (!this.portraitAsked.has(k)) {
      this.portraitAsked.add(k);
      this.view.portrait(who.cls || who.kind, this.kitOf(who), k).then((url) => { if (url) { this.portraits[k] = url; this.ui.portraitsReady?.(k, url); } });
    }
    return null;
  }

  save() {
    if (!this.camp) return;
    this.camp.savedAt = Date.now();
    const json = JSON.stringify(this.camp);
    store.set(KEY, json);
    cloud.write(json);
  }
  saveBattle(snap) {
    if (!this.camp) return;
    this.camp.battle = snap;
    this.save();
  }

  // The carrier's hangar behind the menus: the dropship on its pad, the squad lined up at the ramp.
  diorama() {
    if (this.dioramaOn) return;
    this.dioramaOn = true;
    this.view.endCine();
    this.view.autoOrbit = false;
    this.view.setCarrier();
    this.dio = { units: [] };
    // crew at work: two at the armoury rack, one at the holo table
    for (const c of [
      { id: 'crew0', kind: 'gunner', x: 9.6, y: 0.5, at: [12, 0.3], kit: { armour: 7, trim: 0, suit: 0, visor: 1, helmet: 2, pattern: 0 } },
      { id: 'crew1', kind: 'medic', x: 9.2, y: 8.7, at: [10.7, 7.4], kit: { armour: 1, trim: 2, suit: 1, visor: 0, helmet: 0, pattern: 1 } },
      { id: 'crew2', kind: 'marksman', x: 6.8, y: -7.8, at: [8.2, -9.4], kit: { armour: 2, trim: 1, suit: 1, visor: 4, helmet: 1, pattern: 0 } },
    ]) { const u = { id: c.id, side: 'ember', kind: c.kind, x: c.x, y: c.y, kit: c.kit }; this.view.addUnit(u); this.view.face(u, c.at[0], c.at[1]); }
    // spare sets on stands by the lockers
    this.view.armourStands([
      { kind: 'scout', x: 10.75, z: 6.15, yaw: -Math.PI / 2, kit: { armour: 0, trim: 0, suit: 0, visor: 0, helmet: 0, pattern: 0 } },
      { kind: 'gunner', x: 10.75, z: 7.15, yaw: -Math.PI / 2, kit: { armour: 2, trim: 1, suit: 1, visor: 4, helmet: 1, pattern: 1 } },
      { kind: 'marksman', x: 10.75, z: 8.15, yaw: -Math.PI / 2, kit: { armour: 3, trim: 6, suit: 2, visor: 2, helmet: 2, pattern: 0 } },
    ]);
    if (this.camp) { this.view.carrier.setFallen(this.camp.fallen); this.view.carrier.setOffers(this.camp.offers); }
  }
  // Stand soldiers in a line behind the dropship's ramp, facing the squad camera.
  // Each entry is a soldier ({cls, look}) or a class name.
  lineup(list) {
    if (!this.dio) return;
    for (const id of this.dio.units) this.view.removeUnit({ id });
    const ids = [];
    // up to four in a line; five or six stand in two staggered rows so the group stays clear of the menus
    const n = list.length, per = n <= 4 ? n : Math.ceil(n / 2);
    list.forEach((s, i) => {
      const kind = typeof s === 'string' ? s : s.cls;
      const row = Math.floor(i / per), col = i % per, cnt = row ? n - per : per;
      const u = { id: 'l' + i + kind, side: 'ember', kind, x: 0.35 + (col - (cnt - 1) / 2) * 1.05 + row * 0.5, y: LINE_Z - row * 0.95 + (col % 2) * 0.12, slot: typeof s === 'string' ? i : (s.look ?? i) % 4, kit: typeof s === 'string' ? null : s.kit };
      this.view.addUnit(u);
      this.view.face(u, 4.6 + (u.x - 0.35) * 0.3, LINE_Z + 8);
      ids.push(u.id);
    });
    this.dio.units = ids;
  }
  // Which hangar station the camera shows, and who stands in the line.
  scene(station, list, spin = false) {
    this.diorama();
    if (list) this.lineup(list);
    this.view.spin = spin && this.dio.units[0];
    if (this.camp && this.view.carrier) { this.view.carrier.setFallen(this.camp.fallen); this.view.carrier.setOffers(this.camp.offers); }
    this.view.station(station);
  }

  toTitle() {
    this.battle = null;
    sfx.music('base');
    this.ui.detach();
    this.ui.closeModal();
    this.diorama();
    this.lineup(['scout', 'gunner', 'marksman', 'medic']);
    this.view.station('title', true);
    const c = this.camp;
    const label = c && !c.over ? `${c.battle ? 'Mid-mission' : 'At base'} · ${c.missions} missions` : null;
    this.ui.title(label);
  }
  startCampaign(opts) {
    this.camp = newCampaign(opts);
    this.save();
    this.ui.base(this.camp);
  }
  continueGame() {
    const c = this.camp;
    if (!c) return;
    if (c.over) return this.ui.ending(c);
    if (c.battle && c.current) return this.startBattle(c.current, c.battle);
    this.ui.base(c);
  }
  async launch(m, squad) {
    const mission = { ...m, squad };
    this.camp.current = mission;
    this.camp.battle = null;
    this.ui.closeModal();
    this.ui.screen.hidden = true;
    // the mission loads while the squad boards and the dropship launches
    const prog = { f: 0, cb: null };
    const ready = this.view.prepare(mission.biome, mission.time, (f) => { prog.f = f; if (prog.cb) prog.cb(f); });
    if (!this.skipFlights) await flightOut(this);
    await this.startBattle(mission, null, { ready, prog });
    this.saveBattle(this.battle.snapshot());
  }
  async startBattle(mission, snapshot, pre) {
    this.ui.closeModal();
    const done = loadingScreen(mission.name);
    if (pre) { pre.prog.cb = done.progress; done.progress(pre.prog.f); await pre.ready; }
    else await this.view.prepare(mission.biome, mission.time, done.progress);
    this.view.autoOrbit = false;
    this.dioramaOn = false;
    this.battle = new Battle({ view: this.view, ui: this.ui, sfx, camp: this.camp, mission, snapshot });
    this.ui.attach(this.battle);
    const intro = !snapshot && !this.skipFlights && !this.view.instant;
    this.battle.start(intro);
    // quiet tension until the first contact (battle theme after); the final assault has its own track
    sfx.music(mission.type === 'final' ? 'final' : this.battle.flags.seenAny ? 'battle' : mission.biome === 'spire' ? 'spire' : 'tension');
    done.close();
    if (intro) await this.battle.intro();
  }
  missionOver(res) {
    const m = this.camp.current;
    const d = applyResult(this.camp, m, res);
    this.save();
    sfx.music(null, { fade: 1.2 });
    if (!res.retreated) (res.win ? sfx.win() : sfx.lose());
    setTimeout(() => sfx.music('carrier', { fade: 3 }), 2600);
    setTimeout(async () => {
      this.battle = null;
      this.ui.detach();
      this.diorama();
      // the survivors fly home and walk off the ramp before the debrief
      const back = d.soldiers.filter((s) => s.status !== 'dead').map((s) => this.camp.roster.find((r) => r.id === s.rid)).filter(Boolean);
      this.lineup(back);
      this.ui.screen.hidden = true;
      if (!this.skipFlights && back.length) await flightIn(this);
      this.ui.debrief(this.camp, m, d);
    }, res.retreated ? 200 : 1800);
  }
  buy(id) { const ok = buyUpgrade(this.camp, id); if (ok) this.save(); return ok; }
  recruit(cls) { const s = recruit(this.camp, cls); if (s) this.save(); return s; }
  pickPerk(s, id) { if (choosePerk(s, id)) this.save(); }

  key(e) {
    const b = this.battle;
    if (e.target && e.target.tagName === 'INPUT') return;
    if (e.key === 'q') this.view.rotate(-1);
    if (e.key === 'e') this.view.rotate(1);
    const pan = { w: [0, 40], s: [0, -40], a: [40, 0], d: [-40, 0] }[e.key];
    if (pan) this.view.pan(pan[0], pan[1]);
    if (!b || b.busy || b.phase !== 'player') return;
    if (e.key === 'Escape') b.cancelMode();
    else if (e.key === 'Tab') { e.preventDefault(); const n = b.nextSoldier(); if (n) b.select(n); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (b.pendingMove) b.confirmMove(); else b.fire(); }
    else if (e.key === '1') b.doAction('shoot');
    else if (e.key === '2') b.doAction('overwatch');
    else if (e.key === 'r') b.doAction('reload');
    else if (e.key === 'h') b.doAction('hunker');
    else if (e.key === 'g') b.doAction('grenade');
    else if (e.key === 'ArrowLeft') b.cycleTarget(-1);
    else if (e.key === 'ArrowRight') b.cycleTarget(1);
  }
}

function loadingScreen(title) {
  const el = document.createElement('div');
  el.className = 'loading';
  el.innerHTML = `<div class="in">${emblem(64)}<div class="lbl" style="font-size:15px;color:var(--ember-hi)">${title.replace(/[<>&]/g, '')}</div><div class="bar2"><b></b></div><div class="lbl">Dropship away</div></div>`;
  document.body.appendChild(el);
  const bar = el.querySelector('b');
  return {
    progress: (f) => { bar.style.width = `${Math.round(f * 100)}%`; },
    close: () => { el.style.opacity = '0'; setTimeout(() => el.remove(), 500); },
  };
}

const app = new App();
window.__app = app;
const hot = window.claude && window.claude.hot;
if (hot && hot.snapshot) hot.snapshot(() => ({ save: app.camp ? JSON.stringify(app.camp) : null }));
const start = (data) => app.boot(data || {});
if (hot && hot.ready) hot.ready(start);
else start((hot && hot.data) || {});
