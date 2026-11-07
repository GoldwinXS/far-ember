// Ember Squad: static game data. Plain values only, no logic beyond small helpers.

export function makeRng(seed) {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.int = (a, b) => a + Math.floor(r() * (b - a + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  r.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  return r;
}

export const RANKS = [
  { name: 'Recruit', short: 'RCT', xp: 0 },
  { name: 'Private', short: 'PVT', xp: 3 },
  { name: 'Corporal', short: 'CPL', xp: 8 },
  { name: 'Sergeant', short: 'SGT', xp: 15 },
  { name: 'Lieutenant', short: 'LT', xp: 24 },
  { name: 'Captain', short: 'CPT', xp: 35 },
  { name: 'Major', short: 'MAJ', xp: 48 },
];
// Ranks that grant +1 health (aim goes up +3 at every rank).
export const HP_RANKS = [2, 4, 6];

export const CLASSES = {
  scout: {
    name: 'Scout', hp: 5, aim: 66, move: 7, weapon: 'shotgun', grenades: 1, color: '#f08a45',
    blurb: 'Moves far. The shotgun hits hard up close.',
    ability: 'rush',
  },
  gunner: {
    name: 'Gunner', hp: 6, aim: 62, move: 5, weapon: 'mg', grenades: 2, color: '#a6c94e',
    blurb: 'Tough. Carries a rocket and two grenades.',
    ability: 'rocket',
  },
  marksman: {
    name: 'Marksman', hp: 4, aim: 74, move: 5, weapon: 'longrifle', grenades: 1, color: '#5cb3ea',
    blurb: 'Best aim. Wants to shoot from far away.',
    ability: 'steady',
  },
  medic: {
    name: 'Medic', hp: 5, aim: 64, move: 6, weapon: 'rifle', grenades: 1, color: '#ece6d4',
    blurb: 'Heals the squad and throws smoke.',
    ability: 'medkit',
  },
};
export const CLASS_IDS = ['scout', 'gunner', 'marksman', 'medic'];

// Every soldier has 3 actions a turn. Moving costs 1 action for each stretch of ground; guns cost what their
// weight says. ap: actions per shot by shot this turn (the last entry repeats). rolls: shots in one trigger pull.
export const AP_MAX = 3;
// Overwatch is aimed as an arc: this wide either side of its line, reaching between min and max tiles.
export const ARC = { half: 0.61, min: 3, max: 12 };

// range(d): aim change at distance d (tiles).
export const WEAPONS = {
  rifle: { name: 'Rifle', dmg: [3, 4], clip: 4, crit: 10, ap: [1, 2], note: '1 action a shot. A second shot this turn costs 2.', range: (d) => (d <= 4 ? 10 : d <= 9 ? 0 : -(d - 9) * 5) },
  shotgun: { name: 'Shotgun', dmg: [3, 5], clip: 3, crit: 20, ap: [1], note: '1 action a shot. Move and fire all turn.', range: (d) => (d <= 2 ? 30 : d <= 4 ? 15 : d <= 6 ? 0 : -(d - 6) * 8) },
  mg: { name: 'Machine gun', dmg: [2, 4], clip: 3, crit: 5, ap: [3], rolls: 3, note: 'A burst of 3 shots. Takes the whole turn.', range: (d) => (d <= 5 ? 5 : d <= 10 ? 0 : -(d - 10) * 5) },
  longrifle: { name: 'Long rifle', dmg: [4, 6], clip: 3, crit: 25, ap: [2], note: '2 actions a shot.', range: (d) => (d <= 3 ? -20 : d <= 6 ? -5 : 10) },
  pale: { name: 'Lance', dmg: [2, 4], clip: 99, crit: 10, range: (d) => (d <= 4 ? 10 : d <= 10 ? 0 : -(d - 10) * 5) },
};

export const ENEMIES = {
  husk: { name: 'Husk', hp: 4, aim: 62, move: 5, dmg: [2, 4], def: 0, armour: 0, ai: 'shooter', ideal: 7,
    blurb: 'Basic soldier. Takes cover and shoots.' },
  drone: { name: 'Drone', hp: 3, aim: 58, move: 7, dmg: [1, 3], def: 10, armour: 0, ai: 'flanker', fly: true, ideal: 5,
    blurb: 'Small and fast. Flies around your cover.' },
  stalker: { name: 'Stalker', hp: 6, aim: 80, move: 8, dmg: [3, 5], def: 10, armour: 0, ai: 'melee', ideal: 1,
    blurb: 'Runs at you and claws. Cover does not help.' },
  warden: { name: 'Warden', hp: 7, aim: 62, move: 5, dmg: [2, 4], def: 5, armour: 0, ai: 'support', ideal: 8,
    blurb: 'Puts shields on other enemies.' },
  brute: { name: 'Brute', hp: 11, aim: 58, move: 4, dmg: [4, 6], def: 0, armour: 1, ai: 'shooter', ideal: 5,
    blurb: 'Big and armoured. Armour blocks 1 damage per hit.' },
  overseer: { name: 'Overseer', hp: 24, aim: 70, move: 3, dmg: [5, 7], def: 5, armour: 2, ai: 'boss', ideal: 8,
    blurb: 'Their leader. Calls in drones.' },
};

// Pod make-up by act (0 = early). Each entry: [type, weight].
export const POD_TABLE = [
  [['husk', 6], ['drone', 3]],
  [['husk', 5], ['drone', 3], ['stalker', 2], ['warden', 2]],
  [['husk', 4], ['drone', 2], ['stalker', 3], ['warden', 2], ['brute', 2]],
  [['husk', 3], ['drone', 2], ['stalker', 3], ['warden', 2], ['brute', 3]],
];

function P(id, name, desc) { return { id, name, desc }; }

// Three tiers, two choices each. Tier n unlocks at rank n (Private, Corporal, Sergeant).
export const PERKS = {
  scout: [
    [P('quickfeet', 'Quick Feet', '+2 move.'), P('pointblank', 'Point Blank', '+15 aim at targets 4 tiles away or closer.')],
    [P('hitrun', 'Hit and Run', 'A kill gives back one action. Once per turn.'), P('slippery', 'Slippery', 'Enemy overwatch shots at this soldier get -30 aim.')],
    [P('finisher', 'Finisher', '+25 aim against targets at half health or less.'), P('untouchable', 'Untouchable', 'After a kill, the next enemy shot at this soldier misses.')],
  ],
  gunner: [
    [P('extrabang', 'Extra Grenade', 'Carry one more grenade.'), P('spotter', 'Spotter', 'Your shots mark the target. The squad gets +15 aim against it this turn.')],
    [P('shred', 'Shredder', 'Your shots ignore armour and strip 1 armour off.'), P('bigboom', 'Big Boom', 'Your grenades and rockets hit a wider area.')],
    [P('rapid', 'Rapid Burst', 'New action: a burst for 2 actions, so you can move first. Ready every 3 turns.'), P('tough', 'Tough', '+3 health.')],
  ],
  marksman: [
    [P('longshot', 'Long Shot', 'Shoot any enemy a squadmate can see.'), P('steadyhands', 'Steady Hands', '+10 aim if you have not moved this turn.')],
    [P('deadeye', 'Deadeye', '+15 crit chance.'), P('sharpwatch', 'Sharp Watch', 'Your overwatch shots have no aim penalty.')],
    [P('headshot', 'Headshot', 'Crits deal +3 damage.'), P('followup', 'Follow Through', 'A kill gives back one action. Once per turn.')],
  ],
  medic: [
    [P('surgeon', 'Field Surgeon', 'Medkits heal 2 more.'), P('extrakit', 'Extra Medkit', 'Carry one more medkit.')],
    [P('reach', 'Long Reach', 'Heal soldiers up to 6 tiles away.'), P('thicksmoke', 'Thick Smoke', 'Your smoke gives +40 defence instead of +20.')],
    [P('guardian', 'Guardian', 'Overwatch gets one more shot.'), P('lifeline', 'Lifeline', 'Once per mission, a soldier who would die stays at 1 health.')],
  ],
};

export const UPGRADES = [
  { id: 'scopes', name: 'Scopes', desc: '+5 aim for every soldier.', cost: 90 },
  { id: 'weapons1', name: 'Heavy Rounds', desc: '+1 damage on every gun.', cost: 120 },
  { id: 'armour1', name: 'Plate Vests', desc: '+2 health for every soldier.', cost: 120 },
  { id: 'pockets', name: 'Grenade Pouches', desc: 'Every soldier carries one more grenade.', cost: 90 },
  { id: 'medkits', name: 'Medical Crate', desc: 'Medics carry one more medkit.', cost: 60 },
  { id: 'squad5', name: 'Fifth Seat', desc: 'Take 5 soldiers on missions.', cost: 150 },
  { id: 'weapons2', name: 'Pulse Rounds', desc: '+1 more damage on every gun.', cost: 240, req: 'weapons1' },
  { id: 'armour2', name: 'Ember Plate', desc: '+2 more health for every soldier.', cost: 240, req: 'armour1' },
  { id: 'squad6', name: 'Sixth Seat', desc: 'Take 6 soldiers on missions.', cost: 260, req: 'squad5' },
];

export const RECRUIT_COST = 40;
export const WINS_FOR_FINAL = 8;
export const THREAT_MAX = 12;

export const DIFFICULTY = {
  relaxed: { name: 'Relaxed', desc: 'Soldiers get knocked out instead of dying. Enemies aim worse.', hp: 2, aim: 5, enemyAim: -8, enemyHp: 0, ko: true },
  classic: { name: 'Classic', desc: 'The real thing. Fallen soldiers are gone for good.', hp: 0, aim: 0, enemyAim: 0, enemyHp: 0, ko: false },
  hard: { name: 'Hard', desc: 'Tougher enemies and more of them.', hp: 0, aim: 0, enemyAim: 5, enemyHp: 1, ko: false, extraPod: true },
};

export const FIRST_NAMES = [
  'Ada', 'Ben', 'Cass', 'Dana', 'Eli', 'Faye', 'Gus', 'Hana', 'Ivan', 'Jo', 'Kai', 'Lena', 'Milo', 'Nia', 'Owen',
  'Pia', 'Quinn', 'Rosa', 'Sam', 'Tess', 'Uma', 'Vic', 'Wade', 'Yara', 'Zack', 'Abe', 'Bea', 'Cole', 'Dot', 'Ezra',
  'Finn', 'Gwen', 'Hugo', 'Isla', 'Jack', 'Kira', 'Leo', 'Maya', 'Ned', 'Olga', 'Pete', 'Rhea', 'Sol', 'Theo',
  'Una', 'Vera', 'Will', 'Xena', 'Yuri', 'Zoe', 'Amir', 'Bo', 'Chen', 'Dev', 'Emi', 'Femi', 'Gita', 'Hal', 'Ines',
];
export const LAST_NAMES = [
  'Abara', 'Bishop', 'Cruz', 'Dubois', 'Engel', 'Fox', 'Garza', 'Hale', 'Ito', 'Jansen', 'Kowal', 'Lund', 'Moreau',
  'Novak', 'Okafor', 'Park', 'Quist', 'Reyes', 'Sato', 'Tran', 'Ueda', 'Vance', 'Walsh', 'Xu', 'Young', 'Zane',
  'Archer', 'Brandt', 'Cole', 'Dunn', 'Evans', 'Ford', 'Grey', 'Holt', 'Iqbal', 'Jones', 'Kerr', 'Lowe', 'Mills',
  'Nash', 'Ortiz', 'Price', 'Rowe', 'Shaw', 'Tate', 'Usher', 'Voss', 'Webb', 'Yates', 'Ziegler', 'Adeyemi', 'Silva',
];
export const SKIN = ['#f1c9a5', '#e0ac7e', '#c68b59', '#a26a42', '#7c4f2f', '#5a3a24'];

export const OP_WORDS_A = ['Quiet', 'Iron', 'Red', 'Long', 'Cold', 'Broken', 'Silver', 'High', 'Low', 'Black', 'Bright', 'Last', 'Green', 'Stone', 'Grey', 'Open', 'Hollow', 'Swift', 'North', 'South'];
export const OP_WORDS_B = ['Harbour', 'Lantern', 'Anvil', 'River', 'Gate', 'Hammer', 'Bridge', 'Orchard', 'Tower', 'Field', 'Road', 'Hill', 'Market', 'Spark', 'Pine', 'Badger', 'Kettle', 'Compass', 'Ridge', 'Mill'];

export const BIOMES = {
  town: { name: 'Colony' },
  farm: { name: 'Farmland' },
  yard: { name: 'Cargo port' },
  spire: { name: 'The Spire' },
};

export const MISSION_TYPES = {
  sweep: { name: 'Clear out', brief: 'Find and kill every enemy in the area.' },
  recover: { name: 'Grab the cache', brief: 'Pick up the data cache, carry it to the green zone, then evacuate.' },
  final: { name: 'The Spire', brief: 'Kill the Overseer. Everything else is optional.' },
};
