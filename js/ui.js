// Far Ember: HUD during missions and the screens between them.
import { ICON } from './icons.js';
import { wordmark } from './brand.js';
import { CLASSES, ENEMIES, RANKS, PERKS, UPGRADES, DIFFICULTY, MISSION_TYPES, BIOMES, CLASS_IDS, RECRUIT_COST } from './data.js';
import { rankName, perksPending, perkTier, squadSize, ready, missionBlurb, THREAT_MAX, WINS_FOR_FINAL } from './campaign.js';
import { soldierStats } from './battle.js';
import { PALETTE, defaultKit } from './armour.js';
import { bioText, callsignIdeas, fullName, medalIcon, medalOf, barkLine } from './service.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const OWNER_COL = ['#ff8a3d', '#86ecf3'];

export class UI {
  constructor(app) {
    this.app = app;
    this.hud = $('#hud');
    this.screen = $('#screen');
    this.labels = $('#labels');
    this.pops = $('#pops');
    this.toastEl = $('#toast');
    this.modalEl = $('#modal');
    this.plates = new Map();
    this.endArmed = false;
  }

  // ============================================================ battle HUD
  attach(battle) {
    this.b = battle;
    this.screen.hidden = true;
    this.hud.hidden = false;
    this.labels.innerHTML = '';
    this.plates.clear();
    const m = battle.mission;
    this.hud.innerHTML = `
      <div id="mission" class="glass"><div class="op">${esc(m.name)}</div><div class="obj" id="obj"></div><div class="turn" id="turnlbl"></div></div>
      <div id="topright">
        <button class="iconbtn glass" id="rotl" aria-label="Turn camera left">${ICON.rotl}</button>
        <button class="iconbtn glass" id="rotr" aria-label="Turn camera right">${ICON.rotr}</button>
        <button class="iconbtn glass" id="menubtn" aria-label="Menu">${ICON.menu}</button>
      </div>
      <div id="banner"><div class="t"></div><div class="s"></div><div class="rule"></div></div>
      <div id="hint" class="glass"></div>
      <div id="infocard" class="glass" hidden></div>
      <div id="bottom">
        <div id="squad" class="glass"></div>
        <div id="actions"></div>
        <button id="endturn" class="glass">${ICON.endturn}<span>End turn</span></button>
      </div>`;
    $('#rotl').onclick = () => this.app.view.rotate(-1);
    $('#rotr').onclick = () => this.app.view.rotate(1);
    $('#menubtn').onclick = () => this.pauseMenu();
    $('#endturn').onclick = () => {
      if (!this.b || this.b.busy || this.b.phase !== 'player') return;
      const left = this.b.soldiers().filter((s) => this.b.canControl(s) && s.ap > 0).length;
      if (left && !this.endArmed) { this.endArmed = true; this.refresh(); return; }
      this.endArmed = false;
      this.b.endTurn();
    };
    this.refresh();
  }
  detach() {
    this.b = null;
    this.hud.hidden = true;
    this.hud.innerHTML = '';
    this.labels.innerHTML = '';
    this.plates.clear();
  }

  objective() {
    const b = this.b, m = b.mission;
    if (m.type === 'final') return 'Kill the Overseer.';
    if (m.type === 'recover') {
      if (b.cache.secured) return 'Cache secured. Clear the area or leave.';
      if (b.cache.carrier) return 'Carry the cache to the green zone and evacuate.';
      return 'Find the data cache (orange light) and pick it up.';
    }
    const left = b.enemies().length;
    return b.flags.seenAny ? `Kill every enemy. ${left} left.` : 'Find and kill every enemy.';
  }

  refresh() {
    const b = this.b;
    if (!b) return;
    $('#obj').textContent = this.objective();
    $('#turnlbl').textContent = `Turn ${b.turn}${b.coop ? ` · ${b.commanderName()}` : ''}`;
    // squad cards
    const sq = $('#squad');
    const list = b.units.filter((u) => u.side === 'ember');
    sq.innerHTML = list.map((u) => {
      const cls = CLASSES[u.kind];
      const gone = !u.alive || !u.onMap;
      const st = gone ? (u.status === 'evac' ? 'Out' : u.status === 'ko' ? 'KO' : 'Down') : '';
      return `<button class="card ${u === b.sel ? 'sel' : ''} ${gone || u.ap <= 0 ? 'spent' : ''} ${!gone && !b.canControl(u) ? 'other' : ''}" data-id="${u.id}" style="--cc:${cls.color}" ${gone ? 'disabled' : ''}>
        ${b.coop ? `<span class="own" style="background:${OWNER_COL[u.owner]}"></span>` : ''}
        ${this.face(u, 'face')}
        <span class="nm">${esc(st || u.name.split(' ')[0])}</span>
        <span class="hp"><b style="width:${Math.max(0, (u.hp / u.maxHp) * 100)}%;background:${u.hp / u.maxHp < 0.34 ? 'var(--bad)' : u.hp / u.maxHp < 0.67 ? 'var(--warn)' : 'var(--good)'}"></b></span>
        ${gone ? '' : `<span class="ap">${[0, 1].map((i) => `<i class="${i < u.ap ? '' : 'used'}"></i>`).join('')}</span>`}
      </button>`;
    }).join('');
    sq.querySelectorAll('.card').forEach((el) => {
      el.onclick = () => { const u = b.unit(el.dataset.id); if (u && b.canControl(u) && !b.busy) { this.app.sfx.click(); b.select(u); } };
    });
    // action area
    const area = $('#actions');
    const end = $('#endturn');
    end.disabled = b.busy || b.phase !== 'player';
    end.classList.toggle('armed', this.endArmed);
    end.querySelector('span').textContent = this.endArmed ? 'Tap to confirm' : b.coop && b.coopPhase === 0 && b.soldiers().some((s) => s.owner === 1) ? `Pass to ${b.camp.names[1]}` : 'End turn';
    this.hint('');
    if (b.phase !== 'player' || b.over || b.busy) { area.innerHTML = ''; return; }
    if (b.mode === 'shoot' && b.target) return this.shotPanel(area);
    if (b.mode === 'aoe') return this.aoePanel(area);
    if (b.mode === 'heal') return this.healPanel(area);
    const u = b.sel;
    if (!u) { area.innerHTML = ''; return; }
    const acts = b.actions();
    const mv = b.pendingMove ? `<button class="act move" data-a="move">${ICON.move}<span>Move here</span></button>` : '';
    area.innerHTML = `<div class="bar glass">${mv}${acts.map((a) => `<button class="act ${a.id === 'shoot' && a.ok ? 'primary' : ''}" data-a="${a.id}" ${a.ok ? '' : 'disabled'} title="${esc(a.note || '')}">${ICON[a.id === 'medkit' ? 'medkit' : a.id] || ICON.shoot}<span>${esc(a.label)}</span>${a.count ? `<b class="n">${a.count}</b>` : ''}</button>`).join('')}</div>`;
    area.querySelectorAll('.act').forEach((el) => {
      el.onclick = () => {
        this.endArmed = false;
        if (el.dataset.a === 'move') return b.confirmMove();
        b.doAction(el.dataset.a);
      };
    });
    if (b.pendingMove) {
      const c = b.moveReach.cost[b.map.idx(b.pendingMove[0], b.pendingMove[1])];
      this.hint(c > u.move ? 'Dash: uses both actions. Tap again to go.' : 'Tap again to move');
    }
  }
  hint(t) {
    const h = $('#hint');
    if (!h) return;
    h.textContent = t;
    h.classList.toggle('show', !!t);
  }

  shotPanel(area) {
    const b = this.b, u = b.sel, t = b.target;
    const o = b.odds(u, t, { rapid: b.rapidPending });
    const rows = o.mods.map(([l, v]) => `<span class="l">${esc(l)}</span><span class="v ${v < 0 ? 'neg' : l === 'Aim' ? '' : 'pos'}">${l === 'Aim' ? v : (v > 0 ? '+' : '') + v}</span>`).join('');
    area.innerHTML = `<div class="shot glass">
      <div class="who"><span class="k">${b.rapidPending ? 'Rapid fire at' : 'Target'}</span><span class="nm" style="color:var(--pale)">${esc(t.name)}</span>
        ${o.flanked ? '<span class="flank">Flanked: easy crit</span>' : o.cover === 2 ? '<span class="k">In full cover</span>' : o.cover === 1 ? '<span class="k">In half cover</span>' : ''}
        <div class="cyc">${b.targets.length > 1 ? `<button id="tprev" aria-label="Previous target">${ICON.left}</button><button id="tnext" aria-label="Next target">${ICON.right}</button>` : ''}</div></div>
      <div class="big"><div class="pct">${o.hit}<small>%</small></div><div class="lab">To hit</div></div>
      <div class="stats">${rows}<span class="sep"></span>
        <span class="l">Crit chance</span><span class="v">${o.crit}%</span>
        <span class="l">Damage</span><span class="v">${o.dmg[0]}-${o.dmg[1]}</span>
        <span class="l">Distance</span><span class="v">${o.dist.toFixed(1)}</span></div>
      <div class="go"><button class="btn fire" id="firebtn">${ICON.shoot} Fire</button><button class="btn" id="cancelbtn">Back</button></div>
    </div>`;
    $('#firebtn').onclick = () => b.fire();
    $('#cancelbtn').onclick = () => { b.rapidPending = false; b.cancelMode(); };
    if ($('#tprev')) { $('#tprev').onclick = () => b.cycleTarget(-1); $('#tnext').onclick = () => b.cycleTarget(1); }
  }
  aoePanel(area) {
    const b = this.b, kind = b.aoeKind;
    const p = b.aoePreview();
    const label = { grenade: 'Grenade', rocket: 'Rocket', smoke: 'Smoke' }[kind];
    const info = !p ? 'Tap a spot inside the ring.' : kind === 'smoke'
      ? `${p.allies} soldier${p.allies === 1 ? '' : 's'} covered. +${b.aoeSpec(b.sel, kind).def || 20} defence for 2 turns.`
      : `Hits ${p.enemies} enem${p.enemies === 1 ? 'y' : 'ies'}${p.allies ? `, ${p.allies} of yours` : ''}. Breaks ${p.cover} cover.`;
    area.innerHTML = `<div class="shot glass"><div class="who"><span class="k">${label}</span><span class="nm">${p ? 'Ready' : 'Pick a spot'}</span></div>
      <div class="stats" style="min-width:220px"><span class="l" style="grid-column:1/-1;color:var(--ink)">${esc(info)}</span>
      ${p && p.allies && kind !== 'smoke' ? '<span class="l" style="grid-column:1/-1;color:var(--bad)">Careful: your own soldiers are in the blast.</span>' : ''}</div>
      <div class="go"><button class="btn fire" id="firebtn" ${p ? '' : 'disabled'}>${ICON[kind]} Throw</button><button class="btn" id="cancelbtn">Back</button></div></div>`;
    $('#firebtn').onclick = () => b.fire();
    $('#cancelbtn').onclick = () => b.cancelMode();
    this.hint(p ? 'Tap the same spot again or press Throw' : '');
  }
  healPanel(area) {
    const b = this.b, t = b.target;
    area.innerHTML = `<div class="shot glass"><div class="who"><span class="k">Medkit</span><span class="nm">${t ? esc(t.name) : 'Nobody'}</span></div>
      <div class="stats"><span class="l">Health</span><span class="v">${t ? `${t.hp}/${t.maxHp}` : '-'}</span><span class="l">Heals</span><span class="v pos">+${4 + (b.sel.perks.includes('surgeon') ? 2 : 0)}</span></div>
      <div class="go"><button class="btn fire" id="firebtn" ${t ? '' : 'disabled'}>${ICON.medkit} Heal</button><button class="btn" id="cancelbtn">Back</button></div></div>`;
    $('#firebtn').onclick = () => b.fire();
    $('#cancelbtn').onclick = () => b.cancelMode();
    this.hint('Tap a hurt soldier to pick who to heal');
  }

  cine(on) {
    this.hud.classList.toggle('cine', !!on);
    this.labels.style.visibility = on ? 'hidden' : '';
  }
  banner(t, s) {
    const el = $('#banner');
    if (!el) return;
    el.querySelector('.t').textContent = t;
    el.querySelector('.s').textContent = s || '';
    el.classList.toggle('enemy', /enem/i.test(t) || /Overseer/.test(t));
    el.classList.add('show');
    this.app.sfx.turn();
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => el.classList.remove('show'), 1600);
  }
  toast(t) {
    this.toastEl.textContent = t;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => this.toastEl.classList.remove('show'), 2600);
  }
  pop(u, text, kind) {
    const p = this.app.view.unitScreen(u, 0.6);
    if (!p || p.behind) return;
    if (u.side === 'pale' && u.seen === false) return;
    const el = document.createElement('div');
    el.className = `pop ${kind}`;
    el.textContent = text;
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y - 18}px`;
    this.pops.appendChild(el);
    setTimeout(() => el.remove(), 1700);
  }
  // A soldier calls something out: a short line in a tag over their head, at most one every few seconds each.
  bark(u, kind, vars) {
    if (!u || u.side !== 'ember' || !this.b || this.app.view.instant) return;
    const now = performance.now();
    this.barkAt ||= new Map();
    if ((this.barkAt.get(u.id) || 0) > now) return;
    const line = barkLine(kind, vars);
    const p = line && this.app.view.unitScreen(u, 0.95);
    if (!p || p.behind) return;
    this.barkAt.set(u.id, now + 3500);
    const el = document.createElement('div');
    el.className = 'bark';
    el.innerHTML = `<b>${esc(u.callsign || u.name.split(' ')[0])}</b>${esc(line)}`;
    el.style.left = `${Math.max(90, Math.min(innerWidth - 90, p.x))}px`;
    el.style.top = `${Math.max(70, p.y - 26)}px`;
    this.pops.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }
  info(u) {
    const card = $('#infocard');
    if (!card) return;
    const e = ENEMIES[u.kind];
    card.hidden = false;
    card.innerHTML = `<div class="nm">${esc(u.name)}</div><div class="row"><span>Health ${u.hp}/${u.maxHp}</span>${u.armour ? `<span>Armour ${u.armour}</span>` : ''}${u.shield ? `<span>Shield ${u.shield}</span>` : ''}</div><p>${esc(e.blurb)}</p>`;
    clearTimeout(this.infoT);
    this.infoT = setTimeout(() => { card.hidden = true; }, 3500);
  }

  // Unit plates follow the units every frame.
  frame() {
    const b = this.b;
    if (!b) return;
    const seen = new Set();
    for (const u of b.units) {
      if (!u.alive || !u.onMap) continue;
      if (u.side === 'pale' && !u.seen) continue;
      const p = this.app.view.unitScreen(u, 0.32);
      if (!p || p.behind || p.x < -20 || p.y < -20 || p.x > innerWidth + 20 || p.y > innerHeight + 20) continue;
      seen.add(u.id);
      let el = this.plates.get(u.id);
      if (!el) {
        el = document.createElement('div');
        el.className = `plate ${u.side}`;
        this.labels.appendChild(el);
        this.plates.set(u.id, el);
      }
      const cov = u.side === 'pale' && b.sel && b.phase === 'player' ? (u.fly ? 0 : b.map.coverFrom(u.x, u.y, b.sel.x, b.sel.y)) : -1;
      const key = `${u.hp}/${u.maxHp}/${u.shield}/${u.ow}/${u.hunker}/${b.cache && b.cache.carrier === u.id}/${u.marked === b.turn}/${cov}`;
      if (el.dataset.k !== key) {
        el.dataset.k = key;
        const icons = [];
        if (u.ow) icons.push(ICON.overwatch);
        if (u.hunker) icons.push(ICON.hunker);
        if (b.cache && b.cache.carrier === u.id) icons.push(ICON.cache);
        if (u.marked === b.turn) icons.push(ICON.steady);
        if (cov === 2) icons.push('<em class="cov full">' + ICON.shield + '</em>');
        else if (cov === 1) icons.push('<em class="cov half">' + ICON.shield + '</em>');
        else if (cov === 0) icons.push('<em class="cov flank">!</em>');
        const pips = [];
        for (let i = 0; i < u.maxHp; i++) pips.push(`<i class="${i < u.hp ? '' : 'lost'}"></i>`);
        for (let i = 0; i < (u.shield || 0); i++) pips.push('<i class="shield"></i>');
        // thin pips; a long bar (the boss) squeezes them so it never grows past about 90 px
        const pw = Math.max(2, Math.min(6, Math.floor((88 - pips.length) / pips.length)));
        el.innerHTML = `${icons.length ? `<div class="icons">${icons.map((i) => `<span>${i}</span>`).join('')}</div>` : ''}<div class="pips" style="--pw:${pw}px">${pips.join('')}</div>`;
      }
      el._x = p.x; el._y = p.y;
    }
    for (const [id, el] of this.plates) if (!seen.has(id)) { el.remove(); this.plates.delete(id); }
    // stack plates that would overlap
    const list = [...this.plates.values()].sort((a, c) => a._y - c._y);
    for (let i = 0; i < list.length; i++) for (let j = 0; j < i; j++) {
      const a = list[i], c = list[j];
      if (Math.abs(a._x - c._x) < 46 && Math.abs(a._y - c._y) < 14) a._y = c._y - 14;
    }
    for (const el of list) { el.style.left = `${el._x}px`; el.style.top = `${el._y}px`; }
  }

  missionOver(res) { this.app.missionOver(res); }
  saveSnapshot(s) { this.app.saveBattle(s); }

  pauseMenu() {
    const b = this.b;
    this.modal(`<h2>Paused</h2>
      <button class="btn" data-k="resume">Back to the mission</button>
      <button class="btn" data-k="help">How to play</button>
      <button class="btn" data-k="sound">Sound: ${this.app.sfx.muted ? 'off' : 'on'}</button>
      <button class="btn" data-k="gfx">Graphics: ${this.app.quality === 'high' ? 'high' : 'fast'}</button>
      <button class="btn" data-k="retreat" style="color:var(--bad)">Retreat (mission fails, everyone comes home)</button>`, {
      resume: () => this.closeModal(),
      help: () => this.help(),
      sound: () => { this.app.sfx.setMuted(!this.app.sfx.muted); this.app.prefs({ muted: this.app.sfx.muted }); this.pauseMenu(); },
      gfx: () => { this.app.setQuality(this.app.quality === 'high' ? 'fast' : 'high'); this.pauseMenu(); },
      retreat: () => { this.closeModal(); b && b.retreat(); },
    });
  }

  // ============================================================ modals
  modal(html, handlers = {}) {
    this.modalEl.innerHTML = `<div class="modal-back"><div class="modal glass">${html}</div></div>`;
    this.modalEl.querySelectorAll('[data-k]').forEach((el) => {
      el.onclick = () => { this.app.sfx.click(); handlers[el.dataset.k] && handlers[el.dataset.k](el); };
    });
    const back = this.modalEl.querySelector('.modal-back');
    back.onclick = (e) => { if (e.target === back && handlers.dismiss !== false) this.closeModal(); };
  }
  closeModal() { this.modalEl.innerHTML = ''; }
  help() {
    this.modal(`<h2>How to play</h2>
      <ul>
        <li>Tap a soldier, then tap a tile to see the path. Tap the same tile again to move.</li>
        <li>Each soldier gets 2 actions a turn. Blue tiles cost 1 action. Yellow tiles cost both.</li>
        <li>Shooting, throwing and overwatch end that soldier's turn.</li>
        <li>Shields show cover at a tile. A full shield blocks 40% to hit. A half shield blocks 20%.</li>
        <li>Shoot enemies from the side, where their cover does not face you. That is a flank: no cover and a big crit chance.</li>
        <li>Overwatch shoots the first enemy that moves where your soldier can see.</li>
        <li>Grenades and rockets ignore cover and break it.</li>
        <li>Drag to move the camera. Pinch to zoom. Twist two fingers or use the arrow buttons to turn it.</li>
      </ul>
      <button class="btn" data-k="ok">Got it</button>`, { ok: () => this.closeModal() });
  }

  // ============================================================ screens
  show(html, dim = true) {
    this.hud.hidden = true;
    this.screen.hidden = false;
    this.screen.className = dim ? 'dim' : '';
    this.screen.innerHTML = html;
    this.screen.scrollTop = 0;
  }
  bind(handlers) {
    this.screen.querySelectorAll('[data-k]').forEach((el) => {
      el.onclick = (ev) => { ev.stopPropagation(); this.app.sfx.click(); handlers[el.dataset.k] && handlers[el.dataset.k](el); };
    });
  }

  title(hasSave) {
    this.show(`<div class="title">
      ${wordmark()}
      <div class="tagline">The Pale came out of the dark between the stars and took the frontier worlds one by one. You command Ember Company from the carrier Lantern: a few soldiers, one dropship, and a lot of ground to win back.</div>
      <div class="menu">
        ${hasSave ? `<button class="btn main" data-k="continue">Continue <small>${esc(hasSave)}</small></button>` : ''}
        <button class="btn ${hasSave ? '' : 'main'}" data-k="new">New campaign</button>
        <button class="btn" data-k="help">How to play</button>
      </div>
      <div class="foot">Turn-based squad tactics. Plays on iPad. Best with headphones.</div>
    </div>`, false);
    this.bind({ continue: () => this.app.continueGame(), new: () => this.newGame(), help: () => this.help() });
  }

  newGame() {
    const st = { difficulty: 'classic', coop: false, names: ['Me', 'Dad'] };
    const draw = () => {
      this.modal(`<h2>New campaign</h2>
        <div class="field"><label>Difficulty</label></div>
        ${Object.entries(DIFFICULTY).map(([k, d]) => `<button class="choice ${st.difficulty === k ? 'on' : ''}" data-k="d_${k}"><b>${d.name}</b><span>${esc(d.desc)}</span></button>`).join('')}
        <div class="field"><label>Players</label></div>
        <button class="choice ${!st.coop ? 'on' : ''}" data-k="solo"><b>One commander</b><span>You move every soldier.</span></button>
        <button class="choice ${st.coop ? 'on' : ''}" data-k="coop"><b>Two commanders</b><span>Split the squad. Pass the iPad each turn.</span></button>
        ${st.coop ? `<div class="field"><label for="n0">Commander 1</label><input id="n0" maxlength="14" value="${esc(st.names[0])}"></div>
        <div class="field"><label for="n1">Commander 2</label><input id="n1" maxlength="14" value="${esc(st.names[1])}"></div>` : ''}
        <div class="actions-row"><button class="btn" data-k="cancel">Cancel</button><button class="btn fire" data-k="go">Start</button></div>`, {
        ...Object.fromEntries(Object.keys(DIFFICULTY).map((k) => [`d_${k}`, () => { st.difficulty = k; keep(); draw(); }])),
        solo: () => { keep(); st.coop = false; draw(); },
        coop: () => { keep(); st.coop = true; draw(); },
        cancel: () => this.closeModal(),
        go: () => { keep(); this.closeModal(); this.app.startCampaign(st); },
      });
    };
    const keep = () => {
      const a = $('#n0'), c = $('#n1');
      if (a) st.names[0] = a.value.trim() || 'Player 1';
      if (c) st.names[1] = c.value.trim() || 'Player 2';
    };
    draw();
  }

  base(camp, tab = 'ops') {
    this.baseTab = tab;
    const ready = camp.roster.filter((s) => !s.wounded).sort((a, b) => b.rank - a.rank).slice(0, 4);
    this.app.scene?.({ ops: 'ops', squad: 'squad', armoury: 'armoury', recruit: 'squad', fallen: 'memorial' }[tab] || 'squad', ready);
    const pend = camp.roster.some((s) => perksPending(s) > 0);
    const tabs = [['ops', 'Missions'], ['squad', 'Squad', pend], ['armoury', 'Armoury'], ['recruit', 'Recruit'], ['fallen', 'Memorial']];
    const threatPips = Array.from({ length: THREAT_MAX }, (_, i) => `<i class="${i < camp.threat ? 'on' : ''}"></i>`).join('');
    const progPips = Array.from({ length: WINS_FOR_FINAL }, (_, i) => `<i class="${i < camp.wins ? 'on' : ''}"></i>`).join('');
    let body = '';
    if (tab === 'ops') body = this.opsTab(camp);
    else if (tab === 'squad') body = this.squadTab(camp);
    else if (tab === 'armoury') body = this.armouryTab(camp);
    else if (tab === 'recruit') body = this.recruitTab(camp);
    else body = this.fallenTab(camp);
    this.show(`<div class="wrap">
      <div class="head"><h1><small>Carrier Lantern · Mission ${camp.missions + 1}</small>Command</h1>
        <div class="meters">
          <div class="meter glass"><div class="k">Supplies</div><div class="v">${camp.supplies}</div></div>
          <div class="meter glass"><div class="k">Spire located</div><div class="v">${Math.min(camp.wins, WINS_FOR_FINAL)}/${WINS_FOR_FINAL} wins</div><div class="track">${progPips}</div></div>
          <div class="meter glass threat"><div class="k">Enemy grip</div><div class="v">${camp.threat}/${THREAT_MAX}</div><div class="track">${threatPips}</div></div>
        </div></div>
      <div class="tabs">${tabs.map(([k, l, dot]) => `<button class="${k === tab ? 'on' : ''}" data-k="tab_${k}">${l}${dot ? '<span class="dot"></span>' : ''}</button>`).join('')}</div>
      ${body}
      <div class="actions-row"><button class="btn" data-k="menu">${ICON.menu} Title screen</button></div>
    </div>`);
    const h = {
      ...Object.fromEntries(tabs.map(([k]) => [`tab_${k}`, () => this.base(camp, k)])),
      menu: () => this.app.toTitle(),
    };
    camp.offers.forEach((m) => { h[`op_${m.id}`] = () => this.squadSelect(camp, m); });
    camp.roster.forEach((s) => {
      h[`s_${s.id}`] = () => this.soldierScreen(camp, s);
    });
    UPGRADES.forEach((u) => { h[`u_${u.id}`] = () => { if (this.app.buy(u.id)) this.base(camp, 'armoury'); }; });
    CLASS_IDS.forEach((c) => { h[`r_${c}`] = () => { const s = this.app.recruit(c); if (s) { this.toast(`${s.name} joined the squad.`); this.base(camp, 'recruit'); } }; });
    this.bind(h);
  }
  opsTab(camp) {
    const grip = camp.threat >= THREAT_MAX - 3 ? `<div class="panel glass" style="border-color:var(--bad)"><p style="margin:0;color:#ffb0a8">The enemy grip is close to full. If it fills, the campaign is lost. Strike missions push it back.</p></div>` : '';
    return `${grip}<div class="grid ops">${camp.offers.map((m) => {
      const bl = missionBlurb(m);
      return `<button class="op glass" data-k="op_${m.id}" style="text-align:left;--tc:${{ day: '#e8c46a', dusk: '#ff9a5a', night: '#8fa6ff' }[m.time] || '#e8c46a'}">
        <div class="row1"><span class="where">${esc(bl.where)} · ${m.time}</span>${m.strike ? '<span class="chip strike">Strike: grip -2</span>' : `<span class="skulls">${[1, 2, 3].map((i) => `<i class="${i <= m.diff ? 'on' : ''}"></i>`).join('')}</span>`}</div>
        <h3>${esc(m.name)}</h3>
        <p><b style="color:var(--ink)">${esc(bl.title)}.</b> ${esc(bl.brief)}</p>
        <div class="facts">${m.type !== 'final' ? `<span>Reward <b>${m.reward}</b></span>` : ''}<span>Danger <b>${['', 'Low', 'Medium', 'High'][m.diff]}</b></span></div>
      </button>`;
    }).join('')}</div>`;
  }
  soldierRow(camp, s, extra = '') {
    const cls = CLASSES[s.cls];
    const st = soldierStats(s, camp);
    const chips = [];
    if (s.wounded) chips.push(`<span class="chip wounded">Hurt: ${s.wounded} mission${s.wounded > 1 ? 's' : ''}</span>`);
    if (perksPending(s) > 0) chips.push('<span class="chip perk">New skill</span>');
    for (const p of s.perks) { const def = PERKS[s.cls].flat().find((x) => x.id === p); if (def) chips.push(`<span class="chip ok">${esc(def.name)}</span>`); }
    return `${this.face(s, 'pic', cls.color)}
      <span class="body"><span class="nm">${esc(fullName(s))}</span>
      <span class="sub">${rankName(s)} · ${cls.name}${camp.coop ? ` · <span style="color:${OWNER_COL[s.owner]}">${esc(camp.names[s.owner])}</span>` : ''}</span>
      <span class="stats"><b>Health ${st.hp}</b> <b>Aim ${st.aim}</b> <b>Move ${st.move}</b> <b>Kills ${s.kills}</b></span>
      ${s.medals && s.medals.length ? `<span class="medals">${s.medals.slice(0, 8).map((m) => medalIcon(m.id, 18)).join('')}</span>` : ''}
      ${chips.length ? `<span class="chips">${chips.join('')}</span>` : ''}</span>${extra}`;
  }
  squadTab(camp) {
    return `<div class="grid">${camp.roster.map((s) => `<button class="soldier glass" data-k="s_${s.id}">${this.soldierRow(camp, s)}</button>`).join('')}</div>`;
  }
  armouryTab(camp) {
    return `<div class="grid">${UPGRADES.map((u) => {
      const owned = camp.upgrades[u.id];
      const locked = u.req && !camp.upgrades[u.req];
      const req = locked ? UPGRADES.find((x) => x.id === u.req).name : '';
      return `<div class="upg glass"><h3>${esc(u.name)}</h3><p>${esc(u.desc)}</p>
        ${owned ? '<span class="chip ok">Owned</span>' : `<button class="btn" data-k="u_${u.id}" ${locked || camp.supplies < u.cost ? 'disabled' : ''}>${locked ? `Needs ${esc(req)}` : `Buy · ${u.cost}`}</button>`}</div>`;
    }).join('')}</div>`;
  }
  recruitTab(camp) {
    return `<div class="panel glass"><p style="margin:0;color:#cfcab9">New soldiers cost ${RECRUIT_COST} supplies and start as recruits. You have ${camp.supplies}.</p></div>
      <div class="grid">${CLASS_IDS.map((c) => `<div class="upg glass"><h3 style="color:${CLASSES[c].color}">${CLASSES[c].name}</h3><p>${esc(CLASSES[c].blurb)}</p>
      <button class="btn" data-k="r_${c}" ${camp.supplies < RECRUIT_COST ? 'disabled' : ''}>Recruit · ${RECRUIT_COST}</button></div>`).join('')}</div>`;
  }
  fallenTab(camp) {
    if (!camp.fallen.length) return '<div class="panel glass"><p class="muted" style="font-size:15px">Nobody has fallen yet. If they do, their names go on the wall.</p></div>';
    return `<div class="grid">${camp.fallen.slice().reverse().map((f) => `<div class="soldier glass fallen">${this.face(f, 'pic', CLASSES[f.cls].color)}
      <span class="body"><span class="nm">${esc(fullName(f))}</span>
      <span class="sub">${RANKS[f.rank].name} · ${CLASSES[f.cls].name}${f.home ? ` · ${esc(f.home)}` : ''}</span>
      <span class="stats">Fell at ${esc(f.where)}. ${f.missions} mission${f.missions === 1 ? '' : 's'}, ${f.kills} kill${f.kills === 1 ? '' : 's'}.</span>
      ${f.medals && f.medals.length ? `<span class="medals">${f.medals.map((m) => medalIcon(m.id, 18)).join('')}</span>` : ''}</span></div>`).join('')}</div>`;
  }

  // ============================================================ one soldier: record, armour, skills
  soldierScreen(camp, s, tab = 'record') {
    this.app.scene?.('soldier', [s], true);
    const cls = CLASSES[s.cls];
    const tabs = [['record', 'Record'], ['armour', 'Armour'], ['skills', 'Skills', perksPending(s) > 0]];
    const body = tab === 'armour' ? this.armourTab(s) : tab === 'skills' ? this.skillsTab(camp, s) : this.recordTab(s);
    const i = camp.roster.indexOf(s);
    this.show(`<div class="wrap">
      <div class="head"><h1><small>${rankName(s)} · ${cls.name}${s.callsign ? ` · "${esc(s.callsign)}"` : ''}</small>${esc(s.name)}</h1></div>
      <div class="tabs">${tabs.map(([k, l, dot]) => `<button class="${k === tab ? 'on' : ''}" data-k="t_${k}">${l}${dot ? '<span class="dot"></span>' : ''}</button>`).join('')}</div>
      ${body}
      <div class="actions-row"><button class="btn" data-k="prev">${ICON.left} Previous</button><button class="btn" data-k="next">Next ${ICON.right}</button><button class="btn fire" data-k="done">Back to the squad</button></div>
    </div>`);
    const keepNames = () => {
      const n = $('#rn'), c = $('#cs');
      if (n && n.value.trim()) s.name = n.value.trim().slice(0, 22);
      if (c && !c.disabled) s.callsign = c.value.trim().slice(0, 12);
    };
    const go = (k) => { keepNames(); this.app.save(); this.soldierScreen(camp, camp.roster[(i + k + camp.roster.length) % camp.roster.length], tab); };
    const h = {
      t_record: () => { keepNames(); this.soldierScreen(camp, s, 'record'); },
      t_armour: () => { keepNames(); this.soldierScreen(camp, s, 'armour'); },
      t_skills: () => { keepNames(); this.soldierScreen(camp, s, 'skills'); },
      prev: () => go(-1), next: () => go(1),
      done: () => { keepNames(); this.app.save(); this.app.view.spin = null; this.base(camp, 'squad'); },
      own0: () => { s.owner = 0; this.app.save(); this.soldierScreen(camp, s, tab); },
      own1: () => { s.owner = 1; this.app.save(); this.soldierScreen(camp, s, tab); },
    };
    // paint changes show at once on the soldier in the hangar
    for (const key of Object.keys(PALETTE)) PALETTE[key].forEach((_, n) => {
      h[`k_${key}_${n}`] = (el) => {
        s.kit = { ...defaultKit(s.cls, s.look), ...(s.kit || {}), [key]: n };
        el.parentElement.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
        el.classList.add('on');
        const rig = this.app.view.rigs.get(this.app.dio && this.app.dio.units[0]);
        if (rig && rig.setKit) rig.setKit(s.kit);
        this.app.save();
      };
    });
    (perksPending(s) > 0 ? perkTier(s) : []).forEach((p) => { h[`p_${p.id}`] = () => { this.app.pickPerk(s, p.id); this.soldierScreen(camp, s, 'skills'); }; });
    this.bind(h);
    for (const id of ['rn', 'cs']) { const el = $('#' + id); if (el) el.onchange = () => { keepNames(); this.app.save(); }; }
  }
  recordTab(s) {
    const r = s.record || {};
    const stats = [['Missions', s.missions], ['Kills', s.kills], ['Accuracy', r.shots ? `${Math.round((r.hits / r.shots) * 100)}%` : '-'], ['Crits', r.crits || 0],
      ['Healed', r.heals || 0], ['Longest kill', r.best ? `${r.best} tiles` : '-'], ['Wounds taken', r.hurt || 0]];
    const locked = s.rank < 1 && !s.callsign;
    return `<div class="panel glass names">
        <div class="field"><label for="rn">Name</label><input id="rn" maxlength="22" value="${esc(s.name)}"></div>
        <div class="field"><label for="cs">Callsign</label><input id="cs" maxlength="12" value="${esc(s.callsign || '')}" ${locked ? 'disabled placeholder="Earned at the first promotion"' : 'placeholder="None yet"'}></div>
      </div>
      ${s.bio ? `<div class="panel glass bio"><p>${esc(bioText(s.bio))}</p></div>` : ''}
      <div class="statgrid">${stats.map(([k, v]) => `<div class="glass"><b>${v}</b><span>${k}</span></div>`).join('')}</div>
      <div class="panel glass"><h2>Medals</h2>${s.medals && s.medals.length ? `<div class="medal-list">${s.medals.map((m) => { const d = medalOf(m.id); return `<div class="md">${medalIcon(m.id, 30)}<span><b>${esc(d.name)}</b><small>${esc(d.desc)} ${esc(m.op)}.</small></span></div>`; }).join('')}</div>` : '<p class="muted">None yet. Medals come from deeds in the field.</p>'}</div>
      ${r.ops && r.ops.length ? `<div class="panel glass"><h2>Operations</h2><table class="roll">${r.ops.map((o) => `<tr><td>${esc(o.name)}</td><td>${o.result === 'won' ? '<span class="chip ok">Won</span>' : '<span class="chip strike">Lost</span>'}${o.status === 'ko' ? ' <span class="chip wounded">Knocked out</span>' : ''}</td><td class="num">${o.kills} kill${o.kills === 1 ? '' : 's'}</td></tr>`).join('')}</table></div>` : ''}`;
  }
  armourTab(s) {
    const k = { ...defaultKit(s.cls, s.look), ...(s.kit || {}) };
    const row = (key, label) => `<div class="opt"><label>${label}</label><div class="sws">${PALETTE[key].map(([n, c], i) => `<button class="sw ${k[key] === i ? 'on' : ''}" data-k="k_${key}_${i}" style="--c:${c}" aria-label="${n}" title="${n}"></button>`).join('')}</div></div>`;
    const seg = (key, label) => `<div class="opt"><label>${label}</label><div class="seg">${PALETTE[key].map((n, i) => `<button class="${k[key] === i ? 'on' : ''}" data-k="k_${key}_${i}">${n}</button>`).join('')}</div></div>`;
    return `<div class="panel glass kit">${row('armour', 'Armour')}${row('trim', 'Trim')}${seg('pattern', 'Paint')}${seg('helmet', 'Helmet')}${row('visor', 'Visor')}${row('suit', 'Undersuit')}
      <p class="muted">The left shoulder always wears the ${CLASSES[s.cls].name.toLowerCase()} colour, so you can tell classes apart in the field.</p></div>`;
  }
  skillsTab(camp, s) {
    const pend = perksPending(s) > 0 ? perkTier(s) : null;
    const tiers = PERKS[s.cls];
    return `<div class="panel glass" style="display:flex;flex-direction:column;gap:12px">
      <p class="muted" style="font-size:15px;color:#cfd5e0">${esc(CLASSES[s.cls].blurb)} XP ${s.xp}${s.rank < RANKS.length - 1 ? ` (next rank at ${RANKS[s.rank + 1].xp})` : ''}.</p>
      ${camp.coop ? `<div class="opt"><label>Commander</label><div class="seg">${[0, 1].map((o) => `<button class="${s.owner === o ? 'on' : ''}" data-k="own${o}">${esc(camp.names[o])}</button>`).join('')}</div></div>` : ''}
      ${pend ? `<div class="opt"><label>Pick a new skill</label></div>${pend.map((p) => `<button class="choice" data-k="p_${p.id}"><b>${esc(p.name)}</b><span>${esc(p.desc)}</span></button>`).join('')}` : ''}
      <div class="opt"><label>Skills by rank</label></div>
      ${tiers.map((tier, i) => `<p class="muted" style="font-size:14px;color:${i < s.perks.length ? 'var(--ink)' : 'var(--dim)'}">${RANKS[i + 1].name}: ${tier.map((p) => (s.perks.includes(p.id) ? `<b>${esc(p.name)}</b>` : esc(p.name))).join(' or ')}</p>`).join('')}
    </div>`;
  }
  // A first promotion comes with a callsign: three ideas from the soldier's class, deeds and past, or the player's own.
  callsignModal(list, done) {
    const s = list[0];
    if (!s) { if (done) done(); return; }
    const ideas = callsignIdeas(s);
    let pick = ideas[0];
    const next = () => { this.closeModal(); this.callsignModal(list.slice(1), done); };
    const draw = () => this.modal(`<h2>New callsign</h2>
      <p>${esc(s.name)} made ${rankName(s)}. In Ember Company a first stripe comes with a callsign. Pick one or write your own.</p>
      ${ideas.map((c) => `<button class="choice ${c === pick ? 'on' : ''}" data-k="c_${esc(c)}"><b>${esc(c)}</b></button>`).join('')}
      <div class="field"><label for="csn">Or write one</label><input id="csn" maxlength="12" placeholder="Callsign"></div>
      <div class="actions-row"><button class="btn" data-k="later">Later</button><button class="btn fire" data-k="ok">Done</button></div>`, {
      ...Object.fromEntries(ideas.map((c) => [`c_${c}`, () => { pick = c; draw(); }])),
      later: next,
      ok: () => { const v = ($('#csn').value || '').trim(); s.callsign = (v || pick).slice(0, 12); this.app.save(); this.app.sfx.rank?.(); next(); },
      dismiss: false,
    });
    draw();
  }

  // A portrait frame for one soldier (anything with a class, look and kit); the image fills in when its render is ready.
  face(who, kind, color) {
    const cls = who.cls || who.kind;
    const k = this.app.portraitKey ? this.app.portraitKey(who) : cls;
    const url = this.app.portraitFor ? this.app.portraitFor(who) : null;
    return `<span class="${kind}"${color ? ` style="--cc:${color}"` : ''}><img data-pk="${k}" ${url ? `src="${url}"` : 'style="opacity:0"'} alt=""><i>${ICON[cls]}</i></span>`;
  }
  portraitsReady(k, url) {
    if (k) document.querySelectorAll(`img[data-pk="${k}"]`).forEach((img) => { img.src = url; img.style.opacity = ''; });
  }
  squadSelect(camp, m) {
    const size = squadSize(camp);
    const avail = ready(camp);
    if (!this.picked || this.picked.mission !== m.id) {
      const order = [...avail].sort((a, b) => b.rank - a.rank);
      const pick = [];
      for (const c of CLASS_IDS) { const s = order.find((x) => x.cls === c && !pick.includes(x)); if (s && pick.length < size) pick.push(s); }
      for (const s of order) if (pick.length < size && !pick.includes(s)) pick.push(s);
      this.picked = { mission: m.id, ids: pick.map((s) => s.id) };
    }
    const ids = this.picked.ids;
    this.app.scene?.('squad', ids.map((id) => camp.roster.find((s) => s.id === id)));
    const bl = missionBlurb(m);
    this.show(`<div class="wrap">
      <div class="head"><h1><small>${esc(bl.where)} · ${esc(bl.title)}</small>${esc(m.name)}</h1>
        <div class="meters"><div class="meter glass"><div class="k">Squad</div><div class="v">${ids.length}/${size}</div></div></div></div>
      <div class="panel glass"><p style="margin:0;color:#cfcab9">${esc(bl.brief)} Tap soldiers to add or remove them.</p></div>
      <div class="grid">${camp.roster.map((s) => {
        const on = ids.includes(s.id), hurt = !!s.wounded;
        return `<button class="soldier glass ${on ? 'pick' : ''} ${hurt ? 'off' : ''}" data-k="t_${s.id}" ${hurt ? 'disabled' : ''}>${this.soldierRow(camp, s)}</button>`;
      }).join('')}</div>
      <div class="actions-row"><button class="btn" data-k="back">Back</button><button class="btn fire" data-k="go" ${ids.length ? '' : 'disabled'}>Launch mission</button></div>
    </div>`);
    const h = { back: () => this.base(camp), go: () => { this.app.sfx.confirm?.(); this.app.launch(m, [...ids]); } };
    camp.roster.forEach((s) => {
      h[`t_${s.id}`] = () => {
        const i = ids.indexOf(s.id);
        if (i >= 0) ids.splice(i, 1);
        else if (ids.length < size) ids.push(s.id);
        this.squadSelect(camp, m);
      };
    });
    this.bind(h);
  }

  debrief(camp, m, d) {
    const back = d.soldiers.filter((s) => s.status !== 'dead').map((s) => camp.roster.find((r) => r.id === s.rid)).filter(Boolean);
    this.app.scene?.('squad', back.length ? back : ['scout']);
    const pend = camp.roster.some((s) => perksPending(s) > 0);
    const fresh = d.soldiers.flatMap((s) => (s.medals || []).map((id) => ({ s, id })));
    const lost = d.soldiers.filter((s) => s.status === 'dead');
    this.show(`<div class="wrap debrief">
      <div class="head"><h1><small>${esc(m.name)}</small><span class="result ${d.win ? 'win' : 'lose'}">${d.win ? 'Mission won' : d.retreated ? 'Retreated' : 'Mission lost'}</span></h1>
        <div class="meters">
          <div class="meter glass"><div class="k">Supplies</div><div class="v">+${d.reward}</div></div>
          <div class="meter glass threat"><div class="k">Enemy grip</div><div class="v">${d.threat > 0 ? '+' : ''}${d.threat}</div></div>
        </div></div>
      <div class="panel glass"><table class="roll"><tr><th>Soldier</th><th>Result</th><th style="text-align:right">Kills</th></tr>
        ${d.soldiers.map((s) => `<tr><td><span class="who">${this.face(s, 'pic', CLASSES[s.cls].color)}<span><span style="color:${CLASSES[s.cls].color}">${esc(fullName(camp.roster.find((r) => r.id === s.rid) || s))}</span><small>${esc(CLASSES[s.cls].name)}</small></span></span></td><td>${s.status === 'dead' ? '<span class="chip strike">Killed</span>' : s.status === 'ko' ? '<span class="chip wounded">Knocked out</span>' : s.status === 'evac' ? '<span class="chip ok">Got out</span>' : '<span class="chip ok">Fine</span>'}
          ${s.promoted ? `<span class="chip perk">Promoted to ${esc(s.promoted)}</span>` : ''}${s.wounded && s.status !== 'dead' ? `<span class="chip wounded">Rest ${s.wounded}</span>` : ''}${(s.medals || []).map((id) => medalIcon(id, 20)).join('')}</td><td class="num">${s.kills}</td></tr>`).join('')}
      </table></div>
      ${fresh.length ? `<div class="panel glass"><h2>Medals</h2><div class="medal-list">${fresh.map(({ s, id }) => `<div class="md">${medalIcon(id, 30)}<span><b>${esc(medalOf(id).name)}</b><small>${esc(fullName(camp.roster.find((r) => r.id === s.rid) || s))}. ${esc(medalOf(id).desc)}</small></span></div>`).join('')}</div></div>` : ''}
      ${lost.length ? `<div class="panel glass"><p class="muted" style="font-size:15px;color:#e9c9c4">${lost.map((s) => esc(fullName(s))).join(' and ')} did not come home. ${lost.length > 1 ? 'Their names go' : 'Their name goes'} on the wall in the hangar.</p></div>` : ''}
      ${pend ? '<div class="panel glass"><p style="margin:0;color:var(--ember-hi)">Some soldiers can pick a new skill. Open the Squad tab.</p></div>' : ''}
      <div class="actions-row"><button class="btn fire" data-k="go">${camp.over ? 'Continue' : 'Back to base'}</button></div>
    </div>`);
    this.bind({ go: () => (camp.over ? this.ending(camp) : this.base(camp, pend ? 'squad' : 'ops')) });
    const due = d.soldiers.filter((x) => x.callsignDue).map((x) => camp.roster.find((r) => r.id === x.rid)).filter((s) => s && !s.callsign);
    if (due.length) setTimeout(() => this.callsignModal(due, () => this.debrief(camp, m, { ...d, soldiers: d.soldiers.map((x) => ({ ...x, callsignDue: false })) })), 900);
  }
  ending(camp) {
    const won = camp.over === 'won';
    this.show(`<div class="title"><div class="logo">${won ? 'THE SPIRE<br><em>IS DOWN</em>' : 'THE LIGHTS<br><em>GO OUT</em>'}</div>
      <div class="tagline">${won ? `You won in ${camp.missions} missions. ${camp.fallen.length ? `${camp.fallen.length} soldiers did not come home.` : 'Every soldier came home.'}` : 'The Pale took too much ground. The Lantern turned for home.'}</div>
      <div class="menu"><button class="btn main" data-k="new">New campaign</button></div></div>`, false);
    this.bind({ new: () => this.newGame() });
  }
}
