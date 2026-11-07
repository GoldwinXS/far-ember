// Far Ember: sound. Recorded CC0 samples (Kenney) for effects, CC0 orchestral and space tracks (OpenGameArt) for music.
// Effects are decoded once into buffers and played with a random variant and a little pitch drift; music streams
// through two <audio> elements routed into Web Audio (iPad ignores element.volume) so tracks can crossfade.
let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null, muted = false;
const BASE = new URL('../assets/audio/', import.meta.url).href;
const bank = new Map(); // name -> [AudioBuffer]
let manifest = null;
const last = new Map(); // name -> last start time, so a burst of the same sound does not stack into a roar

function init() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); primeMusic(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.85; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.42; musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    loadBank();
    primeMusic();
  } catch (e) { ctx = null; }
}

async function loadBank() {
  try { manifest = await (await fetch(BASE + 'manifest.json')).json(); } catch { return; }
  // the small interface and weapon sounds first, so the first click and shot are real samples
  const order = Object.keys(manifest.sfx).sort((a, b) => (b.startsWith('ui') || b.startsWith('blast')) - (a.startsWith('ui') || a.startsWith('blast')));
  for (const name of order) {
    const bufs = [];
    await Promise.all(Array.from({ length: manifest.sfx[name] }, async (_, i) => {
      try {
        const ab = await (await fetch(`${BASE}sfx/${name}_${i}.mp3`)).arrayBuffer();
        bufs[i] = await new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej));
      } catch { /* a missing variant is skipped */ }
    }));
    const ok = bufs.filter(Boolean);
    if (ok.length) bank.set(name, ok);
  }
}

// Play a sample. Returns false when it is not loaded yet, so callers can fall back to the synth.
function play(name, { gain = 1, rate = 1, drift = 0.06, delay = 0, gap = 0.03 } = {}) {
  if (!ctx || muted) return true;
  const bufs = bank.get(name);
  if (!bufs) return false;
  const now = ctx.currentTime + delay;
  if (now - (last.get(name) ?? -1) < gap) return true;
  last.set(name, now);
  const src = ctx.createBufferSource();
  src.buffer = bufs[Math.floor(Math.random() * bufs.length)];
  src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * 2 * drift);
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g); g.connect(sfxBus);
  src.start(now);
  return true;
}

// ------------------------------------------------------------ music
const decks = [];
let deckOn = 0, track = null;
function primeMusic() {
  if (!ctx || decks.length) return;
  for (let i = 0; i < 2; i++) {
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.loop = true;
    el.setAttribute('playsinline', '');
    const g = ctx.createGain();
    g.gain.value = 0;
    try { ctx.createMediaElementSource(el).connect(g); } catch { /* already wired */ }
    g.connect(musicBus);
    decks.push({ el, g });
  }
  if (track) { const t = track; track = null; music(t); }
}
// Crossfade to a track by name ('base', 'battle', 'tension', 'final', 'spire', 'carrier'), or null for silence.
function music(name, { fade = 2.2, loop = true } = {}) {
  if (name === track) return;
  track = name;
  if (!ctx || !decks.length) return; // primeMusic plays it once the first tap unlocks audio
  const t = ctx.currentTime;
  const out = decks[deckOn];
  out.g.gain.cancelScheduledValues(t);
  out.g.gain.setValueAtTime(out.g.gain.value, t);
  out.g.gain.linearRampToValueAtTime(0, t + fade);
  setTimeout(() => { if (decks[deckOn] !== out) out.el.pause(); }, fade * 1000 + 100);
  if (!name) return;
  deckOn = 1 - deckOn;
  const inn = decks[deckOn];
  inn.el.loop = loop;
  inn.el.src = `${BASE}music/${name}.mp3`;
  inn.el.currentTime = 0;
  inn.el.play().catch(() => {});
  inn.g.gain.cancelScheduledValues(t);
  inn.g.gain.setValueAtTime(0, t);
  inn.g.gain.linearRampToValueAtTime(1, t + fade);
}

// ------------------------------------------------------------ synth fallbacks (used until samples load)
function noise(dur, { f = 1000, q = 1, type = 'bandpass', gain = 1, attack = 0.002, sweep = 0, delay = 0 } = {}) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.frequency.setValueAtTime(f, t);
  if (sweep) filt.frequency.exponentialRampToValueAtTime(Math.max(40, f * sweep), t + dur);
  filt.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt); filt.connect(g); g.connect(sfxBus);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}
function tone(freq, dur, { type = 'sine', gain = 0.3, to = 0, delay = 0 } = {}) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(sfxBus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const sfx = {
  init,
  play,
  music,
  setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.9; },
  get muted() { return muted; },
  click() { play('uiClick', { gain: 0.7, drift: 0.02 }) || tone(1400, 0.04, { type: 'triangle', gain: 0.08 }); },
  select() { play('uiSelect', { gain: 0.7, drift: 0.02 }) || this.click(); },
  confirm() { play('uiConfirm', { gain: 0.8, drift: 0 }) || this.click(); },
  back() { play('uiBack', { gain: 0.7, drift: 0 }) || this.click(); },
  open() { play('uiOpen', { gain: 0.6, drift: 0 }) || this.click(); },
  error() { play('uiError', { gain: 0.6, drift: 0 }) || tone(220, 0.15, { type: 'square', gain: 0.06 }); },
  shot(kind) {
    // blaster bolts: light rifles, heavy guns and the Pale's crystal weapons each have their own voice
    if (kind === 'pale') { if (play('alienShot', { gain: 0.8, rate: 0.85 })) return; }
    else if (kind === 'heavy' || kind === 'mg' || kind === 'longrifle') {
      const n = kind === 'mg' ? 3 : 1;
      let ok = true;
      for (let i = 0; i < n; i++) ok = play('blasterHeavy', { gain: kind === 'longrifle' ? 1 : 0.75, rate: kind === 'longrifle' ? 0.8 : 1, delay: i * 0.08, gap: 0 }) && ok;
      if (ok) return;
    } else {
      const n = kind === 'shotgun' ? 1 : 2;
      let ok = true;
      for (let i = 0; i < n; i++) ok = play('blaster', { gain: kind === 'shotgun' ? 1 : 0.75, rate: kind === 'shotgun' ? 0.7 : 1, delay: i * 0.1, gap: 0 }) && ok;
      if (ok) return;
    }
    noise(0.25, { f: 1300, q: 0.6, gain: 0.7, sweep: 0.25 });
  },
  // a near miss or a stray bolt in the background: quieter and further away
  distantShot(pale) { play(pale ? 'alienShot' : 'blaster', { gain: 0.22, rate: 0.9, gap: 0.08 }); },
  hit(armour) { play(armour ? 'hitArmour' : 'hitFlesh', { gain: 0.8 }) || noise(0.12, { f: 500, q: 2, gain: 0.35 }); },
  miss() { play('ricochet', { gain: 0.35, gap: 0.06 }); },
  boom() {
    if (play('explosion', { gain: 1 })) { play('boomLow', { gain: 0.9, drift: 0.02 }); play('debris', { gain: 0.4, delay: 0.35 }); return; }
    noise(1.6, { f: 900, type: 'lowpass', gain: 1.2, sweep: 0.06 });
    tone(70, 0.9, { type: 'sine', gain: 0.6, to: 30 });
  },
  death(side) { if (side === 'pale') play('alienShot', { gain: 0.4, rate: 0.5 }) || tone(300, 0.6, { type: 'sawtooth', gain: 0.06, to: 60 }); },
  alert() { play('computer', { gain: 0.6, drift: 0 }); tone(520, 0.14, { type: 'square', gain: 0.05 }); tone(390, 0.22, { type: 'square', gain: 0.05, delay: 0.16 }); },
  heal() { tone(660, 0.12, { gain: 0.12 }); tone(990, 0.2, { gain: 0.1, delay: 0.1 }); },
  reload() { play('uiSwitch', { gain: 0.6, rate: 0.7 }) || noise(0.05, { f: 3000, q: 3, gain: 0.25 }); },
  throw() { noise(0.25, { f: 600, q: 0.5, gain: 0.12, sweep: 2 }); },
  smoke() { noise(1.2, { f: 1800, q: 0.4, gain: 0.25, sweep: 0.3 }); },
  shield() { play('shield', { gain: 0.7 }) || tone(440, 0.5, { type: 'triangle', gain: 0.1, to: 880 }); },
  claw() { play('hitFlesh', { gain: 0.9, rate: 0.8 }) || noise(0.18, { f: 2600, q: 1, gain: 0.5, sweep: 0.3 }); },
  pickup() { play('uiConfirm', { gain: 0.8 }) || tone(880, 0.1, { gain: 0.1 }); },
  evac() { play('thruster', { gain: 0.8 }) || tone(300, 0.6, { type: 'triangle', gain: 0.1, to: 900 }); },
  step() { play('step', { gain: 0.25, gap: 0.12 }); },
  door(open) { play(open ? 'doorOpen' : 'doorClose', { gain: 0.7 }); },
  engine() { play('engine', { gain: 0.8, drift: 0.02 }); },
  turn() { play('uiTick', { gain: 0.8, drift: 0 }) || tone(740, 0.08, { type: 'triangle', gain: 0.07 }); },
  win() { play('jingleWin', { gain: 1, drift: 0 }); },
  lose() { play('jingleLose', { gain: 1, drift: 0 }); },
  rank() { play('jingleRank', { gain: 0.9, drift: 0 }); },
};
