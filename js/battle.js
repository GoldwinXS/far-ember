// Ember Squad: tactical rules. Units, actions, reaction fire, enemy AI and turn flow.
import { dropIn } from './flights.js';
import { CLASSES, WEAPONS, ENEMIES, POD_TABLE, DIFFICULTY, RANKS, HP_RANKS, AP_MAX, ARC, makeRng } from './data.js';
import { generateMap, reach, pathTo, OBJ, DIR4 } from './map.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const has = (u, perk) => !!u.perks && u.perks.includes(perk);

export const GRENADE = { range: 9, radius: 1.5, dmg: 3 };
export const ROCKET = { range: 13, radius: 2.5, dmg: 5 };
export const SMOKE = { range: 9, radius: 1.6 };

export function soldierStats(s, camp) {
  const cls = CLASSES[s.cls];
  const diff = DIFFICULTY[camp.difficulty];
  const up = camp.upgrades || {};
  const rank = s.rank || 0;
  const hp = cls.hp + HP_RANKS.filter((r) => rank >= r).length + (s.perks.includes('tough') ? 3 : 0) + (up.armour1 ? 2 : 0) + (up.armour2 ? 2 : 0) + diff.hp;
  const aim = cls.aim + rank * 3 + (up.scopes ? 5 : 0) + diff.aim;
  const move = cls.move + (s.perks.includes('quickfeet') ? 2 : 0);
  const grenades = cls.grenades + (s.perks.includes('extrabang') ? 1 : 0) + (up.pockets ? 1 : 0);
  const medkits = s.cls === 'medic' ? 2 + (s.perks.includes('extrakit') ? 1 : 0) + (up.medkits ? 1 : 0) : 0;
  const dmgBonus = (up.weapons1 ? 1 : 0) + (up.weapons2 ? 1 : 0);
  return { hp, aim, move, grenades, medkits, dmgBonus, weapon: cls.weapon };
}

export class Battle {
  constructor({ view, ui, sfx, camp, mission, snapshot }) {
    this.view = view;
    this.ui = ui;
    this.sfx = sfx || {};
    this.camp = camp;
    this.mission = mission;
    this.diff = DIFFICULTY[camp.difficulty];
    const gen = generateMap(mission.biome, mission.seed, { type: mission.type });
    this.map = gen.map;
    this.gen = gen;
    this.units = [];
    this.pods = [];
    this.smoke = [];
    this.turn = 1;
    this.phase = 'player';
    this.busy = false;
    this.sel = null;
    this.mode = 'move';
    this.over = false;
    this.flags = { lifelineUsed: false, seenAny: false };
    this.cache = gen.cache ? { x: gen.cache[0], y: gen.cache[1], carrier: null, secured: false } : null;
    this.evac = gen.evac;
    this.vis = new Uint8Array(this.map.w * this.map.h);
    this.nextId = 1;
    if (snapshot) this.restore(snapshot);
    else this.setup();
  }

  // ------------------------------------------------------------ setup
  setup() {
    const camp = this.camp;
    const rng = makeRng(this.mission.seed * 31 + 7);
    this.mission.squad.forEach((rid, i) => {
      const s = camp.roster.find((r) => r.id === rid);
      const [x, y] = this.gen.spawnTiles[i];
      // the soldier's look picks the helmet colour and camo shade (the same as their portrait)
      this.units.push({ ...this.makeSoldier(s, x, y), slot: (s.look ?? i) % 4, kit: s.kit, callsign: s.callsign || '' });
    });
    const act = this.mission.act;
    const table = POD_TABLE[clamp(act, 0, POD_TABLE.length - 1)];
    const pick = () => {
      let t = rng() * table.reduce((a, [, w]) => a + w, 0);
      for (const [type, w] of table) { if ((t -= w) <= 0) return type; }
      return table[0][0];
    };
    let podCount = this.mission.type === 'final' ? 3 : 1 + this.mission.diff + (this.diff.extraPod ? 1 : 0);
    const far = rng.shuffle([...this.gen.far]);
    const centres = [];
    for (const [x, y] of far) {
      if (centres.length >= podCount) break;
      if (centres.some(([cx, cy]) => Math.hypot(cx - x, cy - y) < 6)) continue;
      if (this.map.objAt(x, y)) continue;
      centres.push([x, y]);
    }
    if (this.mission.type === 'final') {
      const sp = this.map.objects.find((o) => o.type === 'spire');
      const bx = sp.tiles[0][0], by = sp.tiles[0][1] + 3;
      const spot = this.freeNear(bx, by, 3);
      const boss = this.makeEnemy('overseer', spot[0], spot[1], 0);
      boss.cool.spawn = 2;
      this.pods.push({ id: 0, active: false, wp: null });
      for (let i = 0; i < 2; i++) {
        const t = this.freeNear(spot[0], spot[1], 3);
        if (t) this.makeEnemy(i ? 'warden' : 'brute', t[0], t[1], 0);
      }
    }
    centres.forEach(([cx, cy], i) => {
      const id = this.pods.length;
      this.pods.push({ id, active: false, wp: null });
      const size = act === 0 && rng() < 0.5 ? 2 : rng() < 0.6 ? 3 : 2;
      let brutes = 0;
      for (let k = 0; k < size; k++) {
        let type = pick();
        if (type === 'brute' && brutes++) type = 'husk';
        const t = this.freeNear(cx, cy, 2);
        if (t) this.makeEnemy(type, t[0], t[1], id);
      }
    });
  }
  freeNear(x, y, r) {
    const out = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const tx = x + dx, ty = y + dy;
      if (this.map.inside(tx, ty) && this.gen.reachable[this.map.idx(tx, ty)] && this.standable(tx, ty)) out.push([tx, ty, Math.hypot(dx, dy) + Math.random() * 0.5]);
    }
    out.sort((a, b) => a[2] - b[2]);
    return out[0] || null;
  }
  makeSoldier(s, x, y) {
    const st = soldierStats(s, this.camp);
    const w = WEAPONS[st.weapon];
    const u = {
      id: 's' + s.id, rid: s.id, side: 'ember', kind: s.cls, name: s.name, x, y,
      hp: st.hp, maxHp: st.hp, aim: st.aim, move: st.move, def: 0, armour: 0, shield: 0,
      weapon: st.weapon, clip: w.clip, ammo: w.clip, dmgBonus: st.dmgBonus,
      grenades: st.grenades, rockets: s.cls === 'gunner' ? 1 : 0, medkits: st.medkits, smokes: s.cls === 'medic' ? 1 : 0,
      perks: [...s.perks], ap: AP_MAX, shots: 0, ow: 0, owArc: null, hunker: false, moved: false, steady: false, refund: false, untouch: false,
      cool: { rush: 0, rapid: 0 }, kills: 0, owner: s.owner || 0, sight: 13, skin: s.skin, rank: s.rank || 0,
      alive: true, onMap: true, status: 'ok',
      // this mission's numbers for the service record
      st: { shots: 0, hits: 0, crits: 0, heals: 0, hurt: 0, best: 0 },
    };
    return u;
  }
  makeEnemy(type, x, y, pod) {
    const e = ENEMIES[type];
    const act = this.mission.act;
    const hp = e.hp + this.diff.enemyHp + (type === 'overseer' ? 0 : Math.max(0, act - 1));
    const dmgUp = type === 'overseer' ? 0 : Math.floor(act / 2);
    const u = {
      id: 'e' + this.nextId++, side: 'pale', kind: type, name: e.name, x, y,
      hp, maxHp: hp, aim: e.aim + this.diff.enemyAim + act * 2, move: e.move, def: e.def, armour: e.armour, shield: 0,
      dmg: [e.dmg[0] + dmgUp, e.dmg[1] + dmgUp], weapon: 'pale', fly: !!e.fly, pod, active: false,
      ap: 2, ow: 0, owArc: null, hunker: false, cool: { shield: 0, spawn: 0 }, grenades: type === 'husk' && act >= 1 ? 1 : 0,
      sight: 12, alive: true, onMap: true, perks: [],
    };
    this.units.push(u);
    return u;
  }

  // A fresh mission opens with the dropship putting the squad down; the turn starts when it has gone.
  async intro() {
    const sq = this.soldiers().filter((s) => s.onMap);
    this.busy = true;
    this.ui.cine?.(true);
    this.view.clearAll();
    this.view.setSelected(null);
    // objective beacons stay hidden until the squad is down
    const marks = [this.view.evacGroup, this.view.cacheGroup].filter(Boolean);
    for (const o of marks) o.visible = false;
    for (const s of sq) this.view.setVisible(s, false);
    await dropIn(this.view, this.sfx, sq, (u) => this.view.setVisible(u, true));
    for (const s of sq) this.view.setVisible(s, true);
    for (const o of marks) o.visible = true;
    this.view.endCine();
    const first = this.sel || sq[0];
    if (first) this.view.focus(first.x, first.y - 1.5, { instant: true });
    this.ui.cine?.(false);
    this.busy = false;
    if (first) this.select(first);
    this.ui.banner('Your turn', `Turn ${this.turn}`);
    this.ui.refresh();
  }
  start(quiet) {
    this.view.setMission(this.map, this.mission.time);
    for (const u of this.units) if (u.alive && u.onMap) this.view.addUnit(u);
    this.view.setEvac(this.evac);
    if (this.cache && !this.cache.secured) this.view.setCache(this.cache.carrier ? null : this.cache, this.cache.carrier ? this.unit(this.cache.carrier) : null);
    this.view.setSmoke(this.smoke);
    for (const u of this.units) if (u.shield) this.view.setShield(u, true);
    for (const u of this.units) if (u.alive && u.onMap) this.view.settle?.(u, this.map.coverDirs(u.x, u.y));
    this.computeVis();
    this.syncArcs();
    const first = this.soldiers().find((s) => this.canControl(s)) || this.soldiers()[0];
    if (first) this.view.focus(first.x, first.y - 1.5, { instant: true });
    this.select(first);
    if (!quiet) this.ui.banner('Your turn', `Turn ${this.turn}`);
    this.ui.refresh();
  }

  // ------------------------------------------------------------ queries
  unit(id) { return this.units.find((u) => u.id === id); }
  soldiers() { return this.units.filter((u) => u.side === 'ember' && u.alive && u.onMap); }
  enemies() { return this.units.filter((u) => u.side === 'pale' && u.alive && u.onMap); }
  unitAt(x, y) { return this.units.find((u) => u.alive && u.onMap && u.x === x && u.y === y); }
  standable(x, y) { return this.map.inside(x, y) && !this.map.objAt(x, y) && !this.unitAt(x, y); }
  passFor(u) {
    return (x, y) => {
      const o = this.map.objAt(x, y);
      if (o && !(u.fly && OBJ[o.type].cover === 1)) return false;
      const other = this.unitAt(x, y);
      return !other || other === u;
    };
  }
  reachOf(u, mult = 2) { return reach(this.map, u.x, u.y, u.move * mult, this.passFor(u)); }
  // A soldier covers this many tiles for each action spent moving.
  stepOf(u) { return Math.ceil(u.move * 0.6); }
  apFor(u, cost) { return Math.max(1, Math.ceil((cost - 0.01) / this.stepOf(u))); }
  // Actions the next shot costs: by weapon and by shots already fired this turn.
  shotCost(u, rapid) {
    if (rapid && has(u, 'rapid')) return 2;
    const ap = WEAPONS[u.weapon].ap || [1];
    return ap[Math.min(u.shots || 0, ap.length - 1)];
  }
  // Is a unit inside a watcher's overwatch arc (with half a tile of grace at the edges)?
  inArc(w, t) {
    const a = w.owArc;
    if (!a) return true;
    const dx = t.x - w.x, dy = t.y - w.y, d = Math.hypot(dx, dy);
    if (d > a.r + 0.5) return false;
    let da = Math.atan2(dx, dy) - a.a;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    return Math.abs(da) <= ARC.half + Math.atan2(0.5, Math.max(1, d));
  }
  // Overwatch aim falls off with the arc's reach: a short arc keeps most of the soldier's aim.
  arcPenalty(r) { return 0.08 + 0.32 * clamp((r - ARC.min) / (ARC.max - ARC.min), 0, 1); }
  watchShots(u) { return Math.max(1, Math.min(u.ammo, u.ap + (has(u, 'guardian') ? 1 : 0))); }
  // The arcs on the board: every soldier's, and the enemies' the squad can see.
  syncArcs() {
    this.view.setArcs?.(this.units.filter((u) => u.alive && u.onMap && u.ow > 0 && u.owArc && (u.side === 'ember' || u.seen))
      .map((u) => ({ id: u.id, x: u.x, y: u.y, a: u.owArc.a, r: u.owArc.r, half: ARC.half, side: u.side, shots: u.ow })));
  }
  canSee(a, b, range) { return this.map.canSee(a.x, a.y, b.x, b.y, range ?? a.sight); }
  seenBySquad(e) { return this.soldiers().some((s) => this.canSee(s, e)); }
  canControl(u) { return u && u.side === 'ember' && u.alive && u.onMap; }
  inSmoke(x, y) { return this.smoke.find((s) => Math.hypot(s.x - x, s.y - y) <= s.r); }

  targetsFor(u) {
    if (!u || u.side !== 'ember') return [];
    const squadsight = has(u, 'longshot');
    return this.enemies().filter((e) => this.canSee(u, e) || (squadsight && this.seenBySquad(e) && this.map.canSee(u.x, u.y, e.x, e.y, 40)));
  }

  // Hit and crit chance with a breakdown the UI can show.
  odds(shooter, target, opt = {}) {
    const fx = opt.fromX ?? shooter.x, fy = opt.fromY ?? shooter.y;
    const d = Math.hypot(target.x - fx, target.y - fy);
    const w = WEAPONS[shooter.weapon];
    const mods = [['Aim', shooter.aim]];
    const r = Math.round(w.range(d));
    if (r) mods.push([r > 0 ? 'Close range' : 'Long range', r]);
    const cover = target.fly ? 0 : this.map.coverFrom(target.x, target.y, Math.round(fx), Math.round(fy));
    if (cover === 1) mods.push(['Half cover', -20]);
    if (cover === 2) mods.push(['Full cover', -40]);
    if (target.hunker) mods.push(['Hunkered', -30]);
    if (target.def) mods.push(['Defence', -target.def]);
    const sm = this.inSmoke(target.x, target.y);
    if (sm) mods.push(['Smoke', -sm.def]);
    if (has(shooter, 'pointblank') && d <= 4) mods.push(['Point Blank', 15]);
    if (has(shooter, 'steadyhands') && !shooter.moved) mods.push(['Steady Hands', 10]);
    if (has(shooter, 'finisher') && target.hp <= target.maxHp / 2) mods.push(['Finisher', 25]);
    if (shooter.steady) mods.push(['Steady aim', 20]);
    if (shooter.side === 'ember' && target.marked === this.turn) mods.push(['Marked', 15]);
    if (opt.burst) mods.push(['Burst', -10]);
    let hit = mods.reduce((a, [, v]) => a + v, 0);
    if (opt.reaction) {
      const frac = shooter.side === 'ember' && shooter.owArc ? this.arcPenalty(shooter.owArc.r) : 0.3;
      const pen = has(shooter, 'sharpwatch') ? 0 : Math.round(hit * frac);
      if (pen) mods.push(['Overwatch', -pen]);
      hit -= pen;
      if (has(target, 'slippery')) { mods.push(['Slippery', -30]); hit -= 30; }
    }
    hit = clamp(Math.round(hit), 0, 100);
    const flanked = !target.fly && cover === 0;
    let crit = (w.crit || 0) + (flanked ? 40 : 0) + (has(shooter, 'deadeye') ? 15 : 0) + (shooter.steady ? 15 : 0);
    crit = hit ? clamp(crit, 0, 100) : 0;
    const base = shooter.dmg || w.dmg;
    const bonus = shooter.dmgBonus || 0;
    return { hit, crit, mods, cover, flanked, dmg: [base[0] + bonus, base[1] + bonus], dist: d };
  }

  // ------------------------------------------------------------ visibility
  computeVis() {
    const m = this.map, sq = this.soldiers();
    if (sq.length) this.view.squadCentre = { x: sq.reduce((a, s) => a + s.x, 0) / sq.length, y: sq.reduce((a, s) => a + s.y, 0) / sq.length };
    this.vis.fill(0);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      for (const s of sq) {
        if (Math.hypot(s.x - x, s.y - y) > s.sight) continue;
        if (m.canSee(s.x, s.y, x, y, s.sight)) { this.vis[m.idx(x, y)] = 1; break; }
      }
    }
    this.view.setFog(this.vis);
    for (const e of this.enemies()) {
      e.seen = sq.some((s) => this.canSee(s, e));
      this.view.setVisible(e, e.seen);
    }
    this.syncArcs();
  }
  updateEnemyVis() {
    const sq = this.soldiers();
    for (const e of this.enemies()) {
      e.seen = sq.some((s) => this.canSee(s, e));
      this.view.setVisible(e, e.seen);
    }
    this.syncArcs();
  }

  // ------------------------------------------------------------ selection and modes
  select(u) {
    if (u && !this.canControl(u)) return;
    this.sel = u || null;
    this.mode = 'move';
    this.pendingMove = null;
    this.aoe = null;
    this.target = null;
    this.view.clearAll();
    if (u) {
      this.view.setSelected(u, CLASSES[u.kind].color);
      const [fx, fy] = this.lookAhead(u);
      this.view.focus(fx, fy);
      this.showMoveRange();
    } else this.view.setSelected(null);
    this.ui.refresh();
  }
  // A point a little ahead of a soldier, toward the nearest known enemy or the objective, so the soldier sits
  // just below the middle of the screen, clear of the action bar, with room to see what is ahead.
  lookAhead(u) {
    let goal = null, best = Infinity;
    for (const e of this.enemies()) if (e.seen) { const d = dist(u, e); if (d < best) { best = d; goal = e; } }
    if (!goal && this.cache && !this.cache.secured) goal = this.cache.carrier === u.id && this.evac ? { x: this.evac[0], y: this.evac[1] } : this.cache.carrier ? null : this.cache;
    if (!goal) goal = { x: this.map.w / 2, y: 2 };
    const d = Math.max(0.001, dist(u, goal));
    const k = Math.min(1, 1.6 / d);
    return [u.x + (goal.x - u.x) * k, u.y + (goal.y - u.y) * k];
  }
  showMoveRange() {
    const u = this.sel;
    this.view.clearRange();
    if (!u || u.ap <= 0 || this.busy) return;
    const r = reach(this.map, u.x, u.y, this.stepOf(u) * u.ap, this.passFor(u));
    this.moveReach = r;
    const bands = Array.from({ length: u.ap }, () => []);
    for (let y = 0; y < this.map.h; y++) for (let x = 0; x < this.map.w; x++) {
      const c = r.cost[this.map.idx(x, y)];
      if (!c || c === Infinity || !this.standable(x, y)) continue;
      bands[Math.min(u.ap, this.apFor(u, c)) - 1].push([x, y]);
    }
    this.view.showRange(bands);
  }
  nextSoldier() {
    const list = this.soldiers().filter((s) => this.canControl(s) && s.ap > 0);
    if (!list.length) return null;
    const i = list.indexOf(this.sel);
    return list[(i + 1) % list.length];
  }

  // Called by the UI for taps on the board.
  tap(pick) {
    if (this.busy || this.phase !== 'player' || this.over) return;
    let u = pick.unitId ? this.unit(pick.unitId) : null;
    if (!u && pick.tile) u = this.unitAt(pick.tile[0], pick.tile[1]);
    if (u && u.side === 'pale' && !u.seen) u = null;
    if (this.mode === 'aoe' && pick.tile && !(u && u.side === 'ember' && this.aoeKind === 'heal')) {
      this.setAoe(pick.tile[0], pick.tile[1]);
      return;
    }
    if (this.mode === 'heal') {
      if (u && u.side === 'ember' && this.healTargets().includes(u)) { this.target = u; this.view.showTargets([u]); this.ui.refresh(); }
      return;
    }
    if (this.mode === 'watch') {
      const tl = pick.tile || (u ? [u.x, u.y] : null);
      if (tl) this.setWatch(tl[0], tl[1]);
      return;
    }
    if (u) {
      if (u.side === 'ember') { if (this.canControl(u)) { this.sfx.click?.(); this.select(u); } return; }
      if (this.mode === 'shoot' && this.targets.includes(u)) { this.setTarget(u); return; }
      if (this.sel && this.sel.ap >= this.shotCost(this.sel) && this.sel.ammo > 0 && this.targetsFor(this.sel).includes(u)) { this.enterShoot(u); return; }
      this.ui.info(u);
      return;
    }
    if (!pick.tile || !this.sel || this.mode !== 'move') return;
    const [x, y] = pick.tile;
    if (!this.map.inside(x, y) || !this.moveReach) return;
    const c = this.moveReach.cost[this.map.idx(x, y)];
    if (!c || c === Infinity || !this.standable(x, y) || this.apFor(this.sel, c) > this.sel.ap) {
      this.pendingMove = null;
      this.view.clearPath();
      this.ui.refresh();
      return;
    }
    if (this.pendingMove && this.pendingMove[0] === x && this.pendingMove[1] === y) { this.confirmMove(); return; }
    this.pendingMove = [x, y];
    const path = pathTo(this.map, this.moveReach, x, y);
    this.view.showPath(path, this.apFor(this.sel, c) >= this.sel.ap, this.map.coverDirs(x, y));
    this.sfx.click?.();
    this.ui.refresh();
  }

  confirmMove() {
    const u = this.sel, [x, y] = this.pendingMove;
    const c = this.moveReach.cost[this.map.idx(x, y)];
    const path = pathTo(this.map, this.moveReach, x, y);
    this.pendingMove = null;
    if (Math.random() < 0.25) this.ui.bark?.(u, 'move');
    this.run(() => this.moveUnit(u, path, this.apFor(u, c)));
  }

  enterShoot(target) {
    const u = this.sel;
    this.targets = this.targetsFor(u);
    if (!this.targets.length) return;
    this.mode = 'shoot';
    this.view.clearRange();
    this.view.clearPath();
    this.pendingMove = null;
    this.setTarget(target && this.targets.includes(target) ? target : this.bestTarget(u, this.targets));
  }
  bestTarget(u, list) {
    return [...list].sort((a, b) => this.odds(u, b).hit - this.odds(u, a).hit)[0];
  }
  setTarget(t) {
    this.target = t;
    this.view.showTargets(this.targets, t, this.sel);
    this.view.face(this.sel, t.x, t.y);
    this.view.focusPair(this.sel, t);
    this.view.aim?.(this.sel, true);
    this.ui.refresh();
  }
  cycleTarget(dir) {
    if (this.mode !== 'shoot' || !this.targets.length) return;
    const i = this.targets.indexOf(this.target);
    this.setTarget(this.targets[(i + dir + this.targets.length) % this.targets.length]);
  }
  cancelMode() {
    if (this.sel) this.view.aim?.(this.sel, false);
    this.view.showArcPreview?.(null);
    this.select(this.sel);
  }

  // Overwatch: aim an arc, then every action left becomes a shot at an enemy that moves or fires inside it.
  enterWatch() {
    const u = this.sel;
    this.mode = 'watch';
    this.watchTap = null;
    this.view.clearRange();
    this.view.clearPath();
    this.pendingMove = null;
    let goal = null, best = Infinity;
    for (const e of this.enemies()) if (e.seen) { const d = dist(u, e); if (d < best) { best = d; goal = e; } }
    const [gx, gy] = goal ? [goal.x, goal.y] : this.lookAhead(u);
    this.watch = { a: Math.atan2(gx - u.x, gy - u.y), r: goal ? clamp(Math.round(best) + 1, ARC.min, ARC.max) : 8 };
    this.showWatch();
  }
  setWatch(x, y) {
    const u = this.sel;
    if (x === u.x && y === u.y) return;
    if (this.watchTap && this.watchTap[0] === x && this.watchTap[1] === y) { this.confirmWatch(); return; }
    this.watchTap = [x, y];
    this.watch = { a: Math.atan2(x - u.x, y - u.y), r: clamp(Math.round(Math.hypot(x - u.x, y - u.y)), ARC.min, ARC.max) };
    this.sfx.click?.();
    this.showWatch();
  }
  showWatch() {
    const u = this.sel, w = this.watch;
    this.view.face(u, u.x + Math.sin(w.a) * 4, u.y + Math.cos(w.a) * 4, true);
    this.view.showArcPreview?.({ x: u.x, y: u.y, a: w.a, r: w.r, half: ARC.half, side: 'ember' });
    this.ui.refresh();
  }
  confirmWatch() {
    const u = this.sel, w = this.watch;
    if (!u || !w) return;
    this.run(async () => {
      this.view.showArcPreview?.(null);
      u.ow = this.watchShots(u);
      u.owArc = { a: w.a, r: w.r };
      u.owShot = [];
      u.ap = 0;
      this.syncArcs();
      this.ui.pop(u, `Overwatch ${u.ow}`, 'info');
      this.ui.bark?.(u, 'watch');
      await this.view.pose?.(u, 'overwatch');
    });
  }

  enterAoe(kind) {
    const u = this.sel;
    this.mode = 'aoe';
    this.aoeKind = kind;
    this.aoe = null;
    this.view.clearRange();
    this.view.clearPath();
    const spec = this.aoeSpec(u, kind);
    this.view.showRangeRing(u.x, u.y, spec.range);
    this.ui.refresh();
  }
  aoeSpec(u, kind) {
    const big = has(u, 'bigboom') ? 1 : 0;
    if (kind === 'rocket') return { ...ROCKET, radius: ROCKET.radius + big, dmg: ROCKET.dmg + (u.dmgBonus || 0) };
    if (kind === 'smoke') return { ...SMOKE };
    return { ...GRENADE, radius: GRENADE.radius + big };
  }
  tilesIn(x, y, r) {
    const out = [];
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (Math.hypot(dx, dy) <= r + 0.01 && this.map.inside(x + dx, y + dy)) out.push([x + dx, y + dy]);
    }
    return out;
  }
  setAoe(x, y) {
    const u = this.sel, spec = this.aoeSpec(u, this.aoeKind);
    if (!this.map.inside(x, y) || Math.hypot(x - u.x, y - u.y) > spec.range) return;
    if (this.aoe && this.aoe[0] === x && this.aoe[1] === y) { this.confirmAoe(); return; }
    this.aoe = [x, y];
    this.view.showAoe(x, y, spec.radius, this.tilesIn(x, y, spec.radius), this.aoeKind === 'smoke' ? 'smoke' : 'boom');
    this.view.face(u, x, y);
    this.ui.refresh();
  }
  aoePreview() {
    if (!this.aoe) return null;
    const spec = this.aoeSpec(this.sel, this.aoeKind);
    const [x, y] = this.aoe;
    const inR = (t) => Math.hypot(t.x - x, t.y - y) <= spec.radius + 0.01;
    return {
      enemies: this.enemies().filter((e) => e.seen && inR(e)).length,
      allies: this.soldiers().filter(inR).length,
      cover: this.map.objects.filter((o) => !o.gone && OBJ[o.type].hp && o.tiles.some(([tx, ty]) => Math.hypot(tx - x, ty - y) <= spec.radius + 0.01)).length,
    };
  }
  confirmAoe() {
    const u = this.sel, kind = this.aoeKind, [x, y] = this.aoe;
    this.run(async () => {
      this.view.clearAll();
      u.ap = Math.max(0, u.ap - (kind === 'rocket' ? 2 : 1));
      if (kind === 'smoke') u.smokes--; else if (kind === 'rocket') u.rockets--; else u.grenades--;
      this.view.face(u, x, y);
      await this.view.pose?.(u, 'throw', kind);
      this.view.focus(x, y + 2, { dist: 11 });
      this.sfx.throw?.();
      if (kind !== 'smoke') this.ui.bark?.(u, 'grenade');
      await this.view.lob?.(u, x, y, kind);
      if (kind === 'smoke') {
        const def = has(u, 'thicksmoke') ? 40 : 20;
        this.smoke.push({ x, y, r: SMOKE.radius, turns: 2, def });
        this.view.setSmoke(this.smoke);
        this.sfx.smoke?.();
      } else {
        const spec = this.aoeSpec(u, kind);
        await this.blast(x, y, spec.radius, spec.dmg, u);
      }
    });
  }

  healTargets() {
    const u = this.sel;
    if (!u || !u.medkits) return [];
    const r = has(u, 'reach') ? 6 : 1.5;
    return this.soldiers().filter((s) => s.hp < s.maxHp && dist(u, s) <= r && (s === u || this.canSee(u, s, r)));
  }
  enterHeal() {
    this.mode = 'heal';
    this.view.clearRange();
    this.view.clearPath();
    const list = this.healTargets();
    this.target = list.includes(this.sel) ? this.sel : list[0] || null;
    this.view.showTargets(list, this.target);
    this.ui.refresh();
  }
  confirmHeal() {
    const u = this.sel, t = this.target;
    if (!t) return;
    this.run(async () => {
      this.view.clearAll();
      u.ap -= 1;
      u.medkits--;
      if (t !== u) this.view.face(u, t.x, t.y);
      await this.view.pose?.(u, 'heal');
      const amt = Math.min(t.maxHp - t.hp, 4 + (has(u, 'surgeon') ? 2 : 0));
      t.hp += amt;
      this.view.healFx(t);
      this.sfx.heal?.();
      this.ui.pop(t, `+${amt}`, 'heal');
      if (u.st) u.st.heals += amt;
      if (t !== u) this.ui.bark?.(u, 'heal');
      await this.view.wait(0.4);
    });
  }

  // ------------------------------------------------------------ actions list for the HUD
  actions() {
    const u = this.sel;
    if (!u || this.phase !== 'player') return [];
    const out = [];
    const can = u.ap > 0 && !this.busy;
    const targets = can ? this.targetsFor(u) : [];
    const A = (id, label, ok, note, extra) => out.push({ id, label, ok: !!ok, note, ...extra });
    const w = WEAPONS[u.weapon], sc = this.shotCost(u);
    A('shoot', (w.rolls || 1) > 1 ? 'Burst' : 'Shoot', can && u.ap >= sc && u.ammo > 0 && targets.length,
      !u.ammo ? 'Out of ammo' : u.ap < sc ? `Needs ${sc} actions` : targets.length ? `${targets.length} in sight. ${w.note}` : 'No targets', { key: '1', cost: sc });
    A('overwatch', 'Overwatch', can && u.ammo > 0, 'Aim an arc. One shot for each action left.', { key: '2', cost: u.ap });
    if (u.ammo < u.clip) A('reload', 'Reload', can, `${u.ammo}/${u.clip} shots`, { key: 'r', cost: 1 });
    A('hunker', 'Hunker', can, '+30 defence until your next turn. Uses every action left.', { key: 'h', cost: u.ap });
    if (u.grenades > 0) A('grenade', 'Grenade', can, `${u.grenades} left. Breaks cover.`, { key: 'g', count: u.grenades, cost: 1 });
    if (u.rockets > 0) A('rocket', 'Rocket', can && u.ap >= 2, u.ap < 2 ? 'Needs 2 actions' : 'Big blast. Breaks cover.', { count: u.rockets, cost: 2 });
    if (u.kind === 'scout') A('rush', 'Rush', can && !u.cool.rush, u.cool.rush ? `Ready in ${u.cool.rush} turns` : 'Gain an extra action this turn', { cost: 0 });
    if (u.kind === 'marksman') A('steady', 'Steady', can && !u.steady, u.steady ? 'Already steady' : 'Next shot +20 aim, +15 crit', { cost: 1 });
    if (has(u, 'rapid')) A('rapid', 'Rapid Burst', can && u.ap >= 2 && u.ammo > 0 && targets.length && !u.cool.rapid, u.cool.rapid ? `Ready in ${u.cool.rapid} turns` : 'A burst for 2 actions', { cost: 2 });
    if (u.medkits > 0) A('medkit', 'Medkit', can && this.healTargets().length, this.healTargets().length ? `${u.medkits} left` : 'Nobody hurt in reach', { count: u.medkits, cost: 1 });
    if (u.smokes > 0) A('smoke', 'Smoke', can, 'Cloud gives +20 defence', { count: u.smokes, cost: 1 });
    if (this.evac && Math.abs(u.x - this.evac[0]) <= 1 && Math.abs(u.y - this.evac[1]) <= 1) A('evac', 'Evacuate', !this.busy, this.cache && this.cache.carrier === u.id ? 'Leave with the cache' : 'Leave the map');
    return out;
  }
  doAction(id) {
    const u = this.sel;
    if (!u || this.busy) return;
    this.sfx.click?.();
    switch (id) {
      case 'shoot': return this.enterShoot();
      case 'rapid': this.rapidPending = true; return this.enterShoot();
      case 'grenade': case 'rocket': case 'smoke': return this.enterAoe(id);
      case 'medkit': return this.enterHeal();
      case 'overwatch': return this.enterWatch();
      case 'hunker':
        return this.run(async () => { u.hunker = true; u.ap = 0; this.ui.pop(u, 'Hunkered', 'info'); await this.view.pose?.(u, 'hunker'); });
      case 'reload':
        return this.run(async () => { u.ammo = u.clip; u.ap -= 1; this.sfx.reload?.(); if (Math.random() < 0.5) this.ui.bark?.(u, 'reload'); await this.view.pose?.(u, 'reload'); });
      case 'rush':
        return this.run(async () => { u.ap += 1; u.cool.rush = 3; this.ui.pop(u, '+1 action', 'info'); });
      case 'steady':
        return this.run(async () => { u.steady = true; u.ap -= 1; this.ui.pop(u, 'Steady', 'info'); });
      case 'evac':
        return this.run(() => this.evacuate(u));
    }
  }
  fire() {
    if (this.mode === 'heal') return this.confirmHeal();
    if (this.mode === 'aoe') return this.aoe && this.confirmAoe();
    if (this.mode === 'watch') return this.confirmWatch();
    if (this.mode !== 'shoot' || !this.target) return;
    const u = this.sel, t = this.target, rapid = !!this.rapidPending;
    const cost = this.shotCost(u, rapid);
    if (u.ap < cost) return;
    this.rapidPending = false;
    const rolls = WEAPONS[u.weapon].rolls || 1;
    this.run(async () => {
      this.view.clearAll();
      u.ap -= cost;
      u.shots = (u.shots || 0) + 1;
      if (rapid) u.cool.rapid = 3;
      await this.shoot(u, t, { rolls, burst: rolls > 1 });
      this.view.aim?.(u, false);
    });
  }

  // Wrap an action: lock input, run it, then tidy up and check for the end of the turn.
  async run(fn) {
    if (this.busy) return;
    this.busy = true;
    this.ui.refresh();
    try { await fn(); } catch (e) { console.error(e); }
    this.busy = false;
    this.syncArcs();
    if (this.checkEnd()) return;
    const u = this.sel;
    if (u && u.alive && u.onMap && u.ap > 0) this.select(u);
    else {
      const next = this.nextSoldier();
      if (next) this.select(next);
      else this.endTurn(true);
    }
    this.ui.refresh();
  }

  // ------------------------------------------------------------ movement
  async moveUnit(u, path, cost) {
    u.ap -= cost;
    u.moved = true;
    this.view.clearAll();
    const revealed = new Set();
    await this.view.walk(u, path, async (i) => {
      [u.x, u.y] = path[i];
      if (u.side === 'ember') {
        if (this.cache && !this.cache.carrier && !this.cache.secured && u.x === this.cache.x && u.y === this.cache.y) {
          this.cache.carrier = u.id;
          this.view.setCache(null, u);
          this.ui.pop(u, 'Got the cache', 'info');
          this.sfx.pickup?.();
          this.ui.toast('Cache picked up. Bring it to the green zone.');
        }
        for (const e of this.enemies()) {
          if (!e.active && !revealed.has(e.pod) && this.canSee(u, e)) revealed.add(e.pod);
        }
        this.updateEnemyVis();
      } else {
        u.seen = this.soldiers().some((s) => this.canSee(s, u));
        this.view.setVisible(u, u.seen);
      }
      const r = await this.reactions(u);
      if (r === 'hit' && u.side === 'pale' && i < path.length - 1) this.ui.pop(u, 'Stopped', 'info');
      return r === 'ok' || (r === 'hit' && u.side === 'ember');
    }, u.side === 'ember' || u.seen);
    if (u.alive) {
      this.view.place(u);
      this.view.settle?.(u, this.map.coverDirs(u.x, u.y));
    }
    this.computeVis();
    if (revealed.size) await this.scramble([...revealed]);
  }

  // Overwatch shots at a unit that moved or acted inside a watcher's arc. Each watcher shoots a given unit once a
  // turn and spends one shot doing it. Returns 'dead', 'hit' (alive but hurt) or 'ok'.
  async reactions(mover) {
    const watchers = this.units.filter((w) => w.alive && w.onMap && w.side !== mover.side && w.ow > 0);
    let hurt = false;
    for (const w of watchers) {
      if (!mover.alive) return 'dead';
      if (w.side === 'ember' && w.ammo <= 0) continue;
      if ((w.owShot ||= []).includes(mover.id)) continue;
      if (!this.canSee(w, mover) || !this.inArc(w, mover)) continue;
      if (w.side === 'pale') { w.seen = true; this.view.setVisible(w, true); }
      w.ow -= 1;
      w.owShot.push(mover.id);
      this.ui.pop(w, 'Overwatch shot', 'info');
      const before = mover.hp + (mover.shield || 0);
      await this.shoot(w, mover, { reaction: true });
      if (mover.alive && mover.hp + (mover.shield || 0) < before) hurt = true;
      this.syncArcs();
    }
    return !mover.alive ? 'dead' : hurt ? 'hit' : 'ok';
  }

  // Pods that were just spotted get a free move to cover. No shooting.
  async scramble(podIds) {
    const pods = podIds.map((id) => this.pods[id]).filter((p) => p && !p.active);
    if (!pods.length) return;
    this.sfx.alert?.();
    for (const p of pods) {
      p.active = true;
      const members = this.enemies().filter((e) => e.pod === p.id);
      // the named group shows for its reveal even when it saw the squad from the fog (the shot was an empty street);
      // computeVis at the end hides again any the squad cannot see
      for (const e of members) { e.active = true; e.seen = true; this.view.setVisible(e, true); }
      if (!this.flags.seenAny) { this.flags.seenAny = true; }
      const lead = members[0];
      if (lead) {
        // aim at the middle of the group; a low camera only if it sees all of them
        const mid = { x: members.reduce((s, m) => s + m.x, 0) / members.length, y: members.reduce((s, m) => s + m.y, 0) / members.length };
        const near = this.soldiers().sort((a, b) => dist(a, lead) - dist(b, lead))[0];
        const before = this.view.cine;
        if (near) this.view.lowCam(near, mid, members);
        // no clear low shot: cut straight to the group from above, pulled back far enough to hold all of them
        const spread = Math.max(...members.map((m) => dist(m, mid)));
        if (this.view.cine === before) {
          let d = Math.max(12, Math.min(22, 2 + spread * 3.6));
          const yaw = (this.view.goal.yaw = this.view.clearYaw(mid, members, d));
          // houses round the named group lose their roofs for the reveal, so nothing named sits under one
          this.view.revealCut = { x: mid.x, z: mid.y, r: 2.5 + spread, until: this.view.time + 2.6 };
          this.view.focus(mid.x, mid.y, { instant: true, dist: d });
        }
        this.ui.banner('Enemies spotted', members.map((m) => m.name).join(', '));
        if (near) this.ui.bark?.(near, 'spotted');
        if (this.mission.type !== 'final') this.sfx.music?.('battle');
        await this.view.wait(0.9);
      }
      for (const e of members) {
        if (!e.alive) continue;
        const best = this.bestTile(e, false);
        if (best && (best.x !== e.x || best.y !== e.y)) {
          const r = this.reachOf(e, 1);
          const path = pathTo(this.map, r, best.x, best.y);
          if (path) {
            // the camera drifts with the group toward where it is running, so it stays in the middle of the frame
            if (!this.view.cine) {
              const pts = members.filter((m) => m.alive).map((m) => (m === e ? best : m));
              this.view.focus(pts.reduce((t, q) => t + q.x, 0) / pts.length, pts.reduce((t, q) => t + q.y, 0) / pts.length);
            }
            await this.moveEnemyPath(e, path, false, false);
          }
        }
        this.view.face(e, ...this.nearestSoldierXY(e));
      }
      if (lead) { await this.view.wait(0.35); this.view.endCine?.(); }
    }
    this.computeVis();
  }
  nearestSoldierXY(e) {
    let best = null, bd = Infinity;
    for (const s of this.soldiers()) { const d = dist(e, s); if (d < bd) { bd = d; best = s; } }
    return best ? [best.x, best.y] : [e.x, e.y + 1];
  }
  async moveEnemyPath(e, path, reactions = true, follow = true) {
    const visibleAny = path.some(([x, y]) => this.soldiers().some((s) => this.map.canSee(s.x, s.y, x, y, s.sight)));
    if (!visibleAny) {
      [e.x, e.y] = path[path.length - 1];
      this.view.place(e);
      this.view.settle?.(e, this.map.coverDirs(e.x, e.y));
      return;
    }
    if (!reactions) {
      e.seen = true;
      this.view.setVisible(e, true);
      await this.view.walk(e, path, (i) => { [e.x, e.y] = path[i]; return true; }, follow);
      this.view.settle?.(e, this.map.coverDirs(e.x, e.y));
      return;
    }
    await this.moveUnit(e, path, 0);
  }

  // ------------------------------------------------------------ combat
  async shoot(s, t, opt = {}) {
    const isEmber = s.side === 'ember';
    if (isEmber) s.ammo = Math.max(0, s.ammo - 1);
    this.view.face(s, t.x, t.y, true);
    const visible = isEmber || s.seen !== false;
    if (visible) this.view.focusPair(s, t);
    const cine = visible && !opt.reaction && (this.forceCine ?? Math.random() < (isEmber ? 0.75 : 0.45));
    if (cine) { this.view.shoulderCam(s, t); this.ui.cine?.(true); }
    await this.view.pose?.(s, 'aim');
    await this.view.aimSettled?.(s);
    const rolls = opt.rolls || 1;
    let landed = false;
    for (let i = 0; i < rolls && s.alive; i++) {
      if (!t.alive) {
        const next = (isEmber ? this.targetsFor(s) : this.visibleTargets(s)).filter((e) => dist(e, t) <= 5).sort((a, b) => dist(a, t) - dist(b, t))[0];
        if (!next) break;
        t = next;
        this.view.face(s, t.x, t.y, true);
        await this.view.aimSettled?.(s, 0.4);
      }
      if (await this.roll(s, t, opt, i > 0)) landed = true;
      if (i < rolls - 1) await this.view.wait(0.1);
    }
    if (cine) { await this.view.wait(t.alive && landed ? 0.7 : 1.0); this.view.endCine?.(); this.ui.cine?.(false); }
    else if (!landed) await this.view.wait(0.35);
  }
  // One shot's dice and its effects. Returns true when it hit.
  async roll(s, t, opt, more) {
    const o = this.odds(s, t, opt);
    const isEmber = s.side === 'ember';
    let hit = Math.random() * 100 < o.hit;
    if (hit && t.untouch && t.side === 'ember') { hit = false; t.untouch = false; this.ui.pop(t, 'Untouchable', 'info'); }
    const crit = hit && Math.random() * 100 < o.crit;
    if (isEmber && s.st) { s.st.shots++; if (hit) s.st.hits++; if (crit) s.st.crits++; }
    if (isEmber && !opt.reaction && !more && Math.random() < 0.35) this.ui.bark?.(s, 'shoot');
    this.sfx.shot?.(s.weapon === 'pale' ? (s.kind === 'brute' || s.kind === 'overseer' ? 'heavy' : 'pale') : s.weapon);
    const kind = s.weapon === 'pale' ? 'pale' : s.weapon;
    await this.view.shotFx(s, t, hit, kind);
    if (has(s, 'spotter')) t.marked = this.turn + (isEmber ? 0 : 1);
    if (s.steady) s.steady = false;
    if (!hit) {
      this.ui.pop(t, 'Missed', 'miss');
      if (isEmber && !more && Math.random() < 0.5) setTimeout(() => this.ui.bark?.(s, 'miss'), 350);
      return false;
    }
    let dmg = o.dmg[0] + Math.floor(Math.random() * (o.dmg[1] - o.dmg[0] + 1));
    if (crit) dmg += Math.ceil(dmg * 0.5) + (has(s, 'headshot') ? 3 : 0);
    if (has(s, 'shred')) { if (t.armour) t.armour -= 1; }
    else dmg = Math.max(1, dmg - (t.armour || 0));
    if (isEmber && crit && t.hp > dmg) this.ui.bark?.(s, 'crit');
    await this.damage(t, dmg, s, crit ? 'crit' : 'dmg');
    return true;
  }

  async damage(t, dmg, source, style = 'dmg') {
    if (!t.alive) return;
    let left = dmg;
    if (t.shield) {
      const a = Math.min(t.shield, left);
      t.shield -= a;
      left -= a;
      if (!t.shield) this.view.setShield(t, false);
    }
    t.hp -= left;
    if (t.side === 'ember' && t.st && left > 0) t.st.hurt += left;
    this.sfx.hit?.(t.side);
    this.ui.pop(t, style === 'crit' ? `Crit ${dmg}` : `${dmg}`, style);
    // the squad strip shows hurt and fallen soldiers at once, in the enemy turn too
    if (t.side === 'ember') this.ui.refresh?.();
    if (t.hp > 0) {
      if (t.side === 'ember' && left > 0) this.ui.bark?.(t, t.hp <= 2 ? 'low' : 'hurt');
      await this.view.pose?.(t, 'hit');
      if (t.side === 'pale' && !t.active) await this.scramble([t.pod]);
      return;
    }
    if (t.side === 'ember' && this.flags.lifelineUsed === false && this.soldiers().some((m) => m !== t && has(m, 'lifeline'))) {
      this.flags.lifelineUsed = true;
      t.hp = 1;
      this.ui.pop(t, 'Lifeline', 'heal');
      return;
    }
    t.hp = 0;
    t.alive = false;
    if (t.side === 'ember') {
      t.status = this.diff.ko ? 'ko' : 'dead';
      if (this.cache && this.cache.carrier === t.id) {
        this.cache.carrier = null;
        this.cache.x = t.x;
        this.cache.y = t.y;
        this.view.setCache(this.cache, null);
      }
      this.ui.toast(this.diff.ko ? `${t.name} is knocked out.` : `${t.name} has fallen.`);
      const mate = this.soldiers().filter((m) => m !== t && m.alive && m.onMap).sort((a, b) => dist(a, t) - dist(b, t))[0];
      if (mate) this.ui.bark?.(mate, 'ally', { name: t.callsign || t.name.split(' ')[0] });
    }
    if (source && source.side === 'ember' && t.side === 'pale') {
      source.kills++;
      if (source.st) source.st.best = Math.max(source.st.best, dist(source, t));
      this.ui.bark?.(source, 'kill');
      if ((has(source, 'hitrun') || has(source, 'followup')) && !source.refund && this.phase === 'player') {
        source.refund = true;
        source.ap = Math.min(AP_MAX, source.ap + 1);
        this.ui.pop(source, '+1 action', 'info');
      }
      if (has(source, 'untouchable')) source.untouch = true;
    }
    this.sfx.death?.(t.side);
    this.syncArcs();
    if (t.side === 'ember') this.ui.refresh?.();
    await this.view.death(t);
    if (this.sel === t) this.sel = null;
  }

  async blast(x, y, radius, dmg, source) {
    this.sfx.boom?.();
    await this.view.explode(x, y, radius);
    const chain = [];
    for (const o of this.map.objects) {
      if (o.gone || !OBJ[o.type].hp) continue;
      if (!o.tiles.some(([tx, ty]) => Math.hypot(tx - x, ty - y) <= radius + 0.01)) continue;
      this.map.remove(o);
      this.view.removeObject(o);
      if (OBJ[o.type].boom) {
        const cx = o.tiles.reduce((a, t) => a + t[0], 0) / o.tiles.length, cy = o.tiles.reduce((a, t) => a + t[1], 0) / o.tiles.length;
        chain.push([Math.round(cx), Math.round(cy), OBJ[o.type].boom]);
      }
    }
    const hit = this.units.filter((u) => u.alive && u.onMap && Math.hypot(u.x - x, u.y - y) <= radius + 0.01);
    for (const u of hit) {
      const d = Math.max(1, dmg - (u.armour || 0));
      await this.damage(u, d, source, 'dmg');
    }
    for (const [cx, cy, r] of chain) {
      await this.view.wait(0.25);
      await this.blast(cx, cy, r, 3, source);
    }
    this.computeVis();
  }

  async evacuate(u) {
    this.ui.bark?.(u, 'evac');
    u.onMap = false;
    u.status = 'evac';
    if (this.cache && this.cache.carrier === u.id) {
      this.cache.secured = true;
      this.ui.toast('Cache secured.');
    }
    this.ui.pop(u, 'Evacuated', 'info');
    this.sfx.evac?.();
    await this.view.pose?.(u, 'evac');
    this.view.removeUnit(u);
    if (this.sel === u) this.sel = null;
  }

  // ------------------------------------------------------------ turn flow
  endTurn(auto) {
    if (this.busy || this.phase !== 'player' || this.over) return;
    this.run(() => this.enemyTurn());
  }

  // Between turns the two sides trade shots that miss, for the look of a firefight: no damage, no effect on play.
  // It runs while the enemy turn plays and for a moment as the player's turn begins.
  async crossfire(seconds) {
    if (this.view.instant || this.crossfiring) return;
    this.crossfiring = true;
    const end = this.view.time + seconds;
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    let tail = null;
    while (!this.over && this.view.time < end) {
      // keep going for a moment after the player's turn begins, and stop once they act
      if (this.phase !== 'enemy') { tail ??= this.view.time + 2.5; if (this.view.time > tail || this.busy) break; }
      const foes = this.enemies().filter((e) => e.seen && e.alive && e.onMap);
      const squad = this.soldiers().filter((s) => s.alive && s.onMap);
      if (!foes.length || !squad.length) break;
      // one side fires a short burst; now and then the other answers
      const ember = Math.random() < 0.55;
      const a = ember ? pick(squad) : pick(foes), b = ember ? pick(foes) : pick(squad);
      if (a !== this.acting && dist(a, b) < 26) {
        const n = 1 + Math.floor(Math.random() * 3);
        this.view.volley(a, b, n, () => this.sfx.distantShot?.(!ember));
      }
      await this.view.wait(0.5 + Math.random() * 0.8);
    }
    this.crossfiring = false;
  }
  async enemyTurn() {
    this.phase = 'enemy';
    this.crossfire(60);
    this.select(null);
    this.ui.banner('Enemy turn', '');
    this.ui.refresh();
    // open on the enemies the squad can see, or on the squad if none are in sight
    const seen = this.enemies().filter((e) => e.seen && e.onMap);
    const group = seen.length ? seen : this.soldiers();
    if (group.length) this.view.focus(group.reduce((a, u) => a + u.x, 0) / group.length, group.reduce((a, u) => a + u.y, 0) / group.length);
    await this.view.wait(0.8);
    for (const e of this.enemies()) { e.ow = 0; e.owArc = null; e.hunker = false; e.ap = 2; if (e.cool.shield) e.cool.shield--; }
    this.syncArcs();
    // patrols
    for (const p of this.pods) {
      if (p.active) continue;
      const members = this.enemies().filter((e) => e.pod === p.id);
      if (!members.length) continue;
      await this.patrol(p, members);
      if (this.over) return;
    }
    // active enemies act
    const order = this.enemies().filter((e) => e.active).sort((a, b) => dist(a, { x: this.nearestSoldierXY(a)[0], y: this.nearestSoldierXY(a)[1] }) - dist(b, { x: this.nearestSoldierXY(b)[0], y: this.nearestSoldierXY(b)[1] }));
    for (const e of order) {
      if (!e.alive || !e.onMap) continue;
      if (!this.soldiers().length) break;
      this.acting = e;
      try { await this.act(e); } catch (err) { console.error(err); }
      this.acting = null;
      if (this.checkEnd()) return;
    }
    this.startPlayerTurn();
  }

  async patrol(p, members) {
    const lead = members[0];
    if (!p.wp || Math.hypot(p.wp[0] - lead.x, p.wp[1] - lead.y) < 2) {
      const far = this.gen.far;
      p.wp = far[Math.floor(Math.random() * far.length)];
    }
    for (const e of members) {
      if (!e.alive || p.active) continue;
      const r = this.reachOf(e, 1);
      let best = null, bd = Infinity;
      for (let y = 0; y < this.map.h; y++) for (let x = 0; x < this.map.w; x++) {
        const c = r.cost[this.map.idx(x, y)];
        if (c === Infinity || !this.standable(x, y) && !(x === e.x && y === e.y)) continue;
        const d = Math.hypot(x - p.wp[0], y - p.wp[1]) + Math.random();
        if (d < bd) { bd = d; best = [x, y]; }
      }
      if (!best) continue;
      const path = pathTo(this.map, r, best[0], best[1]);
      if (!path || path.length < 2) continue;
      // walk step by step; stop and alert if it spots a soldier
      let spotted = false;
      const cut = [];
      for (const step of path) {
        cut.push(step);
        const probe = { ...e, x: step[0], y: step[1] };
        if (this.soldiers().some((s) => this.canSee(probe, s) || this.canSee(s, probe))) { spotted = true; break; }
      }
      if (cut.length > 1) await this.moveEnemyPath(e, cut, false);
      if (spotted) { await this.scramble([p.id]); return; }
    }
  }

  // Score a tile for an enemy: cover against soldiers, shots it could take, distance it likes.
  scoreTile(e, x, y, shoot) {
    const sq = this.soldiers();
    let s = 0, bestShot = 0;
    const ideal = ENEMIES[e.kind].ideal;
    for (const t of sq) {
      const d = Math.hypot(t.x - x, t.y - y);
      const seesMe = d <= t.sight && this.map.canSee(t.x, t.y, x, y, t.sight);
      if (seesMe && !e.fly) {
        const c = this.map.coverFrom(x, y, t.x, t.y);
        s += c === 2 ? 6 : c === 1 ? 0 : -18;
      }
      if (shoot && d <= e.sight && this.map.canSee(x, y, t.x, t.y, e.sight)) {
        const o = this.odds(e, t, { fromX: x, fromY: y });
        const v = o.hit + (o.flanked ? 25 : 0) + (t.hp <= o.dmg[1] ? 15 : 0);
        bestShot = Math.max(bestShot, v);
      }
    }
    const nd = Math.min(...sq.map((t) => Math.hypot(t.x - x, t.y - y)));
    s -= Math.abs(nd - ideal) * 2;
    s += bestShot * 0.7;
    if (this.inSmoke(x, y)) s += 8;
    return s + Math.random() * 4;
  }
  bestTile(e, shoot) {
    const r = this.reachOf(e, 1);
    let best = { x: e.x, y: e.y, s: this.scoreTile(e, e.x, e.y, shoot) + 3 };
    for (let y = 0; y < this.map.h; y++) for (let x = 0; x < this.map.w; x++) {
      const c = r.cost[this.map.idx(x, y)];
      if (c === Infinity || !c || !this.standable(x, y)) continue;
      const s = this.scoreTile(e, x, y, shoot);
      if (s > best.s) best = { x, y, s };
    }
    return best;
  }
  visibleTargets(e) {
    return this.soldiers().filter((s) => this.canSee(e, s));
  }
  async act(e) {
    // the camera follows the acting enemy, leaning toward the soldier it is likely to go for
    const show = () => {
      e.seen = this.soldiers().some((s) => this.canSee(s, e));
      this.view.setVisible(e, e.seen);
      if (!e.seen) return;
      const [nx, ny] = this.nearestSoldierXY(e);
      const d = Math.max(0.001, Math.hypot(nx - e.x, ny - e.y)), k = Math.min(0.4, 2.5 / d);
      this.view.focus(e.x + (nx - e.x) * k, e.y + (ny - e.y) * k);
    };
    show();
    if (e.kind === 'overseer') return this.actBoss(e);
    if (e.kind === 'stalker') return this.actStalker(e);
    if (e.kind === 'warden' && !e.cool.shield) {
      const allies = this.enemies().filter((a) => a !== e && a.active && !a.shield && dist(a, e) <= 7);
      if (allies.length) {
        if ((await this.reactions(e)) === 'dead') return;
        const a = allies.sort((p, q) => p.hp / p.maxHp - q.hp / q.maxHp)[0];
        this.view.face(e, a.x, a.y);
        await this.view.pose?.(e, 'cast');
        this.view.beam(e, a, '#b58cff');
        this.sfx.shield?.();
        a.shield = 3 + Math.floor(this.mission.act / 2);
        e.cool.shield = 3;
        this.view.setShield(a, true);
        if (a.seen || e.seen) this.ui.pop(a, `Shield ${a.shield}`, 'info');
        await this.view.wait(0.5);
        e.ap -= 1;
      }
    }
    // grenade at a cluster
    if (e.grenades > 0 && e.ap > 0) {
      for (const t of this.visibleTargets(e)) {
        if (dist(e, t) > GRENADE.range) continue;
        const n = this.soldiers().filter((s) => Math.hypot(s.x - t.x, s.y - t.y) <= GRENADE.radius).length;
        if (n >= 2 && Math.random() < 0.7) {
          if ((await this.reactions(e)) === 'dead') return;
          e.grenades--;
          e.ap = 0;
          this.view.face(e, t.x, t.y);
          await this.view.pose?.(e, 'throw');
          await this.view.lob?.(e, t.x, t.y, 'grenade');
          await this.blast(t.x, t.y, GRENADE.radius, GRENADE.dmg + Math.floor(this.mission.act / 2), e);
          return;
        }
      }
    }
    if (e.ap <= 0) return;
    // shoot now if already in decent cover with a good shot
    const now = this.visibleTargets(e);
    const here = this.scoreTile(e, e.x, e.y, false);
    if (now.length && here >= 0 && e.ap === 1) return this.enemyShoot(e, now);
    const move = this.bestTile(e, true);
    if (move.x !== e.x || move.y !== e.y) {
      const r = this.reachOf(e, 1);
      const path = pathTo(this.map, r, move.x, move.y);
      if (path && path.length > 1) {
        e.ap -= 1;
        await this.moveEnemyPath(e, path, true);
        if (!e.alive) return;
        show();
      }
    } else if (!now.length) {
      // nothing to do here: close in
      const r = this.reachOf(e, 2);
      const [tx, ty] = this.nearestSoldierXY(e);
      let best = null, bd = Infinity;
      for (let y = 0; y < this.map.h; y++) for (let x = 0; x < this.map.w; x++) {
        const c = r.cost[this.map.idx(x, y)];
        if (c === Infinity || !c || !this.standable(x, y)) continue;
        const d = Math.hypot(x - tx, y - ty);
        if (d < bd) { bd = d; best = [x, y]; }
      }
      if (best) {
        const path = pathTo(this.map, r, best[0], best[1]);
        if (path && path.length > 1) { e.ap = 0; await this.moveEnemyPath(e, path, true); }
        return;
      }
    }
    if (e.ap <= 0 || !e.alive) return;
    const vis = this.visibleTargets(e);
    if (vis.length) return this.enemyShoot(e, vis);
    const [wx, wy] = this.nearestSoldierXY(e);
    e.ow = 1;
    e.owArc = { a: Math.atan2(wx - e.x, wy - e.y), r: clamp(Math.round(Math.hypot(wx - e.x, wy - e.y)) + 2, 6, 11) };
    e.owShot = [];
    e.ap = 0;
    this.syncArcs();
    if (e.seen) this.ui.pop(e, 'Overwatch', 'info');
  }
  async enemyShoot(e, list) {
    const pick = list.map((t) => {
      const o = this.odds(e, t);
      return { t, v: o.hit + (o.flanked ? 20 : 0) + (t.hp <= o.dmg[1] ? 15 : 0) };
    }).sort((a, b) => b.v - a.v)[0];
    e.ap = 0;
    if ((await this.reactions(e)) === 'dead' || !pick.t.alive) return;
    e.seen = true;
    this.view.setVisible(e, true);
    await this.shoot(e, pick.t);
  }
  async actStalker(e) {
    const r = this.reachOf(e, 2);
    let best = null;
    for (const t of this.soldiers()) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const x = t.x + dx, y = t.y + dy;
        if (!this.map.inside(x, y)) continue;
        const c = r.cost[this.map.idx(x, y)];
        if (c === Infinity || (!this.standable(x, y) && !(x === e.x && y === e.y))) continue;
        const score = -c * 2 - t.hp * 3 + (c <= e.move ? 40 : 0);
        if (!best || score > best.score) best = { x, y, c, t, score };
      }
    }
    if (!best) {
      const mv = this.bestTile(e, false);
      const path = pathTo(this.map, this.reachOf(e, 1), mv.x, mv.y);
      if (path && path.length > 1) await this.moveEnemyPath(e, path, true);
      return;
    }
    const path = pathTo(this.map, r, best.x, best.y);
    if (path && path.length > 1) await this.moveEnemyPath(e, path, true);
    if (!e.alive) return;
    if (best.c <= e.move && dist(e, best.t) < 1.6 && best.t.alive) {
      const t = best.t;
      e.seen = true;
      this.view.setVisible(e, true);
      this.view.face(e, t.x, t.y);
      this.view.focus(t.x, t.y);
      await this.view.pose?.(e, 'melee');
      this.sfx.claw?.();
      const chance = clamp(e.aim - (t.def || 0) - (t.hunker ? 30 : 0), 5, 100);
      if (t.untouch) { t.untouch = false; this.ui.pop(t, 'Untouchable', 'info'); return; }
      if (Math.random() * 100 < chance) {
        const dmg = e.dmg[0] + Math.floor(Math.random() * (e.dmg[1] - e.dmg[0] + 1));
        this.view.hitFlinch(t);
        await this.damage(t, dmg, e, 'dmg');
      } else this.ui.pop(t, 'Dodged', 'miss');
    }
    e.ap = 0;
  }
  async actBoss(e) {
    if (e.cool.spawn <= 0) {
      e.cool.spawn = 3;
      await this.view.pose?.(e, 'cast');
      this.ui.banner('The Overseer calls drones', '');
      for (let i = 0; i < 2; i++) {
        const t = this.freeNear(e.x, e.y, 2);
        if (!t) continue;
        const d = this.makeEnemy('drone', t[0], t[1], e.pod);
        d.active = true;
        this.view.addUnit(d);
        this.view.beam(e, d, '#9ff6ff');
      }
      this.computeVis();
      await this.view.wait(0.6);
    } else e.cool.spawn--;
    const vis = this.visibleTargets(e);
    if (vis.length) return this.enemyShoot(e, vis);
    const mv = this.bestTile(e, true);
    const path = pathTo(this.map, this.reachOf(e, 1), mv.x, mv.y);
    if (path && path.length > 1) await this.moveEnemyPath(e, path, true);
  }

  startPlayerTurn() {
    this.turn++;
    this.phase = 'player';
    for (const sm of this.smoke) sm.turns--;
    this.smoke = this.smoke.filter((s) => s.turns > 0);
    this.view.setSmoke(this.smoke);
    for (const s of this.soldiers()) {
      s.ap = AP_MAX; s.shots = 0; s.ow = 0; s.owArc = null; s.hunker = false; s.moved = false; s.refund = false;
      for (const k of Object.keys(s.cool)) if (s.cool[k]) s.cool[k]--;
      this.view.pose?.(s, 'idle');
    }
    for (const e of this.enemies()) e.owShot = [];
    this.computeVis();
    this.ui.banner('Your turn', `Turn ${this.turn}`);
    const first = this.soldiers().find((s) => this.canControl(s));
    this.select(first || null);
    this.ui.saveSnapshot?.(this.snapshot());
  }

  checkEnd() {
    if (this.over) return true;
    const onMap = this.soldiers();
    const out = this.units.filter((u) => u.side === 'ember' && u.status === 'evac');
    const foes = this.enemies();
    let win = null;
    if (this.mission.type === 'final') {
      if (!this.units.some((u) => u.kind === 'overseer' && u.alive)) win = true;
    } else if (!foes.length) win = true;
    if (win === null && this.mission.type === 'recover' && this.cache && this.cache.secured && !onMap.length) win = true;
    if (win === null && !onMap.length) win = false;
    if (win === null) return false;
    if (win && this.cache && !this.cache.secured && this.mission.type === 'recover') this.cache.secured = true;
    this.over = true;
    this.phase = 'done';
    this.view.clearAll();
    this.view.setSelected(null);
    this.ui.missionOver(this.result(win));
    return true;
  }
  retreat() {
    if (this.over) return;
    this.over = true;
    this.ui.missionOver(this.result(false, true));
  }
  result(win, retreated) {
    return {
      win, retreated: !!retreated, turns: this.turn, missionId: this.mission.id,
      soldiers: this.units.filter((u) => u.side === 'ember').map((u) => ({
        rid: u.rid, name: u.name, kills: u.kills, hp: Math.max(0, u.hp), maxHp: u.maxHp,
        status: u.alive ? 'ok' : u.status, st: u.st,
      })),
      cache: this.cache ? this.cache.secured : null,
    };
  }

  // ------------------------------------------------------------ save and resume
  snapshot() {
    const keep = ['id', 'rid', 'slot', 'side', 'kind', 'name', 'x', 'y', 'hp', 'maxHp', 'aim', 'move', 'def', 'armour', 'shield', 'weapon', 'clip', 'ammo', 'dmgBonus', 'dmg',
      'grenades', 'rockets', 'medkits', 'smokes', 'perks', 'ap', 'shots', 'ow', 'owArc', 'hunker', 'moved', 'steady', 'untouch', 'cool', 'kills', 'owner', 'sight', 'skin', 'rank', 'st', 'kit', 'callsign',
      'alive', 'onMap', 'status', 'fly', 'pod', 'active', 'marked'];
    return {
      v: 1, missionId: this.mission.id, turn: this.turn, nextId: this.nextId,
      units: this.units.map((u) => Object.fromEntries(keep.filter((k) => u[k] !== undefined).map((k) => [k, u[k]]))),
      pods: this.pods, smoke: this.smoke, cache: this.cache, flags: this.flags,
      removed: this.map.objects.filter((o) => o.gone).map((o) => o.id),
    };
  }
  restore(s) {
    this.turn = s.turn;
    this.nextId = s.nextId;
    this.units = s.units.map((u) => ({ ...u, cool: { ...u.cool }, perks: [...(u.perks || [])] }));
    this.pods = s.pods;
    this.smoke = s.smoke;
    this.cache = s.cache;
    this.flags = s.flags;
    for (const id of s.removed) this.map.remove(this.map.objects[id]);
  }
}
