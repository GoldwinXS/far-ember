// Far Ember: the people in Ember Company. Bios for new soldiers, callsigns earned on promotion, medals for deeds,
// a service record of every operation, and the short lines soldiers call out in battle.
import { makeRng } from './data.js';

const HOMES = ['Tessaly Reach', 'Low Harrow', 'Cinder Bay', 'Orrin Station', 'Vell', 'Greywater', 'Halcyon Fields', 'Kestrel Moon', 'Saltmarsh', 'New Arden', 'Bramble Point', 'Ostro Ring', 'Fallow', 'Tamsin Deep'];
const BEFORE = ['Ran cargo between the moons', 'Worked as a mining surveyor', 'Grew up on a hydro farm', 'Drove ore haulers in the belt', 'Taught school on a relay station', 'Welded hulls at the docks', 'Flew crop sprayers', 'Served in the colony militia', 'Fixed water pumps for a living', 'Ran a noodle stall at a spaceport', 'Trained as a nurse', 'Repaired comm towers'];
const WHY = ['Joined the week the first world went dark.', 'The Pale took their home town.', 'Followed an older sister into the Company.', 'Wants to see the frontier free again.', 'Says they only came for the food.', 'Owes the Lantern a debt and means to pay it.', 'Signed up on a dare and stayed.'];
const QUIRK = ['Hums when nervous.', 'Keeps a lucky bolt in one pocket.', 'Names every rifle they carry.', 'Writes a letter home after every drop.', 'Never misses breakfast.', 'Can sleep anywhere, even in the dropship.', 'Tells the same three jokes.', 'Collects rocks from every world.', 'Talks to the dropship.', 'Counts everything.'];

export function makeBio(rng = makeRng((Math.random() * 1e9) | 0)) {
  return { home: rng.pick(HOMES), age: rng.int(19, 41), before: rng.pick(BEFORE), why: rng.pick(WHY), quirk: rng.pick(QUIRK) };
}
export const bioText = (b) => (b ? `From ${b.home}, ${b.age} years old. ${b.before}. ${b.why} ${b.quirk}` : '');

// ------------------------------------------------------------ callsigns
const CALLSIGNS = {
  scout: ['Dash', 'Fox', 'Skip', 'Wren', 'Spark', 'Kite', 'Jinx', 'Zip'],
  gunner: ['Anvil', 'Brick', 'Hammer', 'Thunder', 'Ox', 'Boom', 'Tank', 'Rumble'],
  marksman: ['Hawk', 'Needle', 'Ghost', 'Lens', 'Quiet', 'Pin', 'Owl', 'Glint'],
  medic: ['Patch', 'Doc', 'Stitch', 'Saint', 'Kettle', 'Mend', 'Halo', 'Tonic'],
};
// a nickname from the job they had before the Company
const BIO_CALL = [['Ran cargo', 'Cargo'], ['Worked as a mining', 'Dusty'], ['Grew up on a hydro', 'Sprout'], ['Drove ore', 'Hauler'], ['Taught school', 'Teach'], ['Welded', 'Sparks'],
  ['Flew crop', 'Duster'], ['Served in the colony', 'Sarge'], ['Fixed water', 'Pipes'], ['Ran a noodle', 'Noodle'], ['Trained as a nurse', 'Nurse'], ['Repaired comm', 'Static']];
// Three suggestions: one from the soldier's class, one from their record, one from the bio.
export function callsignIdeas(s) {
  const r = s.record || {};
  const rng = makeRng((s.id || 1) * 7919 + (s.missions || 0));
  const out = new Set([rng.pick(CALLSIGNS[s.cls] || CALLSIGNS.scout)]);
  if ((s.kills || 0) >= 4) out.add(rng.pick(['Tally', 'Reaper', 'Count', 'Notch']));
  else if ((r.hurt || 0) >= 4) out.add(rng.pick(['Lucky', 'Scrap', 'Patches', 'Dent']));
  else if ((r.crits || 0) >= 2) out.add(rng.pick(['Bullseye', 'Ace', 'Spike']));
  else if ((r.best || 0) >= 10) out.add(rng.pick(['Far', 'Longbow', 'Reach']));
  const fromBio = s.bio && BIO_CALL.find(([k]) => s.bio.before.startsWith(k));
  if (fromBio) out.add(fromBio[1]);
  for (const c of CALLSIGNS[s.cls] || []) { if (out.size >= 3) break; out.add(c); }
  return [...out].slice(0, 3);
}
// "Mara 'Kettle' Osei", or the plain name before a callsign is earned.
export const fullName = (s) => (s.callsign ? `${s.name.split(' ')[0]} "${s.callsign}" ${s.name.split(' ').slice(1).join(' ')}` : s.name);
export const shortName = (s) => s.callsign || s.name.split(' ')[0];

// ------------------------------------------------------------ medals
// test(soldier, mission result line, mission) runs after the mission; each medal is awarded once.
export const MEDALS = [
  { id: 'first', name: 'First Blood', desc: 'Their first kill.', colour: '#c9cfd6', test: (s, r) => r.kills > 0 && s.kills === r.kills },
  { id: 'star', name: 'Ember Star', desc: 'Three kills in one mission.', colour: '#ff8a3d', test: (s, r) => r.kills >= 3 },
  { id: 'eye', name: 'Long Eye', desc: 'A kill from 12 tiles or more.', colour: '#5ae0ff', test: (s, r) => (r.st?.best || 0) >= 12 },
  { id: 'steady', name: 'Steady Hand', desc: 'Hit every shot in a mission, four or more.', colour: '#9dd96a', test: (s, r) => (r.st?.shots || 0) >= 4 && r.st.hits === r.st.shots },
  { id: 'iron', name: 'Iron Will', desc: 'Finished a mission on 1 health.', colour: '#b8b2a4', test: (s, r) => r.status === 'ok' && r.hp === 1 },
  { id: 'cross', name: 'Lifeline Cross', desc: 'Healed 8 health in one mission.', colour: '#e8e2d2', test: (s, r) => (r.st?.heals || 0) >= 8 },
  { id: 'scar', name: 'Scar Badge', desc: 'Knocked out and came back.', colour: '#c7372f', test: (s, r) => r.status === 'ko' },
  { id: 'service', name: 'Long Service', desc: 'Ten missions with the Company.', colour: '#d9a743', test: (s) => s.missions >= 10 },
  { id: 'spire', name: 'Spire Breaker', desc: 'Was there when the Spire fell.', colour: '#b58cff', test: (s, r, m) => m.type === 'final' && r.status !== 'dead' },
];
export const medalOf = (id) => MEDALS.find((m) => m.id === id);
// A small ribbon-and-disc medal in the medal's colour.
export function medalIcon(id, size = 26) {
  const m = medalOf(id) || MEDALS[0];
  return `<svg class="medal" viewBox="0 0 24 32" width="${size * 0.75}" height="${size}" aria-hidden="true"><path d="M5 1h14l-3 12H8z" fill="${m.colour}" opacity=".55"/><path d="M10 1h4l-1 12h-2z" fill="#0b1018" opacity=".5"/><circle cx="12" cy="21" r="8" fill="${m.colour}"/><circle cx="12" cy="21" r="5.2" fill="none" stroke="#0b1018" stroke-opacity=".45" stroke-width="1.4"/><path d="M12 16.6l1.3 2.9 3.1.3-2.4 2 .8 3-2.8-1.6-2.8 1.6.8-3-2.4-2 3.1-.3z" fill="#0b1018" fill-opacity=".55"/></svg>`;
}

// ------------------------------------------------------------ the service record
export function newRecord() { return { shots: 0, hits: 0, crits: 0, heals: 0, hurt: 0, best: 0, ops: [] }; }
// Add one mission to a soldier's record and award any medals they earned. Returns the new medal ids.
export function recordMission(s, r, mission, won) {
  s.record ||= newRecord();
  const st = r.st || {};
  const rec = s.record;
  rec.shots += st.shots || 0; rec.hits += st.hits || 0; rec.crits += st.crits || 0; rec.heals += st.heals || 0; rec.hurt += st.hurt || 0;
  rec.best = Math.max(rec.best, Math.round(st.best || 0));
  rec.ops.unshift({ name: mission.name, result: won ? 'won' : 'lost', kills: r.kills, status: r.status });
  rec.ops.length = Math.min(rec.ops.length, 14);
  s.medals ||= [];
  const fresh = [];
  for (const m of MEDALS) if (!s.medals.some((x) => x.id === m.id) && m.test(s, r, mission)) { s.medals.push({ id: m.id, op: mission.name }); fresh.push(m.id); }
  return fresh;
}

// ------------------------------------------------------------ barks
const LINES = {
  shoot: ['Taking the shot.', 'Firing.', 'I have it.'],
  kill: ['Got one!', 'Target down.', 'That one is done.', 'Scratch one.'],
  miss: ['Missed!', 'It moved!', 'Not this time.'],
  crit: ['Clean hit!', 'Right on target.'],
  hurt: ["I'm hit!", 'Took one. Still going.', 'Ow!'],
  low: ['I need a medic!', "I'm in bad shape here."],
  ally: ['{name} is down!', 'We lost {name}!', 'Man down! {name}!'],
  spotted: ['Contact!', 'Pale, up ahead!', 'Eyes on them.'],
  heal: ['Hold still.', 'Patching you up.', 'This will sting.'],
  watch: ['Watching.', 'I have this lane.', 'Let them come.'],
  reload: ['Reloading.', 'Swapping mags.'],
  grenade: ['Grenade out!', 'Heads down!'],
  evac: ['Getting out.', 'See you on the Lantern.'],
  move: ['Moving.', 'On my way.', 'Going.'],
};
export function barkLine(kind, vars = {}) {
  const list = LINES[kind];
  if (!list) return null;
  return list[Math.floor(Math.random() * list.length)].replace('{name}', vars.name || 'them');
}
