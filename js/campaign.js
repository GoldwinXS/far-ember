// Ember Squad: the campaign between missions. Roster, missions on offer, rewards, ranks and wounds.
import {
  makeRng, RANKS, CLASS_IDS, PERKS, UPGRADES, FIRST_NAMES, LAST_NAMES, SKIN, OP_WORDS_A, OP_WORDS_B,
  WINS_FOR_FINAL, THREAT_MAX, RECRUIT_COST, MISSION_TYPES, BIOMES,
} from './data.js';
import { defaultKit } from './armour.js';
import { makeBio, newRecord, recordMission } from './service.js';

// the frontier worlds the Pale have taken, named on each mission
const WORLDS = ['Vell', 'Tessaly Reach', 'Cinder Bay', 'Low Harrow', 'Greywater', 'Kestrel Moon', 'Halcyon', 'New Arden', 'Ostro', 'Fallow', 'Bramble Point', 'Saltmarsh'];

export function newCampaign({ difficulty }) {
  const seed = (Math.random() * 1e9) | 0;
  const camp = {
    v: 1, seed, difficulty,
    supplies: 160, threat: 0, wins: 0, missions: 0, nextId: 1, round: 0,
    roster: [], fallen: [], upgrades: {}, offers: [], battle: null, created: Date.now(),
  };
  const rng = makeRng(seed);
  CLASS_IDS.forEach((cls, i) => {
    for (let k = 0; k < 2; k++) {
      const s = makeSoldier(camp, cls, rng);
      camp.roster.push(s);
    }
  });
  camp.offers = makeOffers(camp);
  return camp;
}

export function makeSoldier(camp, cls, rng = makeRng((Math.random() * 1e9) | 0)) {
  // first names stay unique so the squad cards (which show first names) never repeat
  const taken = new Set(camp.roster.map((s) => s.name.split(' ')[0]));
  let first = rng.pick(FIRST_NAMES);
  for (let i = 0; i < 40 && taken.has(first); i++) first = rng.pick(FIRST_NAMES);
  const name = `${first} ${rng.pick(LAST_NAMES)}`;
  // look cycles per class so the first squad gets four different looks; the kit starts from it
  const look = (camp.roster.filter((r) => r.cls === cls).length + CLASS_IDS.indexOf(cls)) % 4;
  return {
    id: camp.nextId++, name, cls, skin: rng.pick(SKIN), look,
    rank: 0, xp: 0, kills: 0, missions: 0, perks: [], wounded: 0, owner: 0,
    callsign: '', kit: defaultKit(cls, look), bio: makeBio(rng), record: newRecord(), medals: [],
  };
}
// Older saves: give every soldier and every name on the wall what newer ones carry.
export function upgradeSave(camp) {
  if (!camp) return camp;
  const rng = makeRng(camp.seed || 1);
  // one commander only now: old two-commander saves hand every soldier to the one player
  delete camp.coop;
  delete camp.names;
  if (camp.battle && camp.battle.units) for (const u of camp.battle.units) u.owner = 0;
  for (const s of camp.roster) {
    s.owner = 0;
    s.callsign ??= '';
    s.kit ||= defaultKit(s.cls, s.look ?? 0);
    s.bio ||= makeBio(rng);
    s.record ||= newRecord();
    s.medals ||= [];
  }
  for (const f of camp.fallen) f.medals ||= [];
  return camp;
}

export const rankName = (s) => RANKS[s.rank].name;
export const perksPending = (s) => Math.min(3, s.rank) - s.perks.length;
export const perkTier = (s) => PERKS[s.cls][s.perks.length];

export function squadSize(camp) {
  return camp.upgrades.squad6 ? 6 : camp.upgrades.squad5 ? 5 : 4;
}
export function ready(camp) {
  return camp.roster.filter((s) => !s.wounded);
}
export function act(camp) {
  return camp.wins >= WINS_FOR_FINAL ? 3 : camp.wins >= 5 ? 2 : camp.wins >= 2 ? 1 : 0;
}

export function makeOffers(camp) {
  camp.round = (camp.round || 0) + 1;
  const rng = makeRng(camp.seed + camp.round * 977);
  if (camp.wins >= WINS_FOR_FINAL) {
    return [{ id: `m${camp.round}f`, name: 'Operation Last Light', biome: 'spire', type: 'final', diff: 3, reward: 0, seed: rng.int(1, 1e8), time: 'dusk', act: 3, strike: false }];
  }
  const biomes = rng.shuffle(['town', 'farm', 'yard', rng.pick(['town', 'farm', 'yard'])]);
  const diffs = rng.shuffle([1, 2, 3]);
  const strikeSlot = camp.round % 3 === 0 ? rng.int(0, 2) : -1;
  const used = new Set();
  return [0, 1, 2].map((i) => {
    const type = rng() < 0.55 ? 'sweep' : 'recover';
    const strike = i === strikeSlot;
    const diff = strike ? 3 : diffs[i];
    return {
      id: `m${camp.round}${i}`,
      name: (() => { let n; do n = `Operation ${rng.pick(OP_WORDS_A)} ${rng.pick(OP_WORDS_B)}`; while (used.has(n)); used.add(n); return n; })(),
      biome: biomes[i], type, diff, strike,
      reward: 50 + diff * 30 + rng.int(0, 4) * 5 + (type === 'recover' ? 25 : 0) + (strike ? 30 : 0),
      seed: rng.int(1, 1e8),
      time: rng.pick(['day', 'day', 'dusk', 'night']),
      world: rng.pick(WORLDS),
      act: act(camp),
    };
  });
}

export function missionBlurb(m) {
  const where = m.world ? `${m.world} ${BIOMES[m.biome].name.toLowerCase()}` : BIOMES[m.biome].name;
  const t = MISSION_TYPES[m.type];
  return { where, title: t.name, brief: t.brief };
}

// Apply a finished mission. Returns a debrief the UI can show.
export function applyResult(camp, mission, res) {
  const out = { win: res.win, retreated: res.retreated, reward: 0, threat: 0, soldiers: [], strike: mission.strike };
  const deployed = new Set(res.soldiers.map((s) => s.rid));
  for (const s of camp.roster) if (!deployed.has(s.id) && s.wounded) s.wounded--;
  for (const r of res.soldiers) {
    const s = camp.roster.find((x) => x.id === r.rid);
    if (!s) continue;
    const line = { id: s.id, rid: s.id, name: s.name, callsign: s.callsign, cls: s.cls, look: s.look, kit: s.kit, kills: r.kills, status: r.status, promoted: false, wounded: 0, medals: [] };
    s.missions++;
    s.kills += r.kills;
    line.medals = recordMission(s, r, mission, res.win);
    if (r.status === 'dead') {
      camp.roster = camp.roster.filter((x) => x !== s);
      camp.fallen.push({ id: s.id, name: s.name, callsign: s.callsign, cls: s.cls, rank: s.rank, kills: s.kills, missions: s.missions, where: mission.name, medals: s.medals, kit: s.kit, look: s.look, home: s.bio?.home || '' });
      out.soldiers.push(line);
      continue;
    }
    s.xp += r.kills * 2 + 1 + (res.win ? 1 : 0);
    if (r.status === 'ko') s.wounded = 3;
    else if (r.hp < r.maxHp) s.wounded = Math.ceil((r.maxHp - r.hp) / 2);
    line.wounded = s.wounded;
    while (s.rank < RANKS.length - 1 && s.xp >= RANKS[s.rank + 1].xp) {
      s.rank++;
      line.promoted = RANKS[s.rank].name;
    }
    // the first promotion earns a callsign; the debrief asks for one
    line.callsignDue = !s.callsign && s.rank >= 1;
    out.soldiers.push(line);
  }
  camp.missions++;
  out.threat = res.retreated ? 1 : res.win ? 1 : 2;
  if (res.win && mission.strike) out.threat = -2;
  camp.threat = Math.max(0, camp.threat + out.threat);
  if (res.win) {
    camp.wins++;
    out.reward = mission.reward;
    camp.supplies += mission.reward;
  } else {
    out.reward = res.retreated ? 0 : 15;
    camp.supplies += out.reward;
  }
  camp.battle = null;
  camp.current = null;
  if (mission.type === 'final' && res.win) camp.over = 'won';
  else if (camp.threat >= THREAT_MAX) camp.over = 'lost';
  else if (!camp.roster.length) camp.over = 'lost';
  camp.offers = makeOffers(camp);
  // a squad that dwindles gets a free rookie so the game can go on
  while (camp.roster.length < 4) camp.roster.push(makeSoldier(camp, CLASS_IDS[camp.roster.length % 4]));
  // never leave the player without anyone fit to deploy
  while (ready(camp).length < 2) camp.roster.push(makeSoldier(camp, CLASS_IDS[camp.roster.length % 4]));
  return out;
}

export function buyUpgrade(camp, id) {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u || camp.upgrades[id] || camp.supplies < u.cost || (u.req && !camp.upgrades[u.req])) return false;
  camp.supplies -= u.cost;
  camp.upgrades[id] = true;
  return true;
}
export function recruit(camp, cls) {
  if (camp.supplies < RECRUIT_COST) return null;
  camp.supplies -= RECRUIT_COST;
  const s = makeSoldier(camp, cls);
  camp.roster.push(s);
  return s;
}
export function choosePerk(s, perkId) {
  if (perksPending(s) <= 0) return false;
  if (!perkTier(s).some((p) => p.id === perkId)) return false;
  s.perks.push(perkId);
  return true;
}
export { THREAT_MAX, WINS_FOR_FINAL, RECRUIT_COST };
