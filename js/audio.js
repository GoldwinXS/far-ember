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

// ------------------------------------------------------------ the dropship's engine
// One continuous voice that follows the ship: a deep rumble (noise through two low-passes), a jet roar (band-passed
// noise whose centre climbs with throttle), a breath of air on top, a soft turbine whine (two slightly detuned sines
// and a quiet octave, gliding as the turbines spool) and, under it all, a looped engine recording whose speed follows
// the throttle. Every change rides setTargetAtTime, the voice fades in and out on its own gain, and distance from the
// camera lowers and darkens it. Built on any context, so tools can render it offline:
// engineVoice(ac, dest, noise, loop?) -> { set(throttle, { tilt, dist, at }), stop(fade, at) }.
const ENGINE_MIX = { rumble: 0.7, roar: 0.32, air: 0.012, whine: 0.004, hum: 0.09 };
const ENGINE_FADE_IN = 1.2;
export function engineVoice(ac, dest, noise, loop = null, mix = ENGINE_MIX) {
  const t0 = ac.currentTime;
  const filt = (type, f, q) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const amp = (v) => { const g = ac.createGain(); g.gain.value = v; return g; };
  const chain = (...n) => { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; };
  const sources = [];
  const noiseAt = (rate, offset) => {
    const s = ac.createBufferSource();
    s.buffer = noise; s.loop = true; s.playbackRate.value = rate;
    s.start(t0, offset % noise.duration);
    sources.push(s);
    return s;
  };
  // the bus: level (throttle and distance), air absorption, a high-pass that keeps DC and sub-sonic thump out, the fade
  const level = amp(0), air = filt('lowpass', 16000, 0.5), clean = filt('highpass', 28, 0.7), fade = amp(0);
  chain(level, air, clean, fade, dest);
  const rumble = amp(0), rumLo1 = filt('lowpass', 140, 0.6), rumLo2 = filt('lowpass', 140, 0.6);
  chain(noiseAt(0.62, 0.3), rumLo1, rumLo2, rumble, level);
  const roar = amp(0), roarBp = filt('bandpass', 400, 0.7), roarLo = filt('lowpass', 1200, 0.5);
  chain(noiseAt(1, 2.7), roarBp, roarLo, roar, level);
  const breath = amp(0);
  chain(noiseAt(1.13, 4.9), filt('highpass', 3000, 0.5), breath, level);
  const whine = amp(0), whineLo = filt('lowpass', 2400, 0.5);
  chain(whineLo, whine, level);
  const oscs = [[1, 'sine', 1], [1.004, 'sine', 1], [2.003, 'triangle', 0.25]].map(([mul, type, g]) => {
    const o = ac.createOscillator();
    o.type = type; o.frequency.value = 520 * mul;
    chain(o, amp(g), whineLo);
    o.start(t0);
    sources.push(o);
    return [o, mul];
  });
  let hum = null, humRate = null;
  if (loop) {
    const s = ac.createBufferSource();
    s.buffer = loop.buffer; s.loop = true; s.loopStart = loop.start; s.loopEnd = loop.end;
    s.start(t0, loop.start + Math.random() * (loop.end - loop.start));
    sources.push(s);
    hum = chain(s, amp(0));
    hum.connect(level);
    humRate = s.playbackRate;
  }
  fade.gain.setValueAtTime(0, t0);
  fade.gain.linearRampToValueAtTime(1, t0 + ENGINE_FADE_IN);
  let last = -1, done = false;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  return {
    // throttle 0..1 (even at 0 the turbines idle), tilt 0 pods down .. 1 swung back, dist from the camera in metres
    set(k, { tilt = 0, dist = 8, at = ac.currentTime } = {}) {
      if (done || at - last < 0.03) return;
      last = at;
      const e = 0.14 + 0.86 * clamp(k), hover = 1 - clamp(tilt);
      const T = (p, v, tau = 0.2) => p.setTargetAtTime(v, at, tau);
      T(level.gain, Math.min(1, (12 / Math.max(1, dist)) ** 0.7), 0.12);
      T(air.frequency, Math.min(16000, Math.max(1200, 16000 * (12 / Math.max(12, dist)) ** 0.8)), 0.12);
      T(rumble.gain, mix.rumble * e ** 1.2 * (0.8 + 0.4 * hover));
      T(rumLo1.frequency, 80 + 150 * e); T(rumLo2.frequency, 80 + 150 * e);
      // the roar's centre climbs with throttle; a band-pass on noise passes more power the higher it sits, so the
      // gain falls as it climbs and the low-pass behind it follows: the timbre opens up without turning to hiss
      const c = 180 + 900 * e ** 1.3 * (0.8 + 0.4 * (1 - hover));
      T(roar.gain, mix.roar * e ** 1.7 * (0.85 + 0.3 * hover) * Math.sqrt(400 / c));
      T(roarBp.frequency, c); T(roarLo.frequency, Math.min(6000, c * 2.2));
      T(breath.gain, mix.air * e ** 2.4);
      T(whine.gain, mix.whine * (0.35 + 0.65 * e));
      for (const [o, mul] of oscs) T(o.frequency, (420 + 820 * e) * mul, 0.35); // turbines spool slower than the roar
      if (hum) { T(hum.gain, mix.hum * (0.5 + 0.5 * e)); T(humRate, 0.78 + 0.5 * e, 0.35); }
    },
    // fade to silence over dur seconds, then free everything
    stop(dur = 1.4, at = ac.currentTime) {
      if (done) return;
      done = true;
      // the fade gain only ever ramps, so its value now is known: hold it there and ramp to zero
      const v = at >= t0 + ENGINE_FADE_IN ? 1 : Math.max(0, (at - t0) / ENGINE_FADE_IN);
      fade.gain.cancelScheduledValues(at);
      fade.gain.setValueAtTime(v, at);
      fade.gain.linearRampToValueAtTime(0, at + dur);
      for (const s of sources) s.stop(at + dur + 0.05);
      sources[0].onended = () => fade.disconnect();
    },
  };
}
let engineNoise = null;
function shipEngine() {
  if (!ctx) return { set() {}, stop() {} };
  if (!engineNoise) {
    // its own long noise, so the hiss never audibly repeats
    engineNoise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 7.3), ctx.sampleRate);
    const d = engineNoise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const lp = manifest?.loops?.engineLoop, buf = bank.get('engineLoop')?.[0];
  return engineVoice(ctx, sfxBus, engineNoise, buf && lp ? { buffer: buf, start: lp[0], end: lp[1] } : null);
}

export const sfx = {
  init,
  play,
  music,
  shipEngine,
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
